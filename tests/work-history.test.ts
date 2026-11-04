// Requirements-derived synthetic history. No production store, model or channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, main, delegate, running } from './recursive-fixture.js';
import { ConversationHistory } from '../src/web-history.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
import { MainProcessHistory } from '../src/main-process.js';
import { RecursiveTools } from '../src/recursive-tools.js';
import { HOST_MCP_TOOLS, WORKER_HOST_MCP_TOOLS } from '../src/worker-interaction-mcp.js';
import { readTaskOverview } from '../src/task-overview.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { CodexEngine } from '../src/engine.js';
import { writeFileSync,readFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { MAIN_TOOLS } from '../src/tools.js';
import { Homer } from '../src/service.js';
import { seedFirstLaunchSkills } from '../src/first-launch.js';
import type { EngineOptions,ToolCall,TurnResult } from '../src/engine.js';
const scratch = '.codex/scratch/worker-history-cleanup-implementation-20261023/runtime';
// Seed settled facts directly so cleanup tests do not depend on the separate
// completion/Worker-return workflow. Acceptance/publication still use their owners.
function returned(tasks:RecursiveTasks,taskId:string,runId:string|null) {
 const resultId='synthetic-result-'+taskId,key='synthetic-return-'+taskId,db=tasks.store.db;
 tasks.store.transaction(()=>{
  db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES(?,?,?,?,'synthetic_fixture','synthetic','confirmed','{}')").run(key,main.agentId,taskId,key);
  db.prepare("INSERT INTO results(id,taskId,version,runId,producerAgentId,kind,payloadJson,state,outcome,evidenceJson,operationKey) VALUES(?,?,?,?,?,'structured',?,?,'succeeded','{}',?)").run(resultId,taskId,tasks.task(taskId).headVersion,runId,main.agentId,JSON.stringify({text:'Synthetic completed facts'}),runId?'offered':'accepted',key);
  if(runId){
   db.prepare("UPDATE results SET completionResultId=?,state='offered',outcome='succeeded' WHERE runId=? AND state='staged'").run(resultId,runId);
   db.prepare("UPDATE runs SET status='awaiting_review',phase='ended',endedAt=?,stateRevision=stateRevision+1 WHERE id=?").run(Date.now(),runId);
  }else db.prepare("UPDATE tasks SET state='settled',outcome='succeeded',revision=revision+1 WHERE id=?").run(taskId);
 });
 return {resultId,key};
}
function setup() {
  const f=fixture(scratch), threadId='synthetic-history-main';
  f.store.setMeta('mainThread',threadId);
  const history=new ConversationHistory(f.store.db),inputs=new MainInputs(f.tasks,history);
  inputs.accept({requestId:'cleanup-user',text:'Synthetic permission: archive, restore or delete the exact selected synthetic history.'});
  const input=inputs.claim()!;
  const actor={...main,sourceRequestId:'cleanup-user',threadId,turnId:'cleanup-turn'};
  const args=(taskId=f.root.taskId,operationId='history')=>({operationId,taskId,version:f.tasks.task(taskId).headVersion,expectedTaskRevision:f.tasks.task(taskId).revision});
  const finish=(publishedFileResultId:string|null=null)=>{
    const children=f.tasks.children(f.root.taskId).map(t=>{
      const result=f.tasks.inspect(main,{taskId:t.id}).results.find(r=>r.state==='accepted'&&!r.completionResultId)!;
      return {childTaskId:t.id,childVersion:t.headVersion,disposition:'included' as const,resultId:result.id,reason:'Synthetic accepted evidence'};
    });
    const result=returned(f.tasks,f.root.taskId,null);
    for(const child of children)f.store.db.prepare('INSERT INTO child_resolutions VALUES(?,?,?,?,?,?,NULL,?,?)').run(f.root.taskId,1,child.childTaskId,child.childVersion,child.disposition,child.resultId,child.reason,result.key);
    const delivery=f.tasks.publish(main,{...args(f.root.taskId,'publish-root'),resultId:result.resultId,text:'Synthetic formal delivery',publishedFileResultId});
    f.tasks.markDelivery(delivery.deliveryId,'recorded');
    for(const m of f.tasks.inbox(main)) f.tasks.ack(main,{operationId:'ack-'+m.id,messageId:m.id,disposition:'processed',reason:'Synthetic handling complete'});
    return delivery;
  };
  return {...f,actor,args,finish,history,inputs,input};
}
function worker(f:ReturnType<typeof setup>,id='worker') {
  const child=delegate(f,id),actor=running(f,child.taskId);
  return {child,actor};
}
function settleWorker(f:ReturnType<typeof setup>,taskId:string,actor:ReturnType<typeof running>) {
  const result=returned(f.tasks,taskId,actor.runId!);
  const inspected=f.tasks.inspect(main,{resultId:result.resultId});
  for(const resultId of inspected.completionResultIds)f.tasks.inspect(main,{resultId});
  f.tasks.review(main,{...f.args(taskId,'review-'+result.resultId),resultId:result.resultId,decision:'accept',outcome:'succeeded',reason:'Synthetic returned evidence inspected',evidence:{facts:'synthetic'},children:[]});
  return result;
}
function tools(f:ReturnType<typeof setup>,native?:Parameters<RecursiveTasksNative>[0]) {
  return new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake:()=>{},stop:async()=>{},update:async()=>{},...(native?{historyNative:native}:{})});
}
type RecursiveTasksNative=(rpc:(method:string,params:any)=>Promise<any>)=>void;

