import {test} from 'node:test';import assert from 'node:assert/strict';
import type {WebBridge} from '../src/web-contract.js';
import {createWebChat} from '../src/web-chat.js';
function fixture(){
 const calls:{op:string;input:unknown}[]=[];
 const record=(op:string)=>(input:unknown)=>{calls.push({op,input});return Promise.resolve({accepted:true});};
 const bridge={submit:record('submit'),stop:record('stop'),respond:async(id:string,input:unknown)=>record('respond')({id,input}),history:{state:async()=>({}),page:record('page'),receipts:record('receipts')},media:{upload:record('upload')}} as unknown as WebBridge;
 return {calls,chat:createWebChat(bridge)};
}
test('shared chat handler preserves request identity and uses the existing message validator',async()=>{
 const {chat,calls}=fixture();
 await chat('messages.submit',{requestId:'same-request',text:'synthetic',extra:'ignored'});
 assert.deepEqual(calls,[{op:'submit',input:{requestId:'same-request',text:'synthetic'}}]);
 await assert.rejects(chat('messages.submit',{requestId:'not valid',text:'synthetic'}),/invalid_message/);assert.equal(calls.length,1);
 await chat('interactions.respond',{id:'question-1',input:{requestId:'answer-1',text:'answer'}});
 assert.deepEqual(calls.at(-1),{op:'respond',input:{id:'question-1',input:{requestId:'answer-1',text:'answer'}}});
});
test('history uses the original scope validation and passes the same receipt ids',async()=>{
 const {chat,calls}=fixture();
 await assert.rejects(chat('history.page',{readEpoch:'epoch',request:{unknown:true}}),/history_request_invalid/);assert.equal(calls.length,0);
 await chat('history.page',{readEpoch:'epoch',request:{limit:20,before:'position'}});
 await chat('history.receipts',{requestIds:['same-request'],threadId:'thread',readEpoch:'epoch'});
 assert.deepEqual(calls.map(v=>v.op),['page','receipts']);
 assert.deepEqual(calls.at(-1)?.input,{requestIds:['same-request'],threadId:'thread',readEpoch:'epoch'});
});
test('mobile chat operations exclude management and reuse upload validation',async()=>{
 const {chat,calls}=fixture();
 for(const op of ['channels.wechat.login','settings.update','files.reveal','constructor'])await assert.rejects(chat(op,{}),/route_not_found/);
 const upload={threadId:'thread',requestId:'draft',uploadId:'upload',filename:'test.txt',data:Buffer.from('synthetic file').toString('base64')};
 await chat('media.upload',upload);assert.deepEqual(calls,[{op:'upload',input:upload}]);
 await assert.rejects(chat('media.upload',{...upload,data:'not base64'}),/web_upload_invalid/);assert.equal(calls.length,1);
});

test('draft image preview reuses the existing scoped owner and rejects unsupported media',async()=>{
 const calls:unknown[]=[];let mime='image/png';
 const chat=createWebChat({media:{previewDraft:async(input:unknown)=>{calls.push(input);return {mime,data:'eA=='};}}} as unknown as WebBridge);
 const scope={threadId:'thread',requestId:'draft',assetId:'asset-00000000-0000-0000-0000-000000000000',revision:1};
 assert.deepEqual(await chat('media.preview',scope),{mime:'image/png',data:'eA=='});
 assert.deepEqual(calls,[scope]);
 mime='text/html';await assert.rejects(chat('media.preview',scope),/media_preview_unavailable/);
});

test('execution reads identify only the task and run and reject extra scope fields',async()=>{
 const calls:unknown[]=[];
 const chat=createWebChat({taskOverview:{execution:async(selector:unknown,before:unknown)=>{calls.push({selector,before});return {items:[]};},call:async()=>({})}} as unknown as WebBridge);
 await chat('tasks.execution',{taskId:'task-one',runId:'run-one',before:'page'});
 assert.deepEqual(calls,[{selector:{taskId:'task-one',runId:'run-one'},before:'page'}]);
 await assert.rejects(chat('tasks.execution',{taskId:'task-one',runId:'run-one',rootTaskId:'task-other'}),/task_execution_invalid/);
 await assert.rejects(chat('tasks.execution',{taskId:'../task-one',runId:'run-one'}),/task_execution_invalid/);
 assert.equal(calls.length,1);
});

test('device media reads forward the exact selector and only allow voice preview on the read',async()=>{
 const calls:unknown[]=[];
 const read=async(input:unknown)=>{calls.push(input);return {mime:'audio/wav',data:'eA=='};};
 const chat=createWebChat({media:{read,origin:read}} as unknown as WebBridge);
 const ref={messageId:'message-one',assetId:'asset-00000000-0000-0000-0000-000000000000',revision:3};
 await chat('media.read',ref);
 await chat('media.read',{...ref,preview:'voice'});
 await assert.rejects(chat('media.read',{...ref,preview:'html'}),/media_request_invalid/);
 await assert.rejects(chat('media.origin',{...ref,preview:'voice'}),/media_request_invalid/);
 await assert.rejects(chat('media.read',{...ref,preview:'voice',path:'/etc/hosts'}),/media_request_invalid/);
 assert.deepEqual(calls,[ref,{...ref,preview:'voice'}]);
});
