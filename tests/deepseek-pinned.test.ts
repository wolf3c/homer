import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {createSession} from '../scripts/deepseek-isolated.mjs';
for(const role of ['main','worker'] as const)for(const status of [403,429])test('pinned '+role+' does not retry a '+status+' website model failure', {timeout:30000},async()=>{
 const session=createSession();let requests=0;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(200,{'content-type':'application/json'});res.end('{"models":[]}');return;}
  for await(const _ of req){}requests++;
  if(requests===1){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:status===403?'token quota is not enough':'Too many requests',code:status===403?'insufficient_quota':'rate_limit_exceeded'}}));return;}
  const response={id:'synthetic-retry',status:'completed',output:[{type:'message',id:'synthetic-message',role:'assistant',content:[{type:'output_text',text:'unexpected retry'}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response})+'\n\n');
 });
 await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));
 const config={...session.config,baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1',keyEnv:undefined,stopGraceMs:1000};
 const engine=new CodexEngine(config,{role,cwd:config.workspace,readRoots:[],instructions:'Synthetic failure test only.',tools:[],nativeCapabilities:false,nativeTools:role},async()=>({}));
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
 const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Offline synthetic test only.',tools:[],nativeCapabilities:true,nativeTools:'main',interactionMcp:{command:process.execPath,args:[resolve('tests/fixtures/deepseek-synthetic-mcp.mjs')],cwd:config.workspace,catalog:[{type:'function',name:'synthetic_echo',description:'Echo synthetic acceptance value',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]}},async()=>({}));
 const timer=setTimeout(()=>void engine.close(),30000);
 // config/read proves the override values reached the engine. It does not
 // exercise a token-boundary compaction; pinned source defines the 90% clamp.
 const request=engine['request'].bind(engine);let overrideEcho=false;
 engine['request']=async(method:string,params:any)=>{const response=await request(method,params);if(method==='config/read'){assert.equal(response.config?.model_context_window,272000);assert.equal(response.config?.model_auto_compact_token_limit,244800);assert.equal(response.config?.model_auto_compact_token_limit_scope,'total');overrideEcho=true;}return response;};
 try{await engine.start();assert.equal(overrideEcho,true);await engine.turn('Use synthetic_echo for synthetic acceptance.');assert.equal(issue,'');assert.equal(search,true);assert.equal(discovered,true);assert.equal(invoked,true);}
 finally{clearTimeout(timer);await engine.close();await new Promise<void>(accept=>server.close(()=>accept()));writeFileSync(join(resolve('.codex/scratch/deepseek-adaptation-20261028'),'pinned-protocol-verdict.json'),JSON.stringify({version:engine.version,requests,search,discovered,invoked,overrideEcho,tokenBoundaryExercised:false,issue})+'\n');}
});