test('history tools are main-only and reject forged confirmation/source and stale CAS',async()=>{
 const f=setup();try{
  f.finish();const t=tools(f),a=f.args();
  for(const name of ['archive_work','restore_work','delete_work']){
   assert.ok(HOST_MCP_TOOLS.some(t=>t.name===name));assert.ok(!WORKER_HOST_MCP_TOOLS.some(t=>t.name===name));
   await assert.rejects(()=>t.call(f.actor,name,{...a,confirmed:true}),/invalid_tool_arguments/);
  }
  await assert.rejects(()=>t.call({...f.actor,sourceRequestId:undefined},'archive_work',a),/history_source/);
  await assert.rejects(()=>t.call({...f.actor,threadId:'other'},'archive_work',a),/history_actor/);
  await assert.rejects(()=>t.call(f.actor,'archive_work',{...a,expectedTaskRevision:a.expectedTaskRevision-1}),/revision_conflict/);
  await assert.rejects(()=>t.call(f.actor,'archive_work',{...a,runId:'synthetic-run'}),/invalid_tool_arguments/);
 }finally{f.close();}
});

test('archive and restore use original Task identity, filter discovery and counts, and never delete facts',async()=>{
 const f=setup();try{
  f.finish();const before=f.tasks.inspect(main,{taskId:f.root.taskId}),t=tools(f),a=f.args();
  assert.equal((await t.call(f.actor,'archive_work',a) as any).state,'archived');
  assert.equal(f.tasks.listHistory().tasks.length,0);assert.equal(readTaskOverview(f.store.db).tasks.length,0);
  assert.equal(f.tasks.listHistory({includeArchived:true}).tasks.length,1);
  assert.deepEqual(f.tasks.inspect(main,{taskId:f.root.taskId}).results,before.results);
  assert.equal((await t.call(f.actor,'archive_work',a) as any).state,'archived','same operation is idempotent despite revision change');
  await t.call(f.actor,'restore_work',f.args(f.root.taskId,'restore'));
  assert.equal(f.tasks.listHistory().tasks[0]!.id,f.root.taskId);assert.equal(readTaskOverview(f.store.db).tasks.length,1);
  assert.equal(f.store.runs().length,0);assert.equal(f.tasks.deliveries()[0]!.state,'recorded');
 }finally{f.close();}
});

test('Worker archive emits one factual notice per transition and preserves results',async()=>{
 const f=setup();try{
  const w=worker(f);settleWorker(f,w.child.taskId,w.actor);f.finish();
  const before=f.tasks.inspect(main,{taskId:w.child.taskId}).results;
  const notices=()=>f.tasks.inbox(main).filter(m=>m.kind==='task_archived');
  const args=f.args(w.child.taskId,'archive-worker');
  const archived=await tools(f).call(f.actor,'archive_work',args) as any;
  assert.equal(archived.state,'archived');assert.equal(notices().length,1);
  const notice=notices()[0]!;
  assert.equal(notice.senderAgentId,'host');assert.equal(notice.recipientAgentId,main.agentId);
  assert.equal(notice.taskId,w.child.taskId);assert.equal(notice.taskVersion,args.version);
  assert.deepEqual(notice.payload,{historyState:'archived',revision:archived.revision});
  await tools(f).call(f.actor,'archive_work',args);
  f.tasks.ack(main,{operationId:'archive-notice-ack',messageId:notice.id,disposition:'processed',reason:'Synthetic fact received'});
  await tools(f).call(f.actor,'archive_work',f.args(w.child.taskId,'already-archived'));
  assert.equal(notices().length,0,'a new operation on an already archived task creates no notice');
  await tools(f).call(f.actor,'restore_work',f.args(w.child.taskId,'restore-worker'));
  assert.equal(notices().length,0,'restore creates no archive notice');
  await tools(f).call(f.actor,'archive_work',f.args(w.child.taskId,'archive-again'));
  assert.equal(notices().length,1);assert.notEqual(notices()[0]!.id,notice.id);
  assert.deepEqual(f.tasks.inspect(main,{taskId:w.child.taskId}).results,before);
 }finally{f.close();}
});

