// Built UI + real synthetic queue/HTTP, isolated Chrome; no user data or engine.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/canvas-implementation-20261023/browser');
mkdirSync(destination,{recursive:true});
const checks=[],uploads=[];let chrome;
async function accepted(count){for(let n=0;n<300&&f.submitted.length<count;n++)await new Promise(done=>setTimeout(done,20));assert.equal(f.submitted.length,count);}
function png(){
 const crc=b=>{let n=0xffffffff;for(const x of b){n^=x;for(let k=0;k<8;k++)n=n>>>1^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const data=Buffer.concat([Buffer.from(name),b]),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(b.length);sum.writeUInt32BE(crc(data));return Buffer.concat([size,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(240);head.writeUInt32BE(120,4);head[8]=8;head[9]=2;
 const raw=Buffer.alloc(721*120);for(let y=0;y<120;y++)for(let x=0;x<240;x++){const i=y*721+1+x*3;raw[i]=55+x%160;raw[i+1]=120;raw[i+2]=180;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const f=await fixture(4,'after');
const formats=[{id:'result-preview-text',title:'Synthetic.txt',mime:'text/plain',bytes:Buffer.from('Exact synthetic text for quotation.')},{id:'result-preview-image',title:'Synthetic.png',mime:'image/png',bytes:png()}];
const textAndImage=f.attach('Synthetic formats',formats.map(({title,mime,bytes})=>({filename:title,mime,content:bytes})));
const originalReference={kind:'text',source:{kind:'attachment',messageId:textAndImage.messageId,...textAndImage.attachments[0],title:formats[0].title,sha256:createHash('sha256').update(formats[0].bytes).digest('hex')},text:'Original request preview excerpt'};
try{
 const html=f.attach('Synthetic preview reply',[{filename:'synthetic-preview.html',mime:'text/html',content:'<!doctype html><h1>Target title</h1><button id="target" style="font-size:24px;margin:30px;padding:25px">Change this button</button>'}]);
 f.bridge.media.upload=async input=>{uploads.push(input);return {assetId:'asset-'+input.uploadId,revision:1,filename:input.filename,kind:'image',state:'ready',mime:'image/png',size:Buffer.from(input.data,'base64').length,error:null};};
 f.bridge.media.discard=async()=>({ok:true});
 for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const value=await state();return {...value,messages:value.messages.map(m=>m.id==='node-3'?{...m,source:{id:'synthetic-original-request',threadId:'synthetic-history',requestId:'synthetic-original',role:'user',text:'Original user requirement',status:'completed',createdAt:1700000000000,resourceReference:originalReference},sources:[{id:'link-1',title:'Synthetic webpage',url:f.server.url+'/preview/interactive'}]}:m),features:{...value.features,draftUpload:true}};};}
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=code=>p.evaluate(code);
  p.until=async expr=>{const end=Date.now()+15000;while(Date.now()<end){if(p.errors.length)throw Error(p.errors[0]);if(await ev(expr))return;await new Promise(done=>setTimeout(done,40));}throw Error('preview_condition_timeout: '+String(expr));};
  const button=text=>ev(`(()=>{const b=[...document.querySelectorAll('#canvas-panel button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw Error('missing button '+${JSON.stringify(text)});b.click()})()`);
  const select=async id=>{
   if(width<=800&&await ev(()=>!!document.querySelector('#canvas-panel'))){await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());await p.until(()=>!document.querySelector('#canvas-panel'));}
   const title=formats.find(file=>file.id===id)?.title??'synthetic-preview.html';
   await p.until(`Array.from(document.querySelectorAll('.file-list-open')).some(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+title)})`);
   await ev(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+title)});if(!b)throw Error('missing chat file');b.scrollIntoView({block:'center'});b.focus();b.click();})()`);
   await p.until(()=>!!document.querySelector('#canvas-panel'));
  };
  const open=select;
  const check=async(label,test)=>{assert.ok(await ev(test),label);checks.push({width,label});console.log(width,label);};
  try{
   await p.navigate();await p.until(()=>!!document.querySelector('.conversation-header [aria-controls="canvas-panel"]'));
   assert.ok(p.requests.every(request=>!/^\/assets\/(?:image-annotation|runtime)-.*\.js$/.test(request.path)));
   checks.push({width,label:'ordinary conversation does not load image or webpage annotation runtimes'});
   await open(formats[0].id);await p.until(()=>document.querySelector('[data-preview-text]')?.textContent==='Exact synthetic text for quotation.');
   await ev(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('[data-preview-text]'));const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
   await p.until(()=>!!document.querySelector('.preview-selection-positioner button:not(:disabled)'));
   await button('批注');await p.until(()=>!!document.querySelector('.text-annotation-editor textarea'));
   await p.command('Input.insertText',{text:'Explain this excerpt'});
   await ev(()=>document.querySelector('.text-annotation-editor button[type=submit]').click());
   await p.until(()=>!document.querySelector('.text-annotation-editor'));
   await ev(()=>document.querySelector('.text-annotation-actions>button').click());
   await p.until(()=>!!document.querySelector('.composer-area .preview-reference'));
   if(width<=800)await p.until(()=>!document.querySelector('#canvas-panel'));
   await check('selected exact text reaches main composer with source and no message sent',()=>document.querySelector('.composer-area .preview-reference').textContent.includes('Exact synthetic text')&&document.querySelector('.composer-area .preview-reference').textContent.includes('Synthetic.txt'));
   const sent=f.submitted.length;
   await ev(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'Explain this exact excerpt'});
   await ev(()=>document.querySelector('.send-button').click());await p.until(()=>!document.querySelector('.composer-area .preview-reference'));
   await accepted(sent+1);const textInput=f.inputs.list().find(x=>x.input.requestId===f.submitted.at(-1)).input;
   assert.equal(textInput.resourceReference.kind,'text');assert.equal(textInput.resourceReference.source.messageId,textAndImage.messageId);assert.equal(textInput.resourceReference.source.assetId,textAndImage.attachments[0].assetId);assert.equal(textInput.resourceReference.annotations[0].text,'Exact synthetic text for quotation.');
   checks.push({width,label:'text reference survives real HTTP and original main queue'});
   await open(formats[1].id);await p.until(()=>document.querySelector('#canvas-panel img')?.naturalWidth===240);await ev(()=>document.querySelector('.image-annotation-toggle').click());
   await p.until(()=>!!document.querySelector('.a9s-annotationlayer'));
   const rect=await ev(()=>document.querySelector('.image-annotation img').getBoundingClientRect().toJSON());
   const x=rect.left+rect.width*.15,y=rect.top+rect.height*.2,x2=rect.left+rect.width*.6,y2=rect.top+rect.height*.7;
   const drawRegion=async()=>{
   if(width<=800){
    await p.command('Emulation.setTouchEmulationEnabled',{enabled:true});
    await p.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let n=1;n<=5;n++)await p.command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(x2-x)*n/5,y:y+(y2-y)*n/5}]});
    await p.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.command('Emulation.setTouchEmulationEnabled',{enabled:false});
   }else{
   await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
   for(let n=1;n<=5;n++)await p.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+(x2-x)*n/5,y:y+(y2-y)*n/5,button:'left',buttons:1});
   await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:x2,y:y2,button:'left',clickCount:1});
   }
   };
   await drawRegion();
   await p.until(()=>!!document.querySelector('.image-annotation-comment textarea'));
   await ev(()=>document.querySelector('.image-annotation-comment textarea').focus());await p.command('Input.insertText',{text:'Adjust this selected area'});
   await p.screenshot('image-region-'+width+'.png');await button('保存');await p.until(()=>!document.querySelector('.image-annotation-comment'));await ev(()=>document.querySelector('.image-add-regions').click());
   await p.until(()=>document.querySelector('.composer-area .preview-reference')?.textContent.includes('Adjust this selected area'));
   if(width<=800)await p.until(()=>!document.querySelector('#canvas-panel'));
   await check('Annotorious rectangle and comment reach original composer attachment flow',()=>!!document.querySelector('.composer-area .aui-attachment-root')&&document.querySelector('.composer-area .preview-reference').textContent.includes('Synthetic.png'));
   if(width===1440){
    const previous=uploads.at(-1);
    await ev(()=>document.querySelector('.aui-attachment-tile-remove').click());
    await p.until(()=>!document.querySelector('.composer-area .aui-attachment-root')&&!document.querySelector('.composer-area .preview-reference'));
    await ev(()=>document.querySelector('.image-annotation-toggle').click());await p.until(()=>!!document.querySelector('.a9s-annotationlayer'));
    await drawRegion();await p.until(()=>!!document.querySelector('.image-annotation-comment textarea'));
    await ev(()=>document.querySelector('.image-annotation-comment textarea').focus());await p.command('Input.insertText',{text:'Adjust this selected area'});await button('保存');await p.until(()=>!document.querySelector('.image-annotation-comment'));await ev(()=>document.querySelector('.image-add-regions').click());
    await p.until(()=>!!document.querySelector('.composer-area .preview-reference')&&!document.querySelector('.send-button').disabled);
    assert.notEqual(uploads.at(-1).uploadId,previous.uploadId);
    assert.equal(uploads.at(-1).requestId,previous.requestId);
    assert.equal(uploads.at(-1).data,previous.data);
    checks.push({width,label:'remove and re-add the same preview File uploads a new identity in the same draft'});
   }
   await p.until(()=>!document.querySelector('.send-button').disabled);
   const beforeImage=f.submitted.length;await ev(()=>document.querySelector('.send-button').click());await p.until(()=>!document.querySelector('.composer-area .preview-reference'));await accepted(beforeImage+1);
   const imageInput=f.inputs.list().find(x=>x.input.requestId===f.submitted.at(-1)).input;
   assert.equal(imageInput.resourceReference.kind,'image');assert.equal(imageInput.resourceReference.width,240);assert.equal(imageInput.resourceReference.height,120);assert.equal(imageInput.attachments[0].assetId,imageInput.resourceReference.image.assetId);
   assert.ok(Math.abs(imageInput.resourceReference.annotations[0].region.x-36)<2);assert.equal(uploads.at(-1).data,formats[1].bytes.toString('base64'));
   checks.push({width,label:'image sends original bytes plus pixel bounds, without generating a new image'});
   await open('synthetic-html');await p.until(()=>!!document.querySelector('iframe[title="隔离 HTML 成果"]'));
   await check('no horizontal overflow and intended accessible modal mode',()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#canvas-panel').getAttribute('aria-modal')===(innerWidth<=800?'true':null));
   if(width>800){
    await ev(()=>document.querySelector('.html-annotation-toggle').click());
    await p.until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true');
    let frameSession,contextId;const diagnostics=[];
    for(let attempt=0;attempt<200&&!contextId;attempt++){
     const {targetInfos}=await chrome.command('Target.getTargets');
     for(const target of targetInfos.filter(t=>t.type==='iframe'&&t.browserContextId===p.browserContextId)){
      const {sessionId}=await chrome.command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      const {frameTree}=await chrome.command('Page.getFrameTree',{},sessionId),frames=[];
      const visit=node=>{if(node.frame.url==='about:srcdoc')frames.push(node.frame);for(const child of node.childFrames??[])visit(child);};visit(frameTree);
      if(frames.length){const {executionContextId}=await chrome.command('Page.createIsolatedWorld',{frameId:frames.at(-1).id,worldName:'annotation-inspection'},sessionId);
       const r=await chrome.command('Runtime.evaluate',{contextId:executionContextId,expression:'!!document.querySelector("agentation-toolbar")?.shadowRoot?.querySelector("[aria-label=Exit]")',returnByValue:true},sessionId);
       if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
       if(r.result.value){frameSession=sessionId;contextId=executionContextId;break;}if(attempt===199){const detail=await chrome.command('Runtime.evaluate',{contextId:executionContextId,expression:'({text:document.body?.innerText,script:[...document.scripts].map(s=>s.textContent.length),html:document.body?.innerHTML.slice(-500)})',returnByValue:true},sessionId);diagnostics.push({detail,frames});}}
      await chrome.command('Target.detachFromTarget',{sessionId});
     }
     if(!contextId)await new Promise(done=>setTimeout(done,40));
    }
    if(!contextId)console.error(JSON.stringify({diagnostics}));
    assert.ok(contextId,'Agentation mounted in isolated document');
    const frame=async expression=>{const r=await chrome.command('Runtime.evaluate',{contextId,expression,returnByValue:true},frameSession);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await frame('window.__all=(selector,root=document)=>[...root.querySelectorAll(selector),...[...root.querySelectorAll("*")].flatMap(e=>e.shadowRoot?window.__all(selector,e.shadowRoot):[])];window.__q=selector=>window.__all(selector)[0]');
    // Dispatch at the actual target; Agentation owns selection and selector extraction.
    await frame('document.querySelector("#target").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:80,clientY:130}))');
    for(let n=0;n<100&&!await frame('!!window.__q("textarea[placeholder^=What]")');n++)await new Promise(done=>setTimeout(done,30));
    assert.ok(await frame('!!window.__q("textarea[placeholder^=What]")'),'Agentation annotation popup opens');
    await new Promise(done=>setTimeout(done,350));
    const textarea=await frame('window.__q("textarea[placeholder^=What]").getBoundingClientRect().toJSON()'),iframe=await ev(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getBoundingClientRect().toJSON());
    const tx=iframe.left+textarea.left+textarea.width/2+1,ty=iframe.top+textarea.top+textarea.height/2+1;
    await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:tx,y:ty,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:tx,y:ty,button:'left',clickCount:1});await chrome.command('Input.insertText',{text:'Enlarge this button'},frameSession);
    const typed=await frame('({value:window.__q("textarea[placeholder^=What]").value,active:document.activeElement?.outerHTML.slice(0,200),shadow:document.activeElement?.shadowRoot?.activeElement?.outerHTML.slice(0,200)})');if(typed.value!=="Enlarge this button")console.error(JSON.stringify({typed,tx,ty,textarea,iframe}));
    assert.equal(typed.value,'Enlarge this button');
    await frame('(()=>{const b=[...window.__q("textarea[placeholder^=What]").getRootNode().querySelectorAll("button")].find(b=>b.textContent==="Add");if(!b)throw Error("missing Agentation Add");b.click()})()');
    for(let n=0;n<100&&!await frame('!!window.__q("[aria-label^=Send]:not(:disabled)")');n++)await new Promise(done=>setTimeout(done,30));
    await frame('window.__q("[aria-label^=Send]").click()');
    await p.until(()=>document.querySelector('.composer-area .preview-reference')?.textContent.includes('Enlarge this button'));
    await p.screenshot('web-annotation-'+width+'.png');
    assert.equal(await frame('(()=>{try{return !!parent.document}catch{return false}})()'),false);
    const beforeWeb=f.submitted.length;await ev(()=>document.querySelector('.send-button').click());await p.until(()=>!document.querySelector('.composer-area .preview-reference'));await accepted(beforeWeb+1);
    const webInput=f.inputs.list().find(x=>x.input.requestId===f.submitted.at(-1)).input;
    assert.equal(webInput.resourceReference.kind,'web');assert.equal(webInput.resourceReference.source.messageId,html.messageId);assert.equal(webInput.resourceReference.source.assetId,html.attachments[0].assetId);assert.match(webInput.resourceReference.annotations[0].elementPath,/button|target/);
    checks.push({width,label:'real Agentation element selection submits structured callback via isolated bridge to existing queue'});
    await chrome.command('Target.detachFromTarget',{sessionId:frameSession});
   }else await check('mobile default HTML is static and offers the same explicit annotation entry',()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')===''&&!document.querySelector('.html-annotation-toggle').disabled);
   const close=await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').getBoundingClientRect().toJSON());await p.command('Input.dispatchMouseEvent',{type:'mousePressed',x:close.left+close.width/2,y:close.top+close.height/2,button:'left',clickCount:1});await p.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:close.left+close.width/2,y:close.top+close.height/2,button:'left',clickCount:1});await p.until(()=>!document.querySelector('#canvas-panel'));
   await p.until(()=>document.activeElement?.getAttribute('aria-label')==='预览 synthetic-preview.html');
   await check('closing returns focus to original entry',()=>document.activeElement?.getAttribute('aria-label')==='预览 synthetic-preview.html');
   await ev(()=>document.querySelector('#message-node-3 [data-slot="sources"] button').click());
   await p.until(()=>!!document.querySelector('#message-node-3 [data-slot="source-card"]'));
   await check('reply source retains its official external link without the removed duplicate preview action',()=>{const a=document.querySelector('#message-node-3 [data-slot="source-card"]');return a.target==='_blank'&&a.rel==='noopener noreferrer'&&!document.querySelector('.source-preview-actions,#canvas-panel,#canvas-address');});
   assert.equal(await ev(()=>document.querySelector('#message-node-3 [data-slot="source-card"]').href),f.server.url+'/preview/interactive');
   await ev(()=>[...document.querySelectorAll('#message-node-3 .assistant-message-bubble summary')].find(element=>element.textContent==='查看原请求').click());
   await check('reply original request retains its preview reference and source',()=>{const element=document.querySelector('#message-node-3 .assistant-message-bubble .preview-reference');return element?.textContent.includes('Original request preview excerpt')&&element.textContent.includes('Synthetic.txt');});
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  }catch(error){console.error(JSON.stringify({errors:p.errors,blocked:p.blocked}));await p.screenshot('failure-'+width+'.png');throw error;}finally{await p.close();}
 }
 writeFileSync(join(destination,'browser-results.json'),JSON.stringify({passed:true,checks,browser:chrome.version},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{try{await chrome?.close();}finally{await f.close();}}
