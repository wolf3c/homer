import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {messageQuoteText,previewQuoteText} from '../src/message-quote.js';
import {ConversationHistory} from '../src/web-history.js';

test('whole-message quotes contain visible Markdown text without link destinations or image metadata',()=>{
 const markdown='# 合成标题\n\n**核对** [资料](https://example.com/private) 和 `x = 1`。\n\n![图片说明](https://example.com/image.png)\n\n[隐藏定义]: https://example.com/hidden\n\n```ts\nconst ready = true;\n```';
 const text=messageQuoteText(markdown);
 assert.match(text,/合成标题/);assert.match(text,/核对 资料 和 x = 1/);assert.match(text,/const ready = true;/);
 assert.doesNotMatch(text,/https:|图片说明|隐藏定义|\*\*/);
});

test('preview quotes use canonical TeX while keeping code literal and destinations hidden',()=>{
 const markdown='Cost is $$x_i^2$$ today.\n\n$$\n\\frac{a_b}{c_d}\n$$\n\n`$$literal$$` [Source](https://example.com/hidden)';
 const text=previewQuoteText(markdown);
 assert.match(text,/Cost is \$x_i\^2\$ today\./);
 assert.ok(text.includes('$$\n\\frac{a_b}{c_d}\n$$'));
 assert.ok(text.includes('$$literal$$ Source'));
 assert.doesNotMatch(text,/https:|hidden/);
 assert.ok(messageQuoteText(markdown).includes('$$x_i^2$$')); // Legacy quote semantics stay unchanged.
});

test('whole-message quotes including tables pass the existing exact-source check and keep message identity',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const history=new ConversationHistory(db),markdown='**合成记录** [资料](https://example.com)\n\n| 项目 | 状态 |\n| --- | --- |\n| 核对 | 完成 |';
  const id=history.add('synthetic-thread',markdown),text=messageQuoteText(markdown);
  assert.match(text,/项目\t状态/);
  history.accept('synthetic-thread',{requestId:'synthetic-quote',text:'请解释',quote:{messageId:id,text}});
  assert.throws(()=>history.accept('other-thread',{requestId:'wrong-source',text:'请解释',quote:{messageId:id,text}}),/quote_source_mismatch/);
  assert.throws(()=>history.accept('synthetic-thread',{requestId:'hidden-url',text:'请解释',quote:{messageId:id,text:'https://example.com'}}),/quote_source_mismatch/);
 }finally{db.close();}
});
