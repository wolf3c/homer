import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebServer} from '../src/web-server.js';
import type {WebBridge} from '../src/web-contract.js';

for(const path of ['/api/history/state','/api/history/events'])test('updates during every build do not starve '+path,async()=>{
 let builds=0,server!:Awaited<ReturnType<typeof createWebServer>>;
 // Deterministically invalidate every in-flight build, without a machine-speed
 // threshold: the former retry-until-quiet loop can never deliver this snapshot.
 const state=async()=>{const revision=++builds;server.publish();await new Promise<void>(resolve=>setImmediate(resolve));return {revision};};
 server=await createWebServer({bridge:{state,history:{state}} as unknown as WebBridge,port:0});
 const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(server.url+path,{signal:controller.signal});assert.equal(response.status,200);
  if(path.endsWith('events')){const reader=response.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/data: {"revision":1}/);await reader.cancel();}
  else {assert.equal((await response.json()).revision,1);assert.equal(builds,1,'return one complete snapshot while updates continue');}
 }finally{clearTimeout(deadline);controller.abort();await server.close();}
});

for(const path of ['/api/events','/api/history/events'])test('first SSE connection receives an update that arrived during its initial snapshot: '+path,async()=>{
 let revision=0,builds=0,server!:Awaited<ReturnType<typeof createWebServer>>;
 const state=async()=>{
  const value={revision};builds++;
  if(builds===1){revision=1;server.publish();}
  await new Promise<void>(resolve=>setImmediate(resolve));return value;
 };
 server=await createWebServer({bridge:{state,history:{state}} as unknown as WebBridge,port:0});
 const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(server.url+path,{signal:controller.signal}),reader=response.body!.getReader();
  let frames='';
  while(!frames.includes('"revision":1')){const next=await reader.read();assert.equal(next.done,false);frames+=new TextDecoder().decode(next.value);}
  assert.match(frames,/"revision":0/);assert.equal(builds,2);
  await reader.cancel();
 }finally{clearTimeout(deadline);controller.abort();await server.close();}
});
