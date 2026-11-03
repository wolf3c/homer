import {test} from 'node:test';import assert from 'node:assert/strict';import {createWebServer} from '../src/web-server.js';
const bridge={state:async()=>({threadId:'synthetic'} as any),submit:async()=>({}),stop:async()=>{},respond:async()=>{},artifact:async()=>({filename:'x',content:'x'})};
test('forged browser headers alone cannot read state or submit a user approval',async()=>{
 const web=await createWebServer({bridge,port:0});try{
 assert.equal((await fetch(web.url+'/api/state')).status,401);
 assert.equal((await fetch(web.url+'/api/interactions/synthetic',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'forged',text:'允许本次操作'})})).status,401);
 }finally{await web.close();}
});

test('private one-use connection authenticates API and expires with gateway',async()=>{
 const {readFileSync,existsSync}=await import('node:fs');
 const web=await createWebServer({bridge,port:0});
 try{
  const key=readFileSync(web.connectionFile,'utf8').match(/\/connect#([\w-]+)/)![1];
  const connect=()=>fetch(web.url+'/api/connect',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({key})});
  const result=await connect();assert.equal(result.status,200);assert.equal(result.headers.get('set-cookie'),null);
  const {connection}=await result.json() as {connection:string};assert.equal(existsSync(web.connectionFile),false);
  assert.equal((await connect()).status,409);
  assert.equal((await fetch(web.url+'/api/state',{headers:{'X-Homer-Connection':connection}})).status,200);
  assert.equal((await fetch(web.url+'/api/state',{headers:{Cookie:'homer='+connection}})).status,401);
  const other=await createWebServer({bridge,port:0});try{assert.equal((await fetch(other.url+'/api/state',{headers:{'X-Homer-Connection':connection}})).status,401);}finally{await other.close();}
 }finally{await web.close();}
});
