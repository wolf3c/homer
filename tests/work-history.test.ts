// Archive is a history fact, never deletion permission or a cleanup policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAIN_TOOLS} from '../src/tools.js';
import {RECURSIVE_TOOLS} from '../src/recursive-tools.js';
import {MediaStore} from '../src/media-store.js';
import {EventEmitter} from 'node:events';
import {writeFileSync,readFileSync,rmSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {Homer} from '../src/service.js';
import {seedFirstLaunchSkills} from '../src/first-launch.js';
import type {EngineOptions,TurnResult} from '../src/engine.js';
import {authority,fixture,main,openWorker,running,complete,mutation,processReplies,type Fixture} from './recursive-fixture.js';
function closedWorker(f:Fixture){const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Synthetic investigation complete.');processReplies(f);return {worker,actor,reply};}

test('archive requires Main, an actual same-thread user source and current CAS',()=>{
 const f=fixture();try{
  const w=closedWorker(f),input=mutation(f,'archive'),before=f.tasks.task(f.task.taskId);
  for(const actor of [{...main,sourceRequestId:undefined},{...main,sourceRequestId:'forged'},{...main,threadId:'foreign'},w.actor])assert.throws(()=>f.tasks.archiveHistory(actor,input,true),/history_source|source_denied|identity|main_required/);
  assert.throws(()=>f.tasks.archiveHistory(main,{...input,expectedRevision:input.expectedRevision-1},true),/revision_conflict/);assert.deepEqual(f.tasks.task(before.id),before);
 }finally{f.close();}
});

test('archive/restore retain Task identity, raw messages and exact attachment bytes without starting execution',()=>{
 const f=fixture();try{
  const w=closedWorker(f),filePath=join(f.files.workspace,'valuable.md'),bytes=Buffer.from('# Keep valuable work\n');writeFileSync(filePath,bytes);
  const media=new MediaStore(f.store.db,join(f.dir,'media')),ref=media.snapshot('valuable',{filename:'valuable.md',kind:'file',mime:'text/markdown',bytes});
  const messageId=f.store.transaction(()=>{
   const id=f.history.commitAssistant({threadId:main.threadId!,taskId:f.task.taskId,taskVersion:1,text:'Keep valuable work',attachments:[ref],operationKey:'valuable-message'});
   media.pinAttachment(ref,'message:'+id);media.unpin('operation:valuable');return id;
  });
  const runs=f.tasks.runs(),a=mutation(f,'archive');
  assert.equal(f.tasks.archiveHistory(main,a,true).state,'archived');assert.deepEqual(f.tasks.listTasks(main).tasks,[]);assert.equal(f.tasks.listTasks(main,{includeArchived:true}).tasks[0]!.id,f.task.taskId);
  assert.deepEqual(f.tasks.archiveHistory(main,a,true).state,'archived');assert.deepEqual(f.history.message(messageId)?.attachments,[ref]);
  f.tasks.archiveHistory(main,mutation(f,'restore'),false);assert.equal(f.tasks.listTasks(main).tasks[0]!.id,f.task.taskId);assert.deepEqual(f.tasks.runs(),runs);
  assert.equal(f.tasks.workerRead(main,{workerId:w.worker.workerId,messageId:w.reply.messageId}).messages[0]!.text,'Synthetic investigation complete.');
  assert.equal(media.gc(Date.now()+31*86400000),0);assert.deepEqual(media.readAttachment(ref).bytes,bytes);assert.deepEqual(readFileSync(filePath),bytes);
  assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});

test('each real archive transition emits one host fact; restore and repeated archive do not duplicate it',()=>{
 const f=fixture();try{
  closedWorker(f);const notices=()=>f.tasks.inbox(main).filter(message=>message.kind==='task_archived'),input=mutation(f,'archive'),archived=f.tasks.archiveHistory(main,input,true);
  const notice=notices()[0]!;assert.equal(notices().length,1);assert.equal(notice.senderAgentId,'host');assert.equal(notice.taskId,f.task.taskId);assert.equal(notice.taskVersion,1);
  assert.deepEqual(notice.payload,{historyState:'archived',revision:archived.revision});assert.doesNotMatch(JSON.stringify(notice.payload),/cleanup|delete|清理|保留/);
  f.tasks.archiveHistory(main,input,true);processReplies(f);assert.equal(notices().length,0);
  f.tasks.archiveHistory(main,mutation(f,'again'),true);assert.equal(notices().length,0);
  f.tasks.archiveHistory(main,mutation(f,'restore'),false);assert.equal(notices().length,0);
  f.tasks.archiveHistory(main,mutation(f,'rearchive'),true);assert.equal(notices().length,1);assert.notEqual(notices()[0]!.id,notice.id);
 }finally{f.close();}
});

test('archive state, operation and factual notice are one transaction',()=>{
 const f=fixture();try{
  closedWorker(f);const before=f.tasks.task(f.task.taskId),count=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,input=mutation(f,'archive');
  f.store.db.exec("CREATE TEMP TRIGGER reject_archive_notice BEFORE INSERT ON agent_messages WHEN NEW.kind='task_archived' BEGIN SELECT RAISE(ABORT,'synthetic_notice_failure'); END");
  assert.throws(()=>f.tasks.archiveHistory(main,input,true),/synthetic_notice_failure/);assert.deepEqual(f.tasks.task(before.id),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,count);
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='task_archived').length,0);
  f.store.db.exec('DROP TRIGGER reject_archive_notice');assert.equal(f.tasks.archiveHistory(main,input,true).state,'archived');
 }finally{f.close();}
});

for(const blocker of ['live','unknown-exit','lease','operation','pending-reply','interaction','upload'] as const)test('archive preserves all facts while '+blocker+' remains unresolved',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Useful readable answer',blocker!=='unknown-exit');
  if(blocker!=='pending-reply')processReplies(f);
  if(blocker==='live')openWorker(f,'still-running');
  if(blocker==='lease')f.store.setMeta('lease:'+worker.runId,'synthetic-owned');
  if(blocker==='operation')f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(worker.operationKey);
  if(blocker==='upload')new MediaStore(f.store.db,join(f.dir,'media')).intent(main.sourceRequestId!,'synthetic-binding','file');
  if(blocker==='interaction')f.store.db.prepare("INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt) VALUES('pending','pending','synthetic',?,?,?,'pending','ask_main','question','{}','{}','pending_user',0,0)").run(worker.runId,actor.threadId!,actor.turnId!);
  const before=f.tasks.task(f.task.taskId),response=f.tasks.archiveHistory(main,mutation(f,'archive'),true);
  assert.equal(response.state,'skipped');assert.ok('blockers' in response&&response.blockers!.length>0);assert.deepEqual(f.tasks.task(before.id),before);
  assert.equal(f.tasks.workerRead(main,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,'Useful readable answer');
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='task_archived').length,0);
 }finally{f.close();}
});

