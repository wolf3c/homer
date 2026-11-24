import {createWebChat} from '../src/web-chat.js';
import {callEngineMcp} from './fixtures/host-mcp-call.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Homer, type Message } from "../src/service.js";
import type { Config } from "../src/config.js";
import { EngineRpcUnconfirmed } from "../src/engine.js";
import type { EngineOptions, ToolCall, TurnResult } from "../src/engine.js";
import { loadPrompts } from "../src/prompts.js";
import { homerWebBridge } from "../src/web-homer.js";

async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error("interaction_test_timeout"); await new Promise(done => setTimeout(done, 5)); }
}
const releaseOptions=[
  {id:'publish',label:'豁免 Intel Mac 和 Windows 实机验收',description:'公开 v0.1.23 固定版本，保留 v0.1.22 为 Latest。'},
  {id:'wait',label:'等待设备验收',description:'等 Intel Mac 和 Windows 两平台验收后再公开。'},
];
type InteractionScenario = {
  business?:true;
  clarify?:true;
  longAnswer?:true;
  reply?: TurnResult;
  skipDecision?: boolean;
  skipDelivery?: boolean;
  handoff?: boolean;
  namedTask?: boolean;
  cancelBeforeDecision?:boolean;
  misdirectHistoricalApproval?:boolean;
};
async function fixture(mode: "answer" | "user" | "deny" | "approve" | "direct" | "hang", workers = 1, scenario: InteractionScenario = {}) {
  const root = resolve(".codex/scratch/worker-interactions"); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(root + "/svc-");
  const runtime = join(dir, "rt"), workspace = join(dir, "ws");
  mkdirSync(runtime); mkdirSync(workspace);
  const config: Config = { runtime, workspace, codexHome:join(dir,"home"),nativeCodexHome:join(dir,"home"), codexBin: "/usr/bin/false", model: "mock", effort: "medium", requiresOpenaiAuth: false, stopGraceMs: 50 };
  const messages: Message[] = [], resumes: string[] = [], engines: Fake[] = [], mainInputs:string[]=[];
  const handoffs: string[] = [], interactionTurns: string[] = [], pausedWorkers: (() => void)[] = [];
  const workerAnswers:string[]=[];
  const misdirected: {currentId:string;historicalId:string;currentBefore:unknown;messageBefore:unknown;errors:string[]}[] = [];
  const releaseWorkers = () => { for (const release of pausedWorkers.splice(0)) release(); };
  let sequence = 0;
  let app: Homer;
  class Fake extends EventEmitter {
    threadId: string; turnId?: string; worker: boolean; closed = false;
    constructor(readonly options: EngineOptions, readonly handler: (call: ToolCall) => Promise<unknown>) {
      super(); this.threadId = options.threadId ?? "thread-" + ++sequence;
      this.worker = options.role === "worker"; engines.push(this);
    }
    resumeQuestion?: (value:any)=>void;
    async steer(turnId:string,message:string){
      assert.equal(turnId,this.turnId);
      workerAnswers.push(message);
      if(scenario.skipDelivery)throw new EngineRpcUnconfirmed('engine_rpc_timeout');
      assert.ok(this.resumeQuestion);
      setImmediate(()=>this.resumeQuestion?.({status:'answered',answer:message.slice(message.indexOf('\n')+1)}));
      return {turnId};
    }
    async start() { return this.threadId; }
    async call(tool: string, args: unknown): Promise<any> {
      const callId = "call-" + ++sequence;
      const result = await this.handler({ threadId: this.threadId, turnId: this.turnId!, callId, tool, arguments: args });
      if (!this.closed && !(this.worker && tool === "ask_main" && scenario.skipDelivery)) this.emit("toolResponse", callId);
      return result;
    }
    async turn(text: string, hooks?: { onStarted?: (id: string) => void }): Promise<TurnResult> {
      this.turnId = "turn-" + ++sequence; hooks?.onStarted?.(this.turnId);
      if (this.worker) {
        let reply: any;
        if (mode === "approve" || mode === "deny" || mode === "direct") {
          const requestId = "native-" + this.threadId;
          const itemId=scenario.misdirectHistoricalApproval?"file-"+this.threadId:"perm-1";
          const details={threadId:this.threadId,turnId:this.turnId,itemId,cwd:this.options.cwd,...(scenario.misdirectHistoricalApproval
            ? {grantRoot:null,availableDecisions:['accept','decline'],operation:{type:'fileChange',id:itemId,status:'inProgress',changes:[{path:join(this.options.cwd,'synthetic-'+this.threadId+'.txt'),kind:{type:'add'},diff:'+Synthetic approval fixture'}]}}
            : {permissions:{network:null,fileSystem:{read:[this.options.cwd],write:null}}})};
          reply = await this.options.onInteraction!({ requestId, method: scenario.misdirectHistoricalApproval?"item/fileChange/requestApproval":"item/permissions/requestApproval", threadId: this.threadId, turnId: this.turnId, itemId, kind: "authorization", details });
          if (!scenario.skipDelivery) this.emit("interactionDelivered", requestId);
         } else {
          const continuation=new Promise(done=>{this.resumeQuestion=done;});
          const pending=await this.call("ask_main",{question:'合成问题 '+this.threadId+'：采用哪个格式？'});
          assert.equal(pending.status,'pending');
          if(scenario.skipDelivery)pausedWorkers.push(()=>this.resumeQuestion?.({status:'cancelled'}));
          reply=await continuation;
        }
        if (scenario.skipDelivery && mode!=="answer" && !scenario.business) await new Promise<void>(done => pausedWorkers.push(done));
        if (this.closed || reply.status === "cancelled" || reply.status === "expired") return { status: "interrupted", text: "stopped" };
        resumes.push(this.threadId);
        writeFileSync(join(this.options.cwd, "answer-" + this.threadId + ".md"), `# 合成成果\n${reply.answer ?? reply.decision?.action ?? reply.status}`);
        return { status: "completed", text: "Written" };
      }
      mainInputs.push(text);
      if (text === "dispatch") {
        for (let i = 0; i < workers; i++) {
          const {taskId}=await this.call("task_create",{title:(scenario.namedTask ? "整理 Markdown " : "按用户要求生成 Markdown ") + i,goal:"按用户要求生成 Markdown " + i});
          await this.call("worker_open",{taskId});
        }
      } else if (app["mainContext"]?.interactionId) {
        const id = app["mainContext"]!.interactionId!;
        interactionTurns.push(id);
        const item = await callEngineMcp(this, "inspect_interaction", { interactionId: id });
        const historical=scenario.misdirectHistoricalApproval&&app.interactions.list().find(other=>other.id!==id&&other.state==='approved'&&other.deliveredAt!==null);
        if(historical){
          const attempt={currentId:id,historicalId:historical.id,currentBefore:app.store.db.prepare('SELECT * FROM worker_interactions WHERE id=?').get(id),messageBefore:app.store.db.prepare("SELECT * FROM agent_messages WHERE kind='interaction_required' AND json_extract(payloadJson,'$.interactionId')=?").get(id),errors:[] as string[]};
          misdirected.push(attempt);
          for(let i=0;i<2;i++){
            try{await callEngineMcp(this,'respond_interaction',{interactionId:historical.id,action:'approve',reason:'Synthetic reply to the wrong historical approval'});attempt.errors.push('unexpectedly_accepted');}
            catch(error){attempt.errors.push((error as Error).message);}
          }
          return {status:'completed',text:''};
        }
        if(scenario.cancelBeforeDecision){app.interactions.cancelRun(item.runId,'synthetic_original_execution_ended');engines.find(e=>e.threadId===app.tasks.run(item.runId).threadId)?.resumeQuestion?.({status:'cancelled'});}
        if (scenario.handoff) {
          const path = join(workspace, "handoff-" + id + ".json");
          writeFileSync(path, JSON.stringify({ source: "synthetic", format: "Markdown" }));
          handoffs.push(path);
          this.emit("nativeProcess", { threadId: this.threadId, turnId: this.turnId, itemId: "handoff-" + id, category: "fileChange", status: "completed", completed: true, fileCount: 1 });
        }
        if (mode === "user" || mode === "hang") {
          await callEngineMcp(this, "escalate_interaction", { interactionId: id, question: `请指定 ${item.runId} 的格式`, reason: "合成歧义",...(scenario.business?{options:releaseOptions}:{}) });
          return scenario.reply ?? { status: "completed", text: `请指定 ${item.runId} 的格式。` };
        }
        if (scenario.skipDecision) return scenario.reply ?? { status: "completed", text: "已处理" };
        if (mode === "approve") {
          await callEngineMcp(this, "escalate_interaction", { interactionId: id, question: "确认范围", reason: "需要用户决定" });
          await assert.rejects(callEngineMcp(this, "respond_interaction", { interactionId: id, action: "approve", reason: "No user decision" }), /interaction_user_decision_required/);
          return {status:"completed",text:"需要用户确认。"};
        }
        await callEngineMcp(this, "respond_interaction", { interactionId: id, action: mode === "direct" ? "approve" : mode === "deny" ? "deny" : "answer", reason: "当前任务范围与材料足够判断", answer: mode === "answer" ? item.details.question : null, answers: null, permissions: mode === "direct" ? item.details.params.permissions : null });
        return scenario.reply ?? { status: "completed", text: "已处理" };
      } else if(scenario.business&&text.includes('[已接收的业务答复，用户内容]')){
        const id=/interactionId=([^。]+)/.exec(text)![1]!;
        await callEngineMcp(this,'inspect_interaction',{interactionId:id});
        if(scenario.clarify&&!text.includes('更正为等待设备验收')){
          const final={itemId:'clarification-'+this.turnId,phase:'final_answer',text:'请确认发布范围。'};
          this.emit('agentMessage',{...final,threadId:this.threadId,turnId:this.turnId,completed:true});
          return {status:'completed',text:final.text,messages:[final]};
        }
        await assert.rejects(callEngineMcp(this,'respond_interaction',{interactionId:id,action:'approve',reason:'业务答复不授权'}),/interaction_user_reply_required|interaction_response_kind/);
        await callEngineMcp(this,'respond_interaction',{interactionId:id,action:'answer',reason:'已核对用户决定',answer:scenario.longAnswer?'补'.repeat(12_000):'请按用户确认的范围处理。'});
      } else if (mode === "approve" && text.includes("[用户答复原待答]")) {
        const id = /interactionId=([^。]+)/.exec(text)![1]!;
        const item = await callEngineMcp(this, "inspect_interaction", { interactionId: id });
        assert.equal(item.state,'pending_user');assert.equal(item.responseUserText,'允许本次操作');
        assert.ok(item.responseUserMessageId);assert.ok(item.userQuestion);assert.ok(item.escalationReason);
        for (const permissions of [{network:{enabled:true}}, {fileSystem:{read:[resolve(item.details.params.cwd,"..")]}}]) {
          await assert.rejects(callEngineMcp(this, "respond_interaction", {interactionId:id,action:"approve",reason:"Overbroad",permissions}),/interaction_permission_scope/);
          assert.equal(app.interactions.inspect(id).state,"pending_user");
        }
        await callEngineMcp(this, "respond_interaction",{interactionId:id,action:"approve",reason:"应用用户的明确许可"});
      } else if (text === "empty-user-reply") {
        return { status: "completed", text: "" };
      } else if (text.startsWith("reply ")) {
        const id = text.slice(6).split(/\s/)[0]!;
        await callEngineMcp(this, "inspect_interaction", { interactionId: id });
        await callEngineMcp(this, "respond_interaction", { interactionId: id, action: "answer", reason: "用户补充", answer: "用户指定格式", answers: null, permissions: null });

      }
      return { status: "completed", text: "已处理" };
    }
    async interrupt() { return false; }
    async close() { this.closed = true;this.resumeQuestion?.({status:'cancelled'}); return true; }
  }
  app = new Homer(config, async message => { messages.push(message); }, (options, handler) => new Fake(options, handler));
  await app.start();
  return { app, config, messages, engines, resumes, workerAnswers, handoffs, interactionTurns, releaseWorkers, mainInputs, misdirected,
    events: () => app.store.db.prepare("SELECT type,code FROM events ORDER BY seq").all() as { type: string; code: string | null }[],
    async restart() {
      await app.close();
      app = new Homer(config, async message => { messages.push(message); }, (options, handler) => new Fake(options, handler));
      await app.start();
      return app;
    },
    async cleanup() { releaseWorkers(); await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

async function approveRequested(f:Awaited<ReturnType<typeof fixture>>,count:number){
  await until(() => f.app.interactions.list().filter(item=>item.state==="pending_user").length===count);
  const cards=await homerWebBridge(f.app).history!.interactions(0,f.app.webReadEpoch);
  assert.equal(cards.items.length,count);assert.equal(f.resumes.length,0);
  for(const [index,card] of cards.items.entries())f.app.submitMessage({requestId:"approval-"+index,interactionId:card.id,text:"允许本次操作"});
}

test('a validated matter reference reaches the actual Main turn with the original user text',async()=>{
 const f=await fixture('answer');
 try{
  await f.app.message('dispatch','task-reference-source');
  await f.app.idle();
  const row=f.app.store.db.prepare('SELECT id,headVersion,title FROM tasks LIMIT 1').get()!;
  const taskReference={taskId:String(row.id),version:Number(row.headVersion),title:String(row.title)};
  const input={requestId:'task-reference-followup',text:'补充遗漏的测试结果。',taskReference};
  assert.throws(()=>f.app.submitMessage({...input,taskReference:{...taskReference,title:'伪造标题'}}),/task_reference_stale/);
  const receipt=f.app.submitMessage(input);
  assert.equal(receipt.fresh,true);
  await f.app.idle();
  const actual=f.mainInputs.find(text=>text.endsWith(input.text))!;
  assert.ok(actual.includes(JSON.stringify({...taskReference,state:'open'})));
  assert.ok(actual.includes('引用本身不授权任何操作'));
  assert.equal(f.app.submitMessage(input).fresh,false);
  assert.deepEqual(f.app.history.inputs(f.app.store.meta('mainThread')!,[input.requestId]).get(input.requestId)?.taskReference,taskReference);
 }finally{await f.cleanup();}
});

test('Main approves native Worker requests through its MCP without showing user cards',async()=>{
  const f=await fixture('direct',2,{reply:{status:'completed',text:''}});
  try{
    await f.app.message('dispatch','user-task');
    await until(()=>f.resumes.length===2||f.events().some(event=>event.type==='internal_processing_failed'));
    assert.equal(f.resumes.length,2);
    await f.app.idle();
    const items=f.app.interactions.list();assert.equal(items.length,2);
    for(const item of items){
      const decided=f.app.interactions.inspect(item.id);
      assert.equal(decided.state,'approved');assert.ok(decided.details.review);assert.ok(decided.deliveredAt);
      assert.equal(decided.userQuestion,null);assert.equal(decided.responseUserMessageId,null);
    }
    assert.equal((await homerWebBridge(f.app).history!.interactions(0,f.app.webReadEpoch)).items.length,0);
    assert.equal(f.messages.filter(message=>message.type==='reply').length,1);
    assert.ok(f.app.store.runs().every(run=>run.status==='succeeded'));
  }finally{await f.cleanup();}
});

// Synthetic regression derived from a completed Worker decision followed by an
// empty main reply; no production requests, file contents or identifiers.
for (const mode of ["answer", "approve", "deny"] as const) {
  test(`HMR-INTERACTION-002: delivered ${mode} completes silent collaboration without replaying file writes`, async () => {
    const f = await fixture(mode, 2, { reply: { status: "completed", text: "" }, handoff: true });
    try {
      await f.app.message("dispatch", "user-task");
      if(mode==="approve")await approveRequested(f,2);
      await f.app.idle();
      const interactions = f.app.interactions.list();
      assert.equal(interactions.length, 2);
      assert.ok(interactions.every(item => item.state === (mode === "answer" ? "answered" : mode === "approve" ? "approved" : "denied") && item.deliveredAt !== null));
      assert.equal(f.messages.filter(message => message.type === "reply").length, mode==="approve"?3:1, "only actual user requests get public replies");
      assert.equal(f.resumes.length, 2);
      assert.ok(f.app.store.runs().every(run => run.status === "succeeded"));
      assert.equal(f.handoffs.length, 2);
      assert.equal(new Set(f.interactionTurns).size, 2);
      assert.equal(f.interactionTurns.length, 2);
      for (const path of f.handoffs) assert.equal(JSON.parse(readFileSync(path, "utf8")).source, "synthetic");
      assert.ok(!f.events().some(event => event.type === "internal_processing_failed" || event.type === "main_turn_failed"));
    } finally { await f.cleanup(); }
  });
}

test('explicit user recovery answers the original live request without requeuing its received notice',async()=>{
 const f=await fixture('answer',1,{skipDecision:true,reply:{status:'completed',text:''}});
 try{
  await f.app.message('dispatch','synthetic-dispatch');
  await until(()=>f.app.processes.list(f.app.store.meta('mainThread')!).some(node=>node.sourceKind==='worker'&&node.status==='completed'));
  const item=f.app.interactions.list()[0]!,query=f.app.store.db.prepare("SELECT m.id,r.state FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='interaction_required' AND json_extract(m.payloadJson,'$.interactionId')=?");
  const before=query.get(item.id)!;
  await f.app.message('reply '+item.id,'synthetic-recovery');
  assert.equal(f.app.interactions.inspect(item.id).state,'answered');
  await f.app.idle();assert.equal(f.resumes.length,1);
  assert.deepEqual(query.get(item.id),before);assert.equal(before.state,'received');
  assert.equal(f.interactionTurns.length,1,'recovery is a new user round, never a second delivery of the notice');
  assert.equal(f.app.store.runs().length,1);
 }finally{await f.cleanup();}
});

test('a cancelled original callback can be consumed silently without dropping the delivered notice',async()=>{
 const f=await fixture('answer',1,{skipDecision:true,cancelBeforeDecision:true,reply:{status:'completed',text:''}});
 try{
  await f.app.message('dispatch','synthetic-stale');await f.app.idle();
  assert.equal(f.app.interactions.list()[0]!.state,'cancelled');
  assert.equal(f.resumes.length,0);
  assert.equal(f.events().filter(row=>row.code==='main_empty_reply').length,0);
  assert.equal(f.app.store.db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='interaction_required'").get()!.state,'received');
 }finally{await f.cleanup();}
});

test('mailbox receipt remains received when a nonempty reply fails to handle a live approval',async()=>{
 const f=await fixture('direct',1,{skipDecision:true,reply:{status:'completed',text:'Synthetic statement without decision'}});
 try{
  await f.app.message('dispatch','synthetic-pending');
  await until(()=>f.events().some(event=>event.type==='internal_processing_failed'));
  const item=f.app.interactions.list()[0]!;assert.equal(item.state,'pending_main');
  const receipt=f.app.store.db.prepare("SELECT r.state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='interaction_required' AND json_extract(m.payloadJson,'$.interactionId')=?").get(item.id)!;
  assert.equal(receipt.state,'received');
  assert.equal(f.app.upgradeStatus().safe,false);
  assert.equal(f.app.processes.list(f.app.store.meta('mainThread')!).find(node=>node.sourceKind==='worker')!.status,'failed');
 }finally{await f.cleanup();}
});

test('replying to a historical approval after inspecting the current one preserves received delivery and failed history',async()=>{
 const f=await fixture('direct',1,{namedTask:true,misdirectHistoricalApproval:true});
 try{
  await f.app.message('empty-user-reply','synthetic-earlier-failure');
  await f.app.message('dispatch','synthetic-historical-approval');await f.app.idle();
  const db=f.app.store.db,thread=f.app.store.meta('mainThread')!;
  const interaction=db.prepare('SELECT * FROM worker_interactions WHERE id=?');
  const receipt=db.prepare("SELECT m.id,r.state,r.revision,r.offeredTurnId FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='interaction_required' AND json_extract(m.payloadJson,'$.interactionId')=?");
  const storedProcess=db.prepare('SELECT value FROM meta WHERE key=?');
  const historical=f.app.interactions.list()[0]!,historicalBefore=interaction.get(historical.id),historicalReceipt=receipt.get(historical.id);
  assert.equal(historical.state,'approved');assert.ok(historical.deliveredAt);
  const priorFailure=f.app.processes.list(thread).find(node=>node.status==='failed')!;
  assert.ok(priorFailure);const priorFailureBefore=storedProcess.get('publicMainNode:v1:'+priorFailure.id),priorEvents=f.events();
  assert.equal(f.resumes.length,1);

  await f.app.message('dispatch','synthetic-current-approval');
  await until(()=>f.events().some(event=>event.type==='internal_processing_failed'&&event.code==='main_empty_reply'));
  assert.equal(f.misdirected.length,1);
  const attempt=f.misdirected[0]!;
  assert.notEqual(attempt.currentId,attempt.historicalId);assert.equal(attempt.historicalId,historical.id);
  assert.deepEqual(attempt.errors,['interaction_inspection_required','interaction_inspection_required']);
  const current=f.app.interactions.inspect(attempt.currentId);
  assert.equal(current.details.method,'item/fileChange/requestApproval');
  assert.notEqual(f.app.tasks.run(current.runId).taskId,f.app.tasks.run(historical.runId).taskId);
  assert.deepEqual(interaction.get(current.id),attempt.currentBefore);
  assert.equal(current.state,'pending_main');assert.equal(current.decision,null);assert.equal(current.deliveredAt,null);
  assert.deepEqual(interaction.get(historical.id),historicalBefore);
  assert.deepEqual(receipt.get(historical.id),historicalReceipt);
  assert.deepEqual(db.prepare('SELECT * FROM agent_messages WHERE id=?').get((attempt.messageBefore as {id:string}).id),attempt.messageBefore);
  assert.deepEqual(f.events().slice(0,priorEvents.length),priorEvents);
  const received=receipt.get(current.id)!;assert.equal(received.state,'received');
  const failed=f.app.processes.list(thread).find(node=>node.sourceMessageIds.includes(String(received.id)))!;
  assert.equal(failed.state,'worked');assert.equal(failed.status,'failed');
  assert.ok(failed.turnIds.includes(String(received.offeredTurnId)));
  assert.deepEqual(failed.items.flatMap(item=>item.kind==='tool'&&item.toolName==='respond_interaction'?[item.status]:[]),['failed','failed']);
  const failedBefore=storedProcess.get('publicMainNode:v1:'+failed.id),eventsBefore=f.events();

  assert.equal(await f.app.message('Independent synthetic follow-up','synthetic-independent'),'已处理');
  assert.deepEqual(receipt.get(current.id),received);
  assert.deepEqual(interaction.get(current.id),attempt.currentBefore);
  assert.deepEqual(interaction.get(historical.id),historicalBefore);
  assert.deepEqual(receipt.get(historical.id),historicalReceipt);
  assert.deepEqual(storedProcess.get('publicMainNode:v1:'+priorFailure.id),priorFailureBefore);
  assert.deepEqual(storedProcess.get('publicMainNode:v1:'+failed.id),failedBefore);
  assert.deepEqual(f.events().slice(0,eventsBefore.length),eventsBefore);
  assert.equal(f.interactionTurns.filter(id=>id===current.id).length,1);
  assert.equal(f.resumes.length,1,'the pending callback and completed historical callback are not replayed');
  assert.equal(f.app.tasks.run(current.runId).phase,'rpc_wait');
  assert.equal(f.app.store.runs().length,2);
  assert.equal(db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='interaction_required' AND json_extract(payloadJson,'$.interactionId')=?").get(current.id)!.n,1);
 }finally{await f.cleanup();}
});

test("HMR-INTERACTION-002: an unanswered business question can stay pending after a silent internal turn", async () => {
  const f = await fixture("answer", 1, { reply: { status: "completed", text: "" }, skipDecision: true, handoff: true });
  try {
    await f.app.message("dispatch", "user-task");
    await until(()=>f.app.processes.list(f.app.store.meta('mainThread')!).some(node=>node.sourceKind==='worker'&&node.status==='completed'));
    assert.equal(f.app.interactions.list()[0]?.state, "pending_main","silent coordination preserves the original question for recovery");
    assert.equal(f.resumes.length, 0);
    assert.equal(f.handoffs.length, 1);
    assert.equal(JSON.parse(readFileSync(f.handoffs[0]!, "utf8")).source, "synthetic");
    assert.ok(!f.events().some(event => event.type === "internal_processing_failed"));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: a decision without delivery confirmation does not excuse an empty reply", async () => {
  const f = await fixture("answer", 1, { reply: { status: "completed", text: "" }, skipDelivery: true });
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.events().some(event => event.type === "internal_processing_failed"));
    assert.equal(f.app.interactions.list()[0]?.deliveredAt, null);
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "main_empty_reply"));
    f.releaseWorkers(); await f.app.idle();
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: escalation still requires a nonempty user question", async () => {
  const f = await fixture("user", 1, { reply: { status: "completed", text: "" } });
  try {
    await f.app.message("dispatch", "user-task");
    await until(()=>f.events().some(event=>event.type==='internal_processing_failed'));
    assert.equal(f.app.interactions.list()[0]?.state, "pending_user");
    assert.equal(f.messages.filter(message => message.type === "question").length, 0);
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "main_empty_reply"));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: native failure after a delivered decision remains failed without replay", async () => {
  const f = await fixture("answer", 1, { reply: { status: "failed", text: "", errorCode: "synthetic_native_failure" }, handoff: true });
  try {
    await f.app.message("dispatch", "user-task"); await f.app.idle();
    const item = f.app.interactions.list()[0]!;
    assert.equal(item.state, "answered"); assert.notEqual(item.deliveredAt, null);
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "synthetic_native_failure"));
    assert.equal(f.handoffs.length, 1); assert.equal(f.interactionTurns.length, 1);
    assert.equal(JSON.parse(readFileSync(f.handoffs[0]!, "utf8")).source, "synthetic");
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: ordinary user turns still reject an empty reply", async () => {
  const f = await fixture("answer");
  try {
    assert.match(await f.app.message("empty-user-reply", "empty-request"), /main_empty_reply/);
    assert.ok(f.app.history.list(f.app.store.meta("mainThread")!).some(message => message.requestId === "empty-request" && message.role === "assistant" && message.status === "failed"));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: service main answers and original two Workers finish without cross-routing", async () => {
  const f = await fixture("answer", 2, {namedTask:true});
  try {
    await f.app.message("dispatch", "user-task"); await f.app.idle();
    assert.equal(f.resumes.length, 2);
    assert.ok(f.app.store.runs().every(run => run.status === "succeeded"));
    for (const run of f.app.store.runs()) assert.ok(readFileSync(join(f.config.workspace, "answer-" + run.threadId + ".md"), "utf8").includes(run.threadId!));
    assert.equal(f.app.interactions.list().length, 2);
    assert.ok(f.app.interactions.list().every(item => item.deliveredAt !== null));
    assert.deepEqual(f.app.tasks.tasks().map(task=>task.title).sort(),["整理 Markdown 0","整理 Markdown 1"]);
    assert.deepEqual(f.app.tasks.tasks().map(task=>f.app.tasks.version(task.id,task.headVersion).goal).sort(),["按用户要求生成 Markdown 0","按用户要求生成 Markdown 1"]);
    const mainTools=f.engines.find(engine => !engine.worker)!.options.interactionMcp!.catalog!.map(tool=>tool.name);
    assert.ok(mainTools.includes("task_create")&&mainTools.includes("worker_open"));assert.ok(!mainTools.includes("dispatch_work"));
    const prompts = loadPrompts();
    assert.ok(f.engines.find(engine => !engine.worker)!.options.instructions.startsWith(prompts.main));
    assert.ok(f.engines.filter(engine => engine.worker).every(engine => engine.options.instructions.startsWith(prompts.worker)));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: user escalation keeps Worker alive beyond timeout and main accepts unrelated messages", async () => {
  const f = await fixture("user", 2);
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.app.interactions.list().filter(item=>item.state==='pending_user').length===2);
    const pending = f.app.interactions.list();
    assert.deepEqual((await homerWebBridge(f.app).history!.interactions(0,f.app.webReadEpoch)).items.map(card=>card.id).sort(),pending.map(item=>item.id).sort());
    assert.equal(f.app.upgradeStatus().safe, false, "waiting Workers retain ownership and block automatic upgrades");
    await new Promise(done => setTimeout(done, 200));
    assert.ok(f.app.store.runs().every(run => run.status === "running"));
    assert.equal(await f.app.message("unrelated chat", "other-message"), "已处理");
    assert.equal(f.resumes.length, 0);
    assert.ok(pending.every(item=>f.mainInputs.at(-1)!.includes(item.id)), "ordinary conversation discovers both pending questions without auto-answering either");
    await f.app.message("reply " + pending[1]!.id, "user-answer-b");
    await until(() => f.resumes.length === 1);
    assert.equal(f.app.interactions.inspect(pending[0]!.id).state, "pending_user");
    assert.equal(f.app.upgradeStatus().safe, false, "one remaining user question still blocks handoff");
    await f.app.message("reply " + pending[0]!.id, "user-answer-a");
    await f.app.idle();
    assert.equal(f.app.upgradeStatus().safe, true);
    assert.ok(f.app.store.runs().every(run => run.status === "succeeded"));
    assert.equal(f.app.interactions.inspect(pending[1]!.id).responseUserMessageId, "user-answer-b");
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: actual service native approvals and denials return to the owning Worker", async () => {
  for (const mode of ["approve", "deny"] as const) {
    const f = await fixture(mode);
    try {
      await f.app.message("dispatch", "user-task");
      if(mode==="approve")await approveRequested(f,1);
      await f.app.idle();
      const item = f.app.interactions.list()[0]!;
      assert.equal(item.state, mode === "approve" ? "approved" : "denied");
      assert.equal(f.resumes.length, 1);
      assert.equal(f.app.store.runs()[0]!.status, "succeeded");
    } finally { await f.cleanup(); }
  }
});

test("HMR-INTERACTION-001: stop invalidates pending questions and rejects stale responses", async () => {
  const f = await fixture("hang");
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.app.interactions.list()[0]?.state === "pending_user");
    const item = f.app.interactions.list()[0]!;
    await f.app.stop(item.runId);
    assert.equal(f.app.interactions.inspect(item.id).state, "cancelled");
    assert.equal(f.app.store.run(item.runId)!.status, "cancelled");
    assert.throws(() => f.app.interactions.respond(item.id, { action: "answer", answer: "late", reason: "late" }), /interaction_not_live/);
    assert.equal(f.resumes.length, 0);
    assert.equal(JSON.stringify(f.app.store.events(item.runId)).includes("合成问题"), false);
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: restart reconciles lost callbacks and preserves the original main thread", async () => {
  const f = await fixture("hang");
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.app.interactions.list()[0]?.state === "pending_user");
    assert.equal(await f.app.idle({ returnOnUserWait: true }), "waiting_user");
    const item = f.app.interactions.list()[0]!, thread = f.app.store.meta("mainThread");
    await f.app.close();
    // Recreate only synthetic persisted crash state; no live process is adopted.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(f.config.runtime, "homer.sqlite"));
    db.prepare("UPDATE runs SET status='running',endedAt=NULL,stopRequestedAt=NULL,stopReason=NULL WHERE id=?").run(item.runId);
    db.prepare("UPDATE worker_interactions SET state='pending_user',code=NULL,decision=NULL,deliveredAt=NULL WHERE id=?").run(item.id);
    db.close();
    const workerCount = f.engines.filter(engine => engine.worker).length;
    const reopened = await f.restart();
    assert.equal(reopened.store.meta("mainThread"), thread);
    assert.equal(reopened.store.run(item.runId)!.status, "interrupted");
    assert.equal(reopened.interactions.inspect(item.id).state, "cancelled");
    assert.equal(reopened.interactions.inspect(item.id).code, "worker_turn_ended");
    assert.throws(() => reopened.interactions.respond(item.id, { action: "answer", answer: "late", reason: "late" }), /interaction_not_live/);
    assert.equal(f.engines.filter(engine => engine.worker).length, workerCount);
    assert.equal(f.resumes.length, 0);
  } finally { await f.cleanup(); }
});

