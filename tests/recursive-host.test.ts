// Synthetic peers exercise the actual Homer pump, durable state and sink; no real-model claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import {homerWebBridge} from '../src/web-homer.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw Error('synthetic_wait_timeout');await new Promise(r=>setTimeout(r,5));}};
for(const failed of [false,true])test('HMR-RECURSIVE host: actual single pump, same-thread followup, explicit adoption and '+(failed?'partial':'complete')+' formal publication',async()=>{
  const f=syntheticHost(failed);try{await f.app.start();await f.app.message('synthetic:tree','synthetic-root-source');await until(()=>f.events.some(m=>m.type==='delivery')).catch(()=>{throw Error(JSON.stringify({runs:f.app.store.runs().map(r=>({status:r.status,error:r.errorCode,phase:f.app.tasks.run(r.id).phase})),events:f.app.store.db.prepare('SELECT type,code FROM events').all(),turns:f.engines.map(e=>e.turns)}));});await f.app.idle();
    assert.equal(f.engines.length,5);assert.deepEqual(f.engines.filter(e=>e.worker).map(e=>e.turns),[1,1,1,1]);const aEngines=f.engines.filter(e=>e.worker);assert.equal(aEngines[0]!.threadId,aEngines[3]!.threadId);assert.equal(f.events.filter(m=>m.type==='delivery').length,1);assert.equal(f.events.some(m=>m.text.includes('INTERNAL_TEXT_MUST_NOT_LEAK')),false);
    const task=f.app.tasks.tasks()[0]!;assert.equal(f.app.tasks.tasks().length,1);assert.equal(task.outcome,failed?'partial':'succeeded');assert.equal(f.app.tasks.deliveries()[0]!.state,'recorded');
    const runs=f.app.tasks.runs(task.id),a=runs.find(run=>run.prompt==='A followup')!;assert.ok(f.app.tasks.publishedArtifact(a.id));assert.equal(runs.length,4);assert.equal(new Set(runs.map(run=>run.workerId)).size,3);
    assert.deepEqual((await homerWebBridge(f.app).state()).work.filter(w=>w.hasArtifact).map(w=>w.id),[a.id]);
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
