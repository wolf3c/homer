import {syntheticFile} from "./recursive-publication-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Homer } from "../src/service.js";
import { HomerWechat } from "../src/channels/wechat-homer.js";
import { WechatApi, type WechatCredential, type WechatItem, type WechatUpdates } from "../src/channels/wechat-api.js";
import type { WechatSecrets } from "../src/channels/wechat-secrets.js";
import {mainQueueOutput} from './helpers/main-queue-output.js';
import {WorkerInteractions} from '../src/worker-interactions.js';

class Api extends WechatApi {
  constructor(){super(async()=>Response.json({ret:0}));}
  inputs: WechatUpdates[] = [];
  sent: { context: string; item: WechatItem }[] = [];
  uploaded: { filename: string; bytes: Uint8Array }[] = [];
  override async beginQr() { return { qrcode: "synthetic", qrcode_img_content: "https://ilinkai.weixin.qq.com/qr/synthetic" }; }
  override async pollQr() { return { status: "confirmed", bot_token: "synthetic", ilink_bot_id: "bot", ilink_user_id: "owner", baseurl: "https://ilinkai.weixin.qq.com" }; }
  override async updates(_c: WechatCredential, _cursor: string, signal?: AbortSignal) { await delay(5, undefined, { signal }); return this.inputs.shift() ?? { msgs: [] }; }
  override async send(_c: WechatCredential, _peer: string, context: string, _id: string, item: WechatItem) { this.sent.push({ context, item }); }
  override async uploadMarkdown(_c: WechatCredential, filename: string, bytes: string | Uint8Array) {
    this.uploaded.push({ filename, bytes: Buffer.from(bytes) });
    return { type: 4, file_item: { file_name: filename, len: String(Buffer.byteLength(bytes)), media: { encrypt_query_param: "synthetic", aes_key: "synthetic", encrypt_type: 1 } } };
  }
  receive(id: string, text: string) { this.inputs.push({ msgs: [{ message_id: id, from_user_id: "owner", to_user_id: "bot", message_type: 1, context_token: "context-" + id, item_list: [{ type: 1, text_item: { text } }] }] }); }
}
async function until(check: () => boolean) { for (let n = 0; n < 200; n++) { if (check()) return; await delay(5); } assert.ok(check(), "wechat_adapter_fixture_timeout"); }
async function setup() {
  const scratch = resolve(".codex/scratch/wechat-integration"); mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "adapter-")), api = new Api(), credentials = new Map<string, WechatCredential>();
  mkdirSync(join(root, "runtime"), { recursive: true });
  const secrets: WechatSecrets = { async get(id) { return credentials.get(id)!; }, async set(id, c) { credentials.set(id, c); }, async delete(id) { credentials.delete(id); } };
  let adapter: HomerWechat | undefined, turns = 0, engines = 0, dropOutput = false;
  class Engine extends EventEmitter {
    threadId='synthetic-main';
    async start() { return "synthetic-main"; }
    async turn(text: string,options?:{onStarted?:(id:string)=>void}) { options?.onStarted?.('synthetic-turn-'+turns);turns++; return { status: "completed", text: "主Agent合成回复：" + text }; }
    async interrupt() { return true; }
    async close() { return true; }
  }
  const app = new Homer({ runtime: join(root, "runtime"), workspace: join(root, "workspace"), codexHome: root, codexBin: "/usr/bin/false", model: "synthetic-only", requiresOpenaiAuth: false, timeoutMs: 2000, mainTimeoutMs: 1000, stopGraceMs: 20 }, async message => { if (!dropOutput) await adapter?.onMessage(message); }, () => { engines++; return new Engine(); });
  await app.start(); adapter = new HomerWechat(app, api, secrets);
  const login = await adapter.channel.beginLogin(); await adapter.channel.pollLogin(login.id);
  return { app, api, secrets, credentials, get adapter() { return adapter!; }, get turns() { return turns; }, get engines() { return engines; },
    dropOutput() { dropOutput = true; },
    async restartAdapter() { await adapter!.channel.close(); adapter = new HomerWechat(app, api, secrets); await adapter.restore(); },
    async close() { await adapter?.channel.close(); await app.close(); rmSync(root, { recursive: true, force: true }); } };
}
function admit(s: Awaited<ReturnType<typeof setup>>, id: string, text: string) {
  s.adapter.channel.disable();
  const c = s.adapter.channel.store.transition("connected", true);
  s.adapter.channel.store.accept(c.generation, { msgs: [{ message_id: id, from_user_id: "owner", to_user_id: "bot", message_type: 1, context_token: "synthetic-context-" + id, item_list: [{ type: 1, text_item: { text } }] }] }, s.credentials.get(c.secretRef!)!.dataKey);
  const row = s.app.store.db.prepare("SELECT requestId FROM wechat_inbox WHERE messageId=?").get(id) as { requestId: string };
  return { requestId: row.requestId, text, origin: { channel: "wechat" as const, bindingGeneration: c.bindingId!, botId: "bot", peerId: "owner", messageId: id } };
}
test('Wechat coordination uses persisted main output and original source once across adapter recovery',async()=>{
 const s=await setup();try{
  const input=admit(s,'901','Synthetic request');await s.adapter.submit(input);await s.app.idle();
  const message=mainQueueOutput(s.app,input.requestId);
  assert.equal(await s.adapter.onMessage({...message,text:'Forged body'}),false);
  assert.equal(await s.adapter.onMessage({...message,messageId:'unknown-output'}),false);
  await s.adapter.onMessage(message);await s.adapter.onMessage(message);
  const count=()=>Number(s.app.store.db.prepare("SELECT count(*) n FROM wechat_outbox WHERE eventKey=?").get('homer-wechat:coordination:'+message.messageId)!.n);
  assert.equal(count(),1);await s.restartAdapter();assert.equal(count(),1);
  assert.equal(s.turns,1,'output recovery never runs business again');
  await s.adapter.channel.disconnect();assert.equal(await s.adapter.onMessage(message),false);
 }finally{await s.close();}
});

