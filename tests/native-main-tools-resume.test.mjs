import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,metadata,peer,tools} from './fixtures/native-main-resume.mjs';
const {mainToolsForHash}=await import(new URL('./recursive-tools.js',process.env.HOMER_TEST_SERVICE_MODULE));

const toolsHash=createHash('sha256').update(JSON.stringify(tools)).digest('hex');
for(const hash of [toolsHash,'f579ad37daedcef8a429e13a0511668b2ef954abbc180e47b408475c5395cffe','d8a4bd52a287759bcbcd4eb754a8e41e344ac6e1ab287576f4c8b2172202f150'])
test('fixed native engine retains the exact catalog on cold resume and provider fork '+hash.slice(0,8),{timeout:45000},async t=>{
 const f=fixture(t),{bin,cwd,calls}=f;
 const catalog=mainToolsForHash(hash);
 let first=peer(f,process.env.HOMER_TEST_CODEX_BASELINE_BIN??bin),second;
 try{
  await first.init();
  const created=await first.request('thread/start',{model:'gpt-6.1-sol',modelProvider:'synthetic_boundary',cwd,approvalPolicy:'on-request',sandbox:'read-only',environments:[],config:{mcp_servers:{}},dynamicTools:catalog});
  const thread=created.thread.id;await first.request('thread/memoryMode/set',{threadId:thread,mode:'disabled'});
  await first.request('thread/inject_items',{threadId:thread,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic tool resume marker. No model execution.'}]}]});
  const before=await first.request('thread/read',{threadId:thread,includeTurns:true});
  const beforeTools=metadata(f,before.thread.path).dynamic_tools;
  assert.deepEqual(beforeTools,catalog);
  assert.equal(createHash('sha256').update(JSON.stringify(beforeTools)).digest('hex'),hash);
  await first.close();first=undefined;second=peer({...f,alternateProvider:'synthetic_fork'},bin);await second.init();
  const resumed=await second.request('thread/resume',{threadId:thread,modelProvider:'synthetic_boundary',excludeTurns:true,cwd,approvalPolicy:'on-request'});assert.equal(resumed.thread.id,thread);
  const after=await second.request('thread/read',{threadId:thread,includeTurns:true});
  const afterTools=metadata(f,after.thread.path).dynamic_tools;
  assert.deepEqual(afterTools,catalog);
  assert.equal(createHash('sha256').update(JSON.stringify(afterTools)).digest('hex'),hash);
  const fork=await second.request('thread/fork',{threadId:thread,modelProvider:'synthetic_fork',excludeTurns:true,cwd,deferGoalContinuation:true});
  assert.equal(fork.thread.forkedFromId,thread);
  assert.equal(fork.thread.modelProvider,'synthetic_fork');
  const forked=(await second.request('thread/read',{threadId:fork.thread.id,includeTurns:true})).thread;
  assert.deepEqual(metadata(f,forked.path).dynamic_tools,catalog);
  assert.equal(calls.filter(x=>x==='thread/start').length,1);assert.equal(calls.includes('turn/start'),false);
 }finally{await first?.close();await second?.close();}
});

test('fixed native engine sends the candidate title schemas to a loopback Responses endpoint',{timeout:30000},async t=>{
 const f=fixture(t),requests=[];
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/responses')return res.writeHead(404).end();
  let body='';for await(const chunk of req)body+=chunk;
  const data=JSON.parse(body);requests.push(data);
  const item={id:'msg-title',type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic title contract',annotations:[]}]};
  const response={id:'resp-title',object:'response',created_at:1,model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
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
 const engine=peer(f,f.bin,'http://127.0.0.1:'+server.address().port+'/v1');
 try{
  await engine.init();
  const {thread}=await engine.request('thread/start',{model:'gpt-5.4',modelProvider:'synthetic_boundary',cwd:f.cwd,approvalPolicy:'never',sandbox:'read-only',environments:[],config:{mcp_servers:{}},dynamicTools:tools});
  const {turn}=await engine.request('turn/start',{threadId:thread.id,environments:[],input:[{type:'text',text:'Check the outbound tool schemas against the fixture.'}]});
  const deadline=Date.now()+10000;
  let terminal;
  while(!(terminal=engine.events.find(e=>e.method==='turn/completed'&&e.params.threadId===thread.id&&e.params.turn.id===turn.id))&&Date.now()<deadline)await delay(20);
  assert.equal(terminal?.params.turn.status,'completed');
  assert.equal(requests.length,1);
  assert.ok(Array.isArray(requests[0].tools), 'Responses request keys: '+Object.keys(requests[0]).join(', '));
  const posted=Object.fromEntries(requests[0].tools.map(tool=>[tool.name,tool.parameters]));
  assert.deepEqual(posted.task_create.required,['goal','title']);
  const branches=posted.worker_open.oneOf;
  assert.equal(branches.length,2);
  for(const [index,field] of ['title','taskId'].entries()){
   const branch=branches[index];
   assert.equal(branch.type,'object');
   assert.equal(branch.additionalProperties,false);
   assert.deepEqual(branch.required,['message',field]);
   assert.deepEqual(Object.keys(branch.properties).sort(),['attachments','message','workingDirectory',field].sort());
  }
  const candidate=tools.find(tool=>tool.name==='worker_open').inputSchema.oneOf;
  // Codex keeps the closed object structure but strips these leaf constraints on the wire.
  assert.deepEqual(branches,JSON.parse(JSON.stringify(candidate,(key,value)=>
   ['minLength','maxLength','pattern','minimum'].includes(key)?undefined:value)));
 }finally{
  try{await engine.close();}finally{await new Promise(resolve=>server.close(resolve));}
 }
});
