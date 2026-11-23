import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {actualClick} from './helpers/html-preview-browser.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const webDir=resolve(process.env.HOMER_COMPONENT_BUILD);
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE);
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
const paragraphs=['Start **formatted** 🙂 text.',...Array.from({length:45},(_,i)=>'Selected paragraph '+i+'.')];
const message=(id,text)=>({id,role:'assistant',text,status:'completed',threadId:'composer-review',createdAt:1700000000000});
fixture.reset({messages:[message('before','Before the selection.'),message('long',paragraphs.join('\n\n')),message('tail','After the selection.\n\n'.repeat(30))],features:{draftUpload:true,previewReferenceCollections:2}});
let chrome;
const tool='[data-slot="selection-toolbar-quote"]';
try{
 chrome=await isolatedChrome(destination,{mockKeychain:true});
 for(const width of [1440,390,320]){
  const page=await chrome.page(fixture.url,width);
  const wait=predicate=>page.until('Boolean(('+String(predicate)+')())',6000);
  const settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(done)))));
  const select=async(kind,backward=false)=>page.evaluate(`(()=>{
   const bubble=document.querySelector('#message-long .assistant-message-bubble'),p=bubble.querySelectorAll('.markdown p'),s=getSelection();
   const start=(${JSON.stringify(kind)}==='short'?p[8]:p[0]).firstChild;
   const last=p[p.length-1].lastChild,time=bubble.querySelector('time').firstChild;
   const end=${JSON.stringify(kind)}==='boundary'||${JSON.stringify(kind)}==='outside'?time:${JSON.stringify(kind)}==='short'?start:last;
   const offset=${JSON.stringify(kind)}==='boundary'?0:${JSON.stringify(kind)}==='outside'?2:end.length;
   if(${backward})s.setBaseAndExtent(end,offset,start,0);else s.setBaseAndExtent(start,0,end,offset);
   return s.toString().trim();
  })()`);
  const center=i=>page.evaluate('document.querySelectorAll("#message-long .markdown p")['+i+'].scrollIntoView({block:"center"})');
  const click=async selector=>actualClick(page,await page.evaluate('document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect().toJSON()'));
  const wheel=async deltaY=>{await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:420,deltaX:0,deltaY});await new Promise(done=>setTimeout(done,160));await settle();};
  try{
   await page.navigate();
   await wait(()=>document.querySelectorAll('#message-long .markdown p').length===46);
   await center(8);await settle();
   const short=await select('short');await wait(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]'));
   if(width===1440){
    const calls=await page.evaluate(async()=>{
     const getRects=Range.prototype.getClientRects,selectionText=Selection.prototype.toString;
     let geometry=0,extract=0;
     Range.prototype.getClientRects=function(){geometry++;return getRects.call(this);};
     Selection.prototype.toString=function(){extract++;return selectionText.call(this);};
     try{
      const viewport=document.querySelector('.thread-viewport');
      for(let i=0;i<40;i++)viewport.dispatchEvent(new Event('scroll'));
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      return {geometry,extract};
     }finally{
      Range.prototype.getClientRects=getRects;
      Selection.prototype.toString=selectionText;
     }
    });
    assert.deepEqual(calls,{geometry:1,extract:0},'scroll burst coalesces geometry without reading excerpt text');
    console.log('40 scroll events: one geometry read, no excerpt extraction');
   }
   const before=await page.evaluate(()=>document.querySelector('.thread-viewport').scrollTop);
   await wheel(28);
   assert.ok(await page.evaluate(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]')),'small scroll preserves the active quote action');
   assert.notEqual(await page.evaluate(()=>document.querySelector('.thread-viewport').scrollTop),before);
   await wheel(-28);
   assert.equal(await page.evaluate(()=>getSelection().toString()),short);
   assert.ok(await page.evaluate(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]')));
   const complete=await select('complete');
   const boundary=await select('boundary',true);
   assert.equal(complete,boundary);
   await center(23);await settle();
   await wait(()=>{const b=document.querySelector('[data-slot="selection-toolbar-quote"]')?.getBoundingClientRect(),v=document.querySelector('.thread-viewport').getBoundingClientRect();return b&&b.top>=v.top-1&&b.bottom<=v.bottom+1;});
   await page.evaluate(()=>document.querySelector('#message-tail').scrollIntoView({block:'end'}));await settle();
   assert.equal(await page.evaluate(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]')),false);
   await center(23);await settle();
   await wait(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]'));
   await click(tool);
   await wait(()=>!!document.querySelector('.message-quote-editor textarea:focus'));
   assert.ok(await page.evaluate(()=>{const b=document.querySelector('.message-quote-editor textarea').getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;}));
   const excerpt=await page.evaluate(()=>document.querySelector('.message-quote-editor blockquote').textContent);
   assert.equal(excerpt,paragraphs.join('\n').replaceAll('**',''));
   await page.command('Input.insertText',{text:'合成批注'});
   await page.screenshot('quote-cross-screen-'+width+'.png');
   await page.evaluate(()=>document.querySelector('#message-tail').scrollIntoView({block:'end'}));await settle();
   assert.equal(await page.evaluate(()=>document.querySelector('.message-quote-editor textarea').value),'合成批注');
   assert.ok(await page.evaluate(()=>{const r=document.querySelector('.message-quote-editor textarea').getBoundingClientRect();return r.top>innerHeight/2&&r.bottom<=innerHeight;}));
   await center(23);await settle();
   await click('.message-quote-editor button[type="submit"]');
   await wait(()=>!!document.querySelector('.annotation-chip-open')&&document.activeElement.matches('.aui-lexical-input'));
   await select('complete');await settle();
   await page.evaluate(()=>document.querySelector('[data-slot="selection-toolbar-quote"]').focus({preventScroll:true}));
   const activation=width===320?{key:' ',code:'Space',windowsVirtualKeyCode:32}:{key:'Enter',code:'Enter',windowsVirtualKeyCode:13};
   await page.command('Input.dispatchKeyEvent',{type:'keyDown',...activation,text:width===320?' ':'\r'});
   await page.command('Input.dispatchKeyEvent',{type:'keyUp',...activation});
   await wait(()=>!!document.querySelector('.message-quote-editor textarea:focus'));
   assert.equal(await page.evaluate(()=>document.querySelector('.message-quote-editor blockquote').textContent),excerpt);
   await click('.message-quote-editor button[type="button"]');
   await wait(()=>!document.querySelector('.message-quote-editor textarea'));
   if(width===390){
    await page.command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await center(8);await settle();await select('short');await settle();
    const r=await page.evaluate(()=>document.querySelector('[data-slot="selection-toolbar-quote"]').getBoundingClientRect().toJSON());
    await page.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
    await page.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await wait(()=>!!document.querySelector('.message-quote-editor textarea:focus'));
    await page.command('Emulation.setTouchEmulationEnabled',{enabled:false});
    await click('.message-quote-editor button[type="button"]');
    await wait(()=>!document.querySelector('.message-quote-editor textarea'));
    await center(23);await settle();
   }
   if(width===1440){
    await center(8);await settle();
    const [start,end]=await page.evaluate(()=>{
     const node=document.querySelectorAll('#message-long .markdown p')[8].firstChild;
     return [2,node.length-2].map(offset=>{
      const range=new Range();range.setStart(node,offset);range.setEnd(node,offset+1);
      const rect=range.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
     });
    });
    await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
    await page.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...start});
    await page.command('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...end});
    await settle();
    assert.equal(await page.evaluate(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]')),false);
    await page.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...end});
    await wait(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]')&&/paragraph/.test(getSelection().toString()));
    await center(23);await settle();
   }
   await select('outside');await settle();
   assert.equal(await page.evaluate(()=>!!document.querySelector('[data-slot="selection-toolbar-quote"]')),false);
   assert.match(await page.evaluate(()=>document.querySelector('.draft-notice')?.textContent),/同一条消息的正文/);
   await select('complete');await settle();
   await page.evaluate(()=>{document.querySelectorAll('#message-long .markdown p')[22].firstChild.data='Changed after selection.';});
   await wheel(28);
   await click(tool);
   await wait(()=>document.querySelector('.draft-notice')?.textContent.includes('选区已变化'));
   assert.equal(await page.evaluate(()=>!!document.querySelector('.message-quote-editor textarea')),false);
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
   assert.equal(fixture.received.messages.length,0);
   if(width===320){
    await click('[aria-label="发送消息"]');
    await page.until('!document.querySelector(".annotation-chip-open")',6000);
    for(let attempt=0;attempt<100&&!fixture.received.messages.length;attempt++)await new Promise(done=>setTimeout(done,20));
    assert.equal(fixture.received.messages.length,1);
    const [sent]=fixture.received.messages;
    assert.equal(sent.quotes[0].messageId,'long');
    assert.equal(sent.quotes[0].text,excerpt);
    assert.equal(sent.quotes[0].annotation,'合成批注');
   }
  }catch(error){console.error(page.errors);await page.screenshot('quote-failure-'+width+'.png');throw error;}finally{await page.close();}
 }
 console.log('Quote selection browser checks passed at 1440, 390 and 320 pixels');
}finally{
 const exit=await chrome?.close();
 await fixture.close();
 if(exit)assert.deepEqual([exit.code,exit.forced,exit.watchdog],[0,false,false]);
}
