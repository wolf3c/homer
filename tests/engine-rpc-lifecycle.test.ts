import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodexEngine } from '../src/engine.js';
import type { Config } from '../src/config.js';

const config: Config = {
  workspace: resolve('.codex/scratch'), runtime: resolve('.codex/scratch/rpc-lifecycle-tests'),
  codexHome: resolve('.codex/scratch/rpc-lifecycle-tests/home'), nativeCodexHome: resolve('.codex/scratch/rpc-lifecycle-tests/home'),
  codexBin: resolve('tests/fixtures/rpc-lifecycle-app-server.mjs'),
  model: 'silent', requiresOpenaiAuth: false, stopGraceMs: 100,
};
mkdirSync(config.workspace,{recursive:true});
const options = { cwd: config.workspace, readRoots: [], instructions: 'transport only', tools: [] };
function peer(role?:'main'|'worker',patch:Partial<Config>={}) {
  const engine = new CodexEngine({...config,...patch}, { ...options,role }, async () => ({}));
  const sent: {id:number;method:string;params:any}[] = [];
  engine['send'] = (message: any) => {
    if(message.method==='config/read'&&message.params?.includeLayers)void receive({id:message.id,result:{config:{},layers:[]}});
    else sent.push(message);
  };
  engine.threadId = 'thread';
  const receive = (message: unknown) => engine['receive'](JSON.stringify(message));
  const reply = (index: number, result: unknown = {}) => receive({id: sent[index]!.id, result});
  const event = (method: string, params: any) => receive({method, params: {threadId:'thread', ...params}});
  return {engine, sent, receive, reply, event};
}

for(const role of ['main','worker'] as const)test(role+' resolves ambiguous website auth using the exact engine credential before terminal persistence',async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer(role,{desktopModelSource:'website',baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});
 process.env[key]='synthetic-replacement';
 let calls=0;const terminals:any[]=[];p.engine.on('nativeCompleted',v=>terminals.push(v));
 t.mock.method(globalThis,'fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{calls++;assert.equal(String(url),'https://gateway.example.invalid/api/usage/token/');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer synthetic-active');return Response.json({code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:0}});});
 try{
  const rpc=observed(p.engine.request('config/read',{}));await p.receive({id:p.sent[0]!.id,error:{message:'HTTP 401 Unauthorized: invalid token'}});await assert.rejects(rpc.result,/^Error: engine_quota_insufficient$/);
  const turn=p.engine.turn('synthetic'); await flush();await p.reply(1,{turn:{id:'turn'}});await flush();
  await p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'HTTP 401 Unauthorized: invalid token'}}});
  assert.equal((await turn).errorCode,'engine_quota_insufficient');assert.equal(terminals[0].result.errorCode,'engine_quota_insufficient');assert.equal(calls,2);assert.deepEqual(p.sent.map(x=>x.method),['config/read','turn/start']);
 }finally{await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

test('website quota diagnosis cannot outlive closure or overwrite a replacement turn',async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer('main',{desktopModelSource:'website',baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});
 let release!:(v:Response)=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;entered();return new Promise<Response>(r=>{release=r;});});
 const terminals:any[]=[],nativeEnds:any[]=[];p.engine.on('nativeCompleted',v=>terminals.push(v));p.engine.on('turnTerminal',v=>nativeEnds.push(v));
 try{
  const turn=observed(p.engine.turn('synthetic')); await flush();await p.reply(0,{turn:{id:'turn'}});await flush();
  const event=p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'401 unauthorized'}}});await started;
  assert.equal(nativeEnds.length,1,'quota verification must not delay native terminal timing evidence');
  await p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'401 unauthorized'}}});assert.equal(calls,1);
  await p.engine.close();await assert.rejects(turn.result,/engine_closed/);release(Response.json({code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:0}}));await event;assert.deepEqual(terminals,[]);
 }finally{await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

test('failed compaction verifies quota once and ignores a late successful item',async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer('main',{desktopModelSource:'website',baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});
 let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});const releases:((v:Response)=>void)[]=[];
 t.mock.method(globalThis,'fetch',async()=>new Promise<Response>(resolve=>{releases.push(resolve);entered();}));
 let first:Promise<void>|undefined,duplicate:Promise<void>|undefined;
 try{
  const work=observed(p.engine.compact());await p.reply(0);await p.event('turn/started',{turn:{id:'compact'}});
  await p.event('item/started',{turnId:'compact',item:{id:'compact-item',type:'contextCompaction'}});
  const terminal={turn:{id:'compact',status:'failed',error:{message:'401 unauthorized'}}};
  first=p.event('turn/completed',terminal);await started;duplicate=p.event('turn/completed',terminal);
  await p.event('item/completed',{turnId:'compact',item:{id:'compact-item',type:'contextCompaction'}});await flush();
  assert.equal(releases.length,1,'one verification for a duplicate compaction terminal');assert.equal(work.state(),'pending','late item cannot turn failure into success');
  for(const release of releases)release(Response.json({code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:0}}));
  await Promise.all([first,duplicate]);await assert.rejects(work.result,/engine_quota_insufficient/);assert.equal(p.sent.length,1);
 }finally{for(const release of releases)release(Response.json({code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:0}}));await Promise.all([first,duplicate]);await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

