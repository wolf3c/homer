import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import * as AssistantUI from '@assistant-ui/react';
import { useActionBarCopy } from '@assistant-ui/core/react';
import { MessageCirclePlus } from 'lucide-react';
import { referencesOf } from '../src/preview-reference.js';
import { previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText } from '../src/message-quote.js';
import { conversationTimestamps, isVisibleConversationMessage } from '../ui/chat-date.js';
import { projectConversation } from '../src/conversation-projection.js';
import { ConversationHistory } from '../src/web-history.js';
import { withDom } from './helpers/process-dom.mjs';

const m = <T extends object = Record<never, never>>(id: string, createdAt: unknown, extra: T = {} as T) => ({ id, createdAt, role: 'user', text: '内容', ...extra });
const at = (value: string) => new Date(value);
const defaultClock = (value: string, timeZone?: string) => new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit' }).format(at(value));
test('adjacent calendar days include year, yesterday crosses year, original order and IDs remain', () => {
  const messages = [m('a', '2024-12-31T15:59:00Z'), m('b', '2024-12-31T15:59:59Z'), m('c', '2024-12-31T16:00:00Z'), m('d', '2023-12-31T16:00:00Z'), m('e', '2024-12-31T16:01:00Z')];
  const map = conversationTimestamps(messages, { now: at('2024-12-31T16:05:00Z'), timeZone: 'Asia/Shanghai' });
  assert.deepEqual([...map.keys()], ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([...map.values()].map(v => v.dayLabel), ['昨天', undefined, '今天', '2024年1月1日', '今天']);
  assert.equal(map.get('c')?.time, defaultClock('2024-12-31T16:00:00Z', 'Asia/Shanghai'));
  assert.equal(map.get('c')?.dayKey, '2025-01-01');
  assert.equal(messages[0]!.id, 'a');
});

test('display timezone owns both time and date; DST yesterday is a calendar day', () => {
  const instant = '2025-01-01T00:30:00Z';
  const sh = conversationTimestamps([m('a', instant)], { now: at(instant), timeZone: 'Asia/Shanghai' }).get('a')!;
  const la = conversationTimestamps([m('a', instant)], { now: at(instant), timeZone: 'America/Los_Angeles' }).get('a')!;
  assert.equal(sh.dayKey, '2025-01-01'); assert.equal(sh.time, defaultClock(instant, 'Asia/Shanghai'));
  assert.equal(la.dayKey, '2024-12-31'); assert.equal(la.time, defaultClock(instant, 'America/Los_Angeles'));
  for (const [now, yesterday] of [['2025-03-10T04:30:00Z', '2025-03-09T05:30:00Z'], ['2025-11-03T05:30:00Z', '2025-11-02T04:30:00Z']]) {
    assert.equal(conversationTimestamps([m('dst', yesterday)], { now: at(now!), timeZone: 'America/New_York' }).get('dst')?.dayLabel, '昨天');
  }
  const repeatedHour = conversationTimestamps([m('first', '2025-11-02T05:30:00Z'), m('second', '2025-11-02T06:30:00Z')], { now: at('2025-11-03T05:30:00Z'), timeZone: 'America/New_York' });
  assert.equal(repeatedHour.get('first')?.time, repeatedHour.get('second')?.time);
  assert.equal(repeatedHour.get('second')?.dayLabel, undefined);
  assert.notEqual(repeatedHour.get('first')?.dateTime, repeatedHour.get('second')?.dateTime);
});

test('missing/invalid time never fabricates time; suppressed assistant and worker records create no date segment', () => {
  const map = conversationTimestamps([
    m('a', 0), ...[undefined, null, '', ' ', 'bad-date', NaN, Infinity, new Date(NaN)].map((time, i) => m('invalid' + i, time)),
    m('queued', '2030-01-01T00:00:00Z', { role: 'assistant', status: 'queued', text: '' }),
    m('cancelled', '2030-01-02T00:00:00Z', { role: 'assistant', status: 'cancelled', text: '' }),
    m('internal', '2030-01-03T00:00:00Z', { role: 'assistant', process: { sourceKind: 'worker' } }),
    m('same-day', 10_000), m('publication', '1970-01-02T00:00:00Z', { role: 'assistant' }),
  ], { now: at('1970-01-02T00:30:00Z'), timeZone: 'UTC' });
  assert.deepEqual([...map.keys()], ['a', 'same-day', 'publication']);
  assert.equal(map.get('same-day')?.dayLabel, undefined);
  assert.equal(map.get('a')?.dateTime, '1970-01-01T00:00:00.000Z');
  assert.equal(map.get('publication')?.dayLabel, '今天');
  assert.equal(isVisibleConversationMessage(undefined), false);
});

test('default timezone follows local environment and relative labels refresh after midnight', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const messages = [m('a', '2025-01-01T07:59:00Z')];
    assert.equal(conversationTimestamps(messages, { now: at('2025-01-01T07:59:30Z') }).get('a')?.dayLabel, '今天');
    assert.equal(conversationTimestamps(messages, { now: at('2025-01-01T08:00:00Z') }).get('a')?.dayLabel, '昨天');
    const expected = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
    const options = expected.resolvedOptions();
    assert.equal(options.timeZone, 'America/Los_Angeles');
    const resolved = new Intl.DateTimeFormat(options.locale, { timeZone: options.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: options.hourCycle });
    assert.equal(expected.format(at(messages[0]!.createdAt as string)), resolved.format(at(messages[0]!.createdAt as string)));
    assert.equal(conversationTimestamps(messages, { now: at('2025-01-01T08:00:00Z') }).get('a')?.time, expected.format(at(messages[0]!.createdAt as string)));
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test('existing projection owns queued and hidden history; dates use its public message identities', () => {
  const user = { ...m('queued-user', 1000), role: 'user', status: 'completed', requestId: 'r' } as any;
  const reply = { ...m('queued-reply', 2000), role: 'assistant', status: 'queued', text: '', requestId: 'r' } as any;
  const publication = { ...m('publication', '2025-01-02T00:00:00Z'), role: 'assistant', status: 'completed' } as any;
  const inbox = [{ messageId: user.id, replyId: reply.id, state: 'queued', input: { requestId: 'r', text: user.text } }] as any;
  const projected = projectConversation([user, reply, publication], [], inbox);
  assert.equal(projected.queue.length, 1);
  assert.deepEqual(projected.messages.map(m => m.id), ['publication']);
  const timestamps = conversationTimestamps(projected.messages, { now: at('2025-01-03T00:00:00Z'), timeZone: 'UTC' });
  assert.deepEqual([...timestamps.keys()], ['publication']);
  assert.equal(timestamps.get('publication')?.dayLabel, '昨天');
});

for (const [label, queuedAt] of [['overnight', '2025-01-01T23:54:00+08:00'], ['same day', '2025-01-02T09:00:00+08:00']]) {
  test('conversation delivery time: ' + label + ' uses confirmed process time without changing stored input', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const history = new ConversationHistory(db), thread = 'synthetic-time';
      const startedAt = Date.parse('2025-01-02T10:40:00+08:00');
      history.record('quoted', thread, '引用原文');
      db.prepare('UPDATE conversation_messages SET createdAt=? WHERE id=?').run(startedAt - 60_000, 'quoted');
      const receipt = history.accept(thread, { requestId: 'r', text: '合成请求', quote: { messageId: 'quoted', text: '引用原文' }, attachments: [{ assetId: 'asset-00000000-0000-4000-8000-000000000001', revision: 1 }] });
      db.prepare('UPDATE conversation_messages SET createdAt=? WHERE requestId=?').run(Date.parse(queuedAt!), 'r');
      history.record('process', thread, '', 'running');
      db.prepare('UPDATE conversation_messages SET createdAt=? WHERE id=?').run(startedAt, 'process');
      const rows = history.list(thread), source = rows.find(row => row.role === 'user')!;
      const original = structuredClone(rows), stored = db.prepare('SELECT * FROM conversation_messages ORDER BY rowid').all();
      const node = { id: 'process', messageId: 'process', sourceKind: 'user', sourceMessageIds: [source.id], replyMessageId: receipt.replyId, replyPolicy: 'explicitFinal', seq: 1, state: 'working', status: 'running', items: [] } as any;
      const inbox = [{ messageId: source.id, replyId: receipt.replyId, state: 'processing', input: { requestId: 'r', text: source.text } }] as any;
      const projected = projectConversation(rows, [node], inbox).messages;
      assert.deepEqual(projected.map(row => row.id), ['quoted', source.id, 'process']);
      assert.deepEqual(projected[1], { ...source, createdAt: startedAt, inputState: 'processing' });
      const times = conversationTimestamps(projected, { now: at('2025-01-02T11:00:00+08:00'), timeZone: 'Asia/Shanghai' });
      assert.deepEqual([...times.values()].map(time => time.dayLabel), ['今天', undefined, undefined]);
      assert.equal(times.get(source.id)?.time, defaultClock('2025-01-02T10:40:00+08:00', 'Asia/Shanghai'));
      assert.equal(times.get(source.id)?.dateTime, times.get('process')?.dateTime);
      assert.equal(times.get(source.id)?.title, times.get('process')?.title);
      assert.deepEqual(rows, original);
      assert.deepEqual(db.prepare('SELECT * FROM conversation_messages ORDER BY rowid').all(), stored);
      assert.equal(history.list(thread).find(row => row.id === source.id)!.createdAt, Date.parse(queuedAt!));
      assert.deepEqual(projectConversation(history.list(thread), [node], inbox).messages, projected);
    } finally { db.close(); }
  });
}

