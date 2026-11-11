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
import {fixture,main,openWorker,running,complete,mutation,processReplies,type Fixture} from './recursive-fixture.js';
function settled(f:Fixture){const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Synthetic investigation complete.');processReplies(f);f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'succeeded'});return {worker,actor,reply};}

test('archive requires Main, an actual same-thread user source and current CAS',()=>{
 const f=fixture();try{
  const w=settled(f),input=mutation(f,'archive'),before=f.tasks.task(f.task.taskId);
  for(const actor of [{...main,sourceRequestId:undefined},{...main,sourceRequestId:'forged'},{...main,threadId:'foreign'},w.actor])assert.throws(()=>f.tasks.archiveHistory(actor,input,true),/history_source|source_denied|identity|main_required/);
  assert.throws(()=>f.tasks.archiveHistory(main,{...input,expectedRevision:input.expectedRevision-1},true),/revision_conflict/);assert.deepEqual(f.tasks.task(before.id),before);
 }finally{f.close();}
});

test('archive/restore retain Task identity, raw messages and exact attachment bytes without starting execution',()=>{
 const f=fixture();try{
  const w=settled(f),filePath=join(f.files.workspace,'valuable.md'),bytes=Buffer.from('# Keep valuable work\n');writeFileSync(filePath,bytes);
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
  settled(f);const notices=()=>f.tasks.inbox(main).filter(message=>message.kind==='task_archived'),input=mutation(f,'archive'),archived=f.tasks.archiveHistory(main,input,true);
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
  settled(f);const before=f.tasks.task(f.task.taskId),count=f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,input=mutation(f,'archive');
  f.store.db.exec("CREATE TEMP TRIGGER reject_archive_notice BEFORE INSERT ON agent_messages WHEN NEW.kind='task_archived' BEGIN SELECT RAISE(ABORT,'synthetic_notice_failure'); END");
  assert.throws(()=>f.tasks.archiveHistory(main,input,true),/synthetic_notice_failure/);assert.deepEqual(f.tasks.task(before.id),before);assert.equal(f.store.db.prepare('SELECT count(*) n FROM operations').get()!.n,count);
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='task_archived').length,0);
  f.store.db.exec('DROP TRIGGER reject_archive_notice');assert.equal(f.tasks.archiveHistory(main,input,true).state,'archived');
 }finally{f.close();}
});

for(const blocker of ['live','paused','unknown-exit','lease','operation','pending-reply','interaction'] as const)test('archive preserves all facts while '+blocker+' remains unresolved',()=>{
 const f=fixture();try{
  const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Useful readable answer',blocker!=='unknown-exit');
  if(blocker!=='pending-reply')processReplies(f);
  if(!['live','paused','unknown-exit'].includes(blocker))f.tasks.settleTask(main,{...mutation(f,'settle'),outcome:'succeeded'});
  if(blocker==='live')openWorker(f,'still-running');
  if(blocker==='paused')f.tasks.controlTask(main,{...mutation(f,'pause'),action:'pause'});
  if(blocker==='lease')f.store.setMeta('lease:'+worker.runId,'synthetic-owned');
  if(blocker==='operation')f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(worker.operationKey);
  if(blocker==='interaction')f.store.db.prepare("INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt) VALUES('pending','pending','synthetic',?,?,?,'pending','ask_main','question','{}','{}','pending_user',0,0)").run(worker.runId,actor.threadId!,actor.turnId!);
  const before=f.tasks.task(f.task.taskId),response=f.tasks.archiveHistory(main,mutation(f,'archive'),true);
  assert.equal(response.state,'skipped');assert.ok('blockers' in response&&response.blockers!.length>0);assert.deepEqual(f.tasks.task(before.id),before);
  assert.equal(f.tasks.workerRead(main,{workerId:worker.workerId,messageId:reply.messageId}).messages[0]!.text,'Useful readable answer');
  assert.equal(f.tasks.inbox(main).filter(message=>message.kind==='task_archived').length,0);
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
  const w=kind==='task_archived'?settled(f):(()=>{const worker=openWorker(f),actor=running(f,worker.runId),reply=complete(f,actor,'Ordinary raw reply');return {worker,actor,reply};})();
  if(kind==='task_archived')f.tasks.archiveHistory(main,mutation(f,'archive'),true);const notice=f.tasks.inbox(main).find(message=>message.kind===kind)!;
  const sentinel=join(workspace,'valuable.txt');writeFileSync(sentinel,'keep');seedFirstLaunchSkills(home);f.store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify([...MAIN_TOOLS,...RECURSIVE_TOOLS])).digest('hex'));f.store.close();closed=true;
  app=new Homer({runtime:f.dir,workspace,codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},options=>new Peer(options));
  await app.start();await app.idle();
  assert.equal(texts.length,kind==='worker_reply'||skillState==='enabled'?1:0);
  if(kind==='worker_reply'||skillState==='enabled'){
   assert.equal(JSON.parse(texts[0]!.split('\n')[1]!).kind,kind);assert.doesNotMatch(texts[0]!,/清理|cleanup|task_delegate|delete_work/);
   assert.deepEqual(selected[0],kind==='task_archived'?[{name:'homer-archive-review',path:join(home,'skills/homer-archive-review/SKILL.md')}]:[]);
   assert.equal(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.id)!.state,'processed');
   if(kind==='task_archived'){await app.message('事项已归档，只是普通用户文字','plain-user-notice');assert.deepEqual(selected.at(-1),[]);}
  }else assert.notEqual(app.store.db.prepare('SELECT state FROM agent_receipts WHERE messageId=?').get(notice.id)!.state,'processed');
  assert.equal(readFileSync(sentinel,'utf8'),'keep');assert.equal(app.tasks.tasks().length,1);assert.equal(app.tasks.runs()[0]!.id,w.actor.runId);
 }finally{await app?.close();if(!closed)f.store.close();rmSync(f.dir,{recursive:true,force:true});rmSync(workspace,{recursive:true,force:true});}
});
