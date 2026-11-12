import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopPowerCoordinator,POWER_DEFAULTS,validatePowerPreferences,type PowerFacts,type WakeEvent} from '../src/desktop-power.js';

function fixture(options:{leadMs?:number}={}){
 let now=Date.UTC(2026,10,13,0),sequence=0;
 const timers=new Map<number,{at:number;fn:()=>void}>(),events:WakeEvent[]=[],calls:string[]=[],locks=new Map<number,string>();
 const control={authorization:'authorized' as 'authorized'|'required'|'denied',statusUnavailable:false,statusCalls:0,listCalls:0,createCalls:0,authorizeCalls:0,failCreate:false,failCreateAt:undefined as number|undefined,loseReceipt:false,failStop:false,failCancel:false,maxEvents:128,hangCheck:false,blockCheck:undefined as Promise<void>|undefined,blockCreate:undefined as Promise<void>|undefined,checks:0,recoveryKinds:[] as boolean[]};
 const power=new DesktopPowerCoordinator({
  blocker:{start:type=>{const id=++sequence;calls.push('start:'+type);locks.set(id,type);return id;},stop:id=>{calls.push('stop');if(control.failStop)throw Error('stop_failed');locks.delete(id);}},
  wake:{status:async()=>{control.statusCalls++;return control.statusUnavailable?{supported:false,authorization:'unavailable'}:{supported:true,authorization:control.authorization};},authorize:async()=>{control.authorizeCalls++;control.authorization='authorized';return {supported:true,authorization:'authorized'};},list:async()=>{control.listCalls++;return events.map(event=>({...event}));},schedule:async event=>{const attempt=++control.createCalls;calls.push('create:'+event.at);await control.blockCreate;if(control.failCreate||attempt===control.failCreateAt||events.length>=control.maxEvents)throw Error('create_failed');events.push(event);if(control.loseReceipt)throw Error('receipt_lost');return event;},cancel:async event=>{calls.push('cancel:'+event.at);if(control.failCancel)throw Error('cancel_failed');const at=events.findIndex(item=>item.id===event.id&&item.at===event.at);if(at>=0)events.splice(at,1);},close:async()=>{}},
  clock:{now:()=>now,setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,fn});return id;},clearTimeout:id=>{timers.delete(id as number);}},
  eventId:()=>String(++sequence).padStart(32,'0'),check:async afterSleep=>{control.checks++;control.recoveryKinds.push(afterSleep);await control.blockCheck;if(control.hangCheck)await new Promise(()=>{});},...options,
 });
 const facts:PowerFacts={runtimeAvailable:true,executing:false,displayRequired:false,nextScheduledAt:null,channels:[]};
 const update=(patch:Partial<PowerFacts>={})=>power.updateFacts(Object.assign(facts,patch));
 const advance=async(ms:number,reconcile=true)=>{now+=ms;const due=[...timers].filter(([,timer])=>timer.at<=now);for(const [id,timer]of due){timers.delete(id);timer.fn();}await new Promise(resolve=>setImmediate(resolve));if(reconcile)await power.sync();};
 return {power,facts,update,advance,control,events,calls,locks,timers,now:()=>now};
}

test('unchanged status refreshes do not emit another settings notification',async()=>{
 let changed=0;
 const power=new DesktopPowerCoordinator({blocker:{start:()=>1,stop:()=>{}},wake:{status:async()=>({supported:false,authorization:'unavailable'}),authorize:async()=>({supported:false,authorization:'unavailable'}),list:async()=>[],schedule:async event=>event,cancel:async()=>{},close:async()=>{}},eventId:()=> 'a'.repeat(32),check:async()=>{},onChanged:()=>{changed++;}});
 await power.refresh();const initial=changed;
 await power.refresh();await power.refresh();assert.equal(changed,initial);await power.close();
});

test('rechecking retries an execution protection that previously failed without failing business work',async()=>{
 let fail=true,active=false;
 const power=new DesktopPowerCoordinator({blocker:{start:()=>{if(fail)throw Error('temporary_failure');active=true;return 1;},stop:()=>{active=false;}},wake:{status:async()=>({supported:false,authorization:'unavailable'}),authorize:async()=>({supported:false,authorization:'unavailable'}),list:async()=>[],schedule:async event=>event,cancel:async()=>{},close:async()=>{}},eventId:()=> 'a'.repeat(32),check:async()=>{}});
 await power.updateFacts({runtimeAvailable:true,executing:true,displayRequired:false,nextScheduledAt:null,channels:[]});assert.equal(active,false);assert.ok(power.state().protectionError);
 fail=false;await power.refresh();assert.equal(active,true);assert.equal(power.state().protectionError,undefined);await power.close();
});