test('archive facts are atomic with state, absent for blocked archives, and include main-executed work',async()=>{
 const f=setup();try{
  const w=worker(f),t=tools(f);
  assert.equal((await t.call(f.actor,'archive_work',f.args(w.child.taskId,'live')) as any).state,'skipped');
  assert.equal(f.tasks.inbox(main).filter(m=>m.kind==='task_archived').length,0);
  settleWorker(f,w.child.taskId,w.actor);f.finish();
  f.store.db.exec("CREATE TEMP TRIGGER reject_archive_notice BEFORE INSERT ON agent_messages WHEN NEW.kind='task_archived' BEGIN SELECT RAISE(ABORT,'synthetic_notice_failure'); END");
  const args=f.args(w.child.taskId,'atomic-archive');
  await assert.rejects(()=>t.call(f.actor,'archive_work',args),/synthetic_notice_failure/);
  assert.equal(f.tasks.task(w.child.taskId).historyState,'visible');
  f.store.db.exec('DROP TRIGGER reject_archive_notice');
  assert.equal((await t.call(f.actor,'archive_work',args) as any).state,'archived');
 }finally{f.close();}
 const mainOnly=setup();try{
  mainOnly.finish();await tools(mainOnly).call(mainOnly.actor,'archive_work',mainOnly.args());
  assert.equal(mainOnly.tasks.inbox(main).filter(m=>m.kind==='task_archived').length,1);
 }finally{mainOnly.close();}
});

