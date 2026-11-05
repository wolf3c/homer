import { TelegramApi, TelegramApiError } from "./telegram-api.js";
import { telegramDraft, splitTelegramText, readableTelegramRich, type RichMessage } from "./telegram-render.js";
import { recordTelegramOutput } from "./telegram-output.js";
import { TelegramStore, type TelegramInbox, type TelegramOutbox } from "./telegram-store.js";
import type { MainGeneration, TelegramHost, TelegramHostEvent, TelegramOrigin, TelegramUpdate } from "./telegram-contract.js";

type LiveDraft = { generation: MainGeneration; text: string; sequence: number; nextAt: number; refreshAt: number; dirty: boolean; sending: Promise<void> | null };
export type TelegramStatus = "offline" | "online" | "conflict" | "unauthorized" | "network_retry" | "presentation_degraded" | "send_uncertain" | "send_failed" | "host_uncertain";

export class TelegramAdapter {
  static #consumers = new Map<string, TelegramAdapter>();
  #drafts = new Map<string, LiveDraft>();
  #inputDrain: Promise<void> | undefined;
  #controlDrain: Promise<void> | undefined;
  #answerDrain: Promise<void> | undefined;
  #flush: Promise<void> | undefined;
  #nextSendAt = 0;
  #retryAt = 0;
  #abort: AbortController | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #polling: Promise<void> | undefined;
  #fatal = false;
  #closed = false;
  #starting: Promise<void> | undefined;
  constructor(
    readonly botId: string, readonly store: TelegramStore, private readonly api: TelegramApi,
    private readonly host: TelegramHost, private readonly status: (value: TelegramStatus) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}
  canUpgrade() {
    return !this.#starting && !this.#inputDrain && !this.#controlDrain && !this.#answerDrain && !this.#flush &&
      this.#drafts.size === 0 && !this.store.db.prepare("SELECT 1 FROM tg_outbox WHERE botId=? AND state='sending'").get(this.botId);
  }

