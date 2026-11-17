import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
// Actual Homer UI, synthetic messages/resources/network only, no runtime/account.
const dest=join(resolve(process.env.HOMER_BROWSER_EVIDENCE),'extra');mkdirSync(dest,{recursive:true});const webDir=resolve(process.env.HOMER_COMPONENT_BUILD);
const image='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90"><rect width="240" height="90" fill="#798266"/><text x="20" y="50" fill="white">Synthetic resource</text></svg>';
const processText='合成处理中说明\n\n![过程远程](https://display.example/synthetic.png)\n\n![过程本地](/api/media/synthetic/asset-00000000-0000-4000-8000-000000000002/1)\n\n[过程邮件](mailto:synthetic@example.com) [过程相对](./report)\n\n| 过程 | 结果 |\n| --- | --- |\n| A | B |\n\n```js\nconst value = 1;\n```';
const mermaidImage='flowchart LR\nA@{ img: "https://display.example/mermaid-image.svg", label:"图内图片", w:240, h:90 }';
const canvasText='合成 Markdown 预览\n\n![预览远程](https://display.example/synthetic.png)\n\n![预览本地](/api/media/synthetic/asset-00000000-0000-4000-8000-000000000002/1)\n\n[预览邮件](mailto:synthetic@example.com) [预览相对](./report)\n\n公式 $x^2$\n\n```mermaid\n'+mermaidImage+'\n```';
const bytes=Buffer.from(canvasText),hash=createHash('sha256').update(bytes).digest('hex');
const artifact={id:'synthetic-md',title:'合成预览.md',messageId:'document',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:hash};
const requests=[];
const fixture=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),resource(req,res,url){requests.push(url.pathname);if(url.pathname.includes(artifact.assetId)){res.writeHead(200,{'Content-Type':'text/markdown','X-Homer-Artifact-Hash':hash});res.end(bytes);}else{res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(image);}}});
const msg=(id,text,process)=>({id,threadId:'composer-review',requestId:id,role:'assistant',text,status:'completed',createdAt:1700000000000,...(process?{process}:{})});
const node=(id,status)=>({id,threadId:'composer-review',messageId:id,seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],state:'worked',status,turnIds:['synthetic-turn'],items:[{id:'commentary-'+id,kind:'commentary',seq:1,revision:1,turnId:'synthetic-turn',itemId:'native-'+id,phase:'commentary',completed:true,text:processText}],timingState:'terminal',timingSource:'hostObserved',startedAtMs:1,endedAtMs:2});
const chrome=await openBrowser(dest,{mockKeychain:true});const checks=[];let failure,exit;
try{
 for(const width of [1080,390]){
 const context=await chrome.browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
 await page.route('https://display.example/**',route=>route.fulfill({contentType:'image/svg+xml',body:image}));
 fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[msg('process','',node('process','failed'))]});
 await page.goto(fixture.url);await page.locator('.process-node button').first().click();
 for(const alt of ['过程远程','过程本地']){await page.locator('img[alt="'+alt+'"]').scrollIntoViewIfNeeded();await page.waitForFunction(alt=>document.querySelector('img[alt="'+alt+'"]')?.naturalWidth===240,alt);}
 assert.equal(await page.locator('.process-node a[href="mailto:synthetic@example.com"]').count(),1);assert.equal(await page.locator('.process-node a[href="./report"]').count(),1);assert.equal(await page.locator('.process-node table').count(),1);
 await page.locator('.process-node table').scrollIntoViewIfNeeded();await page.screenshot({path:join(dest,'process-'+width+'.png')});checks.push({width,processRemote:true,processLocal:true,processLinks:true,processTable:true});
 fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[msg('success','',node('success','completed'))]});await page.reload();await page.waitForSelector('#message-success',{state:'attached'});assert.equal(await page.locator('.process-node').count(),0);checks.push({width,successfulProcessHidden:true});
 fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[msg('document','合成附件')],artifacts:[artifact]});await page.reload();const mermaidResponse=page.waitForResponse('https://display.example/mermaid-image.svg');await page.getByRole('button',{name:'预览 合成预览.md',exact:true}).click();await page.waitForSelector('.canvas-markdown');
 for(const alt of ['预览远程','预览本地']){await page.locator('.canvas-markdown img[alt="'+alt+'"]').scrollIntoViewIfNeeded();await page.waitForFunction(alt=>document.querySelector('.canvas-markdown img[alt="'+alt+'"]')?.naturalWidth===240,alt);}
 assert.equal(await page.locator('.canvas-markdown a[href="mailto:synthetic@example.com"]').count(),1);assert.equal(await page.locator('.canvas-markdown a[href="./report"]').count(),1);assert.equal(await page.locator('.canvas-markdown .katex').count(),1);
 await page.waitForSelector('.canvas-markdown .mermaid-output image');assert.equal(await page.locator('.canvas-markdown .mermaid-output image').getAttribute('href'),'https://display.example/mermaid-image.svg');
 assert.equal((await mermaidResponse).status(),200);await page.locator('.canvas-markdown .mermaid-output').scrollIntoViewIfNeeded();await page.screenshot({path:join(dest,'canvas-'+width+'.png')});checks.push({width,canvasRemote:true,canvasLocal:true,canvasLinks:true,canvasMath:true,mermaidImage:true});
 const scale='```mermaid\nflowchart LR\nA-->B\n'+('%% 合成注释\n').repeat(4000)+'```\n\n```mermaid\nflowchart LR\n'+Array.from({length:320},(_,i)=>'A-->B'+i).join('\n')+'\n```\n\n```mermaid\nflowchart LR\n'+Array.from({length:4000},(_,i)=>'A'+i+'[X]').join('\n')+'\n```';
 fixture.reset({features:{draftUpload:true,taskOverview:false},messages:[msg('scale',scale)]});await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.mermaid-output svg').length===3);assert.equal(await page.locator('.mermaid-status').count(),0);assert.ok((await page.locator('.mermaid-output').nth(1).innerHTML()).includes('B319'));assert.ok((await page.locator('.mermaid-output').nth(2).innerHTML()).length>1000000);checks.push({width,sourceOver20000:true,edgesOver300:true,svgOver1000000:true});await context.close();
 }
}catch(error){failure=error;}finally{exit=await chrome.finish();await fixture.close();writeFileSync(join(dest,'result.json'),JSON.stringify({checks,requests,exit,failure:failure?String(failure):null},null,2));}
if(failure)throw failure;assert.equal(exit.code,0);assert.equal(exit.forced,false);assert.equal(exit.watchdog,false);console.log(JSON.stringify({checks,exit}));