for(const [status,skillState] of [['completed','legacy'],['failed','legacy'],['completed','enabled'],['failed','enabled'],['completed','missing'],['completed','disabled'],['completed','rpc-error'],['completed','wrong-path']] as const)test('persisted archive reaches main with native Skill selection: '+status+'/'+skillState,async()=>{
 const native=skillState!=='legacy',available=skillState==='enabled'||!native;
 const f=setup();let app:Homer|undefined,closed=false;const received:string[]=[],selected:{name:string;path:string}[][]=[];let home='';
 class Peer extends EventEmitter {
  threadId:string;turnId='archive-notice-turn';
  constructor(options:EngineOptions){super();this.threadId=options.threadId!;}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async request(method:string){if(method!=='skills/list')return {};if(skillState==='rpc-error')throw Error('synthetic_skill_list_failed');return {data:[{skills:skillState==='missing'?[]:[{name:'homer-archive-review',path:join(skillState==='wrong-path'?f.files.workspace:home,'skills/homer-archive-review/SKILL.md'),enabled:skillState!=='disabled'}]}]};}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void;skills?:{name:string;path:string}[]}):Promise<TurnResult>{hooks?.onStarted?.(this.turnId);received.push(text);selected.push(hooks?.skills??[]);return {status,text:''};}
 }
 try{
  f.inputs.finish(f.input.messageId,f.input.revision,'completed');
  const w=worker(f);settleWorker(f,w.child.taskId,w.actor);f.finish();
  f.store.db.prepare("UPDATE task_versions SET sourceRequestId='cleanup-user'").run();
  await tools(f).call(f.actor,'archive_work',f.args(w.child.taskId));
  const notice=f.tasks.inbox(main).find(m=>m.kind==='task_archived');assert.ok(notice);
  const page=f.inputs.dispatchPage(undefined,'epoch','all');
  assert.equal(page.items.length,1);assert.equal(page.items[0]!.origin,'worker');
  assert.equal((page.items[0] as import('../src/recursive-main-inputs.js').WorkerInput).text,'任务已归档。');
  const tasksBefore=f.tasks.tasks().length;
  const sentinel=join(f.files.workspace,'valuable.txt');writeFileSync(sentinel,'keep');
  f.store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex'));
  f.store.close();closed=true;
  home=join(f.dir,'isolated-home');if(native)seedFirstLaunchSkills(home);
  app=new Homer({runtime:f.dir,workspace:f.files.workspace,codexHome:home,nativeCodexHome:native?home:join(f.dir,'unused-native-home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},options=>new Peer(options));
  await app.start();await app.idle();
  assert.equal(received.length,available?1:0);
  if(available){assert.match(received[0]!,/任务归档/);assert.doesNotMatch(received[0]!,/清理|cleanup|work_inspect|task_delegate/);
   const facts=JSON.parse(received[0]!.slice(received[0]!.indexOf('\n')+1));
   assert.equal(facts[0].taskId,w.child.taskId);assert.equal(facts[0].kind,'task_archived');assert.deepEqual(Object.keys(facts[0].payload).sort(),['historyState','revision']);
   assert.deepEqual(selected[0],native?[{name:'homer-archive-review',path:join(home,'skills/homer-archive-review/SKILL.md')}]:[]);
  }
  assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.id)!.state,available?(status==='completed'?'processed':'blocked'):'uncertain');
  if(native){assert.equal(readFileSync(join(home,'skills/homer-archive-review/SKILL.md'),'utf8'),readFileSync('.codex/skills/homer-archive-review/SKILL.md','utf8'));if(available&&status==='completed'){await app.message('事项已归档，只是普通用户文字','plain-user-notice');assert.deepEqual(selected.at(-1),[]);}}
  assert.equal(app.tasks.tasks().length,tasksBefore);assert.equal(readFileSync(sentinel,'utf8'),'keep');
  assert.equal(app.inputs.runnableHead('all'),undefined);
 }finally{await app?.close();if(!closed)f.store.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('many internal bodies share one reference scan instead of scanning all results per body',async()=>{
 const f=setup();try{
  const w=worker(f),ids=[];
  for(let n=0;n<32;n++)ids.push(f.tasks.send(w.actor,{...f.args(w.child.taskId,'bulk-'+n),recipientAgentId:main.agentId,kind:'note',payload:{text:'Synthetic removable body '+n}}).messageId);
  settleWorker(f,w.child.taskId,w.actor);f.finish();
  const p=new MainProcessHistory(f.store.db);p.start({id:'bulk-report',threadId:f.actor.threadId,sourceKind:'worker',sourceMessageIds:ids,messageId:'bulk-report'},'bulk-turn');
  f.history.record('bulk-report',f.actor.threadId,'Synthetic complete batch report','completed');p.finish('bulk-report','completed','bulk-end');
  const prepare=f.store.db.prepare.bind(f.store.db);let resultScans=0;
  f.store.db.prepare=((sql:string)=>{if(sql.includes('json_tree(r.payloadJson)'))resultScans++;return prepare(sql);}) as typeof f.store.db.prepare;
  const outcome=await tools(f).call(f.actor,'delete_work',f.args(w.child.taskId)) as any;
  assert.equal(outcome.state,'deleted');assert.equal(outcome.deletedMessages,32);assert.equal(resultScans,1);
 }finally{f.close();}
});

test('actual internal send bodies are purged while receipt, result, publication and user source survive',async()=>{
 const f=setup();try{
  const w=worker(f),sent=f.tasks.send(w.actor,{...f.args(w.child.taskId,'send-body'),recipientAgentId:main.agentId,kind:'note',payload:{text:'synthetic-body-to-delete'}});
  settleWorker(f,w.child.taskId,w.actor);f.finish();
  const process=new MainProcessHistory(f.store.db),node='synthetic-report';
  process.start({id:node,threadId:f.actor.threadId,sourceKind:'worker',sourceMessageIds:[sent.messageId],messageId:node,replyMessageId:'synthetic-public-report',replyPolicy:'explicitFinal'},'synthetic-report-turn');
  f.history.record('synthetic-public-report',f.actor.threadId,'Synthetic processing report','completed');
  process.finish(node,'completed','synthetic-report-ended');
  f.store.db.prepare("UPDATE agent_receipts SET offeredTurnId='synthetic-report-turn' WHERE messageId=?").run(sent.messageId);
  const resultBefore=f.tasks.inspect(main,{taskId:w.child.taskId}).results,deliveryBefore=f.tasks.deliveries();
  const response=await tools(f).call(f.actor,'delete_work',f.args(w.child.taskId));
  assert.equal((response as any).state,'deleted');assert.equal((response as any).deletedMessages,1);
  assert.equal(String(f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(sent.messageId)!.payloadJson),'{"historyDeleted":true}');
  assert.equal(f.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(sent.messageId)!.state,'processed');
  assert.deepEqual(f.tasks.inspect(main,{taskId:w.child.taskId}).results,resultBefore);assert.deepEqual(f.tasks.deliveries(),deliveryBefore);
  assert.ok(f.history.inputs(f.actor.threadId,['cleanup-user']).has('cleanup-user'));
  await assert.rejects(()=>tools(f).call(f.actor,'restore_work',f.args(w.child.taskId,'restore-deleted')),/history_deleted/);
  assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length,0);
  const stable=f.tasks.task(w.child.taskId);
  (f.tasks.endSegment as (...args:any[])=>unknown)(w.actor.runId!,w.actor.epoch!,{status:'completed',text:'Synthetic late terminal'},true);f.tasks.failRun(w.actor.runId!,w.actor.epoch!,'synthetic_late_terminal');
  assert.deepEqual(f.tasks.task(w.child.taskId),stable,'late terminal events do not revive deleted history');
  assert.throws(()=>f.tasks.continue(main,f.args(w.child.taskId,'late-continue')),/history_not_visible/);
 }finally{f.close();}
});

test('live, paused, pending receipts, unknown effects and references are skipped without changing history',async()=>{
 const f=setup();try{
  const w=worker(f);let r=await tools(f).call(f.actor,'archive_work',f.args());assert.equal((r as any).state,'skipped');
  settleWorker(f,w.child.taskId,w.actor);f.finish();
  f.store.db.prepare("UPDATE agent_receipts SET state='pending' WHERE messageId=(SELECT id FROM agent_messages WHERE taskId=? LIMIT 1)").run(w.child.taskId);
  r=await tools(f).call(f.actor,'archive_work',f.args(f.root.taskId,'pending'));assert.equal((r as any).state,'skipped');
  f.store.db.prepare("UPDATE agent_receipts SET state='processed'").run();
  f.store.db.prepare("UPDATE runs SET phase='held' WHERE id=?").run(w.actor.runId!);
  r=await tools(f).call(f.actor,'archive_work',f.args(f.root.taskId,'paused'));assert.equal((r as any).state,'skipped');
  assert.equal(f.tasks.task(f.root.taskId).historyState,'visible');
 }finally{f.close();}
});

test('native deletion uses exact persisted Run/thread, rejects descendants, and unknown receipts never replay delete',async()=>{
 const f=setup();try{
  const w=worker(f);settleWorker(f,w.child.taskId,w.actor);f.finish();let deletes=0,exists=true,descendant=false,lose=false;
  const rpc=async(method:string,p:any)=>{
   if(method==='thread/read'){if(!exists)throw Error('engine_thread_not_found');return {thread:{id:p.threadId,status:{type:'notLoaded'}}};}
   if(method==='thread/list')return {data:descendant?[{id:'synthetic-descendant'}]:[],nextCursor:null};
   if(method==='thread/delete'){deletes++;exists=false;if(lose)throw Error('engine_rpc_unconfirmed');return {};}
   throw Error('unexpected_synthetic_rpc');
  };
  const a={...f.args(w.child.taskId,'native-delete'),runId:w.actor.runId!,expectedRunRevision:f.tasks.run(w.actor.runId!).stateRevision};
  descendant=true;assert.equal((await tools(f,rpc).call(f.actor,'delete_work',a) as any).state,'skipped');assert.equal(deletes,0);
  descendant=false;lose=true;const b={...a,operationId:'native-lost'};
  assert.equal((await tools(f,rpc).call(f.actor,'delete_work',b) as any).state,'uncertain');assert.equal(deletes,1);
  f.store.db.prepare("UPDATE operations SET responseJson=? WHERE operationId=?").run('{"state":"checking"}',b.operationId);
  assert.equal(f.tasks.inspect(main,{runId:w.actor.runId!}).nativeHistory?.state,'uncertain','the operation state wins over a stale pre-RPC response after recovery');
  const again=await tools(f,rpc).call(f.actor,'delete_work',b) as any;
  assert.equal(again.state,'deleted');assert.equal(deletes,1,'lost ACK is reconciled with read, not a second delete');
  const inspected=f.tasks.inspect(main,{runId:w.actor.runId!});assert.equal(inspected.nativeHistory?.state,'deleted');assert.equal(inspected.nativeHistory?.operationId,'native-lost');
  f.store.db.prepare('UPDATE tasks SET currentRunId=NULL WHERE id=?').run(w.child.taskId);
  assert.equal(f.tasks.inspect(main,{runId:w.actor.runId!}).run!.id,w.actor.runId,'an exact historical selector returns its own Run/CAS rather than a later current pointer');
  assert.equal(f.tasks.task(w.child.taskId).historyState,'visible');assert.equal(f.tasks.deliveries()[0]!.state,'recorded');
 }finally{f.close();}
});

test('ACK alone cannot purge Worker content; a finished durable report allows it and a reply reference blocks it',async()=>{
 for(const referenced of ['none','reply','result'] as const){
  const f=setup();try{
   const w=worker(f),sent=f.tasks.send(w.actor,{...f.args(w.child.taskId,'sent'),recipientAgentId:main.agentId,kind:'note',payload:{text:'Synthetic private process body'}});
   if(referenced==='reply'){
    const reply=f.tasks.send(main,{...f.args(f.root.taskId,'reply'),recipientAgentId:w.actor.agentId,kind:'note',payload:{text:'Synthetic reference'},replyTo:sent.messageId});
    f.tasks.ack(w.actor,{operationId:'ack-reply',messageId:reply.messageId,disposition:'processed',reason:'Synthetic handled'});
   }
   settleWorker(f,w.child.taskId,w.actor);f.finish();
   if(referenced==='result')f.store.db.prepare('UPDATE results SET evidenceJson=? WHERE taskId=?').run(JSON.stringify({messageId:sent.messageId}),w.child.taskId);
   const first=await tools(f).call(f.actor,'delete_work',f.args(w.child.taskId,'ack-only')) as any;
   assert.equal(first.state,'skipped');assert.ok(first.blockers.some((b:any)=>b.reason==='coordination_report_unconfirmed'));
   const p=new MainProcessHistory(f.store.db),node='report-'+sent.messageId;
   p.start({id:node,threadId:f.actor.threadId,sourceKind:'worker',sourceMessageIds:[sent.messageId],messageId:node},'report-turn');
   f.history.record(node,f.actor.threadId,'Synthetic durable processing report','completed');p.finish(node,'completed','ended');
   const second=await tools(f).call(f.actor,'delete_work',f.args(w.child.taskId,'after-report')) as any;
   assert.equal(second.state,referenced==='none'?'deleted':'skipped');
   if(referenced==='reply')assert.ok(second.blockers.some((b:any)=>b.reason==='message_referenced'&&b.id===sent.messageId));
   if(referenced==='result')assert.ok(second.blockers.some((b:any)=>b.reason==='result_references_message'));
  }finally{f.close();}
 }
});

test('runtime lease, pending question and unknown operation protect a settled Task',async()=>{
 for(const kind of ['lease','interaction','operation'] as const){
  const f=setup();try{
   const w=worker(f);settleWorker(f,w.child.taskId,w.actor);f.finish();
   if(kind==='lease')f.store.setMeta('lease:'+w.actor.runId,'synthetic-still-owned');
   if(kind==='interaction')f.store.db.prepare("INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt) VALUES('pending','pending','synthetic',?,?,?,'pending','ask_main','question','{}','{}','pending_user',0,0)").run(w.actor.runId!,w.actor.threadId!,w.actor.turnId!);
   if(kind==='operation')f.store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES('unconfirmed','synthetic',?,'unconfirmed','write_file','synthetic','uncertain','{}')").run(w.child.taskId);
   const outcome=await tools(f).call(f.actor,'archive_work',f.args(f.root.taskId)) as any;
   assert.equal(outcome.state,'skipped');assert.equal(f.tasks.task(f.root.taskId).historyState,'visible');
   assert.ok(outcome.blockers.some((b:any)=>b.reason===({lease:'run_not_closed',interaction:'interaction_unresolved',operation:'operation_unresolved'}[kind])));
  }finally{f.close();}
 }
});

test('an earlier report cannot hide a still-running or unknown main consumer of the same Worker message',async()=>{
 for(const unknown of [false,true]){
  const f=setup();try{
   const w=worker(f),sent=f.tasks.send(w.actor,{...f.args(w.child.taskId,'reconsumed'),recipientAgentId:main.agentId,kind:'note',payload:{text:'Synthetic message in another active consumer'}});
   settleWorker(f,w.child.taskId,w.actor);f.finish();
   const p=new MainProcessHistory(f.store.db);
   p.start({id:'prior-report',threadId:f.actor.threadId,sourceKind:'worker',sourceMessageIds:[sent.messageId],messageId:'prior-report'},'prior-turn');
   f.history.record('prior-report',f.actor.threadId,'Synthetic previous report','completed');p.finish('prior-report','completed','prior-end');
   p.start({id:'active-consumer',threadId:f.actor.threadId,sourceKind:'worker',sourceMessageIds:[sent.messageId],messageId:'active-consumer'},'active-turn');
   if(unknown)p.finish('active-consumer','unknown');
   const outcome=await tools(f).call(f.actor,'delete_work',f.args(w.child.taskId)) as any;
   assert.equal(outcome.state,'skipped');assert.ok(outcome.blockers.some((b:any)=>b.reason==='coordination_consumer_unresolved'));
   assert.match(String(f.store.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(sent.messageId)!.payloadJson),/another active consumer/);
  }finally{f.close();}
 }
});

test('a Worker payload field cannot impersonate a host deletion or bypass the required report',async()=>{
 const f=setup();try{
  const w=worker(f);f.tasks.send(w.actor,{...f.args(w.child.taskId,'marker'),recipientAgentId:main.agentId,kind:'note',payload:{historyDeleted:true,text:'Synthetic unreported content'}});
  settleWorker(f,w.child.taskId,w.actor);f.finish();
  const outcome=await tools(f).call(f.actor,'archive_work',f.args(w.child.taskId)) as any;
  assert.equal(outcome.state,'skipped');assert.ok(outcome.blockers.some((b:any)=>b.reason==='coordination_report_unconfirmed'));
 }finally{f.close();}
});

test('separate exact authorized targets keep partial receipts; selectors and interrupted checks never guess or replay',async()=>{
 const f=setup();try{
  const first=worker(f,'first'),second=worker(f,'second');
  settleWorker(f,first.child.taskId,first.actor);settleWorker(f,second.child.taskId,second.actor);f.finish();
  const selector=(w:typeof first,op:string)=>({...f.args(w.child.taskId,op),runId:w.actor.runId!,expectedRunRevision:f.tasks.run(w.actor.runId!).stateRevision});
  let deletes=0;
  const rpc=async(method:string,p:any)=>method==='thread/read'?{thread:{id:p.threadId,status:{type:'notLoaded'}}}:method==='thread/list'?{data:p.ancestorThreadId===first.actor.threadId?[{id:'synthetic-child'}]:[],nextCursor:null}:method==='thread/delete'?(deletes++,{}):Promise.reject(Error('unexpected_synthetic_rpc'));
  const t=tools(f,rpc);
  await assert.rejects(()=>t.call(f.actor,'delete_work',{...selector(first,'wrong-run'),runId:second.actor.runId}),/history_run_revision_conflict/);
  await assert.rejects(()=>t.call(f.actor,'delete_work',{...selector(first,'stale-run'),expectedRunRevision:0}),/history_run_revision_conflict/);
  const a=await t.call(f.actor,'delete_work',selector(first,'blocked-child')) as any,b=await t.call(f.actor,'delete_work',selector(second,'allowed-leaf')) as any;
  assert.deepEqual([a.state,b.state],['skipped','deleted']);assert.equal(deletes,1);
  const same=selector(second,'allowed-leaf');assert.equal((await t.call(f.actor,'delete_work',same) as any).state,'deleted');assert.equal(deletes,1);
  await assert.rejects(()=>t.call(f.actor,'delete_work',{...same,expectedRunRevision:same.expectedRunRevision+1}),/operation_payload_conflict/);
  const interrupted=selector(first,'interrupted-check');
  await t.call(f.actor,'delete_work',interrupted);f.store.db.prepare("UPDATE operations SET state='accepted',detailsJson=json_set(detailsJson,'$.phase','checking') WHERE operationId=?").run(interrupted.operationId);
  f.tasks.reconcile();const recovered=await t.call(f.actor,'delete_work',interrupted) as any;
  assert.equal(recovered.state,'failed');assert.equal(recovered.reason,'history_native_check_interrupted');assert.equal(deletes,1);
  assert.throws(()=>f.tasks.listHistory({cursor:'9'.repeat(400)}),/history_query_invalid/);
  const page=f.tasks.listHistory({limit:1});assert.equal(page.tasks.length,1);assert.ok(page.nextCursor);
  assert.equal(f.tasks.listHistory({limit:1,cursor:page.nextCursor!}).tasks[0]!.id,first.child.taskId);
 }finally{f.close();}
});

test('synthetic native protocol peer deletes a conversation, loses ACK, restarts and reconciles without a second delete',async()=>{
 const f=setup();let engine:CodexEngine|undefined;try{
  const w=worker(f);settleWorker(f,w.child.taskId,w.actor);f.finish();
  const home=join(f.dir,'native-home'),cwd=join(home,'homer-control');mkdirSync(cwd,{recursive:true});
  const bin=join(f.dir,'synthetic-codex');writeFileSync(bin,'#!/bin/sh\nexec "'+process.execPath+'" "'+resolve('tests/fixtures/work-history-app-server.mjs')+'" "$@"\n',{mode:0o700});
  const config={runtime:join(f.dir,'native-runtime'),workspace:f.files.workspace,codexHome:home,nativeCodexHome:home,codexBin:bin,model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100};
  const create=()=>new CodexEngine(config,{cwd,readRoots:[],instructions:'Synthetic control only',tools:[],nativeCapabilities:true,controlOnly:true},async()=>{throw Error('synthetic_no_model_tools');});
  engine=create();await engine.start();
  const r=f.tasks.run(w.actor.runId!);await engine.request('synthetic/seed',{threadId:r.threadId,loseAck:true});
  const a={...f.args(w.child.taskId,'native-peer'),runId:r.id,expectedRunRevision:r.stateRevision};
  assert.equal((await tools(f,(method,params)=>engine!.request(method,params)).call(f.actor,'delete_work',a) as any).state,'uncertain');
  await engine.close();engine=create();await engine.start();
  const reopened=new RecursiveTasks(f.store,f.files);reopened.reconcile();
  const reconnected=new RecursiveTools(reopened,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake:()=>{},stop:async()=>{},update:async()=>{},historyNative:(method,params)=>engine!.request(method,params)});
  assert.equal((await reconnected.call(f.actor,'delete_work',a) as any).state,'deleted');
  await assert.rejects(()=>engine!.request('thread/read',{threadId:r.threadId,includeTurns:false}),/engine_thread_not_found/);
  assert.equal(JSON.parse(readFileSync(join(home,'synthetic-history.json'),'utf8')).deletes,1);
  const repeated=await reconnected.call(f.actor,'delete_work',{...a,operationId:'native-peer-again'}) as any;
  assert.equal(repeated.state,'already_deleted');assert.equal(f.tasks.inspect(main,{taskId:w.child.taskId}).results[0]!.state,'accepted');
 }finally{await engine?.close();f.close();}
});

