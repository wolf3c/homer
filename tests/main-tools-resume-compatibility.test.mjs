import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const serviceUrl=process.env.HOMER_TEST_SERVICE_MODULE;
const {Homer}=await import(serviceUrl),{MAIN_TOOLS}=await import(new URL('./tools.js',serviceUrl));
const {RECURSIVE_TOOLS}=await import(new URL('./recursive-tools.js',serviceUrl));
const originalHash='e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a';
const v014Hash='f579ad37daedcef8a429e13a0511668b2ef954abbc180e47b408475c5395cffe';
const optionalTitleHash='d8a4bd52a287759bcbcd4eb754a8e41e344ac6e1ab287576f4c8b2172202f150';
const precedingHash='3dcdac3082ccab73356fe9632796de5cb017b960195226edfb123b322cd94a2e';
const workerSendHash='3874cdfbd5bf237022ca72815f8a5d9ffa01c1a15659320c0d6b2aa4644498ca';
const currentHash=createHash('sha256').update(JSON.stringify([...MAIN_TOOLS,...RECURSIVE_TOOLS])).digest('hex');
const parent=resolve('.codex/scratch/macos-desktop-application/tools-resume');mkdirSync(parent,{recursive:true});
function fixture(savedHash){
 const root=mkdtempSync(join(parent,'synthetic-'));mkdirSync(join(root,'runtime'));let starts=0,resumed,catalog;
 class Engine extends EventEmitter{
  constructor(options){super();this.threadId=options.threadId;resumed=options.threadId;catalog=options.tools;}
  async start(){starts++;return this.threadId??'synthetic-new-thread';}
  async close(){return true;}async interrupt(){return true;}
  async turn(){throw Error('no_model_turn_authorized');}
 }
 const app=new Homer({appData:root,workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},options=>new Engine(options));
 app.store.setMeta('mainThread','synthetic-original-thread');app.store.setMeta('mainToolsHash',savedHash);
 return {app,root,starts:()=>starts,resumed:()=>resumed,catalog:()=>catalog};
}
test('resume retains the exact complete current dynamic catalog and original thread',async()=>{
 const f=fixture(currentHash);
 try{
  await f.app.start({keepManagementOnFailure:true});assert.equal(f.starts(),1);assert.equal(f.resumed(),'synthetic-original-thread');
  assert.equal(f.app.store.meta('mainThread'),'synthetic-original-thread');assert.equal(f.app.store.meta('mainToolsHash'),currentHash);
  assert.deepEqual(f.catalog(),[...MAIN_TOOLS,...RECURSIVE_TOOLS]);
 }finally{await f.app.close({requireAllOwnersConfirmed:true});rmSync(f.root,{recursive:true,force:true});}
});
for(const hash of [workerSendHash,precedingHash,originalHash,v014Hash,optionalTitleHash,'615506d5ebbfc9ade218daa6793de1b0318d10a3016463b99da0395d498aaccf','2741b9169535017c5b55d191ee7a246333f0074ee0162a951be11f370cd84b19','f'.repeat(64)])test('an obsolete or unknown tools fingerprint cannot create or replace an existing thread: '+hash.slice(0,8),async()=>{
 const f=fixture(hash);
 try{
  await assert.rejects(f.app.start({keepManagementOnFailure:true}),/main_tools_migration_required/);assert.equal(f.starts(),0);
  assert.equal(f.app.store.meta('mainToolsHash'),hash);assert.equal(f.app.store.meta('mainThread'),'synthetic-original-thread');
 }finally{await f.app.close({requireAllOwnersConfirmed:true});rmSync(f.root,{recursive:true,force:true});}
});
