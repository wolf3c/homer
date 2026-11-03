import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexEngine} from '../src/engine.ts';
import {Homer} from '../src/service.ts';
import {deepSeekConfig} from '../scripts/desktop-deepseek.mjs';
const parent=resolve('.codex/scratch/desktop-deepseek/engine');mkdirSync(parent,{recursive:true});
test('Codex and website role projections switch without replacing the thread, binding or history',async()=>{
 const {effectiveModelConfig}=await import('../src/config.ts');
 const root=mkdtempSync(join(parent,'dual-')),base={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-original',requiresOpenaiAuth:true,stopGraceMs:100,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false}}};
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
for(const role of ['main','worker'])test(`desktop DeepSeek ${role} sends high and explicit non-Fast on the native protocol`,async()=>{
 const root=mkdtempSync(join(parent,'synthetic-'));
 const paths={root,runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex')};
 for(const part of [paths.runtime,paths.workspace,paths.codexHome])mkdirSync(part);
 const config={...deepSeekConfig(paths),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),stopGraceMs:100};
 const engine=new CodexEngine(config,{role,cwd:paths.workspace,readRoots:[],instructions:'Offline synthetic test',tools:[],nativeCapabilities:true},async()=>({}));
 try{
  await engine.start();const result=await engine.turn('synthetic-only');const actual=JSON.parse(result.text);
  assert.equal(actual.model,'deepseek-flash');assert.equal(actual.effort,'high');
  assert.equal(actual.threadServiceTier,null);assert.equal(actual.turnServiceTier,null);
 }finally{assert.equal(await engine.close(),true);}
});
test('website desktop keeps the account binding and resumed thread while sending new work with max',async()=>{
 const root=mkdtempSync(join(parent,'daily-'));
 const config={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-original',requiresOpenaiAuth:true,stopGraceMs:100};
 for(const p of [config.runtime,config.workspace,config.codexHome])mkdirSync(p);
 let app=new Homer(config,async()=>{});
 try{
  await app.start();const thread=app.store.meta('mainThread'),binding=app.store.meta('binding');await app.close();
  app=new Homer({...config,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true,dailyDeepSeek:true,desktopConnection:{main:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false},worker:{baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',effort:'max',fast:false}}},async()=>{});
  await app.start();assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('binding'),binding);
  const response=JSON.parse(await app.message('synthetic new input'));
  assert.equal(response.threadMethod,'thread/resume');assert.equal(response.model,'deepseek-flash');assert.equal(response.effort,'max');assert.equal(response.turnServiceTier,null);
  assert.equal(app.store.meta('binding'),binding);
 }finally{await app.close();}
});
for(const role of ['main','worker'])test(`website desktop ${role} sends its configured model, max and non-Fast without changing persisted binding`,async()=>{
 const {effectiveModelConfig}=await import('../src/config.ts');
 const {profileOverrides}=await import('../src/engine.ts');
 const root=mkdtempSync(join(parent,'website-'));
 const original={...deepSeekConfig({root,runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex')}),model:'original',baseUrl:undefined,keyEnv:undefined,requiresOpenaiAuth:true,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),stopGraceMs:100,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},dailyDeepSeek:true,pauseOldDesktopWork:true,desktopConnection:{main:{baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',effort:'max',fast:false},worker:{baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',effort:'max',fast:false}}};
 for(const p of [original.runtime,original.workspace,original.codexHome])mkdirSync(p);
 const config=effectiveModelConfig(original,role),engine=new CodexEngine(config,{role,cwd:config.workspace,readRoots:[],instructions:'Offline synthetic test',tools:[],nativeCapabilities:true},async()=>({}));
 try{
  await engine.start();const result=JSON.parse((await engine.turn('synthetic')).text);
  assert.equal(result.model,'deepseek-flash');assert.equal(result.effort,'max');assert.equal(result.turnServiceTier,null);
  assert.equal(result.consolidationModel,'deepseek-flash');
  for(const nativeTools of [true,false]){
   const policy=profileOverrides({...config,desktopResources:undefined},{role,cwd:config.workspace,readRoots:[config.appData],nativeTools});
   for(const file of ['runtime-config.json','.runtime-config.json.pending','deepseek.json','.deepseek.json.pending'])assert.equal(policy.filesystem[join(config.appData,file)],'deny');
  }
  assert.equal(original.model,'original');assert.equal(original.baseUrl,undefined);
 }finally{assert.equal(await engine.close(),true);}
});
