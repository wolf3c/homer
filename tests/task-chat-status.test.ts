import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTask,type OverviewTask,type OverviewWorker} from '../src/task-overview.js';
import {statusTree,matterStatus,rankedStatusMatters,progressMatches} from '../src/task-status.js';

const worker=(id:string,change:Partial<OverviewWorker>={}):OverviewWorker=>({id,taskId:'task',pendingMain:0,run:{id,taskId:'task',workerId:id,status:'running',phase:'executing',version:1,epoch:1,threadId:'thread-'+id,turnId:'turn-'+id,sourceRequestId:'source',createdAt:100,startedAt:200,endedAt:null},...change});
const task=(change:Partial<OverviewTask>={}):OverviewTask=>({id:'task',title:'核查预览',goal:'查清预览空白原因',notes:'先核对请求与构建产物',headVersion:1,revision:1,state:'open',historyState:'visible',sourceRequestId:'source',creationOrder:1,workers:[],...change});

test('one matter owns two concurrent sessions and remains open when either session ends',()=>{
 const a=worker('a'),b=worker('b'),t=task({workers:[a,b]});
 assert.equal(statusTree([t]).length,1);
 assert.equal(statusTree([t])[0]!.workers.length,2);
 a.run={...a.run,status:'interrupted',phase:'ended',endedAt:300};
 assert.equal(matterStatus(statusTree([t])[0]!).label,'');
 b.run={...b.run,status:'succeeded',phase:'ended',endedAt:400};
 assert.notEqual(classifyTask(t).key,'complete');
 assert.equal(matterStatus(statusTree([t])[0]!).state,'waiting');
});

test('a resumed session counts once and progress follows its adopted version and exact Run',()=>{
 const a=worker('a');a.run={...a.run,id:'followup',version:1,turnId:'followup-turn'};
 const t=task({headVersion:2,workers:[a]});assert.equal(statusTree([t])[0]?.workers.length,1);
 const progress={taskId:'task',version:1,runId:'followup',epoch:1,threadId:'thread-a',turnId:'followup-turn',revision:1,observedAtMs:10};
 assert.equal(progressMatches(a,progress),true);
 for(const change of [{taskId:'other'},{version:2},{runId:'a'},{epoch:2},{threadId:'other'},{turnId:'turn-a'}])assert.equal(progressMatches(a,{...progress,...change}),false);
});

test('ordinary matters keep creation order regardless of how many workers they have',()=>{
 const older=task({workers:[worker('one'),worker('two')]}),newer=task({id:'newer',creationOrder:3});
 assert.deepEqual(rankedStatusMatters(statusTree([older,newer])).map(row=>row.matter.task.id),['newer','task']);
});

test('uncertain session remains visible beside a running peer',()=>{
 const t=task({workers:[worker('unknown',{run:{...worker('unknown').run,phase:'uncertain'}}),worker('live')]});
 assert.equal(matterStatus(statusTree([t])[0]!).label,'执行状态待核实');
});
