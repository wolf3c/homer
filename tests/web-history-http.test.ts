import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import type {Homer} from '../src/service.js';

test('versioned HTTP reads enforce Origin, epoch, bounds, exact identity and shared finite SSE',async()=>{
 const f=historyFixture(100),reader=new WebHistoryPages(f.history,f.processes,f.inputs);let submits=0,builds=0;
 const host={...f,webReadEpoch:'http-synthetic-epoch',webHistoryPages:()=>reader,registerWebSurface(){},onStateChange(){return()=>{};},media:{view(){throw Error('no_media');}},conversationControlState:()=>({isRunning:false,activeMessageId:null}),snapshot(){throw Error('full_snapshot_forbidden');},conversationState(){throw Error('full_conversation_forbidden');},submitMessage(){submits++;throw Error('unexpected_submit');}};
 const bridge=homerWebBridge(host as unknown as Homer),original=bridge.history!.state;
 bridge.history!.state=async()=>{builds++;return original();};
 const server=await createWebServer({bridge,port:0}),origin=server.url;
 const post=(path:string,value:unknown,requestOrigin=origin)=>fetch(origin+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(value)});
 const controller=new AbortController();
 try{
  assert.notEqual(new URL(origin).port,'4780');
  const state=await fetch(origin+'/api/history/state');assert.equal(state.headers.get('cache-control'),'no-store');const initial=await state.json();assert.equal(initial.messages.length,80);assert.equal(initial.history.protocol,3);
  for(const path of ['/api/state','/api/events']){
   const retired=await fetch(origin+path);assert.equal(retired.status,404,path);await retired.arrayBuffer();
  }
  assert.equal((await post('/api/history/page',{readEpoch:host.webReadEpoch,request:{}},'https://untrusted.invalid')).status,403);
  assert.equal((await post('/api/history/page',{readEpoch:'stale',request:{}})).status,409);
  assert.equal((await post('/api/history/page',{readEpoch:host.webReadEpoch,request:{limit:81}})).status,409);
  assert.equal((await post('/api/history/process',{readEpoch:host.webReadEpoch,id:'../node-0'})).status,409);
  assert.equal((await post('/api/history/process',{readEpoch:host.webReadEpoch,id:'missing'})).status,409);
  for(const kind of ['queue','interactions']){
   assert.equal((await post('/api/history/'+kind,{readEpoch:'old',after:0})).status,409);
   const response=await post('/api/history/'+kind,{readEpoch:host.webReadEpoch,after:0}),page=await response.json();
   assert.equal(page.threadId,'synthetic-history');assert.equal(page.readEpoch,host.webReadEpoch);assert.equal(typeof page.revision,'number');assert.ok(page.items.length<=80);
  }
  const resolved=await (await post('/api/history/resolve',{readEpoch:host.webReadEpoch,id:'node-0'})).json();assert.equal(resolved.sourceMessageId,'user-0');
  const receipts=await (await post('/api/history/receipts',{requestIds:['request-0','absent']})).json();assert.deepEqual(receipts.acceptedRequestIds,['request-0']);assert.equal(receipts.statuses[1].state,'unconfirmed');
  const events=await fetch(origin+'/api/history/events',{signal:controller.signal}),stream=events.body!.getReader();await stream.read();
  const before=builds;for(let n=0;n<20;n++)server.publish();const next=await stream.read();assert.ok(next.value!.length<100000);assert.equal(builds,before+1,'150ms invalidations share a finite snapshot');
  const page=bridge.history!.page;let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});bridge.history!.page=async input=>{await gate;return page(input);};
  const four=Array.from({length:4},()=>post('/api/history/page',{readEpoch:host.webReadEpoch,request:{}}));
  await new Promise(done=>setTimeout(done,30));const busy=await post('/api/history/page',{readEpoch:host.webReadEpoch,request:{}});assert.equal((await busy.json()).error,'history_read_busy');release();assert.ok((await Promise.all(four)).every(response=>response.status===200));
  assert.equal(submits,0);
 }finally{controller.abort();await server.close();f.close();}
});
