// Requirements-derived synthetic fault tests. Real Homer/SQLite; no Codex/account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import type {MainInputLifecycle} from '../src/recursive-main-inputs.js';

type Host = ReturnType<typeof syntheticHost>;
const input = {requestId:'synthetic-transaction',text:'合成任务：整理报告。'};
const changed = {...input,text:'合成任务：按负责人整理报告。'};
function state(f:Host) {
  return Object.fromEntries(['meta','conversation_inputs','conversation_messages','operations','agent_messages','agent_receipts','requests'].map(table=>[table,f.app.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
const lifecycle=(f:Host)=>(f.app.inputs as unknown as {lifecycle:MainInputLifecycle}).lifecycle;

for(const fault of ['receipt','accepted','channel'] as const) test('HMR-QUEUE-TX: '+fault+' failure rolls back history, queue, source and channel receipt',async()=>{
  const f=syntheticHost();try {
    await f.app.start();const before=state(f);
    if(fault==='receipt')f.app.store.db.exec("CREATE TEMP TRIGGER synthetic_reject_receipt BEFORE INSERT ON agent_receipts BEGIN SELECT RAISE(ABORT,'synthetic_receipt_failure'); END");
    if(fault==='accepted'){
      const hooks=lifecycle(f),accepted=hooks.accepted!;
      hooks.accepted=(value,thread)=>{accepted(value,thread);throw Error('synthetic_accepted_failure');};
    }
    assert.throws(()=>f.app.inputs.accept(input,{source:'synthetic_channel',persist:()=>{
      f.app.store.setMeta('synthetic_channel_receipt','recorded');
      if(fault==='channel')throw Error('synthetic_channel_failure');
    }}),new RegExp('synthetic_'+fault+'_failure'));
    assert.deepEqual(state(f),before);
  }finally{await f.close();}
});

for(const kind of ['promise','thenable'] as const) test('HMR-QUEUE-TX: '+kind+' channel persist is rejected through the queue wrapper, including retries',async()=>{
  const f=syntheticHost();try{
    await f.app.start();let waited=false;
    const persist=()=>{
      f.app.store.setMeta('synthetic_channel_receipt','must_roll_back');
      return kind==='promise'?Promise.resolve():{then(){waited=true;}};
    };
    const before=state(f);
    assert.throws(()=>f.app.inputs.accept(input,{source:'synthetic_channel',persist}),/accept_hook_must_be_synchronous/);
    assert.deepEqual(state(f),before);assert.equal(waited,false);
    f.app.inputs.accept(input,{source:'synthetic_channel',persist:()=>{}});
    const accepted=state(f);
    assert.throws(()=>f.app.inputs.accept(input,{source:'synthetic_channel',persist}),/accept_hook_must_be_synchronous/);
    assert.deepEqual(state(f),accepted);assert.equal(waited,false);
  }finally{await f.close();}
});

test('HMR-QUEUE-TX: failed claim validation rolls back history, request and source; successful claim commits them together',async()=>{
  const f=syntheticHost();try{
    await f.app.start();f.app.inputs.accept(input);const before=state(f);
    const hooks=lifecycle(f),claim=hooks.claim;let requestWasProcessing=false;
    hooks.claim=(value,thread)=>{
      claim(value,thread);requestWasProcessing=f.app.store.request(value.requestId)?.state==='started';
      throw Error('synthetic_claim_failure');
    };
    assert.throws(()=>f.app.inputs.claim(),/synthetic_claim_failure/);assert.deepEqual(state(f),before);
    assert.equal(requestWasProcessing,true,'request must be inside the transaction before claim validation');
    hooks.claim=claim;
    const claimed=f.app.inputs.claim()!;assert.equal(claimed.state,'processing');
    assert.equal(f.app.store.request(input.requestId)?.state,'started');
    assert.equal(f.app.store.request(input.requestId)?.hash,createHash('sha256').update(input.text).digest('hex'));
    assert.deepEqual(f.app.history.list(f.app.store.meta('mainThread')!).map(m=>m.status),['processing','running']);
    assert.equal(f.app.inputs.claim(),undefined);
  }finally{await f.close();}
});

for(const action of ['edit','cancel'] as const) test('HMR-QUEUE-TX: '+action+' source failure rolls back body, CAS, receipt and operation; retry is exact once',async()=>{
  const f=syntheticHost();try{
    await f.app.start();f.app.inputs.accept(input);const before=state(f);
    const edit={requestId:input.requestId,operationId:'synthetic-edit',expectedRevision:0,input:changed};
    const cancel={requestId:input.requestId,operationId:'synthetic-cancel',expectedRevision:0};
    const hooks=lifecycle(f),edited=hooks.edited!,cancelled=hooks.cancelled!;
    hooks.edited=(value,thread)=>{edited(value,thread);throw Error('synthetic_source_failure');};
    hooks.cancelled=id=>{cancelled(id);throw Error('synthetic_source_failure');};
    assert.throws(()=>action==='edit'?f.app.inputs.edit(edit):f.app.inputs.cancel(cancel),/synthetic_source_failure/);
    assert.deepEqual(state(f),before);hooks.edited=edited;hooks.cancelled=cancelled;
    const receipt=action==='edit'?f.app.inputs.edit(edit):f.app.inputs.cancel(cancel),after=state(f);
    assert.deepEqual(action==='edit'?f.app.inputs.edit(edit):f.app.inputs.cancel(cancel),receipt);assert.deepEqual(state(f),after);
    f.app.inputs.accept(input);assert.deepEqual(state(f),after,'original retry cannot restore replaced or cancelled text');
    if(action==='edit')assert.equal(f.app.inputs.claim()!.input.text,changed.text);
    else assert.equal(f.app.inputs.claim(),undefined);
  }finally{await f.close();}
});

test('HMR-QUEUE-TX: normal host processing uses the claimed request without inserting or executing it twice',async()=>{
  const f=syntheticHost();try{
    await f.app.start();const reply=await f.app.message(input.text,input.requestId);
    assert.match(reply,/Synthetic reply/);assert.deepEqual(f.seen,[input.text]);
    assert.equal(f.app.store.request(input.requestId)?.state,'completed');assert.equal(f.app.inputs.list()[0]!.state,'completed');
    await f.app.message(input.text,input.requestId);assert.deepEqual(f.seen,[input.text]);
  }finally{await f.close();}
});

for(const matching of [true,false]) test('HMR-QUEUE-TX: an existing '+(matching?'matching':'different')+' processing request prevents claim and unknown side-effect replay',async()=>{
  const f=syntheticHost();try{
    await f.app.start();f.app.inputs.accept(input);
    f.app.store.startRequest(input.requestId,matching?createHash('sha256').update(input.text).digest('hex'):'synthetic-conflicting-hash');
    const before=state(f);assert.throws(()=>f.app.inputs.claim(),matching?/request_interrupted_use_new_id/:/request_id_conflict/);
    assert.deepEqual(state(f),before);assert.deepEqual(f.seen,[]);
  }finally{await f.close();}
});

test('HMR-QUEUE-TX: host durably reports failed claim validation without a half-started request or automatic retry',async()=>{
  const f=syntheticHost();try{
    await f.app.start();const hooks=lifecycle(f),claim=hooks.claim;let attempts=0;
    hooks.claim=(value,thread)=>{attempts++;claim(value,thread);throw Error('synthetic_claim_failure');};
    f.app.submitMessage(input);const end=Date.now()+2000;
    while(f.app.inputs.list()[0]!.state!=='failed'){
      assert.ok(Date.now()<end,'failed claim must become visibly terminal');await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(attempts,1);assert.equal(f.app.store.request(input.requestId),undefined);assert.deepEqual(f.seen,[]);
    const records=f.app.history.list(f.app.store.meta('mainThread')!);
    assert.deepEqual(records.map(m=>m.status),['failed','failed','failed']);
    assert.equal(records[2]!.id,'input-outcome:'+f.app.inputs.list()[0]!.replyId);assert.equal(records[2]!.requestId,input.requestId);
    assert.equal(f.app.conversationState().messages.length,1,'pre-send failure has one outcome, no formal user bubble');
    assert.equal(f.app.conversationState().messages[0]!.source?.text,input.text);
    assert.equal(f.app.submitMessage(input).fresh,false);assert.equal(attempts,1);
  }finally{await f.close();}
});
