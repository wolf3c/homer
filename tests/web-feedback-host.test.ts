import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {homerWebBridge} from '../src/web-homer.js';
import {DatabaseSync} from 'node:sqlite';
import {ConversationHistory} from '../src/web-history.js';

// Evaluate the exact production forwarding closures without starting a host or
// replacing its process identity lock. The full isolated launch is in the development suite.
function productionNode(file:string,predicate:(node:ts.Node)=>boolean){
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 let found:ts.Node|undefined;
 const visit=(node:ts.Node)=>{if(predicate(node))found=node;else ts.forEachChild(node,visit);};visit(source);
 assert.ok(found,`missing production forwarding node in ${file}`);return found.getText(source);
}
test('actual gateway bridge and host web dispatch preserve feedback arguments and result',async()=>{
 const binding=productionNode('scripts/dev.mjs',n=>ts.isPropertyAssignment(n)&&n.name.getText()==='feedback'&&ts.isArrowFunction(n.initializer)&&ts.isObjectLiteralExpression(n.parent)&&ts.isPropertyAssignment(n.parent.parent)&&n.parent.parent.name.getText()==='bridge').replace(/^feedback\s*:/,'');
 const calls:unknown[]=[];const result={messageId:'assistant-1',value:'down'};
 const app={registerWebSurface:()=>{},history:{feedback:(...args:unknown[])=>{calls.push(args);if(args[1]==='unknown-message')throw Error('feedback_message_not_found');return result;}},store:{meta:()=> 'thread-1'}};
 const receive=productionNode('src/dev-host.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='receive');
 const js=ts.transpileModule(receive,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let response:any;const dispatch=new Function('app','frozen','stopping','homerWebBridge','send','engineError','webUploadProtocol','nativeCapabilitiesProtocol','desktop',`${js};return receive;`)(app,false,false,homerWebBridge,(m:unknown)=>{response=m;},(e:Error)=>e.message,false,false,false);
 const invokeWeb=async(method:string,input:unknown)=>{await dispatch({kind:'web',id:'receipt-1',method,input});if(response.error)throw Error(response.error);return response.value;};
 const feedback=new Function('invokeWeb',`return (${binding});`)(invokeWeb);
 assert.equal(typeof feedback,'function','launcher must bind feedback');
 assert.deepEqual(await feedback('assistant-1','down'),result);
 assert.deepEqual(calls,[['thread-1','assistant-1','down']]);
 assert.equal(response.id,'receipt-1');
 await assert.rejects(feedback('unknown-message','up'),/feedback_message_not_found/);
 assert.deepEqual(calls.at(-1),['thread-1','unknown-message','up']);
});

test('running gateway sends feedback IPC with the original payload and returns its receipt',async()=>{
 const invoke=productionNode('scripts/dev.mjs',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='invokeWeb').replace(/^invokeWeb\s*=/,'');
 const requests=new Map();const sent:unknown[]=[];
 const send=(m:any)=>{sent.push(m);const request=requests.get(m.id);clearTimeout(request.timeout);requests.delete(m.id);request.accept({messageId:m.input.messageId,value:m.input.value});return true;};
 const invokeWeb=new Function('phase','stopped','child','send','randomUUID','webRequests','desktop',`return (${invoke});`)('running',false,{connected:true},send,()=> 'feedback-ipc-1',requests,false);
 for(const value of ['up','down',null]){
  assert.deepEqual(await invokeWeb('feedback',{messageId:'assistant-1',value}),{messageId:'assistant-1',value});
  assert.deepEqual(sent.at(-1),{kind:'web',id:'feedback-ipc-1',method:'feedback',input:{messageId:'assistant-1',value}});
 }
 assert.equal(requests.size,0);
});

test('feedback mutation is rejected during gateway handoff and frozen host dispatch',async()=>{
 const invoke=productionNode('scripts/dev.mjs',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='invokeWeb').replace(/^invokeWeb\s*=/,'');
 let sends=0;const invokeWeb=new Function('phase','stopped','child','send','desktop',`return (${invoke});`)('preparing',false,{connected:true},()=>{sends++;},false);
 await assert.rejects(invokeWeb('feedback',{messageId:'assistant-1',value:'up'}),/service_upgrading/);assert.equal(sends,0);
 const receive=productionNode('src/dev-host.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='receive');
 const js=ts.transpileModule(receive,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let response:any;const dispatch=new Function('app','frozen','stopping','send','engineError',`${js};return receive;`)({},true,false,(m:unknown)=>{response=m;},(e:Error)=>e.message);
 await dispatch({kind:'web',id:'frozen-1',method:'feedback',input:{messageId:'assistant-1',value:'up'}});assert.equal(response.error,'service_upgrading');
});

// Check history identity fences directly; the complete HTTP/IPC round trip is
// retained in web-feedback-host.development.test.ts.
test('feedback history fences thread and assistant identity without redirecting ratings',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const history=new ConversationHistory(db);history.record('public-final','current-thread','合成公开答复');history.record('foreign-final','other-thread','合成其他线程');
  const input=history.accept('current-thread',{requestId:'request',text:'合成用户输入'});
  history.feedback('current-thread','public-final','down');
  for(const id of ['foreign-final','absent',history.list('current-thread').find(m=>m.role==='user')!.id])assert.throws(()=>history.feedback('current-thread',id,'up'),/feedback_message_not_found/);
  assert.throws(()=>history.feedback('current-thread','public-final','invalid'),/invalid_feedback/);
  assert.equal(history.list('current-thread').find(m=>m.id==='public-final')?.feedback,'down');
  assert.equal(history.list('current-thread').find(m=>m.id===input.replyId)?.feedback,null);
  assert.equal(history.list('other-thread')[0]?.feedback,null);
 }finally{db.close();}
});

test('browser fixture declares the native final phase before streaming and on completion', {timeout:10000}, async t=>{
 const child=spawn(process.execPath,['tests/fixtures/web-browser-app-server.mjs'],{stdio:['pipe','pipe','pipe']});
 t.after(()=>child.kill('SIGTERM'));
 const events:any[]=[];let lines='';
 const finished=new Promise<void>((accept,reject)=>{
  child.on('error',reject);child.on('exit',code=>reject(Error('synthetic_peer_exited:'+code)));
  child.stdout.on('data',data=>{lines+=data;const parts=lines.split('\n');lines=parts.pop()!;for(const line of parts){const event=JSON.parse(line);events.push(event);if(event.method==='turn/completed')accept();}});
 });
 child.stdin.write(JSON.stringify({id:1,method:'thread/start',params:{cwd:resolve('.')}})+'\n');
 child.stdin.write(JSON.stringify({id:2,method:'turn/start',params:{input:[{type:'text',text:'合成反馈测试'}]}})+'\n');
 await finished;
 const start=events.findIndex(event=>event.method==='item/started'&&event.params.item.type==='agentMessage');
 const delta=events.findIndex(event=>event.method==='item/agentMessage/delta');
 const end=events.find(event=>event.method==='item/completed'&&event.params.item.type==='agentMessage');
 assert.ok(start>=0&&start<delta,'native item phase must be known before its first delta');
 assert.equal(events[start].params.item.phase,'final_answer');assert.equal(end.params.item.phase,'final_answer');
 assert.equal(end.params.item.id,events[start].params.item.id);assert.equal(events[delta].params.itemId,end.params.item.id);
});
