import {test} from 'node:test';
import assert from 'node:assert/strict';
import {get} from 'node:http';
import {createWebServer} from '../src/web-server.js';
const bridge={state:async()=>({threadId:'synthetic'} as any),submit:async()=>({}),stop:async()=>{},respond:async()=>{},artifact:async()=>({filename:'x',content:'x'})};
test('local development APIs work without pairing and ignore obsolete connection headers',async()=>{
 const web=await createWebServer({bridge,port:0});try{
  for(const headers of [{},{'X-Homer-Connection':'obsolete',Cookie:'homer=obsolete'}] as Record<string,string>[]){
   const response=await fetch(web.url+'/api/state',{headers});assert.equal(response.status,200);
   assert.equal((await response.json() as any).threadId,'synthetic');assert.equal(response.headers.get('set-cookie'),null);
  }
  const controller=new AbortController();
  const events=await fetch(web.url+'/api/events',{signal:controller.signal});assert.equal(events.status,200);
  assert.match(new TextDecoder().decode((await events.body!.getReader().read()).value),/synthetic/);controller.abort();
  assert.equal((await fetch(web.url+'/api/interactions/synthetic',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'synthetic-decision',text:'拒绝本次操作'})})).status,202);
 }finally{await web.close();}
});
test('old connect bookmarks return to the root with an empty fragment; no exchange remains',async()=>{
 const web=await createWebServer({bridge,port:0});try{
  const response=await fetch(web.url+'/connect',{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/#');
  assert.equal((await fetch(web.url+'/api/connect',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({key:'obsolete'})})).status,404);
  assert.equal('connectionFile' in web,false);
 }finally{await web.close();}
});
test('loopback Host, Origin and cross-site restrictions remain without pairing',async()=>{
 const web=await createWebServer({bridge,port:0});try{
  for(const headers of [{Host:'localhost:'+new URL(web.url).port},{Origin:'https://foreign.invalid'},{'Sec-Fetch-Site':'cross-site'}]){
   const status=await new Promise<number|undefined>((resolve,reject)=>get(web.url+'/api/state',{headers},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(status,403);
  }
  assert.equal((await fetch(web.url+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 }finally{await web.close();}
});

test('SSE does not claim success before its first state is ready',async()=>{
 const web=await createWebServer({bridge:{...bridge,state:async()=>{throw Error('service_not_ready');}},port:0});try{
  const response=await fetch(web.url+'/api/events');assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'service_not_ready'});
 }finally{await web.close();}
});
