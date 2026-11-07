import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.js';
import { Files } from '../src/files.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { ConversationHistory } from '../src/web-history.js';
import { RecursiveTasks } from '../src/recursive-tasks.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
mkdirSync('.codex/scratch/linear-conversation-timeline-review/regression-runtime',{recursive:true});
function fixture() { const dir = mkdtempSync(resolve('.codex/scratch/linear-conversation-timeline-review/regression-runtime/main-input-')); const store = new Store(join(dir, 'db.sqlite')); new WorkerInteractions(store.db); const history = new ConversationHistory(store.db); const tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace'))); tasks.migrate(); store.setMeta('mainThread', 'synthetic-main-thread'); const inputs = new MainInputs(tasks, history); return { store, history, inputs, tasks, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } }; }
test('a resumed session leaves old pending inputs untouched while processing a newly submitted input',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'old',text:'synthetic old'});
  const cutoff=Number(f.store.db.prepare('SELECT max(seq) AS n FROM agent_messages').get()!.n);
  const resumed=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
  assert.equal(resumed.claim(),undefined);
  resumed.accept({requestId:'new',text:'synthetic new'});
  const next=resumed.claim()!;assert.equal(next.input.requestId,'new');
  resumed.finish(next.messageId,next.revision,'completed');
  assert.equal(resumed.claim(),undefined);
  assert.equal(resumed.list().find(x=>x.input.requestId==='old')!.state,'queued');
  assert.equal(new MainInputs(f.tasks,f.history).runnableHead()!.input.requestId,'old');
 }finally{f.close();}
});
test('HMR-QUEUE-001: three sends while generating persist FIFO and revisions; reconnect reads server truth', () => {
  const f = fixture();
  try {
    f.inputs.accept({ requestId: 'q1', text: 'Synthetic first' });
    const first = f.inputs.claim()!;
    assert.equal(first.input.requestId, 'q1');
    f.inputs.started(first.messageId, first.revision, 'generation-1', 'turn-1');
    const source = f.history.add('synthetic-main-thread', '**Synthetic source** with unknown dates.');
    const quotes = [{ messageId: source, text: 'Synthetic source', annotation: 'Preserve this quote' }, { messageId: source, text: 'unknown dates', annotation: 'Do not guess' }];
    for (let i = 2;i <= 4;i++)
      f.inputs.accept({ requestId: 'q' + i, text: 'Synthetic queued ' + i, quotes });
    assert.equal(f.inputs.claim(), undefined);
    assert.deepEqual(f.inputs.list().map(x => x.state), ['processing', 'queued', 'queued', 'queued']);
    const reconnected = new MainInputs(f.tasks, f.history);
    assert.equal(reconnected.list().length, 4);
    f.inputs.finish(first.messageId, first.revision, 'completed');
    for (let i = 2;i <= 4;i++) {
      const next = f.inputs.claim()!;
      assert.equal(next.input.requestId, 'q' + i);
      assert.deepEqual(next.input.quotes, quotes);
      f.inputs.finish(next.messageId, next.revision, 'completed');
    }
    assert.equal(f.inputs.claim(), undefined);
  }
  finally {
    f.close();
  }
});
test('HMR-QUEUE-002: edit/cancel race claim with CAS; original acceptance ID retry does not revive or restore text', () => {
  const f = fixture();
  try {
    const original = { requestId: 'q1', text: 'Original synthetic preference' };
    f.inputs.accept(original);
    const row = f.inputs.list()[0]!;
    f.inputs.edit({ requestId: 'q1', operationId: 'edit-1', expectedRevision: row.revision, input: { ...original, text: 'Corrected synthetic preference' } });
    assert.throws(() => f.inputs.edit({ requestId: 'q1', operationId: 'stale-edit', expectedRevision: row.revision, input: original }), /revision/);
    f.inputs.accept(original);
    assert.equal(f.inputs.list()[0]!.input.text, 'Corrected synthetic preference');
    const claimed = f.inputs.claim()!;
    assert.equal(claimed.input.text, 'Corrected synthetic preference');
    assert.throws(() => f.inputs.cancel({ requestId: 'q1', operationId: 'too-late', expectedRevision: claimed.revision }), /processing/);
    f.inputs.finish(claimed.messageId, claimed.revision, 'completed');
    f.inputs.accept({ requestId: 'q2', text: 'Withdraw synthetic message' });
    let queued = f.inputs.list().find(x => x.input.requestId === 'q2')!;
    const cancellation = { requestId: 'q2', operationId: 'cancel', expectedRevision: queued.revision };
    f.inputs.cancel(cancellation);
    f.inputs.cancel(cancellation);
    f.inputs.accept({ requestId: 'q2', text: 'Withdraw synthetic message' });
    queued = f.inputs.list().find(x => x.input.requestId === 'q2')!;
    assert.equal(queued.state, 'cancelled');
    assert.equal(f.inputs.claim(), undefined);
    assert.equal(f.history.list('synthetic-main-thread').filter(x => x.role === 'user').length, 2);
  }
  finally {
    f.close();
  }
});
test('HMR-QUEUE-003: interrupt accepts new input before exact generation stop, preserves earlier queued inputs and handles unknown acknowledgement', () => {
  const f = fixture();
  try {
    f.inputs.accept({ requestId: 'active', text: 'Synthetic active' });
    const active = f.inputs.claim()!;
    f.inputs.started(active.messageId, active.revision, 'g-active', 't-active');
    f.inputs.accept({ requestId: 'older', text: 'Synthetic older queued' });
    const request = { requestId: 'urgent', text: 'Synthetic urgent' };
    const receipt = f.inputs.accept(request, undefined, { generationId: 'g-active', messageId: active.replyId });
    assert.equal(f.inputs.list().length, 3);
    assert.equal(f.inputs.claim(), undefined);
    f.inputs.interruptReceipt(receipt.queueMessageId!, 'uncertain');
    f.inputs.accept(request);
    assert.equal(f.inputs.list().length, 3);
    assert.equal(f.inputs.list().find(x => x.input.requestId === 'urgent')!.interruptState, 'uncertain');
    f.inputs.finish(active.messageId, active.revision, 'interrupted');
    const older = f.inputs.claim()!;
    assert.equal(older.input.requestId, 'older','stopping a turn does not give the accompanying business input priority');
    f.inputs.finish(older.messageId, older.revision, 'completed');
    assert.equal(f.inputs.claim()!.input.requestId, 'urgent');
  }
  finally {
    f.close();
  }
});
test('HMR-QUEUE-004: crash never replays claimed user work; genuinely unclaimed inputs survive and processing remains visibly uncertain', () => {
  const f = fixture(); try {
    f.inputs.accept({ requestId: 'first', text: 'Synthetic first' });
    const first = f.inputs.claim()!;
    f.inputs.accept({ requestId: 'second', text: 'Synthetic queued' });
    f.inputs.reconcile();
    assert.equal(f.inputs.list()[0]!.state, 'uncertain');
    assert.equal(f.inputs.claim()!.input.requestId, 'second');
    assert.throws(() => f.inputs.finish(first.messageId, first.revision, 'completed'), /revision|state/);
    assert.equal(f.inputs.list()[0]!.state, 'uncertain');
  }
    finally {
    f.close();
  }
});
test('HMR-QUEUE: unexpected processing failure fences only the active revision, never a committed reply',()=>{
  const f=fixture();try{
    f.inputs.accept({requestId:'unknown',text:'Synthetic active'});const active=f.inputs.claim()!;
    assert.equal(f.inputs.uncertain(active.messageId,active.revision),true);
    assert.equal(f.inputs.list()[0]!.state,'uncertain');assert.equal(f.inputs.claim(),undefined);
    f.inputs.accept({requestId:'done',text:'Synthetic done'});const done=f.inputs.claim()!;f.inputs.finish(done.messageId,done.revision,'completed');
    assert.equal(f.inputs.uncertain(done.messageId,done.revision),false);assert.equal(f.inputs.list()[1]!.state,'completed');
    assert.equal(f.inputs.accept({requestId:'unknown',text:'Synthetic active'}).fresh,false);
    assert.equal(f.inputs.claim(),undefined);
  }finally{f.close();}
});
test('HMR-QUEUE-005: interrupt confirmation requires the exact target generation to end; starting input never fabricates a stop', () => {
  const f = fixture();
  try {
    f.inputs.accept({ requestId: 'active', text: 'Synthetic active' });
    const active = f.inputs.claim()!;
    f.inputs.started(active.messageId, active.revision, 'g-active', 't-active');
    const urgent = f.inputs.accept({ requestId: 'urgent', text: 'Synthetic urgent' }, undefined, { generationId: 'g-active', messageId: active.replyId });
    assert.throws(() => f.inputs.interruptReceipt(urgent.queueMessageId!, 'confirmed'), /interrupt_target_not_ended/);
    f.inputs.interruptReceipt(urgent.queueMessageId!, 'uncertain');
    f.inputs.finish(active.messageId, active.revision, 'interrupted');
    const next = f.inputs.claim()!;
    f.inputs.started(next.messageId, next.revision, 'g-urgent', 't-urgent');
    assert.equal(f.inputs.list().find(x => x.input.requestId === 'urgent')!.interruptState, 'uncertain');
    f.inputs.interruptReceipt(urgent.queueMessageId!, 'confirmed');
    f.inputs.interruptReceipt(urgent.queueMessageId!, 'uncertain');
    assert.equal(f.inputs.list().find(x => x.input.requestId === 'urgent')!.interruptState, 'confirmed');
  }
  finally {
    f.close();
  }
});
test('HMR-QUEUE-007: database reopen preserves FIFO, edits, withdrawals, quote annotations and generation association', () => {
  const dir = mkdtempSync(resolve('.codex/scratch/linear-conversation-timeline-review/regression-runtime/queue-reopen-')), path = join(dir, 'db.sqlite');
  let store = new Store(path);
  try {
    new WorkerInteractions(store.db);
    let history = new ConversationHistory(store.db), tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace')));
    tasks.migrate();
    store.setMeta('mainThread', 'synthetic-original-thread');
    let inputs = new MainInputs(tasks, history);
    const source = history.add('synthetic-original-thread', 'Synthetic facts remain unknown.');
    const quotes = [{ messageId: source, text: 'Synthetic facts', annotation: 'Preserve label' }, { messageId: source, text: 'unknown', annotation: 'Do not invent' }];
    inputs.accept({ requestId: 'active', text: 'Synthetic generating' });
    const active = inputs.claim()!;
    inputs.started(active.messageId, active.revision, 'synthetic-generation', 'synthetic-turn');
    for (const requestId of ['first', 'second', 'third'])
      inputs.accept({ requestId, text: 'Synthetic queued ' + requestId, quotes });
    const second = inputs.list().find(x => x.input.requestId === 'second')!;
    inputs.edit({ requestId: 'second', operationId: 'edit', expectedRevision: second.revision, input: { requestId: 'second', text: 'Synthetic edited text', quotes } });
    const third = inputs.list().find(x => x.input.requestId === 'third')!;
    inputs.cancel({ requestId: 'third', operationId: 'withdraw', expectedRevision: third.revision });
    store.close();
    store = new Store(path);
    new WorkerInteractions(store.db);
    history = new ConversationHistory(store.db);
    tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace')));
    tasks.migrate();
    inputs = new MainInputs(tasks, history);
    assert.equal(store.meta('mainThread'), 'synthetic-original-thread');
    const recovered = inputs.list();
    assert.deepEqual(recovered.map(x => x.input.requestId), ['active', 'first', 'second', 'third']);
    assert.equal(recovered[0]!.generationId, 'synthetic-generation');
    assert.equal(recovered[2]!.input.text, 'Synthetic edited text');
    assert.deepEqual(recovered[2]!.input.quotes, quotes);
    assert.equal(recovered[3]!.state, 'cancelled');
    inputs.reconcile();
    assert.equal(inputs.list()[0]!.state, 'uncertain');
    const first = inputs.claim()!;
    assert.equal(first.input.requestId, 'first');
    inputs.finish(first.messageId, first.revision, 'completed');
    assert.equal(inputs.claim()!.input.requestId, 'second');
  }
  finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('typed native question answers cannot enter the ordinary durable inbox',()=>{
 const f=fixture();try{
  assert.throws(()=>f.inputs.accept({requestId:'native-answer',text:'可读答复',interactionId:'native-question',questionAnswers:{q:['A']}}),/interaction_response_kind/);
  assert.equal(f.inputs.list().length,0);assert.equal(f.history.list('synthetic-main-thread').length,0);
  f.inputs.accept({requestId:'ordinary',text:'原文',interactionId:'business-question'});
  const queued=f.inputs.list()[0]!;
  assert.throws(()=>f.inputs.edit({requestId:'ordinary',operationId:'bad-edit',expectedRevision:queued.revision,input:{requestId:'ordinary',text:'改写',interactionId:'business-question',questionAnswers:{q:['A']}}}),/interaction_response_kind/);
  assert.equal(f.inputs.list()[0]!.input.text,'原文');
 }finally{f.close();}
});

test('preview queue edits retain or remove the accepted source snapshot, but cannot replace it',()=>{
 const f=fixture();try{
  const resourceReference={kind:'text' as const,source:{kind:'attachment' as const,assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,messageId:'result-synthetic',sha256:'a'.repeat(64),title:'Synthetic.txt'},text:'Original excerpt'};
  f.inputs.accept({requestId:'preview-queue',text:'Original requirement',resourceReference});
  let row=f.inputs.list().find(x=>x.input.requestId==='preview-queue')!;
  f.inputs.edit({requestId:'preview-queue',operationId:'preview-edit',expectedRevision:row.revision,input:{...row.input,text:'Revised requirement'}});
  row=f.inputs.list().find(x=>x.input.requestId==='preview-queue')!;
  assert.deepEqual(row.input.resourceReference,resourceReference);
  assert.throws(()=>f.inputs.edit({requestId:'preview-queue',operationId:'preview-forged',expectedRevision:row.revision,input:{...row.input,resourceReference:{...resourceReference,text:'Replaced excerpt'}}}),/queue_quote_validation_required/);
  const {resourceReference:_source,...input}=row.input;
  f.inputs.edit({requestId:'preview-queue',operationId:'preview-remove',expectedRevision:row.revision,input});
  assert.equal(f.inputs.list().find(x=>x.input.requestId==='preview-queue')!.input.resourceReference,undefined);
 }finally{f.close();}
});

test('preview queue edits reject overlong intent without changing the accepted revision',()=>{
 const f=fixture();try{
  const resourceReference={kind:'web' as const,source:{kind:'web' as const,messageId:'message-source',sourceId:'link-1',url:'https://example.com/',title:'Source'},annotations:[{id:'n1',element:'button',elementPath:'#target',comment:'x'.repeat(9000),x:0,y:0}]};
  f.inputs.accept({requestId:'preview-budget-edit',text:'Original',resourceReference});
  const row=f.inputs.list()[0]!;
  assert.throws(()=>f.inputs.edit({requestId:row.input.requestId,operationId:'overlong-edit',expectedRevision:row.revision,input:{...row.input,text:'x'.repeat(16000)}}),/preview_intent_too_long/);
  assert.equal(f.inputs.list()[0]!.revision,row.revision);
  assert.equal(f.inputs.list()[0]!.input.text,'Original');
  f.inputs.edit({requestId:row.input.requestId,operationId:'short-edit',expectedRevision:row.revision,input:{...row.input,text:'Shorter'}});
  assert.equal(f.inputs.list()[0]!.input.text,'Shorter');
 }finally{f.close();}
});

test('previously accepted long preview inputs remain readable and retry by original identity',()=>{
 const f=fixture();try{
  const resourceReference={kind:'web' as const,source:{kind:'web' as const,messageId:'message-source',sourceId:'link-1',url:'https://example.com/',title:'Source'},annotations:[0,1].map(i=>({id:'n'+i,element:'button',elementPath:'#target',comment:'x'.repeat(12000),x:0,y:0}))};
  const input={requestId:'preview-legacy-budget',text:'',resourceReference};
  // Seed acceptance from before the new intake check, through the history owner.
  const accepted=f.history.accept('synthetic-main-thread',input);
  assert.deepEqual(f.history.list('synthetic-main-thread')[0]!.resourceReference,resourceReference);
  const retried=f.inputs.accept(input);
  assert.equal(retried.fresh,false);assert.equal(retried.replyId,accepted.replyId);
 }finally{f.close();}
});