for(const role of ['main','worker'] as const)test(role+' freezes terminal work while quota verification is pending',async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer(role,{desktopModelSource:'website',baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});p.engine.options.nativeTools=role;p.engine['refreshBackground']=async()=>{};
 let tools=0,interactions=0,release!:(v:Response)=>void,entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),processes:any[]=[],messages:any[]=[];
 p.engine.on('nativeProcess',value=>processes.push(value));p.engine.on('agentMessage',value=>messages.push(value));
 t.mock.method(p.engine,'handleTool',async()=>{tools++;return {};});
 p.engine.options.onInteraction=async()=>{interactions++;return {status:'denied',decision:{action:'deny',reason:'synthetic'}};};
 t.mock.method(globalThis,'fetch',async()=>{entered();return new Promise<Response>(resolve=>{release=resolve;});});
 let terminal:Promise<void>|undefined;
 try{
  const work=observed(p.engine.turn('synthetic')); await flush();await p.reply(0,{turn:{id:'turn'}});await flush();
  terminal=p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'401 unauthorized'},itemsView:'full',items:[{type:'agentMessage',id:'final',phase:'final_answer',text:'Terminal snapshot'}]}});await started;
  await p.event('item/completed',{turnId:'turn',item:{id:'late',type:'agentMessage',phase:'final_answer',text:'After-terminal text'}});
  await p.receive({id:99,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'late-tool',name:'synthetic',arguments:{}}});
  await p.receive({id:100,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',itemId:'late-approval',kind:'command',command:'synthetic',cwd:'/synthetic',availableDecisions:['accept','decline']}});
  await p.event('item/completed',{turnId:'turn',item:{id:'retained',type:'fileChange',status:'completed',changes:[]}});
  const steer=observed(p.engine.steer('turn','synthetic'));await flush();
  assert.equal(tools,0);assert.equal(interactions,0);assert.equal(p.sent.filter(item=>item.method==='turn/steer').length,0);
  await assert.rejects(steer.result,/engine_steer_not_applicable/);assert.equal(await p.engine.interrupt(),true);
  assert.deepEqual(processes.map(item=>item.itemId),role==='worker'?['retained']:[]);
  assert.deepEqual(messages.map(item=>item.text),['Terminal snapshot']);
  release(Response.json({code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:0}}));await terminal;
  assert.equal((await work.result).text,'Terminal snapshot');assert.deepEqual(p.sent.filter(item=>item.method).map(item=>item.method),['turn/start']);
 }finally{release?.(Response.json({code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:0}}));await terminal;await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