  // Called by the existing sole host; this adapter never creates a Homer or a listener.
  start(): Promise<void> {
    if (this.#starting) return this.#starting;
    if (this.#polling) return Promise.resolve();
    this.#starting = this.doStart().finally(() => { this.#starting = undefined; });
    return this.#starting;
  }
  private async doStart() {
    const consumer = TelegramAdapter.#consumers.get(this.botId);
    if (consumer && consumer !== this) throw new Error("telegram_consumer_already_running");
    const connection = this.store.connection(this.botId);
    if (!connection?.enabled) throw new Error("telegram_disabled");
    TelegramAdapter.#consumers.set(this.botId, this);
    this.#closed = false;
    this.#abort = new AbortController();
    try {
      if (await this.api.inspect(this.#abort.signal) !== this.botId) throw new Error("telegram_bot_mismatch");
      if (this.#closed || this.#abort.signal.aborted) return;
    } catch (error) { if (TelegramAdapter.#consumers.get(this.botId) === this) TelegramAdapter.#consumers.delete(this.botId); throw error; }
    this.store.reconcile(this.botId);
    this.#fatal = false;
    this.#timer = setInterval(() => { void this.tick().catch(() => this.emit("host_uncertain")); }, 250);
    this.#timer.unref();
    this.emit("online");
    this.#polling = this.poll(this.#abort.signal).finally(() => {
      this.#polling = undefined;
      if (TelegramAdapter.#consumers.get(this.botId) === this) TelegramAdapter.#consumers.delete(this.botId);
    });
    this.drain();
  }
  async close(disable = false) {
    this.#closed = true;
    if (disable) this.store.enabled(this.botId, false);
    this.#abort?.abort();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#starting?.catch(() => {});
    await this.#polling;
    await this.idle();
    this.#drafts.clear();
    if (TelegramAdapter.#consumers.get(this.botId) === this) TelegramAdapter.#consumers.delete(this.botId);
    this.emit("offline");
  }
  private emit(value: TelegramStatus) { try { this.status(value); } catch { /* status must not affect transport */ } }
  private async poll(signal: AbortSignal) {
    let backoff = 1000;
    let retrying = false;
    while (!signal.aborted && !this.#fatal && this.store.connection(this.botId)?.enabled) {
      try {
        const connection = this.store.connection(this.botId)!;
        // After a week Telegram may choose random update IDs. An offset-free
        // probe is safe: dedup remains in SQLite and no negative/drop offset is used.
        const offset = connection.lastUpdate === null || this.now() - connection.lastUpdate >= 7 * 86400_000 ? undefined : connection.offset ?? undefined;
        const updates = await this.api.updates(offset, signal);
        if (signal.aborted) break;
        if (!Array.isArray(updates)) throw new Error("telegram_invalid_updates");
        this.receive(updates);
        if (retrying) this.emit("online");
        retrying = false;
        backoff = 1000;
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof TelegramApiError && ["conflict", "unauthorized"].includes(error.code)) {
          this.#fatal = true;
          this.store.enabled(this.botId, false);
          this.emit(error.code as "conflict" | "unauthorized");
          break;
        }
        this.emit("network_retry");
        retrying = true;
        const delay = error instanceof TelegramApiError && error.retryAfterMs ? error.retryAfterMs : backoff;
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, delay);
          function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
          signal.addEventListener("abort", done, { once: true });
        });
        backoff = Math.min(30_000, backoff * 2);
      }
    }
  }
  receive(updates: TelegramUpdate[]) {
    if (this.#closed) return;
    this.store.ingest(this.botId, updates, this.now());
    this.drain();
  }
  private drain() {
    if (this.#closed || this.#fatal || !this.store.connection(this.botId)?.enabled) return;
    if (!this.#controlDrain) this.#controlDrain = this.drainControls().finally(() => {
      this.#controlDrain = undefined;
      if (this.store.inbox(this.botId).some(row => row.kind !== "input")) this.drain();
    });
    if (!this.#inputDrain) this.#inputDrain = this.drainInputs().finally(() => {
      this.#inputDrain = undefined;
      if (this.store.inbox(this.botId).some(row => row.kind === "input")) this.drain();
    });
  }
  private async drainControls() {
    for (const row of this.store.inbox(this.botId).filter(r => r.kind !== "input")) {
      if (this.#closed || this.#fatal) break;
      const origin = JSON.parse(row.origin) as TelegramOrigin;
      if (!this.store.trusted(origin)) { this.store.inboxState(row.requestId, "rejected"); continue; }
      this.store.inboxState(row.requestId, "dispatching");
      try {
        if (row.kind === "stop") {
          const { draftId } = JSON.parse(row.body!) as { draftId: number };
          const target = this.store.requestStop(origin, draftId);
          if (target) {
            const live = this.#drafts.get(target.id);
            if (live) live.dirty = false;
            const result = await this.host.stop(target);
            if (result === "unconfirmed") this.emit("host_uncertain");
          }
        } else {
          const body = JSON.parse(row.body!) as { id: string; data: string };
          // Telegram spinner is acknowledged promptly, even for invalid/stale handles.
          await this.api.call("answerCallbackQuery", { callback_query_id: body.id }).catch(() => {});
          this.store.answer(row.requestId, origin, { handle: body.data }, this.now());
          await this.drainAnswers();
        }
        this.store.inboxState(row.requestId, "accepted");
      } catch { this.store.inboxState(row.requestId, "uncertain"); this.emit("host_uncertain"); }
    }
  }
  private async drainInputs() {
    for (const row of this.store.inbox(this.botId).filter(r => r.kind === "input")) await this.input(row);
  }
  private async input(row: TelegramInbox) {
    if (this.#closed || this.#fatal) return;
    const origin = JSON.parse(row.origin) as TelegramOrigin;
    if (!this.store.trusted(origin)) { this.store.inboxState(row.requestId, "rejected"); return; }
    const body = JSON.parse(row.body!) as { text: string; replyId?: number };
    this.store.inboxState(row.requestId, "dispatching");
    try {
      const pending = this.store.pendingInteractions(origin, this.now());
      if (body.replyId !== undefined && this.store.answer(row.requestId, origin, { replyId: body.replyId, text: body.text }, this.now())) {
        await this.drainAnswers();
      } else if (body.replyId !== undefined && this.store.knownInteraction(origin, body.replyId)) {
        this.store.enqueue(row.requestId + ":expired", origin, "text", { text: "该问题已处理或已过期，此回复没有批准其他操作。请在主对话查看当前待答项。" }, this.now());
      } else if (pending.length && /^(同意|允许|批准|拒绝|不允许|可以|不行|好|是|否|yes|no|approve|deny)[。.!！]?$/iu.test(body.text.trim())) {
        this.store.enqueue(row.requestId + ":clarify", origin, "text", { text: "请回复对应问题卡片或点击该卡片的按钮，明确你要回答哪一项。" }, this.now());
      } else {
        await this.host.submit({ requestId: row.requestId, text: body.text, origin });
        this.store.enqueue(row.requestId + ":ack", origin, "text", { text: "已收到，荷马正在处理。" }, this.now());
      }
      this.store.inboxState(row.requestId, "accepted");
    } catch { this.store.inboxState(row.requestId, "uncertain"); this.emit("host_uncertain"); }
  }
  private drainAnswers(): Promise<void> {
    if (this.#answerDrain) return this.#answerDrain;
    this.#answerDrain = (async () => {
      for (const answer of this.store.pendingAnswers()) {
        const origin = JSON.parse(answer.origin) as TelegramOrigin;
        if (origin.botId !== this.botId) continue;
        if (!this.store.trusted(origin)) { this.store.answerState(answer.requestId, "rejected"); continue; }
        try {
          await this.host.respond({ interactionId: answer.interactionId, requestId: answer.requestId, text: answer.text, origin });
          this.store.answerState(answer.requestId, "accepted");
        } catch { this.store.answerState(answer.requestId, "uncertain"); this.emit("host_uncertain"); }
      }
    })().finally(() => { this.#answerDrain = undefined; });
    return this.#answerDrain;
  }
  async event(event: TelegramHostEvent) {
    if (this.#closed) return;
    if (event.type === "start") {
      if (event.generation.visibility !== "main_user") return;
      recordTelegramOutput(this.store, event, this.now());
      const origin = this.store.route(event.generation.sourceRequestId);
      if (!origin || !this.store.trusted(origin)) return;
      const draft = this.store.createDraft(event.generation, origin, event.mode ?? "rich");
      if (draft.state !== "active") return;
      this.#drafts.set(event.generation.id, { generation: event.generation, text: "", sequence: -1, nextAt: 0, refreshAt: 0, dirty: true, sending: null });
      void this.flushDraft(event.generation.id).catch(() => this.emit("host_uncertain"));
    } else if (event.type === "delta") {
      const live = this.#drafts.get(event.generationId), draft = this.store.draft(event.generationId);
      if (!live || draft?.state !== "active" || event.sequence <= live.sequence) return;
      if (event.sequence !== live.sequence + 1) throw new Error("telegram_delta_sequence_gap");
      if (live.text.length + event.text.length > 1_000_000) throw new Error("telegram_output_too_large");
      live.text += event.text; live.sequence = event.sequence; live.dirty = true;
      void this.flushDraft(event.generationId).catch(() => this.emit("host_uncertain"));
    } else if (event.type === "finish") {
      const draft = this.store.draft(event.generationId);
      if (!draft || draft.state === "closed") return;
      const live = this.#drafts.get(event.generationId);
      const text = event.text.trim() ? event.text : live?.text.trim() ? live.text : (event.status === "interrupted" ? "已停止本次回复。后台任务保持原状态。" : "本次回复未完成，请在主对话查看状态。");
      recordTelegramOutput(this.store, { ...event, text }, this.now(), () => this.emit("presentation_degraded"));
      if (live?.sending) void live.sending.finally(() => { this.#drafts.delete(event.generationId); });
      else this.#drafts.delete(event.generationId);
    } else {
      recordTelegramOutput(this.store, event, this.now(), () => this.emit("presentation_degraded"));
    }
  }
  private async flushDraft(id: string) {
    const live = this.#drafts.get(id), draft = this.store.draft(id);
    if (!live || live.sending || draft?.state !== "active" || this.#closed || this.#fatal || this.now() < Math.max(live.nextAt, this.#retryAt, this.#nextSendAt)) return;
    if (!live.dirty && this.now() < live.refreshAt) return;
    const origin = JSON.parse(draft.origin) as TelegramOrigin;
    if (!this.store.trusted(origin)) return;
    live.dirty = false;
    live.nextAt = this.now() + 1000;
    this.#nextSendAt = live.nextAt;
    live.sending = (async () => {
      try {
        await this.api.call(draft.mode === "rich" ? "sendRichMessageDraft" : "sendMessageDraft", {
          chat_id: origin.chatId, draft_id: draft.draftId, can_stop: true, keep_on_stop: true, ...telegramDraft(live.text, draft.mode),
        }, this.#abort?.signal);
        // Changed content can be sent after 1s; unchanged content refreshes before 30s expiry.
        live.nextAt = this.now() + 1000;
        live.refreshAt = this.now() + 10_000;
      } catch (error) {
        live.dirty = true;
        live.nextAt = this.now() + 1000;
        this.failure(error, false);
      }
    })().finally(() => { live.sending = null; });
    await live.sending;
  }
  private failure(error: unknown, formal: boolean) {
    if (error instanceof TelegramApiError && error.code === "rate_limited") this.#retryAt = this.now() + error.retryAfterMs;
    else if (error instanceof TelegramApiError && (error.code === "unauthorized" || error.code === "conflict")) {
      this.#fatal = true; this.store.enabled(this.botId, false); this.emit(error.code);
    } else if (error instanceof TelegramApiError && error.code === "rejected") this.emit("send_failed");
    else this.emit(formal ? "send_uncertain" : "network_retry");
  }
  async tick() {
    if (this.#closed || this.#fatal || !this.store.connection(this.botId)?.enabled) return;
    this.drain();
    await this.drainAnswers();
    await Promise.all([...this.#drafts.keys()].map(id => this.flushDraft(id)));
    if (!this.#flush) this.#flush = this.flushOutbox().finally(() => { this.#flush = undefined; });
    await this.#flush;
  }
  private async flushOutbox() {
    if (this.now() < Math.max(this.#nextSendAt, this.#retryAt) || this.#fatal || this.#closed) return;
    // A draft already in flight must settle before its formal replacement.
    if ([...this.#drafts.values()].some(draft => draft.sending)) return;
    const row = this.store.outbox(this.botId, this.now())[0];
    if (!row) return;
    const origin = JSON.parse(row.origin) as TelegramOrigin;
    if (!this.store.trusted(origin)) { this.store.outboxState(row.id, "held"); return; }
    this.store.outboxState(row.id, "sending");
    this.#nextSendAt = this.now() + 1000;
    try {
      const result = await this.send(row, origin);
      if (!Number.isSafeInteger(result.message_id) || result.message_id <= 0) throw new TelegramApiError("uncertain");
      this.store.atomic(() => {
        this.store.outboxState(row.id, "sent", result.message_id);
        if (row.kind === "interaction") this.store.interactionSent((JSON.parse(row.payload!) as { interactionId: string }).interactionId, result.message_id);
      });
      // A formal message may replace the ephemeral preview. Refresh the active
      // main draft promptly, without treating that preview as a new history row.
      for (const live of this.#drafts.values()) { live.dirty = true; live.nextAt = this.now() + 1000; }
    } catch (error) {
      if (error instanceof TelegramApiError && error.code === "rate_limited") this.store.outboxState(row.id, "pending", undefined, this.now() + error.retryAfterMs);
      else if (error instanceof TelegramApiError && error.code !== "uncertain") {
        this.store.outboxState(row.id, "failed");
        if (row.kind === "rich" && error.code === "rejected" && error.status === 400) {
          // Explicit rejection proves this attempt was not sent. Expose degraded status.
          const rich = JSON.parse(row.payload!) as { rich_message: RichMessage };
          const text = "富消息格式未被接受，以下为可读文本；本条未通过富消息验收。\n\n" + readableTelegramRich(rich.rich_message);
          splitTelegramText(text).forEach((part, index) => this.store.enqueue(`${row.id}:degraded:${index}`, origin, "text", { text: part }, this.now()));
          // Retain original payload for trusted local review; never silently claim native rendering.
          this.emit("presentation_degraded");
        } else if (row.kind === "file" && error.code === "rejected") {
          this.store.enqueue(row.id + ":failed-notice", origin, "text", { text: "成果正文已生成，但文件未交付。请在本地主对话查看并明确补发。" }, this.now());
        }
      } else this.store.outboxState(row.id, "uncertain");
      this.failure(error, true);
    }
  }
  private async send(row: TelegramOutbox, origin: TelegramOrigin): Promise<{ message_id: number }> {
    const payload = JSON.parse(row.payload!) as Record<string, unknown>;
    if (row.kind === "file") {
      let artifact: { filename: string; bytes: Uint8Array };
      try { artifact = await this.host.artifact(payload.resultId as string, origin); }
      catch { throw new TelegramApiError("rejected", 0, 422); }
      if (!this.store.trusted(origin)) throw new TelegramApiError("rejected", 0, 410);
      try { return await this.api.document(origin.chatId, artifact.filename, artifact.bytes, origin.messageId, this.#abort?.signal); }
      catch (error) { if (error instanceof TelegramApiError) throw error; throw new TelegramApiError("rejected", 0, 422); }
    }
    const { interactionId: _interactionId, ...body } = payload;
    return this.api.call(row.kind === "rich" ? "sendRichMessage" : "sendMessage", {
      ...body, chat_id: origin.chatId,
      ...(origin.messageId ? { reply_parameters: { message_id: origin.messageId, allow_sending_without_reply: true } } : {}),
    }, this.#abort?.signal);
  }
  async idle() {
    // A drain can schedule its successor while finishing. Observe until all are settled.
    while (this.#inputDrain || this.#controlDrain || this.#answerDrain || this.#flush || [...this.#drafts.values()].some(d => d.sending))
      await Promise.all([this.#inputDrain, this.#controlDrain, this.#answerDrain, this.#flush, ...[...this.#drafts.values()].map(d => d.sending)]);
  }
}
