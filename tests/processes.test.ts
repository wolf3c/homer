// Synthetic ps tables and signal delivery only; never inspect or signal host processes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {transpileModule,ModuleKind} from 'typescript';
import type {UnixChildrenSnapshot} from '../src/processes.js';

const require=createRequire(import.meta.url),owner=9100;
const identity=(pid:number,pgid=owner)=>`Mon Nov 16 12:00:00 2026 ${pgid} /synthetic/process-${pid}`;
async function fixture(platform='darwin'){
 const live=new Map([[owner,identity(owner)],[9101,identity(9101)],[9102,identity(9102)]]),signals:[number,string|number|undefined][]=[];
 const unreadable=new Set<number>();let table=`${owner} 1 ${owner}\n9101 ${owner} ${owner}\n9102 9101 ${owner}\n`,onTable=()=>{},ignoreTerm=false,signalError:string|undefined;
 const missing=()=>Object.assign(Error('synthetic_process_absent'),{code:'ESRCH'});
 const group=(value:string)=>Number(value.trim().split(/\s+/)[5]);
 const process={platform,env:{},kill(pid:number,signal?:string|number){
  if(signal===0){if(signalError)throw Object.assign(Error('synthetic_probe_failed'),{code:signalError});if(pid>0?live.has(pid):[...live.values()].some(value=>group(value)===-pid))return true;throw missing();}
  assert.ok(pid>1,'cleanup must signal only individual positive PIDs');signals.push([pid,signal]);if(!live.has(pid))throw missing();if(signal!=='SIGTERM'||!ignoreTerm)live.delete(pid);return true;
 }};
 const childProcess={execFileSync(_bin:string,args:string[]){
  if(args[0]==='-p'){const pid=Number(args[1]);if(!live.has(pid)||unreadable.has(pid))throw missing();return live.get(pid);}
  assert.deepEqual([...args],['-axo','pid=,ppid=,pgid=']);onTable();return table;
 }};
 const modules:Record<string,any>={'node:child_process':childProcess,'../scripts/windows-security.mjs':{windowsCommand(){throw Error('windows_path_must_not_run');}}};
 const context=vm.createContext({process,setTimeout,clearTimeout,Date});
 const code=transpileModule(readFileSync(new URL('../src/processes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ModuleKind.ESNext}}).outputText;
 const entry=new vm.SourceTextModule(code,{context});
 await entry.link(async name=>{const exports=modules[name]??require(name);const value=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,result]of Object.entries(exports))this.setExport(key,result);},{context});await value.link(()=>{throw Error('unexpected_synthetic_import');});await value.evaluate();return value;});await entry.evaluate();
 const api=entry.namespace as unknown as {captureUnixChildren(lease:{pid:number;identity:string}):UnixChildrenSnapshot|undefined;terminateUnixChildren(snapshot:UnixChildrenSnapshot|undefined,graceMs:number):Promise<boolean>};
 return{live,signals,unreadable,api,lease:{pid:owner,identity:identity(owner)},setTable:(value:string)=>{table=value;},setOnTable:(value:()=>void)=>{onTable=value;},ignoreTerm:()=>{ignoreTerm=true;},probeError:(value:string)=>{signalError=value;}};
}

