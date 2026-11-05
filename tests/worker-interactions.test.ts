import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { WorkerInteractions, type InteractionInput } from "../src/worker-interactions.js";

const input = (requestId: string | number, runId = "run-a", kind: "question" | "authorization" = "question"): InteractionInput => ({
  runId, threadId: "thread-" + runId, turnId: "turn-" + runId, requestId,
  source: kind === "question" ? "ask_main" : "native", kind,
  details: { question: "Which report format?", operation: "synthetic local check" },
  authority: { description: "Current authorized local report task", sourceRequestId: "user-task-1", nativeApprovals: true },
});
function setup() {
  const db = new DatabaseSync(":memory:");
  const notices: string[] = [], waiting: [string, boolean][] = [];
  const interactions = new WorkerInteractions(db, {
    ready: id => { notices.push(id); }, waiting: (runId, value) => { waiting.push([runId, value]); },
  });
  return { db, interactions, notices, waiting };
}

test("fresh interactions capture the Run epoch and task version in the initial insert", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const interactions = new WorkerInteractions(db, { persisted: id => {
      const row = db.prepare("SELECT runEpoch,taskVersion FROM worker_interactions WHERE id=?").get(id)!;
      assert.equal(row.runEpoch, 7);
      assert.equal(row.taskVersion, 3);
    } });
    const columns = (db.prepare("PRAGMA table_info(worker_interactions)").all() as { name: string }[]).map(column => column.name);
    for (const name of ["responseUserText", "runEpoch", "taskVersion"]) assert.ok(columns.includes(name));
    assert.equal(columns.includes("contractVersion"), false);
    db.exec(`CREATE TRIGGER captured_run_before_publish AFTER INSERT ON worker_interactions
      WHEN NEW.runEpoch IS NOT 7 OR NEW.taskVersion IS NOT 3
      BEGIN SELECT RAISE(ABORT,'interaction_missing_captured_run'); END`);
    const value = { ...input("captured-run"), runEpoch: 7, taskVersion: 3 };
    const request = interactions.open(value, () => true);
    assert.equal(interactions.inspect(request.id).runEpoch, 7);
    assert.equal(interactions.inspect(request.id).taskVersion, 3);
    assert.equal(interactions.open(value, () => true).response, request.response);
    for (const change of [{ runEpoch: 8 }, { taskVersion: 4 }])
      assert.throws(() => interactions.open({ ...value, ...change }, () => true), /interaction_request_conflict/);
  } finally { db.close(); }
});

test("captured Run versions require a safe integer pair and retain exact native identities", () => {
  const { db, interactions, notices } = setup();
  try {
    for (const version of [
      { runEpoch: 1 }, { taskVersion: 1 }, { runEpoch: 1, taskVersion: 1.5 },
      { runEpoch: NaN, taskVersion: 1 }, { runEpoch: 1, taskVersion: Number.MAX_SAFE_INTEGER + 1 },
    ]) assert.throws(() => interactions.open({ ...input("invalid-version"), ...version }, () => true), /interaction_invalid_request/);
    assert.equal(interactions.list().length, 0);
    assert.equal(notices.length, 0);
    const value = { ...input(1), runEpoch: 1, taskVersion: 2 };
    const variants = [value, { ...value, requestId: "1" }, { ...value, threadId: "other-thread" }, { ...value, turnId: "other-turn" }, { ...value, source: "native" as const }];
    const ids = variants.map(item => interactions.open(item, () => true).id);
    assert.equal(new Set(ids).size, variants.length);
  } finally { db.close(); }
});

test("HMR-INTERACTION-002: only the exact delivered decision permits silent completion", () => {
  const { db, interactions } = setup();
  try {
    const pending = interactions.open(input("pending"), () => true);
    assert.equal(interactions.hasDeliveredDecision(pending.id), false);
    for (const action of ["answer", "approve", "deny"] as const) {
      const request = interactions.open(input(action, "run-" + action, action === "answer" ? "question" : "authorization"), () => true);
      interactions.respond(request.id, { action, reason: "Synthetic valid decision", ...(action === "answer" ? { answer: "Markdown" } : {}) });
      assert.equal(interactions.hasDeliveredDecision(request.id), false);
      interactions.markDelivered(request.id);
      assert.equal(interactions.hasDeliveredDecision(request.id), true);
      assert.equal(interactions.hasDeliveredDecision(pending.id), false);
    }
    interactions.escalate(pending.id, "Synthetic user question", "Synthetic ambiguity");
    assert.equal(interactions.hasDeliveredDecision(pending.id), false);
    interactions.cancelRun("run-a");
    assert.equal(interactions.hasDeliveredDecision(pending.id), false);
    const expired = interactions.open(input("expired", "run-expired"), () => true);
    interactions.expire(expired.id);
    assert.equal(interactions.hasDeliveredDecision(expired.id), false);
    assert.equal(interactions.hasDeliveredDecision("missing"), false);
  } finally { db.close(); }
});

