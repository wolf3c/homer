// Real UI/HTTP/publication owners with synthetic files and an injected Finder dispatcher.
// The dispatcher is deliberately fake here; real Finder smoke is recorded separately.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {syntheticFile} from './recursive-publication-fixture.ts';
import {revealPublishedArtifact} from '../src/artifact-reveal.ts';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve('.codex/scratch/artifact-reveal-in-folder-20261023');
mkdirSync(destination,{recursive:true});
const f=await fixture(20,'after'),checks=[],dispatches=[];
let chrome,fail=false,release,delay=false;
try{
 f.store.startRequest('request-0','synthetic-reveal');
 const result=syntheticFile(f,'request-0','chat-ui-customization-audit.md','# Synthetic preview\n\nOnly isolated files.',[{filename:'另一份合成成果.md',content:'# Second synthetic file'}]);
 const delivery=result.publish('Synthetic reveal acceptance');
 f.history.record(delivery.historyMessageId,'synthetic-history',delivery.text);f.tasks.markDelivery(delivery.id,'recorded');
 f.bridge.revealArtifact=id=>revealPublishedArtifact(f.tasks,id,{platform:'darwin',launch:async(command,args)=>{
  dispatches.push({command,args});
  if(delay){delay=false;await new Promise(done=>{release=done;});}
  if(fail)throw Error('synthetic Finder failure');
 }});
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width);
  try{
   await p.navigate();await p.until(()=>!!document.querySelector('.file-list-open'));
   await p.evaluate(()=>{const el=document.querySelector('button[aria-label="预览 chat-ui-customization-audit.md"]');el.scrollIntoView({block:'center'});el.click();});
   await p.until(()=>!!document.querySelector('#canvas-reveal')&&!!document.querySelector('.canvas-markdown'));
   assert.ok(await p.evaluate(()=>document.querySelector('#canvas-reveal-status').textContent.includes('运行 Homer 的电脑')));
   const before=dispatches.length;fail=true;
   await p.evaluate(()=>document.querySelector('#canvas-reveal').focus());
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
   await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await p.until(()=>document.querySelector('#canvas-reveal-status').getAttribute('role')==='alert');
   assert.equal(dispatches.length,before+1);
   assert.ok(await p.evaluate(()=>document.activeElement.id==='canvas-reveal'&&document.querySelector('.canvas-markdown').textContent.includes('Synthetic preview')));
   await p.screenshot('reveal-failure-'+width+'.png');checks.push('failure retains preview and keyboard focus '+width);
   fail=false;delay=true;
   await p.evaluate(()=>{const b=document.querySelector('#canvas-reveal');b.click();b.click();});
   await p.until(()=>document.querySelector('#canvas-reveal').getAttribute('aria-busy')==='true');
   assert.equal(dispatches.length,before+2);release();
   await p.until(()=>document.querySelector('#canvas-reveal-status').textContent.includes('正式成果文件'));
   assert.equal(dispatches.length,before+2);checks.push('single dispatch while pending, retry and honest published-file receipt '+width);
   const layout=await p.evaluate(()=>{
    const panel=document.querySelector('#canvas-panel'),button=document.querySelector('#canvas-reveal'),r=button.getBoundingClientRect();
    return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,panelWidth:panel.clientWidth,contentWidth:panel.scrollWidth,buttonHeight:r.height,focus:document.activeElement.id,outline:getComputedStyle(button).outlineStyle};
   });
   assert.ok(layout.pageWidth<=width&&layout.contentWidth<=layout.panelWidth+1,JSON.stringify(layout));
   assert.ok(layout.buttonHeight>=44);checks.push({width,layout});
   await p.screenshot('reveal-success-'+width+'.png');
   // A delayed dispatch for A must not overwrite B's fresh device explanation.
   delay=true;await p.evaluate(()=>document.querySelector('#canvas-reveal').click());
   await p.until(()=>document.querySelector('#canvas-reveal').getAttribute('aria-busy')==='true');
   await p.evaluate(()=>{const s=document.querySelector('#canvas-file');s.value=[...s.options].find(o=>o.textContent.includes('另一份合成成果')).value;s.dispatchEvent(new Event('change',{bubbles:true}));});
   await p.until(()=>document.querySelector('.canvas-markdown')?.textContent.includes('Second synthetic file'));release();
   assert.ok(await p.evaluate(()=>document.querySelector('#canvas-reveal-status').textContent.includes('手机上操作')));
   checks.push('late response cannot label another artifact '+width);
   assert.deepEqual(p.errors,[]);
  }catch(error){await p.screenshot('reveal-unexpected-'+width+'.png');throw error;}finally{release?.();await p.close();}
 }
 assert.ok(dispatches.every(({command,args})=>command==='/usr/bin/open'&&args[0]==='-R'&&args.length===2));
 writeFileSync(join(destination,'browser-evidence.json'),JSON.stringify({synthetic:true,realFinder:false,checks,dispatchCount:dispatches.length},null,2));
 console.log(JSON.stringify({passed:checks.length,dispatchCount:dispatches.length}));
}finally{release?.();await chrome?.close();await f.close();}
