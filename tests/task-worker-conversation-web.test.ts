import {test} from 'node:test';import assert from 'node:assert/strict';import {createWebServer,fetch} from './web-connected-fixture.js';import {createWebChat} from '../src/web-chat.js';
import type {WorkerConversationQuery} from '../src/task-overview.js';
test('HTTP Worker selectors forward only exact path pagination to the existing detail owner',async()=>{
 const seen:unknown[]=[],bridge:any={taskOverview:{detail:async(id:string,query?:WorkerConversationQuery)=>{seen.push({id,query});return {taskId:id,runs:[],conversation:{workerId:query?.workerId,messages:[]}};}}},web=await createWebServer({port:0,bridge});
 try{
  const base=web.url+'/api/tasks/task/workers/worker';for(const path of [base,base+'/after/20',base+'/messages/message/24000']){const response=await fetch(path);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/no-store/);}
  assert.deepEqual(seen,[{id:'task',query:{workerId:'worker'}},{id:'task',query:{workerId:'worker',after:20}},{id:'task',query:{workerId:'worker',messageId:'message',offset:24000}}]);assert.equal((await fetch(base+'?after=20')).status,400);assert.equal(seen.length,3);
 }finally{await web.close();}
});
test('native and RTC detail reads forward bounded Worker pagination and reject unrelated fields',async()=>{
 const seen:unknown[]=[],chat=createWebChat({taskOverview:{detail:async(id:string,query?:WorkerConversationQuery)=>{seen.push({id,query});return {taskId:id,runs:[]};}}} as any);
 await chat('tasks.detail',{id:'task',workerId:'worker',after:20});await chat('tasks.detail',{id:'task',workerId:'worker',messageId:'message',offset:24000});assert.deepEqual(seen,[{id:'task',query:{workerId:'worker',after:20}},{id:'task',query:{workerId:'worker',messageId:'message',offset:24000}}]);
 for(const input of [{id:'task',workerId:'worker',after:-1},{id:'task',workerId:'worker',offset:0},{id:'task',workerId:'worker',messageId:'message',after:1},{id:'task',workerId:'worker',path:'/private'}])await assert.rejects(chat('tasks.detail',input),/task_overview_invalid|worker_query_invalid/);
 assert.equal(seen.length,2);
});
