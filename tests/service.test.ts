import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Homer, type Message } from "../src/service.js";
import { Store } from "../src/store.js";
import type { Config } from "../src/config.js";
import type { EngineLike, EngineOptions, ToolCall, TurnResult } from "../src/engine.js";
import { MEETING_REVISION, assertMeetingArtifact } from "./scenarios/meeting-revision.js";
const tick = () => new Promise((r) => setTimeout(r, 10));
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error("test_wait_timeout"); await tick(); }
}
let sequence = 0;
const cleanup: (()=>Promise<void>)[]=[];
after(async()=>{for(const close of cleanup)await close();});
function reply(app:Homer,runId:string){
  const run=app.tasks.run(runId);
  return app.history.list(app.store.meta('mainThread')!).find(message=>message.taskId===run.taskId&&message.taskVersion===run.version&&message.role==='assistant'&&message.audience==='user');
}
function attachment(app:Homer,runId:string){
  const message=reply(app,runId)!;
  return app.readAttachment({messageId:message.id,...message.attachments![0]!});
}
function attachmentText(app:Homer,runId:string){
  return Buffer.from(attachment(app,runId).data,'base64').toString('utf8');
}
function fixture(
  name: string,
  mode: "normal" | "hang" | "unconfirmed" | "failed" | "empty" | "start-fail" = "normal",
  timeoutMs = 5000,
) {
  const scratch=resolve(".codex/scratch/e-service");mkdirSync(scratch,{recursive:true});
  const base=mkdtempSync(join(scratch,name.slice(0,20)+"-"));
  mkdirSync(base + "/workspace", { recursive: true });mkdirSync(base + "/runtime", { recursive: true });
  writeFileSync(base + "/workspace/meeting.md","林青：写初稿，2026-10-20。整理反馈：负责人和时间待确认。");
  const config: Config = {
    workspace: base + "/workspace",runtime: base + "/runtime",codexBin: "/usr/bin/false",codexHome: base + "/engine",nativeCodexHome:base+"/engine",
    model: "mock-only",requiresOpenaiAuth: false,timeoutMs,mainTimeoutMs: 1000,stopGraceMs: 100,
  };
  const messages: Message[] = [],scriptedMessages = new Map<string, Record<string, any>>(),workerDocuments: string[] = [],workerEngines: Fake[] = [],engineOptions: EngineOptions[] = [];
  let active = 0,maxActive = 0,outputFails=false,outputAttempts=0,progressFails = false,mainStopFails = false,mainDeliveryFails = false,mainDeliveryEmpty = false;
  let deliveryGate: Promise<void> | undefined,releaseDelivery: (() => void) | undefined,deliveryWaiting = false;
  class Fake extends EventEmitter implements EngineLike {
    threadId = "mock-thread-" + ++sequence;turnId?: string;release?: () => void;pendingResolve?: (r: TurnResult) => void;isWorker: boolean;failureCode?:string;
    constructor(readonly options: EngineOptions,readonly tool: (call: ToolCall) => Promise<unknown>) {
      super();this.threadId=options.threadId??this.threadId;this.isWorker=options.role==="worker";if(this.isWorker)workerEngines.push(this);
    }
    async start() {if(mode==="start-fail"&&!this.isWorker)throw Error("mock_start_failed");return this.threadId;}
    async call(tool:string,args:unknown):Promise<any>{
      return this.tool({threadId:this.threadId,turnId:this.turnId!,callId:"call-"+ ++sequence,tool,arguments:args});
    }
    async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId="mock-turn-"+ ++sequence;options?.onStarted?.(this.turnId);
      if(this.isWorker){
        active++;maxActive=Math.max(maxActive,active);
        try{
          if(mode==="hang"||mode==="unconfirmed")return await new Promise<TurnResult>(resolve=>{this.pendingResolve=resolve;});
          await new Promise<void>(resolve=>{this.release=resolve;});
          if(mode==="failed"||this.failureCode)throw Error(this.failureCode??"mock_engine_failed");
          let filePath:string|undefined;
          if(mode!=="empty"){
            const run=app.store.runs().find(run=>run.turnId===this.turnId)!;
            filePath=join(this.options.cwd,run.id+'-actions.md');
            writeFileSync(filePath,workerDocuments.shift()??"# 行动清单\n\n- 林青：写初稿，2026-10-20\n- 待确认：整理反馈；负责人和时间待确认。");
          }
          return {status:"completed",text:filePath?JSON.stringify({message:"已写入",filePath}):"No file produced",usage:{total:{totalTokens:10}}};
        }finally{active--;}
      }
      if(text.startsWith("[内部协作输入")){
        const notice=JSON.parse(text.split("\n")[1]!);
        if(notice.kind!=="worker_reply")return {status:"completed",text:""};
        const read=await this.call("worker_read",{workerId:notice.workerId,messageId:notice.messageId}),original=read.messages[0];
        const execution=original.payload.execution;let filePath:string|undefined;
        try{filePath=JSON.parse(original.text).filePath;}catch{}
        if(execution.status!=="completed"||!filePath){
          const reason=execution.errorCode??"artifact_missing";
          await this.call("task_update",{taskId:notice.taskId,notes:reason});
          if(!["interrupted","unconfirmed"].includes(execution.status))await this.call("task_update",{taskId:notice.taskId,action:"settle",outcome:"failed",notes:reason});
          if(mainDeliveryFails)throw Error("mock_main_disconnected");
          if(mainDeliveryEmpty)return {status:"completed",text:""};
          return {status:"completed",text:"已核对执行状态："+reason};
        }
        if(mainDeliveryFails)throw Error("mock_main_disconnected");
        if(mainDeliveryEmpty)return {status:"completed",text:""};
        if(deliveryGate&&!deliveryWaiting){deliveryWaiting=true;await deliveryGate;}
        await this.call("send_user_message",{taskId:notice.taskId,attachments:[{path:filePath}],text:"已核对并发送行动清单。"});
        return {status:"completed",text:"This text must not overwrite the committed user message."};
      }
      const p=scriptedMessages.get(text)??JSON.parse(text);
      const dispatch=async(title=p.title??"会议")=>{
        if(p.taskId){
          const existing=await this.call("work_inspect",{taskId:p.taskId});
          await this.call("task_update",{taskId:p.taskId,goal:p.goal??"按新要求整理行动清单"});
          return this.call("worker_send",{workerId:existing.workers[0].workerId,message:"按新要求整理行动清单"});
        }
        const material=p.material??"meeting.md";
        return this.call("worker_open",{message:title+"：整理 "+material+" 的行动清单",attachments:[{path:resolve(config.workspace,material)}]});
      };
      if(p.action==="dispatch_many"){
        const results=[];for(const title of ["第一件","第二件","第三件"])results.push(await dispatch(title));
        return {status:"completed",text:JSON.stringify(results)};
      }
      if(p.action==="dispatch")return {status:"completed",text:JSON.stringify(await dispatch())};
      if(p.action==="stop"){
        const run=app.tasks.run(p.id);await this.call("worker_interrupt",{workerId:run.workerId});
        const read=await this.call("worker_read",{workerId:run.workerId});
        return {status:"completed",text:JSON.stringify(read.runs.find((row:any)=>row.id===run.id))};
      }
      if(p.action==="status"){
        const page=await this.call("list_work",{}),runs=[];
        for(const task of page.tasks){const facts=await this.call("work_inspect",{taskId:task.id});runs.push(...facts.workers.map((worker:any)=>worker.run));}
        return {status:"completed",text:JSON.stringify({...page,runs})};
      }
      return {status:"completed",text:p.text??"记住了"};
    }
    async interrupt(){return false;}
    async close(){
      this.pendingResolve?.({status:"interrupted",text:""});this.release?.();
      return this.isWorker?mode!=="unconfirmed":!mainStopFails;
    }
  }
  const app=new Homer(config,async message=>{
    if(progressFails&&message.type==="progress")throw Error("sink_closed");
    if(message.type==='reply'&&message.messageId&&!message.requestId){
      outputAttempts++;
      if(outputFails)throw Error('sink_closed');
    }
    messages.push(message);
  },(options,handle)=>{engineOptions.push(options);return new Fake(options,handle);});
  cleanup.push(async()=>{mainStopFails=false;await app.close().catch(()=>{});rmSync(base,{recursive:true,force:true});});
  return {app,messages,workerEngines,engineOptions,
    respondTo(message:string,response:Record<string,unknown>){scriptedMessages.set(message,response);},
    workerWrites(...documents:string[]){workerDocuments.push(...documents);},
    get maxActive(){return maxActive;},
    get outputAttempts(){return outputAttempts;},failOutput(){outputFails=true;},
    failMainStop(){mainStopFails=true;},emptyMainDelivery(){mainDeliveryEmpty=true;},
    failMainDelivery(){mainDeliveryFails=true;},failProgress(){progressFails=true;},
    pauseDelivery(){deliveryGate=new Promise<void>(resolve=>{releaseDelivery=resolve;});},
    releaseDelivery(){releaseDelivery?.();},get deliveryWaiting(){return deliveryWaiting;},
  };
}

