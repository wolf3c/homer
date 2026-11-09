// Independent loopback transports and synthetic bridge only; no account/model.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWebServer} from '../src/web-server.js';

const first='a'.repeat(64),second='b'.repeat(64);
const state={threadId:'synthetic-desktop-access',messages:[],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}};
function fixture(){
 const calls:string[]=[];
 const touch=(method:string,value:any={})=>async()=>{calls.push(method);return value;};
 const bridge={submit:touch('submit'),stop:touch('stop'),respond:touch('respond'),
  history:{state:touch('history',state),page:touch('page'),process:touch('process'),resolve:touch('resolve'),receipts:touch('receipts'),queue:touch('queue',[]),interactions:touch('interactions',[])},
  media:{upload:touch('upload',{id:'synthetic-upload'}),read:touch('media',{filename:'synthetic.png',mime:'image/png',data:'eA=='})},
 };
 return {calls,bridge,updateReview:{read:()=>{calls.push('review');return {};},approve:()=>{calls.push('approve');return {};}}};
}
test('development transport without a desktop credential remains usable without pairing',async()=>{
 const f=fixture(),web=await createWebServer({...f,port:0});
 try{
  const response=await fetch(web.url+'/api/history/state',{headers:{Connection:'close'}});
  assert.equal(response.status,200);assert.equal((await response.json() as any).threadId,state.threadId);
  const sent=await fetch(web.url+'/api/messages',{method:'POST',headers:{Connection:'close',Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'synthetic-dev-input',text:'synthetic message'})});
  assert.equal(sent.status,202);await sent.arrayBuffer();assert.ok(f.calls.includes('submit'));
  for(const path of ['/settings/update','/update-review.js','/update-review.css','/api/update/review']){
    const review=await fetch(web.url+path,{headers:{Connection:'close'}});
    assert.equal(review.status,200,path);await review.arrayBuffer();
  }
  const approval=await fetch(web.url+'/api/update/approve',{method:'POST',headers:{Connection:'close',Origin:web.url,'Content-Type':'application/json'},body:'{"hash":"synthetic"}'});
  assert.equal(approval.status,200);await approval.arrayBuffer();
  assert.ok(f.calls.includes('review')&&f.calls.includes('approve'));
 }finally{await web.close();}
});
test('desktop authentication denies every sensitive route before reads, bodies or approvals',async()=>{
 const f=fixture(),web=await createWebServer({...f,desktopAccessToken:first,port:0});
 try{
  for(const [method,path] of [
   ['GET','/api/history/state'],['GET','/api/history/events'],
   ['GET','/api/tasks'],['GET','/api/update/review'],['GET','/api/mobile/state'],
   ['GET','/api/media/synthetic/asset-11111111-1111-4111-8111-111111111111/1'],
   ['POST','/api/uploads'],['POST','/api/messages'],['POST','/api/stop'],['POST','/api/interactions/synthetic'],
   ['POST','/api/update/approve'],['POST','/api/mobile/approve'],['POST','/api/media/synthetic/asset-11111111-1111-4111-8111-111111111111/1/reveal'],
  ]){
   for(const credential of [undefined,'',second,first+', '+first]){
    const response=await fetch(web.url+path,{method,headers:{Connection:'close',Origin:web.url,...(credential===undefined?{}:{'X-Homer-Desktop-Access':credential})}});
    assert.equal(response.status,401,method+' '+path);assert.deepEqual(await response.json(),{error:'web_desktop_auth_required'});
   }
  }
  assert.deepEqual(f.calls,[]);
 }finally{await web.close();}
});
test('authorized desktop reads, events, messages, explicit decisions, uploads and files retain their contracts',async()=>{
 const f=fixture(),web=await createWebServer({...f,desktopAccessToken:first,port:0});
 const headers={'X-Homer-Desktop-Access':first,Origin:web.url,Connection:'close'};
 const post=(path:string,input:unknown)=>fetch(web.url+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  const response=await fetch(web.url+'/api/history/state',{headers});assert.equal(response.status,200);assert.equal((await response.json() as any).threadId,state.threadId);
  assert.equal(response.headers.get('set-cookie'),null);
  const controller=new AbortController();
  try{const events=await fetch(web.url+'/api/history/events',{headers,signal:controller.signal});assert.equal(events.status,200);assert.match(new TextDecoder().decode((await events.body!.getReader().read()).value),/synthetic-desktop-access/);}finally{controller.abort();}
  assert.equal((await post('/api/messages',{requestId:'synthetic-input',text:'synthetic message'})).status,202);
  assert.equal((await post('/api/interactions/synthetic',{requestId:'synthetic-decision',text:'拒绝本次操作'})).status,202);
  for(const path of ['/settings/update','/update-review.js','/update-review.css','/api/update/review']){
    const unavailable=await fetch(web.url+path,{headers});
    assert.equal(unavailable.status,404,path);await unavailable.arrayBuffer();
  }
  assert.equal((await post('/api/update/approve',{hash:'synthetic'})).status,404);
  const upload=await fetch(web.url+'/api/uploads',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':'1','X-Homer-Filename':'synthetic.txt','X-Homer-Thread':state.threadId,'X-Homer-Request':'synthetic-input','X-Homer-Upload':'synthetic-upload'},body:'x'});
  assert.equal(upload.status,201);await upload.arrayBuffer();
  const media=await fetch(web.url+'/api/media/synthetic/asset-11111111-1111-4111-8111-111111111111/1',{headers});assert.equal(media.status,200);await media.arrayBuffer();
  assert.ok(['history','submit','respond','upload','media'].every(name=>f.calls.includes(name)));
  assert.ok(!f.calls.includes('review')&&!f.calls.includes('approve'));
  const forbidden=await fetch(web.url+'/api/history/state',{headers:{...headers,Origin:'https://foreign.invalid'}});assert.equal(forbidden.status,403);await forbidden.arrayBuffer();
 }finally{await web.close();}
});
test('desktop credentials do not authorize another gateway and public preview never sets a credential cookie',async()=>{
 const f=fixture(),a=await createWebServer({...f,desktopAccessToken:first,port:0}),b=await createWebServer({...f,desktopAccessToken:second,port:0});
 try{
  const denied=await fetch(b.url+'/api/history/state',{headers:{'X-Homer-Desktop-Access':first,Connection:'close'}});assert.equal(denied.status,401);await denied.arrayBuffer();
  const preview=await fetch(a.url+'/preview/interactive',{headers:{Connection:'close'}});assert.equal(preview.status,200);assert.equal(preview.headers.get('set-cookie'),null);assert.equal((await preview.text()).includes(first),false);
  const response=await fetch(a.url+'/api/history/state',{headers:{Cookie:'homer='+first,Connection:'close'}});assert.equal(response.status,401);await response.arrayBuffer();
 }finally{await a.close();await b.close();}
});
test('malformed explicit desktop credentials fail setup instead of opening an unauthenticated listener',async()=>{
 for(const desktopAccessToken of ['',null,'short','A'.repeat(64)] as any[])
  await assert.rejects(createWebServer({bridge:fixture().bridge,desktopAccessToken,port:0}),/desktop_access_invalid/);
});
