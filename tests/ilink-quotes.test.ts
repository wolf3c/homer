import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {WechatQuotes,partialQuote} from '../src/channels/wechat-quotes.js';
test('ILINK-REF-01 partial quotes use occurrence indexes, UTF-16 boundaries and UTF-8 MD5',()=>{
 const text='甲😀乙 / 甲😀丙 / 丁',expected='甲😀丙';
 assert.equal(partialQuote(text,{start:'甲',end:'丙',startindex:1,endindex:0,quotemd5:createHash('md5').update(expected).digest('hex')}),expected);
 assert.equal(partialQuote(text,{start:'甲',end:'丙',startindex:1,endindex:0,quotemd5:'bad'}),undefined);
});
test('ILINK-REF-02 ID/media quote cache is binding scoped, encrypted, bounded and expires',()=>{
 const db=new DatabaseSync(':memory:'),q=new WechatQuotes(db),key='ab'.repeat(32);try{
  q.remember('binding-a','owner','9007199254740993',[{type:1,text_item:{text:'unique-private-text'}},{type:2,image_item:{media:{encrypt_query_param:'secret'}}}],key);
  assert.equal(q.find('binding-b','owner','9007199254740993',key),undefined);
  assert.equal(q.find('binding-a','owner','9007199254740993',key)!.length,2);
  const value=q.resolve('binding-a','owner',{svr_id:'9007199254740993'},key);assert.match(value.text,/unique-private-text/);assert.equal(value.media[0]!.type,2);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM wechat_quote_sources').all()).includes('unique-private-text'));
  assert.equal(q.find('binding-a','owner','9007199254740993',key,Date.now()+8*86400000),undefined);
  assert.match(q.resolve('binding-a','owner',{svr_id:'missing',title:'invented'},key).text,/来源暂不可恢复/);
 }finally{db.close();}
});
