// Actual product bundle + HTTP router + publication owners, synthetic data only.
// Build ui to HOMER_REMOVED_CAPABILITY_WEB_DIR before running. No model/account.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const destination=resolve('.codex/scratch/remove-capability-settings-20261023');
mkdirSync(destination,{recursive:true});
process.env.HOMER_SYNTHETIC_ROOT=join(destination,'synthetic');
process.env.HISTORY_FOLLOWUP_BUILD=process.env.HOMER_REMOVED_CAPABILITY_WEB_DIR??join(destination,'web');
const {fixture}=await import('./web-history-followup-fixture.mjs');
const {isolatedChrome}=await import('./web-history-browser-cdp.mjs');
const {approval}=await import('./fixtures/approval-browser-server.mjs');
const browser=await isolatedChrome(destination),results=[];
try{for(const width of [320,390,1440]){
 const f=await fixture(4,'after'),p=await browser.page(f.server.url,width),checks=[];
 let pending=true;const decisions=[];
 const augment=state=>({...state,features:{...state.features,taskOverview:true},interactions:pending?[{...approval,sourceRequestId:'request-0'}]:[]});
 const readHistory=f.bridge.history.state.bind(f.bridge.history);
 f.bridge.history.state=async()=>augment(await readHistory());
 f.bridge.respond=async(id,input)=>{decisions.push({id,...input});pending=false;f.server.publish();return {ok:true};};
 const actor={agentId:f.store.meta('mainAgentId'),threadId:'synthetic-history'};
 const task=f.tasks.createTask(actor,{operationId:'settings-task',goal:'Synthetic file'});
 f.attach('合成正式答复：请核对成果。',[{filename:'合成核对成果.md',mime:'text/markdown',content:'# 合成核对成果\n\n移除能力管理页后，文件仍沿原授权路径读取。'}],{taskId:task.taskId,taskVersion:1});
 const check=(name,value)=>{assert.ok(value,name+' at '+width);checks.push(name);};
 const key=async(name,code,num)=>{await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:num,...(name==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:num});};
 try{
  await p.navigate();await p.until(()=>!!document.querySelector('[contenteditable=true]')&&!!document.querySelector('[data-slot=approval-card-allow-once]'));
  check('header has no capability link even when backend advertises support',await p.evaluate(()=>!document.querySelector('a[href="/settings/capabilities"],.capability-link,.capability-page')));
  check('no ChatGPT account controls',await p.evaluate(()=>!document.body.textContent.includes('连接 ChatGPT')&&!document.body.textContent.includes('退出 ChatGPT')));
  check('no horizontal page overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.screenshot('chat-'+width+'.png');
  await p.evaluate(()=>document.querySelector('#task-status-trigger').click());await p.until(()=>!!document.querySelector('[aria-label="工作状态卡片"]'));
  await p.until(()=>document.querySelector('[aria-label="工作状态卡片"]').textContent.includes('Synthetic file'));
  check('existing task status popover opens',await p.evaluate(()=>document.querySelector('[aria-label="工作状态卡片"]').textContent.includes('Synthetic file')));
  await key('Escape','Escape',27);await p.until(()=>!document.querySelector('[aria-label="工作状态卡片"]'));
  check('task popover returns keyboard focus',await p.evaluate(()=>document.activeElement.id==='task-status-trigger'));
  await p.evaluate(()=>document.querySelector('.header-actions button[aria-label="设置"]').focus());
  await key('Enter','Enter',13);await p.until(()=>!!document.querySelector('.desktop-settings-popup'));
  check('settings exposes permissions and device connection',await p.evaluate(()=>Array.from(document.querySelectorAll('.desktop-settings-nav [role=tab]')).map(n=>n.textContent).join('|')==='本机权限|移动设备'));
  check('settings never contacts retired IM channels',!p.requests.some(r=>r.path.startsWith('/api/channels/')));
  await key('Escape','Escape',27);await p.until(()=>!document.querySelector('.desktop-settings-popup'));
  await p.evaluate(()=>document.querySelector('button[aria-label="预览 合成核对成果.md"]').click());await p.until(()=>!!document.querySelector('#canvas-panel'));
  await p.until(()=>document.querySelector('#canvas-panel').textContent.includes('文件仍沿原授权路径读取'));
  check('published file opens in existing Canvas',true);await p.screenshot('canvas-'+width+'.png');
  await key('Escape','Escape',27);await p.until(()=>!document.querySelector('#canvas-panel'));
  check('Canvas returns focus to exact file',await p.evaluate(()=>document.activeElement.getAttribute('aria-label')==='预览 合成核对成果.md'));
  await p.evaluate(()=>document.querySelector('[data-slot=approval-card-deny]').focus());await key('Enter','Enter',13);
  await p.until(()=>!document.querySelector('[data-slot=approval-card]'));
  check('existing approval uses exact interaction and human decision',decisions.length===1&&decisions[0].id===approval.id&&decisions[0].text==='拒绝本次操作');
  await p.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'隔离合成聊天检查'});
  await p.until(()=>document.querySelector('[contenteditable=true]').textContent.includes('隔离合成聊天检查')&&!document.querySelector('.send-button').disabled);
  await p.evaluate(()=>document.querySelector('.send-button').click());
  for(let n=0;n<250&&f.submitted.length===0;n++)await new Promise(accept=>setTimeout(accept,20));
  await p.until(()=>document.querySelector('[contenteditable=true]').textContent.trim()==='');
  check('main chat submits through existing synthetic queue',f.submitted.length===1);
  for(const path of ['/settings/capabilities','/api/capabilities','/api/channels/wechat','/api/channels/telegram']){
   const result=await p.evaluate(`fetch(${JSON.stringify(path)}).then(async r=>({status:r.status,body:await r.json()}))`);check(path+' returns unified 404',result.status===404&&result.body.error==='route_not_found');
  }
  await p.command('Page.navigate',{url:f.server.url+'/settings/capabilities'});await p.until(()=>document.body.textContent.includes('route_not_found'));
  check('direct old URL has no management form',await p.evaluate(()=>!document.querySelector('input,textarea,form,.capability-page')));await p.screenshot('retired-url-'+width+'.png');
  check('no runtime errors',p.errors.length===0);check('no external browser requests',p.blocked.length===0);check('no capability HTTP calls from UI',!p.requests.some(r=>r.path==='/api/capabilities'&&r.method==='POST'));
  results.push({width,checks,errors:p.errors});
 }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'browser-failure.json'),JSON.stringify({width,checks,errors:p.errors,requests:p.requests,body:await p.evaluate(()=>document.body.innerText.slice(0,3000))},null,2));throw error;}finally{await p.close();await f.close();}
}}
finally{await browser.close();writeFileSync(join(destination,'browser-results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results.map(r=>({width:r.width,checks:r.checks.length}))));
