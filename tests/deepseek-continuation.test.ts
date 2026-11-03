import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {CodexEngine} from '../src/engine.js';
import {createSession} from '../scripts/deepseek-isolated.mjs';

// Real pinned process, synthetic Responses only. No credentials or upstream API.
for(const role of ['main','worker'] as const)test(`pinned DeepSeek ${role}: compact, continue, cold resume and explicit failure`,async()=>{
 const session=createSession();let sequence=0,fail=false,requests=0;
 const server=createServer(async(req,res)=>{
  for await(const _chunk of req){/* Consume synthetic input without retaining it. */}
  requests++;const id='synthetic-response-'+(++sequence);
  const events=fail
   ?[{type:'response.created',response:{id}},{type:'response.failed',response:{id,status:'failed',error:{code:'invalid_request_error',message:'Synthetic explicit provider failure.'}}}]
   :[{type:'response.created',response:{id}},{type:'response.output_item.done',item:{type:'message',id:'synthetic-message-'+sequence,role:'assistant',content:[{type:'output_text',text:'Synthetic continuation evidence.'}]}},{type:'response.completed',response:{id,usage:{input_tokens:12,output_tokens:4,total_tokens:16}}}];
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
 });
 await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));
 const config={...session.config,baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1',keyEnv:undefined,stopGraceMs:1000};
 const options={role,cwd:config.workspace,readRoots:[],instructions:'Offline synthetic continuation acceptance only.',tools:[],nativeCapabilities:true,nativeTools:role};
 let engine=new CodexEngine(config,options,async()=>({}));
 const timer=setTimeout(()=>void engine.close(),45000);
 try{
  const threadId=await engine.start();
  assert.equal((await engine.turn('Synthetic first turn.')).status,'completed');
  let compacted=0;engine.on('contextCompaction',event=>{if(event.state==='completed')compacted++;});
  await engine.compact();assert.equal(compacted,1);
  assert.equal((await engine.turn('Synthetic turn after compaction.')).status,'completed');
  assert.equal(await engine.close(),true);
  engine=new CodexEngine(config,{...options,threadId},async()=>({}));
  assert.equal(await engine.start(),threadId);
  assert.equal((await engine.turn('Synthetic cold-resumed turn.')).status,'completed');
  fail=true;
  const result=await engine.turn('Synthetic explicit failure turn.');
  assert.equal(result.status,'failed');assert.equal(engine['active'],undefined);
  assert.ok(requests>=5);
 }finally{clearTimeout(timer);await engine.close();await new Promise<void>(accept=>server.close(()=>accept()));}
});
