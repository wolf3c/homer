import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Homer } from "../src/service.js";
import { TelegramHomerBridge } from "../src/channels/telegram-homer-bridge.js";
import type { EngineLike, EngineOptions, ToolCall, TurnResult } from "../src/engine.js";

const until = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error("telegram_synthetic_wait_timeout"); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test("TG answer passes actual main tools and resumes the original waiting Worker before reviewed artifact delivery", async t => {
  mkdirSync(resolve('.codex/scratch/telegram-plan'),{recursive:true});
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/worker-roundtrip-"));
  mkdirSync(join(root, "workspace/materials"), { recursive: true }); mkdirSync(join(root, "runtime"));
  writeFileSync(join(root, "workspace/materials/synthetic.md"), "合成材料，无真实用户内容");
  const workerAnswers: unknown[] = [], workerThreads: string[] = [];
  let serial = 0, bridge: TelegramHomerBridge | undefined;
  class Engine extends EventEmitter implements EngineLike {
    threadId: string; turnId?: string; resumable = true;
    constructor(readonly options: EngineOptions, readonly tool: (call: ToolCall) => Promise<unknown>) {
      super(); this.threadId = options.threadId ?? (this.worker ? "synthetic-worker-original" : "synthetic-main-original");
      if (this.worker) workerThreads.push(this.threadId);
    }
    get worker() { return this.options.tools.some(tool => tool.name === "read_material"); }
    async start() { return this.threadId; }
    async call(tool: string, args: unknown) {
      const callId = "synthetic-call-" + ++serial;
      const result = await this.tool({ threadId: this.threadId, turnId: this.turnId!, callId, tool, arguments: args });
      if (this.worker) this.emit("toolResponse", callId);
      return result;
    }
    async turn(text: string, options?: { onStarted?: (id: string) => void }): Promise<TurnResult> {
      this.turnId = "synthetic-turn-" + ++serial; options?.onStarted?.(this.turnId);
      if (this.worker) {
        await this.call("read_material", {});
        workerAnswers.push(await this.call("ask_main", { question: "合成格式偏好：表格还是段落？" }));
        await this.call("write_markdown", { filename: "synthetic-result.md", content: "# 合成成果\n\n采用用户指定表格格式。" });
        return { status: "completed", text: "合成执行完成" };
      }
      if (text === "合成派发") await this.call("dispatch_work", { title: "合成任务", goal: "根据合成材料输出 Markdown；格式询问用户", material: "synthetic.md" });
      const interactionId = text.match(/interactionId=([\w-]+)/)?.[1];
      if (interactionId) {
        await this.call("inspect_interaction", { interactionId });
        if (text.startsWith("[Worker待答]")) await this.call("escalate_interaction", { interactionId, question: "请选合成输出格式", reason: "本次授权未指定格式偏好" });
        else await this.call("respond_interaction", { interactionId, action: "answer", answer: "表格", reason: "依据用户绑定原卡片的实际答复" });
      }
      const runId = text.match(/runId=([\w-]+)/)?.[1];
      if (runId) await this.call("inspect_run", { runId });
      if (runId && text.startsWith("[执行结果待审阅]")) await this.call("review_artifact", { runId, accepted: true, summary: "合成成果符合材料和格式", reason: "已检查材料及成果" });
      return { status: "completed", text: "荷马合成对外回复" };
    }
    async interrupt() { return true; }
    async close() { return true; }
  }
  const app = new Homer({ workspace: join(root, "workspace"), runtime: join(root, "runtime"), codexBin: "/usr/bin/false", codexHome: join(root, "home"), model: "synthetic", effort: "medium", requiresOpenaiAuth: false, timeoutMs: 10000, mainTimeoutMs: 10000, stopGraceMs: 100 }, async message => { await bridge?.handleMessage(message); }, (options, tool) => new Engine(options, tool));
  t.after(async () => { await bridge?.close(); await app.close(); rmSync(root, { recursive: true, force: true }); });
  await app.start(); bridge = new TelegramHomerBridge(app);
  const store = bridge.channel.store;
  store.configure("123456", "synthetic-main-original"); store.enabled("123456", true);
  const code = store.pairing("123456"); store.proposePair("123456", code, "789123", "789123"); store.approvePair("123456", code, "789123", "789123");
  const receive = (updateId: number, text: string, replyId?: number) => {
    store.ingest("123456", [{ update_id: updateId, message: { message_id: updateId + 20, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text, ...(replyId ? { reply_to_message: { message_id: replyId } } : {}) } }]);
    return store.route(`tg:123456:${updateId}`)!;
  };
  const origin = receive(10, "合成派发");
  await bridge.submit({ requestId: "tg:123456:10", text: "合成派发", origin });
  await until(() => app.interactions.list().some(item => item.state === "pending_user") && !!store.db.prepare("SELECT 1 FROM tg_interactions").get());
  const pending = app.interactions.list()[0]!, runId = pending.runId;
  assert.equal(workerAnswers.length, 0); assert.equal(app.store.run(runId)?.status, "running");
  const question=app.processes.coordinationIds('synthetic-main-original').map(id=>app.processes.coordination(id)).find(output=>output?.interactionId===pending.id)!;
  assert.ok(question);const questionRows=()=>store.db.prepare('SELECT id,hash FROM tg_outbox WHERE groupId=? ORDER BY id').all('interaction:'+pending.id);
  const originalQuestion=questionRows();assert.equal(originalQuestion.length,1);
  await bridge.handleMessage({type:'coordination',messageId:question.messageId,text:'Forged question'});
  await bridge.recoverReplies();await bridge.recoverReplies();
  assert.deepEqual(questionRows(),originalQuestion,'retry and recovery preserve one question identity');
  assert.equal(store.db.prepare('SELECT count(*) n FROM tg_outbox WHERE groupId=?').get('delivery:'+question.messageId)!.n,0,'a question is not also published as a generic delivery');
  // Model the Telegram sender's successful formal question-card receipt.
  store.interactionSent(pending.id, 50);
  const answerOrigin = receive(11, "表格", 50);
  const answer = store.answer("tg:123456:11", answerOrigin, { replyId: 50, text: "表格" }); assert.ok(answer);
  await bridge.respond({ requestId: "tg:123456:11", text: answer.text, interactionId: answer.interactionId, origin: answerOrigin });
  await app.idle();
  assert.equal(app.interactions.inspect(pending.id).state, "answered");
  await bridge.recoverReplies();
  assert.deepEqual(questionRows(),originalQuestion,'answered question recovery neither resends nor changes the original card');
  assert.equal(store.db.prepare('SELECT count(*) n FROM tg_outbox WHERE groupId=?').get('delivery:'+question.messageId)!.n,0);
  assert.equal(workerAnswers.length, 1);
  assert.deepEqual(workerThreads, ["synthetic-worker-original"]);
  assert.equal((workerAnswers[0] as { answer: string }).answer, "表格");
  assert.equal(app.store.run(runId)?.status, "succeeded");
  const artifact = await bridge.artifact(runId, origin);
  assert.equal(artifact.filename, "synthetic-result.md"); assert.match(Buffer.from(artifact.bytes).toString("utf8"), /用户指定表格/);
  assert.ok(store.db.prepare("SELECT 1 FROM tg_outbox WHERE kind='file'").get());
  const deliveries = store.db.prepare("SELECT id,hash FROM tg_outbox WHERE groupId=? ORDER BY id").all("delivery:run:" + runId);
  await bridge.handleMessage({ type: "delivery", runId, text: "崩溃恢复后主 Agent 重新措辞的合成摘要" });
  assert.deepEqual(store.db.prepare("SELECT id,hash FROM tg_outbox WHERE groupId=? ORDER BY id").all("delivery:run:" + runId), deliveries);
  assert.equal(app.store.meta("mainThread"), "synthetic-main-original");
  await bridge.respond({ requestId: "tg:123456:11", text: "表格", interactionId: pending.id, origin: answerOrigin });
  await app.idle(); assert.equal(workerAnswers.length, 1);
});
