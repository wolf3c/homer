// Real service startup + isolated synthetic SQLite + injected engine. No production paths/accounts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineLike,EngineOptions,TurnResult} from '../src/engine.js';

test('normal restart reconciles user history before generic receipt recovery, preserves exact old facts and never replays uncertain inputs',async()=>{
 const parent=resolve('.codex/scratch/message-history-repair-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'restart-'));
 const workspace=join(dir,'workspace');mkdirSync(workspace,{recursive:true});mkdirSync(join(dir,'runtime'));const seen:string[]=[];
 class Peer extends EventEmitter implements EngineLike{
  threadId:string;turnId?:string;resumable=true;
  constructor(options:EngineOptions){super();this.threadId=options.threadId??'synthetic-restart-thread';}
  async start(){return this.threadId;}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{seen.push(text);this.turnId='synthetic-turn-'+seen.length;options?.onStarted?.(this.turnId);return {status:'completed',text:'Synthetic completed reply'};}
  async interrupt(){return true;}
  async close(){return true;}
 }
 const config={workspace,runtime:join(dir,'runtime'),codexHome:join(dir,'home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:5000,mainTimeoutMs:5000,stopGraceMs:10};
 let app=new Homer(config,async()=>{},options=>new Peer(options));
 try{
  await app.start();const thread=app.store.meta('mainThread')!;
  const source={requestId:'original',text:'# Synthetic handoff\n\n'+('Preserve facts; never repeat actions. '.repeat(20))};
  const later={...source,requestId:'later',text:source.text+'\nSeparate synthetic follow-up'};
  app.inputs.accept(later);const completed=app.inputs.claim()!;
  app.inputs.started(completed.messageId,completed.revision,'later-generation','later-turn');app.history.finish(completed.replyId,'Synthetic later final','completed');app.inputs.finish(completed.messageId,completed.revision,'completed');app.store.finishRequest(later.requestId,'Synthetic later final');
  app.inputs.accept({requestId:'old-uncertain',text:'Synthetic previous unknown'});const old=app.inputs.claim()!;app.inputs.uncertain(old.messageId,old.revision);
  // Prior version's stale user status, with an already uncertain canonical receipt.
  app.store.db.prepare("UPDATE conversation_messages SET status='processing' WHERE requestId='old-uncertain' AND role='user'").run();
  app.inputs.accept({requestId:'cancelled',text:'Synthetic withdrawn'});app.inputs.cancel({requestId:'cancelled',operationId:'withdraw',expectedRevision:0});
  app.inputs.accept(source);const active=app.inputs.claim()!;app.inputs.started(active.messageId,active.revision,'original-generation','original-turn');app.history.append(active.replyId,'Synthetic partial reply');
  app['processes'].start({id:'original-node',threadId:thread,sourceKind:'user',sourceMessageIds:[active.messageId],messageId:'original-process',replyMessageId:active.replyId},'original-turn');
  app.history.record('original-process',thread,'','running');
  const rows=(table:string,where:string,args:string[])=>app.store.db.prepare('SELECT * FROM '+table+' WHERE '+where+' ORDER BY rowid').all(...args);
  const before={input:rows('conversation_inputs','requestId=?',['original']),oldReceipt:rows('agent_receipts','messageId=?',[old.messageId]),later:rows('conversation_messages','requestId=?',['later']),laterReceipt:rows('agent_receipts','messageId=?',[completed.messageId]),cancelled:rows('conversation_messages','requestId=?',['cancelled']),operation:rows('operations','id=(SELECT operationKey FROM agent_messages WHERE id=?)',[active.messageId])};
  for(let i=0;i<6;i++)app.inputs.accept({requestId:'queued-'+i,text:'Synthetic queued '+i});
  await app.close();app=new Homer(config,async()=>{},options=>new Peer(options));await app.start();await app.idle();
  assert.equal(app.store.meta('mainThread'),thread);
  const original=app.inputs.list().find(q=>q.input.requestId==='original')!;
  assert.equal(original.state,'uncertain');assert.equal(original.generationId,'original-generation');assert.equal(original.revision,active.revision+1);
  const user=app.history.inputs(thread,['original']).get('original')!;assert.equal(user.status,'interrupted');assert.equal(user.text,source.text);
  assert.equal(app.history.inputs(thread,['old-uncertain']).get('old-uncertain')!.status,'interrupted');
  assert.deepEqual(rows('conversation_inputs','requestId=?',['original']),before.input);
  assert.deepEqual(rows('agent_receipts','messageId=?',[old.messageId]),before.oldReceipt,'old uncertain receipt must not be ACKed or revised');
  assert.deepEqual(rows('conversation_messages','requestId=?',['later']),before.later);
  assert.deepEqual(rows('agent_receipts','messageId=?',[completed.messageId]),before.laterReceipt);
  assert.deepEqual(rows('conversation_messages','requestId=?',['cancelled']),before.cancelled);
  assert.deepEqual(rows('operations','id=(SELECT operationKey FROM agent_messages WHERE id=?)',[active.messageId]),before.operation,'native turn and accepted input identity remain unchanged');
  assert.equal(app.store.request('original')!.state,'interrupted');assert.equal(app.store.request('original')!.response,null);
  const process=app.conversationState().processNodes.find(n=>n.id==='original-node')!;assert.equal(process.state,'worked');assert.equal(process.status,'unknown');assert.match(process.endEventId!,/^host:restart:engine_closed/);assert.equal(process.final,undefined);
  assert.deepEqual(seen,Array.from({length:6},(_,i)=>'Synthetic queued '+i));assert.equal(app.inputs.list().filter(q=>q.state==='completed').length,7);
  assert.equal(app.conversationState().isRunning,false);assert.equal(app.conversationState().activeMessageId,null);assert.equal(app.conversationState().mainActivity,null);
  assert.equal(app.submitMessage(source).fresh,false);await app.idle();assert.deepEqual(seen,Array.from({length:6},(_,i)=>'Synthetic queued '+i),'same accepted request retry cannot revive uncertain work');
  const receipts=rows('agent_receipts','messageId IN (?,?)',[active.messageId,old.messageId]);app.inputs.reconcile();assert.deepEqual(rows('agent_receipts','messageId IN (?,?)',[active.messageId,old.messageId]),receipts,'recovery is idempotent');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
