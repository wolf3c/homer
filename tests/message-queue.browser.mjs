// Real isolated service and browser, synthetic content only. No production access.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {queueBrowserFixture,queueUntil} from './fixtures/message-queue-browser-server.ts';
const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE||'playwright');
const dir=path.resolve('.codex/scratch/message-queue-implementation');await mkdir(dir,{recursive:true});
const profile=await mkdtemp(path.join(dir,'browser-profile-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:1000},hasTouch:true});
const results={checks:[],errors:[],geometry:[],screenshots:[]};let fixture,page,origin='';
const check=(name,value,details)=>{results.checks.push({name,passed:!!value,...(details===undefined?{}:{details})});assert.ok(value,name+(details===undefined?'':': '+JSON.stringify(details)));};
const input=()=>page.getByRole('textbox',{name:'给荷马发消息'}),row=id=>page.locator(`[data-queue-message="${fixture.app.inputs.byRequestIds([id])[0].messageId}"]`);
const wait=()=>page.waitForTimeout(180);
async function scene(count=3){
 if(fixture){await page.goto('about:blank');await fixture.close();}fixture=await queueBrowserFixture(path.join(dir,'web'),count);origin=fixture.server.url;
 await page.goto(origin);await input().waitFor();await row(count===3?'B':'q0').waitFor();await wait();
}
async function shot(name){const file=name+'.png';await page.screenshot({path:path.join(dir,file),animations:'disabled'});results.screenshots.push(file);}
async function layout(name){const value=await page.evaluate(()=>{const send=document.querySelector('.send-button').getBoundingClientRect(),editor=document.querySelector('[contenteditable]');return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,send:send.toJSON(),editor:editor.getBoundingClientRect().toJSON(),font:getComputedStyle(editor).fontSize,queue:document.querySelector('.aui-queue-list')?.getBoundingClientRect().toJSON()};});results.geometry.push({name,...value});check(name+' no horizontal overflow',value.scrollWidth<=value.width,value);check(name+' submit visible',value.send.bottom<=value.height&&value.send.top>=0,value);check(name+' text stays 16px',value.font==='16px',value);}
try{
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();results.errors.push('blocked external '+url.split('?')[0]);return route.abort();});
 page=await context.newPage();page.on('pageerror',error=>results.errors.push(error.message));
 await scene();check('current compact rows expose only cancellation',await row('B').locator('button').count()===1&&await page.locator('.queue-handle,[data-queue-edit]').count()===0);await layout('desktop queue');
 await input().fill('这是一条尚未发送的新消息草稿。');
 const uploadResponse=page.waitForResponse(response=>response.url()===origin+'/api/uploads'&&response.request().method()==='POST');
 await page.locator('input[type=file]').setInputFiles({name:'新草稿材料.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic new draft')});
 const uploaded=await uploadResponse,uploadedAsset=await uploaded.json();
 check('draft upload completed with a ready server asset',uploaded.status()===201&&uploadedAsset.state==='ready'&&fixture.app.media.asset(uploadedAsset).state==='ready');
 await page.waitForFunction(asset=>{
  const draft=JSON.parse(sessionStorage.getItem('homer-draft:synthetic-queue-browser')||'null'),attachment=draft?.attachments?.[0];
  return draft?.unconfirmedUploads===false&&draft.attachments.length===1&&attachment?.assetId===asset.assetId&&attachment.revision===asset.revision&&attachment.state==='ready';
 },uploadedAsset);
 const originalDraft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-queue-browser')));
 check('new draft upload and all original server attachments stay separate',originalDraft.attachments.length===1&&fixture.app.inputs.byRequestIds(['B'])[0].input.attachments.length===10&&fixture.discards.length===0);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await wait();await layout(width+' waiting');check(width+' no upper notices or empty pagination',await page.locator('.composer-run-line,.unconfirmed-inputs,.queue-operation-notice,.queue-notice,.queue-pages').count()===0);await shot('Queue-'+width+'-Waiting');}
 await page.setViewportSize({width:320,height:420});await input().fill('低视口下继续编辑。'.repeat(30));await layout('320 low-height');await shot('Queue-320-Low-Height');
 await row('C').getByRole('button',{name:/取消发送/}).click();await row('C').waitFor({state:'hidden'});check('cancel reaches exact CAS identity',fixture.changes.at(-1).action==='cancel'&&fixture.changes.at(-1).input.requestId==='C'&&fixture.app.inputs.byRequestIds(['C'])[0].state==='cancelled');
 // Lost cancellation response: hidden receipts preserve the existing business lock.
 await scene();fixture.mode.loseNextCancel=true;fixture.mode.hideOperations=true;
 await row('D').getByRole('button',{name:/取消发送/}).click();await page.waitForFunction(()=>!!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));await wait();
 const uncertain=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser')));
 check('unknown operation locks rows with no manual recovery entry',await row('B').getByRole('button',{name:/取消发送/}).isDisabled()&&await page.locator('.queue-operation-notice').count()===0);
 await page.reload();await row('B').waitFor();await wait();check('refresh retains exact operation without replay',fixture.changes.length===1&&JSON.stringify(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'))))===JSON.stringify(uncertain));
 fixture.mode.hideOperations=false;await page.reload();await page.waitForFunction(()=>!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));check('automatic exact receipt unlocks without duplicate mutation',fixture.changes.length===1);
 // Read failure retains the old row and fences cancellation; existing events recover it.
 await scene();await page.route('**/api/history/queue',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'synthetic_read_failure'})}));await page.evaluate(()=>window.dispatchEvent(new Event('homer-queue-updated')));await wait();check('read failure keeps row and disables cancel without a notice',await row('B').count()===1&&await row('B').getByRole('button',{name:/取消发送/}).isDisabled()&&await page.locator('.queue-notice').count()===0);await page.unroute('**/api/history/queue');await page.evaluate(()=>window.dispatchEvent(new Event('homer-queue-updated')));await page.waitForFunction(()=>[...document.querySelectorAll('.aui-queue-remove')].some(b=>!b.disabled));
 await scene(165);const first=await page.locator('[data-queue-message]').evaluateAll(rows=>rows.map(r=>r.dataset.queueMessage));check('dispatch page stays bounded',first.length>0&&first.length<=80);
 await page.getByRole('button',{name:'查看下一页',exact:true}).click();await row('q80').waitFor();await page.getByRole('button',{name:'返回待发送首页',exact:true}).click();await row('q0').waitFor();check('home restores exact server page',JSON.stringify(await page.locator('[data-queue-message]').evaluateAll(rows=>rows.map(r=>r.dataset.queueMessage)))===JSON.stringify(first));await shot('Queue-Pagination');
 await scene(2);check('two compact rows retain cancellation and no empty pages',await page.locator('[data-queue-message]').count()===2&&await page.locator('.queue-pages').count()===0);
 check('browser has no JS or external network errors',results.errors.length===0,results.errors);
}catch(error){results.failure=String(error.stack||error);console.error(error);process.exitCode=1;if(page)await shot('Queue-Failure').catch(()=>{});}
finally{await writeFile(path.join(dir,'browser-results.json'),JSON.stringify(results,null,2)+'\n');await context.close();if(fixture)await fixture.close();await rm(profile,{recursive:true,force:true});}
console.log(JSON.stringify({checks:results.checks.length,passed:results.checks.filter(c=>c.passed).length,failure:results.failure,screenshots:results.screenshots}));