test("HMR-MEETING-001: offline host regression runs dispatch, live query, delivery and immutable revision", async () => {
  const scenario = MEETING_REVISION;
  const f = fixture(scenario.id);
  const a = f.app;
  const m = scenario.messages;
  // Scripted peer responses are synthetic. Natural-language tool selection is checked only in test:real.
  copyFileSync(
    scenario.fixture.path,
    join(a.config.workspace,scenario.fixture.filename),
  );
  f.respondTo(m.remember, { action: "chat", text: "收到" });
  f.respondTo(m.recall, { action: "chat", text: "海鸥47" });
  f.respondTo(m.dispatch, {
    action: "dispatch",
    material: scenario.fixture.filename,
  });
  f.respondTo(m.progress, { action: "status" });
  const boundaries =
    "\n## 仅讨论\n帮助文档：周五讨论，未形成行动承诺。\n## 暂缓\n预算申请暂缓，不表示已批准。\n";
  f.workerWrites(
    "# 行动清单\n| 行动 | 负责人 | 时间 |\n| 初稿 | 林青 | 2026-10-20 前 |\n| 检查导出流程 | 陈舟 | 待确认 |\n| 整理试用反馈 | 待确认 | 待确认 |\n" +
      boundaries,
    "# 按负责人分组\n## 林青\n初稿：2026-10-20 前。\n## 陈舟\n检查导出流程：日期待确认。\n## 负责人及时间待确认\n整理试用反馈：负责人和日期待确认。\n" +
      boundaries,
  );
  try {
    await a.start();
    await a.message(m.remember, scenario.id + ":remember");
    assert.match(await a.message(m.recall, scenario.id + ":recall"), /海鸥47/);
    assert.equal(a.store.runs().length, 0);
    await a.message(m.dispatch, scenario.id + ":dispatch");
    await until(() => !!f.workerEngines[0]?.release);
    const progress = JSON.parse(
      await a.message(m.progress, scenario.id + ":query"),
    );
    assert.equal(progress.runs[0].status, "running");
    f.workerEngines[0]!.release!();
    await a.idle();
    const original = a.store.runs()[0]!;
    assert.equal(original.status, "succeeded");
    const verified=attachment(a,original.id);
    assertMeetingArtifact(attachmentText(a,original.id));
    const revisionMessage = m.revise.replace("{taskId}", original.taskId);
    f.respondTo(revisionMessage, {
      action: "dispatch",
      taskId: original.taskId,
      material: scenario.fixture.filename,
      goal: "按负责人分组，保留事实和原文件",
    });
    await a.message(revisionMessage, scenario.id + ":revise");
    await until(() => !!f.workerEngines[1]?.release);
    f.workerEngines[1]!.release!();
    await a.idle();
    const revised = a.store.runs()[1]!;
    assert.equal(a.store.runs().length, 2);
    assert.equal(revised.taskId, original.taskId);
    assert.equal(revised.threadId, original.threadId);
    assert.notEqual(attachment(a,revised.id).sha256,verified.sha256);
    assert.equal(revised.status, "succeeded");
    assertMeetingArtifact(attachmentText(a,revised.id),true);
    assert.equal(attachment(a,original.id).sha256,verified.sha256);
    assert.equal(f.maxActive, 1);
    assert.equal(a.history.list(a.store.meta('mainThread')!).filter(message=>message.taskId===original.taskId&&message.attachments?.length).length,2);
  } finally {
    await a.close();
  }
});

