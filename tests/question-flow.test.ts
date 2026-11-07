import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectQuestions, questionAnswerText } from '../src/question-schema.js';
import { nativeInteraction } from '../src/worker-interaction-protocol.js';
import { prepareInteractionResponse } from '../ui/conversation-client.js';
import { homerWebBridge } from '../src/web-homer.js';
import { Store } from '../src/store.js';
import type { Homer } from '../src/service.js';

test('main native questions project through the web bridge and preserve legacy text submission', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.setMeta('mainAgentId', 'main:synthetic');
  store.setMeta('mainThread', 't');
  const native = nativeInteraction('item/tool/requestUserInput', { threadId: 't', turnId: 'u', itemId: 'i', questions: [{ id: 'format', question: 'Which format?', options: [{ label: 'Markdown', description: 'Readable' }], isOther: true }] })!;
  let submitted: unknown,runId='main-native:synthetic';
  const app = {
    store,
    inputs:{dispatchSummary:()=>({orderVersion:'synthetic',totalWaiting:0})},
    registerWebSurface() {}, conversationState: () => ({threadId:'t',messages:[],processNodes:[]}),
    snapshot: () => ({ runs: [], tasks:[], matters:[], deliveries:[], interactions: [{ id: 'q', state: 'pending_user' }] }),
    interactions: { inspect: () => ({ ...native, id: 'q', runId, authority:{sourceRequestId:'synthetic-source'}, userQuestion: 'Choose', escalationReason: null }) },
    submitMessage: async (input: unknown) => { submitted = input; return {}; },
  } as unknown as Homer;
  const bridge = homerWebBridge(app);
  const state = await bridge.state();
  assert.equal(state.interactions[0]!.sourceRequestId, 'synthetic-source');
  const questions = state.interactions[0]!.questions!;
  assert.deepEqual(questions, [{ id: 'format', question: 'Which format?', options: [{ label: 'Markdown', description: 'Readable' }], allowOther: true }]);
  const text = questionAnswerText(questions, { format: 'Markdown' });
  assert.equal(text, '1. Which format?\n答案：Markdown');
  const pending = prepareInteractionResponse(text, 'q', undefined, () => 'stable');
  assert.equal(prepareInteractionResponse(text, 'q', pending, () => 'new'), pending);
  assert.equal(prepareInteractionResponse(text + ' edited', 'q', pending, () => 'new').requestId, 'new');
  await bridge.respond('q', { requestId: pending.requestId, text });
  assert.deepEqual(submitted, { requestId: 'stable', text, interactionId: 'q' });
  runId='worker-run';
  assert.equal((await bridge.state()).interactions[0]!.questions,undefined,'Worker native questions remain main Agent context, not a mandatory user form');
});

test('missing, malformed, secret and authorization payloads safely fall back', () => {
  const q = { id: 'x', question: 'Q', options: [{ label: 'A', extra: 'private' }], extra: 'private' };
  assert.equal(projectQuestions('authorization', { questions: [q] }), undefined);
  for (const details of [{}, { questions: [] }, { questions: [q, q] }, { questions: [{ ...q, isSecret: true }] }, { questions: [{ ...q, options: [{ label: 3 }] }] }]) assert.equal(projectQuestions('question', details), undefined);
  assert.deepEqual(projectQuestions('question', { questions: [q], private: 'hidden' }), [{ id: 'x', question: 'Q', options: [{ label: 'A' }], allowOther: false }]);
});