test('desktop receives distinct user-pending IDs and locates a live target beyond the first page',async()=>{
 const f=await fixture('user',2);
 try{
  const received:string[]=[];
  f.app.onDesktopNotification(event=>{
   if(event.kind==='interaction'){
    assert.equal(event.body,'有问题等待回复');
    received.push(event.id);
   }
  });
  await f.app.message('dispatch','notification-source');
  await until(()=>received.length===2);
  assert.notEqual(received[0],received[1]);
  const {db}=f.app.store;
  const target=received[1]!;
  db.prepare('UPDATE worker_interactions SET rowid=1000 WHERE id=?').run(target);
  db.prepare(`WITH RECURSIVE filler(n) AS (VALUES(100) UNION ALL SELECT n+1 FROM filler WHERE n<179)
   INSERT INTO worker_interactions(rowid,id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt)
   SELECT n,'synthetic-'||n,'notice-filler-'||n,'filler',w.runId,w.threadId,w.turnId,w.requestId,w.source,w.kind,w.details,w.authority,
     'pending_user',w.createdAt,w.updatedAt FROM filler CROSS JOIN worker_interactions w WHERE w.id=?`).run(target);
  const history=homerWebBridge(f.app).history!,epoch=f.app.webReadEpoch;
  const first=await history.interactions(0,epoch);
  assert.equal(first.items.length,80);
  assert.equal(first.items.some(item=>item.id===target),false);
  const page=await history.interactions(0,epoch,target);
  assert.equal(page.items[0]?.id,target);
  assert.equal(page.cursor,999);
  f.app.interactions.cancelRun(f.app.interactions.inspect(target).runId,'synthetic_cancelled');
  await assert.rejects(history.interactions(0,epoch,target),/interaction_not_live/);
 }finally{await f.cleanup();}
});

