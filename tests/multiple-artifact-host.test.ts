// Real Homer scheduling and tools with a deterministic peer; no model/account/network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {homerWebBridge} from '../src/web-homer.js';

test('Homer tools explicitly adopt and deliver two selected files once; one worker turn and one history receipt',async()=>{
 const scratch=resolve('.codex/scratch/multiple-artifact-implementation');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'host-'));mkdirSync(join(dir,'workspace/materials'),{recursive:true});mkdirSync(join(dir,'runtime'));writeFileSync(join(dir,'workspace/materials/sample.md'),'Synthetic date: unknown.');
 const events:Message[]=[],engines:Peer[]=[];let app:Homer,sequence=0,workerTurns=0,taskId='',selected:string[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;resumable=true;
  constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-multi-'+ ++sequence;engines.push(this);}
  get worker(){return this.options.tools.some(t=>t.name==='read_material');}
  async start(){return this.threadId;}
  async call(name:string,args:unknown):Promise<any>{return this.tool({threadId:this.threadId,turnId:this.turnId!,callId:'synthetic-call-'+ ++sequence,tool:name,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(this.worker){workerTurns++;await this.call('read_material',{});
    const first=await this.call('write_markdown',{filename:'事实.md',content:'# 事实\n日期未确定。'}),second=await this.call('write_markdown',{filename:'说明.md',content:'# 说明\n保留未知日期。'});
    return {status:'completed',text:JSON.stringify({marker:'INTERNAL_FILES_ONLY',paths:[first.path,second.path]})};
   }
   if(text==='synthetic multiple files'){
    const task=await this.call('task_create',{title:'合成多成果',goal:'Create two synthetic Markdown files; keep unknown dates'});taskId=task.taskId;
    await this.call('worker_open',{taskId,message:'Read sample.md and write the two requested files'});
    return {status:'completed',text:'已安排合成工作。'};
   }
   if(text.startsWith('[内部协作输入')){
    const input=JSON.parse(text.split('\n')[1]!);
    if(input.kind==='worker_reply'){
     const read=await this.call('worker_read',{workerId:input.workerId,messageId:input.messageId}),reply=JSON.parse(read.messages[0].text);
     assert.equal(reply.marker,'INTERNAL_FILES_ONLY');
     for(const filePath of reply.paths){const result=await this.call('accept_result',{runId:input.runId,filePath});selected.push(result.resultId);const inspected=await this.call('work_inspect',{resultId:result.resultId});assert.match(inspected.file.content,/未知|未确定/);}
     await this.call('publish_delivery',{taskId,resultIds:selected,text:'已核对两份合成文件。'});
    }
    return {status:'completed',text:''};
   }
   return {status:'completed',text:'合成回复。'};
  }
  async interrupt(){return true;}
  async close(){return true;}
 }
 app=new Homer({runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:20000,mainTimeoutMs:10000,stopGraceMs:100},async message=>{events.push(message);},(options,tool)=>new Peer(options,tool));
 try{await app.start();await app.message('synthetic multiple files','synthetic-multi-source');const deadline=Date.now()+10000;while(!events.some(m=>m.type==='delivery')){if(Date.now()>deadline)throw Error('synthetic_delivery_timeout:'+JSON.stringify({events:app.store.db.prepare('SELECT type,code FROM events').all(),runs:app.store.runs().map(r=>({status:r.status,error:r.errorCode})),tasks:app.tasks.tasks().map(t=>({state:t.state,outcome:t.outcome})),selected}));await new Promise(r=>setTimeout(r,10));}await app.idle();
  assert.equal(engines.length,2);assert.equal(workerTurns,1);assert.equal(app.store.runs().length,1);assert.equal(events.filter(m=>m.type==='delivery').length,1);assert.equal(events.some(m=>m.text.includes('INTERNAL_FILES_ONLY')),false);
  assert.equal(app.tasks.deliveries().length,1);const delivery=app.tasks.deliveries()[0]!;assert.equal(delivery.state,'recorded');assert.deepEqual(delivery.publishedFileResultIds,selected);assert.equal(app.history.list(app.store.meta('mainThread')!).filter(m=>m.id===delivery.historyMessageId).length,1);
  const bridge=homerWebBridge(app),state=await bridge.state();assert.deepEqual(state.work[0]!.artifacts?.map(f=>f.id),selected);assert.deepEqual(state.work[0]!.artifacts?.map(f=>f.title),['事实.md','说明.md']);
  assert.deepEqual(await Promise.all(selected.map(async id=>Buffer.from((await bridge.artifact(id)).data!,'base64').toString())),['# 事实\n日期未确定。','# 说明\n保留未知日期。']);
  assert.equal(delivery.routeSourceRequestId,'synthetic-multi-source');assert.equal(events.find(m=>m.type==='delivery')!.runId,undefined);assert.equal(app.tasks.task(taskId).outcome,null);
  assert.equal(app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='worker_return' AND scopeId=?").get(taskId)?.n,1);assert.equal(app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='result_adopt'").get()?.n,2);assert.equal(app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='publish'").get()?.n,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
