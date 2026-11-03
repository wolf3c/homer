import { basename } from "node:path";
import type { Homer, Message } from "../service.js";
import { TelegramChannel } from "./telegram-channel.js";
import type { MainGeneration, TelegramHost, TelegramOrigin } from "./telegram-contract.js";

type App = Partial<Pick<Homer,'processes'>> & Pick<Homer, "store" | "files" | "tasks" | "interactions" | "submitMessage" | "stopMain"> & {conversationState():Pick<ReturnType<Homer['conversationState']>,'threadId'|'messages'|'isRunning'|'activeMessageId'>};
type Options = ConstructorParameters<typeof TelegramChannel>[3];
type Terminal = "completed" | "interrupted" | "failed";
const same = (a: MainGeneration, b: MainGeneration) =>
  a.id === b.id && a.threadId === b.threadId && a.turnId === b.turnId && a.messageId === b.messageId && a.sourceRequestId === b.sourceRequestId;

// The shared host attaches handleMessage to its one onMessage/sink and forwards
// actual main-turn lifecycle notifications to mainStarted/mainFinished. Those
// notifications are required; this bridge never invents a turnId from final text.
export class TelegramHomerBridge implements TelegramHost {
  readonly channel: TelegramChannel;
  readonly gaps = new Set<string>();
  readonly threadId: string;
  #current: MainGeneration | undefined;
  #sequence = 0;
  #terminal = new Map<string, Terminal>();
  #terminalWaiters = new Map<string, (status: Terminal) => void>();
  constructor(readonly app: App, options?: Options) {
    const threadId = app.store.meta("mainThread");
    if (!threadId) throw new Error("telegram_main_not_started");
    this.threadId = threadId;
    this.channel = new TelegramChannel(app.store.db, this, threadId, options);
  }
  private originalThread() {
    if (this.app.store.meta("mainThread") !== this.threadId) throw new Error("telegram_main_thread_changed");
  }
  private acceptedRoute(requestId: string) {
    const receipt = this.channel.store.db.prepare("SELECT origin FROM tg_acceptances WHERE requestId=?").get(requestId) as { origin: string } | undefined;
    const route = this.channel.store.route(requestId);
    return receipt && JSON.stringify(route) === receipt.origin ? route : undefined;
  }
  async submit(input: { requestId: string; text: string; origin: TelegramOrigin }) {
    this.originalThread();
    if (!this.channel.store.trusted(input.origin)) throw new Error("telegram_route_revoked");
    if (this.app.store.request(input.requestId) && !this.channel.store.db.prepare("SELECT 1 FROM conversation_inputs WHERE requestId=?").get(input.requestId))
      throw new Error("request_id_conflict");
    this.app.submitMessage({ requestId: input.requestId, text: input.text }, {
      source: "telegram", persist: receipt => this.channel.store.persistAcceptance(input, receipt),
    });
  }
  async respond(input: { interactionId: string; requestId: string; text: string; origin: TelegramOrigin }) {
    this.originalThread();
    if (!this.channel.store.trusted(input.origin)) throw new Error("telegram_route_revoked");
    if (this.app.store.db.prepare("SELECT 1 FROM conversation_inputs WHERE requestId=? AND threadId=?").get(input.requestId, this.threadId)) {
      // Reuse the canonical history hash (which includes interactionId). An
      // already accepted answer remains idempotent after the Worker resumes.
      this.app.submitMessage({ requestId: input.requestId, text: input.text, interactionId: input.interactionId }, {
        source: "telegram", persist: receipt => this.channel.store.persistAcceptance(input, receipt),
      });
      return;
    }
    const interaction = this.app.interactions.inspect(input.interactionId), run = this.app.store.run(interaction.runId);
    if (interaction.state !== "pending_user" || !run || run.status !== "running" || run.stopRequestedAt || run.threadId !== interaction.threadId || run.turnId !== interaction.turnId)
      throw new Error("telegram_interaction_not_live");
    const source = run.sourceRequestId ? this.acceptedRoute(run.sourceRequestId) : undefined;
    if (!source || !this.channel.store.trusted(source) || source.botId !== input.origin.botId || source.chatId !== input.origin.chatId || source.userId !== input.origin.userId || source.bindingVersion !== input.origin.bindingVersion)
      throw new Error("telegram_interaction_origin_mismatch");
    // The main Agent interprets the actual user response within existing autonomy;
    // a Telegram button never calls WorkerInteractions.respond directly.
    this.app.submitMessage({ requestId: input.requestId, text: input.text, interactionId: input.interactionId }, {
      source: "telegram", persist: receipt => this.channel.store.persistAcceptance(input, receipt),
    });
  }
  async artifact(runId: string, origin?: TelegramOrigin) {
    this.originalThread();
    const verified=this.app.tasks.publishedArtifact(runId);
    const source=verified?.routeSourceRequestId?this.acceptedRoute(verified.routeSourceRequestId):undefined;
    if (!verified || !source || !this.channel.store.trusted(source) ||
      (origin && (source.botId !== origin.botId || source.chatId !== origin.chatId || source.userId !== origin.userId || source.bindingVersion !== origin.bindingVersion)))
      throw new Error("telegram_artifact_not_authorized");
    const file=this.app.files.resultBytes(this.app.files.prepareRun(this.app.tasks.run(runId).matterId,runId),verified.path);
    return { filename: basename(verified.path), bytes:file.data };
  }
  async stop(target: MainGeneration): Promise<"stopped" | "already_finished" | "unconfirmed"> {
    this.originalThread();
    if (this.#terminal.has(target.id)) return "already_finished";
    const current = this.#current, state = this.app.conversationState();
    if (!current || !same(current, target) || state.threadId !== target.threadId || state.activeMessageId !== target.messageId) return "already_finished";
    const terminal = new Promise<Terminal>(resolve => { this.#terminalWaiters.set(target.id, resolve); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = this.app.stopMain(target.messageId).then(async () => {
        // requested:true alone is deliberately insufficient evidence.
        const status = this.#terminal.get(target.id) ?? await terminal;
        return status === "interrupted" ? "stopped" as const : "already_finished" as const;
      });
      return await Promise.race([work, new Promise<"unconfirmed">(resolve => { timer = setTimeout(() => resolve("unconfirmed"), 5000); })]);
    } catch { return "unconfirmed"; }
    finally { if (timer) clearTimeout(timer); this.#terminalWaiters.delete(target.id); }
  }
  async mainStarted(generation: MainGeneration) {
    this.originalThread();
    if (generation.threadId !== this.threadId || generation.visibility !== "main_user" || !generation.turnId)
      throw new Error("telegram_generation_scope_mismatch");
    if (this.#current) {
      if (!same(this.#current, generation)) throw new Error("telegram_main_generation_overlap");
      return;
    }
    if (this.#terminal.has(generation.id)) return;
    this.#current = { ...generation }; this.#sequence = 0;
    await this.channel.event({ type: "start", generation: this.#current });
  }
  async mainFinished(generationId: string, text: string, status: Terminal) {
    const current = this.#current;
    if (!current || current.id !== generationId) return;
    this.#terminal.set(generationId, status);
    // Bounded live bookkeeping; persistent native stop routing is in tg_drafts.
    if (this.#terminal.size > 100) this.#terminal.delete(this.#terminal.keys().next().value!);
    this.#terminalWaiters.get(generationId)?.(status);
    this.#terminalWaiters.delete(generationId);
    this.#current = undefined;
    await this.channel.event({ type: "finish", generationId, text, status });
  }
  async handleMessage(message: Message) {
    this.originalThread();
    if (message.type === "main_start") {
      if (!this.acceptedRoute(message.sourceRequestId)) return;
      await this.mainStarted({ id: message.generationId, threadId: message.threadId, turnId: message.turnId,
        messageId: message.messageId, sourceRequestId: message.sourceRequestId, visibility: "main_user" });
      return;
    }
    if (message.type === "main_terminal") {
      const current = this.#current;
      if (current && same(current, { id: message.generationId, threadId: message.threadId, turnId: message.turnId,
        messageId: message.messageId, sourceRequestId: message.sourceRequestId, visibility: "main_user" }) && message.status)
        await this.mainFinished(message.generationId, message.text, message.status);
      return;
    }
    const current = this.#current;
    if (message.type === "delta") {
      if (!message.requestId || !this.acceptedRoute(message.requestId)) return;
      if (!current || message.messageId !== current.messageId || (message.requestId && message.requestId !== current.sourceRequestId)) {
        this.gaps.add("native_generation_events_missing"); return;
      }
      await this.channel.event({ type: "delta", generationId: current.id, sequence: this.#sequence++, text: message.text });
      return;
    }
    if (message.type === "reply" && message.requestId) {
      if (!this.acceptedRoute(message.requestId)) return;
      // Public final nodes have their own IDs. Native drafts and stop routing
      // retain the original reply accepted atomically with the canonical input.
      const accepted = this.channel.store.db.prepare(`SELECT a.replyId FROM tg_acceptances a
        JOIN conversation_inputs i ON i.requestId=a.requestId AND i.replyId=a.replyId
        WHERE a.requestId=? AND i.threadId=?`).get(message.requestId, this.threadId) as { replyId: string } | undefined;
      if (!accepted) return;
      if (current?.sourceRequestId === message.requestId) {
        // History may already be failed while engine closure remains unconfirmed.
        // Only the matching main_terminal event can release this live generation.
        this.gaps.add("native_generation_terminal_missing");
      } else if (!this.channel.store.db.prepare("SELECT 1 FROM tg_drafts WHERE json_extract(generation,'$.sourceRequestId')=? AND json_extract(generation,'$.messageId')=? AND json_extract(generation,'$.threadId')=?").get(message.requestId, accepted.replyId, this.threadId)) {
        // Formal readability fallback is useful, but never passes native-stream acceptance.
        this.gaps.add("native_generation_events_missing");
        await this.channel.event({ type: "delivery", id: "reply:" + accepted.replyId, sourceRequestId: message.requestId, text: message.text });
      }
      return;
    }
    if(message.type==='coordination'){
      const output=message.messageId?this.app.processes?.coordination(message.messageId):undefined;
      if(!output||output.text!==message.text||!this.acceptedRoute(output.sourceRequestId))return;
      if(output.interactionId){
        const item=this.app.interactions.inspect(output.interactionId);
        if(item.userQuestion){
          if(this.app.store.run(item.runId)?.sourceRequestId!==output.sourceRequestId)return;
          message={type:'question',runId:item.runId,interactionId:item.id,requestId:output.sourceRequestId,text:output.text};
        }
      }
      if(message.type==='coordination'){
        await this.channel.event({type:'delivery',id:output.messageId,sourceRequestId:output.sourceRequestId,text:output.text});return;
      }
    }
    if(message.type==='delivery'){
      if(!message.deliveryId)return;
      const d=this.app.tasks.delivery(message.deliveryId),sourceRequestId=d.routeSourceRequestId;
      if(!sourceRequestId||!this.acceptedRoute(sourceRequestId)||!['submitting','recorded','uncertain'].includes(d.state)||d.text!==message.text||d.historyMessageId!==message.messageId||sourceRequestId!==message.requestId)return;
      const file=d.publishedFileResultIds.length<=1&&message.runId?this.app.tasks.publishedArtifact(message.runId):null;
      const text=d.publishedFileResultIds.length>1?d.text+`\n\n本次有 ${d.publishedFileResultIds.length} 个成果，请在荷马 Web 主对话的“成果下载”逐个获取。`:d.text;
      await this.channel.event({type:'delivery',id:d.id,sourceRequestId,text,...(file?.deliveryId===d.id?{runId:message.runId}: {})});return;
    }
    if (!message.runId) return;
    const run = this.app.store.run(message.runId), sourceRequestId = run?.sourceRequestId;
    if (!run || !sourceRequestId || !this.acceptedRoute(sourceRequestId)) return;
    if (message.type === "question" && message.interactionId) {
      const item = this.app.interactions.inspect(message.interactionId);
      if (item.runId !== run.id || item.state !== "pending_user") return;
      await this.channel.event({ type: "interaction", id: item.id, sourceRequestId, runId: run.id, text: item.userQuestion ?? message.text,
        kind: item.kind, expiresAt: Date.now() + 1_800_000,
        options: item.kind === "authorization" ? [{ id: "approve", label: "允许这一次", text: "允许这一次请求；仅限该问题中列明的动作。" }, { id: "deny", label: "拒绝", text: "拒绝这一次请求。" }] : [] });
    }
    // Raw Worker progress/tools are not a second user-facing Agent identity.
  }
  async recoverReplies() {
    this.originalThread();
    for(const messageId of this.app.processes?.coordinationIds(this.threadId)??[]){
      const output=this.app.processes?.coordination(messageId);if(output)await this.handleMessage({type:'coordination',messageId,text:output.text});
    }
    const replies = this.channel.store.db.prepare(`SELECT a.requestId,a.replyId,m.text,m.status FROM tg_acceptances a
      JOIN conversation_messages m ON m.id=a.replyId WHERE m.threadId=? AND m.status IN ('completed','failed','interrupted') ORDER BY m.createdAt,m.rowid`)
      .all(this.threadId) as { requestId: string; replyId: string; text: string; status: string }[];
    for (const reply of replies) {
      if (this.#current?.sourceRequestId === reply.requestId) continue;
      const origin = this.acceptedRoute(reply.requestId);
      if (!origin || !this.channel.store.matches(origin)) continue;
      const draft = this.channel.store.db.prepare("SELECT generationId FROM tg_drafts WHERE json_extract(generation,'$.messageId')=? AND json_extract(generation,'$.sourceRequestId')=?").get(reply.replyId, reply.requestId) as { generationId: string } | undefined;
      const existing = this.channel.store.db.prepare("SELECT 1 FROM tg_outbox WHERE groupId=? OR groupId=?").get("delivery:reply:" + reply.replyId, "generation:" + (draft?.generationId ?? ""));
      if (existing) continue;
      const text = (reply.text || "上次主回复未完成。") + (reply.status === "interrupted" ? "\n\n上次主回复已中断；已保存的任务不会自动重跑，请查询当前进度。" : "");
      // This is recovery of a formal history entry, never a replayed native draft.
      await this.channel.event({ type: "delivery", id: "reply:" + reply.replyId, sourceRequestId: reply.requestId, text });
    }
  }
  async restore() { await this.channel.restore(); await this.recoverReplies(); return this.channel.view(); }
  async close() { await this.channel.close(); }
}