test('business options and targeted free answers bind once and reach both agents with their complete text',async()=>{
 for(const choice of [...releaseOptions,undefined]){
  const f=await fixture('user',1,{business:true});
  try{
   await f.app.message('dispatch','business-source');
   await until(()=>f.app.interactions.list()[0]?.state==='pending_user');
   const item=f.app.interactions.list()[0]!;
   const bridge=homerWebBridge(f.app),send=createWebChat(bridge);
   const submit=(input:object)=>send('interactions.respond',{id:item.id,input});
   assert.deepEqual((await bridge.history!.interactions(0,f.app.webReadEpoch)).items[0]?.options,releaseOptions);
   await assert.rejects(submit({requestId:'invalid-choice',optionId:'missing'}),/interaction_answer_scope/);
   const answer=choice?{requestId:'selected',optionId:choice.id}:{requestId:'selected',text:'可以先验收所有平台，保留当前发布。'};
   const competing={requestId:'other-answer',text:'另一端同时提交的自由答复'};
   const [first,second]=await Promise.allSettled([submit(answer),submit(competing)]);
   assert.equal(first.status,'fulfilled');assert.equal(second.status,'rejected');
   assert.equal(f.app.interactions.inspect(item.id).responseUserMessageId,'selected');
   assert.equal((await bridge.history!.interactions(0,f.app.webReadEpoch)).items.length,0);
   await until(()=>f.workerAnswers.length===1);
   const expected=choice?[choice.label,choice.description]:['可以先验收所有平台，保留当前发布。'];
   for(const part of expected){
    assert.ok(f.mainInputs.some(text=>text.includes(part)));
    assert.ok(f.workerAnswers[0]?.includes(part));
   }
   assert.equal((await submit(answer) as {fresh:boolean}).fresh,false);
   await assert.rejects(submit({...answer,...(choice?{optionId:choice.id==='wait'?'publish':'wait'}:{text:'不同答复'})}),/request_id_conflict/);
   assert.equal(f.workerAnswers.length,1);
  }finally{await f.cleanup();}
 }
});