test("HMR-PARALLEL-001: main stays responsive while independent Workers overlap", async () => {
  const f = fixture("queue");
  const a = f.app;
  await a.start();
  await a.message(JSON.stringify({ action: "chat", text: "你好" }), "chat");
  assert.equal(a.store.runs().length, 0);
  await a.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.release);
  const snapshot = JSON.parse(
    await a.message(JSON.stringify({ action: "status" }), "status"),
  );
  assert.equal(snapshot.runs[0].status, "running");
  await a.message(
    JSON.stringify({ action: "dispatch", title: "第二件" }),
    "second",
  );
  await until(() => !!f.workerEngines[1]?.release);
  assert.equal(a.store.runs()[0]?.status, "running");
  assert.equal(a.store.runs()[1]?.status, "running");
  f.workerEngines[1]!.release!();
  await until(() => !!reply(a,a.store.runs()[1]!.id));
  assert.equal(a.store.runs()[0]?.status, "running");
  f.workerEngines[0]!.release!();
  await a.idle();
  assert.equal(f.maxActive, 2);
  assert.ok(a.store.runs().every((r) => r.status === "succeeded"));
  assert.ok(a.store.runs().every((r) => !!reply(a,r.id)));
  assert.notEqual(a.store.runs()[0]?.threadId, a.store.runs()[1]?.threadId);
  await a.close();
});