for(const [source,body,expected,queries]of [
 ['website',{code:true,data:{total_available:20,total_used:0,unlimited_quota:false,expires_at:0}},'engine_authentication_failed',1],
 ['website',{code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:1}},'engine_authentication_failed',1],
 ['website',null,'engine_account_status_unconfirmed',1],
 ['codex',null,'engine_authentication_failed',0],
] as const)test('model terminal classification keeps '+source+' failure evidence: '+expected+' / '+String(body?.data?.expires_at),async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer('main',{desktopModelSource:source,...(source==='codex'?{pauseOldDesktopWork:true,desktopResources:{bundleRoot:'synthetic',manifestSha256:'0'.repeat(64)}}:{}),baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;if(body===null)throw Error('PRIVATE_DIAGNOSTICS');return Response.json(body);});
 try{const work=p.engine.turn('synthetic'); await flush();await p.reply(0,{turn:{id:'turn'}});await flush();await p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'401 unauthorized'}}});assert.equal((await work).errorCode,expected);assert.equal(calls,queries);}finally{await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

test('explicit quota failure avoids a supplementary website query',async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer('main',{desktopModelSource:'website',baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});
 t.mock.method(globalThis,'fetch',async()=>assert.fail('explicit quota must not query or replay'));
 try{const work=p.engine.turn('synthetic'); await flush();await p.reply(0,{turn:{id:'turn'}});await flush();await p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'401 Unauthorized insufficient_quota'}}});assert.equal((await work).errorCode,'engine_quota_insufficient');assert.equal(p.sent.length,1);}finally{await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

test('successful website turns add no account request',async t=>{
 const key='HOMER_TEST_FAILURE_TOKEN',previous=process.env[key];process.env[key]='synthetic-active';
 const p=peer('main',{desktopModelSource:'website',baseUrl:'https://gateway.example.invalid/v1',keyEnv:key});
 t.mock.method(globalThis,'fetch',async()=>assert.fail('successful turns must not query account status'));
 try{const work=p.engine.turn('synthetic'); await flush();await p.reply(0,{turn:{id:'turn'}});await flush();await p.event('turn/completed',{turn:{id:'turn',status:'completed'}});assert.equal((await work).status,'completed');assert.equal(p.sent.length,1);}finally{await p.engine.close();if(previous===undefined)delete process.env[key];else process.env[key]=previous;}
});

for(const status of ['completed','failed'])test('Worker '+status+' returns public items before an unrelated background refresh',async()=>{
 const p=peer('worker');let release!:()=>void;
 p.engine['refreshBackground']=()=>new Promise<void>(resolve=>{release=resolve;});
 const work=p.engine.turn('Synthetic return');await flush();
 await p.reply(0,{turn:{id:'turn',status:'inProgress'}});await flush();
 await p.event('item/completed',{turnId:'turn',item:{type:'agentMessage',id:'comment',phase:'commentary',text:'Checking synthetic input'}});
 const final={type:'agentMessage',id:'final',phase:'final_answer',text:'Checked; date remains unknown'};
 await p.event('item/completed',{turnId:'turn',item:final});
 await p.event('item/completed',{threadId:'unrelated',turnId:'turn',item:{...final,id:'wrong-thread'}});
 const summaryOnly={...final,id:'summary-only',text:'The staged file contains the evidence'};
 const terminal=p.event('turn/completed',{turn:{id:'turn',status,itemsView:'full',items:[final,summaryOnly],...(status==='failed'?{error:{message:'synthetic transport error'}}:{})}});
 const result=await work;
 assert.equal(result.status,status);assert.equal(result.messages!.length,3);
 assert.deepEqual(result.messages!.filter(m=>m.phase==='final_answer').map(m=>m.text),[final.text,summaryOnly.text]);
 release();await terminal;await p.engine.close();
});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function observed<T>(work: Promise<T>) {
  let state = 'pending';
  const result = work.then(value => { state='resolved'; return value; }, error => {state='rejected'; throw error;});
  result.catch(() => {});
  return {result, state: () => state};
}

for(const role of ['main','worker'] as const)for(const [message,code] of [
 ['HTTP 403 Forbidden: token quota is not enough, token remain quota: 1, need quota: 10; PRIVATE_PROVIDER_DETAILS','engine_quota_insufficient'],
 ['HTTP 429: {"error":{"code":"insufficient_quota"}}','engine_quota_insufficient'],
 ['HTTP 401 Unauthorized: {"error":{"code":"insufficient_quota"}}','engine_quota_insufficient'],
 ['HTTP 403 Forbidden: token quota is not enough, token remain quota: 401.000000','engine_quota_insufficient'],
 ['quota cache read failed: available 429.000000','engine_rpc_failed'],
 ['Insufficient credits','engine_quota_insufficient'],
 ['当前余额不足','engine_quota_insufficient'],
 ['429 Too Many Requests','engine_rate_limited'],
 ['Rate limit reached for tokens per minute','engine_rate_limited'],
 ['quota cache read failed: PRIVATE_PROVIDER_DETAILS','engine_rpc_failed'],
 ['401 unauthorized','engine_authentication_failed'],
] as const)test(role+' classifies native failures without exposing diagnostics or replaying: '+code+' / '+message.slice(0,20),async()=>{
 const p=peer(role);
 try{
  const rpc=observed(p.engine.request('config/read',{}));
  await p.receive({id:p.sent[0]!.id,error:{message}});
  await assert.rejects(rpc.result,error=>error instanceof Error&&error.message===code);
  const turn=p.engine.turn('synthetic'); await flush();await p.reply(1,{turn:{id:'turn'}});await flush();
  await p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message}}});
  assert.equal((await turn).errorCode,code);
  assert.deepEqual(p.sent.map(x=>x.method),['config/read','turn/start']);
 }finally{await p.engine.close();}
});