if(!vm.SourceTextModule){
 test('Unix child ownership contracts run in isolated VM modules',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,['--import','tsx','--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{env,encoding:'utf8'});assert.match(output,/# fail 0/);
 });
}else{
 test('Unix cleanup captures connected owned group and signals matching children after leader exit',async()=>{
  const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);assert.equal(snapshot.children.length,2);
  f.live.delete(owner);assert.equal(await f.api.terminateUnixChildren(snapshot,0),true);assert.deepEqual(f.signals,[[9101,'SIGTERM'],[9102,'SIGTERM']]);
 });
 for(const mode of ['stale','unreadable','changed-during-capture'])test('Unix capture refuses '+mode+' leader identity',async()=>{
  const f=await fixture();if(mode==='stale')f.lease.identity='old-leader';if(mode==='unreadable')f.unreadable.add(owner);if(mode==='changed-during-capture')f.setOnTable(()=>f.live.set(owner,'reused-leader'));
  assert.equal(f.api.captureUnixChildren(f.lease),undefined);assert.deepEqual(f.signals,[]);
 });
 for(const table of [`${owner} 1 ${owner}\n9101 999 ${owner}`,`${owner} 1 ${owner}\n9101 ${owner} ${owner}\n9101 ${owner} ${owner}`,'invalid ps output'])test('Unix capture rejects incomplete or malformed ancestry: '+table.split('\n').length+' rows '+table.length,async()=>{
  const f=await fixture();f.setTable(table);assert.equal(f.api.captureUnixChildren(f.lease),undefined);assert.deepEqual(f.signals,[]);
 });
 test('Unix capture requires child identities to retain the captured group',async()=>{
  const f=await fixture();f.live.set(9102,identity(9102,9200));assert.equal(f.api.captureUnixChildren(f.lease),undefined);f.live.set(9102,identity(9102));f.unreadable.add(9102);assert.equal(f.api.captureUnixChildren(f.lease),undefined);
 });
 test('Unix capture excludes normal children with their own process groups',async()=>{
  const f=await fixture();f.setTable(`${owner} 1 ${owner}\n9101 ${owner} ${owner}\n9102 9101 ${owner}\n9200 ${owner} 9200`);f.live.set(9200,identity(9200,9200));const snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);f.live.delete(owner);assert.equal(await f.api.terminateUnixChildren(snapshot,0),true);assert.ok(f.live.has(9200));assert.ok(f.signals.every(([pid])=>pid!==9200));
 });
 for(const mode of ['reused','unreadable','EPERM','EIO'])test('Unix cleanup sends no signals when leader absence is unconfirmed: '+mode,async()=>{
  const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);if(mode==='reused')f.live.set(owner,'reused-leader');if(mode==='unreadable')f.unreadable.add(owner);if(mode==='EPERM'||mode==='EIO'){f.live.delete(owner);f.probeError(mode);}
  assert.equal(await f.api.terminateUnixChildren(snapshot,0),false);assert.deepEqual(f.signals,[]);
 });
 test('Unix cleanup never signals a changed child and refuses its surviving group',async()=>{
  const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);f.live.delete(owner);f.live.set(9101,'Mon Nov 16 12:00:01 2026 9100 /synthetic/reused-child');assert.equal(await f.api.terminateUnixChildren(snapshot,0),false);assert.deepEqual(f.signals,[[9102,'SIGTERM']]);
 });
 test('Unix cleanup leaves uncaptured late children unconfirmed',async()=>{
  const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);f.live.delete(owner);f.live.set(9103,identity(9103));assert.equal(await f.api.terminateUnixChildren(snapshot,0),false);assert.deepEqual(f.signals,[[9101,'SIGTERM'],[9102,'SIGTERM']]);
 });
 test('Unix cleanup needs no signals for a naturally drained group',async()=>{
  const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);f.live.clear();assert.equal(await f.api.terminateUnixChildren(snapshot,0),true);assert.deepEqual(f.signals,[]);
 });
 test('Unix cleanup escalates only captured unchanged children',async()=>{
  const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);assert.ok(snapshot);f.live.delete(owner);f.ignoreTerm();assert.equal(await f.api.terminateUnixChildren(snapshot,0),true);assert.deepEqual(f.signals,[[9101,'SIGTERM'],[9102,'SIGTERM'],[9101,'SIGKILL'],[9102,'SIGKILL']]);
 });
 for(const pid of [0,1,-1,NaN,1.5])test('Unix capture refuses invalid PID '+pid,async()=>{const f=await fixture();assert.equal(f.api.captureUnixChildren({pid,identity:'invalid-owner'}),undefined);assert.deepEqual(f.signals,[]);});
 for(const grace of [-1,NaN,Infinity,1.5])test('Unix cleanup refuses invalid grace '+grace,async()=>{const f=await fixture(),snapshot=f.api.captureUnixChildren(f.lease);f.live.delete(owner);assert.equal(await f.api.terminateUnixChildren(snapshot,grace),false);assert.deepEqual(f.signals,[]);});
 test('Unix helpers refuse Windows and invalid ownership without signals',async()=>{
  const f=await fixture('win32');assert.equal(f.api.captureUnixChildren(f.lease),undefined);assert.equal(await f.api.terminateUnixChildren(undefined,0),false);assert.deepEqual(f.signals,[]);
 });
}
