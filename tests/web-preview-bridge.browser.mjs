// Exact Canvas component, synthetic cooperating page and isolated Chrome only.
// Run after the normal UI build; never creates a product entry or external proxy.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??join(sourceRoot,'.codex/scratch/web-preview-bridge'));
const harness=join(destination,'harness'),output=join(destination,'web');
await mkdir(harness,{recursive:true});
const local=path=>'./'+relative(harness,join(sourceRoot,path)).replaceAll('\\','/');
await writeFile(join(harness,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.tsx"></script>');
await writeFile(join(harness,'entry.tsx'),`import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CanvasPanel} from ${JSON.stringify(local('ui/canvas-panel.tsx'))};
import ${JSON.stringify(local('ui/homer-styles.css'))};
window.__references=[];window.__tokens=[];window.__results=[];
addEventListener('message',event=>{if(event.data?.type==='synthetic-token')window.__tokens.push(event.data.token);if(event.data?.type==='synthetic-result')window.__results.push(event.data);});
function Harness(){const [open,setOpen]=useState(true),trigger=useRef(null);return <><button id="open-preview" ref={trigger} onClick={()=>setOpen(true)}>打开合成网页</button>{open&&<CanvasPanel artifact={null} webSource={{kind:'web',messageId:'synthetic-message',sourceId:'synthetic-source',url:new URL('/synthetic-page',location.href).href,title:'合成网页'}} onClose={()=>setOpen(false)} returnFocusTo={trigger.current} onReference={async reference=>{window.__references.push(reference);}} referencesEnabled/>}</>;}
createRoot(document.getElementById('root')).render(<Harness/>);`);
await build({root:harness,configFile:false,logLevel:'warn',build:{outDir:output,emptyOutDir:true,rolldownOptions:{onwarn(warning,forward){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')forward(warning);}}}});
const cooperating='<!doctype html><h1>Synthetic webpage</h1><script>'+`
let token='';addEventListener('message',event=>{
 if(event.source!==parent)return;
 if(event.data?.type==='homer-preview-connect'){
  token=event.data.token;parent.postMessage({type:'homer-preview-connected',token,url:location.href},'*');parent.postMessage({type:'synthetic-token',token},'*');
 }
 if(event.data?.type==='synthetic-emit')parent.postMessage({type:'homer-preview-annotations',token:event.data.token??token,url:event.data.url??location.href,annotations:[{id:'synthetic-note',element:'button',elementPath:'#target',comment:'Synthetic user comment',x:10,y:20}]},'*');
 if(event.data?.type==='homer-preview-annotation-result')parent.postMessage({type:'synthetic-result',error:event.data.error},'*');
});parent.postMessage({type:'homer-preview-ready',url:location.href},'*');
`+'</script>';
const server=createServer(async(request,response)=>{
 try{
  const path=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
  if(path==='/synthetic-page'){response.setHeader('Content-Type','text/html');response.end(cooperating);return;}
  if(path.includes('..'))throw Error('invalid_fixture_path');
  const file=path==='/'?'/index.html':path,body=await readFile(output+file);
  response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');response.end(body);
 }catch{response.writeHead(404);response.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port,checks=[];
let chrome;
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const page=await chrome.page(origin,width);
  try{
   console.log('START web bridge '+width);
   await page.navigate();await page.until(()=>!!document.querySelector('[aria-label="重新加载预览"]')&&window.__tokens.length>0,10000);
   console.log('CONNECTED web bridge '+width);
   assert.equal(await page.evaluate(()=>document.querySelector('[data-slot="web-preview"] iframe').getAttribute('sandbox')),'allow-scripts allow-forms');
   await page.evaluate(()=>{window.__opened=[];window.open=(...args)=>window.__opened.push(args);document.querySelector('[aria-label="在新标签页打开预览"]').click();});
   assert.deepEqual(await page.evaluate(()=>window.__opened[0]),[origin+'/synthetic-page','_blank','noopener,noreferrer']);
   const oldToken=await page.evaluate(()=>window.__tokens.at(-1));
   await page.evaluate(()=>{window.__loads=0;document.addEventListener('load',event=>{if(event.target instanceof HTMLIFrameElement)window.__loads++;},true);document.querySelector('[aria-label="重新加载预览"]').click();});
   await page.until(`window.__loads>0&&window.__tokens.at(-1)!==${JSON.stringify(oldToken)}`,10000);
   console.log('RELOADED web bridge '+width);
   assert.equal(await page.evaluate(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').getBoundingClientRect().height),28);
   if(width===1440){
    // A forged parent event, the real frame with a wrong token and a prior
    // document token must all leave the draft callback untouched.
    await page.evaluate(()=>dispatchEvent(new MessageEvent('message',{source:window,data:{type:'homer-preview-annotations',token:window.__tokens.at(-1),annotations:[]}})));
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'synthetic-emit',token:'wrong-token'},'*'));
    await page.evaluate(`document.querySelector('iframe').contentWindow.postMessage({type:'synthetic-emit',token:${JSON.stringify(oldToken)}},'*')`);
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await page.evaluate(()=>window.__references.length),0);
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'synthetic-emit',url:location.origin+'/changed-page'},'*'));
    await page.until(()=>window.__results.some(result=>result.error?.includes('当前来源不匹配')),10000);
    assert.equal(await page.evaluate(()=>window.__references.length),0);
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'synthetic-emit'},'*'));
    await page.until(()=>window.__references.length===1);
    assert.deepEqual(await page.evaluate(()=>window.__references[0].source),{kind:'web',messageId:'synthetic-message',sourceId:'synthetic-source',url:origin+'/synthetic-page',title:'合成网页'});
    checks.push('exact frame/current token/source URL only; annotation callback adds a draft');
   }else{
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'synthetic-emit'},'*'));
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await page.evaluate(()=>window.__references.length),0);
   }
   await page.screenshot('web-preview-'+width+'.png');
   await page.evaluate(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());await page.until(()=>!document.querySelector('#canvas-panel'));
   assert.deepEqual(page.errors,[]);assert.deepEqual(page.blocked,[]);
   checks.push({width,iframeSandbox:true,externalAction:true,reloadIdentity:true,officialClose:true,closeWorks:true});
  }catch(error){
   await writeFile(join(destination,'failure.json'),JSON.stringify({error:String(error),body:await page.evaluate(()=>document.body.innerText),tokens:await page.evaluate(()=>window.__tokens),errors:page.errors,blocked:page.blocked,requests:page.requests},null,2));
   await page.screenshot('failure.png');throw error;
  }finally{await page.close();}
 }
 await writeFile(join(destination,'results.json'),JSON.stringify({syntheticOnly:true,passed:true,checks},null,2));
 console.log(JSON.stringify({passed:true,widths:[1440,390,320],checks:21}));
}finally{
 await chrome?.close();server.closeAllConnections();await new Promise(done=>server.close(done));
}