test('Worker close sends EOF before bounded fallback and confirms only actual exit',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=peer('worker'),events:string[]=[],child=new EventEmitter() as any;
 p.engine.pid=9999999;
 t.mock.method(process,'kill',(pid:number,signal?:string|number)=>{assert.equal(pid,-9999999);events.push(String(signal));return true;});
 child.stdin={end(){events.push('EOF');}};p.engine['child']=child;
 const close=p.engine.close();assert.deepEqual(events,['EOF']);
 t.mock.timers.tick(45000);await flush();assert.equal(child.listenerCount('exit'),1);
 t.mock.timers.tick(1000);await flush();t.mock.timers.tick(config.stopGraceMs);await flush();t.mock.timers.tick(1000);
 assert.deepEqual(events,['EOF','SIGTERM','SIGKILL']);
 assert.equal(await close,false);assert.equal(child.listenerCount('exit'),0);
});
if(process.platform!=='win32')for(const groupAlive of [false,true])test('Worker EOF confirms only an empty process group: child remains='+groupAlive,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const p=peer('worker'),child=new EventEmitter() as any;
 p.engine.pid=9999999;
 t.mock.method(process,'kill',(pid:number,signal?:string|number)=>{
  assert.equal(signal,0);
  if(pid===-p.engine.pid!&&groupAlive)return true;
  throw Object.assign(Error('no process'),{code:'ESRCH'});
 });
 child.stdin={end(){queueMicrotask(()=>{p.engine['exited']=true;child.emit('exit',0);});}};
 p.engine['child']=child;const close=observed(p.engine.close());await flush();
 if(groupAlive){assert.equal(close.state(),'pending');t.mock.timers.tick(config.stopGraceMs);await flush();}
 assert.equal(await close.result,!groupAlive);assert.equal(p.engine.available,false);
});

if(process.platform!=='win32')test('Worker EOF rechecks a draining process group within stopGraceMs',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const p=peer('worker'),child=new EventEmitter() as any;let groupAlive=true,groupChecks=0;
 p.engine.pid=9999999;
 t.mock.method(process,'kill',(pid:number,signal?:string|number)=>{
  assert.equal(signal,0,'an exited leader must never trigger a signal against a reused PID');
  assert.ok(pid===p.engine.pid||pid===-p.engine.pid!);
  if(pid===-p.engine.pid!){groupChecks++;if(groupAlive)return true;}
  throw Object.assign(Error('no process'),{code:'ESRCH'});
 });
 child.stdin={end(){queueMicrotask(()=>{p.engine['exited']=true;child.emit('exit',0);});}};
 p.engine['child']=child;const close=observed(p.engine.close());await flush();
 assert.equal(groupChecks,1);assert.equal(close.state(),'pending');
 setTimeout(()=>{groupAlive=false;},config.stopGraceMs/2);
 t.mock.timers.tick(config.stopGraceMs);await flush();
 assert.equal(await close.result,true);assert.ok(groupChecks>1);assert.equal(p.engine.available,false);
});

