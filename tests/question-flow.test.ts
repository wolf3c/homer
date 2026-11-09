import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectQuestions, questionAnswerText } from '../src/question-schema.js';
import { nativeInteraction } from '../src/worker-interaction-protocol.js';
import { prepareInteractionResponse } from '../ui/conversation-client.js';
import { homerWebBridge } from '../src/web-homer.js';
import { chatFixture } from './task-chat-fixture.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { MainProcessHistory } from '../src/main-process.js';
import { WebHistoryPages } from '../src/web-history-pages.js';
import type { Homer } from '../src/service.js';

test('main native questions project through the web bridge and preserve legacy text submission', async t => {
  const f=chatFixture();t.after(()=>f.close());
  const interactions=new WorkerInteractions(f.store.db),pages=new WebHistoryPages(f.history,new MainProcessHistory(f.store.db),f.inputs);
  const native = nativeInteraction('item/tool/requestUserInput', { threadId: 'thread:main', turnId: 'u', itemId: 'i', questions: [{ id: 'format', question: 'Which format?', options: [{ label: 'Markdown', description: 'Readable' }], isOther: true }] })!;
  const request=interactions.open({runId:'main-native:synthetic',threadId:'thread:main',turnId:'u',requestId:'i',source:'native',kind:native.kind,details:native.details,authority:{...f.authority,nativeApprovals:true}},()=>true);
  interactions.escalate(request.id,'Choose','Synthetic user decision needed');
  let submitted:unknown;
  const app = {
    ...f, interactions, webHistoryPages:()=>pages, webReadEpoch:'synthetic', registerWebSurface(){},
    conversationControlState:()=>({isRunning:false,activeMessageId:null}),
    submitMessage: async (input: unknown) => { submitted = input; return {}; },
  } as unknown as Homer;
  const bridge = homerWebBridge(app);
  const state = await bridge.history!.state();
  assert.equal(state.interactions[0]!.sourceRequestId, f.authority.sourceRequestId);
  const questions = state.interactions[0]!.questions!;
  assert.deepEqual(questions, [{ id: 'format', question: 'Which format?', options: [{ label: 'Markdown', description: 'Readable' }], allowOther: true }]);
  const text = questionAnswerText(questions, { format: 'Markdown' });
  assert.equal(text, '1. Which format?\n答案：Markdown');
  const pending = prepareInteractionResponse(text, request.id, undefined, () => 'stable');
  assert.equal(prepareInteractionResponse(text, request.id, pending, () => 'new'), pending);
  assert.equal(prepareInteractionResponse(text + ' edited', request.id, pending, () => 'new').requestId, 'new');
  await bridge.respond(request.id, { requestId: pending.requestId, text });
  assert.deepEqual(submitted, { requestId: 'stable', text, interactionId: request.id });
  f.store.db.prepare('UPDATE worker_interactions SET runId=? WHERE id=?').run('worker-run',request.id);
  assert.equal((await bridge.history!.state()).interactions[0]!.questions,undefined,'Worker native questions remain main Agent context, not a mandatory user form');
});

test('missing, malformed, secret and authorization payloads safely fall back', () => {
  const q = { id: 'x', question: 'Q', options: [{ label: 'A', extra: 'private' }], extra: 'private' };
  assert.equal(projectQuestions('authorization', { questions: [q] }), undefined);
  for (const details of [{}, { questions: [] }, { questions: [q, q] }, { questions: [{ ...q, isSecret: true }] }, { questions: [{ ...q, options: [{ label: 3 }] }] }]) assert.equal(projectQuestions('question', details), undefined);
  assert.deepEqual(projectQuestions('question', { questions: [q], private: 'hidden' }), [{ id: 'x', question: 'Q', options: [{ label: 'A' }], allowOther: false }]);
});