test('power preferences keep the approved defaults and reject unrecognized settings',()=>{
 assert.deepEqual(POWER_DEFAULTS,{keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15});
 assert.throws(()=>validatePowerPreferences({...POWER_DEFAULTS,pollIntervalMinutes:1}));
 assert.throws(()=>validatePowerPreferences({...POWER_DEFAULTS,keepAwake:'yes'}));
 assert.throws(()=>validatePowerPreferences({...POWER_DEFAULTS,command:'anything'}));
});

test('execution protection is independent of the always-awake preference and allows the display to sleep',async()=>{
 const f=fixture();await f.update({executing:true});
 assert.equal(f.power.state().protection,'system');assert.equal(f.locks.size,1);
 await f.power.setPreferences({...POWER_DEFAULTS,keepAwake:true});
 await f.power.setPreferences({...POWER_DEFAULTS,keepAwake:false});assert.equal(f.locks.size,1);
 await f.update({executing:false});assert.equal(f.locks.size,0);
 await f.power.close();
});

test('display protection is acquired before releasing system protection and ends with the computer-use window',async()=>{
 const f=fixture();await f.update({executing:true});f.calls.length=0;
 await f.update({displayRequired:true});
 assert.deepEqual(f.calls.slice(0,2),['start:prevent-display-sleep','stop']);
 assert.equal(f.power.state().protection,'display');
 await f.update({displayRequired:false});assert.equal(f.power.state().protection,'system');await f.power.close();
});

test('no qualified channels means no empty polling wake; nearest scheduled time wins while continuously awake',async()=>{
 const f=fixture();await f.update();assert.equal(f.events.length,0);
 await f.power.setPreferences({...POWER_DEFAULTS,keepAwake:true});
 const at=f.now()+300_123;await f.update({nextScheduledAt:at,channels:['telegram']});
 assert.equal(f.events.length,1);assert.equal(f.events[0]!.at,Math.ceil(at/1000)*1000);
 assert.equal(f.power.state().protection,'system');
 await f.power.setPreferences({...POWER_DEFAULTS,keepAwake:true,pollMessages:false});
 assert.equal(f.events.length,1);assert.equal(f.events[0]!.at,Math.ceil(at/1000)*1000);await f.power.close();
});

test('wake replacement confirms the candidate before canceling the prior event, and failed replacement keeps a backup',async()=>{
 const f=fixture();await f.update({nextScheduledAt:f.now()+600_000});const old={...f.events[0]!};
 f.calls.length=0;f.control.failCreate=true;
 await f.update({nextScheduledAt:f.now()+300_000});
 assert.deepEqual(f.events,[old]);assert.equal(f.power.state().wake.status,'error');
 f.control.failCreate=false;await f.power.refresh();
 assert.equal(f.events.length,1);assert.equal(f.events[0]!.at,f.now()+300_000);
 assert.ok(f.calls.findIndex(call=>call==='create:'+(f.now()+300_000))<f.calls.findIndex(call=>call==='cancel:'+old.at));
 await f.power.close();
});

test('a lost registration receipt is reconciled by querying the same event without creating another',async()=>{
 const f=fixture();f.control.loseReceipt=true;
 await f.update({nextScheduledAt:f.now()+300_000});
 assert.equal(f.events.length,1);assert.equal(f.power.state().wake.status,'scheduled');
 await f.power.refresh();assert.equal(f.calls.filter(call=>call.startsWith('create:')).length,1);await f.power.close();
});

test('close cleans a late-created event and never revives a disabled demand',async()=>{
 const f=fixture();let release!:()=>void;f.control.blockCreate=new Promise<void>(resolve=>{release=resolve;});
 const pending=f.update({nextScheduledAt:f.now()+300_000});await new Promise(resolve=>setImmediate(resolve));
 const closing=f.power.close();release();await pending;assert.equal(await closing,true);
 assert.equal(f.events.length,0);assert.equal(f.locks.size,0);assert.equal(f.timers.size,0);
});

test('authorization is requested only by explicit action and denial preserves enabled preferences',async()=>{
 const f=fixture();f.control.authorization='required';await f.update({nextScheduledAt:f.now()+300_000});
 assert.equal(f.events.length,0);assert.equal(f.power.state().preferences.wakeScheduled,true);
 assert.equal(f.power.state().wake.status,'authorization-required');
 await f.power.authorize();assert.equal(f.events.length,1);await f.power.close();
});

test('resume performs one normal recheck, then arranges the next channel interval without missed empty polls',async()=>{
 const f=fixture();await f.update({channels:['telegram']});await f.advance(3_600_000);
 const before=f.control.checks;await f.power.resume();assert.equal(f.control.checks,before+1);
 assert.equal(f.events.length,1);assert.equal(f.events[0]!.at,f.now()+900_000);await f.power.close();
});

