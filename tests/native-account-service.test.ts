import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter}from'node:events';import{mkdtempSync,mkdirSync,rmSync}from'node:fs';import{join,resolve}from'node:path';import{Homer}from'../src/service.js';import{CodexEngine,type EngineOptions}from'../src/engine.js';import{NativeAccount}from'../src/native-account.js';
const scratch=resolve('.codex/scratch/native-account-browser-login');mkdirSync(scratch,{recursive:true});
function config(){const dir=mkdtempSync(join(scratch,'service-'));mkdirSync(join(dir,'runtime'));mkdirSync(join(dir,'workspace'));return{appData:dir,codexHome:join(dir,'legacy-native'),nativeCodexHome:join(dir,'legacy-native'),codexBin:resolve('tests/fixtures/native-account-app-server.mjs'),runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};}
test('control child without memory relays account notification before thread filtering, restart reads native storage, logout confirms empty state',async()=>{const c=config();c.codexHome=c.nativeCodexHome=join(c.appData,'codex');mkdirSync(c.codexHome,{recursive:true});const start=async()=>{const e=new CodexEngine(c,{cwd:c.appData,readRoots:[],instructions:'Synthetic only',tools:[],controlOnly:true},async()=>({}));const m=new NativeAccount((method,params)=>e.request(method,params));e.on('accountLoginCompleted',v=>m.completed(v));assert.equal(await e.start(),"");assert.equal(e.threadId,undefined);await assert.rejects(e.turn("Synthetic forbidden turn"),/engine_not_started/);return{e,m};};let p=await start();try{assert.equal((await p.m.start()).phase,'waiting');await p.e.request('synthetic/complete',{success:true});assert.equal((await p.m.state()).connected,true);await p.m.close();assert.equal(await p.e.close(),true);p=await start();const restored=await p.m.state();assert.equal(restored.connected,true);assert.equal(JSON.stringify(restored).includes('PRIVATE'),false);assert.equal((await p.m.logout()).connected,false);}finally{await p.m.close();await p.e.close();}});
test('Homer owns one control child, user-only account mutations and login handoff fence retain original main thread',async()=>{const c=Object.assign(config(),{context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total' as const},capabilities:{inputModalities:['text'] as ('text'|'image')[],reasoningEfforts:['high'],webSearch:false,toolSearch:false},effort:'high'});class Main extends EventEmitter{threadId='synthetic-original-main';resumable=true;async start(){return this.threadId;}async turn(){return{status:'completed',text:'Synthetic'};}async close(){return true;}async interrupt(){return true;}}
 const app=new Homer(c,async()=>{},(_options:EngineOptions)=>new Main());try{await app.start();const thread=app.store.meta('mainThread'),tools=app.store.meta('mainToolsHash');await assert.rejects(()=>app.manageNativeAccount({action:'account_login'}),/native_account_user_action_required/);assert.equal(app.upgradeStatus().safe,true);const started=await app.manageNativeAccount({action:'account_login',approve:true});assert.equal(started.phase,'waiting');assert.equal(app.upgradeStatus().safe,false);const state=await app.manageNativeAccount({action:'account_state'});assert.equal(state.phase,'waiting');const manager=(app as any).nativeControl;await manager.request('synthetic/complete',{success:true});assert.equal((await app.manageNativeAccount({action:'account_state'})).connected,true);assert.equal(app.upgradeStatus().safe,true);assert.equal(app.store.meta('mainThread'),thread);assert.equal(app.store.meta('mainToolsHash'),tools);assert.equal(app.store.db.prepare("SELECT count(*) n FROM meta WHERE key='lease:native-control'").get()!.n,1);}finally{await app.close();}});

test('Main startup adopts prior login changes and preserves changes arriving during startup', async t => {
 for (const duringStartup of [false, true]) {
  await t.test(duringStartup ? 'new change during startup' : 'login completed before startup', async () => {
   const c = config();
   const forces: boolean[] = [];
   let app: Homer;
   class Main extends EventEmitter {
    async start() {
     if (duringStartup) {
      const control = (app as any).nativeControl as CodexEngine;
      await control.request('synthetic/complete', {success: true});
     }
     return 'synthetic-original-main';
    }
    async refreshCapabilities(force: boolean) {
     forces.push(force);
     return {pending: false};
    }
    async close() { return true; }
   }
   app = new Homer(c, async () => {}, () => new Main() as any);
   try {
    await app.manageNativeAccount({action: 'account_login', approve: true});
    const control = (app as any).nativeControl as CodexEngine;
    await control.request('synthetic/complete', {success: true});
    assert.equal((await app.manageNativeAccount({action: 'account_state'})).connected, true);
    await app.start({keepManagementOnFailure: true});
    await (app as any).refreshMainCapabilities();
    await (app as any).refreshMainCapabilities();
    assert.deepEqual(forces, [duringStartup, false]);
    assert.equal(app.store.meta('mainThread'), 'synthetic-original-main');
   } finally { await app.close(); }
  });
 }
});

test('live ChatGPT save validates both roles and commits memory only after the profile write succeeds',async()=>{
 const c=Object.assign(config(),{chatgpt:undefined as import('../src/model-config.js').ChatGPTModelOverrides|undefined,model:'synthetic-hot-text',desktopModelSource:'codex' as const,desktopResources:{bundleRoot:'synthetic',manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs')});
 const app=new Homer(c,async()=>{}),roles={main:{model:'synthetic-hot-image',effort:'low',serviceTier:'ultrafast'},worker:{model:'synthetic-hot-text',effort:'high',serviceTier:null}};
 try{
  const before=c.chatgpt;let saved;
  await assert.rejects(()=>app.applyChatGPTModels(roles,()=>{throw Error('PRIVATE_DISK_FAILURE');}),/chatgpt_model_save_failed/);assert.equal(c.chatgpt,before);
  await assert.rejects(()=>app.applyChatGPTModels({...roles,extra:{}},()=>{throw Error('unexpected_write');}),/chatgpt_model_config_invalid/);
  await app.applyChatGPTModels(roles,value=>{assert.equal(c.chatgpt,before);saved=value;});assert.deepEqual(saved,roles);assert.deepEqual(c.chatgpt,roles);assert.equal(app.store.meta('mainThread'),undefined);
 }finally{await app.close();rmSync(c.appData,{recursive:true,force:true});}
});