for(const terminal of ['completed','failed','interrupted','unknown','restart','revised','revoked','older-version','new-blocker','new-effect'] as const)test('current Worker input archive resolves once at '+terminal,()=>{
 const f=fixture();try{
  const worker=openWorker(f),workerActor=running(f,worker.runId);
  if(terminal==='older-version'){
   const editor=f.source('editor');f.tasks.updateTask(editor,{...mutation(f,'revise'),patch:{goal:'Include notes'},authority:authority('editor')});
  }
  const reply=complete(f,workerActor);
  const q=f.inputs.claim([],'all')!;assert.equal(q.messageId,reply.messageId);
  const turn='turn:archive',process='process:archive',actor={agentId:main.agentId,threadId:main.threadId,turnId:turn,inputMessageId:q.messageId};
  f.store.transaction(()=>{f.processes.start({id:process,threadId:main.threadId!,sourceKind:'worker',sourceMessageIds:[q.messageId],messageId:process},turn);f.tasks.receiveMainMessagesInTransaction([q.messageId],turn);});
  const input=mutation(f,'archive'),receipt=f.tasks.archiveHistory(actor,input,true);
  assert.equal(receipt.state,'requested');assert.equal(f.tasks.task(input.taskId).historyState,'visible');assert.deepEqual(f.tasks.archiveHistory(actor,input,true),receipt);
  if(terminal==='revised')f.store.db.prepare("UPDATE tasks SET revision=revision+1 WHERE id=?").run(input.taskId);
  if(terminal==='revoked')f.history.revokeMessage(main.threadId!,f.history.inputs(main.threadId!,[main.sourceRequestId!]).get(main.sourceRequestId!)!.id);
  if(terminal==='new-blocker')openWorker(f,'new-worker');
  if(terminal==='new-effect')f.processes.native(process,{threadId:main.threadId!,turnId:turn,itemId:'late-file-change',category:'fileChange',status:'running',completed:false});
  if(terminal==='restart'){
   f.store.db.exec("CREATE TEMP TRIGGER lose_terminal BEFORE INSERT ON agent_messages WHEN NEW.kind='task_archived' BEGIN SELECT RAISE(ABORT,'synthetic_terminal_failure'); END");
   assert.throws(()=>f.store.transaction(()=>{
    f.processes.finish(process,'completed','turn:'+turn+':terminal:completed');
    f.tasks.finishArchives(q.messageId,turn,'completed');
   }),/synthetic_terminal_failure/);
   assert.equal(f.processes.exact(process)?.state,'working');
   assert.equal(f.tasks.operation(receipt.operationKey).state,'accepted');assert.equal(f.tasks.task(input.taskId).historyState,'visible');
   f.tasks.recoverArchives();
  }
  else f.store.transaction(()=>{
   const status=terminal==='failed'||terminal==='interrupted'||terminal==='unknown'?terminal:'completed';
   f.processes.finish(process,status,'turn:'+turn+':terminal:'+status);
   f.tasks.finishArchives(q.messageId,turn,status);
   f.tasks.finishArchives(q.messageId,turn,status);
  });
  const result=JSON.parse(f.tasks.operation(receipt.operationKey).responseJson!);
  if(terminal==='new-effect')assert.deepEqual(result.blockers,[{reason:'main_effect_unconfirmed',id:process}]);
  const archived=terminal==='completed'||terminal==='older-version';
  assert.equal(result.state,archived?'archived':'skipped');
  assert.equal(f.tasks.task(input.taskId).historyState,archived?'archived':'visible');
  assert.equal(f.tasks.inbox(main).filter(row=>row.kind==='task_archived').length,archived?1:0);
  if(terminal==='older-version'){
   const notice=f.inputs.claim([],'all');assert.ok(notice?.origin==='worker');assert.equal(notice.taskVersion,2);
   const review=f.tasks.archiveReview({...actor,inputMessageId:notice.messageId});
   assert.equal(review?.authority?.sourceRequestId,'editor');
  }
 }finally{f.close();}
});