test('prewake protection covers the original due-time check and cancellation releases the obsolete hold',async()=>{
 const f=fixture({leadMs:300_000});await f.update({nextScheduledAt:f.now()+600_000});
 await f.advance(300_000);await f.power.resume();assert.equal(f.power.state().protection,'system');
 await f.advance(240_000);assert.equal(f.power.state().protection,'system');
 await f.advance(60_000);assert.equal(f.power.state().protection,'none');assert.ok(f.control.checks>=2);
 await f.update({nextScheduledAt:f.now()+600_000});await f.advance(300_000);await f.power.resume();
 await f.update({nextScheduledAt:null});assert.equal(f.power.state().protection,'none');await f.power.close();
});

test('a failed native registration uses bounded retry rather than spinning on the past time',async()=>{
 const f=fixture();f.control.failCreate=true;await f.update({nextScheduledAt:f.now()+300_000});
 const creates=()=>f.calls.filter(call=>call.startsWith('create:')).length;
 assert.equal(creates(),1);await f.update({executing:true});assert.equal(creates(),1);
 await f.advance(30_000);assert.equal(creates(),2);await f.power.close();
});

test('unconfirmed cancellation and blocker release are reported rather than claimed as clean shutdown',async()=>{
 const f=fixture();await f.update({executing:true,nextScheduledAt:f.now()+300_000});
 f.control.failCancel=true;f.control.failStop=true;
 assert.equal(await f.power.close(),false);assert.ok(f.power.state().wake.error);assert.ok(f.power.state().protectionError);
});

test('a failed old-event cleanup cannot exhaust the two-event native limit on the next replacement',async()=>{
 const f=fixture();f.control.maxEvents=2;
 await f.update({nextScheduledAt:f.now()+900_000});f.control.failCancel=true;
 await f.update({nextScheduledAt:f.now()+600_000});assert.equal(f.events.length,2);
 f.control.failCancel=false;await f.update({nextScheduledAt:f.now()+300_000});
 assert.equal(f.events.length,1);assert.equal(f.events[0]!.at,f.now()+300_000);await f.power.close();
});

test('closing during an unresponsive recovery check clears its timeout and releases the preparation hold',async()=>{
 const f=fixture();await f.update();f.control.hangCheck=true;
 const resuming=f.power.resume();await new Promise(resolve=>setImmediate(resolve));assert.ok(f.timers.size);
 await f.power.close();await resuming;assert.equal(f.timers.size,0);assert.equal(f.locks.size,0);
});

test('a temporary unavailable native bridge recovers automatically with bounded read-only retries',async()=>{
 const f=fixture();f.control.statusUnavailable=true;await f.update({nextScheduledAt:f.now()+300_000});
 assert.equal(f.control.statusCalls,1);assert.equal(f.events.length,0);
 await f.update({executing:true});assert.equal(f.control.statusCalls,1);
 f.control.statusUnavailable=false;await f.advance(30_000);
 assert.equal(f.control.statusCalls,2);assert.equal(f.events.length,1);assert.equal(f.control.authorizeCalls,0);
 assert.equal(f.power.state().wake.status,'scheduled');await f.power.close();
});

test('disabling wake after native access is lost reports unresolved cleanup and retries when access returns',async()=>{
 const f=fixture();await f.update({nextScheduledAt:f.now()+300_000});assert.equal(f.events.length,1);
 f.control.statusUnavailable=true;await f.power.refresh();
 await f.power.setPreferences({...POWER_DEFAULTS,wakeScheduled:false,pollMessages:false});
 assert.equal(f.power.state().wake.error,'wake_cleanup_unconfirmed');assert.equal(f.events.length,1);
 f.control.statusUnavailable=false;await f.advance(30_000);assert.equal(f.events.length,0);
 assert.equal(f.power.state().wake.error,undefined);assert.equal(f.control.authorizeCalls,0);await f.power.close();
});

test('awake polling preserves healthy transports while a real resume upgrades an in-flight passive check',async()=>{
 const f=fixture();await f.update({channels:['telegram']});
 let release!:()=>void;f.control.blockCheck=new Promise<void>(resolve=>{release=resolve;});
 await f.advance(900_000);assert.deepEqual(f.control.recoveryKinds,[false]);
 const resuming=f.power.resume();release();await resuming;await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.control.recoveryKinds,[false,true]);assert.equal(f.events.length,1);await f.power.close();
});

test('failed cleanup retries after thirty seconds when the last wake demand is disabled',async()=>{
 const f=fixture();await f.update({nextScheduledAt:f.now()+300_000});
 f.control.failCancel=true;await f.power.setPreferences({...POWER_DEFAULTS,wakeScheduled:false});
 assert.equal(f.power.state().wake.error,'wake_cleanup_unconfirmed');assert.equal(f.events.length,1);
 f.control.failCancel=false;await f.advance(30_000,false);
 assert.equal(f.events.length,0);assert.equal(f.power.state().wake.error,undefined);await f.power.close();
});

