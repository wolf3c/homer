import test from 'node:test';
import assert from 'node:assert/strict';
import type {OverviewTask,OverviewWorker} from '../src/task-overview.js';
import {workerStatus,taskCardPresentation,statusTree,matterSortKey,rankedStatusMatters,linearPlanIndex} from '../src/task-status.js';
const worker=(id:string,status='running',phase='executing'):OverviewWorker=>({id,taskId:'task',run:{id,taskId:'task',workerId:id,version:1,epoch:1,status,phase,sourceRequestId:null,createdAt:100,startedAt:200,endedAt:phase==='ended'?300:null},pendingUser:0,pendingMain:0,pendingUsers:[]});
const task=(change:Partial<OverviewTask>={}):OverviewTask=>({id:'task',title:'Matter',goal:'Goal',notes:'',headVersion:1,revision:1,state:'open',historyState:'visible',sourceRequestId:null,creationOrder:1,createdAt:10,workers:[],...change});

test('Worker success failure interruption and queue are execution facts only',()=>{
 for(const [status,phase,state,label] of [['succeeded','ended','done','已回复'],['failed','ended','failed','执行失败'],['cancelled','ended','cancelled','本轮已停止'],['interrupted','ended','waiting','执行已中断'],['queued','ready','waiting','等待调度']] as const){
  const w=worker('w',status,phase),t=task({workers:[w]});assert.deepEqual(workerStatus(w),{state,label});assert.equal(taskCardPresentation(t).state,'waiting');
 }
});

test('valid user questions and authorizations alone draw user attention',()=>{
 const w=worker('w');w.pendingUser=2;w.pendingUsers=[{id:'question',after:0,kind:'question'},{id:'authorization',after:1,kind:'authorization'}];
 assert.equal(taskCardPresentation(task({workers:[w]})).label,'需你审批 · 需你答复');assert.equal(taskCardPresentation(task({workers:[w]})).attention,'user');
 w.run.phase='uncertain';assert.equal(taskCardPresentation(task({workers:[w]})).attention,'none');
 w.pendingUser=0;w.pendingMain=1;w.run.phase='executing';assert.equal(taskCardPresentation(task({workers:[w]}),w).attention,'none');
 assert.equal(workerStatus(w).label,'Homer处理中');
 w.run.phase='parked';assert.equal(taskCardPresentation(task({workers:[w]})).label,'');
});

test('tree deduplicates real matters and rejects unrelated or malformed session ownership',()=>{
 const a=worker('a'),b=worker('b'),wrong=worker('wrong');wrong.taskId='elsewhere';
 const t=task({workers:[a,b,a,wrong]});assert.equal(statusTree([t,t]).length,1);assert.equal(statusTree([t])[0]!.workers.length,2);
 assert.equal(statusTree([task({historyState:'archived'})]).length,0);
});

test('same Run uses its recorded start and ignores task updates for ordering',()=>{
 const t=task({workers:[worker('a')]});const before=matterSortKey(statusTree([t])[0]!);
 t.notes='New note';t.revision++;assert.deepEqual(matterSortKey(statusTree([t])[0]!),before);
});

test('invalid event times have deterministic fallback and ties use creation order then ID',()=>{
 const a=task({id:'a',createdAt:NaN,creationOrder:1}),b=task({id:'b',createdAt:NaN,creationOrder:2}),c=task({id:'c',createdAt:NaN,creationOrder:2});
 assert.deepEqual(rankedStatusMatters(statusTree([a,c,b])).map(r=>r.key.id),['b','c','a']);
 assert.equal(matterSortKey(statusTree([a])[0]!).enteredAtMs,-Infinity);
});

test('linear plan conversion preserves parallel and ambiguous plan semantics',()=>{
 assert.equal(linearPlanIndex([{step:'done',status:'completed'},{step:'active',status:'inProgress'},{step:'next',status:'pending'}]),1);
 assert.equal(linearPlanIndex([{step:'a',status:'inProgress'},{step:'b',status:'inProgress'}]),null);
 assert.equal(linearPlanIndex([]),null);assert.equal(linearPlanIndex([{step:'a',status:'completed'}]),1);
});

test('the archive entry alone lists archived matters and pausing is an execution gate',()=>{
 const archived=task({historyState:'archived'});assert.deepEqual(statusTree([archived]),[]);
 assert.equal(statusTree([archived],'archived')[0]?.task.id,archived.id);
 assert.equal(taskCardPresentation(task({state:'paused'})).label,'');
});
