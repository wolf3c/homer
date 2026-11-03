import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as status from '../src/task-status.js';
import {readTaskOverview,type OverviewTask} from '../src/task-overview.js';
import {fixture,delegate,running,main,contract} from './recursive-fixture.js';
const task=(extra:Partial<OverviewTask>={}):OverviewTask=>({id:'t',rootTaskId:'t',parentTaskId:null,goal:null,executorKind:'worker',executorAgentId:'worker',coordinatorAgentId:'main',sourceRequestId:null,headVersion:1,revision:1,state:'working',outcome:null,controlState:'normal',currentRunId:'r',run:{id:'r',status:'running',phase:'executing',contractVersion:1,epoch:1,summary:null,sourceRequestId:null},result:null,delivery:null,pendingUser:0,pendingMain:0,...extra});
test('presentation separates review/partial/coordination/user/stop/unknown and proven recovery',()=>{
 assert.equal(typeof status.taskCardPresentation,'function');
 const p=status.taskCardPresentation,t=task(),ended={...t.run!,phase:'ended',status:'awaiting_review'};
 assert.deepEqual([p(t).icon,p(t).owner,p(t).attention],['Activity','worker','none']);
 assert.equal(p(task({pendingMain:1})).icon,'MessagesSquare');
 assert.equal(p(task({pendingUser:1,pendingUsers:[{id:'q',after:0,kind:'question'}]})).icon,'MessageCircleQuestion');
 assert.equal(p(task({pendingUser:1,pendingUsers:[{id:'q',after:0,kind:'authorization'}]})).attention,'user');
 assert.equal(p(task({pendingUser:1,controlState:'stopping'})).attention,'none');
 const offered=task({run:ended,result:{id:'x',state:'offered',outcome:'succeeded'}});
 assert.equal(p(offered).state,'waiting');assert.equal(p(offered).icon,'Inbox');
 assert.equal(p({...offered,result:{id:'x',state:'accepted',outcome:'partial'}}).icon,'CircleDashed');
 assert.equal(p(task({run:{...ended,status:'cancelled',stopRequestedAt:1},state:'settled',outcome:'cancelled'})).label,'已停止');
 assert.equal(p(task({run:{...ended,status:'interrupted'}})).owner,'main');assert.equal(p(task({run:{...ended,status:'failed',turnId:null}})).label,'执行失败');
 assert.equal(p(task({currentRunId:'other'})).owner,'unknown');
 assert.equal(p(task({previousRun:{id:'old',status:'failed',errorCode:'engine_error'},run:{...t.run!,replacesRunId:'old'}})).icon,'RefreshCw');
 assert.equal(p(task({previousRun:{id:'old',status:'interrupted',errorCode:'revision_requested'},run:{...t.run!,replacesRunId:'old'}})).icon,'Activity');
 const full=task({run:{...ended,status:'succeeded'},state:'settled',outcome:'succeeded',result:{id:'x',state:'accepted',outcome:'succeeded'},delivery:{state:'recorded',outcome:'succeeded',resultId:'x'}});
 assert.equal(p(full).state,'done');for(const state of ['prepared','uncertain','revoked'])assert.notEqual(p({...full,delivery:{...full.delivery!,state}}).state,'done');
});
test('real steer receipts project accepted then received then adopted without pretending execution',()=>{
 const f=fixture();try{const d=delegate(f),actor=running(f,d.taskId),t=f.tasks.task(d.taskId);
 const args={operationId:'steer',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,mode:'steer' as const,contract:contract(),children:[],queuedDisposition:[]};
 const receipt=f.tasks.update(main,args),fact=f.tasks.captureActivity(main,'task_update',args,receipt);
 assert.equal(fact?.outcome,'update_accepted');assert.equal(fact?.target?.operationKey,receipt.operationKey);
 const read=()=>readTaskOverview(f.store.db).tasks.find(t=>t.id===d.taskId)!;
 assert.equal(read().updates?.[0]?.stage,'accepted');
 f.tasks.markSteer(receipt.operationKey,'received');assert.equal(read().updates?.[0]?.stage,'received');assert.notEqual(status.taskCardPresentation(read()).state,'working');
 f.tasks.inspect(actor,{taskId:t.id});f.tasks.adopt(actor,{operationId:'adopt',taskId:t.id,version:receipt.version,expectedTaskRevision:f.tasks.task(t.id).revision,contractHash:receipt.contractHash});assert.equal(read().updates?.[0]?.stage,'adopted');
 assert.equal(status.taskCardPresentation(read()).state,'working');
 }finally{f.close();}
});
test('queue and stop facts never claim execution or overwrite terminal facts',()=>{
 const f=fixture();try{const d=delegate(f),t=f.tasks.task(d.taskId);
 const args={operationId:'queue',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,mode:'queue' as const,contract:contract(),children:[],queuedDisposition:[]};
 const receipt=f.tasks.update(main,args);assert.equal(f.tasks.captureActivity(main,'task_update',args,receipt)?.outcome,'update_queued');
 assert.equal(readTaskOverview(f.store.db).tasks.find(x=>x.id===t.id)?.updates?.[0]?.stage,'queued');
 const stopArgs={operationId:'stop',taskId:t.id,version:1,expectedTaskRevision:f.tasks.task(t.id).revision,scope:'self' as const,reason:'requested'};
 const requested=f.tasks.stop(main,stopArgs);assert.equal(f.tasks.captureActivity(main,'task_stop',stopArgs,requested)?.outcome,'stop_requested');
 const confirmed=f.tasks.confirmStop(requested.operationKey,true);assert.equal(f.tasks.captureActivity(main,'task_stop',stopArgs,{...confirmed,operationKey:requested.operationKey})?.outcome,'stop_confirmed');
 const noopArgs={...stopArgs,operationId:'noop',expectedTaskRevision:f.tasks.task(t.id).revision};const noop=f.tasks.stop(main,noopArgs);assert.equal(f.tasks.captureActivity(main,'task_stop',noopArgs,noop)?.outcome,'stop_noop');
 assert.equal(f.tasks.captureActivity(main,'task_stop',stopArgs,{...requested,operationKey:'bad'}),undefined);
 }finally{f.close();}
});