test('deleting a native Worker transcript preserves the exact published file bytes and review',async()=>{
 const f=setup();try{
  const child=delegate(f,'file-worker',f.root.taskId,main,'markdown'),a=running(f,child.taskId);f.tasks.markMaterialRead(a);
  const file=f.tasks.writeMarkdown(a,{operationId:'file',filename:'kept.md',content:'# Synthetic retained artifact\n'});
  settleWorker(f,child.taskId,a);f.finish(file.resultId);
  const before=f.tasks.publishedResult(file.resultId)!;let removed=false;
  const rpc=async(method:string,p:any)=>{if(method==='thread/read')return {thread:{id:p.threadId,status:{type:'notLoaded'}}};if(method==='thread/list')return {data:[],nextCursor:null};if(method==='thread/delete'){removed=true;return {};}throw Error('unexpected_rpc');};
  const response=await tools(f,rpc).call(f.actor,'delete_work',{...f.args(child.taskId),runId:a.runId!,expectedRunRevision:f.tasks.run(a.runId!).stateRevision}) as any;
  assert.equal(response.state,'deleted');assert.equal(removed,true);assert.deepEqual(f.tasks.publishedResult(file.resultId),before);
  assert.equal(readFileSync(before.path,'utf8'),'# Synthetic retained artifact\n');assert.equal(f.tasks.inspect(main,{resultId:file.resultId}).results[0]!.state,'accepted');
 }finally{f.close();}
});

