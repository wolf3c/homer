import assert from 'node:assert/strict';
import {fork,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {watchWindowsWake} from '../scripts/desktop-wake.mjs';

const [mode,receipt,failures]=process.argv.slice(2),instanceId='a'.repeat(64),session='b'.repeat(32);
if(mode==='--guardian-fixture'){
 let attempts=0;
 await watchWindowsWake(context=>{
  assert.equal(context.instanceId,instanceId);
  return async(operation,fields)=>{
   assert.equal(operation,'clear');assert.deepEqual(fields,{session});
   attempts++;writeFileSync(receipt,JSON.stringify({attempts,session}));
   if(attempts<=Number(failures))throw Error('synthetic task provider unavailable');
   return [];
  };
 });
}else{
 test('standalone Windows guardian entry resolves its client before acknowledging owner IPC',{timeout:10000},async t=>{
  const entry=new URL('../scripts/desktop-wake.mjs',import.meta.url);
  const code="Object.defineProperty(process,'platform',{value:'win32'});process.argv=[process.execPath,"+JSON.stringify(fileURLToPath(entry))+",'watch'];await import("+JSON.stringify(entry.href)+');';
  // This only checks module/IPC lifecycle. Missing Windows executables must make cleanup fail.
  const missingSystemRoot='C:\\HomerOfflineMissing-'+randomBytes(16).toString('hex');assert.equal(existsSync(missingSystemRoot),false);
  const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{SystemRoot:missingSystemRoot},stdio:['ignore','ignore','ignore','ipc']});
  try{
   const exit=once(child,'exit',{signal:t.signal});exit.catch(()=>{});
   const ready=once(child,'message',{signal:t.signal});ready.catch(()=>{});
   child.send({type:'watch',context:{bundle:'C:\\Homer',resources:'C:\\Homer\\resources',profile:'C:\\test-profile',instanceId},session});
   const [message]=await Promise.race([ready,exit.then(()=>{throw Error('guardian exited before ready');})]);
   assert.deepEqual(message,{type:'ready'});child.disconnect();
   const [code]=await exit;assert.equal(code,1,'unavailable Windows command is not a successful cleanup');
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 });
 test('Windows guardian removes only its session after owner IPC disappears and bounds cleanup retries',{timeout:15000},async t=>{
  const root=resolve('.codex/scratch/windows-power-tests');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'guardian-'));
  try{
   for(const failures of [0,2,3]){
    const receipt=join(directory,'receipt-'+failures+'.json');
    const child=fork(fileURLToPath(import.meta.url),['--guardian-fixture',receipt,String(failures)],{env:{},stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
    try{
     const exit=once(child,'exit',{signal:t.signal});exit.catch(()=>{});
     child.send({type:'watch',context:{instanceId},session});
     const [ready]=await once(child,'message',{signal:t.signal});assert.deepEqual(ready,{type:'ready'});
     child.disconnect();
     const [code]=await exit;assert.equal(code,failures===3?1:0);
     assert.deepEqual(JSON.parse(readFileSync(receipt,'utf8')),{attempts:Math.min(failures+1,3),session});
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
   }
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
}
