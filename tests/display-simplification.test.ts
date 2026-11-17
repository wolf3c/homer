import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messageLinks} from '../src/message-links.js';
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
