import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {effectiveModelConfig} from '../src/config.js';
import {createSession} from '../scripts/deepseek-isolated.mjs';
for(const role of ['main','worker'] as const)for(const status of [403,429])test('pinned '+role+' does not retry a '+status+' website model failure', {timeout:30000},async()=>{
 const session=createSession();let requests=0;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(200,{'content-type':'application/json'});res.end('{"models":[]}');return;}
  let body='';for await(const chunk of req)body+=chunk;
  // Codex can start an independent memory consolidation while the turn is live.
  if(JSON.parse(body).client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
  requests++;
  if(requests===1){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:status===403?'token quota is not enough':'Too many requests',code:status===403?'insufficient_quota':'rate_limit_exceeded'}}));return;}
  const response={id:'synthetic-retry',status:'completed',output:[{type:'message',id:'synthetic-message',role:'assistant',content:[{type:'output_text',text:'unexpected retry'}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response})+'\n\n');
 });
 await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));
 const config={...session.config,baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1',keyEnv:undefined,stopGraceMs:1000};
 const engine=new CodexEngine(config,{role,cwd:config.workspace,readRoots:[],instructions:'Synthetic failure test only.',tools:[],nativeTools:role},async()=>({}));
 const timer=setTimeout(()=>void engine.close(),20000);
 try{await engine.start();const result=await engine.turn('Synthetic request');assert.equal(requests,1);assert.equal(result.status,'failed');assert.equal(result.errorCode,status===403?'engine_quota_insufficient':'engine_rate_limited');}
 finally{clearTimeout(timer);await engine.close();server.closeAllConnections();await new Promise<void>(accept=>server.close(()=>accept()));}
});
test('pinned engine discovers and invokes synthetic MCP through loopback Responses',async()=>{
 const session=createSession();let requests=0,steps=0,search=false,discovered=false,invoked=false;let issue='';
 const server=createServer(async(req,res)=>{
  try{
   let data='';for await(const chunk of req)data+=chunk;
   const body=JSON.parse(data);requests++;
   const hasSearch=body.tools?.some((t:any)=>t.type==='tool_search');search ||= hasSearch;if(hasSearch)steps++;
   const inputs=body.input??[];
   const found=inputs.find((i:any)=>i.type==='tool_search_output');
   discovered ||= !!found&&JSON.stringify(found).includes('synthetic_echo');
   invoked ||= inputs.some((i:any)=>i.type==='function_call_output'&&JSON.stringify(i).includes('synthetic_invoked'));
   const item=hasSearch&&steps===1?{type:'tool_search_call',call_id:'synthetic-search',execution:'client',arguments:{query:'synthetic_echo'}}:hasSearch&&steps===2?{type:'function_call',call_id:'synthetic-call',namespace:'mcp__homer_interactions',name:'synthetic_echo',arguments:'{"value":"synthetic"}'}:{type:'message',id:'synthetic-message',role:'assistant',content:[{type:'output_text',text:'synthetic_done'}]};
   const events=[{type:'response.created',response:{id:'synthetic-'+requests}},{type:'response.output_item.done',item},{type:'response.completed',response:{id:'synthetic-'+requests,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
   res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));
  }catch{issue='synthetic_provider_protocol_error';res.writeHead(500);res.end();}
 });
 await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));
 const address=server.address() as {port:number};
 const config={...session.config,baseUrl:'http://127.0.0.1:'+address.port+'/v1',keyEnv:undefined,stopGraceMs:1000};
 mkdirSync(resolve('.codex/scratch/deepseek-adaptation-20261028'),{recursive:true});
 const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Offline synthetic test only.',tools:[],nativeTools:'main',interactionMcp:{command:process.execPath,args:[resolve('tests/fixtures/deepseek-synthetic-mcp.mjs')],cwd:config.workspace,catalog:[{type:'function',name:'synthetic_echo',description:'Echo synthetic acceptance value',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]}},async()=>({}));
 const timer=setTimeout(()=>void engine.close(),30000);
 // config/read proves the override values reached the engine. It does not
 // exercise a token-boundary compaction; pinned source defines the 90% clamp.
 const request=engine['request'].bind(engine);let overrideEcho=false;
 engine['request']=async(method:string,params:any)=>{const response=await request(method,params);if(method==='config/read'){assert.equal(response.config?.model_context_window,272000);assert.equal(response.config?.model_auto_compact_token_limit,244800);assert.equal(response.config?.model_auto_compact_token_limit_scope,'total');overrideEcho=true;}return response;};
 try{await engine.start();assert.equal(overrideEcho,true);await engine.turn('Use synthetic_echo for synthetic acceptance.');assert.equal(issue,'');assert.equal(search,true);assert.equal(discovered,true);assert.equal(invoked,true);}
 finally{clearTimeout(timer);await engine.close();await new Promise<void>(accept=>server.close(()=>accept()));writeFileSync(join(resolve('.codex/scratch/deepseek-adaptation-20261028'),'pinned-protocol-verdict.json'),JSON.stringify({version:engine.version,requests,search,discovered,invoked,overrideEcho,tokenBoundaryExercised:false,issue})+'\n');}
});

