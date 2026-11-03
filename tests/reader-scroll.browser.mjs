import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// Real UI and HTTP transport; task-local synthetic owners and no executing engine.
const root=resolve('.'),destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/reader-scroll-browser');
process.env.HOMER_SYNTHETIC_ROOT=destination+'/synthetic';process.env.HISTORY_FOLLOWUP_BUILD=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/reader-scroll-build');
const {fixture}=await import(root+'/tests/web-history-followup-fixture.mjs');
const {messageSourceParts}=await import(root+'/src/message-quote.ts');
const updateSyntheticPublicText=(f,id,text)=>f.store.transaction(()=>{const key='publicMainNode:v1:'+id,node=JSON.parse(f.store.meta(key));node.revision++;node.final={id:'native-final-'+id,text};node.items=[{id:node.final.id,seq:1,revision:node.revision,kind:'commentary',phase:'final_answer',text,completed:true}];node.completedItemIds=[node.final.id];node.itemPhases={[node.final.id]:'final_answer'};f.store.setMeta(key,JSON.stringify(node));f.store.db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run(text,id);});
const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright-core');
await mkdir(destination,{recursive:true});let browser,f;const checks=[],errors=[],writes=[];
try{
 f=await fixture(30,'after');
 // Native user replies render final_answer items, not legacy node.final summaries.
 for(let n=0;n<30;n++)updateSyntheticPublicText(f,'node-'+n,'合成答复 '+n+'。'+'可见合成内容。'.repeat(25));
 const seeded=(await f.bridge.history.state()).messages.find(m=>m.id==='node-29');assert.ok(messageSourceParts(seeded).some(p=>p.text.includes('合成答复 29')));
 const origin=new URL(f.server.url).origin;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1000,height:800}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||!['GET','POST'].includes(request.method())||request.method()==='POST'&&!url.pathname.startsWith('/api/history/')){writes.push(request.method()+' '+url.pathname);return route.abort();}return route.continue();});
 await page.goto(f.server.url,{waitUntil:'domcontentloaded'});const view=page.locator('.thread-viewport'),cue=page.locator('.scroll-latest');await view.waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-conversation-message]').length>10);
 const ok=(value,name)=>{assert.ok(value,name);checks.push(name);};
 const geometry=()=>view.evaluate(e=>({top:e.scrollTop,gap:e.scrollHeight-e.clientHeight-e.scrollTop}));
 await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.disabled);await view.hover();await page.mouse.wheel(0,-700);await page.waitForFunction(()=>{const e=document.querySelector('.thread-viewport');return e.scrollHeight-e.clientHeight-e.scrollTop>100;});
 const before=await geometry();updateSyntheticPublicText(f,'node-29','合成新答复 '+ '新内容。'.repeat(80));f.server.publish();await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.textContent.includes('有新内容'));
 ok(Math.abs((await geometry()).top-before.top)<2,'new public content above bottom preserves manual reading position');ok(await cue.isVisible(),'new content cue is visible above bottom');
 await view.hover();await page.mouse.wheel(0,100000);await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.disabled);ok((await geometry()).gap<=1,'wheel reaches real content bottom');ok(!(await cue.isVisible()),'manual bottom clears the cue without clicking');
 const bottom=await geometry();updateSyntheticPublicText(f,'node-29','合成流式增长 '+ '后续内容。\n'.repeat(120));f.server.publish();await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.textContent.includes('有新内容')&&!document.querySelector('.scroll-latest')?.disabled);
 ok(Math.abs((await geometry()).top-bottom.top)<2,'later stream growth never resumes auto-follow');ok(await cue.isVisible(),'later unread growth lights a new cue');
 await cue.click();await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.disabled);ok((await geometry()).gap<=1,'explicit latest button still jumps once');
 const position=await geometry();await page.locator('[data-conversation-message]').last().evaluate(e=>{const img=document.createElement('img');img.alt='synthetic delayed media';img.style.cssText='display:block;width:60px;height:350px';e.append(img);});
 await page.waitForFunction(top=>{const e=document.querySelector('.thread-viewport');return e.scrollHeight-e.clientHeight-e.scrollTop>100&&Math.abs(e.scrollTop-top)<2;},position.top);ok(true,'controlled late media height growth preserves position');
 await view.hover();await page.mouse.wheel(0,100000);await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.disabled);ok(!(await cue.isVisible()),'bottom after delayed media remains clear');
 await page.setViewportSize({width:390,height:800});await view.hover();await page.mouse.wheel(0,-700);updateSyntheticPublicText(f,'node-29','窄屏内容 '+ '合成文字。\n'.repeat(140));f.server.publish();await page.waitForFunction(()=>!document.querySelector('.scroll-latest')?.disabled);await page.mouse.wheel(0,100000);await page.waitForFunction(()=>document.querySelector('.scroll-latest')?.disabled);ok(!(await cue.isVisible()),'narrow viewport wheel bottom clears cue');
 await page.screenshot({path:destination+'/bottom-390.png'});ok(f.submitted.length===0&&f.stopped.length===0&&f.fakeEngine.invocations===0&&writes.length===0,'no model, user submission, stop or external request');ok(errors.length===0,'no browser runtime errors');
}catch(error){errors.push(String(error.stack??error));process.exitCode=1;}finally{await browser?.close();await f?.close();await writeFile(destination+'/browser-results.json',JSON.stringify({synthetic:true,checks,errors,writes},null,2));console.log(JSON.stringify({checks:checks.length,errors:errors.length}));}
