import {test} from 'node:test';import assert from 'node:assert/strict';
import {queueBrowserFixture,queueUntil} from './fixtures/message-queue-browser-server.js';

for(const action of ['cancel','move'] as const)test(`queue scheduler: ${action} wakes the next valid input after a preparing head`,async()=>{
 const f=await queueBrowserFixture('.codex/scratch/message-queue-implementation/web');
 try{
  f.app.inputs.preparation=input=>input.requestId==='B'?'preparing':'ready';
  f.release();await queueUntil(()=>f.app.inputs.byRequestIds(['A'])[0]!.state==='completed');await f.app.idle();
  assert.equal(f.turns.length,1);assert.equal(f.app.inputs.runnableHead(),undefined);
  if(action==='cancel')f.app.cancelQueued({requestId:'B',operationId:'cancel-preparing',expectedRevision:0});
  else{
   const input={threadId:f.app.store.meta('mainThread')!,readEpoch:f.app.webReadEpoch,requestId:'C',operationId:'move-preparing',expectedRevision:0,expectedOrderVersion:f.app.inputs.dispatchSummary().orderVersion,beforeRequestId:'B'};
   assert.throws(()=>f.app.moveQueued({...input,readEpoch:'stale'}),/history_epoch_changed/);f.app.moveQueued(input);
  }
  await queueUntil(()=>f.app.inputs.byRequestIds(['C'])[0]!.state==='processing');assert.equal(f.turns.length,2);assert.match(f.turns[1]!,/补充验收/);
 }finally{await f.close();}
});