for(const state of ['pending_main','answered','pending_user','answered_user','foreign_user','cancelled_user','expired_user'] as const)test('Wechat coordination preserves ordinary reports and question recovery: '+state,async()=>{
 const s=await setup();try{
  const input=admit(s,'902','Synthetic request');await s.adapter.submit(input);await s.app.idle();
  const message=mainQueueOutput(s.app,input.requestId),notice=s.app.processes.exact(message.messageId)!.sourceMessageIds[0]!;
  const task=s.app.tasks.task(String(s.app.store.db.prepare('SELECT taskId FROM agent_messages WHERE id=?').get(notice)!.taskId)),run=s.app.tasks.run(task.currentRunId!);
  const interactions=new WorkerInteractions(s.app.store.db),opened=interactions.open({runId:run.id,threadId:run.threadId!,turnId:run.turnId!,requestId:'synthetic-question',source:'ask_main',kind:'question',details:{question:'合成待定项'},authority:{sourceRequestId:input.requestId,description:'合成范围',nativeApprovals:false}},()=>true);
  s.app.store.db.prepare("UPDATE agent_messages SET senderAgentId='host',kind='interaction_required',payloadJson=? WHERE id=?").run(JSON.stringify({interactionId:opened.id}),notice);
  if(state.endsWith('_user'))interactions.escalate(opened.id,'合成用户问题','需用户决定');
  if(state.startsWith('answered'))interactions.respond(opened.id,{action:'answer',answer:'合成答复',reason:'合成决策'},state==='answered_user'?{userMessageId:'synthetic-answer'}:{});
  if(state==='foreign_user')s.app.store.db.prepare('UPDATE runs SET sourceRequestId=? WHERE id=?').run('another-request',run.id);
  if(state==='cancelled_user')interactions.cancelRun(run.id);
  if(state==='expired_user')interactions.expire(opened.id);
  await s.adapter.onMessage(message);await s.adapter.onMessage(message);await s.restartAdapter();
  const reportCount=Number(s.app.store.db.prepare('SELECT count(*) n FROM wechat_outbox WHERE eventKey=?').get('homer-wechat:coordination:'+message.messageId)!.n);
  const questionCount=Number(s.app.store.db.prepare('SELECT count(*) n FROM wechat_outbox WHERE eventKey=?').get('homer-wechat:question:'+opened.id)!.n);
  assert.equal(reportCount,state.endsWith('_user')?0:1);assert.equal(questionCount,state==='pending_user'?1:0);
 }finally{await s.close();}
});

