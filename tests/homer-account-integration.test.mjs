// Explicit three-project lab acceptance. Requires both owners' running synthetic candidates.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,chmodSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const bundle=process.env.HOMER_TEST_APP,loginFile=process.env.HOMER_TEST_SYNTHETIC_LOGIN;
const realCodex=process.env.HOMER_TEST_REAL_CODEX==='1';
async function accountWhen(page,predicate){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){const state=await page.evaluate(()=>window.homerDesktopAccount.state());if(predicate(state))return state;await page.waitForTimeout(50);}
 throw Error('synthetic_account_state_timeout');
}
async function runtimeWhen(page,predicate){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){const state=await page.evaluate(async()=>(await fetch('/api/state')).json());if(predicate(state))return state;await page.waitForTimeout(50);}
 throw Error('synthetic_runtime_state_timeout');
}
test('actual website delivers a finite native Token to Homer and preserves history',{skip:!bundle||!loginFile,timeout:180000},async t=>{
 const {_electron,chromium}=await import('playwright-core');
 const website=process.env.HOMER_TEST_WEBSITE_ORIGIN??'http://127.0.0.1:3180',gateway=process.env.HOMER_TEST_GATEWAY_ORIGIN??'http://127.0.0.1:3182';
 for(const origin of [website,gateway]){const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');}
 const manifest=JSON.parse(readFileSync(join(bundle,'Contents/Resources/desktop-manifest.json')));
 assert.equal(manifest.preparation,true);assert.deepEqual(manifest.account,{websiteOrigin:website,gatewayOrigin:gateway});
 assert.ok(resolve(loginFile).includes('/.codex/scratch/'));assert.ok(loginFile.endsWith('/login.synthetic.json'));
 const login=JSON.parse(readFileSync(loginFile));assert.equal(login.synthetic,true);
 assert.equal((await(await fetch(website+'/homer-lab/health',{signal:AbortSignal.timeout(5000)})).json()).ready,true);
 const parent=resolve(process.env.HOMER_TEST_SCRATCH??'.codex/scratch/account-mvp/three-projects');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-'));
 writeFileSync(join(root,'.homer-desktop-test-profile'),'{"format":1}');writeFileSync(join(root,'fixture-control.json'),'{"loggedIn":false}');
 copyFileSync(resolve('tests/fixtures/desktop-app-server.mjs'),join(root,'fixture-codex.mjs'));chmodSync(join(root,'fixture-codex.mjs'),0o700);
 // Keep the test-profile boundary; replace only its native-protocol fake with the pinned engine.
 if(realCodex){
  const binary=join(resolve(bundle),'Contents/Resources/runtime/codex/vendor/aarch64-apple-darwin/bin/codex');
  assert.equal(manifest.codex,'0.163.0');assert.ok(existsSync(binary));
  writeFileSync(join(root,'fixture-codex.mjs'),'#!/usr/bin/env node\nprocess.execve('+JSON.stringify(binary)+',['+JSON.stringify(binary)+',...process.argv.slice(2)],process.env);\n',{mode:0o700});
 }
 for(const name of ['host-home','tmp'])mkdirSync(join(root,name));
 let desktop,browser;
 const start=async()=>{
  desktop=await _electron.launch({executablePath:join(bundle,'Contents/MacOS/Homer'),args:['--test-profile',root,'--deepseek-daily'],timeout:30000});
  const page=await desktop.firstWindow();await page.waitForURL('http://127.0.0.1:*/**',{timeout:30000});return page;
 };
 const stop=async()=>{
  await desktop.evaluate(({dialog,app})=>{dialog.showMessageBox=async()=>({response:1});app.relaunch=()=>{};});
  const ended=desktop.waitForEvent('close',{timeout:25000});await desktop.evaluate(({app})=>app.quit());await ended;desktop=undefined;
 };
 try{
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context=await browser.newContext({locale:'en-US'});await context.addInitScript(()=>localStorage.setItem('lang','en'));
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const site=await context.newPage();await site.goto(website+'/homer');
  await site.getByRole('button',{name:'Login',exact:true}).click();
  await site.locator('#login-modal').getByText('login with Name/Password',{exact:true}).click();
  await site.locator('#name').fill(login.username);await site.locator('#password').fill(login.password);
  await site.locator('#login-modal').getByText('Sign Up/Login',{exact:true}).click();
  await site.locator('#login-modal').waitFor({state:'hidden'});
  let page=await start();await runtimeWhen(page,s=>s.upgrade.code==='desktop_account_required');assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),join(root,'host-home/electron'));await page.getByRole('button',{name:'设置',exact:true}).click();
  // Substitute only OS dispatch; real browser website, callback, exchange and file write remain.
  await desktop.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.syntheticBrowserURL=url;};});
  await page.getByRole('button',{name:'登录',exact:true}).click();
  const deadline=Date.now()+5000;let authorization;
  while(!(authorization=await desktop.evaluate(()=>globalThis.syntheticBrowserURL))&&Date.now()<deadline)await page.waitForTimeout(25);
  assert.ok(authorization);assert.equal(new URL(authorization).origin,website);
  await site.goto(authorization);await site.getByRole('button',{name:'Allow connection',exact:true}).click();
  await accountWhen(page,s=>s.connection==='website'&&s.needsRestart&&!s.pending);
  t.diagnostic('actual browser delivery state accepted');
  const saved=JSON.parse(readFileSync(join(root,'runtime-config.json')));assert.equal(saved.config.main.baseUrl,gateway+'/v1');
  assert.deepEqual(saved.config.worker,{baseUrl:gateway+'/v1',model:'gpt-6.1-terra',context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'},effort:'high',fast:false});
  assert.equal((await page.evaluate(async()=>JSON.stringify(await window.homerDesktopAccount.state()))).includes(saved.token),false);
  // Exercise the same restart action as a user, including stopped ACK and clean exit.
  await desktop.evaluate(({dialog,app})=>{dialog.showMessageBox=async()=>({response:1});app.relaunch=()=>{};});
  const restarted=desktop.waitForEvent('close',{timeout:25000});await page.getByRole('button',{name:'重启并应用',exact:true}).click();await restarted;desktop=undefined;
  for(const file of ['codex/desktop-owner.json','runtime/cli.lock','runtime/gateway/cli.lock'])assert.equal(existsSync(join(root,file)),false);
  page=await start();await runtimeWhen(page,s=>s.upgrade.phase==='running'&&s.threadId&&!s.isRunning);
  const startup=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});
  try{
   const completed=startup.prepare("SELECT 1 FROM agent_messages WHERE kind='user_input' AND json_extract(payloadJson,'$.source')='first_launch' AND json_extract(payloadJson,'$.terminal')='completed'");
   const deadline=Date.now()+30000;while(!completed.get()&&Date.now()<deadline)await page.waitForTimeout(50);
   assert.ok(completed.get(),'fresh profile initialization must finish before normal work');
   assert.equal(startup.prepare("SELECT count(*) n FROM agent_messages WHERE kind='user_input' AND json_extract(payloadJson,'$.source')='first_launch'").get().n,1);
  }finally{startup.close();}
  let delivered,history;
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.evaluate(()=>window.homerDesktopAccount.refresh());await accountWhen(page,s=>Boolean(s.wallet));
  const before=await page.evaluate(async()=>await window.homerDesktopAccount.state());
  assert.equal(before.active,'website');assert.equal(before.needsRestart,false);
  const response=await fetch(gateway+'/api/usage/token/',{headers:{Authorization:'Bearer '+saved.token},signal:AbortSignal.timeout(5000),redirect:'error'});
  assert.equal(response.status,200);const usage=await response.json();assert.equal(usage.code,true);
  assert.equal(usage.data.unlimited_quota,false);assert.equal(Object.hasOwn(usage.data,'user_quota'),false);
  assert.equal(usage.data.total_granted,usage.data.total_available+usage.data.total_used);
  assert.ok(Number.isSafeInteger(usage.data.total_available)&&usage.data.total_available>=0);
  assert.equal(JSON.parse(readFileSync(join(root,'runtime-config.json'))).token===saved.token,true);
  await page.screenshot({path:join(root,'account-native-token.png')});
  if(realCodex){
   await page.getByRole('button',{name:'关闭设置',exact:true}).click();
   mkdirSync(join(root,'workspace/materials'),{recursive:true});writeFileSync(join(root,'workspace/materials/synthetic.md'),'Synthetic desktop acceptance material');
   await page.locator('[contenteditable=true]').fill('dispatch-synthetic');await page.locator('.send-button').click();
   const db=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});
   try{
    const result=db.prepare("SELECT r.filePath AS artifact,r.sha256 FROM results r JOIN runs ON runs.id=r.runId JOIN deliveries d ON d.taskId=r.taskId JOIN json_each(d.resultIdsJson) selected ON selected.value=r.id WHERE runs.status='succeeded' AND r.kind='file' AND r.state='accepted' AND d.state='recorded' AND d.revokedAt IS NULL");
    const deadline=Date.now()+30000;
    while(!(delivered=result.get())&&Date.now()<deadline)await page.waitForTimeout(50);
    assert.ok(delivered,'real Worker must finish, be inspected and deliver its actual file');
    assert.ok(resolve(delivered.artifact).startsWith(join(root,'workspace/outputs')+'/'));
    assert.equal(readFileSync(delivered.artifact,'utf8'),'DeepSeek Worker 已运行（合成上游）');
    assert.equal(createHash('sha256').update(readFileSync(delivered.artifact)).digest('hex'),delivered.sha256);
   }finally{db.close();}
   history=await runtimeWhen(page,s=>!s.isRunning&&s.messages.some(m=>m.role==='user'&&m.text==='dispatch-synthetic'));
   assert.equal(JSON.stringify(history).includes(saved.token),false);
  }
  if(realCodex){
   await stop();page=await start();
   const restored=await runtimeWhen(page,s=>s.upgrade.phase==='running'&&s.threadId&&!s.isRunning);
   assert.equal(restored.threadId,history.threadId);
   assert.deepEqual(restored.messages.filter(m=>m.role==='user').map(m=>m.text),history.messages.filter(m=>m.role==='user').map(m=>m.text));
   assert.equal(readFileSync(delivered.artifact,'utf8'),'DeepSeek Worker 已运行（合成上游）');
  }
  writeFileSync(join(root,'evidence.json'),JSON.stringify({synthetic:true,actualWebsite:true,actualAmh:true,actualElectron:true,automaticDelivery:true,normalRestart:true,sameKey:true,finiteNativeToken:true,sharedWalletAbsent:true,purchasesTested:false,realCodex163:realCodex,workerFileDelivered:Boolean(delivered),historyPreserved:Boolean(history),models:realCodex?'actual desktop real 163 through actual AMH to scripted upstream':'protocol fixture'})+'\n');
  t.diagnostic(JSON.stringify({synthetic:true,profile:root,realCodex163:realCodex,workerFileDelivered:Boolean(delivered)}));
 }finally{if(desktop)await stop();if(browser)await browser.close();}
});

