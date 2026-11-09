// Production UI + synthetic HTTP/queue, isolated Chrome. No real service/model.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/canvas-selection-add-to-chat-20261024/browser');
mkdirSync(destination,{recursive:true});
const baseline=process.env.HOMER_CANVAS_BASELINE==='1',checks=[];
const formats=[
 {id:'result-selection-text',title:'Selection.txt',mime:'text/plain',text:'第一段中文，重复文字。\n\n第二段中文，重复文字。\n\n'+Array.from({length:90},(_,n)=>'第'+n+'行用于滚动定位。').join('\n')},
 {id:'result-selection-other',title:'Other.txt',mime:'text/plain',text:'不同文件，只能引用这个来源。'},
 {id:'result-selection-code',title:'Code.ts',mime:'text/plain',text:'const 重复 = "重复";\nconsole.log(重复);'},
 {id:'result-selection-markdown',title:'Selection.md',mime:'text/markdown',text:'第一段 $x_i^2$，重复文字。\n\n```ts\nconst value = "重复文字";\n```\n\n第二段。\n\n$$\n\\frac{a_b}{c_d}\n$$\n\n```math\nx^2 + y^2\n= z^2\n```\n\n错误公式 $\\frac{$，原文。'},
 {id:'result-selection-html',title:'Static.html',mime:'text/html',text:'<!doctype html><p>HTML 成果只提供静态网页与主动元素批注。</p>'},
].map(file=>({...file,sha256:createHash('sha256').update(file.text).digest('hex')}));
const f=await fixture(4,'after');let chrome,accepting=true;
const read=f.bridge.artifact.bind(f.bridge);
f.bridge.artifact=async id=>{const file=formats.find(file=>file.id===id);return file?{filename:file.title,mime:file.mime,data:Buffer.from(file.text).toString('base64'),sha256:file.sha256}:read(id);};
{const owner=f.bridge.history;
 const state=owner.state.bind(owner);
 owner.state=async()=>{const value=await state();return {...value,upgrade:{...value.upgrade,accepting},artifacts:[...(value.artifacts??[]),...formats.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic selection'}))]};};
}
try{
 chrome=await isolatedChrome(destination);
 for(const width of baseline?[1440]:[1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=expr=>p.evaluate(expr);
  const until=expr=>p.until(expr,7000);
  const record=label=>{checks.push({width,label});console.log(width,label);};
  const bubble=()=>!!document.querySelector('.preview-selection-positioner button');
  const open=async(id=formats[0].id)=>{
   if(await ev(()=>!!document.querySelector('#canvas-panel'))&&width<=800){await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());await until(()=>!document.querySelector('#canvas-panel'));}
   const file=formats.find(file=>file.id===id);
   await ev(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+file.title)});b.scrollIntoView({block:'center'});b.click();})()`);
   if(file.mime==='text/html'){await until(()=>document.querySelector('iframe[title="隔离 HTML 成果"]')?.getAttribute('sandbox')==='allow-scripts allow-forms');return;}
   await until(`document.querySelector('[data-preview-text]')?.textContent.includes(${JSON.stringify(file.text.slice(0,4))})`);
  };
  const select=async(selector='[data-preview-text]',partial=true)=>{
   await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const r=document.createRange();r.selectNodeContents(el);${partial?'r.setEnd(el.firstChild,30);':''}const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);
  };
  const complete=async()=>{
   await until(()=>!!document.querySelector(".text-annotation-editor textarea"));
   await p.command("Input.insertText",{text:"解释这处选文"});
   await ev(()=>document.querySelector(".text-annotation-editor button[type=submit]").click());
   await until(()=>!document.querySelector(".text-annotation-editor"));
   await ev(()=>document.querySelector(".text-annotation-actions>button").click());
  };
  const click=async()=>{
   const r=await ev(()=>document.querySelector('.preview-selection-positioner button').getBoundingClientRect().toJSON());
   if(width<=800){
    await p.command('Emulation.setTouchEmulationEnabled',{enabled:true});
    await p.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
    await p.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.command('Emulation.setTouchEmulationEnabled',{enabled:false});await complete();return;
   }
   await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
   await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
   await complete();
  };
  const checkBounds=async()=>assert.ok(await ev(()=>{const r=document.querySelector('.preview-selection-positioner button').getBoundingClientRect(),b=document.querySelector('[data-slot="canvas-split-body"]').getBoundingClientRect();return r.left>=Math.max(0,b.left)&&r.right<=Math.min(innerWidth,b.right)+1&&r.top>=Math.max(0,b.top)&&r.bottom<=Math.min(innerHeight,b.bottom)+1;}));
  try{
   await p.navigate();await until(()=>!!document.querySelector('.composer-area [contenteditable=true]'));
   if(!baseline){
    await ev(()=>sessionStorage.setItem('homer-draft:synthetic-history',JSON.stringify({text:'已有正文。',quotes:[{messageId:'node-3',text:'合成答复 3'}],requestId:'selection-draft',attachments:[{assetId:'asset-00000000-0000-4000-8000-000000009999',revision:1,filename:'Existing.txt',kind:'file',state:'ready',mime:'text/plain',size:12,error:null}]})));
    await p.navigate();await until(()=>!!document.querySelector('.composer-area .aui-attachment-root')&&!!document.querySelector('.composer-area [data-slot="composer-quote"]'));
   }
   await open();
   if(baseline){
    assert.ok(await ev(()=>[...document.querySelectorAll('#canvas-panel button')].some(b=>b.textContent==='引用选中内容'&&b.disabled)));
    await select();await p.screenshot('before-fixed-button-1440.png');
    assert.equal(await ev(bubble),false);record('red: selected Canvas text has fixed button and no nearby Add to chat');continue;
   }
   assert.equal(await ev(bubble),false);
   assert.ok(await ev(()=>!document.querySelector('#canvas-panel .canvas-tools')));record('no selection: no bubble, fixed button or empty text toolbar');
   await ev(()=>{window.__previewNode=document.querySelector('[data-preview-text]');window.__remounts=0;window.__previewObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node===window.__previewNode||node.contains?.(window.__previewNode))window.__remounts++;});window.__previewObserver.observe(document.querySelector('#canvas-panel'),{childList:true,subtree:true});});
   await select();await until(bubble);await checkBounds();await p.screenshot('selection-bubble-'+width+'.png');
   const {root:{nodeId:documentId}}=await p.command('DOM.getDocument');
   const {nodeId:actionId}=await p.command('DOM.querySelector',{nodeId:documentId,selector:'.preview-selection-positioner button'});
   const {nodes:accessible}=await p.command('Accessibility.getPartialAXTree',{nodeId:actionId});
   assert.ok(accessible.some(node=>node.role?.value==='button'&&node.name?.value==='批注'));
   assert.equal(await ev(()=>window.__remounts),0);record('valid Chinese selection opens bounded bubble without remount');
   accepting=false;await f.server.publish();await until(()=>document.querySelector('.send-button').disabled);
   await click();await until(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('当前不能添加预览引用'));
   const blockedDraft=await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
   assert.equal(blockedDraft.text,'已有正文。');assert.equal(blockedDraft.quotes[0].messageId,'node-3');assert.equal(blockedDraft.attachments.length,1);assert.equal(blockedDraft.resourceReference,undefined);record('blocked owner rejects import and preserves original quote, body and ordinary attachment');
   accepting=true;await f.server.publish();await until(()=>!document.querySelector('.send-button').disabled);
   await ev(()=>getSelection().removeAllRanges());await until(()=>!document.querySelector('.preview-selection-positioner button'));record('clearing selection removes bubble');
   await select();await until(bubble);
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await until(()=>!document.querySelector('.preview-selection-positioner button'));assert.ok(await ev(()=>!!document.querySelector('#canvas-panel')));record('Escape dismisses bubble only');
   await select('[data-preview-text]',false);await until(bubble);await checkBounds();
   await ev(()=>document.querySelector('[data-slot="canvas-split-body"]').scrollTop=220);await new Promise(done=>setTimeout(done,100));await checkBounds();record('long selection tracks scroll within preview and viewport');
   const header=await ev(()=>document.querySelector('.canvas-tab-bar').getBoundingClientRect().toJSON());
   await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:header.x+60,y:header.y+header.height/2,button:'left',clickCount:1});
   await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:header.x+60,y:header.y+header.height/2,button:'left',clickCount:1});
   await until(()=>!document.querySelector('.preview-selection-positioner button'));record('outside pointer dismisses bubble without closing preview');
   await ev(()=>document.querySelector('[data-slot="canvas-split-body"]').scrollTop=0);
   await ev(()=>document.querySelector('[role=tab][aria-selected=true], .canvas-collapse').focus({preventScroll:true}));
   await select();await until(bubble);
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   // Saved notes add summary controls before the portaled selection action.
   for(let step=0;step<8&&!await ev(()=>document.activeElement?.textContent==='批注');step++){
    await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   }
   await until(()=>document.activeElement?.textContent==='批注');
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await complete();
   await until(()=>!!document.querySelector('.composer-area .preview-reference'));
   if(width<=800)await until(()=>!document.querySelector('#canvas-panel'));
   await until(()=>document.activeElement?.getAttribute('contenteditable')==='true');
   assert.equal(f.submitted.length,0);await p.command('Input.insertText',{text:'保留原草稿，直接输入。'});
   await until(()=>document.querySelector('.composer-area [contenteditable=true]').textContent.includes('直接输入'));
   await p.screenshot('import-composer-focused-'+width+'.png');record('keyboard action adds exact source, focuses editable composer and never sends');
   const draft=await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
   assert.equal(draft.resourceReference.annotations.at(-1).text,formats[0].text.slice(0,30).trim());assert.equal(draft.resourceReference.source.id,formats[0].id);assert.equal(draft.resourceReference.source.sha256,formats[0].sha256);
   assert.ok(draft.text.includes('已有正文。'));assert.equal(draft.attachments[0].assetId,'asset-00000000-0000-4000-8000-000000009999');assert.equal(draft.requestId,'selection-draft');assert.deepEqual(draft.quotes,[]);record('ordinary text, attachment and request identity survive; message quote is replaced only on successful import');
   await open(formats[2].id);await select('[data-preview-text]',false);await until(bubble);await click();
   if(width<=800)await until(()=>!document.querySelector('#canvas-panel'));
   await until(()=>document.activeElement?.getAttribute('contenteditable')==='true');
   assert.ok(await ev(()=>document.querySelector('[contenteditable=true]').textContent.includes('保留原草稿')));
   await until(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReference.source.id==='result-selection-code');record('real pointer action preserves existing draft and replaces single reference');
   await open(formats[3].id);await until(()=>!!document.querySelector('.katex'));
   await ev(()=>{window.__code=document.querySelector('.canvas-markdown pre');});
   await select('.canvas-markdown',false);await until(bubble);await checkBounds();
   assert.ok(await ev(()=>window.__code===document.querySelector('.canvas-markdown pre')));
   await click();if(width<=800)await until(()=>!document.querySelector('#canvas-panel'));
   await until(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReference.source.id==='result-selection-markdown');
   const math=await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReference);
   assert.ok(math.annotations.at(-1).text.includes('$x_i^2$'));assert.ok(math.annotations.at(-1).text.includes('const value = "重复文字";'));assert.ok(math.annotations.at(-1).text.includes('\\frac{a_b}{c_d}'));assert.ok(math.annotations.at(-1).text.includes('x^2 + y^2\n= z^2'));assert.ok(math.annotations.at(-1).text.includes('$\\frac{$'));record('mixed Markdown, code and valid/invalid/fenced math preserve canonical source');
   await open(formats[4].id);
   assert.equal(await ev(()=>!!document.querySelector('[data-preview-text],.preview-selection-positioner,.text-annotation-summary,[aria-label="查看 HTML 源码"],[aria-label="返回静态网页预览"]')),false);
   assert.deepEqual(await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReference),math);record('HTML keeps its static frame without a text selection entry or mutation of the existing draft');
   await open();await select();await until(bubble);
   if(width>800){
    await open(formats[1].id);assert.equal(await ev(bubble),false);await open();await select();await until(bubble);
    await ev(()=>{const r=document.createRange();r.setStart(document.querySelector('.conversation-header'),0);r.setEnd(document.querySelector('[data-preview-text]').firstChild,8);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});await until(()=>!document.querySelector('.preview-selection-positioner button'));record('file switch and cross-chat selection cannot import stale source');
    await select();await until(bubble);
    const separator=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:separator.x+separator.width/2,y:separator.y+separator.height/2,button:'left',clickCount:1});
    for(let step=1;step<=5;step++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:separator.x+60*step,y:separator.y+separator.height/2,button:'left',buttons:1});
    await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:separator.x+300,y:separator.y+separator.height/2,button:'left',clickCount:1});
    await select();await until(bubble);await checkBounds();await p.screenshot('dragged-narrow-preview.png');record('dragging original split separator keeps selection and floating bounds');
    await p.command('Emulation.setDeviceMetricsOverride',{width:850,height:900,deviceScaleFactor:1,mobile:false});await new Promise(done=>setTimeout(done,120));await checkBounds();record('narrow desktop resize keeps floating action inside panel');
   }
   await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());await until(()=>!document.querySelector('#canvas-panel'));assert.equal(await ev(bubble),false);record('close destroys selection action');
   await ev(()=>{const key='homer-draft:synthetic-history',draft=JSON.parse(sessionStorage.getItem(key));draft.answerItem={id:'synthetic-restored-question',runId:'synthetic-worker',kind:'question',question:'合成的已恢复问题',reason:null};sessionStorage.setItem(key,JSON.stringify(draft));});
   await p.navigate();await until(()=>!!document.querySelector('.composer-answer-target'));
   const beforeAnswer=await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
   await open();await select();await until(bubble);await click();
   await until(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('当前不能添加预览引用'));
   const afterAnswer=await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
   assert.deepEqual(afterAnswer.resourceReference,beforeAnswer.resourceReference);assert.deepEqual(afterAnswer.attachments,beforeAnswer.attachments);assert.equal(afterAnswer.text,beforeAnswer.text);assert.equal(f.submitted.length,0);record('restored answer mode rejects imports and keeps the original normal draft');
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  }catch(error){await p.screenshot('failure-'+width+'.png');console.error({errors:p.errors,blocked:p.blocked,diagnostics:await ev(()=>({activeTag:document.activeElement?.tagName,selectedLength:getSelection()?.toString().length,hasNotice:!!document.querySelector('.canvas-note[role=status]')}))});throw error;}
  finally{await p.close();}
 }
 writeFileSync(join(destination,'browser-results.json'),JSON.stringify({passed:true,baseline,checks,browser:chrome.version},null,2));
}finally{try{await chrome?.close();}finally{await f.close();}}
