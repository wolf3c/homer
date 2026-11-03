// Controlled no-tab web source and empty preview. Local synthetic page only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,relative,join,extname} from 'node:path';
import {build} from 'vite';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {actualClick} from './helpers/html-preview-browser.mjs';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/preview-header-row-removal-20261025/fallback'),harness=join(destination,'harness'),web=join(destination,'web');
await mkdir(harness,{recursive:true});const local=path=>'./'+relative(harness,resolve(path)).replaceAll('\\','/');
await writeFile(join(harness,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.tsx"></script>');
await writeFile(join(harness,'entry.tsx'),`import React,{useMemo,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import {CanvasPanel} from ${JSON.stringify(local('ui/canvas-panel.tsx'))};import {createAnnotationDraft} from ${JSON.stringify(local('ui/annotation-draft.ts'))};import ${JSON.stringify(local('ui/homer-styles.css'))};
function Harness(){const [open,setOpen]=useState(true),[empty,setEmpty]=useState(false),trigger=useRef(null),draft=useMemo(()=>createAnnotationDraft(),[]);window.__empty=()=>setEmpty(true);return <><button id="open-preview" ref={trigger} onClick={()=>setOpen(true)}>打开合成预览</button>{open&&<CanvasPanel annotationDraft={draft} artifact={null} webSource={empty?undefined:{kind:'web',messageId:'synthetic-message',sourceId:'synthetic-source',url:new URL('/synthetic-web',location.href).href,title:'受控网页的完整可访问名称'}} onClose={()=>setOpen(false)} returnFocusTo={()=>trigger.current} onReference={async()=>{throw Error('no_save_expected')}}/>}</>};createRoot(document.getElementById('root')).render(<Harness/>);`);
await build({root:harness,configFile:false,logLevel:'error',build:{outDir:web,emptyOutDir:true,rolldownOptions:{onwarn(warning,forward){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')forward(warning);}}}});
const server=createServer(async(request,response)=>{try{const path=new URL(request.url,'http://127.0.0.1').pathname;if(path==='/synthetic-web'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><h1>合成受控网页</h1>');return;}const file=path==='/'?'/index.html':path;if(file.includes('..'))throw Error('invalid_path');const data=await readFile(web+file);response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');response.end(data);}catch{response.writeHead(404);response.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port,checks=[];let chrome;
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(origin,width),ev=x=>p.evaluate(x),until=x=>p.until(x,8000);
  const click=async selector=>actualClick(p,await ev(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`));
  try{
   await p.navigate();await until(()=>!!document.querySelector('.canvas-collapse'));
   await until(()=>document.activeElement===document.querySelector('.canvas-collapse'));
   assert.equal(await ev(()=>document.querySelectorAll('[role=tab],[data-slot=canvas-split-header]').length),0);
   assert.equal(await ev(()=>document.querySelector('.canvas-preview-label').textContent),'受控网页的完整可访问名称');
   assert.equal(await ev(()=>document.querySelector('#canvas-panel').getAttribute('aria-label')),'预览：受控网页的完整可访问名称');
   assert.equal(await ev(()=>document.querySelector('[data-slot=web-preview] iframe').getAttribute('sandbox')),'allow-scripts allow-forms');
   assert.equal(await ev(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await p.screenshot('controlled-web-'+width+'.png');await click('.canvas-frame-exit button');await until(()=>!document.querySelector('#canvas-panel'));await until(()=>document.activeElement.id==='open-preview');
   await ev(()=>window.__empty());await click('#open-preview');await until(()=>!!document.querySelector('.canvas-collapse'));await until(()=>document.activeElement===document.querySelector('.canvas-collapse'));
   assert.equal(await ev(()=>document.querySelector('#canvas-panel').textContent.includes('从对话中选择网页或成果')),true);
   await click('.canvas-collapse');await until(()=>!document.querySelector('#canvas-panel'));await until(()=>document.activeElement.id==='open-preview');
   assert.equal(await ev(()=>document.querySelectorAll('[inert],.canvas-backdrop').length),0);assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
   checks.push({width,noTabs:true,accessibleName:true,controlledWebExit:true,emptyExit:true,returnFocus:true});
  }catch(error){await p.screenshot('failure-'+width+'.png');throw error;}finally{await p.close();}
 }
 await writeFile(join(destination,'results.json'),JSON.stringify({passed:true,checks,browser:chrome.version},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{await chrome?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
