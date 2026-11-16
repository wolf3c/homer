import './fixtures/synthetic-home.mjs';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CodexEngine,type Tool} from '../src/engine.js';
import {Store} from '../src/store.js';
import {NativeThreadBindings} from '../src/native-thread-bindings.js';
import {readNativeMemoryMode,confirmNativeMemoryMode} from '../src/native-thread-memory.js';

const binary=process.env.HOMER_TEST_CODEX_BIN??'',previousBinary=process.env.HOMER_TEST_PREVIOUS_CODEX_BIN??'';
assert.ok(isAbsolute(binary),'explicit HOMER_TEST_CODEX_BIN required');
const tools:Tool[]=[{type:'function',name:'continuity_echo',description:'Return the synthetic continuity receipt.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
const keyEnv='HOMER_NATIVE_CONTINUITY_TEST_KEY',receipt='SYNTHETIC_CONTINUITY_RECEIPT';
type Provider='openai'|'homer';

async function fixture(t:TestContext,goals=false){
 const parent=resolve('.codex/scratch/native-thread-continuity');mkdirSync(parent,{recursive:true});
 const root=realpathSync(mkdtempSync(join(parent,'case-'))),home=join(root,'codex'),host=join(root,'host'),cwd=join(root,'workspace');
 for(const path of [home,host,cwd,join(root,'tmp')])mkdirSync(path,{mode:0o700});
 writeFileSync(join(home,'auth.json'),'{"OPENAI_API_KEY":"synthetic-native-openai-key"}',{mode:0o600});
 const store=new Store(join(root,'homer.sqlite')),bindings=new NativeThreadBindings(store),engines:CodexEngine[]=[],rawPeers:{close():Promise<void>}[]=[];
 const owners=new Set<CodexEngine>();let allowGeneration=false,failure:unknown,stage='fixture_setup',requests=0,prewarms=0,upgrades=0,toolCalls=0,blocked=0,memoryRequests=0;
 const observed:{provider:Provider;seed:boolean;receipt:boolean}[]=[];
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||!['/openai/responses','/member/responses'].includes(req.url??'')){res.writeHead(404).end();return;}
   const provider=req.url==='/openai/responses'?'openai':'homer';
   assert.equal(req.headers.authorization,provider==='openai'?'Bearer synthetic-native-openai-key':'Bearer synthetic-native-member-key');
   let body='';for await(const part of req)body+=part;const data=JSON.parse(body),input=JSON.stringify(data.input??[]);
   if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){
    memoryRequests++;assert.ok(['candidate_explicit_turn','candidate_idle','legacy_explicit_turn','legacy_idle'].includes(stage),'memory consolidation must not start during native startup');
    res.writeHead(403).end();return;
   }
   const warm=data.generate===false;if(warm)prewarms++;else requests++;
   assert.ok(allowGeneration,'native_model_before_explicit_turn:'+JSON.stringify({stage,warm,memory:data.client_metadata?.['x-openai-subagent']==='memory_consolidation',provider}));
   const seed=input.includes('SYNTHETIC_SEED'),seenReceipt=input.includes(receipt);
   if(!warm)observed.push({provider,seed,receipt:seenReceipt});
   const call=seed&&!seenReceipt;
   const output=warm?[]:call?[{type:'function_call',id:'synthetic-function',call_id:'synthetic-continuity-call',name:'continuity_echo',arguments:'{}'}]:
    [{type:'message',id:'synthetic-message-'+requests,role:'assistant',content:[{type:'output_text',text:'Synthetic continuity reply.',annotations:[]}]}];
   const response={id:'synthetic-response-'+requests+'-'+prewarms,object:'response',model:data.model,status:'completed',output,usage:{input_tokens:warm?0:1,output_tokens:warm?0:1,total_tokens:warm?0:2}};
   const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},...output.map(item=>({type:'response.output_item.done',item})),{type:'response.completed',response}];
   res.writeHead(200,{'content-type':'text/event-stream'}).end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
  }catch(error){failure??=error;res.writeHead(503).end();}
 });
 server.on('upgrade',(_req,socket)=>{
  // The native client can reset this rejected upgrade before the 426 flushes.
  socket.on('error',(error:NodeJS.ErrnoException)=>{if(error.code!=='ECONNRESET')throw error;});
  upgrades++;socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
 });
 server.on('connect',(_req,socket)=>{blocked++;socket.destroy();});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
 const names=['HOME','TMPDIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',keyEnv];
 const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 process.env.HOME=host;process.env.TMPDIR=join(root,'tmp');process.env[keyEnv]='synthetic-native-member-key';
 for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])process.env[name]=origin;
 process.env.NO_PROXY=process.env.no_proxy='127.0.0.1,localhost';
 writeFileSync(join(home,'config.toml'),`openai_base_url = ${JSON.stringify(origin+'/openai')}\napproval_policy = "never"\nweb_search = "disabled"\n[features]\nplugins = false\napps = false\nhooks = false\nshell_tool = false\nskip_host_skill_discovery = true\nremote_models = false\napi_key_model_discovery = false\ngoals = ${goals}\n[memories]\ngenerate_memories = false\nuse_memories = false\n[model_providers.homer]\nname = "Synthetic member"\nbase_url = ${JSON.stringify(origin+'/member')}\nwire_api = "responses"\nrequires_openai_auth = false\nenv_key = "${keyEnv}"\nsupports_websockets = false\n`,{mode:0o600});
 t.after(async()=>{
  let stopped=true;
  try{for(const engine of engines){owners.delete(engine);stopped=await engine.close()&&stopped;}for(const peer of rawPeers)await peer.close();}
  finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));store.close();for(const [name,value] of Object.entries(before))if(value===undefined)delete process.env[name];else process.env[name]=value;}
  assert.ok(stopped,'native owners must exit before removing their fixture');rmSync(root,{recursive:true,force:true});
 });
 const env={PATH:process.env.PATH,HOME:host,CODEX_HOME:home,TMPDIR:join(root,'tmp'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost',...(process.platform==='win32'?{USERPROFILE:host,TEMP:join(root,'tmp'),TMP:join(root,'tmp'),SystemRoot:process.env.SystemRoot}:{})};
 assert.equal(execFileSync(binary,['--version'],{env,encoding:'utf8',timeout:10000}).trim(),'codex-cli 0.171.0-alpha.7');
 const check=()=>{if(failure)throw failure;assert.equal(blocked,0,'fixture must not attempt an external connection');};
 const open=async(role:'main'|'worker',provider:Provider,threadId?:string,controlOnly=false)=>{
  stage='candidate_start';
  let engine:CodexEngine;engine=new CodexEngine({appData:root,workspace:cwd,runtime:join(root,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:binary,model:'gpt-6.1-sol',effort:'low',fast:false,requiresOpenaiAuth:provider==='openai',...(provider==='homer'?{baseUrl:origin+'/member',keyEnv}:{}),stopGraceMs:1000},
   {role,nativeTools:role,threadId,controlOnly,cwd,readRoots:[cwd],instructions:'Synthetic isolated continuity acceptance.',tools,nativeThreads:bindings,isCurrent:()=>owners.has(engine),canFork:()=>owners.has(engine)},async call=>{assert.equal(call.tool,'continuity_echo');toolCalls++;return {receipt};});
  engines.push(engine);owners.add(engine);await engine.start();check();return engine;
 };
 const close=async(engine:CodexEngine)=>{owners.delete(engine);assert.equal(await engine.close(),true);};
 const turn=async(engine:CodexEngine,text:string)=>{
  stage='candidate_explicit_turn';allowGeneration=true;
  try{const result=await engine.turn(text,{onStarted:id=>bindings.bindTurn(engine.threadId!,engine.nativeThreadId!,id,()=>owners.has(engine))});check();assert.equal(result.status,'completed');return result;}
  finally{allowGeneration=false;stage='candidate_idle';}
 };
 const quiet=async(engine:CodexEngine,expectedRequests:number,expectedPrewarms:number)=>{
  await delay(250);check();assert.equal(requests,expectedRequests);assert.equal(prewarms,expectedPrewarms);
  const thread=(await engine.request('thread/read',{threadId:engine.threadId,includeTurns:true})).thread;
  assert.ok(thread.turns.every((item:any)=>item.status!=='inProgress'));return thread;
 };
 // Only legacy seeding and unloaded goal setup need a raw peer; candidate lifecycle uses CodexEngine unchanged.
 const raw=async(bin:string)=>{
  stage='raw_startup';
  const child=spawn(bin,['app-server','--stdio','-c','model_provider="openai"'],{cwd,env,stdio:['pipe','pipe','pipe']});child.stderr.resume();
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>(),events:any[]=[];let sequence=0,closed=false;
  const exited=new Promise<number|null>(done=>{child.once('error',()=>{for(const item of pending.values())item.reject(Error('continuity_peer_unavailable'));});child.once('close',code=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('continuity_peer_closed'));}pending.clear();done(code);});});
  createInterface({input:child.stdout}).on('line',line=>{
   const message=JSON.parse(line),item=pending.get(message.id);
   if(item&&!message.method){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error('continuity_rpc_failed:'+message.error.code)):item.resolve(message.result);}
   else if(message.method==='item/tool/call'){assert.equal(message.params.tool,'continuity_echo');toolCalls++;child.stdin.write(JSON.stringify({id:message.id,result:{success:true,contentItems:[{type:'inputText',text:receipt}]}})+'\n');}
   else events.push(message);
  });
  const peer={events,request(method:string,params:unknown={}):Promise<any>{return new Promise((accept,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('continuity_rpc_timeout'));},15000);pending.set(id,{resolve:accept,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});},async close(){if(closed)return;closed=true;child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);const code=await exited.finally(()=>clearTimeout(timer));assert.equal(code,0);}};
  rawPeers.push(peer);const initialized=await peer.request('initialize',{clientInfo:{name:'homer-native-continuity-synthetic',version:'1'},capabilities:{experimentalApi:true}});assert.equal(resolve(initialized.codexHome),home);child.stdin.write('{"method":"initialized","params":{}}\n');return peer;
 };
 return {home,env,bindings,open,close,turn,quiet,raw,check,get requests(){return requests;},get prewarms(){return prewarms;},get upgrades(){return upgrades;},get memoryRequests(){return memoryRequests;},get toolCalls(){return toolCalls;},get observed(){return observed;},async rawSeed(peer:Awaited<ReturnType<typeof raw>>){
  stage='legacy_thread_start';
  const source=(await peer.request('thread/start',{model:'gpt-6.1-sol',modelProvider:'openai',environments:[],dynamicTools:tools,approvalPolicy:'never',sandbox:'read-only'})).thread.id;
  stage='legacy_explicit_turn';allowGeneration=true;
  try{const started=await peer.request('turn/start',{threadId:source,environments:[],input:[{type:'text',text:'SYNTHETIC_SEED'}]});let completed:any;for(let i=0;i<300;i++){completed=peer.events.find(event=>event.method==='turn/completed'&&event.params.turn.id===started.turn.id);if(completed)break;await delay(20);}check();assert.equal(completed?.params.turn.status,'completed');}
  finally{allowGeneration=false;stage='legacy_idle';}
  return source;
 }};
}