test('conversation delivery time: continuation and streamed items retain the first process time and user identity', () => {
  const user = { ...m('user', 1000), requestId: 'r' } as any;
  const first = { ...m('first', 2000), role: 'assistant' } as any;
  const second = { ...m('second', 4000), role: 'assistant' } as any;
  const nodes = [first, second].map((message, i) => ({ id: message.id, messageId: message.id, sourceKind: 'user', sourceMessageIds: [user.id], seq: i + 1, state: 'working', status: 'running', items: [] })) as any;
  const inbox = [{ messageId: user.id, state: 'processing', input: { requestId: 'r', text: user.text } }] as any;
  const initial = projectConversation([user, first], [nodes[0]], inbox).messages;
  nodes[0].items = [{ id: 'part', kind: 'commentary', phase: 'final_answer', text: '流式增长', completed: false }];
  const resumed = projectConversation([user, first, second], nodes, inbox).messages;
  assert.deepEqual(resumed.map(row => row.id), ['user', 'first', 'second']);
  assert.equal(initial[0]!.createdAt, 2000);
  assert.deepEqual(resumed[0], initial[0]);
  assert.equal(resumed[1]!.text, '流式增长');
  assert.equal(resumed[2]!.sourceMessageId, user.id);
});

test('conversation delivery time: queue, unconfirmed and cancelled inputs stay unsent; legacy times remain', () => {
  const user = { ...m('user', 1000), requestId: 'r' } as any;
  const reply = { ...m('reply', 1000), role: 'assistant', requestId: 'r', status: 'queued', text: '' } as any;
  for (const state of ['queued', 'processing', 'uncertain', 'cancelled']) {
    const inbox = [{ messageId: user.id, replyId: reply.id, state, input: { requestId: 'r', text: user.text } }] as any;
    const projected = projectConversation([user, reply], [], inbox);
    assert.deepEqual(projected.messages, []);
    assert.equal(projected.queue.length, state === 'cancelled' ? 0 : 1);
    if (projected.queue.length) assert.equal(projected.queue[0]!.user.createdAt, 1000);
  }
  const legacy = projectConversation([user, { ...reply, text: '旧答复', status: 'completed' }], [], []).messages;
  assert.deepEqual(legacy.map(row => [row.id, row.createdAt]), [['user', 1000], ['reply', 1000]]);
  assert.equal(user.createdAt, 1000);
});