test('native-disabled synthetic Key fails visibly in the restored desktop and preserves user history',{skip:!bundle||!process.env.HOMER_TEST_DISABLED_PROFILE,timeout:60000},async()=>{
 const {_electron}=await import('playwright-core');
 const root=resolve(process.env.HOMER_TEST_DISABLED_PROFILE);
 assert.ok(root.includes('/.codex/scratch/account-mvp/three-projects/'));
 assert.equal(JSON.parse(readFileSync(join(root,'evidence.json'))).realCodex163,true);
 const saved=JSON.parse(readFileSync(join(root,'runtime-config.json')));
 assert.equal(saved.config.main.baseUrl,(process.env.HOMER_TEST_GATEWAY_ORIGIN??'http://127.0.0.1:3182')+'/v1');
 const denied=await fetch(saved.config.main.baseUrl+'/responses',{method:'POST',headers:{Authorization:'Bearer '+saved.token,'Content-Type':'application/json'},body:JSON.stringify({model:saved.config.main.model,input:'Synthetic disabled-key canary.',stream:true,reasoning:{effort:saved.config.main.effort}}),redirect:'error',signal:AbortSignal.timeout(5000)});
 try{assert.ok([401,403].includes(denied.status),'native authentication must reject before model execution');}finally{await denied.body?.cancel();}
 const desktop=await _electron.launch({executablePath:join(bundle,'Contents/MacOS/Homer'),args:['--test-profile',root,'--deepseek-daily'],timeout:30000});
 try{
  const page=await desktop.firstWindow();await page.waitForURL('http://127.0.0.1:*/**',{timeout:30000});
  const before=await runtimeWhen(page,s=>s.upgrade.phase==='running'&&s.threadId&&!s.isRunning&&!s.mainActivity);
  const ids=new Set(before.messages.map(m=>m.id));
  await page.locator('[contenteditable=true]').fill('synthetic-disabled-request');await page.locator('.send-button').click();
  const after=await runtimeWhen(page,s=>!s.isRunning&&!s.mainActivity&&s.messages.some(m=>!ids.has(m.id)&&m.role==='assistant'&&m.status==='failed'));
  assert.equal(after.threadId,before.threadId);
  assert.deepEqual(after.messages.filter(m=>m.role==='user').map(m=>m.text),[...before.messages.filter(m=>m.role==='user').map(m=>m.text),'synthetic-disabled-request']);
  assert.equal(after.messages.some(m=>!ids.has(m.id)&&m.role==='assistant'&&m.status==='completed'),false);
  assert.equal(JSON.stringify(after).includes(saved.token),false);
  await page.getByRole('button',{name:'停止',exact:true}).waitFor({state:'hidden'});
  const latest=page.locator('.scroll-latest');if(await latest.isVisible()&&await latest.isEnabled())await latest.click();
  const failed=after.messages.find(m=>!ids.has(m.id)&&m.role==='assistant'&&m.status==='failed');
  const message=page.locator('[data-conversation-message='+JSON.stringify(failed.id)+']');
  await message.getByText('这条回复未完成',{exact:true}).waitFor();await message.scrollIntoViewIfNeeded();
  await page.screenshot({path:join(root,'account-disabled-request.png')});
  writeFileSync(join(root,'disabled-evidence.json'),JSON.stringify({synthetic:true,nativeAuthStatus:denied.status,desktopFailedVisibly:true,historyPreserved:true,userHistoryAppendedOnce:true})+'\n');
 }finally{
  await desktop.evaluate(({dialog,app})=>{dialog.showMessageBox=async()=>({response:1});app.relaunch=()=>{};});
  const ended=desktop.waitForEvent('close',{timeout:25000});await desktop.evaluate(({app})=>app.quit());await ended;
 }
});
