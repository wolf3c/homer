import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
// The caller points this at the complete bounded maintenance-source build.
const {Homer}=await import(process.env.HOMER_TEST_SERVICE_MODULE);
const {Store}=await import(new URL('./store.js',process.env.HOMER_TEST_SERVICE_MODULE));
const parent=resolve('.codex/scratch/macos-desktop-application/startup-unit-tests');mkdirSync(parent,{recursive:true});
function fixture(){const root=mkdtempSync(join(parent,'synthetic-'));mkdirSync(join(root,'runtime'));let starts=0;
 class Engine extends EventEmitter{async start(){starts++;throw Error('synthetic_start_failed');}async close(){return true;}async interrupt(){return true;}async turn(){return {status:'completed',text:''};}}
 const cfg={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const app=new Homer(cfg,async()=>{},()=>new Engine());return {root,app,starts:()=>starts};
}
test('desktop retains an unconfirmed old main lease when no new main was created',async()=>{
 const f=fixture(),lease=JSON.stringify({pid:process.pid,identity:'synthetic-unverified-identity'});
 f.app.store.setMeta('lease:main',lease);
 await assert.rejects(f.app.start({keepManagementOnFailure:true}),/orphan_stop_unconfirmed/);
 assert.equal(f.starts(),0);assert.equal(f.app.store.meta('lease:main'),lease);
 await assert.rejects(f.app.start({keepManagementOnFailure:true}),/desktop_start_owner_unconfirmed/);
 assert.equal(f.starts(),0);
 await assert.rejects(f.app.close({requireAllOwnersConfirmed:true}),/desktop_owner_stop_unconfirmed/);
 const db=new Store(join(f.root,'runtime/homer.sqlite'));assert.equal(db.meta('lease:main'),lease);db.close();
});
test('desktop closes only a newly created failed main and keeps management store open',async()=>{
 const f=fixture();process.chdir(f.root);await assert.rejects(f.app.start({keepManagementOnFailure:true}),/synthetic_start_failed/);
 assert.equal(f.starts(),1);assert.equal(f.app.store.meta('lease:main'),undefined);
 assert.equal(f.app.conversationState().threadId,'');await f.app.close({requireAllOwnersConfirmed:true});
});
test('desktop shutdown rejects a leftover Worker owner even when close() did not throw',async()=>{
 const f=fixture();f.app.store.setMeta('lease:synthetic-worker',JSON.stringify({pid:99999999,identity:'synthetic'}));
 f.app.workers.set('synthetic-worker',{id:'synthetic-worker',engine:{close:async()=>false}});
 await assert.rejects(f.app.close({requireAllOwnersConfirmed:true}),/desktop_owner_stop_unconfirmed/);
 const db=new Store(join(f.root,'runtime/homer.sqlite'));assert.ok(db.meta('lease:synthetic-worker'));db.close();
});
for(const kind of ['main','native-control'])test(`desktop shutdown never claims ${kind} stop=false as confirmed`,async()=>{
 const f=fixture();f.app[kind==='main'?'main':'nativeControl']={close:async()=>false};
 f.app.store.setMeta('lease:'+kind,JSON.stringify({pid:99999999,identity:'synthetic'}));
 await assert.rejects(f.app.close({requireAllOwnersConfirmed:true}),/stop_unconfirmed/);
 const db=new Store(join(f.root,'runtime/homer.sqlite'));assert.ok(db.meta('lease:'+kind));db.close();
});
