// Production message/process owners with synthetic HTTP + in-memory DB only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const baseline=process.env.HOMER_WORKER_CARD_BASELINE==='1';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/worker-card-outside-activity-20261024/browser');
mkdirSync(destination,{recursive:true});
const browser=await isolatedChrome(destination),results=[];
const cardSelector='#message-node-10 [data-worker-event]';
async function key(page,key,code,number){
 await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:number,...(key==='Enter'?{text:'\r'}:{})});
 await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:number});
}
async function workerFixture(){
 const f=await fixture(12,'after');
 const save=(id,patch)=>{const name='publicMainNode:v1:'+id,node=JSON.parse(f.store.meta(name));Object.assign(node,patch,{revision:node.revision+1});f.store.setMeta(name,JSON.stringify(node));};
 for(const n of [10,11]){
  save('node-'+n,{state:'working',status:'running',items:[{id:'progress-'+n,seq:1,revision:1,kind:'commentary',phase:'commentary',text:'已公开进展：核对合成材料。 [公开材料](https://example.invalid/)'},{id:'create-'+n,seq:2,revision:1,kind:'tool',category:'host',label:'创建任务：合成批注测试',status:'completed'}]});
 }
 const event=(eventKey,eventKind,title)=>({eventKey,eventKind,title,body:'原始合成事件正文：核对网页和图片，保留未确认范围。',bodySource:eventKind==='delegated'?'description':eventKind==='result_received'?'summary':'error',taskId:'synthetic-task',version:1,runId:'synthetic-run',resultId:eventKind==='result_received'?'synthetic-result':null,sourceMessageId:null,operationKey:eventKind==='delegated'?'synthetic-operation':null,observedAtMs:1});
 const first=event('outside-delegated','delegated','制作合成批注测试网页和图片');
 f.processes.workerEvent('node-10',first);
 f.processes.workerEvent('node-10',event('outside-failed','start_failed','合成启动失败记录'));
 f.processes.workerEvent('node-11',event('outside-received','result_received','收到合成结果'));
 for(const n of [10,11])save('node-'+n,{state:'worked',status:'completed',startedAtMs:1000,endedAtMs:34000,durationMs:33000,timingSource:'native',timingState:'terminal',final:{id:'native-final-'+n,text:n===10?'已安排制作，完成后核对合成成果。':'已收到合成结果，仍需核对。'}});
 const text='合成预览正文。',file={id:'result-outside-preview',title:'Synthetic.txt',messageId:'node-10',workTitle:'合成预览'};
 const read=f.bridge.artifact.bind(f.bridge);
 f.bridge.artifact=async id=>id===file.id?{filename:file.title,mime:'text/plain',data:Buffer.from(text).toString('base64'),sha256:createHash('sha256').update(text).digest('hex')}:read(id);
 for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,artifacts:[...(value.artifacts??[]),file]};};}
 return {...f,setStatus(state,status){save('node-10',{state,status});f.server.publish();},replay(){f.processes.workerEvent('node-10',first);f.server.publish();}};
}
try{
 for(const width of [1440,390,320]){
  const f=await workerFixture(),p=await browser.page(f.server.url,width),checks=[];
  const until=expr=>p.until(expr,10000),ev=expr=>p.evaluate(expr);
  const toggle=async open=>{await ev(`(()=>{const b=document.querySelector('#message-node-10 [data-slot=collapsible-trigger]');if((b.getAttribute('aria-expanded')==='true')!==${open})b.click();})()`);await until(`document.querySelector('#message-node-10 [data-slot=collapsible-trigger]')?.getAttribute('aria-expanded')==='${open}'`);if(open)await until(()=>!!document.querySelector('#message-node-10 [data-tool-id]'));else await until(()=>!document.querySelector('#message-node-10 [data-slot=collapsible-content]'));};
  try{
   await p.navigate();await until(`document.querySelectorAll('${cardSelector}').length===2`);
   await p.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await ev(()=>document.querySelector('#message-node-10').scrollIntoView({block:'start'}));
   await p.screenshot('collapsed-'+width+'.png');
   await ev(()=>{window.__cards=[...document.querySelectorAll('#message-node-10 [data-worker-event]')];window.__cardParent=window.__cards[0].parentNode;window.__removedCards=0;window.__cardObserver=new MutationObserver(records=>{for(const record of records)for(const removed of record.removedNodes)for(const card of window.__cards)if(removed===card||removed.contains?.(card))window.__removedCards++;});window.__cardObserver.observe(document.querySelector('#message-node-10'),{subtree:true,childList:true});window.__cards[0].querySelector('button').click();window.__cards[0].querySelector('button').focus({preventScroll:true});});
   await until(()=>!!document.querySelector('#message-node-10 [data-slot=task-card-transcript]'));
   await toggle(true);await p.screenshot('expanded-'+width+'.png');
   const identity=await ev(()=>{const cards=[...document.querySelectorAll('#message-node-10 [data-worker-event]')],root=document.querySelector('#message-node-10 [data-slot=run-activity]');return {same:cards.every((c,i)=>c===window.__cards[i]),parent:cards.every(c=>c.parentNode===window.__cardParent),outside:cards.every(c=>!root.contains(c)),removed:window.__removedCards,open:cards[0].querySelector('button').getAttribute('aria-expanded'),focus:document.activeElement===window.__cards[0].querySelector('button')};});
   if(baseline){assert.equal(identity.outside,false);assert.equal(identity.same,false);assert.equal(identity.open,'false');results.push({width,oldBehavior:identity});continue;}
   assert.deepEqual(identity,{same:true,parent:true,outside:true,removed:0,open:'true',focus:true});checks.push('outer toggle keeps unique card DOM, parent, transcript and focus');
   assert.ok(await ev(()=>document.querySelector('#message-node-10 [data-tool-id="create-10"]').textContent.includes('创建任务')));checks.push('real creation tool record remains inside public process');
   await toggle(false);await toggle(true);await toggle(false);
   assert.ok(await ev(()=>window.__cards.every(c=>c.isConnected&&c.parentNode===window.__cardParent)&&window.__removedCards===0));
   await ev(()=>document.querySelector('#message-node-10 [data-slot=collapsible-trigger]').focus({preventScroll:true}));await key(p,'Tab','Tab',9);
   assert.ok(await ev(()=>document.activeElement===window.__cards[0].querySelector('button')));
   await key(p,'Enter','Enter',13);await until(()=>document.querySelector('#message-node-10 [data-worker-event] button').getAttribute('aria-expanded')==='false');await key(p,'Enter','Enter',13);checks.push('closed process skips internal links; card keyboard disclosure remains independent');
   for(const [state,status,label] of [['working','running','Working'],['worked','completed','Worked'],['worked','failed','处理失败'],['worked','interrupted','已中断'],['working','unknown','待核实']]){
    f.setStatus(state,status);await until(`document.querySelector('#message-node-10 [data-slot=collapsible-trigger]')?.textContent.includes('${label}')`);await toggle(true);await toggle(false);
    assert.ok(await ev(()=>window.__cards.every(c=>c.isConnected&&c.parentNode===window.__cardParent)&&window.__removedCards===0&&window.__cards[0].querySelector('button').getAttribute('aria-expanded')==='true'));
   }
   f.setStatus('worked','completed');f.replay();await until(()=>document.querySelector('#message-node-10 [data-slot=collapsible-trigger]').textContent.includes('Worked'));
   const order=await ev(()=>{const a=document.querySelector('#message-node-10'),b=document.querySelector('#message-node-11'),cards=[...a.querySelectorAll('[data-worker-event]')],bubble=a.querySelector('.assistant-message-bubble'),process=a.querySelector('[data-slot=run-activity]');return {events:cards.map(c=>c.dataset.workerEvent),states:cards.map(c=>c.dataset.state),received:b.querySelectorAll('[data-worker-event="outside-received"]').length,total:document.querySelectorAll('[data-worker-event]').length,outsideBubble:cards.every(c=>!bubble.contains(c)),ordered:cards.every(c=>!!(process.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(c.compareDocumentPosition(bubble)&Node.DOCUMENT_POSITION_FOLLOWING)),noCard:document.querySelectorAll('#message-node-9 [data-worker-event],#message-node-9 .process-workers').length,emptyPanel:document.querySelectorAll('#message-node-9 [data-slot=collapsible-content]').length,answer:bubble.textContent.includes('已安排制作')};});
   assert.deepEqual(order,{events:['outside-delegated','outside-failed'],states:['waiting','failed'],received:1,total:3,outsideBubble:true,ordered:true,noCard:0,emptyPanel:0,answer:true});checks.push('replay, multiple rounds, errors, cancellation and unknown keep event identities, states and answer ownership');
   await ev(()=>{const viewport=document.querySelector('.thread-viewport');viewport.scrollTop=100;window.__readingTop=viewport.scrollTop;});await toggle(true);await toggle(false);
   assert.ok(await ev(()=>{const v=document.querySelector('.thread-viewport');return Math.abs(v.scrollTop-window.__readingTop)<2&&v.scrollHeight-v.clientHeight-v.scrollTop>200;}));checks.push('history reading stays above bottom after toggles below the reading anchor');
   assert.equal(await ev(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(width===1440){await until(()=>!!document.querySelector('.status-aside'));await p.screenshot('summary-'+width+'.png');checks.push('existing desktop status summary remains in layout');}
   await ev(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')==='预览 Synthetic.txt');b.scrollIntoView({block:'center'});b.click();});await until(()=>document.querySelector('[data-preview-text]')?.textContent==='合成预览正文。');
   assert.equal(await ev(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await ev(()=>window.__cards.every(c=>c.isConnected)&&window.__removedCards===0));await p.screenshot('preview-'+width+'.png');
   await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());await until(()=>!document.querySelector('#canvas-panel'));checks.push('preview opens and closes without remounting cards or horizontal overflow');
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);assert.equal(f.fakeEngine.invocations,0);assert.equal(f.submitted.length,0);assert.equal(f.stopped.length,0);
   results.push({width,identity,order,checks,passed:true});
  }catch(error){await p.screenshot('failure-'+width+'.png');console.error({width,errors:p.errors,blocked:p.blocked});throw error;}finally{await p.close();await f.close();}
 }
}finally{await browser.close();writeFileSync(join(destination,'browser.json'),JSON.stringify({baseline,browser:browser.version,syntheticOnly:true,results},null,2)+'\n');}
console.log(JSON.stringify({passed:true,baseline,widths:results.map(r=>r.width),checks:results.reduce((n,r)=>n+(r.checks?.length??0),0)}));
