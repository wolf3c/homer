import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import {syntheticFile} from './recursive-publication-fixture.js';
import { Store } from "../src/store.js";
import { Files } from "../src/files.js";
import { ConversationHistory, type ConversationInput } from "../src/web-history.js";
import { WorkerInteractions } from "../src/worker-interactions.js";
import { TelegramHomerBridge } from "../src/channels/telegram-homer-bridge.js";
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import type { MainGeneration } from "../src/channels/telegram-contract.js";
import {MainProcessHistory} from '../src/main-process.js';
import {mainQueueOutput} from './helpers/main-queue-output.js';

// Synthetic host-boundary tests using actual shared Store/History/Interactions.
// Main execution is a test double; this is not a real model or Worker resumption claim.
function fixture(t: { after(fn: () => unknown): void }) {
  mkdirSync(resolve(".codex/scratch/telegram-plan"), { recursive: true });
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/bridge-fixture-"));
  const store = new Store(":memory:"), files = new Files(join(root, "workspace"));
  store.setMeta("mainThread", "original-main");
  const history = new ConversationHistory(store.db), interactions = new WorkerInteractions(store.db),processes=new MainProcessHistory(store.db);
  const tasks=new RecursiveTasks(store,files);tasks.migrate();const inputs=new MainInputs(tasks,history);
  const submissions: ConversationInput[] = [], stops: string[] = [];
  let activeMessageId: string | null = null;
  const app: ConstructorParameters<typeof TelegramHomerBridge>[0] = {
    store, files, interactions,tasks,processes,
    submitMessage(input, acceptance) { const accepted=inputs.accept(input,acceptance);if(accepted.fresh){submissions.push(input);const queued=inputs.claim()!;inputs.started(queued.messageId,queued.revision,"synthetic:"+input.requestId,"turn:"+input.requestId);inputs.finish(queued.messageId,queued.revision,"completed");}return accepted; },
    conversationState() { return { threadId: "original-main", messages: history.list("original-main"), isRunning: !!activeMessageId, activeMessageId }; },
    async stopMain(id) { stops.push(id); return { requested: true as const }; },
  };
  const bridge = new TelegramHomerBridge(app);
  bridge.channel.store.configure("123456", "original-main"); bridge.channel.store.enabled("123456", true);
  const code = bridge.channel.store.pairing("123456");
  bridge.channel.store.proposePair("123456", code, "789123", "789123"); bridge.channel.store.approvePair("123456", code, "789123", "789123");
  bridge.channel.store.ingest("123456", [{ update_id: 10, message: { message_id: 30, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "合成请求" } }]);
  const origin = bridge.channel.store.route("tg:123456:10")!;
  t.after(async () => { await bridge.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { app, bridge, store, history, interactions,processes, submissions, stops, origin, active: (value: string | null) => { activeMessageId = value; } };
}
function liveWorker(f:ReturnType<typeof fixture>,sourceRequestId:string){
 const actor={agentId:f.store.meta('mainAgentId')!,threadId:'original-main',sourceRequestId};
 const task=f.app.tasks.createTask(actor,{operationId:'live-task',goal:'Synthetic background work',authority:{sourceRequestId,description:'Synthetic only',materials:[],resultIds:[]}});
 const opened=f.app.tasks.workerOpen(actor,{operationId:'live-worker',taskId:task.taskId,text:'Synthetic work'}),run=f.app.tasks.claim(opened.runId)!;
 f.app.tasks.bind(run.id,run.epoch,'worker-thread','worker-turn');return f.app.tasks.run(run.id);
}
test('TG coordination keeps one original output identity through retry, recovery and revoked routing',async t=>{
 const f=fixture(t),requestId='tg:123456:10';
 await f.bridge.submit({requestId,text:'合成请求',origin:f.origin});
 const message=mainQueueOutput({...f.app,history:f.history,processes:f.processes},requestId);
 const notice=f.processes.exact(message.messageId)!.sourceMessageIds[0]!;
 f.store.db.prepare("UPDATE agent_messages SET senderAgentId='worker:forged',kind='interaction_required',payloadJson=? WHERE id=?").run(JSON.stringify({interactionId:'forged-worker-question'}),notice);
 assert.equal(f.processes.coordination(message.messageId)?.interactionId,undefined,'a Worker cannot forge the host question identity');
 await f.bridge.handleMessage({...message,text:'Forged text'});assert.equal(f.store.db.prepare('SELECT count(*) n FROM tg_outbox').get()!.n,0);
 await f.bridge.handleMessage(message);await f.bridge.handleMessage(message);await f.bridge.recoverReplies();
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM tg_outbox WHERE groupId=?').get('delivery:'+message.messageId)!.n,1);
 assert.equal(f.submissions.length,1,'recovery does not enqueue another business input');
 f.store.db.prepare("UPDATE tg_routes SET origin='{}' WHERE requestId=?").run(requestId);
 const rows=f.store.db.prepare('SELECT count(*) n FROM tg_outbox').get()!.n;
 await f.bridge.handleMessage(message);assert.equal(f.store.db.prepare('SELECT count(*) n FROM tg_outbox').get()!.n,rows);
});

for(const state of ['pending_main','answered','pending_user','answered_user','foreign_user','cancelled_user','expired_user'] as const)test('TG coordination preserves ordinary reports and question recovery: '+state,async t=>{
 const f=fixture(t),requestId='tg:123456:10';await f.bridge.submit({requestId,text:'合成请求',origin:f.origin});
 const message=mainQueueOutput({...f.app,history:f.history,processes:f.processes},requestId),notice=f.processes.exact(message.messageId)!.sourceMessageIds[0]!;
 const run=f.app.tasks.run(String(f.store.db.prepare('SELECT senderRunId FROM agent_messages WHERE id=?').get(notice)!.senderRunId));
 const opened=f.interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'synthetic-question',source:'ask_main',kind:'question',details:{question:'合成待定项'},authority:{sourceRequestId:requestId,description:'合成范围',nativeApprovals:false}},()=>true);
 f.store.db.prepare("UPDATE agent_messages SET senderAgentId='host',kind='interaction_required',payloadJson=? WHERE id=?").run(JSON.stringify({interactionId:opened.id}),notice);
 if(state.endsWith('_user'))f.interactions.escalate(opened.id,'合成用户问题','需用户决定');
 if(state.startsWith('answered'))f.interactions.respond(opened.id,{action:'answer',answer:'合成答复',reason:'合成决策'},state==='answered_user'?{userMessageId:'synthetic-answer'}:{});
 if(state==='foreign_user')f.store.db.prepare('UPDATE runs SET sourceRequestId=? WHERE id=?').run('another-request',run.id);
 if(state==='cancelled_user')f.interactions.cancelRun(run.id);
 if(state==='expired_user')f.interactions.expire(opened.id);
 await f.bridge.handleMessage(message);await f.bridge.handleMessage(message);await f.bridge.recoverReplies();
 const reportCount=Number(f.store.db.prepare('SELECT count(*) n FROM tg_outbox WHERE groupId=?').get('delivery:'+message.messageId)!.n);
 const questionCount=Number(f.store.db.prepare('SELECT count(*) n FROM tg_outbox WHERE groupId=?').get('interaction:'+opened.id)!.n);
 assert.equal(reportCount,state.endsWith('_user')?0:1);assert.equal(questionCount,state==='pending_user'?1:0);
});

