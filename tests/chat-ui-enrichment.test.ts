import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ConversationHistory } from '../src/web-history.js';
import { messageLinks } from '../src/message-links.js';
import { projectQuestions } from '../src/question-schema.js';
import { createWebServer, fetch } from './web-connected-fixture.js';
import type { WebBridge } from '../src/web-contract.js';

test('links are actual markdown links, deduplicated and never extracted from code or unsafe URLs', () => {
  const links=messageLinks('[Docs](https://example.com/docs) [same](https://example.com/docs) `https://code.invalid`\n\n```md\n[hidden](https://code.invalid)\n```\n\n[bad](javascript:alert) [secret](https://user:password@example.com) [ref][one]\n\n[one]: https://example.org/reference');
  assert.deepEqual(links.map(x=>[x.title,x.url,x.kind]),[['Docs','https://example.com/docs','reply-link'],['ref','https://example.org/reference','reply-link']]);
});

test('tool results and feedback survive ownership changes, isolate threads, and reconcile interrupted tools', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const history=new ConversationHistory(db), receipt=history.accept('thread-a',{requestId:'q',text:'Question'});
    history.append(receipt.replyId,'See [docs](https://example.com)');
    history.tool(receipt.replyId,{id:'a',label:'检查资料',phase:'start'});
    history.tool(receipt.replyId,{id:'b',label:'核对成果',phase:'start'});
    history.tool(receipt.replyId,{id:'a',label:'检查资料',phase:'end',status:'completed'});
    assert.throws(()=>history.feedback('thread-b',receipt.replyId,'up'),/feedback_message_not_found/);
    assert.throws(()=>history.feedback('thread-a',receipt.replyId,'other'),/invalid_feedback/);
    history.feedback('thread-a',receipt.replyId,'up');
    const next=new ConversationHistory(db);next.reconcile();
    const reply=next.list('thread-a')[1]!;
    assert.equal(reply.feedback,'up');assert.equal(reply.sources?.[0]?.url,'https://example.com/');
    assert.deepEqual(reply.toolActivities?.map(x=>x.status),['completed','blocked']);
    next.feedback('thread-a',receipt.replyId,null);assert.equal(next.list('thread-a')[1]?.feedback,null);
  } finally { db.close(); }
});

test('native question wrapper projects only whitelisted choices and rejects ambiguous duplicate choices', () => {
  const q={id:'format',question:'Format?',options:[{label:'PDF'}]};
  assert.equal(projectQuestions('question',{method:'item/tool/requestUserInput',params:{questions:[q]}})?.[0]?.options[0]?.label,'PDF');
  assert.equal(projectQuestions('question',{questions:[{...q,options:[{label:'PDF'},{label:'PDF'}]}]}),undefined);
});

test('feedback route requires authenticated same-origin mutation, validates and forwards an explicit null', async () => {
  let value:unknown;
  const bridge:WebBridge={state:async()=>({threadId:'t',messages:[],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}}),submit:async()=>{},stop:async()=>{},respond:async()=>{},artifact:async()=>{throw Error('not_found');},feedback:async(id,rating)=>{value={id,rating};return value;}};
  const web=await createWebServer({bridge,port:0});
  try {
    const post=(payload:unknown,origin?:string)=>fetch(web.url+'/api/messages/feedback',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(payload)});
    assert.equal((await post({messageId:'m',value:'up'})).status,403);
    assert.equal((await post({messageId:'m',value:'forged'},web.url)).status,409);
    assert.equal((await post({messageId:'m',value:null},web.url)).status,200);
    assert.deepEqual(value,{id:'m',rating:null});
  } finally { await web.close(); }
});
