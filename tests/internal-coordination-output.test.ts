// Real host/task/publication pipeline; only the model transport is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {homerWebBridge} from '../src/web-homer.js';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

// The managed sandbox denies ps. Supply only this fixture process's identity;
// no existing host/lease is inspected, stopped, adopted or unlocked.
const execFileSync=childProcess.execFileSync;
childProcess.execFileSync=((file:any,args:any,...rest:any[])=>file==='/bin/ps'&&args?.[0]==='-p'&&args?.[1]===String(process.pid)?'synthetic-test-process-'+process.pid:(execFileSync as any)(file,args,...rest)) as typeof execFileSync;
syncBuiltinESMExports();

for(const scenario of ['final','partial','failed','unknown','blocked','published','published-final','published-extra','unlinked-same-text','no-phase-adapter','image-error'] as const){
 test('internal phase boundary preserves useful output and history: '+scenario,async()=>{
  const scratch=resolve('.codex/scratch/internal-coordination-output');mkdirSync(scratch,{recursive:true});
  const dir=mkdtempSync(join(scratch,'case-'));let app:Homer,seq=0,rootId='',progressId='',mainCloses=0,mainInterrupts=0,selfConfirmationTurns=0;
  const emitted:Message[]=[],errors:string[]=[];
  const finalText=scenario==='partial'?'已核对两项，一项日期缺失。':scenario==='failed'?'执行失败，已保留报告。':scenario==='unknown'?'外部结果未知，需核对。':scenario==='blocked'?'新阻塞：缺少授权材料。':'有效业务结论';
  class Peer extends EventEmitter implements EngineLike{
   threadId='coord-thread-'+ ++seq;turnId?:string;
   constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();}
   async start(){return this.threadId;}
   async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'coord-call-'+ ++seq,tool,arguments:args});}
   result(messages:NonNullable<TurnResult['messages']>,extra:Partial<TurnResult>={}):TurnResult{
    for(const message of messages)this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,...message,completed:true});
    return {status:'completed',text:messages.map(m=>m.text).join('\n').trim(),messages,...extra};
   }
   async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
    this.turnId='coord-turn-'+ ++seq;options?.onStarted?.(this.turnId);
    if(this.options.tools.some(t=>t.name==='read_material')){
     const input=JSON.parse(text);await this.call('read_material',{});
     await this.call('write_markdown',{filename:'checked.md',content:'# 已核对的材料'});
     const task=app.tasks.task(input.taskId);
     const sent=await this.call('agent_send',{operationId:'worker-progress',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,recipientAgentId:app.store.meta('mainAgentId'),kind:'progress',payload:{summary:'普通中间处理'},replyTo:null,targetRunId:null});progressId=sent.messageId;
     return this.result([{itemId:'worker-final',phase:'final_answer',text:finalText}],scenario==='failed'?{status:'failed',errorCode:'synthetic_failure'}:{});
    }
    if(text==='synthetic:independent')return this.result([{itemId:'independent-final',phase:'final_answer',text:finalText}]);
    if(text==='synthetic:user'){
     const root=await this.call('task_delegate',{operationId:'delegate',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'合成核查',executorKind:'worker',contract:{goal:'只核对合成材料',inputs:[],resultKind:'markdown',acceptance:{criteria:[]},presentation:{title:'核对材料',description:'检查合成材料并报告缺口。'}},dependencies:[]});rootId=root.taskId;
     return this.result([{itemId:'initial',phase:'commentary',text:'正常起始反馈'},{itemId:'arranged',phase:'final_answer',text:'已安排核对。'}]);
    }
    try{
     const [notice]=JSON.parse(text.slice(text.indexOf('\n')+1));
     if(notice.kind==='result_accepted')selfConfirmationTurns++;
     if(notice.kind==='progress'){
      await this.call('inbox_ack',{operationId:'ack-progress',messageId:notice.id,disposition:'processed',reason:'已记录内部进度',resultId:null});
      return this.result([{itemId:'progress-ack',phase:'commentary',text:'我会核对这份调查报告和代码依据。'}]);
     }
     if(!['result_ready','terminal'].includes(notice.kind)){
      await this.call('inbox_ack',{operationId:'ack-'+notice.id,messageId:notice.id,disposition:'processed',reason:'内部状态确认',resultId:null});
      return this.result([{itemId:'status-ack',phase:'commentary',text:'纯验收确认已记录。'}]);
     }
     const facts=await this.call('work_inspect',{taskId:notice.taskId,runId:null,resultId:null});
     const primary=facts.results.find((r:any)=>!r.completionResultId);
     await this.call('work_inspect',{taskId:null,runId:null,resultId:primary.id});
     for(const id of facts.completionResultIds??[])await this.call('work_inspect',{taskId:null,runId:null,resultId:id});
     const accepted=await this.call('task_review',{operationId:'review',taskId:notice.taskId,version:facts.task.headVersion,expectedTaskRevision:app.tasks.task(rootId).revision,resultId:primary.id,accepted:true,outcome:scenario==='partial'?'partial':scenario==='failed'?'failed':'succeeded',reason:'已核对全部候选',evidence:scenario==='partial'?{gaps:'日期缺失'}:{},children:[]});
     if(['published','published-final','published-extra'].includes(scenario)){
      const file=facts.results.find((r:any)=>r.filePath);
      const publication=await this.call(accepted.nextTool,{operationId:'publish',taskId:accepted.taskId,version:accepted.version,expectedTaskRevision:accepted.taskRevision,resultId:accepted.resultId,text:finalText,publishedFileResultId:file!.id});
      assert.equal(publication.nextAction,'end_turn');assert.equal(publication.state,'prepared');
      assert.equal(app.tasks.deliveries()[0]!.state,'prepared','recording follows this turn ending');
     }
     await this.call('inbox_ack',{operationId:'ack-result',messageId:notice.id,disposition:'processed',reason:'已核对候选',resultId:null});
     if(scenario==='no-phase-adapter')return {status:'completed',text:finalText};
     return this.result([{itemId:'review-comment',phase:'commentary',text:'收到成果并验收，交付已准备。'},
      {itemId:'business-final',phase:'final_answer',text:scenario==='published'?'':scenario==='published-extra'?finalText+'\n新增缺口：仍需补充材料。':finalText}],scenario==='image-error'?{nativeOutputError:'synthetic_image_error'}:{});
    }catch(error){errors.push(String(error));throw error;}
   }
   async close(){if(!this.options.tools.some(t=>t.name==='read_material'))mainCloses++;return true;}
   async interrupt(){if(!this.options.tools.some(t=>t.name==='read_material'))mainInterrupts++;return true;}
  }
  mkdirSync(join(dir,'runtime'));
  app=new Homer({runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async m=>{emitted.push(m);},(o,h)=>new Peer(o,h));
  try{
   await app.start();await app.message('synthetic:user','coord-source');await app.idle();assert.deepEqual(errors,[]);
   if(scenario==='unlinked-same-text'){await app.message('synthetic:independent','coord-independent');await app.idle();}
   const thread=app.store.meta('mainThread')!,nodes=app.processes.list(thread),progress=nodes.find(n=>n.sourceMessageIds.includes(progressId))!;
   assert.ok(progress,'exact internal message anchors its own process');
   const projected=app.conversationState();
   assert.equal(projected.messages.find(m=>m.id===progress.messageId)?.text,'','commentary-only ACK stays out of the public body');
   assert.ok(progress.items.some(i=>i.kind==='tool'),'ACK remains in process details');
   const user=projected.messages.find(m=>m.process?.sourceKind==='user')!;assert.equal(user.text,'已安排核对。');assert.ok(user.process?.items.some(i=>i.kind==='commentary'&&i.text==='正常起始反馈'));
   const copies=projected.messages.filter(m=>m.text.includes(finalText));
   assert.equal(copies.length,['unlinked-same-text','published-extra'].includes(scenario)?2:1,'only explicit source identity can justify combining independent copies');
   assert.ok(copies.every(m=>!m.text.includes('收到成果并验收')));
   if(scenario==='image-error')assert.match(copies[0]!.text,/synthetic_image_error/);
   if(['published','published-final','published-extra'].includes(scenario)){
    assert.equal(mainCloses,0);assert.equal(mainInterrupts,0,'publication finishes without stopping the main engine');
    assert.equal(selfConfirmationTurns,0,'successful review does not start another model turn for its own confirmation');
    const delivery=app.tasks.deliveries()[0]!;assert.equal(delivery.state,'recorded');assert.equal(emitted.filter(m=>m.type==='delivery').length,1);
    assert.ok(copies.some(message=>message.id===delivery.historyMessageId),'formal publication retains its original identity');
    const bridge=homerWebBridge(app),state=await bridge.state(),file=state.work.flatMap(w=>w.artifacts??[]).find(a=>a.historyMessageId===delivery.historyMessageId)!;
    assert.ok(file,'attachment stays on its formal publication');assert.equal((await bridge.artifact(file.id)).content,'# 已核对的材料');
   }
   assert.equal(app.store.db.prepare('SELECT count(*) n FROM agent_messages WHERE id=?').get(progressId)!.n,1,'underlying internal record survives');
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
 });
}
