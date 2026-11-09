import {request} from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWebServer,fetch} from './web-connected-fixture.js';
import type {WebBridge} from '../src/web-contract.js';
test('task overview routes require loopback Host/Origin, offer GET only and never invoke snapshot/state or mutation paths',async()=>{
 let lists=0,details=0,summaries=0,origins=0;
 const denied=async()=>{throw Error('forbidden_call');};
 const bridge:WebBridge={submit:denied,stop:denied,respond:denied,taskOverview:{list:async()=>{lists++;return {tasks:[]};},detail:async id=>{details++;return {taskId:id,runs:[]};},summary:async id=>{summaries++;return {taskId:id,runs:[],artifacts:[]};},origin:async()=>{origins++;throw Error('task_origin_not_found');}}};
 const server=await createWebServer({bridge,port:0});
 try{
  const local=await globalThis.fetch(server.url+'/api/tasks');assert.equal(local.status,200,'loopback read needs no pairing');
  assert.equal((await fetch(server.url+'/api/tasks',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.deepEqual(await local.json(),{tasks:[]});
  const deniedHost=await new Promise<number|undefined>((accept,reject)=>{const req=request(server.url+'/api/tasks',{headers:{Host:'untrusted.example'}},response=>{response.resume();response.on('end',()=>accept(response.statusCode));});req.on('error',reject);req.end();});
  assert.equal(deniedHost,403,'raw HTTP verifies Host without fetch rewriting it');
  assert.deepEqual(await (await fetch(server.url+'/api/tasks/task-synthetic')).json(),{taskId:'task-synthetic',runs:[]});
  assert.equal((await fetch(server.url+'/api/tasks/task-synthetic?path=elsewhere')).status,400);
  assert.equal((await fetch(server.url+'/api/tasks',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:'{}'})).status,404);
  assert.equal(lists,1);assert.equal(details,1);
  assert.deepEqual(await (await fetch(server.url+'/api/tasks/task-synthetic/summary')).json(),{taskId:'task-synthetic',runs:[],artifacts:[]});
  assert.equal((await fetch(server.url+'/api/tasks/task-synthetic/origin/message-synthetic')).status,409);
  assert.equal((await fetch(server.url+'/api/tasks/task-synthetic/summary',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(server.url+'/api/tasks/task-synthetic/origin/message-synthetic?path=elsewhere')).status,400);
  assert.equal((await fetch(server.url+'/api/tasks/task-synthetic/summary',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:'{}'})).status,404);
  assert.equal(summaries,1);assert.equal(origins,1);
 }finally{await server.close();}
});
