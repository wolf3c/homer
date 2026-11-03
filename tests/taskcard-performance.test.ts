import {test} from 'node:test';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {withTaskSources} from '../src/web-homer.js';import {readTaskOverview} from '../src/task-overview.js';import {WorkerCardEvents} from '../src/worker-card-events.js';
import {fixture,delegate,running,main} from './recursive-fixture.js';import {ConversationHistory} from '../src/web-history.js';import type {DisplayMessage} from '../src/conversation-projection.js';
test('page source reads are batched, indexed, and unaffected by 20000 unrelated pending notices',()=>{
 const f=fixture();try{new ConversationHistory(f.store.db);const db=f.store.db;db.prepare('INSERT INTO conversation_inputs VALUES(?,?,?,?)').run('user-synthetic','thread','hash','reply');
 const d=delegate(f),actor=running(f,d.taskId),t=f.tasks.task(d.taskId),sent=f.tasks.send(actor,{operationId:'seed',taskId:t.id,version:1,expectedTaskRevision:t.revision,recipientAgentId:main.agentId,kind:'progress',payload:{private:'not projected'}});
 const op=db.prepare('INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,responseJson,revision,detailsJson) SELECT ?,actorAgentId,scopeId,?,kind,payloadHash,state,responseJson,revision,detailsJson FROM operations WHERE id=?');
 const msg=db.prepare('INSERT INTO agent_messages(id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,replyTo,causationId,operationKey,payloadJson) SELECT ?,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,replyTo,causationId,?,payloadJson FROM agent_messages WHERE id=?');
 const receipt=db.prepare("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES(?,?,'pending')");
 const seed=(start:number,end:number)=>f.store.transaction(()=>{for(let n=start;n<end;n++){op.run('op-perf-'+n,'perf-'+n,sent.operationKey);msg.run('msg-perf-'+n,'op-perf-'+n,sent.messageId);receipt.run('msg-perf-'+n,main.agentId);}});
 seed(0,601);
 const messages:DisplayMessage[]=Array.from({length:80},(_,n)=>({id:'p-'+n,threadId:'thread',requestId:null,role:'assistant',text:'Public finding',status:'completed',createdAt:1,process:{id:'p-'+n,threadId:'thread',seq:n,revision:1,sourceKind:'worker',sourceMessageIds:Array.from({length:n===79?601-79*7:7},(_,i)=>'msg-perf-'+(n*7+i)),messageId:'p-'+n,state:'worked',status:'completed',turnIds:['turn'],items:Array.from({length:n===79?48:7},(_,i)=>({id:'event-'+n+'-'+i,kind:'workerEvent' as const,seq:i,revision:1,eventKey:'event-'+n+'-'+i,event:{schemaVersion:1 as const,eventKind:'result_received' as const,title:'Historical result',body:'Public snapshot',bodySource:'summary' as const,taskId:t.id,version:1,runId:actor.runId!,resultId:'other-'+n+'-'+i,sourceMessageId:'other-'+n+'-'+i,operationKey:null,observedAtMs:1,failureStage:null,errorCode:null}}))}}));
 const original=db.prepare.bind(db),calls:{sql:string;args:unknown[]}[]=[];
 db.prepare=((sql:string)=>{const statement=original(sql);return new Proxy(statement,{get(target,key){if(key==='all'||key==='get')return(...args:unknown[])=>{calls.push({sql,args});return (target[key] as Function).apply(target,args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}) as typeof db.prepare;
 const before=withTaskSources(db,messages,'thread');const count=calls.length;assert.equal(before.reduce((n,m)=>n+(m.taskSources?.length??0),0),601);assert.equal(calls.filter(c=>c.sql.includes('FROM agent_messages m')).length,4);const firstCalls=[...calls];calls.length=0;
 seed(601,20601);calls.length=0;const after=withTaskSources(db,messages,'thread');assert.deepEqual(after,before);assert.equal(calls.length,count);
 const plans=firstCalls.map(c=>({sql:c.sql,plan:original('EXPLAIN QUERY PLAN '+c.sql).all(...c.args as any[])}));
 const times:number[]=[];for(let n=0;n<60;n++){const start=performance.now();withTaskSources(db,messages,'thread');times.push(performance.now()-start);}times.sort((a,b)=>a-b);
 calls.length=0;new WorkerCardEvents(db).read(Array.from({length:601},(_,n)=>'event-'+n));assert.equal(calls.length,4);
 db.prepare=original;
 f.store.transaction(()=>{for(let n=2;n<3027;n++){
  const state=n<3002?'cancelled':'accepted',key='queue-perf-'+n;
  original("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,responseJson,revision,detailsJson) SELECT ?,actorAgentId,scopeId,?,'update',payloadHash,?,NULL,revision,? FROM operations WHERE id=?").run(key,key,state,JSON.stringify({mode:'queue',version:n,state:'ordered'}),sent.operationKey);
  original('INSERT INTO task_versions SELECT taskId,?,goal,inputsJson,resultKind,acceptanceJson,authorityJson,sourceRequestId,?,workingDirectory,presentationJson FROM task_versions WHERE taskId=? AND version=1').run(n,key,t.id);
 }});
 const snapshot=readTaskOverview(db).tasks.find(x=>x.id===t.id)!;assert.equal(snapshot.updates?.length,20);assert.equal(snapshot.moreUpdates,true);assert.ok(snapshot.updates?.every(u=>u.stage==='queued'));
 const overviewPlans:unknown[]=[];
 db.prepare=((sql:string)=>{const statement=original(sql);return new Proxy(statement,{get(target,key){if(key==='all')return(...args:unknown[])=>{overviewPlans.push({sql,plan:original('EXPLAIN QUERY PLAN '+sql).all(...args as any[])});return target.all(...args as any[]);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}) as typeof db.prepare;
 readTaskOverview(db);db.prepare=original;
 const overview:number[]=[];for(let n=0;n<60;n++){const start=performance.now();readTaskOverview(db);overview.push(performance.now()-start);}overview.sort((a,b)=>a-b);
 const distribution=(a:number[])=>({p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)});
 console.log('taskcardPerformance='+JSON.stringify({pageUnits:80,sourceKeys:601,eventSnapshots:601,batchSize:200,unrelatedPending:20000,queriesBefore:count,queriesAfter:count,eventQueries:4,responseBytes:Buffer.byteLength(JSON.stringify(after)),sourcesMs:distribution(times),overviewMs:distribution(overview),cancelledVersions:3000,pendingVersions:25,overviewPlans,plans}));
 }finally{f.close();}
});
