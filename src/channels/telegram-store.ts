import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { telegramId, type MainGeneration, type TelegramOrigin, type TelegramUpdate } from "./telegram-contract.js";

export type TelegramBinding = {
  botId: string; version: number; enabled: number; ownerId: string | null; chatId: string | null;
  conversationId: string; offset: number | null; lastPoll: number | null; lastUpdate: number | null; nextDraft: number;
};
export type TelegramInbox = {
  requestId: string; botId: string; updateId: number; kind: "input" | "callback" | "stop";
  origin: string; body: string | null; state: string; createdAt: number;
};
export type TelegramOutbox = {
  id: string; botId: string; origin: string; kind: "text" | "rich" | "file" | "interaction";
  payload: string | null; hash: string; state: string; nextAt: number; messageId: number | null;
  groupId: string;
};
export type TelegramDraft = {
  generationId: string; botId: string; draftId: number; origin: string; generation: string;
  mode: "rich" | "plain"; state: "active" | "stop_requested" | "closed";
};
type Pair = { hash: string; botId: string; expiresAt: number; candidateUser: string | null; candidateChat: string | null };
export type TelegramAnswer = {
  requestId: string; interactionId: string; origin: string; text: string; state: string;
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const id = (value: string) => /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));

// Uses ONLY the host's existing private SQLite connection. No connection, model or daemon ownership.
export class TelegramStore {
  #savepoint = 0;
  constructor(readonly db: DatabaseSync) {
    this.atomic(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS tg_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS tg_connections(botId TEXT PRIMARY KEY,version INTEGER NOT NULL,enabled INTEGER NOT NULL,ownerId TEXT,chatId TEXT,conversationId TEXT NOT NULL,offset INTEGER,lastPoll INTEGER,nextDraft INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS tg_pairs(hash TEXT PRIMARY KEY,botId TEXT NOT NULL,expiresAt INTEGER NOT NULL,candidateUser TEXT,candidateChat TEXT);
        CREATE TABLE IF NOT EXISTS tg_inbox(requestId TEXT PRIMARY KEY,botId TEXT NOT NULL,updateId INTEGER NOT NULL,kind TEXT NOT NULL,origin TEXT NOT NULL,body TEXT,state TEXT NOT NULL,createdAt INTEGER NOT NULL,UNIQUE(botId,updateId));
        CREATE TABLE IF NOT EXISTS tg_routes(requestId TEXT PRIMARY KEY,origin TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tg_acceptances(requestId TEXT PRIMARY KEY,botId TEXT NOT NULL,updateId INTEGER NOT NULL,origin TEXT NOT NULL,replyId TEXT NOT NULL,inputHash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tg_outbox(id TEXT PRIMARY KEY,botId TEXT NOT NULL,origin TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT,hash TEXT NOT NULL,state TEXT NOT NULL,nextAt INTEGER NOT NULL,messageId INTEGER);
        CREATE TABLE IF NOT EXISTS tg_drafts(generationId TEXT PRIMARY KEY,botId TEXT NOT NULL,draftId INTEGER NOT NULL,origin TEXT NOT NULL,generation TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,UNIQUE(botId,draftId));
        CREATE TABLE IF NOT EXISTS tg_interactions(id TEXT PRIMARY KEY,origin TEXT NOT NULL,runId TEXT NOT NULL,expiresAt INTEGER NOT NULL,messageId INTEGER,state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tg_buttons(hash TEXT PRIMARY KEY,interactionId TEXT NOT NULL,text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tg_answers(requestId TEXT PRIMARY KEY,interactionId TEXT NOT NULL,origin TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS tg_inbox_pending ON tg_inbox(botId,state,updateId);
        CREATE INDEX IF NOT EXISTS tg_outbox_pending ON tg_outbox(botId,state,nextAt);`);
      const schema = db.prepare("SELECT version FROM tg_schema").get() as { version: number } | undefined;
      if (schema && schema.version !== 1) throw new Error("telegram_schema_incompatible");
      const columns = db.prepare("PRAGMA table_info(tg_connections)").all() as { name: string }[];
      if (!columns.some(column => column.name === "lastUpdate")) db.exec("ALTER TABLE tg_connections ADD COLUMN lastUpdate INTEGER");
      const outboxColumns = db.prepare("PRAGMA table_info(tg_outbox)").all() as { name: string }[];
      if (!outboxColumns.some(column => column.name === "groupId")) {
        db.exec("ALTER TABLE tg_outbox ADD COLUMN groupId TEXT NOT NULL DEFAULT ''; UPDATE tg_outbox SET groupId=id WHERE groupId=''");
      }
      if (!schema) db.prepare("INSERT INTO tg_schema VALUES(1)").run();
    });
  }
  atomic<T>(fn: () => T): T {
    const name = "tg_" + ++this.#savepoint;
    this.db.exec("SAVEPOINT " + name);
    try { const value = fn(); this.db.exec("RELEASE " + name); return value; }
    catch (error) { this.db.exec("ROLLBACK TO " + name); this.db.exec("RELEASE " + name); throw error; }
  }
  connection(botId: string): TelegramBinding | undefined {
    return this.db.prepare("SELECT * FROM tg_connections WHERE botId=?").get(botId) as TelegramBinding | undefined;
  }
  configure(botId: string, conversationId: string) {
    if (!id(botId) || !conversationId) throw new Error("telegram_invalid_connection");
    const existing = this.connection(botId);
    if (existing && existing.conversationId !== conversationId) throw new Error("telegram_conversation_mismatch");
    this.db.prepare("INSERT OR IGNORE INTO tg_connections(botId,version,enabled,ownerId,chatId,conversationId,offset,lastPoll,nextDraft) VALUES(?,1,0,NULL,NULL,?,NULL,NULL,1)").run(botId, conversationId);
  }
  enabled(botId: string, enabled: boolean) {
    this.db.prepare("UPDATE tg_connections SET enabled=? WHERE botId=?").run(Number(enabled), botId);
  }
  unbind(botId: string) {
    this.atomic(() => {
      this.db.prepare("UPDATE tg_connections SET ownerId=NULL,chatId=NULL,enabled=0,version=version+1 WHERE botId=?").run(botId);
      this.db.prepare("DELETE FROM tg_pairs WHERE botId=?").run(botId);
      this.db.prepare("UPDATE tg_drafts SET state='closed' WHERE botId=?").run(botId);
      this.db.prepare("UPDATE tg_outbox SET state='held' WHERE botId=? AND state='pending'").run(botId);
      this.db.prepare("UPDATE tg_inbox SET state='rejected',body=NULL WHERE botId=? AND state IN ('queued','held')").run(botId);
    });
  }
  pairing(botId: string, now = Date.now()) {
    const connection = this.connection(botId);
    if (!connection || connection.ownerId) throw new Error("telegram_pairing_unavailable");
    const code = randomBytes(16).toString("hex");
    this.atomic(() => {
      this.db.prepare("DELETE FROM tg_pairs WHERE botId=?").run(botId);
      this.db.prepare("INSERT INTO tg_pairs VALUES(?,?,?,NULL,NULL)").run(digest(code), botId, now + 600_000);
    });
    return code; // Display only in trusted local UI. Never a diagnostic event.
  }
  proposePair(botId: string, code: string, userId: string, chatId: string, now = Date.now()) {
    if (!id(userId) || !id(chatId)) return false;
    const result = this.db.prepare("UPDATE tg_pairs SET candidateUser=?,candidateChat=? WHERE hash=? AND botId=? AND expiresAt>? AND (candidateUser IS NULL OR (candidateUser=? AND candidateChat=?))")
      .run(userId, chatId, digest(code), botId, now, userId, chatId);
    return result.changes === 1;
  }
  pairCandidate(botId: string, code: string, now = Date.now()) {
    const row = this.db.prepare("SELECT candidateUser,candidateChat FROM tg_pairs WHERE hash=? AND botId=? AND expiresAt>?").get(digest(code), botId, now) as { candidateUser: string | null; candidateChat: string | null } | undefined;
    if (!row) throw new Error("telegram_pairing_expired");
    return row.candidateUser && row.candidateChat ? { userId: row.candidateUser, chatId: row.candidateChat } : null;
  }
  // Trusted local approval must display and echo the exact candidate IDs.
  approvePair(botId: string, code: string, userId: string, chatId: string, now = Date.now()) {
    this.atomic(() => {
      const pair = this.db.prepare("SELECT * FROM tg_pairs WHERE hash=? AND botId=? AND expiresAt>?").get(digest(code), botId, now) as Pair | undefined;
      if (!pair || pair.candidateUser !== userId || pair.candidateChat !== chatId) throw new Error("telegram_pairing_mismatch");
      const changed = this.db.prepare("UPDATE tg_connections SET ownerId=?,chatId=?,version=version+1 WHERE botId=? AND ownerId IS NULL").run(userId, chatId, botId);
      if (changed.changes !== 1) throw new Error("telegram_already_bound");
      this.db.prepare("DELETE FROM tg_pairs WHERE botId=?").run(botId);
    });
  }
  trusted(origin: TelegramOrigin) {
    return this.connection(origin.botId)?.enabled === 1 && this.matches(origin);
  }
  matches(origin: TelegramOrigin) {
    const c = this.connection(origin.botId);
    return !!c && c.version === origin.bindingVersion && c.ownerId === origin.userId && c.chatId === origin.chatId;
  }
  route(requestId: string): TelegramOrigin | undefined {
    const row = this.db.prepare("SELECT origin FROM tg_routes WHERE requestId=?").get(requestId) as { origin: string } | undefined;
    return row ? JSON.parse(row.origin) as TelegramOrigin : undefined;
  }
  // Called synchronously ONLY inside Homer.submitMessage's acceptance transaction.
  // No network, nested transaction or independently committed receipt here.
  persistAcceptance(input: { requestId: string; text: string; origin: TelegramOrigin; interactionId?: string }, receipt: { fresh: boolean; replyId: string }) {
    const { requestId, origin } = input;
    if (!this.trusted(origin)) throw new Error("telegram_route_revoked");
    const row = this.db.prepare("SELECT * FROM tg_inbox WHERE requestId=?").get(requestId) as TelegramInbox | undefined;
    const serialized = JSON.stringify(origin);
    if (!row || row.kind === "stop" || row.botId !== origin.botId || requestId !== `tg:${row.botId}:${row.updateId}` || row.origin !== serialized ||
      JSON.stringify(this.route(requestId)) !== serialized) throw new Error("telegram_inbox_origin_mismatch");
    const inputHash = digest(JSON.stringify([input.text, input.interactionId ?? null]));
    const previous = this.db.prepare("SELECT * FROM tg_acceptances WHERE requestId=?").get(requestId) as { botId: string; updateId: number; origin: string; replyId: string; inputHash: string } | undefined;
    if (!receipt.fresh) {
      // A pre-existing route alone cannot claim a canonical input from another producer.
      if (!previous || previous.botId !== row.botId || previous.updateId !== row.updateId || previous.origin !== serialized || previous.replyId !== receipt.replyId || previous.inputHash !== inputHash)
        throw new Error("telegram_acceptance_missing_or_conflicting");
      return;
    }
    if (previous || !row.body || !["queued", "dispatching"].includes(row.state)) throw new Error("telegram_inbox_not_dispatchable");
    if (input.interactionId) {
      const answer = this.db.prepare("SELECT * FROM tg_answers WHERE requestId=?").get(requestId) as TelegramAnswer | undefined;
      if (!answer || answer.state !== "pending" || answer.interactionId !== input.interactionId || answer.origin !== serialized || answer.text !== input.text)
        throw new Error("telegram_answer_mismatch");
      this.answerState(requestId, "accepted");
    } else if (row.kind !== "input" || (JSON.parse(row.body) as { text?: string }).text !== input.text || this.db.prepare("SELECT 1 FROM tg_answers WHERE requestId=?").get(requestId)) {
      throw new Error("telegram_input_mismatch");
    }
    this.db.prepare("INSERT INTO tg_acceptances VALUES(?,?,?,?,?,?)").run(requestId, row.botId, row.updateId, serialized, receipt.replyId, inputHash);
    this.inboxState(requestId, "accepted");
  }
  ingest(botId: string, updates: TelegramUpdate[], now = Date.now()) {
    // Inbox + checkpoint are one commit. Only a subsequent getUpdates(offset) confirms server delivery.
    return this.atomic(() => {
      const c = this.connection(botId);
      if (!c || !c.enabled) throw new Error("telegram_disabled");
      const idle = c.lastUpdate === null || now - c.lastUpdate >= 7 * 86400_000;
      let offset = idle ? 0 : c.offset ?? 0;
      for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
        if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) throw new Error("telegram_invalid_update");
        offset = Math.max(offset, update.update_id + 1);
        const m = update.message, cb = update.callback_query, stop = update.stopped_message_generation;
        if (m && !c.ownerId && m.chat.type === "private" && !m.message_thread_id && m.from && !m.from.is_bot && /^\/start [a-f0-9]{32}$/.test(m.text ?? "")) {
          this.proposePair(botId, m.text!.slice(7), telegramId(m.from.id), telegramId(m.chat.id), now);
          continue;
        }
        const chat = m?.chat ?? cb?.message?.chat ?? stop?.chat;
        if (!chat || chat.type !== "private" || !c.chatId || String(chat.id) !== c.chatId) continue;
        if (m?.message_thread_id || cb?.message?.message_thread_id || stop?.message_thread_id) continue;
        const user = m?.from ?? cb?.from;
        if (!stop && (!user || user.is_bot || String(user.id) !== c.ownerId)) continue;
        if (stop && (!Number.isInteger(stop.draft_id) || stop.draft_id <= 0)) continue;
        if (m && (typeof m.text !== "string" || !m.text.trim() || m.text.length > 16000)) continue;
        if (cb && (typeof cb.data !== "string" || Buffer.byteLength(cb.data) > 64 || !cb.message)) continue;
        const origin: TelegramOrigin = { channel: "telegram", botId, chatId: c.chatId, userId: c.ownerId!, bindingVersion: c.version, messageId: m?.message_id ?? cb?.message?.message_id ?? 0 };
        const requestId = `tg:${botId}:${update.update_id}`;
        const kind = stop ? "stop" : cb ? "callback" : "input";
        const body = stop ? { draftId: stop.draft_id } : cb ? { id: cb.id, data: cb.data } : { text: m!.text, replyId: m!.reply_to_message?.message_id };
        const state = m && now - m.date * 1000 > 3_600_000 ? "held" : "queued";
        this.db.prepare("INSERT OR IGNORE INTO tg_inbox VALUES(?,?,?,?,?,?,?,?)").run(requestId, botId, update.update_id, kind, JSON.stringify(origin), JSON.stringify(body), state, now);
        this.db.prepare("INSERT OR IGNORE INTO tg_routes VALUES(?,?)").run(requestId, JSON.stringify(origin));
      }
      this.db.prepare("UPDATE tg_connections SET offset=?,lastPoll=?,lastUpdate=CASE WHEN ? THEN ? ELSE lastUpdate END WHERE botId=?").run(offset, now, Number(updates.length > 0), now, botId);
      return offset;
    });
  }
  inbox(botId: string) {
    return this.db.prepare("SELECT * FROM tg_inbox WHERE botId=? AND state='queued' ORDER BY updateId").all(botId) as TelegramInbox[];
  }
  inboxState(requestId: string, state: "dispatching" | "accepted" | "uncertain" | "rejected") {
    this.db.prepare("UPDATE tg_inbox SET state=?,body=CASE WHEN ? IN ('accepted','rejected') THEN NULL ELSE body END WHERE requestId=?").run(state, state, requestId);
  }
  releaseHeld(requestId: string) {
    this.db.prepare("UPDATE tg_inbox SET state='queued' WHERE requestId=? AND state='held'").run(requestId);
  }
  enqueue(id: string, origin: TelegramOrigin, kind: TelegramOutbox["kind"], payload: unknown, now = Date.now(), groupId = id) {
    if (!this.matches(origin)) throw new Error("telegram_route_revoked");
    const serialized = JSON.stringify(payload), hash = digest(serialized);
    const existing = this.db.prepare("SELECT hash FROM tg_outbox WHERE id=?").get(id) as { hash: string } | undefined;
    if (existing && existing.hash !== hash) throw new Error("telegram_delivery_conflict");
    this.db.prepare("INSERT OR IGNORE INTO tg_outbox(id,botId,origin,kind,payload,hash,state,nextAt,messageId,groupId) VALUES(?,?,?,?,?,?, 'pending',?,NULL,?)").run(id, origin.botId, JSON.stringify(origin), kind, serialized, hash, now, groupId);
  }
  outbox(botId: string, now = Date.now()) {
    return this.db.prepare("SELECT o.* FROM tg_outbox o WHERE o.botId=? AND o.state='pending' AND o.nextAt<=? AND NOT EXISTS(SELECT 1 FROM tg_outbox blocked WHERE blocked.botId=o.botId AND blocked.groupId=o.groupId AND blocked.state='uncertain') ORDER BY o.rowid").all(botId, now) as TelegramOutbox[];
  }
  outboxState(id: string, state: "sending" | "sent" | "uncertain" | "failed" | "held" | "pending", messageId?: number, nextAt = 0) {
    this.db.prepare("UPDATE tg_outbox SET state=?,messageId=COALESCE(?,messageId),nextAt=?,payload=CASE WHEN ?='sent' THEN NULL ELSE payload END WHERE id=?")
      .run(state, messageId ?? null, nextAt, state, id);
  }
  draft(generationId: string) {
    return this.db.prepare("SELECT * FROM tg_drafts WHERE generationId=?").get(generationId) as TelegramDraft | undefined;
  }
  createDraft(generation: MainGeneration, origin: TelegramOrigin, mode: "rich" | "plain") {
    return this.atomic(() => {
      if (!this.matches(origin)) throw new Error("telegram_route_revoked");
      const existing = this.draft(generation.id);
      if (existing) return existing;
      const active = this.db.prepare("SELECT generationId FROM tg_drafts WHERE botId=? AND state IN ('active','stop_requested')").get(origin.botId);
      if (active) throw new Error("telegram_generation_overlap");
      const c = this.connection(origin.botId)!;
      if (c.nextDraft > 2_147_483_647) throw new Error("telegram_draft_id_exhausted");
      this.db.prepare("UPDATE tg_connections SET nextDraft=nextDraft+1 WHERE botId=?").run(origin.botId);
      this.db.prepare("INSERT INTO tg_drafts VALUES(?,?,?,?,?,?,'active')").run(generation.id, origin.botId, c.nextDraft, JSON.stringify(origin), JSON.stringify(generation), mode);
      return this.draft(generation.id)!;
    });
  }
  requestStop(origin: TelegramOrigin, draftId: number) {
    return this.atomic(() => {
      if (!this.trusted(origin)) return undefined;
      const row = this.db.prepare("SELECT * FROM tg_drafts WHERE botId=? AND draftId=? AND state='active'").get(origin.botId, draftId) as TelegramDraft | undefined;
      if (!row) return undefined;
      const saved = JSON.parse(row.origin) as TelegramOrigin;
      if (saved.chatId !== origin.chatId || saved.bindingVersion !== origin.bindingVersion) return undefined;
      this.db.prepare("UPDATE tg_drafts SET state='stop_requested' WHERE generationId=? AND state='active'").run(row.generationId);
      return JSON.parse(row.generation) as MainGeneration;
    });
  }
  closeDraft(generationId: string) { this.db.prepare("UPDATE tg_drafts SET state='closed' WHERE generationId=?").run(generationId); }
  interaction(id: string, origin: TelegramOrigin, runId: string, expiresAt: number, options: { label: string; text: string }[]) {
    return this.atomic(() => {
      const existing = this.db.prepare("SELECT id FROM tg_interactions WHERE id=?").get(id);
      if (existing) return undefined;
      this.db.prepare("INSERT INTO tg_interactions VALUES(?,?,?,?,NULL,'pending')").run(id, JSON.stringify(origin), runId, expiresAt);
      return options.map(option => {
        const handle = randomBytes(18).toString("base64url");
        this.db.prepare("INSERT INTO tg_buttons VALUES(?,?,?)").run(digest(handle), id, option.text);
        return { text: option.label.slice(0, 80), callback_data: handle };
      });
    });
  }
  interactionSent(id: string, messageId: number) { this.db.prepare("UPDATE tg_interactions SET messageId=? WHERE id=?").run(messageId, id); }
  pendingInteractions(origin: TelegramOrigin, now = Date.now()) {
    return (this.db.prepare("SELECT id,origin,messageId FROM tg_interactions WHERE state='pending' AND expiresAt>?").all(now) as { id: string; origin: string; messageId: number | null }[])
      .filter(row => { const target = JSON.parse(row.origin) as TelegramOrigin; return target.botId === origin.botId && target.chatId === origin.chatId && target.bindingVersion === origin.bindingVersion; });
  }
  knownInteraction(origin: TelegramOrigin, messageId: number) {
    return (this.db.prepare("SELECT origin FROM tg_interactions WHERE messageId=?").all(messageId) as { origin: string }[])
      .some(row => { const target = JSON.parse(row.origin) as TelegramOrigin; return target.botId === origin.botId && target.chatId === origin.chatId && target.bindingVersion === origin.bindingVersion; });
  }
  answer(requestId: string, origin: TelegramOrigin, value: { handle: string } | { replyId: number; text: string }, now = Date.now()) {
    return this.atomic(() => {
      if (!this.trusted(origin)) return undefined;
      let found: { id: string; origin: string; expiresAt: number; state: string; messageId: number | null; text?: string } | undefined;
      if ("handle" in value) found = this.db.prepare("SELECT i.*,b.text FROM tg_interactions i JOIN tg_buttons b ON b.interactionId=i.id WHERE b.hash=?").get(digest(value.handle)) as typeof found;
      else found = this.db.prepare("SELECT * FROM tg_interactions WHERE messageId=? AND state='pending'").get(value.replyId) as typeof found;
      if (!found || found.state !== "pending" || found.expiresAt <= now || found.messageId === null) return undefined;
      const target = JSON.parse(found.origin) as TelegramOrigin;
      if (target.botId !== origin.botId || target.chatId !== origin.chatId || target.userId !== origin.userId || target.bindingVersion !== origin.bindingVersion) return undefined;
      if ("handle" in value && found.messageId !== origin.messageId) return undefined;
      const text = "handle" in value ? found.text! : value.text;
      this.db.prepare("UPDATE tg_interactions SET state='answered' WHERE id=? AND state='pending'").run(found.id);
      this.db.prepare("INSERT INTO tg_answers VALUES(?,?,?,?,'pending')").run(requestId, found.id, JSON.stringify(origin), text);
      return { interactionId: found.id, text };
    });
  }
  pendingAnswers() { return this.db.prepare("SELECT * FROM tg_answers WHERE state='pending' ORDER BY rowid").all() as TelegramAnswer[]; }
  answerState(requestId: string, state: "accepted" | "uncertain" | "rejected") {
    this.db.prepare("UPDATE tg_answers SET state=?,text=CASE WHEN ?='accepted' THEN '' ELSE text END WHERE requestId=?").run(state, state, requestId);
  }
  reconcile(botId: string) {
    this.atomic(() => {
      this.db.prepare("UPDATE tg_outbox SET state='uncertain' WHERE botId=? AND state='sending'").run(botId);
      this.db.prepare("UPDATE tg_inbox SET state='uncertain' WHERE botId=? AND state='dispatching'").run(botId);
      this.db.prepare("UPDATE tg_drafts SET state='closed' WHERE botId=?").run(botId);
    });
  }
}
