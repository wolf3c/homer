import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {MockAgent} from 'undici';
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
