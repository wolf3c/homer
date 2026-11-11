// Requirement-derived synthetic files. Real product UI, HTTP and pinned libraries;
// no installed app, account, model invocation or external network.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick,inspectHtmlFrame} from './helpers/html-preview-browser.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/annotation-composer-sync-implementation-20261025/browser');mkdirSync(destination,{recursive:true});
function png(){
 const crc=b=>{let n=0xffffffff;for(const x of b){n^=x;for(let k=0;k<8;k++)n=n>>>1^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const data=Buffer.concat([Buffer.from(name),b]),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(b.length);sum.writeUInt32BE(crc(data));return Buffer.concat([size,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(240);head.writeUInt32BE(120,4);head[8]=8;head[9]=2;const raw=Buffer.alloc(721*120);for(let y=0;y<120;y++)for(let x=0;x<240;x++){const i=y*721+1+x*3;raw[i]=55+x%160;raw[i+1]=120;raw[i+2]=180;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const files=[
 {id:'result-sync-text-a',title:'Synthetic.txt',mime:'text/plain',text:'第一处中文。\r\n第二处中文 😀。\r\n重复句。\r\n重复句。\r\n末尾。'},
 {id:'result-sync-text-b',title:'Synthetic.txt',mime:'text/plain',text:'其他文件中文。'},
 {id:'result-sync-markdown',title:'Synthetic.md',mime:'text/markdown',text:'第一段 **跨 strong** 与 [链接](https://example.com)。\n\n重复句。\n\n重复句。\n\n| 列一 | 列二 |\n|---|---|\n| 内容 | 表格 |\n\n- 清单一\n- 清单二\n\n公式 $x^2+1$ 与结束。'},
 {id:'result-sync-html',title:'Synthetic.html',mime:'text/html',text:'<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;padding:20px}h1,h2,h3{padding:15px 5px}</style><h1>HTML 第一处</h1><h2>HTML 第二处</h2><h3>HTML 第三处</h3><script>document.body.dataset.executed="yes"</script>'},
 {id:'result-sync-image',title:'Synthetic.png',mime:'image/png',bytes:png()},
 {id:'result-sync-code',title:'Synthetic.ts',mime:'application/javascript',text:"const emoji = '😀';\r\n\tconsole.log(emoji);\r\n"},
];
for(const file of files){file.bytes??=Buffer.from(file.text);file.hash=createHash('sha256').update(file.bytes).digest('hex');}
const f=await fixture(4,'after'),checks=[],uploads=[],discards=[],attempts=[];let chrome,failDiscard=false,holdUpload=false,releaseUpload,failUpload=false;
f.bridge.artifact=async id=>{const file=files.find(x=>x.id===id);if(!file)throw Error('synthetic_file_missing');return {filename:file.title,mime:file.mime,data:file.bytes.toString('base64'),sha256:file.hash};};
f.bridge.media.upload=async input=>{uploads.push({threadId:input.threadId,requestId:input.requestId,uploadId:input.uploadId});if(holdUpload)await new Promise(done=>{releaseUpload=done;});if(failUpload)throw Error('synthetic_upload_rejected');return {assetId:'asset-'+input.uploadId,revision:1,filename:input.filename,kind:'image',state:'ready',mime:'image/png',size:files[4].bytes.length,error:null};};
f.bridge.media.discard=async input=>{discards.push(input);if(failDiscard)throw Error('synthetic_discard_rejected');return {state:'removed'};};
f.bridge.submit=async input=>{attempts.push(structuredClone(input));throw Error('synthetic_unknown_receipt');};
{const owner=f.bridge.history;const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,features:{...value.features,draftUpload:true},artifacts:[...(value.artifacts??[]),...files.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic annotations'}))]};};}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 chrome=await isolatedChrome(destination);
 for(const width of process.env.HOMER_TEST_WIDTHS?.split(',').map(Number)??[1440,390,320]){
  const p=await chrome.page(f.server.url,width);let frame;
  const ev=x=>p.evaluate(x),until=x=>p.until(x,10000),record=label=>{checks.push({width,label});console.log(width,label);};
  const click=async selector=>{await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return false;const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&el.contains(hit);})()`);await actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));};
  const close=async()=>{await frame?.close();frame=undefined;await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)')?.click());await until(()=>!document.querySelector('#canvas-panel'));};
  const open=async index=>{if(width<=800&&await ev(()=>!!document.querySelector('#canvas-panel')))await close();await ev(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].filter(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+files[index].title)})[${files.slice(0,index).filter(file=>file.title===files[index].title).length}];b.scrollIntoView({block:'center'});b.click()})()`);await until(()=>!!document.querySelector('#canvas-panel'));if(index===2)await until(()=>document.querySelector('.canvas-markdown')?.textContent.includes('第一段'));else if(files[index].text&&index!==3)await until(`document.querySelector('[data-preview-text]')?.textContent===${JSON.stringify(files[index].text)}`);};
  const draft=()=>ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')));
  const count=()=>ev(()=>document.querySelectorAll('.annotation-chip').length);
  const select=async(text,occurrence=0)=>{await ev(`(()=>{const el=document.querySelector('[data-preview-text]'),walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];let n;while(n=walk.nextNode())nodes.push(n);let all=nodes.map(n=>n.textContent).join(''),at=-1;for(let i=0;i<=${occurrence};i++)at=all.indexOf(${JSON.stringify(text)},at+1);if(at<0)throw Error('missing selection');let start=at,end=at+${text.length},r=document.createRange(),offset=0;for(const node of nodes){if(start>=offset&&start<offset+node.length)r.setStart(node,start-offset);if(end>offset&&end<=offset+node.length){r.setEnd(node,end-offset);break;}offset+=node.length;}getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);await until(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]'));};
  const fill=async(text,selector='.annotation-comment-form textarea')=>{await ev(`(()=>{const t=document.querySelector(${JSON.stringify(selector)});t.focus();t.select();})()`);await p.command('Input.insertText',{text});};
  const save=async()=>{await click('.annotation-comment-form button[type=submit]');await until(()=>!document.querySelector('.annotation-comment-form'));};
  const note=async(text,comment,occurrence=0)=>{await select(text,occurrence);await click('[data-slot=selection-toolbar-quote]');await until(()=>!!document.querySelector('.annotation-comment-form textarea'));if(width===320&&comment==='第一注'){await p.command('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal(await ev(()=>!!document.querySelector('.annotation-comment-form')),true);}
   await fill(comment);await save();};
  try{
   const attemptStart=attempts.length,uploadStart=uploads.length;
   await p.navigate();await until(()=>!!document.querySelector('[contenteditable=true]'));
   await open(0);await until(()=>document.querySelector('[data-preview-text]')?.textContent.includes('第一处'));
   await note('第一处中文。','第一注');await note('第二处中文 😀。','第二注');await note('重复句。','第二个重复句',1);
   assert.equal(await count(),3);assert.ok(await ev(()=>!!document.querySelector('#canvas-panel')));assert.equal(attempts.length,attemptStart);
   let saved=await draft();assert.equal(saved.resourceReferences.length,1);assert.equal(saved.resourceReferences[0].annotations[2].anchor.start,files[0].text.lastIndexOf('重复句。'));
   assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-marker').length),3);assert.equal(await ev(()=>!!document.querySelector('.text-annotation-summary')),false);record('text saves three independent chips and exact second occurrence; no intermediate import or message request');
   await until(()=>document.querySelector('.text-annotation-marker:nth-child(2)')?.getAttribute('aria-label').includes('第二注'));await click('.text-annotation-marker:nth-child(2)');await until(()=>!!document.querySelector('.annotation-comment-form textarea'));await fill('第二注修改');await save();
   assert.equal((await draft()).resourceReferences[0].annotations[1].comment,'第二注修改');
   await ev(()=>document.querySelector('.annotation-chip-remove').click());await until(()=>document.querySelectorAll('.text-annotation-marker').length===2);record('edit second and delete first chip update the same saved notes without remounting the source');
   await close();await open(0);assert.equal(await ev(()=>document.querySelectorAll('.text-annotation-marker').length),2);
   await click('.text-annotation-marker');await fill('取消输入');await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until(()=>!document.querySelector('.annotation-comment-form'));assert.ok(await ev(()=>!!document.querySelector('#canvas-panel')));assert.equal((await draft()).resourceReferences[0].annotations[0].comment,'第二注修改');record('close and reopen preserve saved context; Escape cancels the temporary edit and leaves preview open');
   await open(1);await note('其他文件中文。','跨来源备注');assert.equal((await draft()).resourceReferences.length,2);record('switching sources preserves all saved groups');
   await open(2);await note('第一段 跨 strong 与 链接。','跨节点备注');await note('重复句。','Markdown 第二处',1);
   // Select only a visual glyph inside KaTeX: product expands it to the atomic TeX.
   await ev(()=>{const el=document.querySelector('[data-preview-math] .katex-html'),walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while((n=walk.nextNode())&&!n.textContent.trim()){}const r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});await until(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]'));await click('[data-slot=selection-toolbar-quote]');await fill('公式整式备注');await save();
   let md=(await draft()).resourceReferences.find(r=>r.source.id===files[2].id);assert.equal(md.annotations[2].text,'$x^2+1$');assert.equal(md.annotations[0].anchor.exact,'第一段 跨 strong 与 链接。');record('Markdown cross-node and repeated text plus partial formula selection restore exact UTF-16 logical ranges');
   await note('内容表格','表格跨单元格备注');await ev(()=>{const items=document.querySelectorAll('[data-preview-text] li'),r=document.createRange();r.setStart(items[0].firstChild,0);r.setEnd(items[1].firstChild,items[1].firstChild.textContent.length);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});await until(()=>!!document.querySelector('[data-slot=selection-toolbar-quote]'));await click('[data-slot=selection-toolbar-quote]');await fill('跨列表备注');await save();md=(await draft()).resourceReferences.find(r=>r.source.id===files[2].id);assert.equal(md.annotations[3].text,'内容\t表格');assert.equal(md.annotations[4].text,'清单一\n清单二');
   await open(5);await note("const emoji = '😀';",'代码 CRLF emoji 备注');record('table cells, list blocks, code and CRLF/emoji serialize and restore without searching the first match');
   await close();await p.navigate();await until(()=>document.querySelectorAll('.annotation-chip').length===9);await open(2);await until(()=>document.querySelectorAll('.text-annotation-marker').length===5);record('refresh restores every saved group and all text anchors');
   await close();await ev(()=>{window.__htmlEvents=[];addEventListener('message',e=>{if(e.data?.type==='homer-preview-notes')window.__htmlEvents.push({type:e.data.type,count:e.data.notes?.length,size:e.data.notes?.map(n=>n.comment.length),baseRevision:e.data.baseRevision});});});await open(3);await until(()=>!!document.querySelector('.html-annotation-toggle'));await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true');
   frame=await inspectHtmlFrame(chrome,p,'!!document.querySelector("agentation-toolbar")?.shadowRoot');
   const fe=x=>frame.evaluate(x),fu=x=>frame.until(x);
   const fc=async selector=>{const a=await fe(`__q(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`),b=await ev(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getBoundingClientRect().toJSON());await actualClick(p,{...a,x:a.x+b.x,y:a.y+b.y});};
   for(const [index,target] of ['h1','h2','h3'].entries()){
    await fc(target);await fu('!!__q("textarea[placeholder^=What]")');await delay(220);await fc('textarea[placeholder^=What]');await chrome.command('Input.insertText',{text:'网页备注 '+index},frame.sessionId);await fe('__all("button").find(b=>b.textContent==="Add").setAttribute("data-test-save","")');await fc('[data-test-save]');await fu('!__q("textarea[placeholder^=What]")');
   }
   saved=await draft();assert.equal(saved.resourceReferences.find(r=>r.kind==='web').annotations.length,3);assert.ok(Object.values(saved.htmlMetadata).flatMap(Object.values).every(value=>!('comment' in value)&&!('elementPath' in value)));assert.equal(await fe('!!__q("[aria-label^=Send]:not([aria-hidden=true])")'),false);assert.equal(attempts.length,attemptStart);assert.equal((await ev(()=>window.__htmlEvents)).length,3);record('real Agentation saves each Add into the composer; native Send is naturally unavailable');
   const htmlKey=saved.resourceReferences.find(r=>r.kind==='web').annotations[0].id;
   const htmlEventsBeforeRemove=(await ev(()=>window.__htmlEvents)).length;
   const editHtml=async(index=0)=>{
    await fe(`__all("button").filter(b=>b.getAttribute("aria-label")?.startsWith("Edit annotation"))[${index}].setAttribute("data-test-edit","")`);await fc('[data-test-edit]');await fu('!!__q("[data-annotation-popup] textarea:not(:disabled)")');await delay(300);
   };
   const fillHtml=async text=>{await fc('[data-annotation-popup] textarea');await fe('__q("[data-annotation-popup] textarea").select()');await chrome.command('Input.insertText',{text},frame.sessionId);await delay(80);};
   const saveHtml=async()=>{await fe('__all("button").find(b=>b.textContent==="Save"&&b.closest("[data-annotation-popup]")).setAttribute("data-test-save-edit","")');await fc('[data-test-save-edit]');};
   if(width===1440){await editHtml(1);await fillHtml('网页第二处临时输入');}

   await ev(()=>[...document.querySelectorAll('.annotation-chip-remove')].find(b=>b.getAttribute('aria-label').includes('Synthetic.html')).click());
   await fu('__all("button").filter(b=>b.getAttribute("aria-label")?.startsWith("Edit annotation")).length===2');
   assert.equal((await draft()).resourceReferences.find(r=>r.kind==='web').annotations.some(n=>n.id===htmlKey),false);assert.equal((await ev(()=>window.__htmlEvents)).length,htmlEventsBeforeRemove);record('parent deletion removes the native HTML marker without recreating the iframe');
   if(width===1440){
    assert.equal(await fe('__q("[data-annotation-popup] textarea").value'),'网页第二处临时输入');await saveHtml();await fu('!__q("[data-annotation-popup]")');
    assert.equal((await draft()).resourceReferences.find(r=>r.kind==='web').annotations[0].comment,'网页第二处临时输入');record('deleting another HTML note preserves the native editor and saves the same ID in place');
    await editHtml();await fillHtml('长'.repeat(16001));assert.equal(await fe('__q("[data-annotation-popup] textarea").value.length'),16001);await saveHtml();await fu('!!__q("[role=alert]")');
    assert.equal(await fe('__q("[data-annotation-popup] textarea").value.length'),16001);assert.equal((await draft()).resourceReferences.find(r=>r.kind==='web').annotations[0].comment,'网页第二处临时输入');
    await fillHtml('网页拒绝后修改');await saveHtml();await fu('!__q("[data-annotation-popup]")');record('native HTML oversized update is rejected atomically, retains input and accepts a corrected save');
    await editHtml();await fillHtml('正在编辑的条目被删除');await ev(()=>[...document.querySelectorAll('.annotation-chip-remove')].find(b=>b.getAttribute('aria-label').includes('Synthetic.html')).click());await fu('!__q("[data-annotation-popup]")');
    await fc('[aria-label="Clear all"]');await until(()=>!JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReferences.some(r=>r.kind==='web'));await delay(350);
    assert.equal(await fe('__all("button").filter(b=>b.getAttribute("aria-label")?.startsWith("Edit annotation")).length'),0);record('deleting the edited HTML note and native clear to zero cannot revive saved entries');
    await fc('h1');await fu('!!__q("textarea[placeholder^=What]")');await delay(220);await fc('textarea[placeholder^=What]');await chrome.command('Input.insertText',{text:'网页重新保存'},frame.sessionId);await fe('__all("button").find(b=>b.textContent==="Add").setAttribute("data-test-save","")');await fc('[data-test-save]');await fu('!__q("textarea[placeholder^=What]")');
   }

   await close();await open(4);await until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));
   for(const [i,v] of [[.05,.12,.24,.4],[.36,.12,.55,.4],[.69,.12,.88,.4]].entries()){
    const r=await ev(()=>document.querySelector('.image-annotation img').getBoundingClientRect().toJSON()),start={x:r.x+r.width*v[0],y:r.y+r.height*v[1]},end={x:r.x+r.width*v[2],y:r.y+r.height*v[3]};
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});for(let k=1;k<=6;k++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(end.x-start.x)*k/6,y:start.y+(end.y-start.y)*k/6,button:'left',buttons:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
    await until(()=>!!document.querySelector('.image-annotation textarea'));await fill('图片备注 '+i);await save();
   }
   assert.equal(uploads.length-uploadStart,1);assert.equal((await draft()).resourceReferences.find(r=>r.kind==='image').annotations.length,3);record('real Annotorious saves three regions while preparing just one original image');
   const imageNotes=(await draft()).resourceReferences.find(r=>r.kind==='image').annotations;
   const editImage=async id=>{await click('.a9s-annotation[data-id="'+id+'"] .a9s-inner');await until(()=>!!document.querySelector('.image-annotation textarea'));};
   if(width===1440){
    await editImage(imageNotes[1].id);await fill('图片第二注修改');await save();
    assert.deepEqual((await draft()).resourceReferences.find(r=>r.kind==='image').annotations.map(n=>n.id),imageNotes.map(n=>n.id));
    await editImage(imageNotes[1].id);await fill('图片临时修改');
   }
   await ev(()=>[...document.querySelectorAll('.annotation-chip-remove')].find(b=>b.getAttribute('aria-label').includes('Synthetic.png')).click());await until(()=>document.querySelectorAll('.image-region-number').length===2);assert.equal(discards.filter(x=>x.requestId===(saved.requestId)).length,0);record('removing one image chip removes one rectangle and retains the original attachment');
   if(width===1440){
    assert.equal(await ev(()=>document.querySelector('.image-annotation textarea').value),'图片临时修改');await save();assert.equal((await draft()).resourceReferences.find(r=>r.kind==='image').annotations[0].comment,'图片临时修改');record('image edit preserves saved ID/order and deleting another note keeps the current editor input');
    await editImage(imageNotes[1].id);const beforeGeometry=(await draft()).resourceReferences.find(r=>r.kind==='image').annotations[0].region;
    const nativeHandles=()=>ev(()=>[...document.querySelectorAll('.a9s-handle-dot')].map(h=>[Number(h.getAttribute('cx')),Number(h.getAttribute('cy'))]));
    const beforeHandles=await nativeHandles();assert.ok(beforeHandles.length>=4);
    const h=await ev(()=>document.querySelectorAll('.a9s-handle-dot')[1].getBoundingClientRect().toJSON()),x=h.x+h.width/2,y=h.y+h.height/2;
    await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});for(let n=1;n<=6;n++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+12*n/6,y:y+8*n/6,button:'left',buttons:1});await delay(300);await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+12,y:y+8,button:'left',clickCount:1});await until(()=>!!document.querySelector('.image-annotation textarea'));
    assert.notDeepEqual(await nativeHandles(),beforeHandles,'the real native handle drag must change geometry before cancellation');
    await click('.annotation-comment-actions button[type=button]:not([aria-label])');assert.deepEqual((await draft()).resourceReferences.find(r=>r.kind==='image').annotations[0].region,beforeGeometry);
    await editImage(imageNotes[1].id);assert.deepEqual(await nativeHandles(),beforeHandles,'reopening the native editor restores every saved handle coordinate');await click('.annotation-comment-actions button[type=button]:not([aria-label])');record('cancel native image handle edit restores the last saved geometry and comment in both draft and native editor');
    const imageBeforeDiscard=(await draft()).resourceReferences.find(r=>r.kind==='image');await close();failDiscard=true;
    await click('[aria-label^="移除原图及"]');await until(()=>document.querySelector('.draft-notice')?.textContent.includes('移除未确认'));assert.deepEqual((await draft()).resourceReferences.find(r=>r.kind==='image'),imageBeforeDiscard);assert.equal(await ev(()=>document.querySelectorAll('.aui-attachment-root').length),1);failDiscard=false;record('failed original-image discard retains the image and every annotation');
    // Remove all annotations without discarding the image, then reopen and save
    // another rectangle through the same confirmed asset identity.
    for(let i=0;i<2;i++)await ev(()=>[...document.querySelectorAll('.annotation-chip-remove')].find(b=>b.getAttribute('aria-label').includes('Synthetic.png')).click());await until(()=>!JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReferences.some(r=>r.kind==='image'));
    assert.equal(await ev(()=>document.querySelectorAll('.aui-attachment-root').length),1);const prepared=uploads.length;
    await open(4);await until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));
    const drawOne=async()=>{const r=await ev(()=>document.querySelector('.image-annotation img').getBoundingClientRect().toJSON());await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width*.1,y:r.y+r.height*.1,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width*.3,y:r.y+r.height*.4,button:'left',buttons:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width*.3,y:r.y+r.height*.4,button:'left',clickCount:1});await until(()=>!!document.querySelector('.image-annotation textarea'));};
    await drawOne();await fill('原图保留后新注');await save();assert.equal(uploads.length,prepared);record('deleting the last image note keeps an ordinary attachment; saving again reuses its exact asset');
    await close();await click('[aria-label^="移除原图及"]');await until(()=>document.querySelectorAll('.aui-attachment-root').length===0);assert.equal((await draft()).resourceReferences.some(r=>r.kind==='image'),false);
    holdUpload=true;await open(4);await until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));await drawOne();await fill('上传中切文件保存');await click('.annotation-comment-form button[type=submit]');for(let n=0;n<100&&!releaseUpload;n++)await delay(20);assert.ok(releaseUpload);await until(()=>Object.keys(JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).preparingImages??{}).length===1);assert.equal(await ev(()=>document.querySelector('.send-button').disabled),true);
    await close();await open(1);releaseUpload();releaseUpload=undefined;holdUpload=false;await until(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReferences.some(r=>r.kind==='image'));assert.equal((await draft()).resourceReferences.find(r=>r.kind==='image').annotations[0].comment,'上传中切文件保存');record('preparing chip blocks Send; late upload after source switch finalizes only its original saved source');
    await close();await click('[aria-label^="移除原图及"]');await until(()=>document.querySelectorAll('.aui-attachment-root').length===0);
    failUpload=true;await open(4);await until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));await drawOne();await fill('上传失败保留注');await click('.annotation-comment-form button[type=submit]');await until(()=>!!document.querySelector('.composer-upload-actions'));const failed=uploads.at(-1).uploadId;assert.equal(await ev(()=>document.querySelector('.send-button').disabled),true);failUpload=false;
    await close();await click('.composer-upload-actions button:first-child');await until(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReferences.some(r=>r.kind==='image'));assert.equal(uploads.at(-1).uploadId,failed);record('upload failure retains the preparing note and explicit retry uses the original upload ID');
    await open(4);await until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await click('.image-annotation-toggle');await until(()=>document.querySelectorAll('.image-region-number').length===1);
   }
   await p.screenshot('preview-'+width+'.png');await close();await p.screenshot('composer-'+width+'.png');
   assert.ok(await ev(()=>{const r=document.querySelector('.send-button').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth;}));
   const ax=await p.command('Accessibility.getFullAXTree');assert.ok(ax.nodes.some(n=>n.role?.value==='button'&&n.name?.value.startsWith('打开 Synthetic.txt 的批注')));
   if(width===320){await p.command('Emulation.setDeviceMetricsOverride',{width:320,height:480,deviceScaleFactor:1,mobile:false});assert.ok(await ev(()=>{const r=document.querySelector('.send-button').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth;}));await p.screenshot('composer-low-320.png');await p.command('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false});record('320px low-height layout keeps Send visible; annotation chips retain accessible button names');}
   assert.equal(attempts.length,attemptStart);assert.equal(p.requests.filter(r=>r.path==='/api/messages').length,0);
   const beforeSend=await draft();await click('.send-button');await until(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')??'[]').length>0);for(let n=0;n<100&&attempts.length<attemptStart+1;n++)await delay(30);assert.equal(attempts.length,attemptStart+1);assert.deepEqual(attempts.at(-1).resourceReferences,beforeSend.resourceReferences);assert.equal(await count(),0);record('only actual composer Send creates a message request and clears the new draft views');
   const original=structuredClone(attempts.at(-1));await p.navigate();await until(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')??'[]').length>0);assert.equal(attempts.length,attemptStart+1);assert.deepEqual(await ev(()=>JSON.parse(sessionStorage.getItem('homer-unconfirmed:synthetic-history')??'[]').at(-1).input),original);assert.equal(await ev(()=>!!document.querySelector('.unconfirmed-inputs,.queue-operation-notice')),false);record('refresh never auto-replays unknown receipt; persisted snapshot retains original ID and every field');
   if(width===1440){
    await ev(()=>sessionStorage.setItem('homer-draft:synthetic-history',JSON.stringify({text:'保留正文',quotes:[{messageId:'node-3',text:'合成答复 3',annotation:''}],requestId:'synthetic-quote-draft'})));await p.navigate();await until(()=>!!document.querySelector('[data-slot=composer-quote]'));await open(0);await select('第一处中文。');await click('[data-slot=selection-toolbar-quote]');await fill('拒绝时保留的输入');await click('.annotation-comment-form button[type=submit]');await until(()=>document.querySelector('.annotation-comment-form [role=alert]')?.textContent.includes('当前消息引用'));
    assert.equal((await draft()).quotes.length,1);assert.equal(await ev(()=>document.querySelector('.annotation-comment-form textarea').value),'拒绝时保留的输入');assert.equal(await count(),0);record('existing message quote rejects annotation save visibly and preserves both the quote and editor input');
    await click('.annotation-comment-actions button[type=button]:not([aria-label])');await click('[data-slot=composer-quote-dismiss]');await note('第一处中文。','互斥检查备注');assert.equal(await ev(()=>!!document.querySelector('.message-actions [aria-label="引用"]')),false);assert.equal(await count(),1);assert.equal(await ev(()=>!!document.querySelector('[data-slot=composer-quote]')),false);record('copy-only message actions leave saved annotation context intact');
    await ev(()=>{window.__storageOriginal=Storage.prototype.setItem;Object.defineProperty(Storage.prototype,'setItem',{configurable:true,value:function(key,value){if(key.startsWith('homer-draft:'))throw new DOMException('Synthetic quota','QuotaExceededError');return window.__storageOriginal.call(this,key,value);}});});await note('第二处中文 😀。','仅本页保留备注');await until(()=>document.querySelector('.draft-notice')?.textContent.includes('仅本次页面保留'));assert.equal(await count(),2);assert.equal((await draft()).resourceReferences[0].annotations.length,1);
    await ev(()=>{Object.defineProperty(Storage.prototype,'setItem',{configurable:true,value:window.__storageOriginal});});record('session storage failure stays visible while the complete saved notes remain in the page');
    await close();await click('.annotation-chip-open');await until(()=>!!document.querySelector('.annotation-comment-form'));assert.equal(await ev(()=>document.querySelector('.annotation-comment-form blockquote').textContent),'第一处中文。');await click('.annotation-comment-actions button[type=button]:not([aria-label])');await p.screenshot('text-highlights-1440.png');record('chip opens the exact same-name artifact and focuses its verified saved range');
    assert.equal(attempts.length,attemptStart+2);
    // Full ordinary attachment capacity must reject before saving a preparing
    // image note, while preserving the native editor for a corrected draft.
    await ev(()=>sessionStorage.setItem('homer-draft:synthetic-history',JSON.stringify({text:'保留十个附件',quotes:[],requestId:'synthetic-full-attachments',attachments:Array.from({length:10},(_,i)=>({assetId:'asset-00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),revision:1,filename:'ordinary-'+i+'.txt',kind:'file',state:'ready',mime:'text/plain',size:1,error:null}))})));
    await p.navigate();await until(()=>document.querySelectorAll('.aui-attachment-root').length===10);await open(4);await until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await click('.image-annotation-toggle');await until(()=>!!document.querySelector('.a9s-annotationlayer'));
    const fullUploads=uploads.length,fullBox=await ev(()=>document.querySelector('.image-annotation img').getBoundingClientRect().toJSON());
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:fullBox.x+fullBox.width*.1,y:fullBox.y+fullBox.height*.1,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:fullBox.x+fullBox.width*.3,y:fullBox.y+fullBox.height*.4,button:'left',buttons:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:fullBox.x+fullBox.width*.3,y:fullBox.y+fullBox.height*.4,button:'left',clickCount:1});await until(()=>!!document.querySelector('.image-annotation textarea'));
    await fill('附件已满时保留编辑');await click('.annotation-comment-form button[type=submit]');await until(()=>!!document.querySelector('.annotation-comment-form [role=alert]'));
    assert.equal(await count(),0);assert.equal(uploads.length,fullUploads);assert.equal(Object.keys((await draft()).preparingImages??{}).length,0);assert.equal(await ev(()=>document.querySelector('.image-annotation textarea').value),'附件已满时保留编辑');assert.equal(await ev(()=>document.querySelectorAll('.aui-attachment-root').length),10);record('full attachment capacity rejects image save before chip or upload and retains all existing data and editor input');
   }

   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  }catch(error){await p.screenshot('failure-'+width+'.png');writeFileSync(join(destination,'failure-'+width+'.json'),JSON.stringify({error:String(error.stack),checks,events:await ev(()=>window.__htmlEvents),errors:p.errors,native:frame?await frame.evaluate('({text:__all("[role=alert]").map(e=>e.textContent),inputs:__all("textarea").map(e=>({length:e.value.length,disabled:e.disabled,placeholder:e.placeholder})),popups:__all("[data-annotation-popup]").length})').catch(()=>null):undefined,body:await ev(()=>document.body.innerText)},null,2));throw error;}
  finally{await frame?.close();await p.close();}
 }
 writeFileSync(join(destination,'results.json'),JSON.stringify({passed:true,checks,browser:chrome.version,uploads:uploads.length,attempts:attempts.length,modelCalls:f.fakeEngine.invocations},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{holdUpload=false;releaseUpload?.();await chrome?.close();await f.close();}
