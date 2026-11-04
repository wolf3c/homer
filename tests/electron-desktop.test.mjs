import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,copyFileSync,chmodSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {_electron} from 'playwright-core';

const bundle=process.env.HOMER_TEST_APP,parent=resolve(process.env.HOMER_TEST_SCRATCH??'.codex/scratch/electron-window-tests');
function profile(loggedIn){
 mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'synthetic-'));
 writeFileSync(join(root,'.homer-desktop-test-profile'),'{"format":1}');writeFileSync(join(root,'fixture-control.json'),JSON.stringify({loggedIn}));
 copyFileSync('tests/fixtures/desktop-app-server.mjs',join(root,'fixture-codex.mjs'));chmodSync(join(root,'fixture-codex.mjs'),0o700);
 for(const name of ['host-home','tmp'])mkdirSync(join(root,name));
 return root;
}
async function launch(root,daily=false){
 const startedAt=performance.now();
 const instance=await _electron.launch({executablePath:join(resolve(bundle),'Contents/MacOS/Homer'),args:['--test-profile',root,...(daily?['--deepseek-daily']:[])],timeout:30000});
 const page=await instance.firstWindow();await page.waitForURL('http://127.0.0.1:*/**',{timeout:30000});
 return {instance,page,startedAt};
}
async function stateWhen(page,predicate){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  const state=await page.evaluate(async()=>(await(await fetch('/api/state')).json()));
  if(predicate(state))return state;
  await page.waitForTimeout(50);
 }
 throw Error('synthetic_desktop_state_timeout');
}
async function accountWhen(page,predicate){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){const state=await page.evaluate(()=>window.homerDesktopAccount.state());if(predicate(state))return state;await page.waitForTimeout(50);}
 throw Error('synthetic_account_state_timeout');
}
async function quit(instance,root){
 // Replace the native confirmation in this test process only; invoke the real menu.
 await instance.evaluate(({dialog})=>{const original=dialog.showMessageBox.bind(dialog);dialog.showMessageBox=async(first,second)=>{const options=second??first;return options.message==='退出荷马？'?{response:1,checkboxChecked:false}:original(first,second);};});
 const closed=instance.waitForEvent('close',{timeout:25000});
 await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('quit').click());await closed;
 for(const path of ['codex/desktop-owner.json','runtime/cli.lock','runtime/gateway/cli.lock'])assert.equal(existsSync(join(root,path)),false,path);
 const db=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'lease:%'").get().n,0);}finally{db.close();}
}
test('actual Electron app renders and restarts its original synthetic conversation',{skip:!bundle,timeout:90000},async t=>{
 const root=profile(true);let app=await launch(root);
 try{
  const {page,instance}=app;await page.locator('[contenteditable=true]').waitFor();
  await stateWhen(page,state=>state.upgrade.phase==='running');
  t.diagnostic(JSON.stringify({synthetic:true,metric:'first_ready_ms',value:Math.round(performance.now()-app.startedAt)}));
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  const thread=await page.evaluate(async()=>(await(await fetch('/api/state')).json()).threadId);assert.equal(thread,'synthetic-desktop-main');
  await page.locator('[contenteditable=true]').fill('synthetic Electron retained request');
  await page.locator('.send-button').click();
  await stateWhen(page,state=>!state.isRunning&&state.messages.some(m=>m.role==='assistant'&&m.status==='completed'&&m.text.includes('隔离测试答复')));
  for(const width of [390,1440]){
   await instance.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,780),width);
   await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.screenshot({path:join(root,'electron-ui.png')});
  const idle=await instance.evaluate(async({app})=>{
   app.getAppMetrics();await new Promise(resolve=>setTimeout(resolve,1000));const metrics=app.getAppMetrics();
   return {electronProcesses:metrics.length,cpuPercent:metrics.reduce((n,p)=>n+p.cpu.percentCPUUsage,0),workingSetMiB:metrics.reduce((n,p)=>n+p.memory.workingSetSize,0)/1024};
  });
  t.diagnostic(JSON.stringify({synthetic:true,metric:'electron_idle_1s',...idle}));
  await instance.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(item=>item.label==='关闭窗口').click());
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await instance.evaluate(({app})=>app.emit('activate'));
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  await page.evaluate(()=>window.open('file:///private/secret'));assert.equal(instance.windows().length,1);
  const ownedURL=page.url();await page.evaluate(()=>{location.href='file:///private/secret';});
  await page.waitForTimeout(150);assert.equal(page.url(),ownedURL);
  await quit(instance,root);app=undefined;
  app=await launch(root);
  await stateWhen(app.page,state=>state.upgrade.phase==='running'&&state.threadId==='synthetic-desktop-main'&&state.messages.some(m=>m.text==='synthetic Electron retained request'));
  t.diagnostic(JSON.stringify({synthetic:true,metric:'restart_ready_ms',value:Math.round(performance.now()-app.startedAt)}));
 }finally{if(app)await quit(app.instance,root);}
});
test('actual Electron app keeps an unconnected synthetic account read-only',{skip:!bundle,timeout:60000},async()=>{
 const root=profile(false),{instance,page}=await launch(root);
 try{
  await stateWhen(page,state=>state.upgrade.code==='desktop_account_required');
  const result=await page.evaluate(async()=>({state:await(await fetch('/api/state')).json(),capabilities:(await fetch('/api/capabilities')).status,send:(await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'synthetic-blocked',text:'blocked'})})).status}));
  assert.equal(result.state.threadId,'');assert.equal(result.state.upgrade.accepting,false);assert.equal(result.capabilities,404);assert.equal(result.send,409);
 }finally{await quit(instance,root);}
});

