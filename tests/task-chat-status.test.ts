import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTask,type OverviewTask,type OverviewWorker} from '../src/task-overview.js';
import {statusTree,statusCounts,matterStatus,rankedStatusMatters,progressMatches} from '../src/task-status.js';

const worker=(id:string,change:Partial<OverviewWorker>={}):OverviewWorker=>({id,taskId:'task',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id,taskId:'task',workerId:id,status:'running',phase:'executing',version:1,epoch:1,threadId:'thread-'+id,turnId:'turn-'+id,sourceRequestId:'source',createdAt:100,startedAt:200,endedAt:null},...change});
const task=(change:Partial<OverviewTask>={}):OverviewTask=>({id:'task',title:'核查预览',goal:'查清预览空白原因',notes:'先核对请求与构建产物',headVersion:1,revision:1,state:'open',outcome:null,controlState:'normal',historyState:'visible',sourceRequestId:'source',creationOrder:1,workers:[],results:[],deliveries:[],...change});

test('one matter owns two concurrent sessions and remains open when either session ends',()=>{
 const a=worker('a'),b=worker('b'),t=task({workers:[a,b]});
 assert.equal(statusTree([t]).length,1);
 assert.equal(statusTree([t])[0]!.workers.length,2);
 assert.deepEqual(statusCounts([t]),{working:1,queued:0,done:0,needsUser:0});
 a.run={...a.run,status:'interrupted',phase:'ended',endedAt:300};
 assert.equal(matterStatus(statusTree([t])[0]!).state,'working');
 b.run={...b.run,status:'succeeded',phase:'ended',endedAt:400};
 assert.notEqual(classifyTask(t).key,'complete');
 assert.equal(matterStatus(statusTree([t])[0]!).state,'waiting');
 assert.deepEqual(statusCounts([t]),{working:0,queued:0,done:1,needsUser:0});
});

test('plain text settlement uses the Main decision with no formal result or delivery',()=>{
 for(const outcome of ['succeeded','partial','failed','cancelled']){
  const t=task({state:'settled',outcome});
  assert.equal(classifyTask(t).key,outcome==='succeeded'?'complete':'other');
  assert.equal(matterStatus(statusTree([t])[0]!).state,outcome==='failed'?'failed':outcome==='cancelled'?'cancelled':'done');
 }
});

test('a resumed session counts once and progress follows its adopted version and exact Run',()=>{
 const a=worker('a');a.run={...a.run,id:'followup',version:1,turnId:'followup-turn'};
 const t=task({headVersion:2,workers:[a]});
 assert.equal(statusCounts([t]).working,1);
 const progress={taskId:'task',version:1,runId:'followup',epoch:1,threadId:'thread-a',turnId:'followup-turn',revision:1,observedAtMs:10};
 assert.equal(progressMatches(a,progress),true);
 for(const change of [{taskId:'other'},{version:2},{runId:'a'},{epoch:2},{threadId:'other'},{turnId:'turn-a'}])assert.equal(progressMatches(a,{...progress,...change}),false);
});

test('user requests from each live session outrank ordinary progress and deduplicate by interaction',()=>{
 const waiting=worker('waiting',{pendingUser:2,pendingUsers:[{id:'question',after:4,kind:'question'},{id:'approval',after:5,kind:'authorization'}],pendingUserCreatedAt:300});
 const attention=task({workers:[waiting,worker('peer')]}),running=task({id:'running',creationOrder:3,workers:[worker('other',{taskId:'running',run:{...worker('other').run,taskId:'running'}})]});
 assert.equal(rankedStatusMatters(statusTree([running,attention]))[0]!.matter.task.id,'task');
 assert.equal(statusCounts([attention,attention]).needsUser,2);
 waiting.run={...waiting.run,phase:'ended',status:'succeeded'};
 assert.equal(statusCounts([attention]).needsUser,0);
});

test('unknown session does not hide an independently confirmed running peer',()=>{
 const t=task({workers:[worker('unknown',{run:{...worker('unknown').run,phase:'uncertain'}}),worker('live')]});
 assert.equal(matterStatus(statusTree([t])[0]!).state,'working');
 assert.equal(statusCounts([t]).working,1);
});