if(process.platform!=='win32')for(const failure of ['EPERM','EIO','reused-leader'])test('Worker close keeps an unconfirmed owner fenced: '+failure,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
 const p=peer('worker');p.engine.pid=9999999;p.engine['child']=new EventEmitter() as any;p.engine['exited']=true;
 t.mock.method(process,'kill',(pid:number,signal?:string|number)=>{
  assert.equal(signal,0,'unknown ownership permits probes only');
  assert.ok(pid===p.engine.pid||pid===-p.engine.pid!);
  if(pid===p.engine.pid&&failure==='reused-leader')return true;
  throw Object.assign(Error('unconfirmed'),{code:pid===p.engine.pid?'ESRCH':failure});
 });
 const close=observed(p.engine.close());await flush();assert.equal(close.state(),'pending');
 t.mock.timers.tick(config.stopGraceMs);await flush();assert.equal(await close.result,false);
});

if(process.platform!=='win32')for(const pid of [undefined,0,1,-1,1.5,NaN])test('Worker close cannot confirm an invalid PID: '+String(pid),async t=>{
 const p=peer('worker');p.engine.pid=pid;p.engine['child']=new EventEmitter() as any;p.engine['exited']=true;
 t.mock.method(process,'kill',()=>assert.fail('invalid PID must never be probed or signalled'));
 assert.equal(await p.engine.close(),false);
});

test('a terminal checkpoint failure rejects the turn instead of leaving its caller waiting',async()=>{
 const p=peer('worker'),work=observed(p.engine.turn('Synthetic terminal checkpoint'));
 try{
  await flush();await p.reply(0,{turn:{id:'turn',status:'inProgress'}});await flush();
  p.engine.on('nativeCompleted',()=>{throw Error('synthetic_checkpoint_failed');});
  await assert.rejects(()=>p.event('turn/completed',{turn:{id:'turn',status:'completed',items:[]}}),/synthetic_checkpoint_failed/);
  await flush();assert.equal(work.state(),'rejected');
  await assert.rejects(work.result,/synthetic_checkpoint_failed/);
 }finally{await p.engine.close();}
});

test('slow RPC success and native error remain authoritative beyond the former 15 second cutoff', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const p=peer();
  const success=observed(p.engine.request('plugin/install',{}));
  const failure=observed(p.engine.request('config/read',{}));
  try {
    t.mock.timers.tick(15001); await flush();
    assert.equal(success.state(),'pending'); assert.equal(failure.state(),'pending');
    await p.receive({id:p.sent[1]!.id,error:{message:'429 native quota details hidden'}});
    await assert.rejects(failure.result,/^Error: engine_rate_limited$/);
    await p.reply(0,{installed:true}); assert.deepEqual(await success.result,{installed:true});
    assert.equal(p.engine['pending'].size,0); assert.equal(p.sent.length,2);
  } finally {await p.engine.close();}
});

test('fast OAuth ACK is separate from delayed completion and unrelated concurrent responses', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const p=peer(); let completions=0;
  p.engine.on('oauthCompleted',()=>completions++);
  const login=p.engine.request('mcpServer/oauth/login',{timeoutSecs:120});
  await p.reply(0,{authorizationUrl:'synthetic-placeholder',loginId:'login'});
  assert.equal((await login).loginId,'login'); assert.equal(completions,0);
  const slow=observed(p.engine.request('plugin/read',{})), fast=p.engine.request('account/read',{});
  await p.reply(2,{account:null}); assert.deepEqual(await fast,{account:null});
  t.mock.timers.tick(120001); await flush(); assert.equal(slow.state(),'pending');
  await p.event('mcpServer/oauthLogin/completed',{success:true}); assert.equal(completions,1);
  await p.reply(1,{plugin:'synthetic'}); assert.deepEqual(await slow.result,{plugin:'synthetic'});
  await p.engine.close();
});

test('lost receipts for mutations stay unknown on disconnect and are never replayed', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const p=peer();
  const operations=['plugin/install','mcpServer/oauth/login','config/batchWrite'].map(method=>observed(p.engine.request(method,{})));
  try {
    t.mock.timers.tick(60000); await flush();
    assert.deepEqual(operations.map(x=>x.state()),['pending','pending','pending']);
    p.engine['fail'](Error('engine_disconnected'));
    for(const work of operations)await assert.rejects(work.result,/engine_disconnected/);
    assert.deepEqual(p.sent.map(x=>x.method),['plugin/install','mcpServer/oauth/login','config/batchWrite']);
    assert.equal(p.engine['pending'].size,0);
    await p.reply(0,{installed:true}); // A late receipt cannot revive settled work.
    await assert.rejects(p.engine.request('account/read',{}),/engine_disconnected/);
    assert.equal(p.sent.length,3);
  } finally {await p.engine.close();}
});

