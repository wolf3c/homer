import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

import {screenIsLocked,runXcodebuild} from '../scripts/ios-xcodebuild.mjs';
const unlocked='"IOConsoleUsers" = ({"kCGSSessionOnConsoleKey"=Yes,"kCGSessionLoginDoneKey"=Yes})';
const locked=unlocked.replace('Yes})','Yes,"CGSSessionScreenIsLocked"=Yes})');

function processes(t,{build='process.exit(0)',awake='setInterval(()=>{},1000)'}={}){
 const children=[];const calls=[];
 t.after(async()=>{
  for(const child of children){
   if(child.exitCode!==null||child.signalCode!==null)continue;
   const closed=once(child,'close').catch(()=>{});
   try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
   await closed;
  }
 });
 return {children,calls,spawnProcess(file,args,options){
  assert.ok(['/usr/bin/caffeinate','/usr/bin/xcodebuild'].includes(file));
  calls.push({file,args});
  const child=spawn(process.execPath,['-e',file.endsWith('caffeinate')?awake:build],options);
  children.push(child);return child;
 }};
}

test('screen state rejects unknown output and distinguishes locked and unlocked console sessions',async()=>{
 assert.equal(screenIsLocked(unlocked),false);
 assert.equal(screenIsLocked(locked),true);
 assert.equal(screenIsLocked(unlocked.replace('Yes})','Yes,"CGSSessionScreenIsLocked"=No})')),false);
 assert.throws(()=>screenIsLocked('unrecognized ioreg output'),/screen_state_unavailable/);
 assert.throws(()=>screenIsLocked(unlocked.replace('OnConsoleKey"=Yes','OnConsoleKey"=No')),/screen_state_unavailable/);
 assert.throws(()=>screenIsLocked(unlocked.replace('Yes})','Yes,"CGSSessionScreenIsLocked"=Unknown})')),/screen_state_unavailable/);
 assert.throws(()=>screenIsLocked(unlocked.replace('LoginDoneKey"=Yes','LoginDoneKey"=No')),/screen_state_unavailable/);
});

test('locked console cannot launch xcodebuild until the next observation is unlocked',async t=>{
 const fixture=processes(t);let checks=0;
 const code=await runXcodebuild(['-exportArchive','path with spaces'],{
  spawnProcess:fixture.spawnProcess,
  readLocked:async()=>{
   assert.equal(fixture.calls.filter(x=>x.file.endsWith('xcodebuild')).length,0);
   return ++checks===1;
  },
 });
 assert.equal(code,0);assert.equal(checks,2);
 assert.deepEqual(fixture.calls[0].args,['-di','-w',String(process.pid)]);
 assert.deepEqual(fixture.calls[1].args,['-exportArchive','path with spaces']);
 assert.ok(fixture.children.every(c=>c.exitCode!==null||c.signalCode!==null));
});

test('unreadable screen state prevents signing and releases the sleep assertion process',async t=>{
 const fixture=processes(t);
 await assert.rejects(runXcodebuild(['archive'],{spawnProcess:fixture.spawnProcess,readLocked:async()=>{throw Error('screen_state_unavailable');}}),/screen_state_unavailable/);
 assert.equal(fixture.calls.length,1);
 assert.ok(fixture.children[0].signalCode);
});

test('loss of the sleep assertion prevents xcodebuild from starting',async t=>{
 const fixture=processes(t,{awake:'process.exit(1)'});
 await assert.rejects(runXcodebuild(['archive'],{spawnProcess:fixture.spawnProcess,readLocked:async()=>{await once(fixture.children[0],'close');return false;}}),/sleep_assertion_failed/);
 assert.equal(fixture.calls.length,1);
});

test('normal build exit code is preserved and sleep assertion is released',async t=>{
 const fixture=processes(t,{build:'process.exit(37)'});
 assert.equal(await runXcodebuild(['archive'],{spawnProcess:fixture.spawnProcess,readLocked:async()=>false}),37);
 assert.ok(fixture.children.every(c=>c.exitCode!==null||c.signalCode!==null));
});

test('split credential errors stop the command without retrying, even if it ignores SIGTERM',async t=>{
 const fixture=processes(t,{build:`
  process.on('SIGTERM',()=>{});
  process.stderr.write('missing Xcode-');
  setTimeout(()=>process.stderr.write('Username\\n'),10);
  setInterval(()=>{},1000);
 `});
 await assert.rejects(runXcodebuild(['-exportArchive'],{spawnProcess:fixture.spawnProcess,readLocked:async()=>false}),/xcode_credentials_unavailable/);
 assert.equal(fixture.calls.filter(x=>x.file.endsWith('xcodebuild')).length,1);
 assert.equal(fixture.children[1].signalCode,'SIGKILL');
 assert.ok(fixture.children[0].signalCode);
});

test('cancellation while locked never starts xcodebuild and cleans up the sleep assertion',async t=>{
 const fixture=processes(t);const controller=new AbortController();
 await assert.rejects(runXcodebuild(['archive'],{spawnProcess:fixture.spawnProcess,signal:controller.signal,readLocked:async()=>{controller.abort();return true;}}),/abort/i);
 assert.equal(fixture.calls.length,1);assert.ok(fixture.children[0].signalCode);
});

test('credentials rejected after a successful command still fail the guarded operation',async t=>{
 const fixture=processes(t,{build:`process.stdout.write('errSecInteractionNotAllowed (-25308)\\n')`});
 await assert.rejects(runXcodebuild(['archive'],{spawnProcess:fixture.spawnProcess,readLocked:async()=>false}),/xcode_credentials_unavailable/);
 assert.equal(fixture.calls.length,2);
});

test('credential error at the beginning of a large output chunk cannot be discarded',async t=>{
 const fixture=processes(t,{build:`process.stdout.write('missing Xcode-Token'+'.'.repeat(5000)+'\\n')`});
 await assert.rejects(runXcodebuild(['archive'],{spawnProcess:fixture.spawnProcess,readLocked:async()=>false}),/xcode_credentials_unavailable/);
});

test('losing the sleep assertion during a build terminates the build process group',async t=>{
 const fixture=processes(t,{build:'setInterval(()=>{},1000)'});
 const running=runXcodebuild(['archive'],{spawnProcess(file,args,options){
  const child=fixture.spawnProcess(file,args,options);
  if(file.endsWith('xcodebuild'))queueMicrotask(()=>fixture.children[0].kill());
  return child;
 },readLocked:async()=>false});
 await assert.rejects(running,/sleep_assertion_failed/);
 assert.ok(fixture.children[1].signalCode);
});

test('cancellation during a build terminates its process group',async t=>{
 const fixture=processes(t,{build:'setInterval(()=>{},1000)'});const controller=new AbortController();
 await assert.rejects(runXcodebuild(['archive'],{spawnProcess(file,args,options){
  const child=fixture.spawnProcess(file,args,options);
  if(file.endsWith('xcodebuild'))queueMicrotask(()=>controller.abort());
  return child;
 },readLocked:async()=>false,signal:controller.signal}),/abort/i);
 assert.ok(fixture.children.every(c=>c.exitCode!==null||c.signalCode!==null));
});