test("T05/T10: explicit revisions preserve artifacts; duplicate user requests do not launch twice", async () => {
  const f = fixture("revision");
  const a = f.app;
  await a.start();
  const input = JSON.stringify({ action: "dispatch" });
  await a.message(input, "same");
  await until(() => !!f.workerEngines[0]?.release);
  await a.message(input, "same");
  assert.equal(a.store.runs().length, 1);
  await assert.rejects(
    () => a.message("different", "same"),
    /request_id_conflict/,
  );
  f.workerEngines[0]!.release!();
  await a.idle();
  const r = a.store.runs()[0]!;
  const receipt = await a.message(input, "same");
  assert.match(receipt, /历史/);
  assert.match(receipt, /succeeded/);
  assert.equal(a.store.runs().length, 1);
  await a.message(
    JSON.stringify({ action: "dispatch", taskId: r.taskId }),
    "revision",
  );
  await until(() => !!f.workerEngines[1]?.release);
  f.workerEngines[1]!.release!();
  await a.idle();
  const revised = a.store.runs()[1]!;
  assert.equal(revised.taskId, r.taskId);
  assert.notEqual(reply(a,revised.id)!.id,reply(a,r.id)!.id);
  assert.ok(attachmentText(a,r.id).includes('行动清单'));
  await a.close();
});

test("T07: missing material, actual engine failure and absent artifact cannot report success", async () => {
  for (const [mode, material, code] of [
    ["normal", "missing.md", "artifact_missing"],
    ["failed", "meeting.md", "mock_engine_failed"],
    ["empty", "meeting.md", "artifact_missing"],
  ] as const) {
    const f = fixture("failure-" + mode, mode);
    const a = f.app;
    await a.start();
    const response=await a.message(JSON.stringify({ action: "dispatch", material }), "first");
    if(mode==='normal'){
      assert.match(response,new RegExp(code));assert.equal(a.store.runs().length,0);assert.equal(f.workerEngines.length,0);await a.close();continue;
    }
    await until(() => !!f.workerEngines[0]?.release);
    f.workerEngines[0]!.release!();
    await a.idle();
    const r = a.store.runs()[0]!;
    assert.equal(r.status, mode==='empty'?"succeeded":"failed");
    if(mode==='empty'){
      assert.equal(r.errorCode,null,'missing deliverable is an explicit review verdict, not an engine error');
      assert.equal(a.tasks.task(r.taskId).notes,'artifact_missing');
      const raw=a.tasks.workerRead({agentId:a.store.meta('mainAgentId')!},{workerId:r.workerId}).messages.find(message=>message.kind==='worker_reply')!;
      assert.equal(raw.payload.execution.status,'completed');
    }else assert.equal(r.errorCode, code);
    assert.equal(reply(a,r.id),undefined);assert.equal(a.tasks.task(r.taskId).outcome,'failed');
    await a.close();
  }
});

