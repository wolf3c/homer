import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {once} from 'node:events';
import {MockAgent} from 'undici';
import WebSocket,{WebSocketServer} from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {SocksProxyAgent} from 'socks-proxy-agent';
import tls from 'node:tls';
// The real 0.163.0 rejection is input[6].content: array_above_max_length.
const bridgeModule=await import('../src/native-history-bridge.js');
test('foreign plaintext reasoning is projected without changing stored history or native reasoning',()=>{
 assert.ok(bridgeModule,'native request history projection is required');
 const input=[{type:'message',role:'user',content:[{type:'input_text',text:'marker'}]},{type:'reasoning',id:'rs_foreign',summary:[],content:[{type:'reasoning_text',text:'synthetic prior reasoning'}],encrypted_content:'foreign-provider-stub'},{type:'function_call',call_id:'call_1',name:'test',arguments:'{}'},{type:'function_call_output',call_id:'call_1',output:'result'},{type:'reasoning',id:'rs_native',summary:[{type:'summary_text',text:'native summary'}],content:[],encrypted_content:'native-opaque-ciphertext'}];
 const original=structuredClone(input),result=bridgeModule.nativeHistoryInput(input);
 assert.deepEqual(input,original);
 assert.deepEqual(result[1],{type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic prior reasoning'}]});
 for(const i of [0,2,3,4])assert.strictEqual(result[i],input[i]);
 assert.equal(result.length,input.length);
 assert.deepEqual(bridgeModule.nativeHistoryInput([{type:'reasoning',summary:[{type:'summary_text',text:'summary'}],content:[{type:'reasoning_text',text:'reasoning'}]}])[0].content,[{type:'output_text',text:'summary'},{type:'output_text',text:'reasoning'}]);
 assert.throws(()=>bridgeModule.nativeHistoryInput([{type:'reasoning',content:[{type:'unknown'}]}]),/engine_history_input_invalid/);
});
test('loopback bridge forwards only native endpoints, streams unchanged, and has no replay',async()=>{
 assert.ok(bridgeModule,'native request history projection is required');
 const dispatcher=new MockAgent();Object.assign(dispatcher,{destroy:()=>dispatcher.close()});dispatcher.disableNetConnect();
 const pool=dispatcher.get('https://chatgpt.com');let seen:any;
 pool.intercept({path:'/backend-api/codex/responses',method:'POST'}).reply(options=>{
  seen=JSON.parse(String(options.body));assert.ok(seen.input.every((i:any)=>i.type!=='reasoning'||!i.content?.length));
  return {statusCode:200,data:'data: synthetic-stream\n\n',responseOptions:{headers:{'content-type':'text/event-stream'}}};
 });
 pool.intercept({path:'/backend-api/codex/responses',method:'POST'}).reply(400,'{"error":{"code":"synthetic_rejection"}}',{'headers':{'content-type':'application/json'}});
 pool.intercept({path:'/backend-api/codex/models?client_version=0.163.0',method:'GET'}).reply(302,'redirect', {headers:{location:'https://example.invalid/credential-trap'}});
 const bridge=await bridgeModule.nativeHistoryBridge({},dispatcher);
 try{
  const catalog=await fetch(bridge.baseUrl+'/models?client_version=0.163.0',{headers:{authorization:'Bearer synthetic-test-only'},redirect:'manual'});assert.equal(catalog.status,302);
  const init={method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic-test-only'},body:JSON.stringify({model:'gpt-6.1-sol',input:[{type:'reasoning',content:[{type:'reasoning_text',text:'synthetic'}],encrypted_content:'stub'}]})};
  const response=await fetch(bridge.baseUrl+'/responses',init);assert.equal(response.status,200);assert.equal(await response.text(),'data: synthetic-stream\n\n');assert.equal(seen.model,'gpt-6.1-sol');
  assert.equal((await fetch(bridge.baseUrl+'/responses',init)).status,400);
  assert.equal((await fetch(bridge.baseUrl+'/responses',init)).status,502); // No upstream replay or extra intercepted requests.
  assert.equal((await fetch(bridge.baseUrl+'/responses')).status,426);
  assert.equal((await fetch(bridge.baseUrl+'/../unknown')).status,404);
  assert.equal((await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{origin:'https://example.invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer synthetic-test-only'},body:'invalid json'})).status,400);
 }finally{await bridge.close();}
 await assert.rejects(fetch(bridge.baseUrl+'/responses'));
});

for(const protocol of ['http','socks5'])test(`native history forwarding retains ${protocol} ALL_PROXY without direct fallback`,async()=>{
 let contacted=false;
 const proxy=createServer(socket=>socket.once('data',chunk=>{contacted=true;if(protocol==='http')assert.match(chunk.toString(),/^CONNECT chatgpt.com:443 /);else assert.equal(chunk[0],5);socket.end(protocol==='http'?'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n':Buffer.from([5,255]));}));
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const bridge=await bridgeModule.nativeHistoryBridge({ALL_PROXY:protocol+'://127.0.0.1:'+String((proxy.address() as any).port),NO_PROXY:'localhost,127.0.0.1,chatgpt.com:8443'});
 try{const result=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer synthetic-test-only'},body:'{"input":[]}'});assert.equal(result.status,502);assert.equal(contacted,true);}finally{await bridge.close();await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
});
test('closing an active stream aborts the upstream and releases the loopback listener',async()=>{
 let aborted=false,destroyed=false;
 const dispatcher={dispatch(_options:any,handler:any){
  handler.onConnect(()=>{aborted=true;handler.onError(Error('synthetic_abort'));});
  handler.onHeaders(200,[Buffer.from('content-type'),Buffer.from('text/event-stream')],()=>{},'OK');
  handler.onData(Buffer.from('data: synthetic\n\n'));return true;
 },async destroy(){destroyed=true;}};
 const bridge=await bridgeModule.nativeHistoryBridge({},dispatcher as any);
 const response=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer synthetic-test-only'},body:'{"input":[]}'}),reader=response.body!.getReader();
 assert.equal((await reader.read()).done,false);
 await bridge.close();assert.equal(destroyed,true);
 await assert.rejects(reader.read());await assert.rejects(fetch(bridge.baseUrl+'/unknown'));
 assert.equal(aborted,true);
});

async function socketFixture(t:TestContext,options:{status?:number;wait?:Promise<void>;bypass?:boolean;socks?:string}={}){
 const server=httpServer(),sockets=new WebSocketServer({noServer:true,perMessageDeflate:false,handleProtocols:protocols=>protocols.has('native-v2')?'native-v2':[...protocols][0]??false});
 const handshakes:any[]=[],messages:any[]=[],peers:WebSocket[]=[];
 sockets.on('headers',headers=>headers.push('x-codex-turn-state: synthetic-turn-state'));
 server.on('upgrade',async(req,socket,head)=>{
  handshakes.push(req.headers);await options.wait;
  if(socket.destroyed)return;
  if(options.status){socket.end(`HTTP/1.1 ${options.status} Rejected\r\nContent-Type: application/json\r\nRetry-After: 3\r\nConnection: close\r\n\r\n{"error":{"code":"synthetic_rejection"}}`);return;}
  sockets.handleUpgrade(req,socket,head,peer=>{peers.push(peer);peer.on('error',()=>{});peer.on('message',(data,binary)=>{messages.push({text:data.toString(),binary});peer.send(data.toString(),{binary:false});});});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.mock.method(HttpsProxyAgent.prototype,'connect',async(_req:unknown,options:any)=>{
  assert.equal(options.host,'chatgpt.com');assert.equal(options.port,443);
  return connect((server.address() as any).port,'127.0.0.1');
 });
 const dispatcher=new MockAgent();dispatcher.disableNetConnect();Object.assign(dispatcher,{destroy:()=>dispatcher.close()});
 if(options.bypass)t.mock.method(tls,'connect',()=>connect((server.address() as any).port,'127.0.0.1'));
 if(options.socks)t.mock.method(SocksProxyAgent.prototype,'connect',async function(this:SocksProxyAgent,_req:unknown,request:any){
  assert.equal(this.shouldLookup,false);assert.equal(this.proxy.userId,'synthetic-user');assert.equal(this.proxy.password,'synthetic-password');assert.equal(request.host,'chatgpt.com');
  return connect((server.address() as any).port,'127.0.0.1');
 });
 const bridge=await bridgeModule.nativeHistoryBridge({HTTPS_PROXY:options.socks??'http://127.0.0.1:9',...(options.bypass?{NO_PROXY:'.chatgpt.com:443'}:{})},dispatcher);
 const clients:WebSocket[]=[];
 function client(path='/responses',headers:Record<string,string>={authorization:'Bearer synthetic-only'},protocols:string[]=[]){
  const ws=new WebSocket(bridge.baseUrl.replace('http:','ws:')+path,protocols,{headers,perMessageDeflate:false});ws.on('error',()=>{});clients.push(ws);return ws;
 }
 t.after(async()=>{for(const ws of clients)ws.terminate();await bridge.close();for(const ws of peers)ws.terminate();sockets.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 return {server,bridge,client,handshakes,messages,peers};
}

test('WebSocket preserves handshake metadata, fragmented text, prewarm and incremental requests',async t=>{
 const f=await socketFixture(t),ws=f.client('/responses',{authorization:'Bearer synthetic-only','openai-beta':'synthetic-beta',session_id:'synthetic-session','x-codex-turn-state':'prior-state'},['native-v1','native-v2']);
 let state:unknown;ws.on('upgrade',res=>state=res.headers['x-codex-turn-state']);await once(ws,'open');
 assert.equal(ws.protocol,'native-v2');assert.equal(state,'synthetic-turn-state');
 assert.equal(f.handshakes[0]['openai-beta'],'synthetic-beta');assert.equal(f.handshakes[0].session_id,'synthetic-session');assert.equal(f.handshakes[0]['x-codex-turn-state'],'prior-state');assert.equal(f.handshakes[0]['sec-websocket-extensions'],undefined);
 const input=[{type:'reasoning',content:[{type:'reasoning_text',text:'foreign text'}],encrypted_content:'foreign-stub'},{type:'reasoning',content:[],encrypted_content:'native-cipher'},{type:'function_call_output',call_id:'synthetic-call',output:'42'}];
 const request={type:'response.create',generate:false,input,previous_response_id:'synthetic-response',model:'synthetic-model',reasoning:{effort:'high'},tools:[]};
 const text=JSON.stringify(request),reply=once(ws,'message');ws.send(text.slice(0,25),{fin:false});ws.send(text.slice(25),{fin:true});
 const [data,binary]=await reply;assert.equal(binary,false);
 const projected=JSON.parse(data.toString());assert.deepEqual(projected,{...request,input:bridgeModule.nativeHistoryInput(input)});assert.equal(f.messages[0].binary,false);
 assert.equal(input[0]!.type,'reasoning');assert.equal(f.messages.length,1);
 for(const body of [{type:'response.create',previous_response_id:'synthetic-response',input:[]},{type:'response.create',generate:false},{type:'response.cancel'}]){
  const received=once(ws,'message');ws.send(JSON.stringify(body));assert.deepEqual(JSON.parse((await received)[0].toString()),body);
 }
 const inbound=once(ws,'message');f.peers[0]!.send('{"type":"response.',{fin:false});f.peers[0]!.send('completed"}',{fin:true});assert.equal((await inbound)[0].toString(),'{"type":"response.completed"}');
});

test('WebSocket waits for the real upstream upgrade and cancels pending handshakes',{timeout:5000},async t=>{
 let release!:()=>void;const wait=new Promise<void>(r=>release=r),f=await socketFixture(t,{wait});
 const ws=f.client();let opened=false;ws.on('open',()=>opened=true);
 await once(f.server,'upgrade');await new Promise(r=>setImmediate(r));assert.equal(opened,false);
 const stopped=new Promise<void>(r=>ws.once('close',()=>r()));await f.bridge.close();release();await stopped;await new Promise(r=>setImmediate(r));assert.equal(opened,false);assert.equal(f.messages.length,0);
 await f.bridge.close();
});

for(const status of [401,403,426,429,502,503])test(`WebSocket preserves upstream HTTP ${status} without replay`,async t=>{
 const f=await socketFixture(t,{status}),ws=f.client();
 const rejected=new Promise<{status:number|undefined;retry:unknown;body:string}>(resolve=>ws.on('unexpected-response',async(_req,res)=>{let body='';for await(const chunk of res)body+=chunk;resolve({status:res.statusCode,retry:res.headers['retry-after'],body});}));
 assert.deepEqual(await rejected,{status,retry:'3',body:'{"error":{"code":"synthetic_rejection"}}'});assert.equal(f.handshakes.length,1);assert.equal(f.messages.length,0);
});

test('WebSocket rejects unsafe routes and caller headers before contacting upstream',async t=>{
 const f=await socketFixture(t);
 for(const [path,headers,status] of [['/responses?unexpected=1',{authorization:'Bearer synthetic-only'},404],['/models',{authorization:'Bearer synthetic-only'},404],['/responses',{},401],['/responses',{authorization:'Bearer synthetic-only',origin:'https://example.invalid'},403],['/responses',{authorization:'Bearer synthetic-only',host:'example.invalid'},401]] as const){
  const ws=f.client(path,headers),rejected=new Promise<number|undefined>(r=>ws.on('unexpected-response',(_req,res)=>{res.resume();r(res.statusCode);}));assert.equal(await rejected,status);ws.terminate();
 }
 assert.equal(f.handshakes.length,0);
});

for(const [name,payload]of [['invalid JSON','{'],['invalid input','{"type":"response.create","input":{}}'],['binary',Buffer.from('{}')]] as const)test(`WebSocket rejects ${name} without dispatch`,async t=>{
 const f=await socketFixture(t),ws=f.client();await once(ws,'open');const closed=once(ws,'close');ws.send(payload);await closed;assert.equal(f.messages.length,0);
});

test('closing an active WebSocket releases both peers and remains idempotent',async t=>{
 const f=await socketFixture(t),ws=f.client();await once(ws,'open');const closed=once(ws,'close'),upstreamClosed=once(f.peers[0]!,'close');
 await f.bridge.close();await closed;await upstreamClosed;await f.bridge.close();assert.equal(f.messages.length,0);
});

test('WebSocket uses NO_PROXY and preserves ordered messages under backpressure',async t=>{
 const f=await socketFixture(t,{bypass:true}),ws=f.client();await once(ws,'open');ws.pause();
 const received:number[]=[];const finished=new Promise<void>(r=>ws.on('message',(body,binary)=>{assert.equal(binary,false);received.push(JSON.parse(body.toString()).index);if(received.length===40)r();}));
 for(let index=0;index<40;index++)f.peers[0]!.send(JSON.stringify({index,text:'x'.repeat(65536)}));
 await new Promise(r=>setTimeout(r,10));ws.resume();await finished;
 assert.deepEqual(received,Array.from({length:40},(_,index)=>index));
});

test('WebSocket handshake timeout emits one 504 and does not accept a late upstream',async t=>{
 let release!:()=>void;const wait=new Promise<void>(r=>release=r),f=await socketFixture(t,{wait});
 t.mock.timers.enable({apis:['setTimeout']});
 const ws=f.client(),rejected=new Promise<{status:number|undefined;body:string}>(r=>ws.on('unexpected-response',async(_req,res)=>{let body='';for await(const chunk of res)body+=chunk;r({status:res.statusCode,body});}));
 await once(f.server,'upgrade');t.mock.timers.tick(15000);assert.deepEqual(await rejected,{status:504,body:''});release();await new Promise(r=>setImmediate(r));assert.equal(f.messages.length,0);
});

test('WebSocket forwards an upstream message-size close code',async t=>{
 const f=await socketFixture(t),ws=f.client();await once(ws,'open');const closed=once(ws,'close');f.peers[0]!.close(1009,'synthetic message limit');
 const [code,reason]=await closed;assert.equal(code,1009);assert.equal(reason.toString(),'synthetic message limit');
});

test('WebSocket forwards server failure events unchanged without synthesizing completion',async t=>{
 const f=await socketFixture(t),ws=f.client();await once(ws,'open');
 const failure={type:'error',error:{code:'server_is_overloaded',message:'synthetic upstream failure'}};
 const reply=once(ws,'message');f.peers[0]!.send(JSON.stringify(failure));assert.deepEqual(JSON.parse((await reply)[0].toString()),failure);assert.equal(f.messages.length,0);
});

test('WebSocket rejects a message exceeding the existing 64 MiB limit',async t=>{
 const f=await socketFixture(t),ws=f.client();await once(ws,'open');const closed=once(ws,'close');ws.send(Buffer.alloc(64*1024*1024+1));await closed;assert.equal(f.messages.length,0);
});

for(const protocol of ['http','socks5','socks5h'])test(`WebSocket retains ${protocol} proxy routing without credential leakage or direct fallback`,async()=>{
 let attempts=0;
 const proxy=createServer(socket=>socket.once('data',chunk=>{
  attempts++;if(protocol==='http'){assert.match(chunk.toString(),/^CONNECT chatgpt.com:443 /);assert.match(chunk.toString(),/Proxy-Authorization: Basic /i);assert.doesNotMatch(chunk.toString(),/Bearer /);socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');}
  else{assert.equal(chunk[0],5);socket.end(Buffer.from([5,255]));}
 }));
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const bridge=await bridgeModule.nativeHistoryBridge({ALL_PROXY:protocol+'://synthetic-user:synthetic-password@127.0.0.1:'+String((proxy.address() as any).port)});
 const ws=new WebSocket(bridge.baseUrl.replace('http:','ws:')+'/responses',{headers:{authorization:'Bearer synthetic-only'}});ws.on('error',()=>{});
 try{const rejected=await new Promise<number|undefined>(r=>ws.on('unexpected-response',(_req,res)=>{res.resume();r(res.statusCode);}));assert.equal(rejected,protocol==='http'?407:502);assert.equal(attempts,1);}
 finally{ws.terminate();await bridge.close();await new Promise<void>(r=>proxy.close(()=>r()));}
});

for(const protocol of ['socks5','socks5h'])test(`WebSocket ${protocol} preserves remote DNS and proxy credentials`,async t=>{
 const f=await socketFixture(t,{socks:protocol+'://synthetic-user:synthetic-password@127.0.0.1:9'}),ws=f.client();await once(ws,'open');
 const reply=once(ws,'message');ws.send('{"type":"response.create","input":[]}');await reply;assert.equal(f.messages.length,1);
});

test('a rejected half-open Upgrade cannot keep the bridge close pending',async()=>{
 const dispatcher=new MockAgent();dispatcher.disableNetConnect();Object.assign(dispatcher,{destroy:()=>dispatcher.close()});
 const bridge=await bridgeModule.nativeHistoryBridge({},dispatcher),address=new URL(bridge.baseUrl);
 const socket=connect({host:'127.0.0.1',port:Number(address.port),allowHalfOpen:true});socket.on('error',()=>{});socket.resume();
 let closed=false;
 try{
  await once(socket,'connect');socket.write('GET /responses HTTP/1.1\r\nHost: '+address.host+'\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: c3ludGhldGljLWtleS0xMg==\r\n\r\n');
  await once(socket,'end');const closing=bridge.close().then(()=>{closed=true;});
  let forced=false;const timeout=setTimeout(()=>{forced=true;socket.destroy();},250);await closing;clearTimeout(timeout);assert.equal(forced,false,'close must not depend on the peer closing its writable side');
 }finally{socket.destroy();if(!closed)await bridge.close();}
});
