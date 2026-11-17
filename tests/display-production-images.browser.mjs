// Real production HTTP/CSP owners; only the bridge data and image bytes are synthetic.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWebServer} from '../src/web-server.ts';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
const dest=join(resolve(process.env.HOMER_BROWSER_EVIDENCE),'production');mkdirSync(dest,{recursive:true});
const webDir=resolve(process.env.HOMER_COMPONENT_BUILD),checks=[],requests=[],violations=[];
const image='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90"><rect width="240" height="90" fill="#798266"/><text x="15" y="50" fill="white">Production CSP image</text></svg>';
const md='合成生产Markdown预览\n\n![canvas](https://image.example/canvas.svg)\n\n```mermaid\nflowchart LR\nA@{ img: "https://image.example/diagram.svg", label: "图内图片", w:240, h:90 }\n```';
const assetId='asset-00000000-0000-4000-8000-000000000001',sha256=createHash('sha256').update(md).digest('hex');
const message=(id,text,process)=>({id,threadId:'production-synthetic',requestId:id,role:'assistant',text,status:'completed',createdAt:1700000000000,...(process?{process}:{})});
const node={id:'process',threadId:'production-synthetic',messageId:'process',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],state:'worked',status:'failed',turnIds:['turn'],items:[{id:'commentary',kind:'commentary',seq:1,revision:1,turnId:'turn',itemId:'native',phase:'commentary',completed:true,text:'![process](https://image.example/process.svg)'}]};
const messages=[message('body','合成生产承载页\n\n![https](https://image.example/body.svg)\n\n![http](http://image.example/body.svg)'),message('process','',node),message('document','生产路径合成附件')];
const artifact={id:'doc',title:'生产预览.md',messageId:'document',assetId,revision:1,sha256};
const state={conversationView:4,threadId:'production-synthetic',messages,queue:[],work:[],interactions:[],acceptedRequestIds:[],isRunning:false,activeMessageId:null,upgrade:{phase:'running',accepting:true},features:{draftUpload:false,taskOverview:false},artifacts:[artifact],history:{protocol:3,readEpoch:'production-epoch',moreQueue:null,moreInteractions:null,page:{protocol:3,threadId:'production-synthetic',revision:1,messages,units:messages.map(m=>m.id),before:null,after:null,artifacts:[artifact]}}};
const chrome=await openBrowser(dest,{mockKeychain:true});let failure,exit;
try{
 for(const mode of ['web','desktop-token']){
  const token=mode==='desktop-token'?'a'.repeat(64):undefined;
  const bridge={history:{state:async()=>state},submit:async()=>{},stop:async()=>{},respond:async()=>{},media:{read:async()=>({filename:artifact.title,mime:'text/markdown',data:Buffer.from(md).toString('base64'),sha256})}};
  const server=await createWebServer({bridge,port:0,uiDirectory:webDir,logoPath:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),...(token?{desktopAccessToken:token}:{})});
  const context=await chrome.browser.newContext({viewport:{width:1080,height:1000}}),page=await context.newPage();
  try{
   await context.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
   if(token)await context.route(server.url+'/api/**',route=>route.continue({headers:{...route.request().headers(),'x-homer-desktop-access':token}}));
   for(const protocol of ['http','https'])await context.route(protocol+'://image.example/**',route=>{assert.equal(route.request().headers()['x-homer-desktop-access'],undefined);requests.push({mode,url:route.request().url()});return route.fulfill({contentType:'image/svg+xml',body:image});});
   const response=await page.goto(server.url);const policy=response.headers()['content-security-policy'];
   for(const alt of ['https','http']){await page.locator('img[alt="'+alt+'"]').scrollIntoViewIfNeeded();await page.waitForFunction(alt=>document.querySelector('img[alt="'+alt+'"]')?.naturalWidth===240,alt,{timeout:4000});}
   await page.locator('.process-node button').first().click();await page.locator('img[alt="process"]').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('img[alt="process"]')?.naturalWidth===240);
   await page.getByRole('button',{name:'预览 生产预览.md',exact:true}).click();await page.locator('.canvas-markdown img[alt="canvas"]').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.canvas-markdown img[alt="canvas"]')?.naturalWidth===240);
   await page.waitForFunction(()=>document.querySelector('.canvas-markdown .mermaid-output image')?.getAttribute('href')==='https://image.example/diagram.svg');
   assert.ok(requests.some(r=>r.mode===mode&&r.url.endsWith('/diagram.svg')));
   const blocked=await page.evaluate(()=>window.__csp);violations.push({mode,blocked});assert.deepEqual(blocked.filter(v=>v.directive.startsWith('img-src')),[]);
   assert.match(policy,/img-src[^;]*https:/);assert.match(policy,/img-src[^;]*http:/);checks.push({mode,policy,bodyHttp:true,bodyHttps:true,process:true,canvas:true,diagram:true});
   await page.screenshot({path:join(dest,mode+'.png')});
  }finally{violations.push({mode,observed:await page.evaluate(()=>window.__csp).catch(()=>[])});await context.close();await server.close();}
 }
}catch(error){failure=error;}finally{exit=await chrome.finish();writeFileSync(join(dest,'result.json'),JSON.stringify({checks,requests,violations,exit,failure:failure?String(failure):null},null,2));}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.forced,false);assert.equal(exit.watchdog,false);console.log(JSON.stringify({checks,requests,exit}));