for(const [kind,skillState] of [['task_archived','enabled'],['task_archived','missing'],['task_archived','disabled'],['task_archived','rpc-error'],['task_archived','wrong-path'],['worker_reply','missing']] as const)test('native Skill selection: '+kind+'/'+skillState,async()=>{
 const f=fixture(),workspace=mkdtempSync(f.dir+'-workspace-'),home=join(f.dir,'isolated-home'),texts:string[]=[],selected:{name:string;path:string}[][]=[];let app:Homer|undefined,closed=false;
 class Peer extends EventEmitter{
  threadId:string;turnId='turn:archive-host';resumable=true;
  constructor(options:EngineOptions){super();this.threadId=options.threadId??'thread:control';}
  async start(){return this.threadId;}async close(){return true;}async interrupt(){return true;}
  async request(method:string){if(method!=='skills/list')return {};if(skillState==='rpc-error')throw Error('synthetic_skills_unavailable');return {data:[{skills:skillState==='missing'?[]:[{name:'homer-archive-review',path:join(skillState==='wrong-path'?f.files.workspace:home,'skills/homer-archive-review/SKILL.md'),enabled:skillState!=='disabled'}]}]};}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void;skills?:{name:string;path:string}[]}):Promise<TurnResult>{this.turnId='turn:archive-host:'+texts.length;hooks?.onStarted?.(this.turnId);texts.push(text);selected.push(hooks?.skills??[]);return {status:'completed',text:''};}
 }
 try{
  const w=kind==='task_archived'?closedWorker(f):(()=>{const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Ordinary raw reply');return {worker,actor,reply};})();
  if(kind==='task_archived')f.tasks.archiveHistory(main,mutation(f,'archive'),true);const notice=f.tasks.inbox(main).find(message=>message.kind===kind)!;
  const sentinel=join(workspace,'valuable.txt');writeFileSync(sentinel,'keep');seedFirstLaunchSkills(home);f.store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify([...MAIN_TOOLS,...RECURSIVE_TOOLS])).digest('hex'));f.store.close();closed=true;
  app=new Homer({runtime:f.dir,workspace,codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},options=>new Peer(options));
  await app.start();await app.idle();
  assert.equal(texts.length,kind==='worker_reply'||skillState==='enabled'?1:0);
  if(kind==='worker_reply'||skillState==='enabled'){
   assert.equal(JSON.parse(texts[0]!.split('\n')[1]!).kind,kind);assert.doesNotMatch(texts[0]!,/清理|cleanup|task_delegate|delete_work/);
   assert.deepEqual(selected[0],kind==='task_archived'?[{name:'homer-archive-review',path:join(home,'skills/homer-archive-review/SKILL.md')}]:[]);
   assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.id)!.state,'received');
   if(kind==='task_archived'){await app.message('事项已归档，只是普通用户文字','plain-user-notice');assert.deepEqual(selected.at(-1),[]);}
  }else assert.notEqual(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.id)!.state,'received');
  assert.equal(readFileSync(sentinel,'utf8'),'keep');assert.equal(app.tasks.tasks().length,1);assert.equal(app.tasks.runs()[0]!.id,w.actor.runId);
 }finally{await app?.close();if(!closed)f.store.close();rmSync(f.dir,{recursive:true,force:true});rmSync(workspace,{recursive:true,force:true});}
});