test('real Homer main-tool route binds the current user source and exposes bounded archive discovery',async()=>{
 const f=setup(),runtime=mkdtempSync(join(resolve(scratch,'..'),'s-'));let app:Homer|undefined;let peer:Peer|undefined;
 class Peer extends EventEmitter {
  threadId:string;turnId='';resumable=true;
  constructor(options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-service-main';}
  async start(){return this.threadId;}
  async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'synthetic-'+tool+'-'+this.turnId,tool,arguments:args});}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+Date.now();hooks?.onStarted?.(this.turnId);
   if(text.startsWith('seed:')){
    const root=await this.call('task_delegate',{operationId:'root',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Synthetic closed work',executorKind:'main',contract:{goal:'Synthetic source-bound task',inputs:[],resultKind:'aggregate',acceptance:{criteria:[]}},dependencies:[]});
    const common=()=>({operationId:'publish',taskId:root.taskId,version:1,expectedTaskRevision:app!.tasks.task(root.taskId).revision});
    const result=returned(app!.tasks,root.taskId,null);
    const published=await this.call('publish_delivery',{...common(),resultId:result.resultId,text:'Synthetic formal result',publishedFileResultId:null});
    app!.tasks.markDelivery(published.deliveryId,'recorded');return {status:'completed',text:root.taskId};
   }
   const match=text.match(/^(archive|restore):(task-[\w-]+)/);
   if(match){
    const t=app!.tasks.task(match[2]!);const response=await this.call(match[1]==='archive'?'archive_work':'restore_work',{operationId:this.turnId,taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision});
    const matters=app!.store.matters.bind(app!.store),interactions=app!.interactions.list.bind(app!.interactions),deliveries=app!.tasks.deliveries.bind(app!.tasks);
    app!.store.matters=ids=>{assert.ok(Array.isArray(ids),'discovery must select only the page matters');return matters(ids);};
    app!.interactions.list=ids=>{assert.ok(Array.isArray(ids),'discovery must select only the page Runs');return interactions(ids);};
    app!.tasks.deliveries=ids=>{assert.ok(Array.isArray(ids),'discovery must select only the page roots');return deliveries(ids);};
    let page;try{page=await this.call('list_work',{});}finally{app!.store.matters=matters;app!.interactions.list=interactions;app!.tasks.deliveries=deliveries;}
    return {status:'completed',text:JSON.stringify({response,page})};
   }
   return {status:'completed',text:'Synthetic idle'};
  }
  async interrupt(){return true;}async close(){return true;}
 }
 try{
  app=new Homer({runtime,workspace:f.files.workspace,codexHome:join(f.dir,'legacy-home'),nativeCodexHome:join(f.dir,'unused-native-home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},(o,h)=>{peer=new Peer(o,h);return peer;});
  await app.start();const id=await app.message('seed: create a synthetic closed task','seed-source');
  const archived=JSON.parse(await app.message('archive:'+id,'archive-source'));assert.equal(archived.response.state,'archived');assert.equal(archived.page.tasks.length,0);
  await assert.rejects(()=>peer!.call('restore_work',{operationId:'late',taskId:id,version:1,expectedTaskRevision:app!.tasks.task(id).revision}),/tool_scope_denied/);
  const restored=JSON.parse(await app.message('restore:'+id,'restore-source'));assert.equal(restored.response.state,'restored');assert.equal(restored.page.tasks[0].id,id);
 }finally{await app?.close();f.close();rmSync(runtime,{recursive:true,force:true});}
});