test('failed cleanup does not repeat native work on unchanged facts during its backoff',async()=>{
 const f=fixture();await f.update({nextScheduledAt:f.now()+300_000});
 f.control.failCancel=true;await f.power.setPreferences({...POWER_DEFAULTS,wakeScheduled:false});
 const counts=[f.control.statusCalls,f.control.listCalls,f.calls.filter(call=>call.startsWith('cancel:')).length];
 for(let i=0;i<10;i++)await f.update({executing:i%2===0});
 await f.advance(29_999);
 assert.deepEqual([f.control.statusCalls,f.control.listCalls,f.calls.filter(call=>call.startsWith('cancel:')).length],counts);
 f.control.failCancel=false;await f.power.close();
});

test('execution facts reuse a confirmed wake event while integrity checks repair a missing native event within a minute',async()=>{
 const f=fixture();await f.update({nextScheduledAt:f.now()+3_600_000});
 const counts=[f.control.statusCalls,f.control.listCalls];
 for(let i=0;i<100;i++)await f.update({executing:i%2===0});
 assert.deepEqual([f.control.statusCalls,f.control.listCalls],counts);
 f.events.length=0;await f.advance(59_999,false);assert.equal(f.events.length,0);
 await f.advance(1,false);assert.equal(f.events.length,1);assert.equal(f.control.createCalls,2);await f.power.close();
});

test('explicit refresh, authorization and resume still reconcile an unchanged native target',async()=>{
 const f=fixture();await f.update({nextScheduledAt:f.now()+3_600_000});
 for(const action of [()=>f.power.refresh(),()=>f.power.authorize(),()=>f.power.resume()]){
  const before=f.control.listCalls;await action();assert.ok(f.control.listCalls>before);
 }
 assert.equal(f.control.authorizeCalls,1);assert.equal(f.control.createCalls,1);await f.power.close();
});

for(const disabled of ['pollMessages','wakeScheduled'] as const)test('disabling '+disabled+' retires its old event even when the remaining demand cannot register',async()=>{
 const f=fixture();await f.update({channels:['telegram'],nextScheduledAt:f.now()+(disabled==='pollMessages'?1_800_000:300_000)});
 f.control.failCreate=true;await f.power.setPreferences({...POWER_DEFAULTS,[disabled]:false});
 assert.equal(f.events.length,0);assert.equal(f.power.state().wake.error,'wake_schedule_unconfirmed');await f.power.close();
});

test('closing one source during native creation retires its late event before keeping a different demand',async()=>{
 const f=fixture();let release!:()=>void;f.control.blockCreate=new Promise<void>(resolve=>{release=resolve;});f.control.failCreateAt=2;
 const pending=f.update({channels:['telegram'],nextScheduledAt:f.now()+1_800_000});await new Promise(resolve=>setImmediate(resolve));
 const changed=f.power.setPreferences({...POWER_DEFAULTS,pollMessages:false});release();await Promise.all([pending,changed]);
 assert.equal(f.events.length,0);assert.equal(f.power.state().wake.error,'wake_schedule_unconfirmed');await f.power.close();
});

test('a shared poll and scheduled event remains valid when either source is disabled',async()=>{
 for(const disabled of ['pollMessages','wakeScheduled'] as const){
  const f=fixture();await f.update({channels:['telegram'],nextScheduledAt:f.now()+900_000});const event={...f.events[0]!};
  await f.power.setPreferences({...POWER_DEFAULTS,[disabled]:false});
  assert.deepEqual(f.events,[event]);assert.equal(f.control.createCalls,1);await f.power.close();
 }
});

test('unattributed native residue cannot become a backup for a failed current request',async()=>{
 const f=fixture();f.events.push({id:'f'.repeat(32),at:f.now()+300_000});f.control.failCreate=true;
 await f.update({nextScheduledAt:f.now()+1_800_000});assert.equal(f.events.length,0);await f.power.close();
});

test('startup adopts an unattributed event matching the current demand before attempting a replacement',async()=>{
 const f=fixture(),event={id:'f'.repeat(32),at:f.now()+300_000};f.events.push(event);f.control.failCreate=true;
 await f.update({nextScheduledAt:event.at});
 assert.deepEqual(f.events,[event]);assert.equal(f.control.createCalls,0);assert.equal(f.power.state().wake.status,'scheduled');await f.power.close();
});

test('a late native event matching the current demand is recovered without another create',async()=>{
 const f=fixture(),event={id:'f'.repeat(32),at:f.now()+300_000};f.control.failCreate=true;
 await f.update({nextScheduledAt:event.at});assert.equal(f.control.createCalls,1);
 f.events.push(event);await f.advance(30_000,false);
 assert.deepEqual(f.events,[event]);assert.equal(f.control.createCalls,1);assert.equal(f.power.state().wake.status,'scheduled');await f.power.close();
});
