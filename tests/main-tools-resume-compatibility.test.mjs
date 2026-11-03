import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const serviceUrl=process.env.HOMER_TEST_SERVICE_MODULE;
const {Homer}=await import(serviceUrl),{MAIN_TOOLS,canResumeMainTools}=await import(new URL('./tools.js',serviceUrl));
const originalHash='e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a';
const currentHash=createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex');
const parent=resolve('.codex/scratch/macos-desktop-application/tools-resume');mkdirSync(parent,{recursive:true});
function fixture(savedHash){
 const root=mkdtempSync(join(parent,'synthetic-'));mkdirSync(join(root,'runtime'));let starts=0,resumed;
 class Engine extends EventEmitter{
  constructor(options){super();this.threadId=options.threadId;resumed=options.threadId;}
  async start(){starts++;return this.threadId??'synthetic-new-thread';}
  async close(){return true;}async interrupt(){return true;}
  async turn(){throw Error('no_model_turn_authorized');}
 }
 const app=new Homer({appData:root,workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},options=>new Engine(options));
 app.store.setMeta('mainThread','synthetic-original-thread');app.store.setMeta('mainToolsHash',savedHash);
 return {app,starts:()=>starts,resumed:()=>resumed};
}
for(const [name,hash] of [['historical exact five-tool contract',originalHash],['current contract',currentHash]])test(`resume retains ${name} and the original fingerprint`,async()=>{
 const f=fixture(hash);
 try{
  await f.app.start({keepManagementOnFailure:true});assert.equal(f.starts(),1);assert.equal(f.resumed(),'synthetic-original-thread');
  assert.equal(f.app.store.meta('mainThread'),'synthetic-original-thread');assert.equal(f.app.store.meta('mainToolsHash'),hash);
 }finally{await f.app.close({requireAllOwnersConfirmed:true});}
});
test('unknown tools fingerprint cannot create or replace an existing thread',async()=>{
 const f=fixture('f'.repeat(64));
 try{
  await assert.rejects(f.app.start({keepManagementOnFailure:true}),/main_tools_migration_required/);assert.equal(f.starts(),0);
  assert.equal(f.app.store.meta('mainToolsHash'),'f'.repeat(64));assert.equal(f.app.store.meta('mainThread'),'synthetic-original-thread');
 }finally{await f.app.close({requireAllOwnersConfirmed:true});}
});
test('historical compatibility is fenced to the exact reviewed target contract',()=>{
 assert.equal(canResumeMainTools(originalHash,currentHash),true);
 assert.equal(canResumeMainTools(originalHash,'a'.repeat(64)),false);
 assert.equal(canResumeMainTools(undefined,currentHash),false);
});