test("Homer adapter uses the original instance and persisted provenance after channel restart; prefix-only CLI input is never mirrored", async () => {
  const s = await setup();
  try {
    const thread = s.app.store.meta("mainThread"); s.api.receive("1", "本人合成消息");
    await until(() => s.api.sent.length === 1); await s.app.idle();
    const input = s.adapter.channel.store.db.prepare("SELECT requestId FROM wechat_inbox").get() as { requestId: string };
    assert.equal(s.engines, 1); assert.equal(s.turns, 1); assert.equal(s.api.sent[0]!.context, "context-1");
    await s.app.message("CLI合成消息", "wechat:synthetic-cli");
    assert.equal(s.api.sent.length, 1); assert.equal(s.app.store.meta("mainThread"), thread);
    await s.restartAdapter();
    await s.adapter.onMessage({ type: "question", requestId: input.requestId, text: "主Agent合成追问" });
    await until(() => s.api.sent.length === 2); assert.equal(s.api.sent[1]!.context, "context-1");
    await s.adapter.onMessage({ type: "question", requestId: input.requestId, text: "主Agent合成追问" });
    await delay(20); assert.equal(s.api.sent.length, 2); assert.equal(s.engines, 1);
    assert.equal(s.app.conversationState().messages.filter(m => m.role === "user").length, 2);
    await s.adapter.channel.disconnect();
    assert.equal(await s.adapter.onMessage({ type: "delivery", requestId: input.requestId, text: "旧绑定晚到结果" }), false);
  } finally { await s.close(); }
});

test("restore recovers a reply committed to shared history before the channel sink was reached without rerunning the main Agent", async () => {
  const s = await setup();
  try {
    s.dropOutput(); s.api.receive("5", "恢复合成完成回执");
    await until(() => s.app.conversationState().messages.some(m => m.role === "assistant" && m.status === "completed")); await s.app.idle();
    assert.equal(s.api.sent.length, 0); assert.equal(s.turns, 1);
    await s.restartAdapter(); await until(() => s.api.sent.length === 1);
    assert.equal(s.api.sent[0]!.context, "context-5"); assert.match(s.api.sent[0]!.item.text_item!.text!, /恢复合成完成回执/);
    await s.restartAdapter(); await delay(20); assert.equal(s.api.sent.length, 1); assert.equal(s.turns, 1);
  } finally { await s.close(); }
});

test("Homer adapter rejects spoofed origin, preexisting Web request collisions and unrelated files", async () => {
  const s = await setup();
  try {
    const input = admit(s, "2", "collision");
    await assert.rejects(s.adapter.submit({ ...input, origin: { ...input.origin, peerId: "stranger" } }), /wechat_origin_mismatch/);
    s.app.submitMessage({ requestId: input.requestId, text: "collision" }); await s.app.idle();
    await assert.rejects(s.adapter.submit(input), /request_id_conflict/);
    assert.equal(await s.adapter.onMessage({ type: "reply", requestId: input.requestId, text: "不可镜像Web内容" }), false);
    await assert.rejects(s.adapter.artifact("run-unrelated"), /artifact_not_authorized/);
    assert.equal(s.api.sent.length, 0);
  } finally { await s.close(); }
});

test("channel acceptance rolls back history and provenance together; duplicate and cross-source attempts never enqueue another turn", async () => {
  const s = await setup();
  try {
    await s.app.idle(); const input = admit(s, "4", "原子接收合成输入"), before = s.turns;
    s.app.store.db.exec("CREATE TEMP TRIGGER synthetic_reject_receipt AFTER INSERT ON wechat_homer_receipts BEGIN SELECT RAISE(ABORT, 'synthetic_receipt_rejected'); END");
    await assert.rejects(s.adapter.submit(input), /synthetic_receipt_rejected/); await s.app.idle();
    assert.equal(s.turns, before); assert.equal(s.app.store.request(input.requestId), undefined);
    assert.equal(s.app.store.db.prepare("SELECT * FROM conversation_inputs WHERE requestId=?").get(input.requestId), undefined);
    assert.equal(s.app.store.db.prepare("SELECT * FROM conversation_messages WHERE requestId=?").get(input.requestId), undefined);
    assert.equal(s.app.store.db.prepare("SELECT * FROM wechat_homer_receipts WHERE requestId=?").get(input.requestId), undefined);
    s.app.store.db.exec("DROP TRIGGER synthetic_reject_receipt");
    const accepted = await s.adapter.submit(input); await s.app.idle(); assert.equal(accepted.fresh, true);
    const duplicate = await s.adapter.submit(input); await s.app.idle();
    assert.equal(duplicate.fresh, false); assert.equal(duplicate.replyId, accepted.replyId); assert.equal(s.turns, before + 1);
    assert.throws(() => s.app.submitMessage({ requestId: input.requestId, text: input.text }), /request_id_conflict/);
    await assert.rejects(s.app.message(input.text, input.requestId), /request_id_conflict/);
    let reached = false;
    assert.throws(() => s.app.submitMessage({ requestId: input.requestId, text: input.text }, { source: "telegram", persist() { reached = true; } }), /request_id_conflict/);
    assert.equal(reached, false);
    await assert.rejects(s.adapter.submit({ ...input, text: "替换内容" }), /wechat_origin_mismatch|request_id_conflict/);
    await assert.rejects(s.adapter.submit({ ...input, origin: { ...input.origin, messageId: "999" } }), /wechat_origin_mismatch/);
    s.app.store.db.prepare("DELETE FROM wechat_homer_receipts WHERE requestId=?").run(input.requestId);
    await assert.rejects(s.adapter.submit(input), /request_id_conflict/); await s.app.idle();
    assert.equal(s.turns, before + 1);
  } finally { await s.close(); }
});