test('HMR-RECURSIVE-007: committed cancellation still releases the original live RPC exactly once',async()=>{
 const {db,interactions}=setup();try{
  const request=interactions.open(input('synthetic-stop-race'),()=>true);let resolutions=0;
  void request.response.then(()=>{resolutions++;});
  db.prepare("UPDATE worker_interactions SET state='cancelled',code='parent_unavailable' WHERE id=?").run(request.id);
  interactions.cancelRun('run-a','worker_stopped');await Promise.resolve();assert.equal(resolutions,1);
  assert.equal((await request.response).status,'cancelled');interactions.cancelRun('run-a');await Promise.resolve();assert.equal(resolutions,1);
  assert.throws(()=>interactions.respond(request.id,{action:'answer',answer:'Synthetic stale answer',reason:'Too late'}),/resolved|live|cancelled/);
 }finally{db.close();}
});

test("HMR-INTERACTION-001: main directly approves, denies or answers with separate decision semantics", async () => {
  const { db, interactions, notices, waiting } = setup();
  try {
    const question = interactions.open(input("question"), () => true);
    const approve = interactions.open(input("approve", "run-b", "authorization"), () => true);
    const deny = interactions.open(input("deny", "run-c", "authorization"), () => true);
    assert.equal(notices.length, 3);
    assert.equal(interactions.list().length, 3);
    assert.equal(JSON.stringify(interactions.list()).includes("Which report format"), false);
    assert.throws(() => interactions.respond(question.id, { action: "approve", reason: "not authorization" }), /interaction_response_kind/);
    interactions.respond(question.id, { action: "answer", answer: "Markdown", reason: "Requested in the task" });
    interactions.respond(approve.id, { action: "approve", reason: "Ordinary check inside the authorized task" });
    interactions.respond(deny.id, { action: "deny", reason: "Outside the current authority" });
    assert.equal((await question.response).decision?.answer, "Markdown");
    assert.equal((await approve.response).decision?.action, "approve");
    assert.equal((await deny.response).decision?.action, "deny");
    assert.equal(interactions.inspect(question.id).state, "answered");
    assert.equal(interactions.inspect(approve.id).state, "approved");
    assert.equal(interactions.inspect(deny.id).state, "denied");
    assert.equal(waiting.filter(([, value]) => !value).length, 3);
  } finally { db.close(); }
});

test("HMR-INTERACTION-001: escalation releases the main queue while the original Worker stays pending", async () => {
  const { db, interactions } = setup();
  try {
    const request = interactions.open(input("needs-user"), () => true);
    let workerResumed = false;
    void request.response.then(() => { workerResumed = true; });
    interactions.escalate(request.id, "Which of the two reports is intended?", "The task does not specify this");
    assert.equal(interactions.inspect(request.id).waitingFor, "user");
    await Promise.resolve();
    assert.equal(workerResumed, false);
    assert.throws(() => interactions.respond(request.id, { action: "answer", answer: "Invented answer", reason: "event is not new user authority" }), /interaction_user_reply_required/);
    interactions.respond(request.id, { action: "answer", answer: "Weekly report", reason: "User clarified the intended report" }, { userMessageId: "new-user-message", userText: "The weekly report, please" });
    assert.equal((await request.response).decision?.answer, "Weekly report");
    assert.equal(interactions.inspect(request.id).responseUserMessageId, "new-user-message");
    assert.equal(interactions.inspect(request.id).responseUserText, "The weekly report, please");
    assert.equal(JSON.stringify(interactions.list()).includes("The weekly report, please"), false);
  } finally { db.close(); }
});

test("HMR-INTERACTION-001: concurrent Workers and multiple questions route by full correlation", async () => {
  const { db, interactions, waiting } = setup();
  try {
    const a = interactions.open(input("same-rpc", "run-a"), () => true);
    const b = interactions.open(input("same-rpc", "run-b"), () => true);
    const a2 = interactions.open(input("second-rpc", "run-a"), () => true);
    assert.notEqual(a.id, b.id);
    interactions.respond(b.id, { action: "answer", answer: "B", reason: "B's goal" });
    interactions.respond(a2.id, { action: "answer", answer: "A2", reason: "A's second question" });
    assert.equal(waiting.filter(([run, value]) => run === "run-a" && !value).length, 0);
    interactions.respond(a.id, { action: "answer", answer: "A", reason: "A's goal" });
    assert.equal((await a.response).decision?.answer, "A");
    assert.equal((await b.response).decision?.answer, "B");
    assert.equal((await a2.response).decision?.answer, "A2");
    assert.equal(waiting.filter(([run, value]) => run === "run-a" && !value).length, 1);
  } finally { db.close(); }
});

