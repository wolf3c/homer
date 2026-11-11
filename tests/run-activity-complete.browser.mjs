// Requirement-derived synthetic regression. No production data or executable engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=path.resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/run-activity-complete-20261023/browser');
fs.mkdirSync(destination,{recursive:true});
const browser=await isolatedChrome(destination),results=[];
try{
 for(const width of [320,390,1440]){
  const f=await fixture(90,'after');
  const key='publicMainNode:v1:node-89',startedAtMs=Date.now()-36000;
  const source={id:'node-89:source',seq:1,revision:1,kind:'commentary',phase:'commentary',text:'处理 Worker 提问：保持历史消息阅读位置'};
  const update=items=>{const node=JSON.parse(f.store.meta(key));f.store.setMeta(key,JSON.stringify({...node,revision:node.revision+1,sourceKind:'worker',replyPolicy:'explicitFinal',sourceMessageIds:[],replyMessageId:undefined,final:undefined,state:'working',status:'running',turnIds:['turn-89'],startedAtMs,timingState:'running',timingSource:'hostObserved',items}));f.store.db.prepare("UPDATE conversation_messages SET text='',status='running' WHERE id='node-89'").run();f.server.publish();};
  update([source]);f.inputs.accept({requestId:'synthetic-pending-question',text:'合成：请概括两项结果'});
  let stage='native';const original=f.bridge.history.state;
  f.bridge.history.state=async()=>({...await original(),observedAtMs:Date.now(),isRunning:false,generation:null,mainActivity:{processId:'node-89',source:'internal',turnId:'turn-89',stage}});
  const p=await browser.page(f.server.url,width);
  try{
   await p.navigate();
   await p.until(()=>document.querySelector('#message-node-89 [data-slot=run-activity]')?.textContent.includes('处理 Worker 提问：保持历史消息阅读位置'));
   assert.equal(await p.evaluate(()=>document.querySelector('#message-node-89 button').getAttribute('aria-expanded')),'false');
   assert.equal(await p.evaluate(()=>document.querySelectorAll('#message-node-89 [data-tool-id]').length),0);
   assert.equal(await p.evaluate(()=>document.body.textContent.includes('合成：请概括两项结果')),true);
   await p.screenshot('worker-source-'+width+'.png');
   stage='compacting';f.server.publish();
   await p.until(()=>document.querySelector('#message-node-89 button').textContent.includes('正在压缩上下文'));
   assert.equal(await p.evaluate(()=>document.querySelector('#message-node-89 [data-slot=run-activity]').textContent.includes('处理 Worker 提问')),true);
   stage='native';
   const tools=[{id:'coordination',seq:2,revision:1,kind:'tool',category:'host',label:'检查协作请求',status:'completed'},
    {id:'update',seq:3,revision:1,kind:'tool',category:'host',label:'调整任务',status:'completed',activity:{schemaVersion:1,action:'update_task',objectName:'合成公开任务',outcome:'update_queued'}}];
   update([source,...tools]);
   await p.until(()=>document.querySelector('#message-node-89 [data-slot=run-activity]').textContent.includes('后续要求已排队'));
   await p.evaluate(()=>{const button=document.querySelector('#message-node-89 button');button.focus();button.click();});
   await p.until(()=>document.querySelectorAll('#message-node-89 [data-tool-id]').length===2);
   await p.until(()=>document.querySelector('#message-node-89 [data-slot=collapsible-content]').getAnimations().length===0);
   const appearance=await p.evaluate(()=>{const root=document.querySelector('#message-node-89 [data-slot=run-activity]'),list=root.querySelector('ol');return {tags:[...root.querySelectorAll('[data-tool-id]')].map(n=>n.tagName),font:getComputedStyle(list).fontSize,gap:getComputedStyle(list).gap,border:getComputedStyle(list).borderInlineStartWidth,custom:!!root.querySelector('.process-tool-row,.process-fact,.process-activity-outcome'),overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.deepEqual(appearance,{tags:['P','P'],font:'14px',gap:'12px',border:'1px',custom:false,overflow:false});
   await p.screenshot('plain-activity-'+width+'.png');
   await p.evaluate(()=>{document.querySelector('.thread-viewport').scrollTop=0;});
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const before=await p.evaluate(()=>document.querySelector('.thread-viewport').scrollTop);
   update([source,...tools,{id:'response',seq:4,revision:1,kind:'tool',category:'host',label:'答复协作请求',status:'completed'}]);
   await p.until(()=>document.querySelectorAll('#message-node-89 [data-tool-id]').length===3);
   assert.equal(await p.evaluate(()=>document.querySelector('.thread-viewport').scrollTop),before);
   assert.equal(await p.evaluate(()=>document.querySelector('#message-node-89 button').getAttribute('aria-expanded')),'true');
   assert.deepEqual(p.errors,[]);assert.equal(f.fakeEngine.invocations,0);
   results.push({width,appearance,sourceVisible:true,phaseVisible:true,pendingUserPreserved:true,scrollPreserved:true});
  }finally{await p.close();await f.close();}
 }
}finally{await browser.close();fs.writeFileSync(path.join(destination,'results.json'),JSON.stringify({syntheticOnly:true,results},null,2)+'\n');}
console.log(JSON.stringify({passed:results.length,widths:results.map(r=>r.width)}));
