import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { InteractionDecision } from "./worker-interaction-protocol.js";

export type InteractionInput = {
  runId: string;
  threadId: string;
  turnId: string;
  requestId: string | number;
  source: "native" | "ask_main";
  kind: "authorization" | "question";
  details: Record<string, unknown>;
  runEpoch?:number;taskVersion?:number;
  // Captured by the host from the authorized task, never taken from Worker arguments.
  authority: { description: string; sourceRequestId: string; nativeApprovals: boolean };
};
export type InteractionState = "pending_main" | "pending_user" | "approved" | "denied" | "answered" | "cancelled" | "expired";
export type InteractionResolution = {
  status: "approved" | "denied" | "answered" | "cancelled" | "expired";
  decision?: InteractionDecision;
  code?: string;
};
export type InteractionRecord = InteractionInput & {
  id: string;
  state: InteractionState;
  waitingFor: "main" | "user" | null;
  userQuestion: string | null;
  escalationReason: string | null;
  decision: InteractionDecision | null;
  responseUserMessageId: string | null;
  responseUserText: string | null;
  deliveredAt: number | null;
  code: string | null;
  createdAt: number;
  updatedAt: number;
};
type Row = Omit<InteractionRecord, "details" | "authority" | "decision" | "waitingFor" | "requestId"> & {
  requestId: string; details: string; authority: string; decision: string | null; identity: string; fingerprint: string;
};
type Live = {
  response: Promise<InteractionResolution>;
  resolve: (value: InteractionResolution) => void;
  isCurrent: () => boolean;
  validate?: (decision: InteractionDecision) => void;
};
type Hooks = {
  // Queue a main turn; this callback MUST NOT await the Worker's response.
  ready?: (id: string) => void;
  persisted?: (id:string)=>void;
  // Pause/resume the run's active execution clock on first/last pending interaction.
  waiting?: (runId: string, waiting: boolean) => void;
};
const pending = (state: InteractionState) => state === "pending_main" || state === "pending_user";
const text = (value: unknown, max: number) => typeof value === "string" && !!value.trim() && value.length <= max;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// This table stores decision-making business data. It is deliberately separate
// from Store.events and has no logger, console output, or diagnostic payload hook.
export class WorkerInteractions {
  private live = new Map<string, Live>();
  constructor(readonly db: DatabaseSync, private hooks: Hooks = {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS worker_interactions(
      id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
      runId TEXT NOT NULL, threadId TEXT NOT NULL, turnId TEXT NOT NULL, requestId TEXT NOT NULL,
      source TEXT NOT NULL, kind TEXT NOT NULL, details TEXT NOT NULL, authority TEXT NOT NULL,
      state TEXT NOT NULL, userQuestion TEXT, escalationReason TEXT, decision TEXT,
      responseUserMessageId TEXT, responseUserText TEXT, runEpoch INTEGER, taskVersion INTEGER,
      deliveredAt INTEGER, code TEXT,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS worker_interactions_run ON worker_interactions(runId,state);`);
  }
  private row(id: string): Row {
    const row = this.db.prepare("SELECT * FROM worker_interactions WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new Error("interaction_not_found");
    return row;
  }
  inspect(id: string): InteractionRecord {
    const { identity: _identity, fingerprint: _fingerprint, ...row } = this.row(id);
    return {
      ...row, requestId: JSON.parse(row.requestId), details: JSON.parse(row.details),
      authority: JSON.parse(row.authority), decision: row.decision ? JSON.parse(row.decision) : null,
      waitingFor: row.state === "pending_main" || row.state === "pending_user" && row.responseUserMessageId ? "main" : row.state === "pending_user" ? "user" : null,
    };
  }
  list(runId?: string|readonly string[]) {
    const rows = (Array.isArray(runId)
      ? this.db.prepare("SELECT id FROM worker_interactions WHERE runId IN (SELECT value FROM json_each(?)) ORDER BY rowid").all(JSON.stringify(runId))
      : typeof runId==='string'
      ? this.db.prepare("SELECT id FROM worker_interactions WHERE runId=? ORDER BY rowid").all(runId)
      : this.db.prepare("SELECT id FROM worker_interactions ORDER BY rowid").all()) as { id: string }[];
    // Full question/operation text is only exposed through explicit inspection.
    return rows.map(({ id }) => {
      const { details: _details, authority: _authority, decision: _decision, userQuestion: _question, escalationReason: _reason, responseUserText: _userText, ...summary } = this.inspect(id);
      return summary;
    });
  }
  hasPending(runId: string) {
    return !!this.db.prepare("SELECT 1 FROM worker_interactions WHERE runId=? AND state IN ('pending_main','pending_user') LIMIT 1").get(runId);
  }
  pendingForMain(historyThreadId:string){
    // Worker threadId is not the main conversation. Follow captured user source.
    const scope="FROM worker_interactions w JOIN conversation_inputs c ON c.requestId=json_extract(w.authority,'$.sourceRequestId') WHERE c.threadId=? AND w.state='pending_user' AND w.kind='question' AND w.runId NOT LIKE 'main-native:%'";
    const total=Number(this.db.prepare('SELECT count(*) total '+scope).get(historyThreadId)!.total);
    const items=this.db.prepare("SELECT w.id interactionId,w.runId,substr(w.userQuestion,1,300) question "+scope+' ORDER BY w.rowid LIMIT 16').all(historyThreadId);
    return {total,items};
  }
  open(input: InteractionInput, isCurrent: () => boolean, validate?: (decision: InteractionDecision) => void): { id: string; response: Promise<InteractionResolution> } {
    if((input.runEpoch!==undefined||input.taskVersion!==undefined)&&(!Number.isSafeInteger(input.runEpoch)||!Number.isSafeInteger(input.taskVersion)))throw Error('interaction_invalid_request');
    for (const value of [input.runId, input.threadId, input.turnId])
      if (!text(value, 200)) throw new Error("interaction_invalid_request");
    if ((typeof input.requestId !== "number" || !Number.isSafeInteger(input.requestId)) && !text(input.requestId, 200)) throw new Error("interaction_invalid_request");
    if (!["native", "ask_main"].includes(input.source) || !["authorization", "question"].includes(input.kind) ||
      !input.details || typeof input.details !== "object" || Array.isArray(input.details) ||
      !text(input.authority?.description, 24000) || !text(input.authority?.sourceRequestId, 200) || typeof input.authority?.nativeApprovals !== "boolean" ||
      JSON.stringify(input).length > 160 * 1024) throw new Error("interaction_invalid_request");
    if (input.source === "ask_main" && (input.kind !== "question" || !text(input.details.question, 16000))) throw new Error("interaction_invalid_request");
    if (!isCurrent()) throw new Error("interaction_not_live");
    const identity = digest([input.runId, input.threadId, input.turnId, input.source, input.requestId]);
    const fingerprint = digest(input);
    const prior = this.db.prepare("SELECT id,fingerprint FROM worker_interactions WHERE identity=?").get(identity) as { id: string; fingerprint: string } | undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("interaction_request_conflict");
      const live = this.live.get(prior.id);
      if (!live || !pending(this.row(prior.id).state) || !live.isCurrent()) throw new Error("interaction_not_live");
      return { id: prior.id, response: live.response };
    }
    const id = randomUUID(), now = Date.now(), wasWaiting = this.hasPending(input.runId);
    this.db.exec('SAVEPOINT worker_interaction_open');
    try{
    this.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,runEpoch,taskVersion,state,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_main',?,?)`).run(
      id, identity, fingerprint, input.runId, input.threadId, input.turnId, JSON.stringify(input.requestId), input.source, input.kind,
      JSON.stringify(input.details), JSON.stringify(input.authority), input.runEpoch ?? null, input.taskVersion ?? null, now, now,
    );
      this.hooks.persisted?.(id);
      this.db.exec('RELEASE worker_interaction_open');
    }catch(error){this.db.exec('ROLLBACK TO worker_interaction_open; RELEASE worker_interaction_open');throw error;}
    let resolve!: Live["resolve"];
    const response = new Promise<InteractionResolution>(done => { resolve = done; });
    this.live.set(id, { response, resolve, isCurrent, validate });
    if (!wasWaiting) this.hooks.waiting?.(input.runId, true);
    this.hooks.ready?.(id);
    return { id, response };
  }
  private current(id: string): Live {
    const row = this.row(id), live = this.live.get(id);
    if (!live || !live.isCurrent() || (row.state === "cancelled" && row.code !== "interaction_user_cancelled") || row.state === "expired") {
      if (pending(row.state) || (row.deliveredAt === null && ["approved", "answered", "denied", "cancelled"].includes(row.state)))
        this.invalidate(id, "expired", "worker_not_live");
      throw new Error("interaction_not_live");
    }
    return live;
  }
  escalate(id: string, question: string, reason: string) {
    this.current(id);
    if (!text(question, 4000) || !text(reason, 2000)) throw new Error("interaction_escalation_required");
    const row = this.row(id);
    if (row.state === "pending_user") {
      if (row.userQuestion === question && row.escalationReason === reason) return { duplicate: true };
      throw new Error("interaction_already_escalated");
    }
    if (row.state !== "pending_main") throw new Error("interaction_already_resolved");
    this.db.prepare("UPDATE worker_interactions SET state='pending_user',userQuestion=?,escalationReason=?,updatedAt=? WHERE id=?")
      .run(question, reason, Date.now(), id);
    return { duplicate: false };
  }
  private prepareResponse(id: string, decision: InteractionDecision, context: { userMessageId?: string; userText?: string } = {}) {
    const live = this.current(id), row = this.row(id);
    if (!text(decision.reason, 2000)) throw new Error("interaction_reason_required");
    const details = JSON.parse(row.details);
    const canCancel = row.source === "native" && details.method === "mcpServer/elicitation/request" && details.params?._meta?.codex_approval_kind === "mcp_tool_call";
    if (row.kind === "question" ? !["answer", "deny"].includes(decision.action) : !["approve", "deny", ...(canCancel ? ["cancel"] : [])].includes(decision.action))
      throw new Error("interaction_response_kind");
    if (decision.action === "answer" && row.source === "ask_main" && !text(decision.answer, 16000)) throw new Error("interaction_answer_required");
    if (decision.action === "answer" && row.source === "native" && (!decision.answers || !Object.keys(decision.answers).length)) throw new Error("interaction_answer_required");
    if (decision.action === "approve" && !JSON.parse(row.authority).nativeApprovals) throw new Error("interaction_capability_denied");
    if (details.review && row.userQuestion !== null && (decision.action === 'approve' || decision.action === 'cancel')) {
      const expected = decision.action === 'approve' ? '允许本次操作' : '取消本次请求';
      if (!row.responseUserMessageId || row.responseUserMessageId !== context.userMessageId || row.responseUserText !== expected)
        throw Error('interaction_user_decision_required');
    }
    const serialized = JSON.stringify(decision);
    if (serialized.length > 64000) throw new Error("interaction_invalid_response");
    if (!pending(row.state)) {
      if (row.decision === serialized && row.responseUserMessageId === (context.userMessageId ?? null)) return { duplicate: true, live, row, serialized };
      throw new Error("interaction_already_resolved");
    }
    // Only the host's actual user-message context supplies this association.
    if (row.state === "pending_user" && decision.action !== "deny" && !text(context.userMessageId, 200)) throw new Error("interaction_user_reply_required");
    live.validate?.(decision);
    return { duplicate: false, live, row, serialized };
  }
  validateResponse(id: string, decision: InteractionDecision, context: { userMessageId?: string; userText?: string } = {}) {
    this.prepareResponse(id, decision, context);
  }
  // Called within the conversation acceptance transaction. Save the user's
  // decision without releasing the Worker's callback.
  recordUserDecision(id:string, decision:InteractionDecision, requestId:string, userText:string) {
    this.current(id);
    const row=this.row(id);
    if (row.state !== 'pending_user' || row.responseUserMessageId) throw Error('interaction_already_resolved');
    this.db.prepare('UPDATE worker_interactions SET responseUserMessageId=?,responseUserText=?,updatedAt=? WHERE id=?').run(requestId,userText,Date.now(),id);
    this.validateResponse(id,decision,{userMessageId:requestId,userText});
  }
  respond(id: string, decision: InteractionDecision, context: { userMessageId?: string; userText?: string } = {}) {
    const { duplicate, live, row, serialized } = this.prepareResponse(id, decision, context);
    if (duplicate) return { duplicate: true };
    const state = decision.action === "approve" ? "approved" : decision.action === "deny" ? "denied" : decision.action === "cancel" ? "cancelled" : "answered";
    this.db.prepare("UPDATE worker_interactions SET state=?,decision=?,responseUserMessageId=?,responseUserText=?,code=?,updatedAt=? WHERE id=?")
      .run(state, serialized, row.responseUserMessageId ?? context.userMessageId ?? null, row.responseUserText ?? context.userText ?? null, decision.action === "cancel" ? "interaction_user_cancelled" : null, Date.now(), id);
    live.resolve({ status: state, decision: JSON.parse(serialized) });
    if (!this.hasPending(row.runId)) this.hooks.waiting?.(row.runId, false);
    return { duplicate: false };
  }
  markDelivered(id: string) {
    this.current(id);
    const row = this.row(id);
    if (pending(row.state)) throw new Error("interaction_not_resolved");
    if (row.deliveredAt === null)
      this.db.prepare("UPDATE worker_interactions SET deliveredAt=?,updatedAt=? WHERE id=?").run(Date.now(), Date.now(), id);
  }
  hasDeliveredDecision(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM worker_interactions WHERE id=? AND state IN ('answered','approved','denied') AND deliveredAt IS NOT NULL").get(id);
  }
  private invalidate(id: string, state: "cancelled" | "expired", code: string) {
    const row = this.row(id);
    if ((row.state === "cancelled" && !(row.code === "interaction_user_cancelled" && row.deliveredAt === null)) || row.state === "expired") {
      const live = this.live.get(id); this.live.delete(id);
      live?.resolve({status:row.state,code:row.code ?? code});
      return !!live;
    }
    if (row.deliveredAt !== null) return false;
    this.db.prepare("UPDATE worker_interactions SET state=?,code=?,updatedAt=? WHERE id=?").run(state, code, Date.now(), id);
    const live = this.live.get(id);
    this.live.delete(id);
    live?.resolve({ status: state, code });
    if (pending(row.state) && !this.hasPending(row.runId)) this.hooks.waiting?.(row.runId, false);
    return true;
  }
  cancelRun(runId: string, code = "worker_stopped") {
    if (!/^[a-z][a-z0-9_]{1,70}$/.test(code)) throw new Error("interaction_invalid_code");
    for (const item of this.list(runId)) this.invalidate(item.id, "cancelled", code);
    // Delivered decisions remain history, but never remain live callback authority.
    for (const item of this.list(runId)) this.live.delete(item.id);
  }
  expire(id: string, code = "server_request_cleared") {
    if (!/^[a-z][a-z0-9_]{1,70}$/.test(code)) throw new Error("interaction_invalid_code");
    return this.invalidate(id, "expired", code);
  }
  reconcile() {
    let count = 0;
    for (const item of this.list())
      if (!this.live.has(item.id) && this.invalidate(item.id, "expired", "process_callback_lost")) count++;
    return count;
  }
}