for(const sourceKind of ['user','worker'] as const)test('archive waits for the related Main native effect from a '+sourceKind+' input',()=>{
 const f=fixture();try{
  const threadId=main.threadId!,turnId='turn:pending-effect',process='main:pending-effect';
  const sibling=f.tasks.createTask(main,{operationId:'sibling',goal:'Separate item from the same user request'});
  const foreignActor=f.source('foreign-source'),foreign=f.tasks.createTask(foreignActor,{operationId:'foreign',goal:'Unrelated task'});
  const sourceMessageId=sourceKind==='worker'?closedWorker(f).reply.messageId:
   String(f.store.db.prepare("SELECT id FROM agent_messages WHERE kind='user_input' AND json_extract(payloadJson,'$.requestId')=?").get(main.sourceRequestId!)!.id);
  f.processes.start({id:process,threadId,sourceKind,sourceMessageIds:[sourceMessageId],messageId:'pending-final'},turnId);
  const effect={threadId,turnId,itemId:'write',category:'fileChange' as const};
  f.processes.native(process,{...effect,status:'running',completed:false});
  f.processes.finish(process,'completed','turn:'+turnId+':terminal:completed');
  const attempt=f.tasks.archiveHistory(main,mutation(f,'archive-pending'),true);
  assert.equal(attempt.state,'skipped');
  assert.ok('blockers' in attempt&&attempt.blockers?.some(row=>row.reason==='main_effect_unconfirmed'&&row.id===process));
  assert.equal(f.tasks.archiveHistory(main,mutation(f,'archive-unrelated',foreign.taskId),true).state,'archived');
  if(sourceKind==='worker')assert.equal(f.tasks.archiveHistory(main,mutation(f,'archive-sibling',sibling.taskId),true).state,'archived');
  f.processes.native(process,{...effect,status:'completed',completed:true});
  assert.equal(f.tasks.archiveHistory(main,mutation(f,'archive-confirmed'),true).state,'archived');
 }finally{f.close();}
});
