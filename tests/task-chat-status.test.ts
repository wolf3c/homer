import test from 'node:test';
import assert from 'node:assert/strict';
import type {OverviewWorker} from '../src/task-overview.js';
import {progressMatches} from '../src/task-status.js';

test('progress follows the adopted version and exact Run',()=>{
 const worker:OverviewWorker={id:'a',taskId:'task',pendingMain:0,run:{id:'followup',taskId:'task',workerId:'a',status:'running',phase:'executing',version:1,epoch:1,threadId:'thread-a',turnId:'followup-turn',sourceRequestId:'source'}};
 const progress={taskId:'task',version:1,runId:'followup',epoch:1,threadId:'thread-a',turnId:'followup-turn',revision:1,observedAtMs:10};
 assert.equal(progressMatches(worker,progress),true);
 for(const change of [{taskId:'other'},{version:2},{runId:'a'},{epoch:2},{threadId:'other'},{turnId:'turn-a'}])assert.equal(progressMatches(worker,{...progress,...change}),false);
});
