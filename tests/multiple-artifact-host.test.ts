// Real Homer scheduling and tools with a deterministic peer; no model/account/network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {homerWebBridge} from '../src/web-homer.js';

test('Homer opens one Worker and commits the two selected files in one background message',async()=>{
 const scratch=resolve('.codex/scratch/multiple-artifact-implementation');mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'host-'));mkdirSync(join(dir,'workspace/materials'),{recursive:true});mkdirSync(join(dir,'runtime'));writeFileSync(join(dir,'workspace/materials/sample.md'),'Synthetic date: unknown.');
 const events:Message[]=[],engines:Peer[]=[];let app:Homer,sequence=0,workerTurns=0,taskId='',messageId='';
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;resumable=true;
  constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-multi-'+ ++sequence;engines.push(this);}
  get worker(){return this.options.role==='worker';}
  async start(){return this.threadId;}
  async call(name:string,args:unknown):Promise<any>{return this.tool({threadId:this.threadId,turnId:this.turnId!,callId:'synthetic-call-'+ ++sequence,tool:name,arguments:args});}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+ ++sequence;options?.onStarted?.(this.turnId);
   if(this.worker){workerTurns++;
    assert.equal(readFileSync(join(this.options.cwd,'materials/sample.md'),'utf8'),'Synthetic date: unknown.');
    const paths=[['事实.md','# 事实\n日期未确定。'],['说明.md','# 说明\n保留未知日期。'],['internal.md','Internal draft']].map(([filename,content])=>{
     const path=join(this.options.cwd,filename!);writeFileSync(path,content!);return path;
    });
    return {status:'completed',text:JSON.stringify({marker:'INTERNAL_FILES_ONLY',paths})};
   }
   if(text==='synthetic multiple files'){
    const task=await this.call('worker_open',{message:'Read sample.md and write the two requested files'});taskId=task.taskId;
    return {status:'completed',text:'已安排合成工作。'};
   }
   if(text.startsWith('[内部协作输入')){
    const input=JSON.parse(text.split('\n')[1]!);
    if(input.kind==='worker_reply'){
     const read=await this.call('worker_read',{workerId:input.workerId,messageId:input.messageId}),reply=JSON.parse(read.messages[0].text);
     assert.equal(reply.marker,'INTERNAL_FILES_ONLY');
     const sent=await this.call('send_user_message',{taskId,attachments:reply.paths.slice(0,2).map((path:string)=>({path})),text:'已核对两份合成文件。'});
     messageId=sent.messageId;
    }
    return {status:'completed',text:''};
   }
   return {status:'completed',text:'合成回复。'};
  }
  async interrupt(){return true;}
  async close(){return true;}
 }
 app=new Homer({runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexHome:join(dir,'empty-home'),nativeCodexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:20000,mainTimeoutMs:10000,stopGraceMs:100},async message=>{events.push(message);},(options,tool)=>new Peer(options,tool));
 try{
  await app.start();await app.message('synthetic multiple files','synthetic-multi-source');await app.idle();
  assert.ok(messageId,JSON.stringify(app.store.db.prepare('SELECT type,code FROM events').all()));
  assert.equal(engines.length,2);assert.equal(workerTurns,1);assert.equal(app.store.runs().length,1);
  assert.equal(events.some(m=>m.text.includes('INTERNAL_FILES_ONLY')),false);
  const messages=app.history.list(app.store.meta('mainThread')!).filter(m=>m.attachments?.length);
  assert.equal(messages.length,1);const [sent]=messages;
  assert.equal(sent!.id,messageId);assert.equal(sent!.taskId,taskId);assert.equal(sent!.requestId,null);
  const bridge=homerWebBridge(app),state=await bridge.state();
  assert.deepEqual(state.artifacts?.map(f=>f.title),['事实.md','说明.md']);
  assert.deepEqual(await Promise.all(sent!.attachments!.map(async ref=>Buffer.from((await bridge.media!.read({messageId,...ref})).data,'base64').toString())),['# 事实\n日期未确定。','# 说明\n保留未知日期。']);
  assert.equal(app.tasks.task(taskId).outcome,null);
  assert.equal(app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='worker_return' AND scopeId=?").get(taskId)?.n,1);
  assert.equal(app.store.db.prepare("SELECT count(*) n FROM operations WHERE kind='send_user_message'").get()?.n,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
