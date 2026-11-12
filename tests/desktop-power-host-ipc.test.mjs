import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import vm from 'node:vm';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(schedules={start(){}}){
 const sent=[],calls=[],intervals=new Map();let instance,protect,scheduledReads=0;
 const proc=new EventEmitter();Object.assign(proc,{connected:true,env:{},send(value,done){sent.push(value);done?.();},disconnect(){this.connected=false;}});
 class App{
  constructor(config){this.config=config;this.modelConfig=config;this.schedules=schedules;instance=this;this.store={meta:()=>undefined};this.channels={wakePollingChannels:()=>['telegram'],resumeAfterSleep:async force=>{calls.push(force===false?'channels-passive':'channels');}};}
  onStateChange(callback){this.changed=callback;return ()=>{};}onScheduleChanged(callback){this.scheduleChanged=callback;return ()=>{};}
  bindDesktopPowerProtection(callback){protect=callback;return ()=>{};}
  desktopPowerFacts(){return {executing:false,displayRequired:false};}
  scheduledAt=1_800_000_000_000;
  nextScheduledMessageAt(){scheduledReads++;return this.scheduledAt;}recheckScheduledMessages(){calls.push('schedule');}
  async manageNativeAccount(){return {connected:false};}async close(){calls.push('close');}
 }
 const modules={
  'node:crypto':{randomUUID:()=> 'synthetic-id'},
  './service.js':{Homer:App,DesktopReviewRequired:class extends Error{}},'./model-config.js':{effectiveEffort:value=>value},'./engine.js':{engineError:()=> 'synthetic_failure',codexVersion:()=> 'synthetic'},
  './web-homer.js':{homerWebBridge:()=>({})},'./desktop-management.js':{desktopManagementAllowed:()=>false},'./media-decode.js':{configureDesktopImageDecoder:()=>{}},'../scripts/desktop-profile.mjs':{saveDesktopModelSource:()=>{}},
  ...Object.fromEntries(['telegram','wechat','dingtalk'].map(id=>['./'+id+'-channel.js',{[id+'Channel']:()=>undefined}])),
 };
 const context=vm.createContext({process:proc,console,queueMicrotask,setTimeout,clearTimeout,
  setInterval(callback,delay){const timer={unref(){}};intervals.set(timer,{callback,delay});return timer;},clearInterval:timer=>intervals.delete(timer)});
 const source=transpileModule(readFileSync('src/dev-host.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2023}}).outputText;
 const entry=new vm.SourceTextModule(source,{context});
 await entry.link(async name=>{assert.ok(modules[name],name);const exports=modules[name],module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});await module.link(()=>{});return module;});
 await entry.evaluate();proc.emit('message',{kind:'init',desktop:true,config:{runtime:'/synthetic',desktopResources:{}}});await tick();
 return {proc,sent,calls,instance,get protect(){return protect;},get scheduledReads(){return scheduledReads;},
  poll(){const interval=[...intervals.values()].find(item=>item.delay===5000);assert.ok(interval);interval.callback();},
  cleanup:async()=>{proc.emit('disconnect');await tick();assert.equal(intervals.size,0);}};
}
if(!vm.SourceTextModule){
 test('power host IPC uses isolated VM modules',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,['--import','tsx','--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{stdio:'pipe',env}).toString();
  assert.match(output,/# tests [1-9]\d*/);
 });
}else{
 test('unchanged streaming state avoids calendar work while execution, display and channel changes refresh it',async()=>{
  const f=await fixture();try{
   const initialReads=f.scheduledReads;
   for(let index=0;index<1000;index++)f.instance.changed();
   await tick();assert.equal(f.scheduledReads,initialReads);
   f.instance.desktopPowerFacts=()=>({executing:true,displayRequired:false});f.instance.changed();
   assert.equal(f.scheduledReads,initialReads+1);
   f.instance.desktopPowerFacts=()=>({executing:true,displayRequired:true});f.instance.changed();
   assert.equal(f.scheduledReads,initialReads+2);
   f.instance.channels.wakePollingChannels=()=>['wechat'];f.instance.changed();await tick();
   assert.equal(f.scheduledReads,initialReads+3);
   const facts=f.sent.filter(event=>event.kind==='power_state').at(-1).facts;
   assert.deepEqual(JSON.parse(JSON.stringify(facts)),{runtimeAvailable:true,executing:true,displayRequired:true,nextScheduledAt:f.instance.scheduledAt,channels:['wechat']});
  }finally{await f.cleanup();}
 });
 test('schedule commits, periodic calibration, resume and execution protection read current calendar facts',async()=>{
  const f=await fixture();try{
   let reads=f.scheduledReads;
   const latest=()=>f.sent.filter(event=>event.kind==='power_state').at(-1).facts.nextScheduledAt;
   f.instance.scheduledAt++;f.instance.scheduleChanged();await tick();
   assert.equal(f.scheduledReads,++reads);assert.equal(latest(),f.instance.scheduledAt);
   f.instance.scheduledAt++;f.poll();await tick();
   assert.equal(f.scheduledReads,++reads);assert.equal(latest(),f.instance.scheduledAt);
   f.instance.scheduledAt++;f.proc.emit('message',{kind:'desktop_power',id:'fresh-resume',method:'resume'});await tick();
   assert.equal(f.scheduledReads,++reads);assert.equal(latest(),f.instance.scheduledAt);
   for(let index=0;index<2;index++){
    f.instance.scheduledAt++;const waiting=f.protect({executing:false,displayRequired:false});await tick();
    const request=f.sent.filter(event=>event.kind==='power_acquire').at(-1);
    assert.equal(f.scheduledReads,++reads);assert.equal(request.facts.nextScheduledAt,f.instance.scheduledAt);
    f.proc.emit('message',{kind:'desktop_power_ack',id:request.id});await waiting;
   }
  }finally{await f.cleanup();}
 });
 test('failed publication or calendar reads retry on the next unchanged owner notification',async()=>{
  const f=await fixture();try{
   const originalSend=f.proc.send;let publications=0;
   f.proc.send=function(value,done){
    if(value.kind==='power_state'&&++publications===1){done(Error('synthetic_ipc_failure'));return;}
    originalSend.call(this,value,done);
   };
   f.instance.desktopPowerFacts=()=>({executing:true,displayRequired:false});f.instance.changed();await tick();
   assert.equal(publications,1);f.instance.changed();await tick();assert.equal(publications,2);
   const originalRead=f.instance.nextScheduledMessageAt.bind(f.instance);let fail=true;
   f.instance.nextScheduledMessageAt=()=>{if(fail){fail=false;throw Error('synthetic_storage_failure');}return originalRead();};
   f.instance.scheduleChanged();await tick();const reads=f.scheduledReads;
   f.instance.changed();await tick();assert.equal(f.scheduledReads,reads+1);
  }finally{await f.cleanup();}
 });
 test('management-only startup delivers restored schedules into the original inbox without a connected model or system wake',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const {fixture:hostFixture}=await import('./fixtures/worker-chat-host.js');
  const host=hostFixture();let f;
  try{
   host.app.store.setMeta('mainThread','restored-main');
   const record=host.app.schedules.create({text:'Restored reminder',trigger:{at:new Date(now+1000).toISOString()},sourceRef:'original-source'});
   now+=1000;
   f=await fixture(host.app.schedules);
   assert.ok(f.sent.some(event=>event.kind==='management_ready'));
   assert.ok(f.sent.some(event=>event.kind==='chat_unavailable'&&event.code==='desktop_account_required'));
   assert.equal(host.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='scheduled_message'").get().n,1);
   assert.equal(host.app.schedules.get(record.id).enabled,false);
   assert.equal(host.engines.length,0);assert.equal(f.sent.some(event=>event.kind==='ready'),false);
   host.app.recheckScheduledMessages();
   await host.app.idle();
   assert.equal(host.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='scheduled_message'").get().n,1);
   assert.equal(host.app.store.db.prepare("SELECT state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='scheduled_message'").get().state,'pending');
  }finally{await f?.cleanup();await host.close();}
 });
 test('host power acquisition waits for the matching numeric ACK and emits only minimal owner facts',async()=>{
  const f=await fixture();try{
   assert.equal(typeof f.protect,'function');let settled=false;
   const waiting=f.protect({executing:true,displayRequired:true}).then(()=>{settled=true;});await tick();
   const request=f.sent.find(event=>event.kind==='power_acquire');assert.ok(request);assert.equal(settled,false);
   assert.deepEqual(JSON.parse(JSON.stringify(request.facts)),{runtimeAvailable:true,executing:true,displayRequired:true,nextScheduledAt:1_800_000_000_000,channels:['telegram']});
   f.proc.emit('message',{kind:'desktop_power_ack',id:String(request.id)});await tick();assert.equal(settled,false);
   f.proc.emit('message',{kind:'desktop_power_ack',id:request.id});await waiting;assert.equal(settled,true);
  }finally{await f.cleanup();}
 });
 test('resume rechecks the existing scheduler and channel owner without producing a second message path',async()=>{
  const f=await fixture();try{
   f.proc.emit('message',{kind:'desktop_power',id:'resume-call',method:'resume'});await tick();
   assert.deepEqual(f.calls,['schedule','channels']);
   assert.ok(f.sent.some(event=>event.kind==='web_result'&&event.id==='resume-call'&&event.value===true));
   f.proc.emit('message',{kind:'desktop_power',id:'awake-call',method:'resume',input:{afterSleep:false}});await tick();
   assert.deepEqual(f.calls,['schedule','channels','schedule','channels-passive']);
  }finally{await f.cleanup();}
 });
}
