import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({missingThread=false}={}){
 const events=[],sent=[],pending=[],children=[],locks=[];
 const input=new PassThrough(),output=new Writable({write(_b,_e,done){done();}}),proc=new EventEmitter();
 Object.assign(proc,{env:{},argv:[],execPath:process.execPath});
 let stop,account;
 class Journal{
  pending(){return pending;} rejected(){return [];} bindContract(){} bindThread(thread){this.thread=thread;} close(){locks.push('journal-closed');}
 }
 const modules={
  'node:child_process':{fork(){const child=new EventEmitter();child.connected=true;child.send=value=>sent.push(value);children.push(child);return child;}},
  'node:fs':{existsSync:()=>false,readFileSync(){throw Error('unexpected_source_read');},mkdirSync(){},rmSync(){throw Error('unexpected_cleanup');}},
  './dev-ingress.mjs':{IngressJournal:Journal},
  './trusted-build.mjs':{verifyBuild(){}},
  './dev-build.mjs':Object.fromEntries(['sourceSnapshot','buildCandidate','buildUiCandidate','backendHash','uiHash','trustedHash','candidateGuard'].map(name=>[name,()=>{throw Error('unexpected_build');}])),
 };
 const dynamic={
  'file:///fixture/dist/desktop-management.js':{desktopManagementAllowed:()=>false},
  'file:///fixture/dist/processes.js':{acquireLock:()=>()=>locks.push('gateway-released')},
 };
 const context=vm.createContext({process:proc,console,Buffer,setTimeout,clearTimeout,setInterval,clearInterval,performance});
 const synthetic=async exports=>{const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;};
 const entry=new vm.SourceTextModule(readFileSync('scripts/dev.mjs','utf8'),{context,initializeImportMeta:meta=>{meta.url='file:///fixture/scripts/dev.mjs';},importModuleDynamically:name=>{assert.ok(dynamic[name],name);return synthetic(dynamic[name]);}});
 await entry.link(name=>synthetic(modules[name]??createRequire(import.meta.url)(name)));await entry.evaluate();
 const build={directory:'/fixture',config:{runtime:'/fixture/runtime',appData:'/fixture/profile'},boundary:'fixture',schema:'schema',toolsHash:'tools',thread:missingThread?undefined:'original-thread',hash:'build',version:'0.1.0',uiHash:'ui'};
 const done=entry.namespace.runDev({root:'/fixture',input,output,fixedBuild:build,desktop:{bindAccount:fn=>{account=fn;},bindUpdateStop:fn=>{stop=fn;},onEvent:event=>events.push(event)}});
 await tick();assert.equal(children.length,1);
 const child=children[0];child.emit('message',{kind:'ready',thread:build.thread});await tick();
 return {done,events,sent,pending,children,locks,stop,account,input,child,cleanup:async()=>{input.write('/quit\n');child.emit('exit',0,null);await done;input.destroy();}};
}
if(!vm.SourceTextModule){
 test('desktop update stop contracts run with VM modules',()=>execFileSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe'}));
}else{
 test('safe desktop update freezes ingress and releases gateway only after confirmed host exit, without relaunch',async()=>{
  const f=await fixture();try{
   assert.equal(typeof f.stop,'function','missing safe update-stop binding');f.stop();
   const probe=f.sent.at(-1);assert.equal(probe.kind,'probe');f.child.emit('message',{kind:'upgrade_probe',id:probe.id,safe:true});await tick();
   assert.equal(f.sent.at(-1).kind,'prepare');assert.deepEqual(f.locks,[]);
   f.child.emit('message',{kind:'handoff',thread:'original-thread'});f.child.emit('message',{kind:'desktop_stopped',confirmed:true});await tick();assert.deepEqual(f.locks,[]);
   f.child.emit('exit',0,null);const result=await f.done;assert.equal(result.updateStopped,true);assert.equal(result.stoppedConfirmed,true);assert.equal(f.children.length,1);assert.deepEqual(f.locks,['journal-closed','gateway-released']);
  }finally{await f.cleanup();}
 });
 for(const busy of ['owner','pending','final-check'])test('update '+busy+' remains busy without stopping the owner',async()=>{
  const f=await fixture();try{
   assert.equal(typeof f.stop,'function','missing safe update-stop binding');f.stop();const probe=f.sent.at(-1);
   if(busy==='pending')f.pending.push({id:'unknown'});
   f.child.emit('message',{kind:'upgrade_probe',id:probe.id,safe:busy!=='owner'});await tick();
   if(busy==='final-check')f.child.emit('message',{kind:'busy'});await tick();
   assert.equal(f.events.at(-1).kind,'update-busy');assert.deepEqual(f.locks,[]);assert.equal(f.children.length,1);assert.equal(f.sent.some(m=>m.kind==='stop'),false);
  }finally{await f.cleanup();}
 });
 test('ordinary stop or missing owner confirmation cannot become a successful update stop',async()=>{
  const f=await fixture();try{
   assert.equal(typeof f.stop,'function','missing safe update-stop binding');f.stop();const probe=f.sent.at(-1);f.child.emit('message',{kind:'upgrade_probe',id:probe.id,safe:true});await tick();
   f.child.emit('message',{kind:'handoff',thread:'original-thread'});f.child.emit('exit',0,null);await tick();
   assert.equal(f.events.some(m=>m.kind==='update-stopped'),false);assert.equal(f.children.length,1);assert.deepEqual(f.locks,[]);
  }finally{await f.cleanup();}
 });
 test('missing handoff identity is never accepted as an update stop',async()=>{
  const f=await fixture({missingThread:true});try{
   f.stop();const probe=f.sent.at(-1);f.child.emit('message',{kind:'upgrade_probe',id:probe.id,safe:true});await tick();
   f.child.emit('message',{kind:'handoff'});f.child.emit('message',{kind:'desktop_stopped',confirmed:true});f.child.emit('exit',0,null);await tick();
   assert.deepEqual(f.locks,[],'unknown thread must retain the owner');assert.equal(f.children.length,1);
  }finally{await f.cleanup();}
 });

 for(const kind of ['pending','in-flight','account-write'])test('existing '+kind+' blocks update before probing, without clearing work',async()=>{
  const f=await fixture();try{
   if(kind==='pending')f.pending.push({id:'unknown'});
   if(kind==='in-flight')f.input.write('/status\n');
   if(kind==='account-write')void f.account('connect').catch(()=>{});
   await tick();f.stop();assert.equal(f.events.at(-1).kind,'update-busy');assert.equal(f.sent.some(m=>m.kind==='probe'),false);assert.deepEqual(f.locks,[]);
  }finally{await f.cleanup();}
 });
 test('prepare freeze rejects new account actions until an explicit busy response restores the owner',async()=>{
  const f=await fixture();try{
   f.stop();const probe=f.sent.at(-1);f.child.emit('message',{kind:'upgrade_probe',id:probe.id,safe:true});await tick();
   await assert.rejects(f.account('connect'),/desktop_account_unavailable/);assert.equal(f.sent.at(-1).kind,'prepare');
   f.child.emit('message',{kind:'busy'});await tick();f.stop();assert.equal(f.sent.at(-1).kind,'probe');assert.deepEqual(f.locks,[]);
  }finally{await f.cleanup();}
 });

}