test("T08: cancellation is separate from confirmation; unconfirmed stop never succeeds", async () => {
  for (const mode of ["hang", "unconfirmed"] as const) {
    const f = fixture("stop-" + mode, mode);
    const a = f.app;
    await a.start();
    await a.message(JSON.stringify({ action: "dispatch" }), "first");
    await until(() => !!f.workerEngines[0]?.pendingResolve);
    const r = a.store.runs()[0]!;
    const stopping = a.stop(r.id);
    assert.ok(a.store.run(r.id)?.stopRequestedAt);
    await stopping;
    await a.idle();
    assert.equal(
      a.store.run(r.id)?.status,
      mode === "hang" ? "cancelled" : "interrupted",
    );
    assert.ok(a.store.run(r.id)!.stopRequestedAt!<=a.store.run(r.id)!.endedAt!);assert.equal(JSON.parse(a.store.run(r.id)!.checkpointJson!).workerExitConfirmed,mode==="hang"?1:0);
    await a.close();
  }
  const f = fixture("timeout", "hang", 100);
  await f.app.start();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "timeout");
  await until(() => !!f.workerEngines[0]?.pendingResolve);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(f.app.store.runs()[0]?.status, "running");
  assert.equal(Object.hasOwn(JSON.parse(f.app.tasks.version(f.app.store.runs()[0]!.taskId,1).authorityJson!),'maxActiveMs'),false);
  await f.app.stop(f.app.store.runs()[0]!.id);
  await f.app.idle();
  assert.equal(f.app.store.runs()[0]?.status, "cancelled");
  await f.app.close();
});

test("T10: unconfirmed output does not replay a committed user message after restart or lose its attachment", async () => {
  const f=fixture("receipt"),a=f.app;
  await a.start();
  f.failOutput();
  await a.message(JSON.stringify({action:"dispatch"}),"first");
  await until(()=>!!f.workerEngines[0]?.release);
  f.workerEngines[0]!.release!();
  await a.idle();
  const run=a.store.runs()[0]!,original=reply(a,run.id)!,snapshot=attachment(a,run.id);
  assert.equal(original.requestId,null);
  assert.equal(f.outputAttempts,1);
  assert.ok(a.store.db.prepare("SELECT 1 FROM events WHERE type='message_output_unconfirmed'").get());
  assert.equal(original.text,"已核对并发送行动清单。");
  assert.equal(a.store.db.prepare("SELECT state FROM operations WHERE id=?").get(original.operationKey!)?.state,"confirmed");
  rmSync(join(a.config.workspace,run.id+'-actions.md'));
  await a.close();
  const output:Message[]=[];
  const resumed=new Homer(a.config,async message=>{output.push(message);},a['factory']);
  try{
    await resumed.start();await resumed.idle();
    assert.equal(reply(resumed,run.id)?.id,original.id);
    assert.deepEqual(attachment(resumed,run.id),snapshot);
    assert.deepEqual(output.filter(message=>message.type==='reply'||message.type==='coordination'),[]);
  }finally{await resumed.close();}
});

test("T07/T10: failed main coordination keeps reviewed facts without claiming user delivery", async () => {
  const f = fixture("main-delivery-failure", "failed");
  await f.app.start();
  f.failMainDelivery();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.release);
  f.workerEngines[0]!.release!();
  await f.app.idle();
  const run = f.app.store.runs()[0]!;
  assert.equal(run.status, "failed");
  assert.equal(reply(f.app,run.id), undefined);
  assert.ok(!f.messages.some(m=>m.type==="coordination"&&m.text.includes("发送行动清单")));
  assert.equal(f.app.tasks.task(f.app.tasks.run(run.id).taskId).outcome,'failed');
  await f.app.close();
});

test("T07/T10: empty internal reply preserves the outcome without fabricating delivery", async () => {
  const f = fixture("main-delivery-empty", "failed");
  try {
    await f.app.start();
    f.emptyMainDelivery();
    await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
    await until(() => !!f.workerEngines[0]?.release);
    f.workerEngines[0]!.release!();
    await f.app.idle();
    const run = f.app.store.runs()[0]!;
    assert.equal(run.status, "failed");
    assert.equal(reply(f.app,run.id), undefined);
    assert.equal(f.messages.filter(m=>m.type==="coordination").length,0);
    assert.equal(await f.app.message(JSON.stringify({ action: "chat", text: "after failure" }), "after-empty-delivery"), "after failure");
  } finally {
    await f.app.close();
  }
});

test("T11: a protected path cannot be included as a Worker attachment", async () => {
  const f = fixture("scope");
  await f.app.start();
  writeFileSync(join(f.app.config.runtime,'private.md'),'not shared');
  const reply = await f.app.message(
    JSON.stringify({ action: "dispatch", material: "../runtime/private.md" }),
    "outside",
  );
  assert.match(reply, /path_denied/);
  assert.equal(f.app.store.runs().length, 0);
  await f.app.close();
});