test("TG completed native draft uses canonical receipt when public final has a different ID; recovery stays single", async t => {
  const f = fixture(t), requestId = "tg:123456:10";
  await f.bridge.submit({ requestId, text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!;
  const state = f.app.conversationState.bind(f.app);
  f.app.conversationState = () => ({ ...state(), messages: [{ ...reply, id: "node-public-final", text: "合成最终回复", status: "completed" }] });
  const generation = { generationId: "canonical-generation", messageId: reply.id, threadId: "original-main", turnId: "canonical-turn", sourceRequestId: requestId };
  await f.bridge.handleMessage({ type: "main_start", ...generation, text: "" });
  f.history.finish(reply.id, "合成最终回复", "completed");
  await f.bridge.handleMessage({ type: "main_terminal", ...generation, text: "合成最终回复", status: "completed" });
  await f.bridge.handleMessage({ type: "reply", requestId, text: "合成最终回复" });
  assert.equal(f.bridge.gaps.size, 0);
  await f.bridge.recoverReplies(); await f.bridge.recoverReplies();
  assert.deepEqual(f.store.db.prepare("SELECT groupId FROM tg_outbox").all().map(row => row.groupId), ["generation:canonical-generation"]);
  assert.equal(f.bridge.channel.store.draft(generation.generationId)?.state, "closed");
});

test("TG truly missing native events keep one canonical fallback across reply and recovery", async t => {
  const f = fixture(t), requestId = "tg:123456:10";
  await f.bridge.submit({ requestId, text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!;
  const state = f.app.conversationState.bind(f.app);
  f.app.conversationState = () => ({ ...state(), messages: [{ ...reply, id: "node-public-fallback" }] });
  f.history.finish(reply.id, "合成无原生事件回复", "completed");
  await f.bridge.handleMessage({ type: "main_start", generationId: "foreign-source", messageId: reply.id, threadId: "original-main", turnId: "wrong-source-turn", sourceRequestId: "unaccepted-request", text: "" });
  await f.bridge.handleMessage({ type: "reply", requestId, text: "合成无原生事件回复" });
  assert.equal(f.bridge.gaps.has("native_generation_events_missing"), true);
  await f.bridge.recoverReplies(); await f.bridge.recoverReplies();
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM tg_drafts").get()?.n, 0);
  assert.deepEqual(f.store.db.prepare("SELECT groupId FROM tg_outbox").all().map(row => row.groupId), ["delivery:reply:" + reply.id]);
});

test("TG public reply cannot replace a mismatched canonical input or revoked acceptance route", async t => {
  const f = fixture(t), requestId = "tg:123456:10";
  await f.bridge.submit({ requestId, text: "合成请求", origin: f.origin });
  const original = f.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId=?").get(requestId)!.replyId;
  f.store.db.prepare("UPDATE conversation_inputs SET replyId='wrong-reply' WHERE requestId=?").run(requestId);
  await f.bridge.handleMessage({ type: "reply", requestId, text: "不可授权的合成回复" });
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM tg_outbox").get()?.n, 0);
  f.store.db.prepare("UPDATE conversation_inputs SET replyId=? WHERE requestId=?").run(original!, requestId);
  f.store.db.prepare("UPDATE tg_routes SET origin='{}' WHERE requestId=?").run(requestId);
  await f.bridge.handleMessage({ type: "reply", requestId, text: "错来源合成回复" });
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM tg_outbox").get()?.n, 0);
});

test("TG Homer bridge uses injected SQLite/original main history and fails closed on thread replacement", async t => {
  const f = fixture(t);
  assert.equal(f.bridge.channel.store.db, f.store.db);
  await f.bridge.submit({ requestId: "tg:123456:10", text: "合成请求", origin: f.origin });
  await f.bridge.submit({ requestId: "tg:123456:10", text: "合成请求", origin: f.origin });
  assert.equal(f.submissions.length, 1); assert.equal(f.history.list("original-main").length, 2);
  f.store.setMeta("mainThread", "unexpected-thread");
  await assert.rejects(f.bridge.submit({ requestId: "new", text: "合成输入", origin: f.origin }), /main_thread_changed/);
});

test("TG Homer bridge never invents native lifecycle and does not duplicate formal finish", async t => {
  const f = fixture(t);
  await f.bridge.submit({ requestId: "tg:123456:10", text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!;
  await f.bridge.handleMessage({ type: "delta", text: "合成", requestId: "tg:123456:10", messageId: reply.id });
  assert.equal(f.bridge.gaps.has("native_generation_events_missing"), true);
  const generation: MainGeneration = { id: "g-a", messageId: reply.id, threadId: "original-main", turnId: "main-turn-a", sourceRequestId: "tg:123456:10", visibility: "main_user" };
  await f.bridge.mainStarted(generation); await f.bridge.mainStarted(generation);
  f.history.finish(reply.id, "合成最终回复", "completed");
  await f.bridge.mainFinished(generation.id, "合成最终回复", "completed");
  await f.bridge.handleMessage({ type: "reply", text: "合成最终回复", requestId: "tg:123456:10" });
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tg_outbox").get()?.n, 1);
});

test("TG accepted route retains all 300 ordered deltas between real start and terminal with one formal reply", async t => {
  const f = fixture(t), requestId = "tg:123456:10";
  await f.bridge.submit({ requestId, text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!, events: any[] = [];
  const event = f.bridge.channel.event.bind(f.bridge.channel);
  f.bridge.channel.event = async value => { await event(value); events.push(value); };
  const generation = { generationId: "synthetic-burst-generation", messageId: reply.id,
    threadId: "original-main", turnId: "synthetic-burst-turn", sourceRequestId: requestId };
  await f.bridge.handleMessage({ type: "main_start", ...generation, text: "" });
  const chunks = Array.from({ length: 300 }, (_, index) => `Synthetic-${index};`);
  for (const text of chunks) await f.bridge.handleMessage({ type: "delta", requestId, messageId: reply.id, text });
  const text = chunks.join(""); f.history.finish(reply.id, text, "completed");
  await f.bridge.handleMessage({ type: "main_terminal", ...generation, status: "completed", text });
  await f.bridge.handleMessage({ type: "reply", requestId, text });
  assert.deepEqual(events.map(value => value.type), ["start", ...Array(300).fill("delta"), "finish"]);
  const deltas = events.filter(value => value.type === "delta");
  assert.deepEqual(deltas.map(value => value.text), chunks);
  assert.deepEqual(deltas.map(value => value.sequence), Array.from({ length: 300 }, (_, index) => index));
  assert.ok(deltas.every(value => value.generationId === generation.generationId));
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tg_outbox").get()?.n, 1);
});

test("TG history committed before sink is recovered once without rerunning main or replaying a draft", async t => {
  const f = fixture(t);
  await f.bridge.submit({ requestId: "tg:123456:10", text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!;
  f.history.finish(reply.id, "崩溃前已完成的合成回复", "completed");
  await f.bridge.recoverReplies(); await f.bridge.recoverReplies();
  assert.equal(f.submissions.length, 1);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tg_outbox").get()?.n, 1);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tg_drafts").get()?.n, 0);
});

test("TG Homer bridge stop checks exact generation and waits for observed terminal, leaves Worker running", async t => {
  const f = fixture(t);
  await f.bridge.submit({ requestId: "tg:123456:10", text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!;
  const generation: MainGeneration = { id: "g-stop", messageId: reply.id, threadId: "original-main", turnId: "main-turn-stop", sourceRequestId: "tg:123456:10", visibility: "main_user" };
  const run=liveWorker(f,"tg:123456:10");
  f.active(reply.id); await f.bridge.mainStarted(generation);
  assert.equal(await f.bridge.stop({ ...generation, turnId: "wrong-turn" }), "already_finished"); assert.equal(f.stops.length, 0);
  let settled = false;
  const stopping = f.bridge.stop(generation).then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  await f.bridge.mainFinished(generation.id, "合成部分回复", "interrupted");
  assert.equal(await stopping, "stopped"); assert.equal(f.stops.length, 1);
  assert.equal(f.store.run(run.id)?.status, "running"); assert.equal(f.store.run(run.id)?.stopRequestedAt, null);
});

test("TG failed history and ordinary reply cannot confirm a still-active main generation", async t => {
  const f = fixture(t);
  const requestId = "tg:123456:10";
  await f.bridge.submit({ requestId, text: "合成请求", origin: f.origin });
  const reply = f.history.list("original-main")[1]!;
  const generation = { generationId: "g-close-unconfirmed", threadId: "original-main", turnId: "unconfirmed-turn", messageId: reply.id, sourceRequestId: requestId };
  f.active(reply.id);
  await f.bridge.handleMessage({ type: "main_start", text: "", ...generation });
  // A failed history entry is persisted even if engine closure is unconfirmed.
  f.history.finish(reply.id, "合成引擎关闭尚未确认", "failed");
  await f.bridge.handleMessage({ type: "reply", text: "合成引擎关闭尚未确认", requestId });
  await f.bridge.recoverReplies();
  assert.equal(f.bridge.channel.store.draft(generation.generationId)?.state, "active");
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tg_outbox").get()?.n, 0);

  let settled = false;
  const stopping = f.bridge.stop({ ...generation, id: generation.generationId, visibility: "main_user" }).then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  await f.bridge.handleMessage({ type: "main_terminal", text: "迟到的其他轮终态", ...generation, turnId: "wrong-turn", status: "interrupted" });
  assert.equal(settled, false);
  for (const wrong of [{ generationId: "wrong-generation" }, { sourceRequestId: "unaccepted-source" }, { threadId: "wrong-thread" }, { messageId: "node-public-final" }]) {
    await f.bridge.handleMessage({ type: "main_terminal", text: "错误身份终态", ...generation, ...wrong, status: "interrupted" });
    assert.equal(settled, false);
    assert.equal(f.bridge.channel.store.draft(generation.generationId)?.state, "active");
  }
  await f.bridge.handleMessage({ type: "main_terminal", text: "合成已确认关闭", ...generation, status: "failed" });
  assert.equal(await stopping, "already_finished");
  assert.equal(f.stops.length, 1);
  assert.equal(f.bridge.channel.store.draft(generation.generationId)?.state, "closed");
  await f.bridge.handleMessage({ type: "reply", text: "合成已确认关闭", requestId });
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM tg_outbox").get()?.n, 1);
});

test("TG Homer bridge routes answer through main with original interaction; cancelled Worker cannot be approved", async t => {
  const f = fixture(t);
  await f.bridge.submit({ requestId: "tg:123456:10", text: "合成请求", origin: f.origin });
  const run=liveWorker(f,"tg:123456:10");
  const opened = f.interactions.open({ runId: run.id, threadId: "worker-thread", turnId: "worker-turn", requestId: "worker-question", source: "ask_main", kind: "question", details: { question: "合成问题" }, authority: { sourceRequestId: "tg:123456:10", description: "合成授权范围", nativeApprovals: false } }, () => f.store.run(run.id)?.status === "running");
  f.interactions.escalate(opened.id, "请补充合成信息", "合成待定项");
  f.bridge.channel.store.ingest("123456", [{ update_id: 11, message: { message_id: 31, date: Date.now() / 1000, chat: { id: 789123, type: "private" }, from: { id: 789123 }, text: "合成答案", reply_to_message: { message_id: 50 } } }]);
  const answerOrigin = f.bridge.channel.store.route("tg:123456:11")!;
  f.bridge.channel.store.interaction(opened.id, f.origin, run.id, Date.now() + 60_000, []);
  f.bridge.channel.store.interactionSent(opened.id, 50);
  assert.ok(f.bridge.channel.store.answer("tg:123456:11", answerOrigin, { replyId: 50, text: "合成答案" }));
  await f.bridge.respond({ interactionId: opened.id, requestId: "tg:123456:11", text: "合成答案", origin: answerOrigin });
  assert.equal(f.submissions[1]?.interactionId, opened.id);
  assert.equal(f.interactions.inspect(opened.id).state, "pending_user"); // No adapter bypass of main autonomy.
  f.app.tasks.controlTask({agentId:f.store.meta("mainAgentId")!,threadId:"original-main",sourceRequestId:"tg:123456:10"},{operationId:"cancel-worker",taskId:run.taskId,expectedRevision:f.app.tasks.task(run.taskId).revision,action:"cancel",reason:"User cancelled synthetic work"});
  await f.bridge.respond({ interactionId: opened.id, requestId: "tg:123456:11", text: "合成答案", origin: answerOrigin });
  assert.equal(f.submissions.length, 2);
  await assert.rejects(f.bridge.respond({ interactionId: opened.id, requestId: "tg:123456:11", text: "变更过的答案", origin: answerOrigin }), /request_id_conflict/);
  await assert.rejects(f.bridge.respond({ interactionId: opened.id, requestId: "tg:123456:12", text: "同意", origin: f.origin }), /interaction_not_live/);
  f.interactions.cancelRun(run.id); assert.equal((await opened.response).status, "cancelled");
});


test("multi-file Telegram publication queues one explicit Web notice and no file reference; replay and wrong source stay fenced",async t=>{
 const f=fixture(t);await f.bridge.submit({requestId:'tg:123456:10',text:'合成请求',origin:f.origin});
 const candidate=syntheticFile(f.bridge.app as import('../src/service.js').Homer,'tg:123456:10','one.md','# One',[{filename:'two.md',content:'# Two'}]),d=candidate.publish('两份合成成果');
 const file=await f.bridge.artifact(candidate.resultId,f.origin);assert.equal(file.filename,'one.md');assert.deepEqual(file.bytes,Buffer.from('# One'));
 for(const id of ['',undefined,candidate.run.id])await assert.rejects(f.bridge.artifact(id as string,f.origin),/telegram_artifact_not_authorized/);
 const message={type:'delivery' as const,deliveryId:d.id,messageId:d.historyMessageId,requestId:'tg:123456:10',text:d.text};
 await f.bridge.handleMessage({...message,requestId:'wrong-source'});assert.equal(f.store.db.prepare('SELECT count(*) n FROM tg_outbox').get()?.n,0);
 await f.bridge.handleMessage(message);await f.bridge.handleMessage(message);
 const rows=f.store.db.prepare('SELECT kind,payload FROM tg_outbox').all();assert.equal(rows.length,1);assert.equal(rows[0]!.kind,'rich');assert.match(String(rows[0]!.payload),/2 个成果.*Web/);
});