test('send failure, duplicate response and close clean pending and refuse further requests', async () => {
  const p=peer(); const first=p.engine.request('first',{});
  await p.reply(0,{value:1}); await p.reply(0,{value:2}); assert.equal((await first).value,1);
  const second=observed(p.engine.request('second',{}));
  await p.engine.close(); await assert.rejects(second.result,/engine_closed/);
  await assert.rejects(p.engine.request('after-close',{}),/engine_closed/); assert.equal(p.sent.length,2);
  assert.equal(p.engine['pending'].size,0);
  const broken=new CodexEngine(config,options,async()=>({}));
  await assert.rejects(broken.request('before-start',{}),/engine_disconnected/); assert.equal(broken['pending'].size,0);
});

test('interrupt without native confirmation remains unconfirmed and close settles both pending calls', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const p=peer();
  const turn=observed(p.engine.turn('synthetic')); await flush();await p.reply(0,{turn:{id:'turn'}}); await flush();
  const stopped=p.engine.interrupt(); t.mock.timers.tick(config.stopGraceMs); assert.equal(await stopped,false);
  assert.equal(turn.state(),'pending'); assert.equal(p.engine['pending'].size,1);
  await p.engine.close(); await assert.rejects(turn.result,/engine_closed/); assert.equal(p.engine['pending'].size,0);
});

test('native retry notifications do not retry or finish the host turn before terminal completion', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const p=peer(); const turn=observed(p.engine.turn('synthetic'));
  await flush();await p.event('turn/started',{turn:{id:'turn',status:'inProgress'}});
  t.mock.timers.tick(15001); await flush(); assert.equal(turn.state(),'pending');
  await p.reply(0,{turn:{id:'turn'}});
  await p.event('error',{turnId:'turn',willRetry:true,error:{message:'retry native'}});
  t.mock.timers.tick(60000); await flush(); assert.equal(turn.state(),'pending'); assert.equal(p.sent.length,1);
  await p.event('turn/completed',{turn:{id:'turn',status:'failed',error:{message:'429 exhausted'}}});
  assert.equal((await turn.result).errorCode,'engine_rate_limited'); assert.equal(p.sent.length,1);
  await p.engine.close();
});

test('silent initialize terminates its process within the existing handshake boundary', async t => {
  const engine=new CodexEngine(config,options,async()=>({}));
  t.mock.timers.enable({apis:['setTimeout']});
  const start=observed(engine.start());
  try {
    assert.equal(engine['pending'].size,1);
    t.mock.timers.tick(15000); await flush();
    // Let actual process exit settle close(), while advancing the bounded fallback too.
    t.mock.timers.tick(config.stopGraceMs+1000);
    await assert.rejects(start.result,/engine_initialize_timeout/);
    assert.equal(engine['pending'].size,0); assert.equal(engine['closing'],true);
  } finally {assert.equal(await engine.close(),true);}
});

test('stdout EOF rejects pending even if the process stays alive', async () => {
  const engine=new CodexEngine({...config,model:'eof'},options,async()=>({}));
  try {await assert.rejects(engine.start(),/engine_disconnected/); assert.equal(engine['pending'].size,0);}
  finally {assert.equal(await engine.close(),true);}
});

test('unconfirmed process stop is bounded, clears pending and removes exit waiters', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const p=peer(); const child=new EventEmitter() as any;
  p.engine['child']=child; // No pid: no real process is signalled by this synthetic boundary test.
  const work=observed(p.engine.request('plugin/install',{})); const close=p.engine.close();
  t.mock.timers.tick(config.stopGraceMs); await flush(); t.mock.timers.tick(1000);
  assert.equal(await close,false); await assert.rejects(work.result,/engine_closed/);
  assert.equal(child.listenerCount('exit'),0); assert.equal(p.engine['pending'].size,0);
});

