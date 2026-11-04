// Approved conversation/process kerning change: real Chrome, fake engine, memory DB.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {toString} from 'mdast-util-to-string';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome,probeScript} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-kerning');
const red=process.argv.includes('--scope-only'),rows=[];
const processOnly=process.argv.includes('--process-completeness');
const sampleFile=processOnly?'process-full-text-verification.json':'approved-kerning-browser-samples.json';
mkdirSync(destination,{recursive:true});
const sha=text=>createHash('sha256').update(text).digest('hex');
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const end='\n\nEND_OF_COMPLETE_SYNTHETIC_MARKDOWN\n';
const paragraph='中文段落保留完整正文、原有排版与输入。English paragraphs preserve complete Markdown and readable words. AV To WA Typography and ordinary streaming stay unchanged. ';
const block='## 中英文 AV To\n\n'+paragraph.repeat(60)+'\n\n- 第一项 **完整内容**\n- Second item `inline code`\n\n| 名称 | Value |\n| --- | --- |\n| 中文 | AV To |\n\n```javascript\nconst complete = "AV To 中文";\nconsole.log(complete);\n```\n\n公式 $E=mc^2$。\n\n';
function corpus(kind,bytes){
 if(kind==='continuous-x')return 'x'.repeat(bytes);
 const room=bytes-Buffer.byteLength(end),count=Math.floor(room/Buffer.byteLength(block));
 return block.repeat(count)+'z'.repeat(room-count*Buffer.byteLength(block))+end;
}
async function inputSamples(page,count){
 await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());
 const result=[];
 for(let n=0;n<count;n++){
  await page.evaluate(()=>window.__typingStarted=performance.now());
  await page.command('Input.insertText',{text:n%2?'中':'A'});
  result.push(await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>done(performance.now()-window.__typingStarted)))));
 }
 return result;
}
const chrome=await isolatedChrome(destination);
try{
 // A durable scope contract. No style injection is used in this test.
 const f=await fixture(40,'after'),page=await chrome.page(f.server.url);
 try{
  await page.navigate();await page.until(()=>document.querySelectorAll('[data-conversation-message]').length===80);
  const scope=await page.evaluate(()=>{
   const message=document.querySelector('.messages .markdown'),canvas=document.createElement('div');
   canvas.className='markdown canvas-markdown';canvas.textContent='AV To 中文';document.body.append(canvas);
   const style=e=>({kerning:getComputedStyle(e).fontKerning,font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize});
   const value={conversation:style(message),canvas:style(canvas),composer:style(document.querySelector('[contenteditable=true]'))};canvas.remove();return value;
  });
  writeFileSync(join(destination,red?'scope-red.json':'scope-green.json'),JSON.stringify(scope,null,2));
  assert.equal(scope.conversation.kerning,'none');assert.equal(scope.canvas.kerning,'auto');assert.equal(scope.composer.kerning,'auto');
 }finally{await page.close();await f.close();}
 if(!red){
  for(const total of processOnly?[]:[1000,10000]){
   const f=await fixture(total,'after',false,true),page=await chrome.page(f.server.url);
   try{await page.command('Page.addScriptToEvaluateOnNewDocument',{source:probeScript});await page.navigate();await page.until(()=>document.querySelectorAll('[data-conversation-message]').length===80);await delay(200);
    const inputMs=await inputSamples(page,30);rows.push({scenario:'ordinary',total,inputMs,probe:await page.evaluate(()=>window.__historyProbe),dom:await page.evaluate(()=>document.querySelectorAll('*').length),errors:page.errors,submits:f.submitted.length});
    assert.deepEqual(page.errors,[]);assert.equal(f.submitted.length,0);
   }finally{await page.close();await f.close();}
  }
  for(const bytes of [65536,1048576])for(const content of ['continuous-x','mixed-markdown'])for(const kind of ['body','worked','working']){
   if(processOnly&&(content!=='mixed-markdown'||kind==='body'))continue;
   const text=corpus(content,bytes),f=await fixture(40,'after'),node=f.processes.exact('node-39');assert.equal(Buffer.byteLength(text),bytes);
   if(kind==='body'){f.store.db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run(text,'node-39');node.final={id:'giant-final',text};node.items=[{id:'giant-final',kind:'commentary',phase:'final_answer',seq:1,revision:1,text}];}
   else{node.items=[{id:'giant-detail',kind:'commentary',phase:'commentary',seq:1,revision:1,text}];if(kind==='working'){node.state='working';node.status='running';delete node.endEventId;}}
   f.store.setMeta('publicMainNode:v1:node-39',JSON.stringify({...node,completedItemIds:[],itemPhases:{}}));
   const page=await chrome.page(f.server.url);
   try{
    await page.command('Page.addScriptToEvaluateOnNewDocument',{source:probeScript+`;window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)},configurable:true});`});
    for(let sample=0;sample<(processOnly?1:4);sample++){
     const previousOrigin=await page.evaluate(()=>performance.timeOrigin);
     await page.navigate();await page.until('performance.timeOrigin!=='+previousOrigin);
     await page.until(()=>document.querySelectorAll('[data-conversation-message]').length===80&&!!window.__historyProbe?.inputMs);
     const initial=await page.evaluate(()=>structuredClone(window.__historyProbe));
     let expandMs=null;
     if(kind!=='body'){
      assert.equal(await page.evaluate(()=>!!document.querySelector('#message-node-39 [data-slot=collapsible-content]')),false);
      await page.evaluate(()=>{window.__expandStarted=performance.now();document.querySelector('#message-node-39 [data-slot=collapsible-trigger]').click();});
     }
     if(kind!=='body')await page.until(()=>!!document.querySelector('#message-node-39 [data-slot=collapsible-content] .markdown'));
     if(kind==='worked')expandMs=await page.evaluate(()=>performance.now()-window.__expandStarted);
     const rendered=await page.evaluate(()=>{const root=document.querySelector('#message-node-39'),markdown=root.querySelectorAll('.markdown');return {text:[...markdown].map(e=>e.textContent).join('\n'),tables:root.querySelectorAll('table').length,codes:root.querySelectorAll('pre code').length,math:root.querySelectorAll('.katex').length,kerning:[...markdown].map(e=>getComputedStyle(e).fontKerning),working:root.querySelector('[data-slot=collapsible-trigger]')?.textContent};});
     if(content==='continuous-x')assert.ok(rendered.text.includes(text));else{assert.ok(rendered.text.includes('END_OF_COMPLETE_SYNTHETIC_MARKDOWN'));assert.ok(rendered.text.includes('中文段落保留完整正文'));assert.ok(rendered.tables>0);assert.ok(rendered.codes>0);if(kind==='body')assert.ok(rendered.math>0);}
     let processText=null;
     if(kind!=='body'){
      const actual=await page.evaluate(()=>document.querySelector('#message-node-39 [data-slot=collapsible-content] .markdown').textContent);
      const expected=toString(unified().use(remarkParse).use(remarkGfm).parse(text));
      const normalize=value=>value.replace(/\s/g,'');
      assert.equal(normalize(actual),normalize(expected));
      processText={expectedSha256:sha(normalize(expected)),domSha256:sha(normalize(actual)),normalization:'remove whitespace only; compare every rendered character to Markdown AST text'};
     }
     assert.ok(rendered.kerning.length>0&&rendered.kerning.every(k=>k==='none'));
     if(kind==='working')assert.equal(await page.evaluate(()=>document.querySelector('#message-node-39 [data-slot=run-activity]').dataset.status),'running');
     let copy=null;
     if(kind==='body'){
      await page.evaluate(()=>document.querySelector('#message-node-39 [aria-label="复制"]').click());await page.until(()=>window.__copied.length===1);
      const copied=await page.evaluate(()=>window.__copied[0]);assert.equal(copied,text);copy={bytes:Buffer.byteLength(copied),sha256:sha(copied),method:'real UI copy click; clipboard.writeText captured, OS clipboard not modified'};
     }
     const inputMs=await inputSamples(page,5);await delay(100);
     rows.push({scenario:'giant',bytes,content,kind,sample,cache:sample===0?'new browser context; OS/build already warm':'same context navigation; OS/build warm',sourceSha256:sha(text),sourceBytes:bytes,renderedCharacters:rendered.text.length,tables:rendered.tables,codes:rendered.codes,math:rendered.math,complete:true,processText,copy,initial,expandMs,inputMs,probe:await page.evaluate(()=>window.__historyProbe),dom:await page.evaluate(()=>document.querySelectorAll('*').length),errors:page.errors,submits:f.submitted.length});
     assert.deepEqual(page.errors,[]);assert.equal(f.submitted.length,0);console.log(JSON.stringify({...rows.at(-1),probe:undefined,initial:undefined,copy:copy?{bytes:copy.bytes}:null}));
     writeFileSync(join(destination,sampleFile),JSON.stringify({browser:chrome.version,seed:20261021,rows},null,2));
    }
   }finally{await page.close();await f.close();}
  }
 }
}finally{await chrome.close();writeFileSync(join(destination,red?'scope-red-run.json':sampleFile),JSON.stringify({browser:chrome.version,seed:20261021,rows},null,2));}