test('quoted clarification keeps the original receipt and sends the corrected decision before first dispatch',async()=>{
 const f=await fixture('user',1,{business:true,clarify:true});
 try{
  await f.app.message('dispatch','clarify-source');
  await until(()=>f.app.interactions.list()[0]?.state==='pending_user');
  const item=f.app.interactions.list()[0]!;
  const accepted=f.app.submitBusinessOption(item.id,{requestId:'initial-option',optionId:'publish'});
  await until(()=>f.app.history.message(accepted.replyId)?.text==='请确认发布范围。');
  assert.equal(f.workerAnswers.length,0);
  const thread=f.app.store.meta('mainThread')!;
  const clarification=f.app.webHistoryPages().read(thread).messages.find(message=>
   message.process?.replyMessageId===accepted.replyId&&message.text.includes('请确认发布范围。'));
  assert.ok(clarification,'the quoted source is the user-visible Main clarification');
  await f.app.message('更正为等待设备验收，验收后再公开。','correction',{messageId:clarification.id,text:'请确认发布范围。'});
  await until(()=>f.workerAnswers.length===1);
  assert.match(f.workerAnswers[0]!,/更正为等待设备验收，验收后再公开。/);
  assert.match(f.workerAnswers[0]!,/后续决定为准/);
  const record=f.app.interactions.inspect(item.id);
  assert.equal(record.responseUserMessageId,'initial-option');
  assert.equal(record.decision?.clarification?.requestId,'correction');
  assert.match(record.responseUserText!,/保留 v0.1.22/);
 }finally{await f.cleanup();}
});

