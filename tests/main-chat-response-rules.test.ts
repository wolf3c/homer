// Real mainTurn report gate and persisted process owner; synthetic engine only.
// Does not construct a host/process lock, start a native process or bypass it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {MainProcessHistory} from '../src/main-process.js';
import {ConversationHistory} from '../src/web-history.js';
import {fixture} from './recursive-fixture.js';
import {syntheticFile} from './recursive-publication-fixture.js';
function setup(){
 const f=fixture(),app:any=Object.create(Homer.prototype),processes=new MainProcessHistory(f.store.db),history=new ConversationHistory(f.store.db);
 f.store.setMeta('mainThread','thread');let seq=0;
 const engine={threadId:'thread',turnId:'',available:true,async turn(_text:string,o:any){this.turnId='turn-'+ ++seq;o.onStarted(this.turnId);return {status:'completed',text:''};}};
 Object.assign(app,{config:{workspace:f.dir,codexHome:f.dir,runtime:f.dir},store:f.store,tasks:f.tasks,files:f.files,history,processes,main:engine,mainApprovals:{end(){}},interactions:{pendingForMain:()=>({total:0}),hasDeliveredDecision:()=>false},recoverMain:async()=>{},refreshMainCapabilities:async()=>{}});
 return {...f,app,processes};
}
test('user inputs cannot be silent; ordinary internal ACK may be silent and remains recorded',async()=>{
 const f=setup();try{
  await assert.rejects(()=>f.app.mainTurn('question',{event:false,inspected:new Set()}),/main_empty_reply/);
  const context:any={event:true,allowEmptyReply:true,sourceMessageIds:['ack'],inspected:new Set()};
  assert.equal(await f.app.mainTurn('ordinary internal confirmation',context),'');
  const node=f.processes.exact(context.processId)!;assert.equal(node.state,'worked');assert.equal(node.status,'completed');assert.equal(node.final,undefined);
 }finally{f.close();}
});
test('result, partial, final failure and unknown notices cannot be silenced by an ordinary ACK',async()=>{
 const f=setup();try{
  for(const payload of [{outcome:'partial'},{outcome:'failed'},{outcome:'unknown'}]){
   const context={event:true,allowEmptyReply:true,workerInput:{messageId:'missing-result',senderAgentId:'host',kind:'result_ready',payload},inspected:new Set()};
   await assert.rejects(()=>f.app.mainTurn('result notice',context),/main_empty_reply/);
  }
  await assert.rejects(()=>f.app.mainTurn('terminal failure',{event:true,allowEmptyReply:true,workerInput:{messageId:'terminal',senderAgentId:'host',kind:'terminal',payload:{}},inspected:new Set()}),/main_empty_reply/);
 }finally{f.close();}
});

test('a publication for another source cannot silence the current final or partial result',async()=>{
 const f=setup();try{
  const context:any={event:true,allowEmptyReply:true,workerInput:{messageId:'current-result',senderAgentId:'host',kind:'result_ready',payload:{outcome:'partial'}},sourceMessageIds:['current-result'],inspected:new Set()};
  const turn=f.app.main.turn.bind(f.app.main);
  f.app.main.turn=async(text:string,o:any)=>{const result=await turn(text,o);f.processes.delivery(context.processId,{historyMessageId:'other-publication',text:'Other task delivery'});return result;};
  await assert.rejects(()=>f.app.mainTurn('current result',context),/main_empty_reply/);
 }finally{f.close();}
});

test('exact reviewed formal publication excuses duplicate body; revoked or unrelated identity does not',async()=>{
 const f=setup();try{
  f.store.startRequest('publication','synthetic-hash');const file=syntheticFile(f.app,'publication');
  const source=String(f.store.db.prepare("SELECT id FROM agent_messages WHERE kind='result_ready' AND json_extract(payloadJson,'$.resultId')=?").get(file.resultId)!.id);
  const delivery=file.publish('Verified result');f.processes.start({id:'process',threadId:'thread',sourceKind:'worker',sourceMessageIds:[source],messageId:'process'},'turn');
  f.processes.delivery('process',delivery);assert.equal(f.processes.hasSourceDelivery('process',source),true);
  assert.equal(f.processes.hasSourceDelivery('process','unrelated-source'),false);
  f.store.db.prepare("UPDATE deliveries SET state='revoked' WHERE id=?").run(delivery.id);assert.equal(f.processes.hasSourceDelivery('process',source),false);
 }finally{f.close();}
});
