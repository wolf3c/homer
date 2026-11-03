import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { classifyTask, overviewStats, filterRoots, readTaskOverview, readTaskDetail, type OverviewTask } from '../src/task-overview.js';
const task=(extra:Partial<OverviewTask>={}):OverviewTask=>({sourceRequestId:'request',id:'root',rootTaskId:'root',parentTaskId:null,goal:'根目标',executorKind:'worker',executorAgentId:'worker-a',coordinatorAgentId:'main',headVersion:1,revision:0,state:'working',outcome:null,controlState:'normal',currentRunId:'current',run:{id:'current',status:'running',phase:'executing',contractVersion:1,epoch:0,summary:null,sourceRequestId:'request'},result:null,delivery:null,pendingUser:0,pendingMain:0,...extra});
test('current execution, pending user/main, partial and delivery are separate facts',()=>{
 const t=task();assert.equal(classifyTask(t).key,'running');
 assert.equal(classifyTask(task({pendingUser:1})).key,'user');
 assert.equal(classifyTask(task({pendingMain:1})).key,'main');
 assert.equal(classifyTask(task({result:{id:'result',state:'offered',outcome:'succeeded'}})).key,'review');
 const finished=task({state:'settled',outcome:'succeeded',run:{...t.run!,status:'succeeded',phase:'ended'},result:{id:'result',state:'accepted',outcome:'succeeded'},delivery:{state:'recorded',outcome:'succeeded',resultId:'result'}});
 assert.equal(classifyTask(finished).key,'complete');
 for(const state of ['prepared','uncertain','submitting'])assert.notEqual(classifyTask({...finished,delivery:{...finished.delivery!,state}}).key,'complete');
 assert.notEqual(classifyTask({...finished,result:{...finished.result!,outcome:'partial'}}).key,'complete');
 assert.notEqual(classifyTask({...finished,delivery:{...finished.delivery!,resultId:'other'}}).key,'complete');
 assert.equal(classifyTask(task({controlState:'held'})).key,'other');
 assert.equal(classifyTask(task({run:{...t.run!,phase:'uncertain'}})).key,'unknown');
 assert.equal(classifyTask(task({run:null})).key,'unknown');
 assert.equal(classifyTask(task({state:'settled',outcome:'failed',run:{...t.run!,status:'failed',phase:'ended'}})).key,'other');
 assert.equal(classifyTask(task({state:'settled',outcome:'cancelled',run:{...t.run!,status:'cancelled',phase:'ended'}})).label,'已取消');
});
test('root filters include descendant names and states; workers use current identities only',()=>{
 const roots=[task({executorKind:'main',executorAgentId:'main'}),task({id:'second',rootTaskId:'second'})];
 const children=[task({id:'child',parentTaskId:'root',goal:'查证子任务'}),task({id:'child2',parentTaskId:'child',pendingUser:1}),task({id:'held',parentTaskId:'root',controlState:'held'})];
 const data=[...roots,...children];
 assert.equal(overviewStats(data).roots,2);assert.equal(overviewStats(data).activeWorkers,1);assert.equal(overviewStats(data).activeRuns,4);
 assert.deepEqual(filterRoots(data,'all','查证').map(t=>t.id),['root']);
 assert.deepEqual(filterRoots(data,'user','').map(t=>t.id),['root']);
 assert.equal(filterRoots(data,'queued','').length,0);
 assert.equal(filterRoots(data,'all','<script>').length,0);
});
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE tasks(id,rootTaskId,parentTaskId,executorKind,executorAgentId,coordinatorAgentId,headVersion,revision,state,outcome,controlState,currentRunId);
 CREATE TABLE matters(id,title);
 CREATE TABLE meta(key,value);
 CREATE TABLE agent_messages(id,taskId,taskVersion,kind,targetRunId,seq);
 CREATE TABLE agent_receipts(messageId,recipientAgentId,state,revision);
 CREATE TABLE operations(id,scopeId,kind,state,revision,detailsJson,responseJson);
 CREATE TABLE task_versions(taskId,version,goal,sourceRequestId,triggerOpId);
 CREATE TABLE runs(id,taskId,status,phase,contractVersion,epoch,summary,sourceRequestId,stateRevision,activeMs,replacesRunId,createdAt,startedAt,endedAt);
 CREATE TABLE results(id,taskId,version,runId,state,outcome,completionResultId);
 CREATE INDEX results_run ON results(runId);
 CREATE TABLE deliveries(rootTaskId,version,state,outcome,resultId,revokedAt);
 CREATE TABLE worker_interactions(runId,state,runEpoch,contractVersion);
 ALTER TABLE tasks ADD matterId;
 ALTER TABLE tasks ADD waitingEnteredAt;
 ALTER TABLE tasks ADD reviewEnteredAt;
 ALTER TABLE tasks ADD settledAt;
 ALTER TABLE worker_interactions ADD createdAt;
 ALTER TABLE tasks ADD historyState TEXT NOT NULL DEFAULT 'visible';
 ALTER TABLE runs ADD stopRequestedAt;
 ALTER TABLE runs ADD errorCode;
 ALTER TABLE task_versions ADD acceptanceJson;
 ALTER TABLE deliveries ADD id;
 ALTER TABLE deliveries ADD historyMessageId;
 ALTER TABLE worker_interactions ADD id;
 ALTER TABLE worker_interactions ADD kind;
 ALTER TABLE worker_interactions ADD threadId;
 ALTER TABLE worker_interactions ADD turnId;
 ALTER TABLE runs ADD threadId;
 ALTER TABLE runs ADD turnId;
 INSERT INTO tasks(id,rootTaskId,parentTaskId,executorKind,executorAgentId,coordinatorAgentId,headVersion,revision,state,outcome,controlState,currentRunId) VALUES('root','root',NULL,'worker','worker-a','main',2,4,'working',NULL,'normal','new');
 INSERT INTO task_versions(taskId,version,goal,sourceRequestId) VALUES('root',1,'旧目标','request'),('root',2,'真实目标','request');
 INSERT INTO runs(id,taskId,status,phase,contractVersion,epoch,summary,sourceRequestId,stateRevision,activeMs,replacesRunId,createdAt,startedAt,endedAt) VALUES('old','root','failed','ended',1,0,'旧失败','request',1,22,NULL,1,1,2),('new','root','running','parked',2,1,NULL,'request',3,10,'old',3,3,NULL);
 INSERT INTO results VALUES('old-result','root',1,'old','accepted','succeeded',NULL),('new-file','root',2,'new','accepted','succeeded','new-completion'),('new-completion','root',2,'new','offered','partial',NULL);
 INSERT INTO deliveries(rootTaskId,version,state,outcome,resultId,revokedAt) VALUES('root',1,'recorded','succeeded','old-result',NULL);
 INSERT INTO worker_interactions(runId,state,runEpoch,contractVersion) VALUES('old','pending_user',0,1),('new','pending_user',0,2),('new','pending_main',1,2); UPDATE runs SET threadId='thread',turnId='turn'; UPDATE worker_interactions SET threadId='thread',turnId='turn';`);
 return db;
}
test('projection is SELECT-only under query_only, scopes current versions and loads history only on detail',()=>{
 const db=database();db.exec('PRAGMA query_only=ON');
 const before=db.prepare('SELECT total_changes() AS n').get();
 const result=readTaskOverview(db);assert.equal(result.tasks.length,1);
 const row=result.tasks[0]!;assert.equal(row.goal,'真实目标');assert.equal(row.run?.id,'new');assert.equal(row.result?.id,'new-completion');assert.equal(row.pendingUser,0);assert.equal(row.pendingMain,1);assert.equal(row.delivery,null);
 assert.equal('runs' in row,false);assert.equal('payloadJson' in row,false);
 const detail=readTaskDetail(db,'root');assert.deepEqual(detail.runs.map(r=>r.id),['new','old']);
 assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(),before);
 assert.throws(()=>readTaskDetail(db,'absent'),/task_not_found/);db.close();
});
test('native main roots without a separate Run still use accepted versioned results and recorded delivery',()=>{
 const main=task({executorKind:'main',currentRunId:null,run:null,state:'settled',outcome:'succeeded',result:{id:'main-result',state:'accepted',outcome:'succeeded'},delivery:{state:'recorded',outcome:'succeeded',resultId:'main-result'}});
 assert.equal(classifyTask(main).key,'complete');
 const coordinating={...main,state:'waiting',outcome:null,result:null,delivery:null};
 const child=task({id:'child',parentTaskId:'root',result:{id:'candidate',state:'offered',outcome:'partial'}});
 assert.deepEqual(filterRoots([coordinating,child],'review','').map(t=>t.id),['root']);
});

test('SQL projection includes native main null-Run results and does not promote stale terminal interactions',()=>{
 const db=database();
 db.exec("INSERT INTO tasks(id,rootTaskId,parentTaskId,executorKind,executorAgentId,coordinatorAgentId,headVersion,revision,state,outcome,controlState,currentRunId) VALUES('main','main',NULL,'main','main','main',1,1,'settled','succeeded','normal',NULL); INSERT INTO task_versions(taskId,version,goal,sourceRequestId) VALUES('main',1,'主根事项','main-request'); INSERT INTO results VALUES('main-result','main',1,NULL,'accepted','succeeded',NULL); INSERT INTO deliveries(rootTaskId,version,state,outcome,resultId,revokedAt) VALUES('main',1,'recorded','succeeded','main-result',NULL); UPDATE runs SET status='failed',phase='ended' WHERE id='new'; PRAGMA query_only=ON;");
 const rows=readTaskOverview(db).tasks,main=rows.find(t=>t.id==='main')!;
 assert.equal(main.sourceRequestId,'main-request');assert.equal(main.run,null);assert.equal(main.result?.id,'main-result');assert.equal(classifyTask(main).key,'complete');
 assert.equal(rows.find(t=>t.id==='root')!.pendingMain,0);db.close();
});

test('ordering projection carries persistent facts and current request MAX without writes',()=>{
 const db=database();try{
  db.exec("UPDATE tasks SET waitingEnteredAt=10,reviewEnteredAt=20,settledAt=30; UPDATE runs SET createdAt=40,startedAt=50,endedAt=60 WHERE id='new'; UPDATE worker_interactions SET createdAt=70; INSERT INTO worker_interactions(runId,state,runEpoch,contractVersion,threadId,turnId,createdAt) VALUES('new','pending_main',1,2,'thread','turn',90),('new','pending_user',1,2,'thread','turn',80),('new','pending_user',0,2,'thread','turn',9999),('old','pending_user',0,1,'thread','turn',9999),('new','pending_user',1,2,'stale','turn',9999)");
  db.exec('PRAGMA query_only=ON');const changes=db.prepare('SELECT total_changes() n').get();
  const row=readTaskOverview(db).tasks[0]!;
  assert.deepEqual([row.creationOrder,row.waitingEnteredAt,row.reviewEnteredAt,row.settledAt],[1,10,20,30]);
  assert.deepEqual([row.run?.createdAt,row.run?.startedAt,row.run?.endedAt],[40,50,60]);
  assert.deepEqual([row.pendingUserCreatedAt,row.pendingMainCreatedAt],[80,90]);
  assert.deepEqual(db.prepare('SELECT total_changes() n').get(),changes);
 }finally{db.close();}
});
