// Synthetic queue/memory seam tests. Existing memory owner files are read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationHistory } from '../src/web-history.js';
import { MainInputs } from '../src/recursive-main-inputs.js';
import { Memory } from '../src/memory.js';
import { fixture } from './recursive-fixture.js';
test('HMR-QUEUE-006: queued, cancelled and replaced text cannot become memory sources; claim adopts only the current revision', () => {
  const f = fixture();
  try {
    f.store.setMeta('mainThread', 'synthetic-thread');
    const history = new ConversationHistory(f.store.db), memory = new Memory(f.store);
    const inputs = new MainInputs(f.tasks, history, undefined, { claim(input, threadId) { memory.observe(input.requestId, threadId); memory.adopt(input.requestId, threadId, input.text); } });
    const context = (requestId: string) => ({ requestId, threadId: 'synthetic-thread', epoch: memory.settings().epoch });
    inputs.accept({ requestId: 'replace', text: '请记住：以后报告都用中文。' });
    assert.throws(() => memory.propose({ operationId: 'too-early', content: '以后报告都用中文。' }, context('replace')), /source_not_authorized/);
    const queued = inputs.list()[0]!;
    inputs.edit({ requestId: 'replace', operationId: 'edit', expectedRevision: queued.revision, input: { requestId: 'replace', text: '请记住：以后报告都用英文。' } });
    inputs.accept({ requestId: 'cancel', text: '请记住：我习惯详细回答。' });
    const cancelled = inputs.list().find(x => x.input.requestId === 'cancel')!;
    inputs.cancel({ requestId: 'cancel', operationId: 'cancel', expectedRevision: cancelled.revision });
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM memory_jobs').get()!.n, 0);
    const current = inputs.claim()!;
    assert.equal(current.inputRevision, 2);
    assert.throws(() => memory.propose({ operationId: 'old-source', content: '以后报告都用中文。' }, context('replace')), /source_not_authorized/);
    assert.equal(memory.propose({ operationId: 'new-source', content: '以后报告都用英文。' }, context('replace')).state, 'active');
    assert.throws(() => memory.propose({ operationId: 'cancelled-source', content: '我习惯详细回答。' }, context('cancel')), /source_not_authorized/);
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM memory_jobs').get()!.n, 1);
  }
  finally {
    f.close();
  }
});
test('HMR-QUEUE-006: source adoption failure rolls back claim and leaves the message editable', () => {
  const f = fixture();
  try {
    f.store.setMeta('mainThread', 'synthetic-thread');
    const history = new ConversationHistory(f.store.db);
    const inputs = new MainInputs(f.tasks, history, undefined, { claim() { throw Error('synthetic_memory_fence'); } });
    inputs.accept({ requestId: 'fenced', text: 'Synthetic current revision' });
    assert.throws(() => inputs.claim(), /synthetic_memory_fence/);
    const queued = inputs.list()[0]!;
    assert.equal(queued.state, 'queued');
    assert.equal(queued.revision, 0);
    assert.doesNotThrow(() => inputs.edit({ requestId: 'fenced', operationId: 'editable', expectedRevision: queued.revision, input: { requestId: 'fenced', text: 'Synthetic corrected revision' } }));
  }
  finally {
    f.close();
  }
});
