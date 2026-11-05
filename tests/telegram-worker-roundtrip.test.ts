import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Homer, type Message } from "../src/service.js";
import { TelegramHomerBridge } from "../src/channels/telegram-homer-bridge.js";
import {TelegramAdapter} from '../src/channels/telegram-adapter.js';
import {TelegramApi} from '../src/channels/telegram-api.js';
import type { EngineLike, EngineOptions, ToolCall, TurnResult } from "../src/engine.js";

const until = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error("telegram_synthetic_wait_timeout"); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test("TG answer passes actual main tools and resumes the original waiting Worker before explicit artifact adoption and delivery", async t => {
  mkdirSync(resolve('.codex/scratch/telegram-plan'),{recursive:true});
  const root = mkdtempSync(resolve(".codex/scratch/telegram-plan/worker-roundtrip-"));
  mkdirSync(join(root, "workspace/materials"), { recursive: true }); mkdirSync(join(root, "runtime"));
  writeFileSync(join(root, "workspace/materials/synthetic.md"), "合成材料，无真实用户内容");
  const workerAnswers: unknown[] = [], workerThreads: string[] = [], deliveries:Message[]=[];
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
        const file=await this.call("write_markdown", { filename: "synthetic-result.md", content: "# 合成成果\n\n采用用户指定表格格式。" }) as {path:string};
        return { status: "completed", text: JSON.stringify({filePath:file.path}) };
      }
      if (text === "合成派发") {const task=await this.call('task_create',{title:'合成任务',goal:'根据合成材料输出 Markdown；格式询问用户'}) as {taskId:string};await this.call('worker_open',{taskId:task.taskId,message:'读取 synthetic.md，向用户确认格式后生成 Markdown'});}
      const interactionId = text.match(/interactionId=([\w-]+)/)?.[1];
      if (interactionId) {
        await this.call("inspect_interaction", { interactionId });
        if (text.startsWith("[内部协作输入")) await this.call("escalate_interaction", { interactionId, question: "请选合成输出格式", reason: "本次授权未指定格式偏好" });
        else await this.call("respond_interaction", { interactionId, action: "answer", answer: "表格", reason: "依据用户绑定原卡片的实际答复" });
      }
      if(text.startsWith('[内部协作输入')){
        const input=JSON.parse(text.split('\n')[1]!);
        if(input.kind==='worker_reply'){
          const read=await this.call('worker_read',{workerId:input.workerId,messageId:input.messageId}) as {messages:{text:string}[]};
          const result=await this.call('accept_result',{runId:input.runId,filePath:JSON.parse(read.messages[0]!.text).filePath}) as {resultId:string};
          const inspected=await this.call('work_inspect',{resultId:result.resultId}) as {file:{content:string}};assert.match(inspected.file.content,/用户指定表格/);
          await this.call('publish_delivery',{taskId:input.taskId,resultIds:[result.resultId],text:'合成成果符合材料和格式'});
        }
      }
      return { status: "completed", text: "荷马合成对外回复" };
    }
    async interrupt() { return true; }
    async close() { return true; }
  }
  const app = new Homer({ workspace: join(root, "workspace"), runtime: join(root, "runtime"), codexBin: "/usr/bin/false", codexHome: join(root, "home"), model: "synthetic", effort: "medium", requiresOpenaiAuth: false, timeoutMs: 10000, mainTimeoutMs: 10000, stopGraceMs: 100 }, async message => { if(message.type==='delivery')deliveries.push(message);await bridge?.handleMessage(message); }, (options, tool) => new Engine(options, tool));
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
  const delivery=app.tasks.deliveries()[0]!,emittedDelivery=deliveries[0];assert.equal(deliveries.length,1);assert.ok(emittedDelivery&&emittedDelivery.type==='delivery');assert.equal(emittedDelivery.runId,undefined);
  const resultId=delivery.publishedFileResultIds[0]!,artifact = await bridge.artifact(resultId, origin);
  assert.equal(artifact.filename, "synthetic-result.md"); assert.equal(Buffer.from(artifact.bytes).toString("utf8"), '# 合成成果\n\n采用用户指定表格格式。');
  const file=store.db.prepare("SELECT payload FROM tg_outbox WHERE kind='file'").get();assert.ok(file);assert.deepEqual(JSON.parse(String(file.payload)),{resultId});
  const rows=()=>store.db.prepare("SELECT id,hash FROM tg_outbox WHERE groupId=? ORDER BY id").all("delivery:" + delivery.id),originalDelivery=rows();
  await bridge.handleMessage({...emittedDelivery,text:'崩溃恢复后主 Agent 重新措辞的合成摘要'});await bridge.handleMessage(emittedDelivery);await bridge.recoverReplies();
  assert.deepEqual(rows(),originalDelivery);
  const uploads:{filename:string;bytes:Buffer;reply:number}[]=[];let now=Date.now();
  const api=new TelegramApi('123456:synthetic_fixture_value_123456789',async(_url,init)=>{
    if(init?.body instanceof FormData){const file=init.body.get('document') as File;uploads.push({filename:file.name,bytes:Buffer.from(await file.arrayBuffer()),reply:JSON.parse(String(init.body.get('reply_parameters'))).message_id});throw Error('synthetic response lost after upload');}
    return Response.json({ok:true,result:{message_id:100}});
  });
  const sender=new TelegramAdapter('123456',store,api,bridge,()=>{},()=>now);
  try{
    for(let i=0;i<12;i++){now+=1000;await sender.tick();}
    assert.deepEqual(uploads,[{filename:'synthetic-result.md',bytes:Buffer.from('# 合成成果\n\n采用用户指定表格格式。'),reply:30}]);
    assert.equal(store.db.prepare("SELECT state FROM tg_outbox WHERE kind='file'").get()!.state,'uncertain');
    store.reconcile('123456');await bridge.handleMessage(emittedDelivery);await bridge.recoverReplies();
    for(let i=0;i<4;i++){now+=1000;await sender.tick();}assert.equal(uploads.length,1,'unknown send is never retried by replay or recovery');
  }finally{await sender.close();}
  assert.equal(app.store.meta("mainThread"), "synthetic-main-original");
  await bridge.respond({ requestId: "tg:123456:11", text: "表格", interactionId: pending.id, origin: answerOrigin });
  await app.idle(); assert.equal(workerAnswers.length, 1);
});

