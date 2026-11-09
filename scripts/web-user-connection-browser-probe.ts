// Isolated rendered acceptance for local development access. No model/account.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createWebServer} from '../src/web-server.js';
const root=resolve('.codex/scratch/local-development-web-access-implementation');mkdirSync(root,{recursive:true});
const d=mkdtempSync(join(root,'browser-'));
const browser=await chromium.launchPersistentContext(join(d,'profile'),{headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',acceptDownloads:true});
const asset={assetId:'asset-11111111-1111-4111-8111-111111111111',revision:1,kind:'image',state:'ready',mime:'image/png',size:67,filename:'synthetic-image.png',error:null};
const file={...asset,assetId:'asset-22222222-2222-4222-8222-222222222222',kind:'file',mime:'text/plain',size:9,filename:'synthetic.txt'};
const state:any={threadId:'synthetic-browser-main',messages:[{id:'synthetic-message',threadId:'synthetic-browser-main',requestId:'synthetic-request',role:'user',text:'合成免配对历史',status:'completed',createdAt:1,media:[asset,file]}],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running',reviewRequired:true}};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHHkAAAAASUVORK5CYII=';
let ready=false,missingThread=false,approvals=0,pendingReview=true,mediaReads=0,submissions=0;
let revision=0;
const readState=async()=>{
 if(!ready)throw Error('service_not_ready');
 const threadId=missingThread?'':state.threadId;
 return {...state,threadId,conversationView:3,queue:[],acceptedRequestIds:[],artifacts:[],inactiveInteractions:[],
  history:{protocol:3,readEpoch:'synthetic-browser-epoch',page:{protocol:3,threadId,revision:++revision,units:state.messages.map((message:any)=>message.id),before:null,after:null},moreQueue:null,moreInteractions:null}};
};
const bridge:any={state:readState,history:{state:readState},submit:async()=>{submissions++;return{};},stop:async()=>{},respond:async()=>{},artifact:async()=>({filename:'synthetic.md',content:'# synthetic'}),media:{read:async(input:any)=>{mediaReads++;return input.assetId===file.assetId?{filename:file.filename,mime:file.mime,data:Buffer.from('synthetic').toString('base64')}:{filename:asset.filename,mime:asset.mime,data:png};}}};
const options={bridge,port:0,updateReview:{read:()=>pendingReview?{hash:'a'.repeat(64),files:[{path:'src/synthetic-example.ts',before:'export const example = 1;',after:'export const example = 2;'}]}:null,approve:(hash:unknown)=>{if(!pendingReview||hash!=='a'.repeat(64))throw Error('dev_update_review_stale');pendingReview=false;state.upgrade.reviewRequired=false;approvals++;return{approved:true};}},uiDirectory:resolve('dist/web'),logoPath:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')};
let web=await createWebServer(options);
let page=await browser.newPage();
const receipt:any={synthetic:true,userBrowserTouched:false,model:false,account:false,localCallerProtection:'deferred'};
const waitText=(text:string,target=page)=>target.getByText(text,{exact:true}).waitFor();
const waitDraft=()=>page.waitForFunction(()=>document.querySelector('[role="textbox"]')?.textContent==='合成保留草稿');
try{
 const listeners=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',String(process.pid),'-iTCP:'+new URL(web.url).port,'-sTCP:LISTEN','-Fn'],{encoding:'utf8'}).split('\n').filter(line=>line.startsWith('n'));assert.ok(listeners.length);assert.ok(listeners.every(line=>line.startsWith('n127.0.0.1:')));receipt.loopbackListenerOnly=true;
 receipt.stage='initial-not-ready';await page.goto(web.url+'/');
 await waitText('服务尚未就绪，正在等待主对话。');assert.equal(await page.getByRole('heading',{name:'一语成真。'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled(),true);
 await page.screenshot({path:join(root,'synthetic-loading-state.png'),fullPage:true});receipt.noFalseWelcomeBeforeState=true;
 ready=true;await waitText('合成免配对历史');await page.getByRole('img',{name:asset.filename,exact:true}).first().waitFor();assert.ok(mediaReads>0);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('homer-user-connection')),null);
 assert.equal((await browser.cookies(web.url)).length,0);receipt.noCredentialsOrCookies=true;
 receipt.stage='draft-refresh';await page.getByRole('textbox').first().fill('合成保留草稿');await page.reload();await waitDraft();receipt.draftSurvivesRefresh=true;
 receipt.stage='new-page';const second=await browser.newPage();await second.goto(web.url+'/');await waitText('合成免配对历史',second);
 assert.equal(await second.evaluate(()=>sessionStorage.getItem('homer-user-connection')),null);
 state.messages[0].text='合成多页 SSE 更新';await web.publish();await waitText('合成多页 SSE 更新');await waitText('合成多页 SSE 更新',second);receipt.multiplePagesAndSse=true;await second.close();
 receipt.stage='reconnect';ready=false;web.disconnectClients();await waitText('服务尚未就绪，正在等待主对话。');await waitText('合成多页 SSE 更新');await waitDraft();
 await page.screenshot({path:join(root,'synthetic-disconnected-history.png'),fullPage:true});receipt.cachedHistoryAndDraftSurviveDisconnect=true;
 ready=true;await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.disabled===false);receipt.sseReconnect=true;
 receipt.stage='missing-thread';missingThread=true;await web.publish();await waitText('服务尚未就绪，正在等待主对话。');assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled(),true);
 missingThread=false;await web.publish();await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.disabled===false);receipt.missingThreadBlocksInput=true;
 receipt.stage='gateway-restart';const port=Number(new URL(web.url).port);await web.close();web=await createWebServer({...options,port});await waitText('合成多页 SSE 更新');await waitDraft();await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.disabled===false);receipt.gatewayRestartSameSyntheticHistory=true;
 receipt.stage='download';const download=page.waitForEvent('download');await page.getByRole('link',{name:'下载 '+file.filename,exact:true}).click();assert.equal((await download).suggestedFilename(),file.filename);receipt.mediaDownloadWithoutPairing=true;
 await page.screenshot({path:join(root,'synthetic-unpaired-ui.png'),fullPage:true});
 receipt.stage='update-review';await page.getByRole('link',{name:'审阅更新',exact:true}).click();await waitText('待审阅版本：'+'a'.repeat(64));assert.equal(await page.getByRole('button',{name:'确认采用',exact:true}).isDisabled(),true);
 await page.getByText('src/synthetic-example.ts',{exact:true}).click();await page.getByText(/export const example = 2/).waitFor();await page.screenshot({path:join(root,'synthetic-update-review.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:join(root,'synthetic-update-review-mobile.png'),fullPage:true});receipt.reviewCssAndNarrowLayout=true;
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'确认采用',exact:true}).click();await waitText('已确认这一版本；等待安全空闲后切换。');assert.equal(approvals,1);receipt.explicitReviewConfirmation=true;
 await page.goto(web.url+'/');await waitDraft();receipt.draftSurvivesReview=true;
 receipt.stage='close-reopen';await page.close();page=await browser.newPage();await page.goto(web.url+'/');await waitText('合成多页 SSE 更新');receipt.closeReopenWithoutPairing=true;
 receipt.stage='old-bookmark';await page.goto(web.url+'/connect#synthetic-obsolete-key');await waitText('合成多页 SSE 更新');assert.equal(new URL(page.url()).hash,'');receipt.oldBookmarkClearsFragment=true;
 receipt.stage='html-preview-isolation';await page.evaluate(()=>new Promise<void>(accept=>{const frame=document.createElement('iframe');frame.title='合成隔离检查';frame.sandbox.add('allow-scripts');frame.onload=()=>accept();frame.src='/preview/interactive';document.body.append(frame);}));
 const preview=page.frames().find((frame:any)=>frame.url().endsWith('/preview/interactive'));assert.ok(preview);
 const isolation=await preview.evaluate(async()=>{let parentDenied=false,networkDenied=false;try{void parent.document.body}catch{parentDenied=true}try{await fetch('/api/history/state')}catch{networkDenied=true}return {parentDenied,networkDenied};});
 assert.equal(isolation.networkDenied,true);assert.equal(isolation.parentDenied,true);await page.getByTitle('合成隔离检查',{exact:true}).evaluate((frame:Element)=>frame.remove());receipt.htmlPreviewNetworkAndParentIsolation=true;
 receipt.stage='empty-thread';state.messages=[];await web.publish();
 // A bounded empty snapshot preserves pinned history; a fresh page verifies the empty welcome.
 await waitText('合成多页 SSE 更新');await page.reload();await page.getByRole('heading',{name:'一语成真。'}).waitFor();receipt.welcomeOnlyAfterValidEmptyState=true;
 receipt.stage='changed-thread';await page.getByRole('textbox').first().fill('合成线程变更草稿');await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')?.disabled===false);state.threadId='synthetic-other-thread';await web.publish();await waitText('主对话标识发生变化，已暂停发送。请检查服务配置。');assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isDisabled(),true);receipt.changedThreadBlocksInput=true;
 assert.equal(submissions,0);receipt.noUnexpectedInputSubmissions=true;delete receipt.stage;receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error instanceof Error&&'code'in error?String(error.code):'browser_acceptance_failed';await page.screenshot({path:join(root,'synthetic-browser-failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();await web.close();writeFileSync(join(root,'web-browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
