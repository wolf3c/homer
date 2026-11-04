// Authorized old-thread origin HTTP contract; the retired UI entry is not restored.
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';import {syntheticFile} from './recursive-publication-fixture.js';import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-loading-implementation/followup'),chrome=await isolatedChrome(destination),f=await fixture(100,'after',true);
try{
 f.store.startRequest('request-0','synthetic-old-origin');
 const made=syntheticFile(f,'request-0','authorized-old.md','# Exact old file\nSynthetic authorized bytes'),delivery=made.publish('Exact authorized old reply');
 f.history.record('private-neighbor-before','old-synthetic-thread','UNAUTHORIZED_NEIGHBOR_BEFORE');
 f.history.record(delivery.historyMessageId,'old-synthetic-thread',delivery.text);
 f.history.record('private-neighbor-after','old-synthetic-thread','UNAUTHORIZED_NEIGHBOR_AFTER');f.tasks.markDelivery(delivery.id,'recorded');
 const exactReads=[],original=f.history.message.bind(f.history);f.history.message=id=>{exactReads.push(id);return original(id);};
 // Reject any attempt to hydrate neighboring old-thread history or all history.
 const byIds=f.history.byIds.bind(f.history);f.history.byIds=(thread,ids)=>{if(thread==='old-synthetic-thread')assert.deepEqual(ids,[delivery.historyMessageId]);return byIds(thread,ids);};f.history.list=()=>{throw Error('full_history_forbidden');};
 const page=await chrome.page(f.server.url,1440);
 try{
  await page.navigate();await page.until(()=>document.querySelectorAll('[data-conversation-message]').length===80&&!!document.querySelector('[contenteditable=true]'));
  await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await page.command('Input.insertText',{text:'Current thread draft stays here'});
  // Canvas no longer has an origin reader. Exercise the retained exact grant
  // through HTTP, without inventing a replacement control or reading neighbors.
  const response=await fetch(f.server.url+'/api/files/'+made.resultId+'/origin');assert.equal(response.status,200);
  const origin=await response.json();
  assert.equal(origin.message.id,delivery.historyMessageId);assert.equal(origin.message.text,delivery.text);
  assert.deepEqual(origin.files.map(file=>file.id),[made.resultId]);
  const opened=await page.evaluate(()=>({draft:document.querySelector('[contenteditable=true]').textContent,leak:document.body.textContent.includes('UNAUTHORIZED_NEIGHBOR')}));
  assert.equal(opened.leak,false);assert.equal(opened.draft,'Current thread draft stays here');
  assert.ok(exactReads.length>0);assert.ok(exactReads.every(id=>id===delivery.historyMessageId));
  await page.screenshot('old-thread-authorized-origin-1440.png');
  const request=async(path,body)=>{const response=await fetch(f.server.url+path,{method:body?'POST':'GET',headers:{Origin:f.server.url,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.text()};};
  const failures={};
  failures.wrongThread=await request('/api/history/resolve',{readEpoch:'synthetic-browser-epoch',id:delivery.historyMessageId});assert.notEqual(failures.wrongThread.status,200);
  failures.wrongAround=await request('/api/history/page',{readEpoch:'synthetic-browser-epoch',request:{around:delivery.historyMessageId}});assert.notEqual(failures.wrongAround.status,200);
  failures.wrongEpoch=await request('/api/history/resolve',{readEpoch:'wrong',id:'node-99'});assert.notEqual(failures.wrongEpoch.status,200);
  failures.wrongAsset=await request('/api/media/user-99/asset-00000000-0000-4000-8000-000000000098/1');assert.notEqual(failures.wrongAsset.status,200);
  failures.wrongRevision=await request('/api/media/user-99/asset-00000000-0000-4000-8000-000000000099/2');assert.notEqual(failures.wrongRevision.status,200);
  failures.oldThreadAsset=await request('/api/media/'+delivery.historyMessageId+'/asset-00000000-0000-4000-8000-000000000099/1');assert.notEqual(failures.oldThreadAsset.status,200);
  failures.wrongResult=await request('/api/files/result-not-authorized/origin');assert.notEqual(failures.wrongResult.status,200);
  f.store.startRequest('request-1','synthetic-cancelled-file');
  const main={agentId:f.store.meta('mainAgentId'),sourceRequestId:'request-1'},root=f.tasks.createRoot(main,{operationId:'synthetic-cancelled-root',title:'Cancelled synthetic file',executorKind:'worker',contract:{goal:'Cancelled before publication',inputs:[],resultKind:'markdown',acceptance:{criteria:[]}},authority:{sourceRequestId:'request-1',description:'Synthetic exact file',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}}),run=f.tasks.claim(root.runId);
  const worker={agentId:root.agentId,runId:run.id,epoch:run.epoch,threadId:'synthetic-cancelled-worker',turnId:'synthetic-cancelled-turn'};f.tasks.bind(run.id,run.epoch,worker.threadId,worker.turnId);f.tasks.markMaterialRead(worker);
  const cancelled=f.tasks.writeMarkdown(worker,{operationId:'synthetic-cancelled-write',filename:'cancelled-unpublished.md',content:'# Never published'}),task=f.tasks.task(root.taskId);
  const stop=f.tasks.stop(main,{operationId:'synthetic-stop-before-publication',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision,scope:'subtree',reason:'Synthetic explicit cancellation'});
  f.tasks.confirmStop(stop.operationKey,true);assert.equal(f.tasks.task(task.id).outcome,'cancelled');
  failures.cancelledUnpublished=await request('/api/files/'+cancelled.resultId+'/origin');failures.cancelledFile=await request('/api/files/'+cancelled.resultId);
  const exactFile=await request('/api/files/'+made.resultId);assert.equal(exactFile.status,200);assert.ok(exactFile.body.includes('Exact old file'));
  const revoked=f.tasks.markDelivery(delivery.id,'revoked');assert.equal(revoked.state,'revoked');
  failures.revokedOrigin=await request('/api/files/'+made.resultId+'/origin');failures.revokedFile=await request('/api/files/'+made.resultId);assert.notEqual(failures.revokedOrigin.status,200);assert.notEqual(failures.revokedFile.status,200);
  assert.ok(Object.values(failures).every(value=>value.status===409));assert.ok(Object.values(failures).every(value=>!value.body.includes('UNAUTHORIZED_NEIGHBOR')));
  assert.equal(f.submitted.length,0);assert.deepEqual(page.errors,[]);
  writeFileSync(join(destination,'old-thread-origin-browser.json'),JSON.stringify({opened,exactReads,failures,exactFileStatus:exactFile.status,submits:f.submitted.length,errors:page.errors},null,2));
 }finally{await page.close();}
}finally{await f.close();await chrome.close();}
