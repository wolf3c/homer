// Synthetic peers exercise the actual Homer pump, durable state and sink; no real-model claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import {homerWebBridge} from '../src/web-homer.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw Error('synthetic_wait_timeout');await new Promise(r=>setTimeout(r,5));}};
for(const failed of [false,true])test('HMR-RECURSIVE host: same-thread followup and '+(failed?'partial':'complete')+' message attachment',async()=>{
  const f=syntheticHost(failed);
  try{
    await f.app.start();
    await f.app.message('synthetic:tree','synthetic-root-source');
    await f.app.idle();
    const workers=f.engines.filter(engine=>engine.worker);
    assert.deepEqual(workers.map(engine=>engine.turns),[1,1,1,1]);
    assert.equal(workers[0]!.threadId,workers[3]!.threadId);
    const [task]=f.app.tasks.tasks();
    assert.equal(f.app.tasks.tasks().length,1);
    assert.equal(task!.outcome,failed?'partial':'succeeded');
    const state=await homerWebBridge(f.app).state();
    assert.equal(state.artifacts?.length,1);
    const [file]=state.artifacts!;
    const message=f.app.history.message(file!.messageId)!;
    assert.equal(message.requestId,null);
    assert.equal(message.taskId,task!.id);
    assert.match(message.text,failed?/partially completed/:/Synthetic completed/);
    assert.equal(Buffer.from(f.app.readAttachment(file!).data,'base64').toString(),'# Synthetic report\nDate unknown.\n');
    assert.equal(f.events.some(message=>message.text.includes('INTERNAL_TEXT_MUST_NOT_LEAK')),false);
    const runs=f.app.tasks.runs(task!.id);
    assert.equal(runs.length,4);
    assert.equal(new Set(runs.map(run=>run.workerId)).size,3);
  }finally{await f.close();}
});
test('HMR-QUEUE host: three durable inputs FIFO; edit/cancel CAS; exact-generation interrupt preserves earlier queue and Worker',async()=>{
  const f=syntheticHost();try{await f.app.start();await f.app.message('synthetic:source','source');const assistant=f.app.conversationState().messages.find(m=>m.role==='assistant'&&m.text.includes('Synthetic reply'))!;
    f.app.submitMessage({requestId:'stream',text:'synthetic:stream'});await until(()=>!!f.app.conversationState().generation);
    const quote={messageId:assistant.id,text:'Synthetic reply',annotation:'Synthetic annotation'};
    for(const id of ['one','two','three'])f.app.submitMessage({requestId:id,text:id,quotes:[quote]});
    const queued=f.app.inputs.list().filter(i=>i.state==='queued');assert.equal(queued.length,3);
    f.app.editQueued({requestId:'one',operationId:'edit-one',expectedRevision:queued[0]!.revision,input:{...queued[0]!.input,text:'one-edited'}});
    f.app.cancelQueued({requestId:'two',operationId:'cancel-two',expectedRevision:queued[1]!.revision});
    const g=f.app.conversationState().generation!;f.app.submitMessage({requestId:'urgent',text:'urgent'},undefined,{messageId:g.messageId,generationId:g.generationId});
    await until(()=>f.app.inputs.list().find(i=>i.input.requestId==='three')?.state==='completed');
    await f.app.idle();
    assert.deepEqual(f.seen.slice(0,2),['synthetic:source','synthetic:stream']);
    const rest=f.seen.slice(2);assert.ok(rest[0]!.endsWith('one-edited'));assert.ok(rest[1]!.endsWith('three'));assert.equal(rest[2],'urgent');assert.equal(rest.length,3);
    assert.equal(f.app.inputs.list().find(i=>i.input.requestId==='two')!.state,'cancelled');assert.equal(f.app.inputs.list().find(i=>i.input.requestId==='urgent')!.interruptState,'confirmed');
    assert.throws(()=>f.app.editQueued({requestId:'three',operationId:'late-edit',expectedRevision:0,input:{requestId:'three',text:'too late'}}),/queue_input_processing/);
    assert.equal(f.app.submitMessage({requestId:'one',text:'one',quotes:[quote]}).fresh,false);assert.equal(f.app.inputs.list().find(i=>i.input.requestId==='one')!.input.text,'one-edited');
  }finally{await f.close();}
});