test("T08: an unavailable progress sink cannot prevent a real stop attempt", async () => {
  const f = fixture("progress-output-failure", "hang");
  await f.app.start();
  f.failProgress();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.pendingResolve);
  const id = f.app.store.runs()[0]!.id;
  await f.app.stop(id);
  await f.app.idle();
  assert.equal(f.app.store.run(id)?.status, "cancelled");
  await f.app.close();
});
test("T08: a throwing Worker close persists an unconfirmed stop without hanging the caller",async()=>{
  const f=fixture('stop-close-throws','hang');await f.app.start();
  await f.app.message(JSON.stringify({action:'dispatch'}),'synthetic-stop-close');await until(()=>!!f.workerEngines[0]?.pendingResolve);
  const worker=f.workerEngines[0]!,close=worker.close.bind(worker),id=f.app.store.runs()[0]!.id;
  worker.close=async()=>{throw Error('synthetic_close_failure');};
  try{
    await f.app.stop(id);assert.equal(f.app.tasks.run(id).phase,'uncertain');assert.equal(f.app.upgradeStatus().safe,false);
    assert.equal(f.app.tasks.task(f.app.tasks.run(id).taskId).controlState,'normal');
  }finally{worker.close=close;await close();await f.app.idle();await f.app.close();}
});

test("T10: a result finishing while another delivery waits is drained without needing restart", async () => {
  const f = fixture("concurrent-deliveries");
  await f.app.start();
  f.pauseDelivery();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await f.app.message(
    JSON.stringify({ action: "dispatch", title: "第二件" }),
    "second",
  );
  await until(() => !!f.workerEngines[0]?.release);
  f.workerEngines[0]!.release!();
  await until(() => f.deliveryWaiting && !!f.workerEngines[1]?.release);
  f.workerEngines[1]!.release!();
  await until(() => f.app.store.runs().every((r) => r.status === "succeeded"));
  f.releaseDelivery();
  await f.app.idle();
  assert.ok(f.app.store.runs().every((r) => r.status === "succeeded"));
  assert.ok(f.app.store.runs().every(run=>!!reply(f.app,run.id)));
  assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_receipts WHERE state IN ('offered','received')").get()?.n,0);
  await f.app.close();
});

test("T08: unconfirmed main-engine shutdown is reported as an error", async () => {
  const f = fixture("main-stop-unconfirmed");
  await f.app.start();
  f.failMainStop();
  await assert.rejects(() => f.app.close(), /main_stop_unconfirmed/);
  assert.ok(
    f.messages.some(
      (m) => m.type === "error" && m.text.includes("main_stop_unconfirmed"),
    ),
  );
});

test("T07: failed startup retains its cause and cleanup can safely run", async () => {
  const f = fixture("startup-failure", "start-fail");
  await assert.rejects(() => f.app.start(), /mock_start_failed/);
  await assert.doesNotReject(() => f.app.close());
});

test("T08: main stop tool returns confirmed terminal state after emitting the separate request", async () => {
  const f = fixture("main-stop-facts", "hang");
  await f.app.start();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.pendingResolve);
  const id = f.app.store.runs()[0]!.id;
  const result = JSON.parse(
    await f.app.message(JSON.stringify({ action: "stop", id }), "stop"),
  );
  assert.equal(result.status, "cancelled");
  assert.ok(f.app.tasks.run(id).stopRequestedAt);assert.ok(f.app.store.db.prepare("SELECT 1 FROM operations WHERE kind=\'worker_stop\' AND state=\'confirmed\'").get());
  await f.app.idle();
  await f.app.close();
});

test("T07: an unwritable output directory fails the claimed run instead of leaving a phantom Worker", async () => {
  const f = fixture("unwritable-output");
  await f.app.start();
  chmodSync(f.app.files.outputs, 0o500);
  try {
    await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
    await f.app.idle();
    assert.equal(f.app.store.runs()[0]?.status, "failed");
    assert.equal(f.workerEngines.length, 0);
  } finally {
    chmodSync(f.app.files.outputs, 0o700);
    await f.app.close();
  }
});