for(const role of ['main','worker'] as const)for(const mode of ['enabled','disabled'] as const)test(`production ${role} preserves ${mode} native memory across provider fork and cold resume`,{timeout:60000},async t=>{
 const f=await fixture(t);let engine=await f.open(role,'openai');const logical=engine.threadId!;
 await f.turn(engine,'SYNTHETIC_SEED');assert.equal(f.toolCalls,1);
 await engine.request('thread/memoryMode/set',{threadId:logical,mode});await confirmNativeMemoryMode(f.home,logical,mode,()=>true);await f.close(engine);
 let previous=logical;
 for(const provider of ['homer','openai'] as const){
  const count=f.requests,warm=f.prewarms;engine=await f.open(role,provider,logical);const current=f.bindings.current(logical)!;
  assert.equal(engine.threadId,logical);assert.notEqual(current.nativeId,previous);assert.equal(current.parentNativeId,previous);assert.equal(current.provider,provider);
  assert.equal(readNativeMemoryMode(f.home,previous),mode);assert.equal(readNativeMemoryMode(f.home,current.nativeId),mode);await f.quiet(engine,count,warm);
  await f.turn(engine,'Synthetic continued history');assert.deepEqual(f.observed.at(-1),{provider,seed:true,receipt:true});assert.equal(f.toolCalls,1);await f.close(engine);
  const before=f.requests,prewarms=f.prewarms;engine=await f.open(role,provider,logical);assert.equal(engine.nativeThreadId,current.nativeId);await f.quiet(engine,before,prewarms);
  assert.equal(readNativeMemoryMode(f.home,current.nativeId),mode);await f.close(engine);previous=current.nativeId;
 }
});

