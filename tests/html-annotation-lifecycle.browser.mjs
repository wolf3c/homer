// Exact Canvas owner with synthetic file transport; positive activation uses the
// real patched runtime. Fault injection only suppresses or rejects success.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {htmlPreviewShell,HTML_PREVIEW_POLICY} from '../src/html-preview.ts';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick,inspectHtmlFrame} from './helpers/html-preview-browser.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/html-preview-product-integration-20261024/lifecycle'),harness=join(destination,'harness'),output=join(destination,'web');
const contents=id=>'<!doctype html><h1>'+id+'</h1><h2>Second target</h2><script>document.body.dataset.executed="'+id+'"</script>';
const digests=Object.fromEntries(['A-1','A-2','B-1'].map(id=>[id,createHash('sha256').update(contents(id)).digest('hex')]));
const assetId='asset-00000000-0000-4000-8000-000000000001';
await mkdir(harness,{recursive:true});const local=p=>'./'+relative(harness,join(sourceRoot,p)).replaceAll('\\','/');
await writeFile(join(harness,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.tsx"></script>');
await writeFile(join(harness,'entry.tsx'),`import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import {CanvasPanel} from ${JSON.stringify(local('ui/canvas-panel.tsx'))};import {createAnnotationDraft} from ${JSON.stringify(local('ui/annotation-draft.ts'))};import ${JSON.stringify(local('ui/homer-styles.css'))};
window.__calls=[];window.__events=[];window.__fail=false;window.__hold=false;
addEventListener('message',event=>{if(event.source===document.querySelector('iframe[title="隔离 HTML 成果"]')?.contentWindow)window.__events.push({type:event.data?.type,token:event.data?.token,active:event.data?.active});});
function App(){const [id,setId]=useState('A'),[version,setVersion]=useState(1),[open,setOpen]=useState(true),[enabled,setEnabled]=useState(true),[epoch,setEpoch]=useState(0);const draft=useRef(createAnnotationDraft());const messageId=id+'-'+version;window.__switch=(id,v=1)=>{setId(id);setVersion(v);setOpen(true);};window.__open=()=>setOpen(true);window.__enabled=setEnabled;window.__thread=()=>{draft.current=createAnnotationDraft();setEpoch(x=>x+1);};return <div style={{height:'100dvh'}}>{open&&<CanvasPanel key={id+version+epoch} artifact={{id:messageId,title:id+'.html',messageId,assetId:${JSON.stringify(assetId)},revision:version,sha256:${JSON.stringify(digests)}[messageId]}} onClose={()=>setOpen(false)} annotationDraft={draft.current} referencesEnabled={enabled} onReference={async reference=>{window.__calls.push(reference);if(window.__fail)throw Error('synthetic_import_rejected');if(window.__hold)await new Promise(resolve=>{window.__release=resolve;});}}/>}</div>;}createRoot(document.getElementById('root')).render(<App/>);`);
await build({root:harness,configFile:false,logLevel:'warn',build:{outDir:output,emptyOutDir:true,rolldownOptions:{onwarn(w,f){if(w.code!=='MODULE_LEVEL_DIRECTIVE')f(w);}}}});
let shellMode='normal',delayRuntime=true;const requests=[];
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://127.0.0.1').pathname;requests.push(path);
 const attachment=/^\/api\/media\/(A-[12]|B-1)\/(asset-[a-f0-9-]{36})\/([12])$/.exec(path);
 if(attachment&&attachment[2]===assetId&&attachment[1].endsWith('-'+attachment[3])){const id=attachment[1];res.setHeader('Content-Type','text/html');res.setHeader('X-Homer-Artifact-Hash',digests[id]);res.end(contents(id));return;}

 if(path==='/preview/interactive'){res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',HTML_PREVIEW_POLICY);res.end(shellMode==='suppress-active'?htmlPreviewShell.replace("parent.postMessage(event.data,'*');return;","if(event.data.type==='homer-preview-active')return;parent.postMessage(event.data,'*');return;"):htmlPreviewShell);return;}
 if(path.includes('..'))throw Error('invalid_fixture_path');if(delayRuntime&&/\/runtime-.*\.js/.test(path))await new Promise(r=>setTimeout(r,1200));
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path==='/'?'/index.html':path)]??'application/octet-stream');res.end(await readFile(output+(path==='/'?'/index.html':path)));
 }catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));let chrome,p,frame;
