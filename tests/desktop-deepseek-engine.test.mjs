import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync,copyFileSync,constants} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {CodexEngine} from '../src/engine.ts';
import {Homer} from '../src/service.ts';
import {createHash} from 'node:crypto';
const parent=resolve('.codex/scratch/desktop-deepseek/engine');mkdirSync(parent,{recursive:true});
// Model-projection tests also use the real bundled native-resource guard.
// The isolated decoder sentinel is verified but never invoked.
function desktopIdentity(t,root){
 const windows=process.platform==='win32',bundleRoot=join(root,'Synthetic.app');
 const resources=join(bundleRoot,windows?'resources':'Contents/Resources');
 const node=windows?'resources/node.exe':'Contents/MacOS/node';
 const decoder=windows?'resources/homer-image-decoder.mjs':'Contents/MacOS/homer-image-decoder';
 const executable=process.execPath;
 mkdirSync(resources,{recursive:true});mkdirSync(dirname(join(bundleRoot,node)),{recursive:true});
 copyFileSync(executable,join(bundleRoot,node),constants.COPYFILE_FICLONE);
 writeFileSync(join(bundleRoot,decoder),'synthetic decoder');
 if(windows)writeFileSync(join(bundleRoot,'Homer.exe'),'synthetic launcher');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const entry=path=>({path,sha256:hash(readFileSync(join(bundleRoot,path)))});
 const codeFiles=(windows?['Homer.exe']:[decoder,node]).map(entry);
 const files=windows?[node,decoder].map(path=>({...entry(path),path:path.slice('resources/'.length)})):undefined;
 const manifest=JSON.stringify({format:2,node:'22.22.0',codex:'0.163.0',codeFiles,files});
 writeFileSync(join(resources,'desktop-manifest.json'),manifest);
 process.execPath=join(bundleRoot,node);
 t.after(()=>{process.execPath=executable;rmSync(root,{recursive:true,force:true});});
 return {bundleRoot,manifestSha256:hash(manifest)};
}
for(const role of ['main','worker'])test('Terra membership '+role+' applies 272k context and high independently from ChatGPT',async()=>{
 const root=mkdtempSync(join(parent,'terra-')),selected={baseUrl:'http://127.0.0.1:1/v1',model:'gpt-6.1-terra',effort:'high',fast:false,context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'}};
 const config={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'home'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'original',requiresOpenaiAuth:true,stopGraceMs:100,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:{main:selected,worker:selected}};
 for(const path of [config.runtime,config.workspace,config.codexHome])mkdirSync(path);
 const {effectiveModelConfig}=await import('../src/config.ts');
 const engine=new CodexEngine(config,{role,cwd:config.workspace,readRoots:[],instructions:'Offline Terra configuration.',tools:[],nativeCapabilities:true},async()=>({}));
 try{
  await engine.start();const result=JSON.parse((await engine.turn('synthetic')).text);
  assert.equal(result.model,'gpt-6.1-terra');assert.equal(result.effort,'high');assert.equal(result.turnServiceTier,null);
  assert.equal(result.contextWindow,272000);assert.equal(result.autoCompactTokenLimit,244800);assert.equal(result.autoCompactTokenLimitScope,'total');
  assert.equal((await engine.request('config/read',{})).config.model_catalog_json,undefined);
  const native=effectiveModelConfig({...effectiveModelConfig(config,role),desktopModelSource:'codex'},role);
  assert.equal(native.context,undefined);assert.equal(native.baseUrl,undefined);assert.equal(native.requiresOpenaiAuth,true);assert.equal(native.effort,role==='main'?'high':'xhigh');assert.equal(native.fast,role==='main');
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});
test('Terra membership refuses a context override ignored by the engine',async()=>{
 const root=mkdtempSync(join(parent,'terra-mismatch-')),bin=join(root,'app-server.mjs');
 writeFileSync(bin,readFileSync(resolve('tests/fixtures/model-settings-app-server.mjs'),'utf8').replace('setting(name)]',"name==='model_context_window'?272001:setting(name)]"),{mode:0o700});
 const config={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'home'),codexBin:bin,model:'gpt-6.1-terra',effort:'high',fast:false,baseUrl:'http://127.0.0.1:1/v1',context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'},requiresOpenaiAuth:false,stopGraceMs:100};
 for(const path of [config.runtime,config.workspace,config.codexHome])mkdirSync(path);
 const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Offline context rejection.',tools:[]},async()=>({}));
 try{await assert.rejects(engine.start(),/engine_model_context_mismatch/);}finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});
for(const role of ['main','worker'])for(const effort of ['medium',null])test('generic gateway '+role+' adopts declared capabilities and '+effort+' reasoning',async()=>{
 const root=mkdtempSync(join(parent,'generic-')),selected={baseUrl:'http://127.0.0.1:1/v1',model:'Qwen/Qwen-next:custom',effort,fast:false,context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'},capabilities:{inputModalities:['text'],reasoningEfforts:effort?[effort]:[],webSearch:false,toolSearch:false}};
 const config={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'home'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'original',requiresOpenaiAuth:true,stopGraceMs:100,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:{main:selected,worker:selected}};
 for(const path of [config.runtime,config.workspace,config.codexHome])mkdirSync(path);
 const engine=new CodexEngine(config,{role,cwd:config.workspace,readRoots:[],instructions:'Offline generic gateway.',tools:[],nativeCapabilities:true},async()=>({}));
 try{
  await engine.start();const result=JSON.parse((await engine.turn('synthetic')).text);
  assert.equal(result.model,'Qwen/Qwen-next:custom');assert.equal(result.effort,effort);assert.equal(result.contextWindow,272000);assert.equal(result.autoCompactTokenLimit,244800);assert.equal(result.turnServiceTier,null);
  const actual=(await engine.request('config/read',{})).config;
  const model=JSON.parse(readFileSync(actual.model_catalog_json,'utf8')).models[0];
  assert.equal(model.slug,'Qwen/Qwen-next:custom');assert.deepEqual(model.input_modalities,['text']);assert.equal(model.supports_search_tool,false);assert.equal(model.supports_reasoning_summary_parameter,effort!==null);assert.equal(actual.web_search,'disabled');
  const {effectiveModelConfig}=await import('../src/config.ts');const native=effectiveModelConfig({...engine.config,desktopModelSource:'codex'},role);
  assert.equal(native.capabilities,undefined);assert.equal(native.context,undefined);assert.equal(native.effort,role==='main'?'high':'xhigh');
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});
test('Codex and website role projections switch without replacing the thread, binding or history',async t=>{
 const {effectiveModelConfig}=await import('../src/config.ts');
 const root=realpathSync(mkdtempSync(join(parent,'dual-'))),desktopResources=desktopIdentity(t,root),base={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-original',requiresOpenaiAuth:true,stopGraceMs:100,desktopResources,pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}};
 for(const p of [base.runtime,base.workspace,base.codexHome])mkdirSync(p);
 const artifact=join(base.workspace,'kept.txt'),auth=join(base.codexHome,'auth.json');
 writeFileSync(artifact,'synthetic artifact');writeFileSync(auth,'synthetic credential sentinel');
 let app,thread,binding,history;
 try{for(const source of ['website','codex','website']){
  const config={...base,desktopModelSource:source};
  for(const role of ['main','worker']){const c=effectiveModelConfig(config,role);assert.equal(c.model,source==='codex'?'gpt-6.1-terra':'deepseek-flash');assert.equal(c.requiresOpenaiAuth,source==='codex');assert.equal(c.fast,source==='codex'&&role==='main');if(source==='codex'){assert.equal(c.dailyDeepSeek,false);assert.equal(c.desktopConnection,undefined);assert.equal(c.keyEnv,undefined);assert.equal(c.baseUrl,undefined);assert.equal(c.effort,role==='main'?'high':'xhigh');}}
  if(source==='codex'){
   const early=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Offline startup cancellation',tools:[],nativeCapabilities:true},async()=>({}));let spawned=0;early.on('spawn',()=>spawned++);
   const starting=early.start();starting.catch(()=>{});await early.close();await assert.rejects(starting,/engine_closed/);await early.close();assert.equal(spawned,0,'confirmed shutdown must prevent a late child spawn');
  }
  app=new Homer(config,async()=>{});await app.start();
  if(thread){assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('binding'),binding);assert.deepEqual(app.store.db.prepare('SELECT * FROM conversation_messages ORDER BY rowid LIMIT ?').all(history.length),history);}
  thread=app.store.meta('mainThread');binding=app.store.meta('binding');
  const main=JSON.parse(await app.message('synthetic '+source));
  assert.equal(main.model,source==='codex'?'gpt-6.1-terra':'deepseek-flash');assert.equal(main.effort,source==='codex'?'high':'max');assert.equal(main.threadServiceTier,source==='codex'?'priority':null);assert.equal(main.turnServiceTier,source==='codex'?'priority':null);
  if(source==='codex'){assert.match(main.openaiBaseUrl,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(main.requestCompression,false);assert.equal((await fetch(main.openaiBaseUrl+'/unknown')).status,404);}else assert.equal(main.openaiBaseUrl,undefined);
  const workerConfig=effectiveModelConfig(config,'worker'),worker=new CodexEngine(workerConfig,{role:'worker',cwd:config.workspace,readRoots:[],instructions:'Offline source test',tools:[],nativeCapabilities:true},async()=>({}));
  let workerBridge;
  try{await worker.start();const result=JSON.parse((await worker.turn('synthetic worker')).text);workerBridge=result.openaiBaseUrl;if(source==='codex'){assert.match(workerBridge,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(result.requestCompression,false);}else assert.equal(workerBridge,undefined);assert.equal(result.model,source==='codex'?'gpt-6.1-terra':'deepseek-flash');assert.equal(result.effort,source==='codex'?'xhigh':'max');assert.equal(result.threadServiceTier,null);assert.equal(result.turnServiceTier,null);}finally{assert.equal(await worker.close(),true);}
  if(workerBridge)await assert.rejects(fetch(workerBridge+'/unknown'));
  assert.equal(readFileSync(artifact,'utf8'),'synthetic artifact');assert.equal(readFileSync(auth,'utf8'),'synthetic credential sentinel');
  history=app.store.db.prepare('SELECT * FROM conversation_messages ORDER BY rowid').all();await app.close();app=undefined;if(main.openaiBaseUrl)await assert.rejects(fetch(main.openaiBaseUrl+'/unknown'));
 }}finally{await app?.close();}
});
test('website desktop keeps the account binding and resumed thread while sending new work with max',async t=>{
 const root=realpathSync(mkdtempSync(join(parent,'daily-'))),desktopResources=desktopIdentity(t,root);
 const config={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-original',requiresOpenaiAuth:true,stopGraceMs:100};
 for(const p of [config.runtime,config.workspace,config.codexHome])mkdirSync(p);
 let app=new Homer(config,async()=>{});
 try{
  await app.start();const thread=app.store.meta('mainThread'),binding=app.store.meta('binding');await app.close();
  app=new Homer({...config,desktopResources,pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}},async()=>{});
  await app.start();assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('binding'),binding);
  const response=JSON.parse(await app.message('synthetic new input'));
  assert.equal(response.threadMethod,'thread/resume');assert.equal(response.model,'deepseek-flash');assert.equal(response.effort,'max');assert.equal(response.turnServiceTier,null);
  assert.equal(app.store.meta('binding'),binding);
 }finally{await app.close();}
});
test('website A/B snapshots govern new Workers, resumed main and rollback while retaining private identity and history',async t=>{
 const {effectiveModelConfig}=await import('../src/config.ts');
 const {saveHomerConnection,saveHomerRuntimeConfig,readHomerConnection}=await import('../src/homer-account.ts');
 const root=realpathSync(mkdtempSync(join(parent,'config-ab-'))),desktopResources=desktopIdentity(t,root),file=join(root,'runtime-config.json');
 const boundary={gatewayOrigin:'https://models.super-tree.com'};
 const role={baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false};
 const terra={...role,model:'gpt-6.1-terra',effort:'high',context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'}};
 const a={main:{...terra},worker:{...terra}},b={main:{...role,context:{...role.context,contextWindow:600000,autoCompactTokenLimit:450000}},worker:{...role,effort:'high',context:{...role.context,contextWindow:700000,autoCompactTokenLimit:500000}}};
 const original={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-original',requiresOpenaiAuth:true,stopGraceMs:100};
 for(const path of [original.runtime,original.workspace,original.codexHome])mkdirSync(path);
 const bound=config=>({...original,desktopResources,pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:config});
 const worker=async snapshot=>{
  const config=effectiveModelConfig(bound(snapshot),'worker');
  const engine=new CodexEngine(config,{role:'worker',cwd:config.workspace,readRoots:[],instructions:'Offline A/B worker',tools:[],nativeCapabilities:true},async()=>({}));
  try{await engine.start();return JSON.parse((await engine.turn('synthetic worker')).text);}finally{assert.equal(await engine.close(),true);}
 };
 let app=new Homer(original,async()=>{});
 try{
  await app.start();const thread=app.store.meta('mainThread'),binding=app.store.meta('binding');await app.close();
  saveHomerConnection(file,{subject:'fixture_user',modelToken:'synthetic-ab-token',config:a},boundary);
  const active=readHomerConnection(file,boundary).config;
  app=new Homer(bound(active),async()=>{});await app.start();
  const initial=JSON.parse(await app.message('synthetic A'));assert.equal(initial.model,'gpt-6.1-terra');assert.equal(initial.effort,'high');assert.equal(initial.contextWindow,272000);assert.equal(initial.autoCompactTokenLimit,244800);assert.equal(initial.autoCompactTokenLimitScope,'total');
  const prior=app.store.db.prepare('SELECT * FROM conversation_messages ORDER BY rowid').all();assert.ok(prior.length>0);
  const historicalFile=join(original.workspace,'historical.txt');writeFileSync(historicalFile,'synthetic historical artifact\n');
  const saved=saveHomerRuntimeConfig(file,b,boundary);
  assert.equal(saved.token,'synthetic-ab-token');assert.equal(saved.subject,'fixture_user');
  const still=JSON.parse(await app.message('synthetic still A'));assert.equal(still.model,'gpt-6.1-terra');assert.equal(still.effort,'high');assert.equal(still.contextWindow,272000);assert.equal(still.autoCompactTokenLimit,244800);
  assert.equal((await worker(active)).effort,'high'); // Worker created after B was saved still uses A's running snapshot.
  await app.close();
  app=new Homer(bound(readHomerConnection(file,boundary).config),async()=>{});await app.start();
  assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('binding'),binding);
  assert.deepEqual(app.store.db.prepare('SELECT * FROM conversation_messages ORDER BY rowid LIMIT ?').all(prior.length),prior);
  const main=JSON.parse(await app.message('synthetic B'));
  assert.equal(main.contextWindow,600000);assert.equal(main.autoCompactTokenLimit,450000);assert.equal(main.threadMethod,'thread/resume');assert.equal(main.model,'deepseek-flash');assert.equal(main.effort,'max');assert.equal(main.turnServiceTier,null);
  const next=await worker(readHomerConnection(file,boundary).config);
  assert.equal(next.contextWindow,700000);assert.equal(next.autoCompactTokenLimit,500000);assert.equal(next.model,'deepseek-flash');assert.equal(next.effort,'high');assert.equal(next.turnServiceTier,null);
  saveHomerRuntimeConfig(file,a,boundary);await app.close();
  app=new Homer(bound(readHomerConnection(file,boundary).config),async()=>{});await app.start();
  const rollback=JSON.parse(await app.message('synthetic rollback A'));assert.equal(rollback.model,'gpt-6.1-terra');assert.equal(rollback.effort,'high');assert.equal(rollback.contextWindow,272000);assert.equal(rollback.autoCompactTokenLimit,244800);
  const rolledWorker=await worker(readHomerConnection(file,boundary).config);assert.equal(rolledWorker.model,'gpt-6.1-terra');assert.equal(rolledWorker.effort,'high');assert.equal(rolledWorker.contextWindow,272000);assert.equal(rolledWorker.autoCompactTokenLimit,244800);
  assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('binding'),binding);
  assert.deepEqual(app.store.db.prepare('SELECT * FROM conversation_messages ORDER BY rowid LIMIT ?').all(prior.length),prior);
  assert.equal(readFileSync(historicalFile,'utf8'),'synthetic historical artifact\n');
  assert.equal(readHomerConnection(file,boundary).token,'synthetic-ab-token');
 }finally{await app.close();}
});
for(const role of ['main','worker'])test(`website desktop ${role} sends its configured model, max and non-Fast without changing persisted binding`,async()=>{
 const {effectiveModelConfig}=await import('../src/config.ts');
 const {profileOverrides}=await import('../src/engine.ts');
 const root=mkdtempSync(join(parent,'website-'));
 const original={appData:join(root,'app-data'),nativeCodexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),model:'original',baseUrl:undefined,keyEnv:undefined,requiresOpenaiAuth:true,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),stopGraceMs:100,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},dailyDeepSeek:true,pauseOldDesktopWork:true,desktopConnection:{main:{baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}};
 for(const p of [original.runtime,original.workspace,original.codexHome])mkdirSync(p);
 const config=effectiveModelConfig(original,role),engine=new CodexEngine(config,{role,cwd:config.workspace,readRoots:[],instructions:'Offline synthetic test',tools:[],nativeCapabilities:true},async()=>({}));
 try{
  await engine.start();const result=JSON.parse((await engine.turn('synthetic')).text);
  assert.equal(result.contextWindow,512000);assert.equal(result.autoCompactTokenLimit,400000);assert.equal(result.autoCompactTokenLimitScope,'total');assert.equal(result.model,'deepseek-flash');assert.equal(result.effort,'max');assert.equal(result.turnServiceTier,null);
  assert.equal(result.consolidationModel,'deepseek-flash');
  assert.equal(result.extractionModel,'deepseek-flash');
  assert.equal(result.generateMemories,role==='main');
  for(const nativeTools of [true,false]){
   const policy=profileOverrides({...config,desktopResources:undefined},{role,cwd:config.workspace,readRoots:[config.appData],nativeTools});
   for(const file of ['runtime-config.json','.runtime-config.json.pending','deepseek.json','.deepseek.json.pending'])assert.equal(policy.filesystem[join(config.appData,file)],'deny');
  }
  assert.equal(original.model,'original');assert.equal(original.baseUrl,undefined);
 }finally{assert.equal(await engine.close(),true);}
});
