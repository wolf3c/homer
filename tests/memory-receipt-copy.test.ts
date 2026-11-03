import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';

// Render real host receipts without constructing a DB, engine or channel.
function render(receipts: unknown[], content?: string) {
 const host = Object.create(Homer.prototype) as any;
 host.memory = {read: () => { if (content === undefined) throw Error('memory_not_found'); return {content}; }};
 return host.memoryReceipts(receipts) as string;
}
test('memory save and correction receipts stay concise without removed UI navigation', () => {
 assert.equal(render([{id:'a',state:'active',code:'saved'}], '以后言简意赅。'), '已记住：以后言简意赅。');
 assert.equal(render([{id:'a',state:'active',code:'corrected'}], '以后报告用中文'), '已纠正：以后报告用中文。');
});
test('pending memory is never described as saved', () => {
 const text = render([{id:'a',state:'pending'}], '以后用英文。');
 assert.match(text, /待确认记忆.*尚未生效/);
 assert.doesNotMatch(text, /已记住|右上角/);
});
test('forgotten and unavailable entries never restore historic memory text or removed UI', () => {
 const forgotten = render([{id:'a',state:'forgotten'}]);
 assert.match(forgotten, /已忘记/);
 const historical = render([{id:'a',state:'active'}]);
 assert.match(historical, /当前未生效.*对话中查询/);
 assert.doesNotMatch(forgotten + historical, /右上角/);
});
