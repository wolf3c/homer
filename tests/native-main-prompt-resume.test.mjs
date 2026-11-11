import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,truncateSync} from 'node:fs';
import {sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,metadata,peer,tools} from './fixtures/native-main-resume.mjs';

const histories=[
 ['full','with full history'],
 ['compacted','after prior compaction'],
 ['interrupted','after an interrupted context checkpoint'],
 ['compact-first','when compaction runs first after an interrupted context checkpoint'],
];
for(const [mode,description] of histories)test(`Main cold resume adopts the new developer instructions ${description}`,{timeout:60000},async t=>{
 const f=fixture(t);
 const hostFooter=`\n默认工作目录：${f.cwd}。Worker 可选择获准的项目目录。`;
 const originalMarker='SYNTHETIC_HOMER_MAIN_A',currentMarker='SYNTHETIC_HOMER_MAIN_B';
 const original=originalMarker+hostFooter,current=currentMarker+hostFooter;
 const oldMessage='Synthetic original user message';
 const namespaceHint='Synthetic developer hint for a tool namespace';
 const full=mode==='full';
 const compactFirst=mode==='compact-first';
 const interrupted=mode==='interrupted'||compactFirst;
 const requests=[];
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/responses')return res.writeHead(404).end();
  let body='';
  for await(const chunk of req)body+=chunk;
  const data=JSON.parse(body);
  requests.push(data);
  const id=String(requests.length);
  const item={id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic assistant message '+id,annotations:[]}]};
  const response={id:'resp-'+id,object:'response',created_at:1,model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.setHeader('Content-Type','text/event-stream');
  for(const event of [
   {type:'response.created',response:{...response,status:'in_progress',output:[]}},
   {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
   {type:'response.output_item.done',output_index:0,item},
   {type:'response.completed',response},
  ])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
  res.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
 let engine;

 async function open(bin,developerInstructions,threadId){
  await engine?.close();
  const count=requests.length;
  engine=peer(f,bin,baseUrl);
  await engine.init();
  const {thread}=await engine.request(threadId?'thread/resume':'thread/start',{
   model:'gpt-6.1-sol',modelProvider:'synthetic_boundary',cwd:f.cwd,approvalPolicy:'on-request',
   sandbox:'read-only',environments:[],config:{mcp_servers:{}},developerInstructions,
   ...(threadId?{threadId,excludeTurns:true}:{dynamicTools:tools}),
  });
  if(threadId)assert.equal(thread.id,threadId);
  assert.equal(requests.length,count,'opening a thread must not make a model request');
  return thread.id;
 }

 async function complete(threadId,cursor,turnId){
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){
   const event=engine.events.slice(cursor).find(e=>e.method==='turn/completed'&&e.params.threadId===threadId&&(!turnId||e.params.turn.id===turnId));
   if(event){assert.equal(event.params.turn.status,'completed');return;}
   await delay(20);
  }
  assert.fail('native turn did not complete');
 }

 async function turn(threadId,text){
  const cursor=engine.events.length,count=requests.length;
  const {turn}=await engine.request('turn/start',{threadId,input:[{type:'text',text}]});
  await complete(threadId,cursor,turn.id);
  assert.equal(requests.length,count+1);
  return requests[count].input;
 }

 async function compact(threadId){
  const cursor=engine.events.length,count=requests.length;
  await engine.request('thread/compact/start',{threadId});
  await complete(threadId,cursor);
  assert.ok(engine.events.slice(cursor).some(e=>e.method==='item/completed'&&e.params.item.type==='contextCompaction'));
  assert.equal(requests.length,count+1);
  return requests[count].input;
 }

 function checkPrompt(input,wanted){
  const parts=input.filter(item=>item.role==='developer').flatMap(item=>item.content??[]);
  const developer=parts.map(part=>part.text??'').join('\n');
  const counts=[originalMarker,currentMarker].map(marker=>developer.split(marker).length-1);
  assert.deepEqual(counts,wanted===current?[0,1]:[1,0],'number of old and current developer instruction blocks');
 }

 try{
  const threadId=await open(process.env.HOMER_TEST_CODEX_BASELINE_BIN??f.bin,original);
  const seed=await turn(threadId,oldMessage);
  checkPrompt(seed,original);
  const {attachment}=await engine.request('thread/attachment/add',{
   threadId,attachmentType:'synthetic.document',identityKey:'original-artifact',payload:{name:'fixture.txt',contents:'synthetic attachment'},
  });
  if(full)await engine.request('thread/inject_items',{threadId,items:[{
   type:'message',role:'developer',content:[{type:'input_text',text:namespaceHint}],
   internal_chat_message_metadata_passthrough:{content_item_kinds:['generic.developer_instructions']},
  }]});
  else if(!interrupted)await compact(threadId);
  const before=(await engine.request('thread/read',{threadId,includeTurns:true})).thread;
  assert.ok(before.path.startsWith(f.home+sep));
  let originalRollout=readFileSync(before.path);
  if(interrupted){
   await engine.close();engine=undefined;
   // Reproduce the durable prefix after context messages were appended and before TurnContext.
   const lines=originalRollout.toString('utf8').trimEnd().split('\n');
   const checkpoint=lines.findIndex(line=>JSON.parse(line).type==='turn_context');
   assert.ok(checkpoint>0);
   const prefix=lines.slice(0,checkpoint);
   assert.ok(prefix.map(line=>JSON.parse(line)).some(line=>line.type==='response_item'&&line.payload.content?.some(part=>part.text===original)));
   originalRollout=Buffer.from(prefix.join('\n')+'\n');
   truncateSync(before.path,originalRollout.length);
  }

  await open(f.bin,current,threadId);
  if(compactFirst)checkPrompt(await compact(threadId),current);
  const resumed=await turn(threadId,'Synthetic first resumed user message');
  checkPrompt(resumed,current);
  if(full){
   const beforeBundle=seed.find(item=>item.role==='developer'&&item.content?.some(part=>part.text===original));
   const afterBundle=resumed.find(item=>item.role==='developer'&&item.content?.some(part=>part.text===current));
   assert.ok(beforeBundle.content.length>1,'seed should bundle adjacent developer context');
   assert.deepEqual(afterBundle.content,beforeBundle.content.map(part=>part.text===original?{...part,text:current}:part));
   assert.ok(resumed.some(item=>item.role==='developer'&&item.content?.some(part=>part.text===namespaceHint)));
   assert.ok(resumed.some(item=>item.role==='user'&&JSON.stringify(item.content).includes(oldMessage)));
   assert.ok(resumed.some(item=>item.role==='assistant'&&JSON.stringify(item.content).includes('Synthetic assistant message 1')));
  }
  const after=(await engine.request('thread/read',{threadId,includeTurns:true})).thread;
  assert.equal(after.path,before.path);
  if(!interrupted)assert.ok(JSON.stringify(after.turns).includes(oldMessage));
  assert.deepEqual(metadata(f,after.path).dynamic_tools,tools);
  assert.deepEqual((await engine.request('thread/attachment/list',{threadId})).data,[attachment]);
  assert.ok(readFileSync(after.path).subarray(0,originalRollout.length).equals(originalRollout),'saved rollout prefix must be intact');

  await open(f.bin,current,threadId);
  checkPrompt(await turn(threadId,'Synthetic restart before compaction'),current);
  await compact(threadId);
  checkPrompt(await turn(threadId,'Synthetic message after compaction'),current);
  await open(f.bin,current,threadId);
  checkPrompt(await turn(threadId,'Synthetic restart after compaction'),current);
  if(full)checkPrompt(await turn(await open(f.bin,current),'Synthetic fresh current thread'),current);
 }finally{
  try{await engine?.close();}
  finally{
   server.closeAllConnections();
   await new Promise(resolve=>server.close(resolve));
  }
 }
});