test("Homer adapter routes a completed run by its original source and returns only verified Files bytes", async () => {
  const s = await setup();
  try {
    s.api.receive("3", "本人合成文件请求"); await until(() => s.api.sent.length === 1); await s.app.idle();
    const input = s.app.store.db.prepare("SELECT requestId FROM wechat_homer_receipts").get() as { requestId: string };
    const candidate=syntheticFile(s.app,input.requestId,'合成成果.md','# 已核验的合成成果\n🙂'),run=candidate.run;
    await assert.rejects(s.adapter.artifact(run.id),/artifact_not_authorized/);
    const d=candidate.publish('主Agent已核验的合成成果');
    const delivery={type:'delivery' as const,deliveryId:d.id,messageId:d.historyMessageId,requestId:input.requestId,runId:run.id,text:d.text};
    const file=await s.adapter.artifact(run.id);assert.equal(file.filename,'合成成果.md');assert.equal(Buffer.from(file.bytes).toString(),'# 已核验的合成成果\n🙂');
    assert.equal(await s.adapter.onMessage({...delivery,requestId:'web-unrelated'}),false);
    assert.equal(await s.adapter.onMessage(delivery),true);
    await until(() => s.api.sent.length === 3);
    assert.equal(s.api.sent[2]!.context, "context-3"); assert.equal(s.api.sent[2]!.item.type, 4);
    assert.equal(s.api.uploaded[0]!.filename, file.filename); assert.deepEqual(s.api.uploaded[0]!.bytes, file.bytes);
    assert.equal(await s.adapter.onMessage({ type: "delta", requestId: input.requestId, text: "内部流" }), false);
    assert.equal(await s.adapter.onMessage({ type: "progress", runId: run.id, text: "内部Worker进度" }), false);
    s.app.store.markDelivered(run.id);
    await s.restartAdapter();
    await s.adapter.onMessage(delivery); await delay(20);
    assert.equal(s.api.sent.length, 3); assert.equal(s.api.uploaded.length, 1); assert.equal(s.engines, 1);
    await s.adapter.channel.disconnect(); await assert.rejects(s.adapter.artifact(run.id), /artifact_not_authorized/);
  } finally { await s.close(); }
});


test("multi-file Wechat delivery queues one explicit Web notice, no first-file upload, and deduplicates replay",async()=>{
 const s=await setup();try{
  s.api.receive('55','合成多文件请求');await until(()=>s.api.sent.length===1);await s.app.idle();
  const input=s.app.store.db.prepare('SELECT requestId FROM wechat_homer_receipts').get() as {requestId:string};
  const candidate=syntheticFile(s.app,input.requestId,'one.md','# One',[{filename:'two.md',content:'# Two'}]),d=candidate.publish('两份合成成果');
  const message={type:'delivery' as const,deliveryId:d.id,messageId:d.historyMessageId,requestId:input.requestId,runId:candidate.run.id,text:d.text};
  assert.equal(await s.adapter.onMessage({...message,requestId:'unrelated-source'}),false);assert.equal(await s.adapter.onMessage(message),true);await until(()=>s.api.sent.length===2);
  assert.equal(s.api.sent[1]!.item.type,1);assert.match(JSON.stringify(s.api.sent[1]!.item),/2 个成果.*Web/);assert.equal(s.api.uploaded.length,0);
  await s.adapter.onMessage(message);await delay(20);assert.equal(s.api.sent.length,2);
  await s.restartAdapter();await s.adapter.onMessage(message);await delay(20);assert.equal(s.api.sent.length,2);assert.equal(s.api.uploaded.length,0);
 }finally{await s.close();}
});