test("HMR-PARALLEL-001: one message can dispatch several Workers; replay adds none", async () => {
  const f = fixture("multi-dispatch");
  try {
    await f.app.start();
    const input = JSON.stringify({ action: "dispatch_many" });
    await f.app.message(input, "multi");
    await until(() => f.workerEngines.length === 3 && f.workerEngines.every(e => !!e.release));
    assert.equal(f.maxActive, 3);
    assert.equal(f.app.store.runs().length, 3);
    assert.equal(new Set(f.app.store.runs().map(r => r.taskId)).size, 3);
    await f.app.message(input, "multi");
    assert.equal(f.app.store.runs().length, 3);
    for (const engine of [...f.workerEngines].reverse()) engine.release!();
    await f.app.idle();
    assert.ok(f.app.store.runs().every(r => r.status === "succeeded" && !!reply(f.app,r.id)));
    assert.equal(new Set(f.app.store.runs().map(r=>reply(f.app,r.id)!.id)).size,3);
    const receipt = await f.app.message(input, "multi");
    assert.match(receipt,/历史回执/);assert.equal(f.app.history.list(f.app.store.meta('mainThread')!).filter(message=>message.attachments?.length).length,3);
  } finally { await f.app.close(); }
});

test("HMR-PARALLEL-001: stopping one Worker leaves the other running; shutdown stops all", async () => {
  const f = fixture("parallel-stop", "hang");
  await f.app.start();
  try {
    await f.app.message(JSON.stringify({ action: "dispatch_many" }), "many");
    await until(() => f.workerEngines.length === 3 && f.workerEngines.every(e => !!e.pendingResolve));
    const [one, two, three] = f.app.store.runs();
    await f.app.stop(two!.id);
    assert.equal(f.app.store.run(two!.id)?.status, "cancelled");
    assert.equal(f.app.store.run(one!.id)?.status, "running");
    assert.equal(f.app.store.run(three!.id)?.status, "running");
    const snapshot = JSON.parse(await f.app.message(JSON.stringify({ action: "status" }), "query"));
    assert.equal(snapshot.runs.filter((r: any) => r.status === "running").length, 2);
    await f.app.close();
    const saved=new Store(resolve(f.app.config.runtime,'homer.sqlite'));
    try {
      assert.equal(saved.run(two!.id)?.status,'cancelled');
      assert.equal(saved.run(two!.id)?.phase,'ended');
      for(const r of [one!,three!]){
        assert.equal(saved.run(r.id)?.status,'interrupted');
        assert.equal(saved.db.prepare("SELECT json_extract(checkpointJson,'$.workerExitConfirmed') AS closed FROM runs WHERE id=?").get(r.id)?.closed,1);
      }
    }finally{saved.close();}
  } finally { await f.app.close(); }
});

test("HMR-PARALLEL-001: one failed Worker does not block another artifact and delivery", async () => {
  const f = fixture("parallel-partial-failure");
  try {
    await f.app.start();
    await f.app.message(JSON.stringify({ action: "dispatch" }), "failed");
    await f.app.message(JSON.stringify({ action: "dispatch" }), "valid");
    await until(() => f.workerEngines.length === 2 && f.workerEngines.every(e => !!e.release));
    f.workerEngines[0]!.failureCode='mock_engine_failed';
    for (const e of f.workerEngines) e.release!();
    await f.app.idle();
    const [failed, succeeded] = f.app.store.runs();
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.errorCode, "mock_engine_failed");
    assert.equal(succeeded?.status, "succeeded");
    assert.equal(reply(f.app,failed!.id),undefined);assert.ok(reply(f.app,succeeded!.id));
  } finally { await f.app.close(); }
});

test("HMR-UPGRADE-001: safe boundary waits for queued main work, workers and delivery", async () => {
  const f = fixture("upgrade-boundary");
  const a = f.app;
  try {
    await a.start();
    await a.idle();
    assert.equal(a.upgradeStatus().safe, true);
    const turn = a.message(JSON.stringify({ action: "chat", text: "hello" }));
    assert.equal(a.upgradeStatus().safe, false);
    await turn;
    await a.message(JSON.stringify({ action: "dispatch", material: "meeting.md" }));
    await until(() => !!f.workerEngines[0]?.release);
    assert.equal(a.upgradeStatus().safe, false);
    f.pauseDelivery();
    f.workerEngines[0]!.release!();
    await until(() => f.deliveryWaiting);
    assert.equal(a.upgradeStatus().safe, false);
    f.releaseDelivery();
    await a.idle();
    assert.equal(a.upgradeStatus().safe, true);
  } finally { await a.close(); }
});