test('daily desktop automatically receives website credentials, applies by normal stop, delivers both roles and preserves history on disconnect',{skip:!bundle,timeout:120000},async t=>{
 const {createServer}=await import('node:http'),{createHash,randomBytes}=await import('node:crypto');
 const origins=JSON.parse(readFileSync(join(bundle,'Contents/Resources/desktop-manifest.json'))).account;
 assert.ok(origins,'this acceptance requires an account-configured preparation candidate');
 for(const value of Object.values(origins))assert.equal(new URL(value).hostname,'127.0.0.1');
 const root=profile(false);writeFileSync(join(root,'fixture-control.json'),JSON.stringify({loggedIn:false,deepseekSmoke:true}));
 const config={main:{baseUrl:origins.gatewayOrigin+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:origins.gatewayOrigin+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}};
 let balance=200,code,challenge,redirect,consumed=false,exchanges=0,configReads=0;
 const gateway=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/status'){assert.equal(req.headers.authorization,undefined);res.end(JSON.stringify({success:true,data:{quota_per_unit:100,quota_display_type:'CUSTOM',custom_currency_symbol:'积分',custom_currency_exchange_rate:1}}));return;}
  assert.equal(req.url,'/api/usage/token/');assert.equal(req.headers.authorization,'Bearer synthetic-website-model-token');
  res.end(JSON.stringify({code:true,data:{total_available:balance,total_used:50,unlimited_quota:false,expires_at:0,user_quota:{total_available:900000,total_used:999999}}}));
 });
 const website=createServer((req,res)=>{void(async()=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/homer/v1/config'){configReads++;assert.equal(req.headers.authorization,undefined);res.end(JSON.stringify(config));return;}
  if(req.url.startsWith('/homer?')){
   const u=new URL(req.url,origins.websiteOrigin);assert.equal([...u.searchParams].length,6);assert.equal(u.searchParams.get('client_id'),'homer-desktop');
   redirect=u.searchParams.get('redirect_uri');challenge=u.searchParams.get('code_challenge');code=randomBytes(32).toString('base64url');
   assert.equal((await fetch(redirect+'?code='+code+'&state='+u.searchParams.get('state'))).status,200);res.end('{}');return;
  }
  assert.equal(req.url,'/api/homer/v1/token');assert.equal(req.method,'POST');let body='';for await(const bytes of req)body+=bytes;
  const value=JSON.parse(body);assert.equal(consumed,false);assert.equal(value.code,code);assert.equal(value.redirectUri,redirect);assert.equal(createHash('sha256').update(value.codeVerifier).digest('base64url'),challenge);consumed=true;exchanges++;
  res.end(JSON.stringify({subject:'fixture_user_a',modelToken:'synthetic-website-model-token',config}));
 })().catch(()=>{res.statusCode=500;res.end('{}');});});
 const listen=(server,origin)=>new Promise((accept,reject)=>{server.once('error',reject);server.listen(Number(new URL(origin).port),'127.0.0.1',accept);});
 const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
 let app;
 try{
  await listen(gateway,origins.gatewayOrigin);await listen(website,origins.websiteOrigin);
  app=await launch(root,true);
  await stateWhen(app.page,s=>s.upgrade.code==='desktop_account_required');
  assert.equal(existsSync(join(root,'fixture-models.jsonl')),false,'unconnected install must not initialize a model');
  // Replace OS browser dispatch only; the real native listener, exchange and file store run.
  await app.instance.evaluate(({shell},origin)=>{shell.openExternal=async raw=>{const url=new URL(raw);if(url.origin!==origin)throw Error('unexpected_external');const r=await fetch(url);if(!r.ok)throw Error('browser_fixture_failed');};},origins.websiteOrigin);
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByRole('button',{name:'登录',exact:true}).click();
  await accountWhen(app.page,s=>s.connection==='website'&&s.needsRestart&&!s.pending);
  assert.equal(exchanges,1);assert.equal(await app.page.locator('input').count(),0);
  assert.equal(await app.page.evaluate(async()=>JSON.stringify(await window.homerDesktopAccount.state()).includes('synthetic-website-model-token')),false);
  const restart=async()=>{
   await app.instance.evaluate(({dialog,app})=>{dialog.showMessageBox=async()=>({response:1});app.relaunch=()=>{};});
   const stopped=app.instance.waitForEvent('close',{timeout:25000});await app.page.getByRole('button',{name:'重启并应用',exact:true}).click();await stopped;
   for(const file of ['codex/desktop-owner.json','runtime/cli.lock','runtime/gateway/cli.lock'])assert.equal(existsSync(join(root,file)),false);
  };
  await restart();app=undefined;app=await launch(root,true);
  await stateWhen(app.page,s=>s.upgrade.phase==='running'&&!s.isRunning);
  const first=await app.page.evaluate(async()=>(await(await fetch('/api/state')).json()));
  mkdirSync(join(root,'workspace/materials'),{recursive:true});writeFileSync(join(root,'workspace/materials/synthetic.md'),'Synthetic website-connected material');
  await app.page.locator('[contenteditable=true]').fill('dispatch-synthetic');await app.page.locator('.send-button').click();
  const db=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});
  try{
   const deadline=Date.now()+30000;let run;const result=db.prepare("SELECT artifact FROM runs WHERE status='succeeded' AND id IN (SELECT runId FROM events WHERE type='delivered')");
   while(!(run=result.get())&&Date.now()<deadline)await app.page.waitForTimeout(50);
   assert.ok(run,'Worker must deliver an actual file');assert.equal(readFileSync(run.artifact,'utf8'),'DeepSeek Worker 已运行（离线合成）');
  }finally{db.close();}
  const observed=readFileSync(join(root,'fixture-models.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  for(const worker of [false,true])assert.ok(observed.some(v=>v.worker===worker&&v.model==='deepseek-flash'&&v.effort==='max'&&v.serviceTier===null&&v.provider.base_url===origins.gatewayOrigin+'/v1'&&v.keyPresent));
  assert.equal(configReads,1,'startup checks once; Worker work and notices do not fetch config');
  const savedBefore=readFileSync(join(root,'runtime-config.json'),'utf8');
  await stateWhen(app.page,s=>!s.isRunning);
  // Advance only this isolated Electron owner's clock, without product test flags.
  await app.instance.evaluate(()=>{const later=performance.now()+3600001;Object.defineProperty(performance,'now',{configurable:true,value:()=>later});});
  await app.page.locator('[contenteditable=true]').fill('synthetic-config-cadence');await app.page.locator('.send-button').click();
  const checkedUntil=Date.now()+5000;while(configReads<2&&Date.now()<checkedUntil)await app.page.waitForTimeout(25);
  assert.equal(configReads,2,'accepted user message reaches main-process config gate');
  await stateWhen(app.page,s=>!s.isRunning&&s.messages.some(m=>m.text==='synthetic-config-cadence'));
  await app.page.locator('[contenteditable=true]').fill('synthetic-config-no-repeat');await app.page.locator('.send-button').click();
  await stateWhen(app.page,s=>!s.isRunning&&s.messages.some(m=>m.text==='synthetic-config-no-repeat'));
  assert.equal(configReads,2);assert.equal(readFileSync(join(root,'runtime-config.json'),'utf8'),savedBefore,'unchanged config never rewrites credentials');
  assert.equal((await app.page.evaluate(()=>window.homerDesktopAccount.state())).needsRestart,false);
  await app.page.getByRole('button',{name:'设置',exact:true}).click();
  await app.page.getByText('可用额度：2 积分',{exact:true}).waitFor();balance=700;
  await app.page.getByRole('button',{name:'刷新',exact:true}).click();await app.page.getByText('可用额度：7 积分',{exact:true}).waitFor();
  for(const width of [390,1440]){
   await app.instance.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,780),width);
   await app.page.waitForTimeout(100);assert.equal(await app.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await app.page.screenshot({path:join(root,'website-account-'+width+'.png')});
  }
  await app.page.getByRole('tab',{name:'本机权限',exact:true}).click();await app.page.getByRole('heading',{name:'辅助功能',exact:true}).waitFor();
  await app.page.getByRole('tab',{name:'账号',exact:true}).click();await app.page.getByText('可用额度：7 积分',{exact:true}).waitFor();
  await app.instance.evaluate(({dialog,app})=>{dialog.showMessageBox=async()=>({response:1});app.relaunch=()=>{};});
  const stopped=app.instance.waitForEvent('close',{timeout:25000});await app.page.getByRole('button',{name:'退出登录',exact:true}).click();await stopped;app=undefined;
  const saved=JSON.parse(readFileSync(join(root,'runtime-config.json')));assert.equal(saved.token,undefined);assert.equal(saved.subject,'fixture_user_a');
  const turns=readFileSync(join(root,'fixture-models.jsonl'),'utf8');app=await launch(root,true);await stateWhen(app.page,s=>s.upgrade.code==='desktop_account_required');
  assert.equal(readFileSync(join(root,'fixture-models.jsonl'),'utf8'),turns,'disconnected restart must not replay initialization or work');
  const check=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});try{assert.equal(check.prepare("SELECT value FROM meta WHERE key='mainThread'").get().value,first.threadId);assert.ok(check.prepare('SELECT count(*) n FROM runs').get().n>0);}finally{check.close();}
  t.diagnostic(JSON.stringify({synthetic:true,websiteExchange:exchanges,roles:['main','worker'],fileDelivered:true,restarted:true,historyPreserved:true,profile:root}));
 }finally{if(app)await quit(app.instance,root);await close(website);await close(gateway);}
});