test("HMR-INTERACTION-001: duplicates are idempotent, conflicting and stale responses cannot authorize", async () => {
  const { db, interactions } = setup();
  try {
    let live = true;
    const value = input("dedupe", "run-a", "authorization");
    const request = interactions.open(value, () => live);
    assert.equal(interactions.open(value, () => live).response, request.response);
    assert.throws(() => interactions.open({ ...value, details: { operation: "different" } }, () => live), /interaction_request_conflict/);
    const decision = { action: "approve" as const, reason: "Within task" };
    assert.equal(interactions.respond(request.id, decision).duplicate, false);
    assert.equal(interactions.respond(request.id, decision).duplicate, true);
    assert.throws(() => interactions.respond(request.id, { action: "deny", reason: "different decision" }), /interaction_already_resolved/);
    await request.response;
    const stopped = interactions.open(input("stopped", "run-b", "authorization"), () => live);
    live = false;
    assert.throws(() => interactions.respond(stopped.id, decision), /interaction_not_live/);
    assert.equal((await stopped.response).status, "expired");
    assert.equal(interactions.inspect(stopped.id).state, "expired");
  } finally { db.close(); }
});

test("HMR-INTERACTION-001: shutdown cancels waiting and decided-but-unsent approvals, never sent actions", async () => {
  const { db, interactions } = setup();
  try {
    const pending = interactions.open(input("pending"), () => true);
    const decided = interactions.open(input("decided", "run-a", "authorization"), () => true);
    const sent = interactions.open(input("sent", "run-a", "authorization"), () => true);
    const answer = { action: "approve" as const, reason: "Task bounded" };
    interactions.respond(decided.id, answer);
    interactions.respond(sent.id, answer);
    interactions.markDelivered(sent.id);
    interactions.cancelRun("run-a", "worker_stopped");
    assert.equal((await pending.response).status, "cancelled");
    assert.equal(interactions.inspect(decided.id).state, "cancelled");
    assert.equal(interactions.inspect(sent.id).state, "approved");
    assert.throws(() => interactions.markDelivered(decided.id), /interaction_not_live/);
    assert.throws(() => interactions.respond(pending.id, answer), /interaction_not_live/);
  } finally { db.close(); }
});

test("HMR-INTERACTION-001: restart preserves business history and expires unrecoverable process callbacks", async () => {
  const root = resolve(".codex/scratch/worker-interactions");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(root + "/restart-");
  let db = new DatabaseSync(dir + "/interactions.sqlite");
  try {
    const first = new WorkerInteractions(db);
    const pending = first.open(input("pending"), () => true);
    const decided = first.open(input("decided", "run-b", "authorization"), () => true);
    first.respond(decided.id, { action: "approve", reason: "Before disconnect" });
    db.close();
    db = new DatabaseSync(dir + "/interactions.sqlite");
    const second = new WorkerInteractions(db);
    assert.equal(second.reconcile(), 2);
    assert.equal(second.reconcile(), 0);
    assert.equal(second.inspect(pending.id).state, "expired");
    assert.equal(second.inspect(decided.id).state, "expired");
    assert.equal(second.inspect(decided.id).decision?.reason, "Before disconnect");
    assert.throws(() => second.respond(decided.id, { action: "approve", reason: "Before disconnect" }), /interaction_not_live/);
    assert.throws(() => second.open(input("pending"), () => true), /interaction_not_live/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("HMR-INTERACTION-001: model proposals cannot expand host capabilities or omit explicit decisions", async () => {
  const { db, interactions } = setup();
  try {
    const value = input("restricted", "run-a", "authorization");
    value.authority.nativeApprovals = false;
    const request = interactions.open(value, () => true);
    assert.throws(() => interactions.respond(request.id, { action: "approve", reason: "Model would like shell" }), /interaction_capability_denied/);
    interactions.respond(request.id, { action: "deny", reason: "Shell is outside this Worker's tool boundary" });
    assert.equal((await request.response).decision?.action, "deny");
    const q = interactions.open(input("empty"), () => true);
    assert.throws(() => interactions.respond(q.id, { action: "answer", reason: "no empty answers" }), /interaction_answer_required/);
    assert.throws(() => interactions.respond(q.id, { action: "answer", answer: "Markdown", reason: "" }), /interaction_reason_required/);
    interactions.cancelRun("run-a", "test_finished");
    await q.response;
  } finally { db.close(); }
});

test("HMR-INTERACTION-001: invalid native decisions do not settle or persist an approval", async () => {
  const { db, interactions } = setup();
  try {
    const request = interactions.open(input("invalid-permissions", "run-a", "authorization"), () => true, decision => {
      if (decision.action === "approve") throw new Error("interaction_permission_scope");
    });
    assert.throws(() => interactions.respond(request.id, { action: "approve", reason: "Bad subset" }), /interaction_permission_scope/);
    assert.equal(interactions.inspect(request.id).state, "pending_main");
    assert.equal(interactions.inspect(request.id).decision, null);
    interactions.respond(request.id, { action: "deny", reason: "Requested scope unavailable" });
    assert.equal((await request.response).status, "denied");
  } finally { db.close(); }
});