test("T09: tool upgrades never silently replace the saved main conversation", async () => {
  const f = fixture("tool-definition-upgrade");
  f.app.store.setMeta("mainThread", "legacy-main");
  f.app.store.setMeta("mainToolsHash", "old-tools");
  try {
    await assert.rejects(() => f.app.start(), /main_tools_migration_required/);
    assert.equal(f.engineOptions.length, 0);
    const saved = new Store(f.app.config.runtime + "/homer.sqlite");
    try {
      assert.equal(saved.meta("mainThread"), "legacy-main");
      assert.equal(saved.meta("mainToolsHash"), "old-tools");
    } finally { saved.close(); }
  } finally { await f.app.close(); }
});

test("T09: normal restarts resume the same main conversation; failed resume preserves it", async () => {
  const f = fixture("main-conversation-resume");
  await f.app.start();
  const savedThread = f.app.store.meta("mainThread");
  await f.app.close();
  let attempts = 0;
  const factory = (options: EngineOptions) => {
    assert.equal(options.threadId, savedThread);
    return Object.assign(new EventEmitter(), {
      async start() {
        attempts++;
        if (attempts === 2) throw new Error("engine_resume_failed");
        return attempts === 3 ? "unexpected-new-thread" : options.threadId!;
      },
      async turn() { return {status: "completed", text: "continued"}; },
      async interrupt() { return true; },
      async close() { return true; },
    });
  };
  const resumed = new Homer(f.app.config, async () => {}, factory);
  try {
    await resumed.start();
    assert.equal(resumed.store.meta("mainThread"), savedThread);
  } finally { await resumed.close(); }
  const failed = new Homer(f.app.config, async () => {}, factory);
  await assert.rejects(() => failed.start(), /engine_resume_failed/);
  await failed.close();
  const mismatched = new Homer(f.app.config, async () => {}, factory);
  await assert.rejects(() => mismatched.start(), /main_resume_thread_mismatch/);
  await mismatched.close();
  assert.equal(attempts, 3);
  const saved = new Store(f.app.config.runtime + "/homer.sqlite");
  try { assert.equal(saved.meta("mainThread"), savedThread); }
  finally { saved.close(); }
});

// HMR-MODEL-001: model selection must preserve the conversation and account boundary.
test("T09: model changes resume the same native thread without changing its account or path binding", async () => {
  const f = fixture("model-switch-binding");
  await f.app.start();
  const config = f.app.config;
  const savedThread = f.app.store.meta("mainThread");
  await f.app.close();
  let resumedId: string | undefined;
  const switched = new Homer({ ...config, model: "gpt-6.1-sol", effort: "medium" }, async () => {}, options => {
    resumedId = options.threadId;
    return Object.assign(new EventEmitter(), {
      async start() { return options.threadId!; },
      async turn() { return { status: "completed", text: "continued" }; },
      async interrupt() { return true; },
      async close() { return true; },
    });
  });
  try {
    await switched.start();
    assert.equal(resumedId, savedThread);
    assert.equal(switched.store.meta("mainThread"), savedThread);
    assert.equal(switched.store.meta("bindingVersion"), "2");
  } finally { await switched.close(); }
  for (const changed of [
    { workspace: config.workspace + "-other" },
    { codexHome: config.codexHome + "-other", nativeCodexHome:config.codexHome+"-other" },
    { baseUrl: "https://example.invalid/v1" },
    { keyEnv: "OTHER_ACCOUNT_KEY" },
    { requiresOpenaiAuth: true },
  ]) assert.throws(() => new Homer({ ...config, ...changed }, async () => {}), /runtime_configuration_changed/);
});

test('accepted user sends notify config checks once; duplicate, rejected and first-launch inputs do not',async()=>{
 const f=fixture('runtime-config-accepted-user-20261029');
 try{
  await f.app.start();const reasons:string[]=[];f.app.onStateChange(reason=>{if(reason)reasons.push(reason);});
  const system={requestId:'synthetic-config-first',text:'synthetic initialization'};
  f.app.submitMessage(system,{source:'first_launch',persist:()=>{}});
  assert.equal(reasons.filter(v=>v==='user-input').length,0);
  const input={requestId:'synthetic-config-user',text:'synthetic user message'};
  assert.equal(f.app.submitMessage(input).fresh,true);assert.equal(reasons.filter(v=>v==='user-input').length,1);
  assert.equal(f.app.submitMessage(input).fresh,false);assert.equal(reasons.filter(v=>v==='user-input').length,1);
  assert.throws(()=>f.app.submitMessage({...input,text:'conflicting retry'}));assert.equal(reasons.filter(v=>v==='user-input').length,1);
 }finally{await f.app.close();}
});