test('production provider continuation preserves an active native goal without an automatic turn',{timeout:60000},async t=>{
 const f=await fixture(t,true);let engine=await f.open('main','openai');const logical=engine.threadId!;
 await engine.request('thread/name/set',{threadId:logical,name:'Synthetic active goal continuation'});await f.close(engine);
 const control=await f.raw(binary),initial=(await control.request('thread/goal/set',{threadId:logical,origin:'user',objective:'SYNTHETIC_NATIVE_GOAL',status:'active',tokenBudget:333})).goal;await control.close();
 assert.equal(initial.status,'active');assert.equal(initial.tokenBudget,333);const ancestors=[logical];
 for(const provider of ['homer','openai'] as const){
  engine=await f.open('main',provider,logical);const actual=engine.nativeThreadId!;assert.notEqual(actual,ancestors.at(-1));
  const observer=await f.raw(binary);
  for(const id of [...ancestors,actual])assert.deepEqual((await observer.request('thread/goal/get',{threadId:id})).goal,{...initial,threadId:id});
  await observer.close();
  await f.quiet(engine,0,0);await f.close(engine);
  engine=await f.open('main',provider,logical);assert.equal(engine.nativeThreadId,actual);
  assert.deepEqual((await engine.request('thread/goal/get',{threadId:logical})).goal,{...initial,threadId:actual});await f.quiet(engine,0,0);await f.close(engine);ancestors.push(actual);
 }
 t.diagnostic(JSON.stringify({modelRequests:f.requests,prewarms:f.prewarms,memoryRequests:f.memoryRequests,websocketUpgradeAttempts:f.upgrades}));
});