const check=(label,value)=>{assert.ok(value,label);checks.push(label);console.log('PASS',label);};
try{
 chrome=await isolatedChrome(destination);p=await chrome.page(origin,1440);const ev=x=>p.evaluate(x);
 const until=x=>p.until(x,15000);const click=async s=>actualClick(p,await ev(`document.querySelector(${JSON.stringify(s)}).getBoundingClientRect().toJSON()`));
 const isStatic=()=>document.querySelector('iframe[title="隔离 HTML 成果"]')?.getAttribute('sandbox')==='';
 const detach=async()=>{await frame?.close();frame=undefined;};
 const activate=async()=>{await until(()=>!!document.querySelector('.html-annotation-toggle'));await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-pressed')==='true');frame=await inspectHtmlFrame(chrome,p,'!!document.querySelector("agentation-toolbar")?.shadowRoot');await sleep(350);};
 const frameClick=async s=>{const a=await frame.evaluate(`__q(${JSON.stringify(s)}).getBoundingClientRect().toJSON()`),b=await ev(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getBoundingClientRect().toJSON());await actualClick(p,{...a,x:a.x+b.x,y:a.y+b.y});};
 const note=async()=>{await frameClick('h1');await frame.until('!!__q("textarea[placeholder^=What]")');await sleep(300);await frameClick('textarea[placeholder^=What]');await chrome.command('Input.insertText',{text:'Saved lifecycle note'},frame.sessionId);await frame.evaluate('__all("button").find(b=>b.textContent==="Add").setAttribute("data-test-add","")');await frameClick('[data-test-add]');await frame.until('!__q("textarea[placeholder^=What]")');};
 await p.navigate();await until(isStatic);await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-busy')==='true');
 check('bundle load is busy without claiming active',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='false'));
 check('loading action names its cancellation behavior',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-label')==='取消批注加载，返回静态预览'));
 await click('.html-annotation-toggle');await until(isStatic);await sleep(1600);
 check('cancelled bundle cannot re-enable scripts after it finishes',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-busy')==='false'&&document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='false')&&await ev(isStatic));
 await click('.html-annotation-toggle');await until(()=>document.querySelector('.html-annotation-toggle')?.getAttribute('aria-busy')==='true');
 await ev(()=>window.__switch('B'));await until(()=>document.querySelector('iframe[title="隔离 HTML 成果"]')?.srcdoc.includes('B-1'));await sleep(1600);
 check('late A bundle cannot execute B',await ev(isStatic)&&requests.some(p=>/runtime-.*\.js/.test(p)));
 await ev(()=>window.__switch('A'));await until(isStatic);check('returning to A requires new explicit authorization',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='false'));delayRuntime=false;
 await activate();const token=await ev(()=>window.__events.findLast(e=>e.type==='homer-preview-connected').token);
 await ev(`dispatchEvent(new MessageEvent('message',{source:window,data:{type:'homer-preview-active',token:${JSON.stringify(token)},active:false}}))`);
 await frame.evaluate('parent.postMessage({type:"homer-preview-active",token:"bad-token",active:false},"*")');
 await sleep(50);check('wrong window and wrong token cannot exit current frame',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='true'));
 await frame.evaluate('parent.postMessage({type:"homer-preview-annotations",token:"bad-token",annotations:[]},"*")');await sleep(50);check('bad token cannot import a reference',await ev(()=>window.__calls.length===0));
 await frame.evaluate('parent.postMessage({type:"homer-preview-ready"},"*");parent.postMessage({type:"homer-preview-ready"},"*")');await sleep(50);check('repeated handshakes keep exactly one native instance',await frame.evaluate('document.querySelectorAll("agentation-toolbar").length===1'));
 await note();await ev(()=>window.__fail=true);await frameClick('[aria-label^=Send]');await until(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('synthetic_import_rejected'));
 check('failed original composer import preserves native notes',await ev(()=>window.__calls.length===1)&&await frame.evaluate('!!__q("[aria-label^=Send]:not(:disabled)")'));
 await ev(()=>{window.__fail=false;window.__hold=true;});
 await frame.evaluate(`parent.postMessage({type:'homer-preview-annotations',token:${JSON.stringify(token)},annotations:[{id:'busy',element:'h1',elementPath:'h1',comment:'Busy import check',x:0,y:0}]},'*');parent.postMessage({type:'homer-preview-annotations',token:${JSON.stringify(token)},annotations:[{id:'busy',element:'h1',elementPath:'h1',comment:'Busy import check',x:0,y:0}]},'*')`);
 await until(()=>window.__calls.length===2);await sleep(50);check('busy import rejects a second bridge submission',await ev(()=>window.__calls.length===2));await ev(()=>{window.__hold=false;window.__release();});
 // Resize across the actual Dialog breakpoint; callback identity must not reset
 // a connected bridge or require a second native activation.
 await p.command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);await frame.evaluate(`parent.postMessage({type:'homer-preview-annotations',token:${JSON.stringify(token)},annotations:[{id:'resize',element:'h1',elementPath:'h1',comment:'After resize',x:0,y:0}]},'*')`);await until(()=>window.__calls.length===3);
 check('responsive owner changes preserve bridge connection and authorization',true);await p.command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await frame.evaluate(`parent.postMessage({type:'homer-preview-runtime-error',token:${JSON.stringify(token)}},'*')`);await until(isStatic);await detach();
 check('current runtime error returns static with a narrow actionable error',await ev(()=>document.querySelector('.canvas-note[role=status]')?.textContent.includes('已返回静态预览')));
 await activate();await frameClick('h2');await frame.until('!!__q("textarea[placeholder^=What]")');await sleep(300);await frameClick('textarea[placeholder^=What]');await chrome.command('Input.insertText',{text:'Unsaved input is not retained'},frame.sessionId);
 await click('.html-annotation-toggle');await until(isStatic);await detach();await activate();
 check('unsaved popup input follows native cancellation, saved note remains',await frame.evaluate('!__q("textarea[placeholder^=What]")&&!!__q("[aria-label^=Send]:not(:disabled)")'));
 await frame.evaluate('document.body.tabIndex=-1;document.body.focus()');await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'F',code:'KeyF',windowsVirtualKeyCode:70,modifiers:10});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'F',code:'KeyF',windowsVirtualKeyCode:70,modifiers:10}).catch(()=>{});await until(isStatic);await detach();check('native Ctrl+Shift+F exits and destroys the interactive frame',true);
 shellMode='suppress-active';await click('.html-annotation-toggle');await until(()=>window.__events.filter(e=>e.type==='homer-preview-connected').length>=4);await sleep(250);
 check('connected without active confirmation remains busy and unpressed',await ev(()=>document.querySelector('.html-annotation-toggle').getAttribute('aria-busy')==='true'&&document.querySelector('.html-annotation-toggle').getAttribute('aria-pressed')==='false'));
 await p.screenshot('connected-still-busy.png');await until(()=>document.querySelector('iframe[title="隔离 HTML 成果"]')?.getAttribute('sandbox')===''&&document.querySelector('.canvas-note[role=status]')?.textContent.includes('已返回静态预览'));await p.screenshot('timeout-static.png');check('active confirmation timeout clears runtime and offers retry',true);
 shellMode='normal';await ev(()=>window.__enabled(false));await until(()=>!document.querySelector('.html-annotation-toggle'));check('readonly source exposes safe rendering and no annotation entry',await ev(isStatic));check('readonly HTML has no source fallback or empty action group',await ev(()=>!document.querySelector('.html-preview-actions,[data-preview-text],[aria-label="查看 HTML 源码"],[aria-label="返回静态网页预览"]')&&document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')===''));
 await ev(()=>{window.__enabled(true);window.__switch('A',2);});await until(isStatic);check('new artifact hash has no old saved notes',await ev(()=>!document.querySelector('.html-notes-status')));
 await ev(()=>window.__switch('A'));await until(()=>document.querySelector('.html-notes-status')?.textContent.includes('1 条'));await ev(()=>window.__thread());await until(()=>!!document.querySelector('iframe'));check('new thread clears only the preview session map',await ev(()=>!document.querySelector('.html-notes-status')));
 await activate();await click('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)');await until(()=>!document.querySelector('#canvas-panel'));await detach();await ev(()=>window.__open());await until(isStatic);check('parent close cleans runtime and reopening starts static',true);
 assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);await writeFile(join(destination,'results.json'),JSON.stringify({passed:true,checks,browser:chrome.version,faultInjection:'Only negative fault paths suppress active or reject imports; activation uses actual patched Agentation.'},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}catch(error){if(p){await p.screenshot('failure.png');await writeFile(join(destination,'failure.json'),JSON.stringify({checks,error:String(error.stack),errors:p.errors,body:await p.evaluate(()=>document.body.innerText)},null,2));}throw error;}
finally{try{await frame?.close();}catch{}await p?.close();await chrome?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
