// Explicit fixed-engine acceptance: synthetic credentials and loopback only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {WebSocketServer} from 'ws';
import {CodexEngine,codexVersion} from '../src/engine.ts';

const binary=process.env.HOMER_TEST_CODEX_BIN;
for(const model of ['synthetic-member','gpt-6.1-terra'])for(const role of ['main','worker'])for(const mode of ['websocket','legacy-http','426','401','429','503','event-429','disconnect','message-limit','tool-disconnect'])test(`fixed membership ${model} ${role} preserves native semantics via ${mode}`,{skip:!binary,timeout:60000},async t=>{
 assert.equal(codexVersion(binary),'codex-cli 0.171.0-alpha.7');
 const parent=resolve('.codex/scratch/membership-websocket');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-'));
 for(const name of ['runtime','workspace','codex','tmp'])mkdirSync(join(root,name),{mode:0o700});
 writeFileSync(join(root,'codex/config.toml'),'[features]\nplugins=false\n[memories]\ngenerate_memories=false\nuse_memories=false\n');
 const artifact=join(root,'workspace/kept.txt');writeFileSync(artifact,'synthetic artifact');
 const codeMode=model==='gpt-6.1-terra',outputType=codeMode?'custom_tool_call_output':'function_call_output',marker=randomUUID();
 const seen=[],responses=new Map(),memoryConnections=new Set();let handshakes=0,httpAttempts=0,prewarms=0,toolCalls=0,broken=0,sequence=0,signals=0,maxInputBytes=0;
 const rejection=/^\d+$/.test(mode)?Number(mode):undefined;
 const fault=!!rejection&&rejection!==426||['event-429','disconnect','message-limit','tool-disconnect'].includes(mode);
 function reply(data,transport,connection){
  assert.equal(data.model,model);assert.equal(data.reasoning.effort,'high');
  assert.equal(data.service_tier??null,null);assert.ok(Array.isArray(data.input));
  maxInputBytes=Math.max(maxInputBytes,Buffer.byteLength(JSON.stringify(data.input)));
  const cache=connection??responses,previous=cache.get(data.previous_response_id);
  if(data.previous_response_id)assert.ok(previous,'incremental requests must refer to this connection');
  const input=[...(previous??[]),...data.input],id='synthetic-'+ ++sequence;
  const tools=[...data.tools,...input.filter(item=>item.type==='additional_tools').flatMap(item=>item.tools)].flatMap(tool=>tool.tools??[tool]);
  assert.equal(tools.some(tool=>tool.type==='custom'&&tool.name==='exec'&&tool.format?.syntax==='lark'),codeMode);
  assert.equal(tools.some(tool=>tool.type==='function'&&tool.name==='benchmark_echo'),!codeMode);
  if(data.generate===false){prewarms++;cache.set(id,input);return [{type:'response.completed',response:{id,status:'completed',output:[],usage:{input_tokens:0,output_tokens:0,total_tokens:0}}}];}
  seen.push({transport,connection,input,wireInput:data.input,previous:data.previous_response_id});
  const returned=input.find(item=>item.type===outputType&&item.call_id==='synthetic-call');
  if(returned)assert.ok(JSON.stringify(returned).includes(marker),'the next request must carry the locally generated result');
  const needsTool=JSON.stringify(input).includes('synthetic-tool-once')&&!returned;
  const item=needsTool?{id:'fc-'+id,call_id:'synthetic-call',...(codeMode?{type:'custom_tool_call',name:'exec',input:'const result=await tools.benchmark_echo({}); text(result);'}:{type:'function_call',name:'benchmark_echo',arguments:'{}'})}:{id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:returned?marker:'synthetic done',annotations:[]}]};
  cache.set(id,[...input,item]);
  const response={id,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:1,total_tokens:11}};
  return [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,...(needsTool?(codeMode?{input:''}:{}):{content:[]})}},...(needsTool&&codeMode?[{type:'response.custom_tool_call_input.delta',item_id:item.id,output_index:0,delta:item.input},{type:'response.custom_tool_call_input.done',item_id:item.id,output_index:0,input:item.input}]:[]),{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 }
 const server=createServer(async(req,res)=>{
  try{
  if(req.url!=='/v1/responses'){res.writeHead(404).end();return;}
  assert.equal(req.headers.authorization,'Bearer synthetic-membership-key');
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);
  // Fresh Main may start independent native memory consolidation.
  if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
  httpAttempts++;
  if(rejection&&rejection!==426||mode==='event-429'){res.writeHead(rejection??429,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'synthetic rejection',code:mode==='401'?'invalid_api_key':'rate_limit_exceeded'}}));return;}
  res.setHeader('Content-Type','text/event-stream');
  res.end(reply(data,'http').map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
  }catch(error){providerError=error;res.writeHead(500).end();}
 });
 const sockets=new WebSocketServer({noServer:true,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{
  assert.equal(req.url,'/v1/responses');assert.equal(req.headers.authorization,'Bearer synthetic-membership-key');handshakes++;
  if(rejection){socket.end(`HTTP/1.1 ${rejection} Synthetic\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);return;}
  sockets.handleUpgrade(req,socket,head,ws=>{const connection=new Map();ws.on('message',message=>{
   try{
   const data=JSON.parse(message.toString());
   if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){memoryConnections.add(ws);ws.close();return;}
   if(mode==='event-429'&&data.generate!==false){ws.send(JSON.stringify({type:'error',status:429,error:{type:'rate_limit_error',code:'rate_limit_exceeded',message:'synthetic rejection'}}));return;}
   if(data.generate!==false&&(['disconnect','message-limit'].includes(mode)||mode==='tool-disconnect'&&data.input.some(item=>item.type===outputType))){broken++;if(mode==='message-limit')ws.close(1009,'synthetic size limit');else ws.terminate();return;}
   for(const event of reply(data,'websocket',connection))ws.send(JSON.stringify(event));
   }catch(error){providerError=error;ws.close();}
  });});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const keys=['HOMER_DEEPSEEK_TOKEN','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','TMPDIR'];
 const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 for(const key of keys)delete process.env[key];
 Object.assign(process.env,{HOMER_DEEPSEEK_TOKEN:'synthetic-membership-key',NO_PROXY:'127.0.0.1',TMPDIR:join(root,'tmp')});
 const selected={baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model,effort:'high',fast:false,...(mode==='legacy-http'?{}:{supportsWebSocket:true}),context:{contextWindow:128000,autoCompactTokenLimit:100000,autoCompactTokenLimitScope:'total'},capabilities:{inputModalities:['text'],reasoningEfforts:['high'],webSearch:false,toolSearch:false}};
 const config={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:binary,model:'unused',requiresOpenaiAuth:false,stopGraceMs:1000,desktopModelSource:'website',dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},desktopConnection:{main:selected,worker:selected}};
 let engine,thread,providerError;
 const makeEngine=()=>{
  const value=new CodexEngine(config,{role,nativeTools:role,threadId:thread,cwd:config.workspace,readRoots:[],instructions:'Synthetic offline membership acceptance.',tools:[{name:'benchmark_echo',description:'Synthetic constant',inputSchema:{type:'object',properties:{},additionalProperties:false}}]},async call=>{assert.equal(call.tool,'benchmark_echo');toolCalls++;return {value:marker};});
  value.on('webSocketSucceeded',()=>signals++);return value;
 };
 try{
  engine=makeEngine();thread=await engine.start();assert.equal(engine.supportsWebSocket,mode!=='legacy-http');
  const result=await engine.turn(fault?(mode==='tool-disconnect'?'synthetic-tool-once':'synthetic retained context '.repeat(2000)):'synthetic large seed '.repeat(2000));
  assert.ifError(providerError);
  if(fault){
   if(rejection||mode==='event-429'){assert.equal(result.status,'failed');assert.equal(seen.length,0);assert.ok(httpAttempts<=1,'native HTTP request retries remain disabled');}
   else{assert.equal(result.status,'completed');assert.equal(seen.filter(request=>request.transport==='http').length,1);assert.equal(seen.length,mode==='tool-disconnect'?2:1);if(mode!=='tool-disconnect')assert.match(JSON.stringify(seen.at(-1).input),/synthetic retained context/);}
   assert.ok(handshakes>=1&&handshakes<=4,'native handshake/prewarm budget remains bounded');
   assert.equal(toolCalls,mode==='tool-disconnect'?1:0);assert.equal(broken,['disconnect','message-limit','tool-disconnect'].includes(mode)?1:0);
   t.diagnostic(JSON.stringify({role,mode,status:result.status,errorCode:result.errorCode,handshakes,httpAttempts,prewarms,generations:seen.length,toolCalls,signals}));return;
  }
  assert.equal(result.status,'completed');assert.equal(engine.modelTransport,mode==='websocket'?'websocket':mode==='426'?'http':undefined);
  const toolResult=await engine.turn('synthetic-tool-once');assert.ifError(providerError);assert.equal(toolResult.status,'completed');assert.equal(toolResult.text,marker);assert.equal(toolCalls,1);
  assert.equal((await engine.turn('synthetic final')).status,'completed');
  if(mode==='websocket'){assert.ok(prewarms>0);assert.ok(seen.at(-1).previous);assert.ok(JSON.stringify(seen.at(-1).wireInput).length<1000);assert.doesNotMatch(JSON.stringify(seen.at(-1).wireInput),/synthetic large seed/);}
  const initialInputBytes=maxInputBytes,incrementalInputBytes=Buffer.byteLength(JSON.stringify(seen.at(-1).wireInput));
  const before=seen.length;assert.equal(await engine.close(),true);engine=makeEngine();assert.equal(await engine.start(),thread);
  assert.equal((await engine.turn('synthetic cold resume')).status,'completed');assert.equal(toolCalls,1);
  assert.match(JSON.stringify(seen.at(-1).input),/synthetic large seed/);assert.ok(seen.at(-1).input.some(item=>item.type===outputType));
  assert.equal(seen.length,before+1,'cold resume generates one answer without replaying tools');
  assert.equal(readFileSync(artifact,'utf8'),'synthetic artifact');
  if(mode==='legacy-http')assert.equal(handshakes,0);
  else if(mode==='426')assert.ok(handshakes>=2&&handshakes<=3,'two rejected process connections plus at most one native prewarm attempt');
  else{assert.equal(new Set(seen.map(request=>request.connection)).size,2,'two business generation connections');assert.ok(handshakes-memoryConnections.size>=2&&handshakes-memoryConnections.size<=3,'two process connections plus at most one abandoned native prewarm');assert.ok(memoryConnections.size<=2,'at most one separate memory connection per process');}
  if(mode==='websocket'){assert.ok(seen.slice(0,before).every(request=>request.connection===seen[0].connection));assert.notEqual(seen.at(-1).connection,seen[0].connection);}
  assert.equal(signals,role==='worker'&&mode==='websocket'?2:0,'Worker hint requires completed WS generation, never prewarm or HTTP');
  t.diagnostic(JSON.stringify({role,mode,handshakes,prewarms,generations:seen.length,toolCalls,signals,initialInputBytes,incrementalInputBytes,coldResume:true}));
 }finally{
  await engine?.close();for(const ws of sockets.clients)ws.terminate();sockets.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  rmSync(root,{recursive:true,force:true});
 }
});
