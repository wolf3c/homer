import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,cpSync,symlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
// @ts-expect-error synthetic fixture has no declaration file
import {syntheticUserFetch} from './web-user-connection.mjs';
// @ts-expect-error synthetic fixture has no declaration file
import {waitForDevCondition} from './fixtures/dev-condition.mjs';
test('dev gateway forwards unpaired public-final feedback through real host IPC with origin fencing', {timeout:120000}, async t=>{
 const root=resolve('.'),parent=join(root,'.codex/scratch/linear-conversation-timeline-review/feedback-runtime');mkdirSync(parent,{recursive:true});
 const base=mkdtempSync(join(parent,'web-feedback-'));
 let db:DatabaseSync|undefined,completed=false,exited=false;
 t.after(()=>{db?.close();if(completed&&exited)rmSync(base,{recursive:true,force:true});});
 for(const name of ['src','scripts','prompts','assets','ui','package.json','package-lock.json','tsconfig.json'])cpSync(join(root,name),join(base,name),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path)});
 symlinkSync(join(root,'node_modules'),join(base,'node_modules'),'dir');
 for(const name of ['home','runtime','workspace/materials'])mkdirSync(join(base,name),{recursive:true});
 const binary=join(base,'synthetic-codex.mjs');cpSync(join(root,'tests/fixtures/web-browser-app-server.mjs'),binary);
 const config=join(base,'synthetic.config.json');writeFileSync(config,JSON.stringify({appData:base,workspace:'workspace',runtime:'runtime',nativeCodexHome:join(base,'home'),codexBin:binary,model:'synthetic-only',requiresOpenaiAuth:false,effort:'medium',timeoutMs:30000,mainTimeoutMs:120000,stopGraceMs:200}));
 const reserve=createServer();await new Promise<void>(r=>reserve.listen(0,'127.0.0.1',r));const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
 const url=`http://127.0.0.1:${port}`,fetch=syntheticUserFetch();
 const env={...process.env,HOMER_DATA_HOME:base,HOMER_NATIVE_CODEX_HOME:join(base,'home'),HOMER_CODEX_HOME:join(base,'home'),HOMER_CODEX_BIN:binary};
 const child=spawn(process.execPath,[join(base,'scripts/dev.mjs'),'--web','--port',String(port),'--config',config,'--json'],{cwd:base,env,stdio:['pipe','pipe','pipe']});
 let lines='',stderr='';const events:any[]=[];
 child.stdout.on('data',data=>{lines+=data;const parts=lines.split('\n');lines=parts.pop()!;for(const line of parts){try{events.push(JSON.parse(line));}catch{}}});
 child.stderr.on('data',data=>{stderr+=data;});child.on('exit',()=>{exited=true;});
 const state=async()=>{try{return await(await fetch(url+'/api/state')).json();}catch{return undefined;}};
 const post=(body:unknown,origin=url)=>fetch(url+'/api/messages/feedback',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const until=(check:()=>Promise<boolean>)=>waitForDevCondition(check,{signal:t.signal,events,exited:()=>exited});
 try{
  await until(async()=>(await state())?.upgrade?.phase==='running');
  const input=await fetch(url+'/api/messages',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'feedback-prime',text:'合成反馈测试'})});assert.equal(input.status,202);
  const receipt=await input.json() as {replyId:string};
  // The receipt identifies the original request slot, not a public processing
  // segment. Resolve that existing relationship; do not choose the last reply.
  let node:any;
  await until(async()=>{
   const current=await state();node=current?.processNodes?.find((n:any)=>n.replyMessageId===receipt.replyId);
   return node?.state==='worked'&&node.status==='completed'&&!!node.final?.text;
  });
  const visible=(await state()).messages.find((m:any)=>m.id===node.messageId);
  assert.ok(visible,'the rated final must be an actual public history message');
  assert.equal(visible.text,node.final.text);assert.equal(visible.status,'completed');assert.equal(visible.requestId,'feedback-prime');
  assert.notEqual(node.messageId,receipt.replyId);assert.notEqual(node.messageId,node.final.id);
  assert.equal((await state()).messages.some((m:any)=>m.id===receipt.replyId),false,'managed receipt slot stays hidden');
  const body={messageId:visible.id,value:'up'};
  db=new DatabaseSync(join(base,'runtime/homer.sqlite'),{readOnly:true});db.exec('PRAGMA query_only=ON');
  const saved=()=>db!.prepare('SELECT value FROM conversation_feedback WHERE messageId=?').get(visible.id)?.value??null;
  assert.equal(saved(),null);
  assert.equal((await post(body,'http://foreign.invalid')).status,403);
  assert.equal(saved(),null,'rejected requests cannot write feedback');
  assert.equal((await globalThis.fetch(url+'/api/messages/feedback',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify(body)})).status,200,'local feedback works without pairing');
  for(const value of ['up','down',null]){
   const response=await post({...body,value});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
   assert.deepEqual(result,{messageId:visible.id,value});
   assert.equal((await state()).messages.find((m:any)=>m.id===visible.id)?.feedback,value,'GET state rereads the rated public row');
   assert.equal(saved(),value,'HTTP and IPC must persist feedback on the same history identity');
   assert.equal((await post({...body,value:'invalid'})).status,409);
   assert.equal((await post(body,'http://foreign.invalid')).status,403);
   assert.equal(saved(),value,'invalid input or Origin cannot replace a confirmed rating');
  }
  // Invalid payloads use the shared Web transport's 409/error-code contract.
  // A rejected rating must leave the last confirmed feedback unchanged.
  const invalid=await post({...body,value:'invalid'});assert.equal(invalid.status,409);
  assert.deepEqual(await invalid.json(),{error:'invalid_feedback'});
  assert.equal((await state()).messages.find((m:any)=>m.id===visible.id)?.feedback,null);assert.equal(saved(),null);
  for(const messageId of ['unknown-message',node.final.id,(await state()).messages.find((m:any)=>m.role==='user').id]){
   const missing=await post({...body,messageId});assert.equal(missing.status,409,'unknown item IDs and user messages cannot be rated');
   assert.deepEqual(await missing.json(),{error:'feedback_message_not_found'});
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM conversation_feedback').get()?.count,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM conversation_feedback WHERE messageId=?').get(receipt.replyId)?.count,0,'the hidden original slot was never the target');
  completed=true;
 }finally{
  child.kill('SIGINT');for(let i=0;i<100&&!exited;i++)await delay(20);if(!exited)child.kill('SIGTERM');
  if(stderr)t.diagnostic(stderr);t.diagnostic(JSON.stringify({fixture:completed&&exited?'temporary fixture':base,progress:events.filter(e=>e.type==='progress').map(e=>e.text)}));
 }
});
