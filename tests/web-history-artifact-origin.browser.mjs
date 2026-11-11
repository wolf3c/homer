// Authorized message-scoped origin HTTP contract; the retired UI entry is not restored.
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-loading-implementation/followup'),chrome=await isolatedChrome(destination),f=await fixture(100,'after',true);
try{
 const text='Exact authorized reply', made=f.attach(text,[{filename:'authorized.md',mime:'text/markdown',content:'# Exact file bytes'}]);
 const foreign=f.attach('UNAUTHORIZED_NEIGHBOR',[{filename:'foreign.txt',content:'UNAUTHORIZED_NEIGHBOR'}],{threadId:'old-synthetic-thread'});
 const exactReads=[],original=f.history.message.bind(f.history);f.history.message=id=>{exactReads.push(id);return original(id);};
 f.history.list=()=>{throw Error('full_history_forbidden');};
 const page=await chrome.page(f.server.url,1440);
 try{
  await page.navigate();await page.until(()=>!!document.querySelector('.file-list-open[aria-label="预览 authorized.md"]')&&!!document.querySelector('[contenteditable=true]'));
  await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await page.command('Input.insertText',{text:'Current thread draft stays here'});
  // Canvas no longer has an origin reader. Exercise the retained exact grant
  // through HTTP, without inventing a replacement control or reading neighbors.
  exactReads.length=0;
  const response=await fetch(f.server.url+made.paths[0]+'/origin');assert.equal(response.status,200);
  const origin=await response.json();
  assert.equal(origin.message.id,made.messageId);assert.equal(origin.message.text,text);
  assert.deepEqual(origin.files.map(file=>[file.messageId,file.assetId,file.revision]),[[made.messageId,made.attachments[0].assetId,1]]);
  const opened=await page.evaluate(()=>({draft:document.querySelector('[contenteditable=true]').textContent,leak:document.body.textContent.includes('UNAUTHORIZED_NEIGHBOR')}));
  assert.equal(opened.leak,false);assert.equal(opened.draft,'Current thread draft stays here');
  assert.ok(exactReads.length>0);assert.ok(exactReads.every(id=>id===made.messageId));
  await page.screenshot('authorized-attachment-origin-1440.png');
  const request=async(path,body)=>{const response=await fetch(f.server.url+path,{method:body?'POST':'GET',headers:{Origin:f.server.url,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.text()};};
  const failures={};
  failures.wrongThread=await request('/api/history/resolve',{readEpoch:'synthetic-browser-epoch',id:foreign.messageId});assert.notEqual(failures.wrongThread.status,200);
  failures.wrongAround=await request('/api/history/page',{readEpoch:'synthetic-browser-epoch',request:{around:foreign.messageId}});assert.notEqual(failures.wrongAround.status,200);
  failures.wrongEpoch=await request('/api/history/resolve',{readEpoch:'wrong',id:'node-99'});assert.notEqual(failures.wrongEpoch.status,200);
  const userAsset=f.history.message('user-99').attachments[0];
  failures.wrongAsset=await request('/api/media/'+made.messageId+'/'+userAsset.assetId+'/1');
  failures.wrongRevision=await request(made.paths[0].replace(/1$/,'2'));
  failures.foreignOrigin=await request(foreign.paths[0]+'/origin');
  failures.foreignFile=await request(foreign.paths[0]);
  const exactFile=await request(made.paths[0]);assert.equal(exactFile.status,200);assert.equal(exactFile.body,'# Exact file bytes');
  assert.ok(f.history.revokeMessage('synthetic-history',made.messageId));
  failures.revokedOrigin=await request(made.paths[0]+'/origin');
  failures.revokedFile=await request(made.paths[0]);
  assert.ok(Object.values(failures).every(value=>value.status===409));assert.ok(Object.values(failures).every(value=>!value.body.includes('UNAUTHORIZED_NEIGHBOR')));
  assert.equal(f.submitted.length,0);assert.deepEqual(page.errors,[]);
  writeFileSync(join(destination,'attachment-origin-browser.json'),JSON.stringify({opened,exactReads,failures,exactFileStatus:exactFile.status,submits:f.submitted.length,errors:page.errors},null,2));
 }finally{await page.close();}
}finally{await f.close();await chrome.close();}
