import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openMobileSignal} from '../src/mobile-signaling.js';

// Exercise platform WebSocket delivery order without a second signaling server.
class TestSocket extends EventTarget {
 static current:TestSocket;
 static autoOpen=true;
 readyState=0;
 constructor(_url:URL){super();TestSocket.current=this;if(TestSocket.autoOpen)queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
 send(packet:string){const {id}=JSON.parse(packet);queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id,result:{accepted:true}})})));}
 close(){if(this.readyState===3)return;this.readyState=3;this.dispatchEvent(new Event('close'));}
 event(event:unknown){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event})}));}
}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('SDP handling finishes before the next ICE event starts',async()=>{
 const original=globalThis.WebSocket;
 globalThis.WebSocket=TestSocket as unknown as typeof WebSocket;
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),seen:string[]=[];
 let signal:Awaited<ReturnType<typeof openMobileSignal>>|undefined;
 try{
  signal=await openMobileSignal('ws://127.0.0.1/homer/rtc','mobile',async event=>{
   if(event.description){seen.push('description:start');await gate;seen.push('description:done');}
   else seen.push('candidate');
  });
  const sessionId='abcdefghijklmnopqrstuv';
  TestSocket.current.event({type:'signal',sessionId,description:{type:'offer',sdp:'synthetic'}});
  TestSocket.current.event({type:'signal',sessionId,candidate:null});
  await turn();
  assert.deepEqual(seen,['description:start']);
  release();await turn();
  assert.deepEqual(seen,['description:start','description:done','candidate']);
  assert.equal(signal.closed,false);
 }finally{release();signal?.close();globalThis.WebSocket=original;}
});
test('a signal handler can await a response without blocking response delivery',async()=>{
 const original=globalThis.WebSocket;
 globalThis.WebSocket=TestSocket as unknown as typeof WebSocket;
 let signal:Awaited<ReturnType<typeof openMobileSignal>>|undefined;
 const seen:string[]=[],sessionId='abcdefghijklmnopqrstuv';
 try{
  signal=await openMobileSignal('ws://127.0.0.1/homer/rtc','mobile',async event=>{
   if(event.description){assert.deepEqual(await signal!.call('send',{sessionId,candidate:null}),{accepted:true});seen.push('response');}
   else seen.push('candidate');
  });
  TestSocket.current.event({type:'signal',sessionId,description:{type:'offer',sdp:'synthetic'}});
  TestSocket.current.event({type:'signal',sessionId,candidate:null});
  await turn();assert.deepEqual(seen,['response','candidate']);
 }finally{signal?.close();globalThis.WebSocket=original;}
});

test('closing the owner aborts a signaling handshake without waiting for its timeout',async()=>{
 const original=globalThis.WebSocket;globalThis.WebSocket=TestSocket as unknown as typeof WebSocket;TestSocket.autoOpen=false;
 const controller=new AbortController();
 const connecting=openMobileSignal('ws://127.0.0.1/homer/rtc','host',()=>{},()=>{},controller.signal);void connecting.catch(()=>{});
 try{controller.abort();assert.equal(TestSocket.current.readyState,3);await assert.rejects(connecting,/mobile_signal_unavailable/);}
 finally{TestSocket.current.close();TestSocket.current.dispatchEvent(new Event('error'));TestSocket.autoOpen=true;globalThis.WebSocket=original;}
});