for(const role of ['main','worker'] as const)test('pinned '+role+' adopts delivered membership context without a model call',{timeout:30000},async()=>{
 const session=createSession();
 const selected={baseUrl:'http://127.0.0.1:1/v1',model:'gpt-6.1-terra',effort:'high',fast:false,context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'}} as const;
 const projected=effectiveModelConfig({...session.config,keyEnv:undefined,stopGraceMs:1000,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot:session.directory,manifestSha256:'a'.repeat(64)},desktopConnection:{main:selected,worker:selected}},role);
 const engine=new CodexEngine({...projected,keyEnv:undefined,dailyDeepSeek:false,desktopResources:undefined,desktopConnection:undefined},
  {role,cwd:session.config.workspace,readRoots:[],instructions:'Offline configuration acceptance only.',tools:[],nativeTools:role},async()=>{throw Error('unexpected_tool');});
 try{
  await engine.start();
  const {config}=await engine['request']('config/read',{includeLayers:true});
  assert.equal(config.model_context_window,272000);
  assert.equal(config.model_auto_compact_token_limit,244800);
  assert.equal(config.model_auto_compact_token_limit_scope,'total');
 }finally{await engine.close();rmSync(session.directory,{recursive:true,force:true});}
});

for(const role of ['main','worker'] as const)test('pinned generic '+role+' changes model and clears reasoning on a resumed thread',{timeout:60000},async()=>{
 const session=createSession(),seen:any[]=[];
 // Native trust can name both the worktree and the common repository root.
 const roots=new Set([resolve('.'),dirname(execFileSync('/usr/bin/git',['rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8'}).trim())]);
 const nativeConfig='model_reasoning_effort = "high"\nmodel_reasoning_summary = "detailed"\n[memories]\ngenerate_memories = false\nuse_memories = false\n'+[...roots].map(root=>'[projects.'+JSON.stringify(root)+']\ntrust_level = "trusted"\n').join('');
 writeFileSync(join(session.config.codexHome,'config.toml'),nativeConfig);
 const server=createServer(async(req,res)=>{
  if(req.url!=='/v1/responses'){res.writeHead(404).end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);
  if(request.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
  seen.push(request);
  const response={id:'offline-'+seen.length,status:'completed',output:[{type:'message',id:'synthetic-message',role:'assistant',content:[{type:'output_text',text:'offline_done'}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response})+'\n\n');
 });
 await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));
 let engine:CodexEngine|undefined,threadId:string|undefined;
 try{
  for(const [model,effort] of [['Qwen/future-model','high'],['vendor/nonreasoning',null],['deepseek-flash','vendor_adaptive']] as const){
   const selected={baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1',model,effort,fast:false as const,context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total' as const},
    ...(effort!=='vendor_adaptive'?{}:{capabilities:{inputModalities:['text'] as ('text'|'image')[],reasoningEfforts:[effort],webSearch:false,toolSearch:false}})};
   const config=effectiveModelConfig({...session.config,keyEnv:undefined,stopGraceMs:1000,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot:session.directory,manifestSha256:'a'.repeat(64)},desktopConnection:{main:selected,worker:selected}},role);
   engine=new CodexEngine({...config,keyEnv:undefined,dailyDeepSeek:false,desktopResources:undefined,desktopConnection:undefined},
    {role,threadId,cwd:config.workspace,readRoots:[],instructions:'Offline synthetic gateway only.',tools:[],nativeTools:role},async()=>{throw Error('unexpected_tool');});
   const started=await engine.start();if(threadId)assert.equal(started,threadId);threadId=started;
   const result=await engine.turn('synthetic');assert.equal(result.status,'completed',model+': '+result.errorCode+'; requests='+seen.length);
   assert.equal(seen.at(-1).model,model);
   assert.ok(JSON.stringify(seen.at(-1)).includes('Offline synthetic gateway only.'));
   if(effort===null){assert.equal(seen.at(-1).reasoning?.effort,undefined);assert.equal(seen.at(-1).reasoning?.summary,undefined);}else assert.equal(seen.at(-1).reasoning?.effort,effort);
   assert.equal(seen.at(-1).text?.verbosity,undefined);
   assert.equal(await engine.close(),true);engine=undefined;
  }
  assert.equal(seen.length,3);
  assert.equal(readFileSync(join(session.config.codexHome,'config.toml'),'utf8'),nativeConfig);
 }finally{await engine?.close();server.closeAllConnections();await new Promise<void>(accept=>server.close(()=>accept()));rmSync(session.directory,{recursive:true,force:true});}
});