for(const mode of ['enabled','disabled'] as const)test(`production engine continues an isolated 0.163 ${mode} native thread without replaying its tool receipt`,{timeout:60000},async t=>{
 assert.ok(isAbsolute(previousBinary),'explicit HOMER_TEST_PREVIOUS_CODEX_BIN required');const f=await fixture(t);
 assert.equal(execFileSync(previousBinary,['--version'],{env:f.env,encoding:'utf8',timeout:10000}).trim(),'codex-cli 0.163.0');
 const peer=await f.raw(previousBinary),logical=await f.rawSeed(peer);
 await peer.request('thread/memoryMode/set',{threadId:logical,mode});await peer.close();await confirmNativeMemoryMode(f.home,logical,mode,()=>true);
 assert.equal(f.toolCalls,1);assert.equal(f.bindings.current(logical),undefined);
 const count=f.requests,warm=f.prewarms;let engine=await f.open('worker','homer',logical);const current=f.bindings.current(logical)!;
 assert.equal(f.bindings.segment(logical)?.provider,'openai');assert.equal(current.parentNativeId,logical);assert.equal(current.provider,'homer');assert.notEqual(current.nativeId,logical);
 assert.equal(readNativeMemoryMode(f.home,logical),mode);assert.equal(readNativeMemoryMode(f.home,current.nativeId),mode);await f.quiet(engine,count,warm);
 await f.turn(engine,'Synthetic upgraded history');assert.deepEqual(f.observed.at(-1),{provider:'homer',seed:true,receipt:true});assert.equal(f.toolCalls,1);await f.close(engine);
 engine=await f.open('worker','homer',logical);assert.equal(engine.nativeThreadId,current.nativeId);assert.equal(readNativeMemoryMode(f.home,current.nativeId),mode);await f.close(engine);
});