test('an unknown delivery is preserved and a replay of the accepted answer does not resubmit it',async()=>{
 const f=await fixture('user',1,{business:true,skipDelivery:true});
 try{
  await f.app.message('dispatch','unknown-source');
  await until(()=>f.app.interactions.list()[0]?.state==='pending_user');
  const item=f.app.interactions.list()[0]!,input={requestId:'unknown-choice',optionId:'wait'};
  f.app.submitBusinessOption(item.id,input);
  await until(()=>f.app.tasks.questionDelivery(item.id,f.app.tasks.run(item.runId).taskId)?.state==='uncertain');
  assert.equal(f.app.interactions.inspect(item.id).deliveredAt,null);
  assert.equal(f.app.submitBusinessOption(item.id,input).fresh,false);
  assert.equal(f.workerAnswers.length,1);
  const reopened=await f.restart();
  assert.equal(reopened.submitBusinessOption(item.id,input).fresh,false);
  assert.equal(reopened.interactions.inspect(item.id).deliveredAt,null);
  assert.equal(f.workerAnswers.length,1);
 }finally{await f.cleanup();}
});

test('an accepted maximum-length free answer reaches the Worker with the separate Main note',async()=>{
 const f=await fixture('user',1,{business:true,longAnswer:true});
 try{
  await f.app.message('dispatch','long-source');
  await until(()=>f.app.interactions.list()[0]?.state==='pending_user');
  const item=f.app.interactions.list()[0]!,text='答'.repeat(16_000);
  f.app.submitMessage({requestId:'long-reply',interactionId:item.id,text});
  await until(()=>f.workerAnswers.length===1);
  assert.ok(f.workerAnswers[0]!.includes(text));
  assert.ok(f.workerAnswers[0]!.includes('补'.repeat(12_000)));
 }finally{await f.cleanup();}
});
