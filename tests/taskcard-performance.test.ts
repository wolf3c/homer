import {test} from 'node:test';import assert from 'node:assert/strict';
import {withTaskSources} from '../src/web-homer.js';import {WorkerCardEvents} from '../src/worker-card-events.js';
import {overviewFixture} from './task-overview-fixture.js';import type {DisplayMessage} from '../src/conversation-projection.js';
test('source and event reads batch 601 exact keys and ignore 20000 unrelated notices and their payloads',()=>{
 const f=overviewFixture();try{
  const db=f.store.db;
  const w=f.open('inspect'),run=f.tasks.claim(w.runId)!;f.tasks.bind(run.id,run.epoch,'thread:worker','turn:worker');const reply=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'PRIVATE_BODY'},true)!;
  const source=db.prepare('SELECT operationKey FROM agent_messages WHERE id=?').get(reply.messageId)!;
  const op=db.prepare('INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,responseJson,revision,detailsJson) SELECT ?,actorAgentId,scopeId,?,kind,payloadHash,state,responseJson,revision,detailsJson FROM operations WHERE id=?');
  const message=db.prepare('INSERT INTO agent_messages(id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,replyTo,causationId,operationKey,payloadJson) SELECT ?,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,replyTo,causationId,?,payloadJson FROM agent_messages WHERE id=?');
  const receipt=db.prepare("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES(?,?,'pending')");
  const seed=(start:number,end:number)=>f.store.transaction(()=>{for(let n=start;n<end;n++){op.run('op-perf-'+n,'perf-'+n,String(source.operationKey));message.run('msg-perf-'+n,'op-perf-'+n,reply.messageId);receipt.run('msg-perf-'+n,f.actor.agentId);}});seed(0,601);
  const messages:DisplayMessage[]=Array.from({length:80},(_,n)=>({id:'public-'+n,threadId:f.actor.threadId,requestId:null,role:'assistant',text:'Public finding',status:'completed',createdAt:1,process:{id:'public-'+n,threadId:f.actor.threadId,seq:n,revision:1,sourceKind:'worker',sourceMessageIds:Array.from({length:n===79?601-79*7:7},(_,i)=>'msg-perf-'+(n*7+i)),messageId:'public-'+n,state:'worked',status:'completed',turnIds:['turn'],items:[]}}));
  const original=db.prepare.bind(db),calls:{sql:string;args:unknown[]}[]=[];
  db.prepare=((sql:string)=>{const statement=original(sql);return new Proxy(statement,{get(target,key){if(key==='all'||key==='get')return(...args:unknown[])=>{calls.push({sql,args});return (target[key] as Function).apply(target,args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}) as typeof db.prepare;
  const before=withTaskSources(db,messages,f.actor.threadId),count=calls.length;assert.equal(before.reduce((n,m)=>n+(m.taskSources?.length??0),0),601);assert.equal(calls.filter(c=>c.sql.includes('FROM agent_messages m')).length,4);assert.ok(calls.every(c=>!c.sql.includes('payloadJson')));assert.doesNotMatch(JSON.stringify(before),/PRIVATE_BODY/);
  const plans=calls.filter(c=>c.sql.includes('FROM agent_messages m')).map(c=>original('EXPLAIN QUERY PLAN '+c.sql).all(...c.args as any[]).map(row=>row.detail).join('\n'));assert.ok(plans.every(plan=>/SEARCH m USING INDEX/.test(plan)));
  calls.length=0;seed(601,20601);calls.length=0;assert.deepEqual(withTaskSources(db,messages,f.actor.threadId),before);assert.equal(calls.length,count);
  const events=new WorkerCardEvents(db);calls.length=0;events.read(Array.from({length:601},(_,n)=>'event-'+n));assert.equal(calls.length,4);db.prepare=original;
 }finally{f.close();}
});
