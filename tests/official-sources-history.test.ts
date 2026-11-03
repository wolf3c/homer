import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {messageLinks} from '../src/message-links.js';
import {ConversationHistory} from '../src/web-history.js';

// These two existing enrichment contracts were previously checked from an
// untracked fixture. Keep the relevant contracts reproducible in this commit.
test('reply links preserve first-seen identity/order and exclude code, unsafe schemes and credentials',()=>{
 const links=messageLinks('[Docs](https://example.com/docs) [same](https://example.com/docs) `https://code.invalid`\n\n```md\n[hidden](https://code.invalid)\n```\n\n[bad](javascript:alert) [secret](https://user:password@example.com) [ref][one]\n\n[one]: https://example.org/reference');
 assert.deepEqual(links.map(x=>[x.id,x.title,x.url,x.kind]),[
  ['link-1','Docs','https://example.com/docs','reply-link'],
  ['link-2','ref','https://example.org/reference','reply-link'],
 ]);
});

test('legacy tool identity/order and returned/interrupted facts survive history recovery without cross-thread exposure',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const history=new ConversationHistory(db),receipt=history.accept('thread-a',{requestId:'q',text:'Synthetic question'});
  history.append(receipt.replyId,'See [docs](https://example.com)');
  history.tool(receipt.replyId,{id:'a',label:'同名检查',phase:'start'});
  history.tool(receipt.replyId,{id:'b',label:'同名检查',phase:'start'});
  history.tool(receipt.replyId,{id:'a',label:'同名检查',phase:'end',status:'completed'});
  const next=new ConversationHistory(db);next.reconcile();
  const reply=next.list('thread-a')[1]!;
  assert.equal(reply.sources?.[0]?.url,'https://example.com/');
  assert.deepEqual(reply.toolActivities?.map(x=>[x.id,x.label,x.status]),[['a','同名检查','completed'],['b','同名检查','blocked']]);
  assert.deepEqual(next.list('thread-b'),[]);
 }finally{db.close();}
});