test('compaction waits beyond 15 seconds for its own native item and ignores other turns', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const p=peer();
  const compact=observed(p.engine.compact()); await p.reply(0);
  await p.event('turn/started',{turn:{id:'compact-turn'}});
  await p.event('item/started',{turnId:'compact-turn',item:{type:'contextCompaction',id:'compact-item'}});
  await assert.rejects(p.engine.turn('conflict'),/engine_turn_busy/);
  await assert.rejects(p.engine.compact(),/engine_compact_not_applicable/);
  t.mock.timers.tick(60000); await flush(); assert.equal(compact.state(),'pending');
  await p.event('item/completed',{turnId:'other-turn',item:{type:'contextCompaction',id:'other-item'}});
  await flush(); assert.equal(compact.state(),'pending');
  await p.event('error',{turnId:'compact-turn',willRetry:true,error:{message:'native retry'}});
  await p.event('item/completed',{turnId:'compact-turn',item:{type:'contextCompaction',id:'compact-item'}});
  await compact.result; assert.equal(p.sent.length,1); await p.engine.close();
});

test('compaction terminal failure, interruption, missing item and disconnect all settle without listeners leaking', async () => {
  for(const outcome of ['failed','interrupted','completed','disconnect','close']) {
    const p=peer(); const work=observed(p.engine.compact()); await p.reply(0);
    await p.event('turn/started',{turn:{id:'compact-turn'}});
    if(outcome==='disconnect')p.engine['fail'](Error('engine_disconnected'));
    else if(outcome==='close')await p.engine.close();
    else await p.event('turn/completed',{turn:{id:'compact-turn',status:outcome,...(outcome==='failed'?{error:{message:'401 hidden'}}:{})}});
    const code=outcome==='failed'?'engine_authentication_failed':outcome==='interrupted'?'engine_compact_interrupted':outcome==='completed'?'engine_compact_unconfirmed':outcome==='close'?'engine_closed':'engine_disconnected';
    await assert.rejects(work.result,new RegExp(code)); assert.equal(p.engine.listenerCount('contextCompaction'),0);
    await p.engine.close();
  }
});

test('compaction interrupt targets the native compact turn and does not claim confirmation on ACK', async () => {
  const p=peer(); const work=observed(p.engine.compact()); await p.reply(0);
  await p.event('turn/started',{turn:{id:'compact-turn'}});
  const interrupted=p.engine.interrupt();
  assert.equal(p.sent[1]!.method,'turn/interrupt'); assert.equal(p.sent[1]!.params.turnId,'compact-turn');
  await p.reply(1); assert.equal(await interrupted,false); assert.equal(work.state(),'pending');
  await p.event('turn/completed',{turn:{id:'compact-turn',status:'interrupted'}});
  await assert.rejects(work.result,/engine_compact_interrupted/); await p.engine.close();
});

test('compaction completion before ACK remains successful only after the request succeeds', async () => {
  const p=peer(); const work=observed(p.engine.compact());
  await p.event('item/started',{turnId:'compact-turn',item:{type:'contextCompaction',id:'item'}});
  await p.event('item/completed',{turnId:'compact-turn',item:{type:'contextCompaction',id:'item'}});
  await flush(); assert.equal(work.state(),'pending');
  await p.receive({id:p.sent[0]!.id,error:{message:'permissions denied'}});
  await assert.rejects(work.result,/engine_permission_failed/); await p.engine.close();
});

// Exercise the real stdio/exit path in addition to controlled protocol delivery.
test('real child exit rejects active pending and cleans the request map', async () => {
  const engine=new CodexEngine({...config,model:'exit'},options,async()=>({}));
  const exit=once(engine,'exit');
  try {await assert.rejects(engine.start(),/engine_disconnected/); await exit; assert.equal(engine['pending'].size,0);}
  finally {assert.equal(await engine.close(),true);}
});

test('Windows main close drains stdio but refuses a stop proof without an owned process tree',async()=>{
 const p=peer('main'),child=new EventEmitter() as any,platform=Object.getOwnPropertyDescriptor(process,'platform')!;let eof=0;
 child.stdin={end(){eof++;queueMicrotask(()=>{p.engine['exited']=true;child.emit('exit',0);});}};p.engine['child']=child;
 try{Object.defineProperty(process,'platform',{value:'win32'});assert.equal(await p.engine.close(),false);assert.equal(eof,1);}finally{Object.defineProperty(process,'platform',platform);}
});
