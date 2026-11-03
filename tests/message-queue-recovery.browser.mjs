// Additional real-browser recovery/compatibility contracts, synthetic service only.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {queueBrowserFixture,queueUntil} from './fixtures/message-queue-browser-server.ts';
const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE||'playwright');
const dir=path.resolve('.codex/scratch/message-queue-implementation');await mkdir(dir,{recursive:true});const profile=await mkdtemp(path.join(dir,'recovery-profile-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:390,height:844},hasTouch:true});
const results={checks:[],errors:[]};let page,fixture,origin='';
const check=(name,value)=>{results.checks.push({name,passed:!!value});console.log('CHECK '+name+': '+!!value);assert.ok(value,name);};
const input=()=>page.getByRole('textbox',{name:'给荷马发消息'}),row=id=>page.locator(`[data-queue-message="${fixture.app.inputs.byRequestIds([id])[0].messageId}"]`);
const wait=()=>page.waitForTimeout(250);
async function scene(mode={}){if(fixture){await page.goto('about:blank');await fixture.close(stage=>console.log('CLOSE '+stage));}fixture=await queueBrowserFixture(path.join(dir,'web'));Object.assign(fixture.mode,mode);origin=fixture.server.url;await page.goto(origin);await row('B').waitFor();await wait();}
try{
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();results.errors.push('blocked external '+url.split('?')[0]);return route.abort();});
 page=await context.newPage();page.on('pageerror',error=>results.errors.push(error.message));
 // Historical edit/move operations are seeded through existing storage and service APIs.
 // Their removed UI is not reconstructed; protocol/CAS remain covered by business tests.
 for(const action of ['edit','move']){
  await scene({hideOperations:true});const threadId=fixture.app.store.meta('mainThread'),readEpoch=fixture.app.webReadEpoch;
  const dispatch=fixture.app.inputs.dispatchPage(undefined,readEpoch,'all'),item=dispatch.items.find(i=>i.origin==='user'&&i.input.requestId==='B');
  const original={text:'ordinary new draft',quotes:[],requestId:'ordinary-id'};
  const session={item,text:'unsent retired edit',quotes:[],attachments:item.input.attachments??[],original};
  const payload={requestId:'B',operationId:'old-'+action,expectedRevision:item.revision,threadId,readEpoch,...(action==='edit'?{input:{...item.input,text:'saved historical edit'}}:{expectedOrderVersion:dispatch.orderVersion,beforeRequestId:'D'})};
  const response=await fetch(origin+'/api/messages/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(response.status,200);
  await page.evaluate(({threadId,session,payload,action})=>{sessionStorage.setItem('homer-queue-editor:'+threadId,JSON.stringify(session));sessionStorage.setItem('homer-queue-operation:'+threadId,JSON.stringify({action,payload}));sessionStorage.removeItem('homer-draft:'+threadId);},{threadId,session,payload,action});
  const archive=JSON.stringify(session);await page.reload();await input().waitFor();await page.waitForFunction(()=>document.querySelector('[contenteditable=true]')?.textContent==='ordinary new draft');
  check(action+' restores original ordinary draft and retains inaccessible archive',await page.evaluate(thread=>sessionStorage.getItem('homer-queue-editor:'+thread),threadId)===archive&&await page.locator('.composer-area .queue-draft-recovery').count()===0);
  check(action+' unknown receipt preserves lock and never replays',await row('C').getByRole('button',{name:/取消发送/}).isDisabled()&&fixture.changes.length===1);
  fixture.mode.hideOperations=false;await page.reload();await page.waitForFunction(()=>!sessionStorage.getItem('homer-queue-operation:synthetic-queue-browser'));
  check(action+' exact automatic receipt unlocks and preserves archive and draft',fixture.changes.length===1&&(await input().innerText())===original.text&&await page.evaluate(thread=>sessionStorage.getItem('homer-queue-editor:'+thread),threadId)===archive);
 }
 await scene();await input().fill('停止期间的普通稿');await page.getByRole('button',{name:'停止回复',exact:true}).click();await queueUntil(()=>fixture.app.inputs.byRequestIds(['A'])[0].state==='interrupted');check('stop retains ordinary draft',(await input().innerText())==='停止期间的普通稿');
 await scene({legacy:true});check('legacy queue retains cancel with no count or reorder slot',await row('B').getByRole('button',{name:/取消发送/}).count()===1&&await page.locator('.aui-queue-count,.queue-handle').count()===0);
 await scene();await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await row('B').waitFor();check('reduced motion retains rows with no upper statuses',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)&&await page.locator('.aui-queue-running,.queue-notice,.composer-run-line').count()===0);
 check('no browser JS or external network errors',results.errors.length===0);
}catch(error){results.failure=String(error.stack||error);console.error(error);process.exitCode=1;await page?.screenshot({path:path.join(dir,'Queue-Recovery-Failure.png'),animations:'disabled'}).catch(()=>{});}
finally{await writeFile(path.join(dir,'recovery-browser-results.json'),JSON.stringify(results,null,2)+'\n');await context.close();if(fixture)await fixture.close();await rm(profile,{recursive:true,force:true});}
console.log(JSON.stringify({checks:results.checks.length,passed:results.checks.filter(c=>c.passed).length,failure:results.failure}));