test('TG actual Main file publication has no Run and sends the selected Result bytes with the original reply source',async t=>{
  const scratch=resolve('.codex/scratch/telegram-plan');mkdirSync(scratch,{recursive:true});const root=mkdtempSync(join(scratch,'main-file-'));mkdirSync(join(root,'runtime'));
  let bridge:TelegramHomerBridge|undefined,delivery:Message|undefined,serial=0;
  class Engine extends EventEmitter implements EngineLike{
    threadId='synthetic-main-file';turnId?:string;
    constructor(readonly tool:(call:ToolCall)=>Promise<unknown>){super();}
    async start(){return this.threadId;}
    async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId='turn-'+ ++serial;hooks?.onStarted?.(this.turnId);
      const call=async(tool:string,args:unknown)=>this.tool({threadId:this.threadId,turnId:this.turnId!,callId:'call-'+ ++serial,tool,arguments:args}) as Promise<any>;
      const task=await call('task_create',{goal:text}),filePath=join(app.files.workspace,'main.md');writeFileSync(filePath,'# Main\n合成原文🙂');
      const result=await call('accept_result',{taskId:task.taskId,filePath});await call('publish_delivery',{taskId:task.taskId,resultIds:[result.resultId],text:'Main 合成成果'});
      return {status:'completed',text:'Main 已处理'};
    }
    async interrupt(){return true;}async close(){return true;}
  }
  const app=new Homer({runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:2000,mainTimeoutMs:1000,stopGraceMs:20},async message=>{if(message.type==='delivery')delivery=message;await bridge?.handleMessage(message);},(_options,tool)=>new Engine(tool));
  t.after(async()=>{await bridge?.close();await app.close();rmSync(root,{recursive:true,force:true});});await app.start();bridge=new TelegramHomerBridge(app);
  const store=bridge.channel.store;store.configure('123456','synthetic-main-file');store.enabled('123456',true);const pair=store.pairing('123456');store.proposePair('123456',pair,'789123','789123');store.approvePair('123456',pair,'789123','789123');
  store.ingest('123456',[{update_id:10,message:{message_id:30,date:Date.now()/1000,chat:{id:789123,type:'private'},from:{id:789123},text:'Main file'}}]);const origin=store.route('tg:123456:10')!;
  await bridge.submit({requestId:'tg:123456:10',text:'Main file',origin});await app.idle();assert.ok(delivery);assert.equal(delivery.runId,undefined);assert.equal(app.store.runs().length,0);
  const d=app.tasks.delivery(delivery.deliveryId!),resultId=d.publishedFileResultIds[0]!;assert.equal(app.store.db.prepare('SELECT runId FROM results WHERE id=?').get(resultId)!.runId,null);
  const uploads:FormData[]=[];let now=Date.now();const api=new TelegramApi('123456:synthetic_fixture_value_123456789',async(_url,init)=>{if(init?.body instanceof FormData)uploads.push(init.body);return Response.json({ok:true,result:{message_id:100}});});
  const sender=new TelegramAdapter('123456',store,api,bridge,()=>{},()=>now);try{
    for(let i=0;i<8;i++){now+=1000;await sender.tick();}
    assert.equal(uploads.length,1);const file=uploads[0]!.get('document') as File;assert.equal(file.name,'main.md');assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from('# Main\n合成原文🙂'));assert.equal(JSON.parse(String(uploads[0]!.get('reply_parameters'))).message_id,30);
    await bridge.handleMessage(delivery);for(let i=0;i<3;i++){now+=1000;await sender.tick();}assert.equal(uploads.length,1);
    app.tasks.markDelivery(d.id,'revoked');await assert.rejects(bridge.artifact(resultId,origin),/telegram_artifact_not_authorized/);
    await assert.rejects(bridge.artifact(d.taskId,origin),/telegram_artifact_not_authorized/);
  }finally{await sender.close();}
});