// Load the production declarations, excluding only CSS imports and app boot.
// The actual installed assistant-ui runtime, providers, Root and Parts run below.
const require = createRequire(import.meta.url);
const {locateSourceQuote}=require('../ui/message-source-selection.ts');
function declarations(path: string, names: string[]) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = ast.statements.filter(node => (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) || (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast)))));
  assert.equal(selected.length, names.length);
  return ts.transpileModule(selected.map(n => n.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
}
const timestampExports: any = {};
Function('require', 'exports', 'createContext', 'useContext', 'useEffect', 'useMemo', 'useState', 'conversationTimestamps', declarations('../ui/message-timestamps.tsx', ['TimestampContext', 'MessageTimestamps', 'MessageDaySeparator', 'MessageTimestamp']))(
  require, timestampExports, React.createContext, React.useContext, React.useEffect, React.useMemo, React.useState, conversationTimestamps);
const actionExports: any = {};
const actionPath = new URL('../ui/vendor/assistant-ui/message-actions.tsx', import.meta.url);
Function('require', 'exports', ts.transpileModule(readFileSync(actionPath, 'utf8').replace(/import\s+['"]\.\/message-actions\.css['"];?/, ''), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText)(require, actionExports);
const detailsExports: any = {};
const quotedActions:unknown[]=[];
Function('require', 'exports', 'useContext', 'useLayoutEffect', 'useRef', 'useState', 'useAui', 'useAuiState', 'useActionBarCopy', 'PreviewActionsContext', 'useComposerInputFocus', 'previewQuoteText', 'messageSourceParts', 'sourceQuote', 'sourceMessageText', 'MessageActions', 'MessageTimestamp',
  declarations('../ui/message-details.tsx', ['MessageDetails', 'RuntimeMessageActions']))(
  require, detailsExports, React.useContext, React.useLayoutEffect, React.useRef, React.useState, AssistantUI.useAui, useAuiState, useActionBarCopy,
  React.createContext({ canQuote: () => true,appendQuote:(quote:unknown)=>quotedActions.push(quote) }), () => () => {}, previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText, actionExports.MessageActions, timestampExports.MessageTimestamp);
const processExports: any = {};
Function('require', 'exports', 'useMemo', 'useAuiState', 'MessagePrimitive', 'HomerToolFallback', declarations('../ui/process-message.tsx', ['useProcessParts']))(
  require, processExports, React.useMemo, useAuiState, MessagePrimitive, () => null);
const wrapperJs = declarations('../ui/homer-app.tsx', ['UserMessage', 'AssistantMessage', 'renderProcessText','QuoteSource']);
// Keep the current production quote renderer in this rich-content boundary.
// Only its stylesheet is omitted; installed primitives and icons stay real.
const quotePath = new URL('../ui/vendor/assistant-ui/quote.tsx', import.meta.url);
const quoteExports: any = {};
const quoteRequire = createRequire(quotePath);
Function('require', 'exports', ts.transpileModule(readFileSync(quotePath, 'utf8').replace(/import\s+["']\.\/quote\.css["'];?/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText)((id: string) => id === '@assistant-ui/react' ? AssistantUI : quoteRequire(id), quoteExports);
// App declarations are private; expose their production bodies for integration.
const wrappers: any = {};
const h = React.createElement;
const files = [{ id: 'file', messageId: 'a' }];
const artifacts = React.createContext({ files });
const processes = React.createContext(new Map());
const calls: any[] = [];
Function('require', 'exports', 'useAuiState', 'useContext','useState','useRef','useEffect','locateSourceQuote', 'draftQuotes', 'MessagePrimitive', 'Markdown', 'MediaAttachments', 'MessageDetails', 'InactiveInteractionNotes', 'ArtifactsContext', 'confirmedTerminal', 'ProcessMessageContent', 'ReactMarkdown', 'remarkGfm', 'ArtifactFiles', 'MessageDaySeparator', 'MessageTimestamp', 'isVisibleConversationMessage', 'QuoteBlock', 'MessageCirclePlus', 'referencesOf', 'ProcessMessagesContext', 'useProcessParts', 'messageSourceParts', 'QuoteNavigationContext', wrapperJs + '\nexports.UserMessage=UserMessage;exports.AssistantMessage=AssistantMessage;')(
  require, wrappers, useAuiState, React.useContext,React.useState,React.useRef,React.useEffect,locateSourceQuote, (v: any) => v.quotes ?? [], MessagePrimitive,
  () => h(MessagePrimitive.Parts, { children: ({ part }: any) => part.type === 'text' ? h('p', null, part.text) : null }),
  (props: any) => { calls.push(['media', props]); return props.media?.length ? h('figure', null, '附件') : null; },
  (props: any) => { calls.push(['details', props]); return h(detailsExports.MessageDetails, props); },
  (props: any) => { calls.push(['inactive', props]); return h('aside', null, '失效待答记录'); },
  artifacts, () => true,
  (props: any) => { calls.push(['process', props]); return h('section', { 'data-working': true }, 'Working/Worked', props.children); },
  () => null, () => null,
  (props: any) => { calls.push(['files', props]); return h('aside', null, '成果'); },
  timestampExports.MessageDaySeparator, timestampExports.MessageTimestamp, isVisibleConversationMessage, quoteExports.QuoteBlock,
  MessageCirclePlus, referencesOf, processes, processExports.useProcessParts, messageSourceParts, React.createContext(() => {}));


function ConversationHarness({ source }: { source: any[] }) {
  const messages: ThreadMessageLike[] = source.map(m => ({ id: m.id, role: m.role, content: m.text ? [{ type: 'text', id: 'answer:' + m.id, text: m.text }] : [], createdAt: new Date(m.createdAt), metadata: { custom: { activityPresentation: { entries: { ['text:answer:' + m.id]: { kind: 'answer' } } }, original: m, messageId: m.id, media: m.media, quotes: m.quotes, process: m.process, inactiveInteractions: m.notes } }, ...(m.role === 'assistant' ? { status: { type: 'complete', reason: 'stop' } as const } : {}) }));
  const runtime = useExternalStoreRuntime({ messages, convertMessage: m => m, isRunning: false, onNew: async () => {} });
  return h(AssistantRuntimeProvider, { runtime }, h(timestampExports.MessageTimestamps, { messages: source }, h(processes.Provider, { value: new Map(source.map(m => [m.id, m])) }, h(ThreadPrimitive.Root, null, h(ThreadPrimitive.Messages, { components: wrappers })))));
}
const renderConversation = (source: any[]) => renderToStaticMarkup(h(ConversationHarness, { source }));

test('each reply displays its verified task names directly above its own bubble', () => {
  const task = (taskId: string, title: string, version = 1) => ({ target: { taskId, version }, title });
  const html = renderConversation([
    m('related', 1000, { role: 'assistant', text: '保留原正文', taskSourceUnresolved: true, taskSources: [task('one', '隔离 Chrome 排查'), task('one', '重复来源', 2), task('two', '检查附件来源'), task('three', ''), task('another', '检查附件来源')] }),
    m('ordinary', 2000, { role: 'assistant', text: '普通回复' }),
    m('unavailable', 3000, { role: 'assistant', text: '来源无可用标题', taskSources: [task('unknown', '')] }),
    m('empty', 4000, { role: 'assistant', text: '', taskSources: [task('extra', '没有对应气泡')] }),
    m('single', 5000, { role: 'assistant', text: '单项回复', taskSources: [task('four', '后台工作')] }),
  ]);
  assert.deepEqual([...html.matchAll(/<p class="message-task-title">([^<]+)<\/p><div class="assistant-message-bubble">/g)].map(match => match[1]), ['隔离 Chrome 排查、检查附件来源、检查附件来源', '后台工作']);
  assert.doesNotMatch(html, /重复来源|没有对应气泡|任务来源|事项 ·/);
  assert.match(html, /保留原正文[\s\S]*aria-label="复制"[\s\S]*aria-label="引用"/);
});

test('a reply also names its immutable delegation events when taskSources are absent', () => {
  calls.length = 0;
  const event = (eventKey: string, taskId: string | null, title: string) => ({ id: eventKey, kind: 'workerEvent', eventKey, event: { eventKind: 'delegated', bodySource: 'description', taskId, title, body: '合成交办详情' } });
  const process = { sourceKind: 'user', items: [event('first', 'task-one', '核对合成版本'), event('repeated', 'task-one', '重复交办'), event('second', 'task-two', '核对合成界面')] };
  const html = renderConversation([
    m('delegation', 1000, { role: 'assistant', text: '合成回复正文', process }),
    m('without-answer', 2000, { role: 'assistant', text: '', process }),
  ]);
  assert.match(html, /<p class="message-task-title">核对合成版本、核对合成界面<\/p><div class="assistant-message-bubble">/);
  assert.doesNotMatch(html, /重复交办/);
  const rendered = calls.filter(([name]) => name === 'process').map(([, props]) => props);
  assert.deepEqual([...rendered[0].titledEvents], ['first', 'repeated', 'second']);
  assert.equal(rendered[1].titledEvents.size, 0, 'a standalone event retains its own visible entry');
});

test('production wrappers integrate installed runtime and retain rich slots with semantic keyboard-readable times', () => {
  calls.length = 0;
  const source = [
    m('u', '2025-01-01T10:00:00Z', { quotes: [{ messageId:'a',text: '引用', annotation: '批注' }], media: [{ filename: '合成附件' }] }),
    m('a', '2025-01-01T10:01:00Z', { role: 'assistant', text: '公开正文', process: { sourceKind: 'user', status: 'completed',items:[] }, notes: [{ id: 'old-question' }] }),
    m('hidden', '2030-01-01T00:00:00Z', { role: 'assistant', status: 'queued', text: '' }),
    m('worker-record', '2031-01-01T00:00:00Z', { role: 'assistant', process: { sourceKind: 'worker', status: 'completed' } }),
    m('publication', '2025-01-02T10:00:00Z', { role: 'assistant', text: '唯一正式答复' }),
  ];
  const html = renderConversation(source);
  assert.equal((html.match(/class="message-day-separator"/g) ?? []).length, 2);
  assert.equal((html.match(/class="message-timestamp"/g) ?? []).length, 3);
  for (const id of ['u', 'a', 'worker-record', 'publication']) assert.ok(html.includes('data-conversation-message="' + id + '"'));
  assert.ok(!html.includes('data-conversation-message="hidden"'));
  for (const value of ['引用', '批注', '附件', 'Working/Worked', '公开正文', '成果', '失效待答记录', '唯一正式答复']) assert.ok(html.includes(value), value);
  assert.match(html, /<time class="message-timestamp" tabindex="0" dateTime="2025-01-01T10:00:00.000Z" title="[^"]+" aria-label="消息时间：[^"]+">[^<]+<\/time>/);
  const assistant=source.find(row=>row.id==='a');assert.ok(assistant&&'process' in assistant);
  assert.equal(calls.find(c => c[0] === 'process' && c[1].node === assistant.process)?.[1].node, assistant.process);
  assert.equal(calls.find(c => c[0] === 'files')?.[1].files[0], files[0]);
  assert.equal(calls.find(c => c[0] === 'details')?.[1].message, source[0]);
  const streamed = renderConversation(source.map(row => row.id === 'a' ? { ...row, text: '公开正文更新' } : row));
  assert.deepEqual([...html.matchAll(/data-conversation-message="([^"]+)"/g)].map(m => m[1]), [...streamed.matchAll(/data-conversation-message="([^"]+)"/g)].map(m => m[1]));
  assert.equal((streamed.match(/class="message-day-separator"/g) ?? []).length, 2);
});

test('text actions own the only time, while empty, tool-only and invalid messages retain their fallback rules', () => {
  const html = renderConversation([
    m('text-user', 1000), m('text-assistant', 2000, { role: 'assistant' }),
    m('empty-user', 3000, { text: '', media: [{ filename: '附件' }] }),
    m('tool-only', 4000, { role: 'assistant', text: '', process: { sourceKind: 'user', status: 'completed',items:[] } }),
    m('bad', undefined, { role: 'assistant' }),
  ]);
  const rows = html.split(/<div(?= [^>]*data-conversation-message=)/).slice(1);
  assert.equal(rows.length, 5);
  for (const [i, row] of rows.entries()) {
    assert.equal((row.match(/class="message-timestamp"/g) ?? []).length, i === 4 ? 0 : 1);
    if (i < 2) assert.match(row.match(/<div data-slot="message-actions"[\s\S]*?<\/div>/)?.[0] ?? '', /aria-label="复制"[\s\S]*aria-label="引用"[\s\S]*<time class="message-timestamp"/);
    else if (i < 4) { assert.ok(!row.includes('data-slot="message-actions"')); assert.match(row, /<time class="message-timestamp"/); }
  }
  const plain = renderToStaticMarkup(h(timestampExports.MessageTimestamps, { messages: [m('plain', 5000)] }, h(detailsExports.MessageDetails, { message: m('plain', 5000) })));
  assert.match(plain, /aria-label="复制"[\s\S]*<time class="message-timestamp"/);
  assert.equal((plain.match(/class="message-timestamp"/g) ?? []).length, 1);
});

test('React reconciliation retains message, date and time DOM nodes across text deltas and appends', async () => withDom(async (d: any) => {
  // This helper has no layout, hit testing or native input: it proves identity only.
  const create = d.doc.createElement;
  d.doc.createElement = (name: string) => {
    const node = create(name);
    node.matches = (selector: string) => { assert.equal(selector, ':hover'); return false; };
    return node;
  };
  const source = [m('u', '2025-01-01T10:00:00Z'), m('a', '2025-01-01T10:01:00Z', { role: 'assistant', text: '第一部分' })];
  await d.render(h(ConversationHarness, { source }));
  const row = d.find((n: any) => n.attrs['data-conversation-message'] === 'a');
  const date = d.find((n: any) => n.attrs.class === 'message-day-separator');
  const time = d.find((n: any) => n.attrs.class === 'message-timestamp' && row.contains(n));
  assert.ok(row && date && time);
  for (const text of ['第一部分，继续', '第一部分，继续完成']) {
    await d.render(h(ConversationHarness, { source: [source[0], { ...source[1], text }] }));
    assert.equal(d.find((n: any) => n.attrs['data-conversation-message'] === 'a'), row);
    assert.equal(d.find((n: any) => n.attrs.class === 'message-day-separator'), date);
    assert.equal(d.find((n: any) => n.attrs.class === 'message-timestamp' && row.contains(n)), time);
    assert.ok(row.textContent.includes(text));
  }
  await d.render(h(ConversationHarness, { source: [...source, m('next', '2025-01-02T10:00:00Z')] }));
  assert.equal(d.find((n: any) => n.attrs['data-conversation-message'] === 'a'), row);
  assert.equal(d.all().filter((n: any) => n.attrs.class === 'message-day-separator').length, 2);
  // Exercise the real action handlers and runtime with a fake OS clipboard.
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied.push(text); } } } });
  d.doc.defaultView.getSelection = () => null;
  try {
    const action = (label: string) => d.find((n: any) => n.attrs['aria-label'] === label && row.contains(n));
    await d.click(action('复制'));
    assert.deepEqual(copied, ['第一部分']);
    await d.click(action('引用'));
    assert.deepEqual(quotedActions.at(-1), { messageId: 'a', text: '第一部分' });
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}).catch((error: any) => { if (error.errors) console.error(error.errors); throw error; }));

test('production CSS exposes time on row hover, keyboard focus and touch while retaining a focusable time', () => {
  const css = readFileSync(new URL('../ui/message-timestamps.css', import.meta.url), 'utf8');
  assert.match(css, /\.message:hover \.message-timestamp,\.message:focus-within \.message-timestamp\{opacity:1\}/);
  assert.match(css, /@media\(hover:none\),\(pointer:coarse\)\{\.message-timestamp\{opacity:1\}/);
  assert.doesNotMatch(css, /display:none|position:absolute/);
  const source = readFileSync(new URL('../ui/homer-app.tsx', import.meta.url), 'utf8');
  assert.match(source, /<MessageTimestamps messages=\{state.messages\}><ThreadPrimitive.Messages components=\{\{ UserMessage, AssistantMessage \}\}/);
});
