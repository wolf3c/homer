import test from 'node:test';
import assert from 'node:assert/strict';
import type {OverviewTask,OverviewWorker} from '../src/task-overview.js';
import {workerStatus,taskCardPresentation,statusCountSnapshot,statusTree,matterSortKey,rankedStatusMatters,statusVisibleLimit,linearPlanIndex} from '../src/task-status.js';
const worker=(id:string,status='running',phase='executing'):OverviewWorker=>({id,taskId:'task',run:{id,taskId:'task',workerId:id,version:1,epoch:1,status,phase,sourceRequestId:null,createdAt:100,startedAt:200,endedAt:phase==='ended'?300:null},pendingUser:0,pendingMain:0,pendingUsers:[]});
const task=(change:Partial<OverviewTask>={}):OverviewTask=>({id:'task',title:'Matter',goal:'Goal',notes:'',headVersion:1,revision:1,state:'open',outcome:null,controlState:'normal',historyState:'visible',sourceRequestId:null,creationOrder:1,createdAt:10,workers:[],...change});

test('Worker success failure interruption and queue are execution facts only',()=>{
 for(const [status,phase,state,label] of [['succeeded','ended','done','已回复'],['failed','ended','failed','执行失败'],['cancelled','ended','cancelled','本轮已停止'],['interrupted','ended','waiting','执行已中断'],['queued','ready','waiting','等待调度']] as const){
  const w=worker('w',status,phase),t=task({workers:[w]});assert.deepEqual(workerStatus(w),{state,label});assert.equal(taskCardPresentation(t).state,'waiting');
 }
});

test('explicit Main outcomes render without separate delivery states',()=>{
 for(const outcome of ['succeeded','partial','failed','cancelled']){
  const t=task({state:'settled',outcome});
  assert.equal(taskCardPresentation(t).state,outcome==='failed'?'failed':outcome==='cancelled'?'cancelled':'done');
 }
 assert.equal(taskCardPresentation(task({controlState:'stopping'})).label,'停止待确认');
 assert.equal(taskCardPresentation(task({state:'paused'})).label,'已暂停');
});

test('valid user questions and authorizations alone draw user attention',()=>{
 const w=worker('w');w.pendingUser=2;w.pendingUsers=[{id:'question',after:0,kind:'question'},{id:'authorization',after:1,kind:'authorization'}];
 assert.equal(taskCardPresentation(task({workers:[w]})).label,'需你审批');assert.equal(taskCardPresentation(task({workers:[w]})).attention,'user');
 w.run.phase='uncertain';assert.equal(taskCardPresentation(task({workers:[w]})).attention,'none');
 w.pendingUser=0;w.pendingMain=1;w.run.phase='executing';assert.equal(taskCardPresentation(task({workers:[w]}),w).attention,'none');
});

test('tree deduplicates real matters and rejects unrelated or malformed session ownership',()=>{
 const a=worker('a'),b=worker('b'),wrong=worker('wrong');wrong.taskId='elsewhere';
 const t=task({workers:[a,b,a,wrong]});assert.equal(statusTree([t,t]).length,1);assert.equal(statusTree([t])[0]!.workers.length,2);
 assert.equal(statusTree([task({historyState:'archived'})]).length,0);
});

test('one root contributes once while session and interaction units remain distinct',()=>{
 const a=worker('a'),b=worker('b');a.pendingUser=2;a.pendingUsers=[{id:'q',after:0},{id:'q2',after:1}];b.pendingUser=1;b.pendingUsers=[{id:'q',after:0}];
 const t=task({workers:[a,b]});assert.deepEqual(statusCountSnapshot([t,t]).counts,{working:1,queued:0,done:0,needsUser:2});
 a.pendingUser=3;assert.equal(statusCountSnapshot([t]).counts.needsUser,3,'unlocated requests retain their count');
 b.run.phase='ended';b.run.status='succeeded';assert.equal(statusCountSnapshot([t]).counts.done,1);assert.equal(statusCountSnapshot([t]).matches.done.has('task'),true);
});

test('queued work and successful old rounds do not inflate current active sessions',()=>{
 const t=task({workers:[worker('a'),worker('b','queued','ready'),worker('c','succeeded','ended')]});
 assert.deepEqual(statusCountSnapshot([t]).counts,{working:1,queued:1,done:1,needsUser:0});
 t.state='paused';assert.equal(statusCountSnapshot([t]).counts.working,0);assert.equal(statusCountSnapshot([t]).counts.queued,0);
});

test('unknown current work with no active proof suppresses an exact quantity',()=>{
 assert.equal(statusCountSnapshot([task({workers:[worker('a','running','uncertain')]})]).workingKnown,false);
 assert.equal(statusCountSnapshot([task({workers:[worker('a','running','uncertain'),worker('b')]})]).workingKnown,true);
});

test('each sorting category uses its own event fact and stable tie ordering',()=>{
 const question=worker('q');question.pendingUser=1;question.pendingUsers=[{id:'q',after:0}];question.pendingUserCreatedAt=500;
 const main=worker('m','succeeded','ended');main.pendingMain=1;main.pendingMainCreatedAt=600;
 const cases=[task({id:'ended',state:'settled',outcome:'succeeded',settledAt:900}),task({id:'waiting'}),task({id:'main',workers:[{...main,taskId:'main',run:{...main.run,taskId:'main'}}]}),task({id:'running',workers:[{...worker('a'),taskId:'running',run:{...worker('a').run,taskId:'running'}}]}),task({workers:[question]})];
 assert.deepEqual(rankedStatusMatters(statusTree(cases)).map(r=>r.key.id),['task','running','main','waiting','ended']);
 assert.equal(matterSortKey(statusTree([cases[4]!])[0]!).enteredAtMs,500);
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

test('filters and visible prefix use the whole snapshot and retain a reader anchor',()=>{
 const tasks=Array.from({length:30},(_,i)=>task({id:String(i),state:'settled',outcome:'succeeded',settledAt:100-i}));
 const ranked=rankedStatusMatters(statusTree(tasks));assert.equal(statusVisibleLimit(ranked,20,['25']),26);
 const open=task({id:'open'});const all=rankedStatusMatters(statusTree([...tasks,open]));assert.equal(all[0]!.key.id,'open');assert.equal(statusVisibleLimit(all,20),20);
});

test('linear plan conversion preserves parallel and ambiguous plan semantics',()=>{
 assert.equal(linearPlanIndex([{step:'done',status:'completed'},{step:'active',status:'inProgress'},{step:'next',status:'pending'}]),1);
 assert.equal(linearPlanIndex([{step:'a',status:'inProgress'},{step:'b',status:'inProgress'}]),null);
 assert.equal(linearPlanIndex([]),null);assert.equal(linearPlanIndex([{step:'a',status:'completed'}]),1);
});
