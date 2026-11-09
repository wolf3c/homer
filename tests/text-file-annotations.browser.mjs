// Requirement-derived synthetic files, real product UI/HTTP and isolated Chrome.
// No production account, messages, model, installed app, or external network.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {annotationCommentInput} from './helpers/annotation-comment-input.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/text-file-multi-annotations-20261024/browser');
mkdirSync(destination,{recursive:true});
const baseText='第一处中文摘录。\n\n第二处中文摘录。\n\n第三处重复摘录。\n\n第三处重复摘录。\n\n'+Array.from({length:100},(_,i)=>'第'+i+'行合成内容，用于长文件滚动。').join('\n');
const formats=[{id:'result-text-notes-A',title:'Notes.txt',text:baseText},{id:'result-text-notes-B',title:'Other.txt',text:baseText},{id:'result-text-notes-code',title:'Code.ts',text:'const value = 3;\nconsole.log(value);'}];
const f=await fixture(4,'after');let chrome,accepting=true;
const read=f.bridge.artifact.bind(f.bridge);
const submit=f.bridge.submit.bind(f.bridge),attempts=[];let unknownSend=false;
f.bridge.submit=async input=>{if(unknownSend){attempts.push(structuredClone(input));throw Error('synthetic_unknown_receipt');}return submit(input);};
f.bridge.artifact=async id=>{const file=formats.find(file=>file.id===id);if(!file)return read(id);return {filename:file.title,mime:'text/plain',data:Buffer.from(file.text).toString('base64'),sha256:createHash('sha256').update(file.text).digest('hex')};};
{const owner=f.bridge.history;const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,upgrade:{...value.upgrade,accepting},artifacts:[...(value.artifacts??[]),...formats.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic annotations'}))]};};}
const checks=[];
async function waitAttempts(count){for(let i=0;i<200&&attempts.length<count;i++)await new Promise(done=>setTimeout(done,10));assert.equal(attempts.length,count);}
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=expr=>p.evaluate(expr),until=expr=>p.until(expr,8000);
  const record=label=>{checks.push({width,label});console.log(width,label);};
  const click=async selector=>{
   const r=await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`),point={x:r.x+r.width/2,y:r.y+r.height/2};
   if(width<=800){await p.command('Emulation.setTouchEmulationEnabled',{enabled:true});await p.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await p.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.command('Emulation.setTouchEmulationEnabled',{enabled:false});}
   else{await p.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});}
  };
  const button=async text=>{await ev(`(()=>{const b=[...document.querySelectorAll('#canvas-panel button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw Error('missing '+${JSON.stringify(text)});b.click()})()`);};
  const close=async()=>{await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)')?.click());await until(()=>!document.querySelector('#canvas-panel'));};
  const open=async(index=0)=>{
   if(width<=800&&await ev(()=>!!document.querySelector('#canvas-panel')))await close();
   await ev(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+formats[index].title)});b.scrollIntoView({block:'center'});b.click()})()`);
   await until(`document.querySelector('[data-preview-text]')?.textContent===${JSON.stringify(formats[index].text)}`);
  };
  const select=async(text,occurrence=0)=>{
   await ev(`(()=>{const el=document.querySelector('[data-preview-text]');let at=-1;for(let i=0;i<=${occurrence};i++)at=el.textContent.indexOf(${JSON.stringify(text)},at+1);if(at<0)throw Error('missing source');const r=document.createRange();r.setStart(el.firstChild,at);r.setEnd(el.firstChild,at+${text.length});getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);
   await until(()=>document.querySelector('[data-slot=selection-toolbar-quote]')?.textContent==='批注');
  };
  const fill=async text=>{await until(()=>!!document.querySelector('.text-annotation-editor textarea'));assert.equal(await ev(()=>document.activeElement===document.querySelector('.text-annotation-editor textarea')),true);await p.command('Input.insertText',{text});await until(`document.querySelector('.text-annotation-editor textarea')?.value===${JSON.stringify(text)}`);};
  const save=async()=>{await click('.text-annotation-editor button[type=submit]');await until(()=>!document.querySelector('.text-annotation-editor'));};
  const addNote=async(text,comment,occurrence=0)=>{await select(text,occurrence);await click('[data-slot=selection-toolbar-quote]');await fill(comment);await save();};
  const expand=async()=>{await ev(()=>{const details=document.querySelector('.text-annotation-summary details');if(!details.open)details.querySelector('summary').click();});};
  const edit=async(number,comment)=>{await expand();await ev(`document.querySelector('[aria-label="编辑批注 ${number}"]').click()`);await until(()=>!!document.querySelector('.text-annotation-editor textarea'));await ev(()=>document.querySelector('.text-annotation-editor textarea').select());await fill(comment);await save();};
  const importAll=async()=>{await ev(()=>document.querySelector('.text-annotation-actions>button').click());};
  const getDraft=()=>ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
  try{
   await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]'));
   await ev(()=>sessionStorage.setItem('homer-draft:synthetic-history',JSON.stringify({text:'已有正文。',quotes:[{messageId:'node-3',text:'合成答复 3'}],requestId:'annotation-draft',attachments:[{assetId:'asset-00000000-0000-4000-8000-000000009999',revision:1,filename:'Existing.txt',kind:'file',state:'ready',mime:'text/plain',size:12,error:null}]})));
   await p.navigate();await until(()=>!!document.querySelector('.composer-area .aui-attachment-root'));
   unknownSend=false;const sent=f.submitted.length;
   await open();await ev(()=>{window.__textNode=document.querySelector('[data-preview-text]');});
   await select('第一处中文摘录。');await p.screenshot('selection-'+width+'.png');
   await click('[data-slot=selection-toolbar-quote]');
   await until(()=>!!document.querySelector('.text-annotation-editor textarea'));
   assert.equal(await ev(()=>document.querySelector('.text-annotation-editor button[type=submit]').disabled),true);
   await annotationCommentInput(p,'.text-annotation-editor');record('oversized input is retained and invalid; 16000 boundary, blank and composition submission/dismissal are guarded');
   await p.command('Input.imeSetComposition',{text:'中文输入',selectionStart:4,selectionEnd:4});
   await p.command('Input.insertText',{text:'中文批注第一行\n第二行要求。'});
   await until(()=>document.querySelector('.text-annotation-editor textarea')?.value==='中文批注第一行\n第二行要求。');
   assert.equal(await ev(()=>document.querySelector('.text-annotation-editor blockquote').textContent),'第一处中文摘录。');
   const bounds=await ev(()=>{const r=document.querySelector('.text-annotation-editor').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.top>=0&&bounds.bottom<=900);
   await p.screenshot('editor-'+width+'.png');
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await until(()=>!document.querySelector('.text-annotation-editor'));
   assert.ok(await ev(()=>!!document.querySelector('#canvas-panel')));
   assert.equal(await ev(()=>document.querySelector('.text-annotation-actions>button').disabled),true);
   await button('继续编辑');await until(()=>document.querySelector('.text-annotation-editor textarea')?.value.includes('第二行要求'));
   await save();assert.equal((await getDraft()).resourceReference,undefined);
   assert.ok(await ev(()=>!!document.querySelector('[data-slot=composer-quote]')));record('Chinese IME and multiline note save independently; Escape retains draft and leaves parent preview open');
   await addNote('第二处中文摘录。','第二处原备注');await addNote('第三处重复摘录。','第三处原备注');
   assert.equal(await ev(()=>window.__textNode===document.querySelector('[data-preview-text]')),true);
   await edit(2,'第二处修改后\n逐行要求');await expand();await ev(()=>document.querySelector('[aria-label="删除批注 1"]').click());
   await addNote('第三处重复摘录。','相同原文的独立备注',1);
   await expand();assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),3);
   await p.screenshot('three-notes-'+width+'.png');record('three notes, edit second, delete first and repeat excerpt retain distinct IDs without remounting source');
   await close();await open(1);assert.equal(await ev(()=>!!document.querySelector('.text-annotation-summary')),false);
   await open(0);await expand();assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),3);record('closing and switching same-hash different-ID files retains isolated unsent notes');
   await select('第一处中文摘录。');await click('[data-slot=selection-toolbar-quote]');await fill('将被取消的未保存备注');await button('取消');
   assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),3);record('explicit cancel keeps all previously saved notes');
   await select('第一处中文摘录。');await click('[data-slot=selection-toolbar-quote]');await fill('关闭后继续的未保存内容');await close();await open(1);assert.equal(await ev(()=>!!document.querySelector('.text-annotation-editor')),false);await open(0);
   await until(()=>document.querySelector('.text-annotation-editor textarea')?.value==='关闭后继续的未保存内容');await button('取消');record('unsaved editor content survives close and file switch without crossing file identity');
   accepting=false;await f.server.publish();await until(()=>document.querySelector('.send-button').disabled);
   await importAll();await until(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('当前不能添加预览引用'));
   const blocked=await getDraft();assert.equal(blocked.text,'已有正文。');assert.equal(blocked.quotes.length,1);assert.equal(blocked.attachments.length,1);assert.equal(blocked.resourceReference,undefined);
   accepting=true;await f.server.publish();await until(()=>!document.querySelector('.send-button').disabled);
   await importAll();await until(()=>!!document.querySelector('.composer-area .preview-reference'));
   if(width<=800)await until(()=>!document.querySelector('#canvas-panel'));
   await until(()=>document.activeElement?.getAttribute('contenteditable')==='true');
   await p.command('Input.insertText',{text:'导入后直接输入。'});await until(()=>document.querySelector('[contenteditable=true]').textContent.includes('导入后直接输入'));
   const snapshot=await getDraft();assert.equal(snapshot.resourceReference.annotations.length,3);assert.equal(snapshot.resourceReference.annotations[0].comment,'第二处修改后\n逐行要求');assert.notEqual(snapshot.resourceReference.annotations[1].id,snapshot.resourceReference.annotations[2].id);
   assert.equal(snapshot.resourceReference.source.id,formats[0].id);assert.equal(snapshot.resourceReference.source.sha256,createHash('sha256').update(baseText).digest('hex'));
   assert.equal(snapshot.attachments.length,1);assert.equal(snapshot.requestId,'annotation-draft');assert.deepEqual(snapshot.quotes,[]);assert.equal(f.submitted.length,sent);
   assert.equal(await ev(()=>getComputedStyle(document.querySelector('.resource-annotations-text')).webkitLineClamp),'none');
   await p.screenshot('composer-'+width+'.png');record('one file snapshot preserves body, attachment and request ID; CDP input proves real composer focus without submit');
   await open();await importAll();await until(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('已在输入草稿'));
   assert.deepEqual((await getDraft()).resourceReference,snapshot.resourceReference);record('same snapshot is not imported twice');
   await edit(1,'预览内修改尚未导入');assert.deepEqual((await getDraft()).resourceReference,snapshot.resourceReference);record('editing preview notes never mutates the imported snapshot');
   await close();formats[0].text='不同版本内容。';await open();assert.equal(await ev(()=>!!document.querySelector('.text-annotation-summary')),false);
   assert.deepEqual((await getDraft()).resourceReference,snapshot.resourceReference);await close();formats[0].text=baseText;await open();await expand();assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),3);record('new file hash starts empty; old-hash history snapshot and session notes stay exact');
   for(const n of [1,2,3])await edit(n,'x'.repeat(9000));
   await importAll();await until(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('合计过长'));
   assert.deepEqual((await getDraft()).resourceReference,snapshot.resourceReference);await expand();assert.equal(await ev(()=>[...document.querySelectorAll('.text-annotation-summary li p')].every(p=>p.textContent.length===9000)),true);record('combined intent limit rejects all notes atomically and retains preview and main drafts');
   await edit(1,'恢复第一处');await edit(2,'恢复第二处');await edit(3,'恢复第三处');
   if(width>800){
    await ev(()=>document.querySelector('[data-slot="canvas-split-body"]').scrollTop=500);await select('第30行合成内容，用于长文件滚动。');
    await click('[data-slot=selection-toolbar-quote]');await fill('滚动后备注');await save();
    const separator=await ev(()=>document.querySelector('.preview-separator').getBoundingClientRect().toJSON());
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:separator.x,y:450,button:'left',clickCount:1});for(let i=1;i<=5;i++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:separator.x+40*i,y:450,buttons:1,button:'left'});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:separator.x+200,y:450,button:'left',clickCount:1});
    await ev(()=>document.querySelector('[data-slot="canvas-split-body"]').scrollTop=0);await select('第一处中文摘录。');await click('[data-slot=selection-toolbar-quote]');await until(()=>!!document.querySelector('.text-annotation-editor'));
    assert.ok(await ev(()=>{const r=document.querySelector('.text-annotation-editor').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));await p.screenshot('dragged-editor.png');await button('取消');record('long preview scroll and actual split drag keep popup within available bounds');
   }
   assert.ok(await ev(()=>{const outer=document.querySelector('.conversation'),composer=document.querySelector('.composer-area');return outer.scrollHeight-outer.clientHeight===0&&Math.abs(composer.getBoundingClientRect().bottom-innerHeight)<1;}));
   await close();await p.navigate();await until(()=>!!document.querySelector('.composer-area .preview-reference'));await open();await expand();assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),3);assert.deepEqual((await getDraft()).resourceReference,snapshot.resourceReference);record('reload reconstructs only imported notes from the original composer draft');
   // Select action retained from an unmounted file must not create a note in B.
   await select('第一处中文摘录。');await ev(()=>{window.__oldSelectionAction=document.querySelector('[data-slot=selection-toolbar-quote]');});await open(1);await ev(()=>window.__oldSelectionAction.click());assert.equal(await ev(()=>!!document.querySelector('.text-annotation-editor')),false);record('unmounted old-file selection cannot annotate a later file');
   await ev(()=>document.querySelector('[role=tab][aria-selected=true], .canvas-collapse').focus({preventScroll:true}));await select('第二处中文摘录。');
   for(const key of ['Tab','Enter']){const code=key==='Tab'?9:13;await p.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'?{text:'\r'}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});}
   await fill('键盘多行备注');
   await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   assert.ok(await ev(()=>document.querySelector('.text-annotation-editor textarea').value.includes('\n')));assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),0);
   for(const key of ['Tab','Tab','Enter']){const code=key==='Tab'?9:13;await p.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,...(key==='Enter'?{text:'\r'}:{})});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});}
   await until(()=>!document.querySelector('.text-annotation-editor'));await expand();assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-summary li').length),1);record('Tab/Enter opens and saves note; Enter inside textarea inserts newline without submitting');
   await close();assert.equal(f.submitted.length,sent);
   const beforeAttempts=attempts.length;unknownSend=true;
   await ev(()=>document.querySelector('.send-button').click());await until(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')??'[]').length>0);
   await waitAttempts(beforeAttempts+1);const original=structuredClone(attempts.at(-1));assert.equal(original.resourceReference.annotations.length,3);
   await p.command('Input.insertText',{text:'未确认期间新草稿。'});
   await open(1);await importAll();if(width<=800)await until(()=>!document.querySelector('#canvas-panel'));
   await until(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReference?.source.id==='result-text-notes-B');
   const later=await getDraft();assert.equal(attempts.length,beforeAttempts+1);assert.equal(later.text,'未确认期间新草稿。');
   await p.navigate();await until(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')??'[]').length>0);
   assert.equal(attempts.length,beforeAttempts+1);assert.deepEqual(await ev(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')??'[]').at(-1).input),original);assert.deepEqual((await getDraft()).resourceReference,later.resourceReference);assert.equal((await getDraft()).text,later.text);
   assert.equal(f.submitted.length,sent);record('unknown receipt never auto-resends; persisted request keeps original file notes and ID while preserving a later draft');
   await close();assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure.json'),JSON.stringify({width,error:String(error),errors:p.errors,ui:await ev(()=>({notice:document.querySelector('.canvas-note[role=status]')?.textContent,editor:document.querySelector('.text-annotation-editor')?.textContent,active:document.activeElement?.outerHTML.slice(0,180)}))},null,2));throw error;}
  finally{formats[0].text=baseText;await p.close();}
 }
 writeFileSync(join(destination,'browser-results.json'),JSON.stringify({passed:true,checks,browser:chrome.version},null,2));
}finally{try{await chrome?.close();}finally{await f.close();}}
