import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createMobileTurn} from '../src/mobile-turn.js';

const payload=()=>({iceServers:[{urls:['turn:192.0.2.10:3478?transport=udp'],username:'2000000000:0123456789abcdef0123456789abcdef',credential:'MDEyMzQ1Njc4OWFiY2RlZjAxMjM='}],expiresAt:2000000000,ttlSeconds:3600});
async function fixture(t:any,respond:(req:any,res:any)=>void){
 const server=createServer(respond);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+(server.address() as any).port;
 const turn=createMobileTurn({gatewayOrigin:origin,token:'synthetic-model-token',allowSyntheticLoopback:true});
 t.after(async()=>{turn.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 return turn;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('concurrent new peers share issuance; refresh replaces only future credentials across two TTLs',async t=>{
 let count=0;const turn=await fixture(t,(req,res)=>{count++;assert.equal(req.method,'POST');assert.equal(req.url,'/api/homer/turn/credentials');assert.equal(req.headers.authorization,'Bearer synthetic-model-token');res.setHeader('Content-Type','application/json');const value=payload();value.iceServers[0]!.credential=Buffer.alloc(20,count).toString('base64');res.end(JSON.stringify(value));});
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const values=await Promise.all([turn.get(),turn.get(),turn.get()]);assert.equal(count,1);assert.deepEqual(values[0],[{hostname:'192.0.2.10',port:3478,username:payload().iceServers[0]!.username,password:Buffer.alloc(20,1).toString('base64'),relayType:'TurnUdp'}]);
 for(let cycle=0;cycle<2;cycle++) {t.mock.timers.tick(2800000);for(let tries=0;tries<100;tries++){await flush();const value=await turn.get();if(value[0]?.password===Buffer.alloc(20,cycle+2).toString('base64'))break;}assert.equal((await turn.get())[0]?.password,Buffer.alloc(20,cycle+2).toString('base64'));}
 assert.equal(count,3);assert.equal(values[0].length,1,'an already supplied config is not cleared on refresh');
});
test('503 backoff and Retry-After are shared by timer, reconnect and new peers',async t=>{
 let count=0,status=503;const turn=await fixture(t,(_req,res)=>{count++;res.statusCode=status;if(status===429)res.setHeader('Retry-After','120');res.end('{}');});
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 assert.deepEqual(await turn.get(),[]);for(let i=0;i<4;i++){turn.networkChanged();await turn.get();}assert.equal(count,1);
 status=429;t.mock.timers.tick(60000);await flush();await turn.get();await flush();assert.equal(count,2);
 t.mock.timers.tick(119999);await turn.get();assert.equal(count,2);
});
test('401 stays paused; IP denial retries once on a later signaling reconnect',async t=>{
 let count=0,status=401,code='invalid_token';const turn=await fixture(t,(_req,res)=>{count++;res.statusCode=status;res.end(JSON.stringify({code}));});
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 await turn.get();assert.equal(turn.status,'account_required');t.mock.timers.tick(7200000);turn.networkChanged();await turn.get();assert.equal(count,1);
 const second=await fixture(t,(_req,res)=>{count++;res.statusCode=status;res.end(JSON.stringify({code}));});status=403;code='ip_not_allowed';
 await second.get();assert.equal(second.status,'network_restricted');const before=count;second.networkChanged();await second.get();assert.equal(count,before);
 t.mock.timers.tick(60000);await flush();await second.get();assert.equal(count,before+1);
 t.mock.timers.tick(7200000);await second.get();assert.equal(count,before+1);
});
test('shutdown discards late credentials and redirect never forwards the model token',async t=>{
 let release:()=>void=()=>{};const turn=await fixture(t,(_req,res)=>{release=()=>res.end(JSON.stringify(payload()));});
 const pending=turn.get();await flush();await flush();turn.close();release();assert.deepEqual(await pending,[]);assert.deepEqual(await turn.get(),[]);
 let requests=0,forwarded=0;const target=createServer((_req,res)=>{forwarded++;res.end('{}');});await new Promise<void>(resolve=>target.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{target.closeAllConnections();await new Promise<void>(resolve=>target.close(()=>resolve()));});
 const redirect=await fixture(t,(_req,res)=>{requests++;res.writeHead(302,{Location:'http://127.0.0.1:'+(target.address() as any).port+'/private'});res.end();});assert.deepEqual(await redirect.get(),[]);assert.equal(requests,1);assert.equal(forwarded,0);
});
test('malformed ICE replies cannot inject native ICE options',async t=>{
 const turn=await fixture(t,(_req,res)=>{const value=payload();value.iceServers[0]!.urls=['turn:127.0.0.1:3478?transport=tcp'];res.end(JSON.stringify(value));});assert.deepEqual(await turn.get(),[]);
 assert.throws(()=>createMobileTurn({gatewayOrigin:'http://example.com',token:'synthetic'}));
});
test('wall clock sleep invalidates cached credentials before a new peer, even with a late timer',async t=>{
 let count=0;const turn=await fixture(t,(_req,res)=>{count++;res.end(JSON.stringify(payload()));});
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 assert.equal((await turn.get()).length,1);t.mock.timers.setTime(7400000);
 assert.equal((await turn.get()).length,1);assert.equal(count,2);
});

// Deterministic issuer faults: no network, real request/cache/timer implementation.
function fakeIssuer(t:any,respond:(options:RequestInit)=>Response|Promise<Response>){
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const calls:RequestInit[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{calls.push(options);return respond(options);});
 const turn=createMobileTurn({gatewayOrigin:'https://issuer.example',token:'synthetic-model-token'});
 t.after(()=>turn.close());return {turn,calls};
}
test('refresh, reconnect and new peers share one flight while a healthy config remains unchanged',async t=>{
 let release!:(response:Response)=>void;
 const {turn,calls}=fakeIssuer(t,()=>calls.length===1?Response.json(payload()):new Promise(resolve=>{release=resolve;}));
 const old=await turn.get();t.mock.timers.tick(2700000);
 turn.networkChanged();const current=await Promise.all([turn.get(),turn.get(),turn.get()]);
 assert.equal(calls.length,2);assert.ok(current.every(value=>value===old));
 const next=payload();next.iceServers[0]!.credential=Buffer.alloc(20,9).toString('base64');release(Response.json(next));await flush();
 assert.equal((await turn.get())[0]?.password,next.iceServers[0]!.credential);assert.equal(old[0]?.password,payload().iceServers[0]!.credential);
 assert.equal(calls[0]!.redirect,'error');assert.equal(calls[0]!.credentials,'omit');assert.equal(calls[0]!.cache,'no-store');
});
test('expired cache is withheld during issuer failure, including sleep without timer delivery',async t=>{
 let healthy=true;const {turn,calls}=fakeIssuer(t,()=>healthy?Response.json(payload()):new Response('{}',{status:503}));
 assert.equal((await turn.get()).length,1);healthy=false;t.mock.timers.setTime(3670000);
 assert.deepEqual(await turn.get(),[]);assert.equal(calls.length,2);
 turn.networkChanged();assert.deepEqual(await turn.get(),[]);assert.equal(calls.length,2);
});
test('network, 404 and 503 use the same capped backoff and reset after recovery',async t=>{
 let mode='network';const {turn,calls}=fakeIssuer(t,()=>{if(mode==='network')throw Error('synthetic failure');return mode==='ok'?Response.json(payload()):new Response('{}',{status:Number(mode)});});
 await turn.get();
 for(const [index,delay] of [60000,120000,240000,480000,900000,900000].entries()){
  mode=index%2?'503':'404';const before=calls.length;
  t.mock.timers.tick(delay-1);turn.networkChanged();await turn.get();assert.equal(calls.length,before);
  t.mock.timers.tick(1);await turn.get();assert.equal(calls.length,before+1);
 }
 mode='ok';t.mock.timers.tick(900000);await turn.get();assert.equal((await turn.get()).length,1);
 mode='503';t.mock.timers.tick(2700000);await flush();const before=calls.length;
 t.mock.timers.tick(59999);await turn.get();assert.equal(calls.length,before);
 t.mock.timers.tick(1);await turn.get();assert.equal(calls.length,before+1);
});
test('all authorization denials clear cache; only IP denial can resume through signaling',async t=>{
 for(const [status,code,expected] of [[401,'invalid_token','account_required'],[403,'turn_forbidden','configuration_required'],[403,'ip_not_allowed','network_restricted']] as const){
  await t.test(code,async t=>{
   let healthy=true;const {turn,calls}=fakeIssuer(t,()=>healthy?Response.json(payload()):Response.json({code},{status}));
   await turn.get();healthy=false;t.mock.timers.tick(2700000);await flush();
   assert.deepEqual(await turn.get(),[]);assert.equal(turn.status,expected);assert.equal(calls.length,2);
   healthy=true;turn.networkChanged();await turn.get();assert.equal(calls.length,2);
   t.mock.timers.tick(60000);await turn.get();
   if(status===403&&code==='ip_not_allowed'){assert.equal(calls.length,3);assert.equal(turn.status,undefined);}
   else {turn.networkChanged();t.mock.timers.tick(7200000);assert.deepEqual(await turn.get(),[]);assert.equal(calls.length,2);}
  });
 }
});
test('Retry-After seconds, HTTP date, missing and malformed values control the one retry timer',async t=>{
 for(const [header,delay] of [['120',120000],[new Date(280000).toUTCString(),180000],['bad',60000],['0',60000],['',60000]] as const){
  await t.test(header||'missing',async t=>{
   const {turn,calls}=fakeIssuer(t,()=>new Response('{}',{status:429,headers:header?{'Retry-After':header}:{}}));await turn.get();
   t.mock.timers.tick(delay-1);turn.networkChanged();await turn.get();assert.equal(calls.length,1);
   t.mock.timers.tick(1);await turn.get();assert.equal(calls.length,2);
  });
 }
});
test('five second deadline aborts both slow headers and an unfinished response body',async t=>{
 for(const body of [false,true])await t.test(body?'body':'headers',async t=>{
  let aborted=false;
  const {turn,calls}=fakeIssuer(t,options=>body?new Response(new ReadableStream({start(controller){options.signal!.addEventListener('abort',()=>{aborted=true;controller.error(Error('aborted'));});controller.enqueue(new TextEncoder().encode('{'));}})):new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));})));
  let settled=false;const pending=turn.get().then(value=>{settled=true;return value;});await flush();
  t.mock.timers.tick(4999);await flush();assert.equal(settled,false);
  t.mock.timers.tick(1);assert.deepEqual(await pending,[]);assert.equal(aborted,true);
  turn.networkChanged();await turn.get();assert.equal(calls.length,1);
 });
});
test('malformed JSON, oversized body and invalid credential fields all fail closed',async t=>{
 const invalid=[()=>'{',()=> 'x'.repeat(8193),()=>JSON.stringify({...payload(),ttlSeconds:7200}),()=>JSON.stringify({...payload(),iceServers:[]}),()=>JSON.stringify({...payload(),expiresAt:1}),()=>JSON.stringify({...payload(),iceServers:[{...payload().iceServers[0],urls:['turn:999.0.0.1:3478?transport=udp']}]}),()=>JSON.stringify({...payload(),iceServers:[{...payload().iceServers[0],credential:'plain-secret'}]})];
 for(const [index,value] of invalid.entries())await t.test(String(index),async t=>{const {turn,calls}=fakeIssuer(t,()=>new Response(value()));assert.deepEqual(await turn.get(),[]);turn.networkChanged();await turn.get();assert.equal(calls.length,1);});
});
test('closing an old owner aborts its flight and timer without poisoning the replacement owner',async t=>{
 let release!:(response:Response)=>void;
 const {turn:old,calls}=fakeIssuer(t,()=>calls.length===1?new Promise(resolve=>{release=resolve;}):Response.json(payload()));
 const pending=old.get();old.close();assert.equal(calls[0]!.signal!.aborted,true);
 const next=createMobileTurn({gatewayOrigin:'https://issuer.example',token:'synthetic-new-owner'});t.after(()=>next.close());
 assert.equal((await next.get()).length,1);release(Response.json(payload()));assert.deepEqual(await pending,[]);
 const before=calls.length;old.networkChanged();assert.deepEqual(await old.get(),[]);assert.equal(calls.length,before);
 next.close();t.mock.timers.tick(7200000);assert.equal(calls.length,before);
});
