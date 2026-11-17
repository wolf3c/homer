import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ConversationHistory,conversationInput} from '../src/web-history.js';
import {sourceQuote} from '../src/message-quote.js';
import {messageLinks} from '../src/message-links.js';
test('full long quote survives conversion, source validation, persistence and reload; annotation contract stays',()=>{
 const db=new DatabaseSync(':memory:');try{
 const history=new ConversationHistory(db),text='a'.repeat(60000)+'尾部';
 const id=history.add('test',text),selected=sourceQuote([{id:'part',text,revision:1}]);assert.equal(selected.text,text);
 const input={requestId:'long',text:'解释',quotes:[{messageId:id,text:selected.text,annotation:'批注'}]};
 assert.ok(Buffer.byteLength(JSON.stringify(input))<96*1024);
 history.accept('test',input);assert.equal(new ConversationHistory(db).list('test').find(x=>x.role==='user')?.quotes?.[0]?.text,text);
 assert.throws(()=>conversationInput({...input,quotes:[{...input.quotes[0]!,annotation:'a'.repeat(16001)}]}),/invalid_quote/);
 assert.throws(()=>history.accept('test',{...input,requestId:'forged',quotes:[{...input.quotes[0]!,text:text+'假'}]}),/quote_source_mismatch/);
 }finally{db.close();}
});
test('source extraction keeps over thirty links, complete titles and non-http destinations without duplicate rows',()=>{
 const title='完整标题'.repeat(60),md=Array.from({length:35},(_,i)=>`[${i===0?title:i}](https://example.com/${i})`).join('\n')+'\n[邮件](mailto:test@example.com) [相对](./report) [重复](./report)';
 const links=messageLinks(md);assert.equal(links.length,37);assert.equal(links[0]!.title,title);assert.equal(links.at(-2)!.url,'mailto:test@example.com');assert.equal(links.at(-1)!.url,'./report');
});
test('desktop external handler keeps confirmation and connects Markdown link schemes without launching an app',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../packaging/electron/main.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function external(raw)'),source.indexOf('function createWindow()',source.indexOf('async function external(raw)')));
 const opened:string[]=[],dialogs:string[]=[];
 const external=Function('dialog','window','shell',fn+';return external;')({showMessageBox:async(_value:unknown,options:{detail:string})=>{dialogs.push(options.detail);return {response:1};}},null,{openExternal:async(url:string)=>opened.push(url)});
 for(const url of ['https://example.com','mailto:test@example.com','irc://example.com','xmpp:test@example.com','tel:+12025550123'])await external(url);
 assert.equal(opened.length,5);assert.deepEqual(dialogs,opened);
 await external('javascript:alert(1)');assert.equal(opened.length,5);
});
