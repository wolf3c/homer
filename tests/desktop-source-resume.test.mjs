// Explicit opt-in: fixed Codex, synthetic credentials, isolated HOME and loopback Responses only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {connect as connectSocket} from 'node:net';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {MockAgent} from 'undici';
import {nativeHistoryBridge} from '../src/native-history-bridge.ts';
import {membershipModelCatalog} from '../src/model-catalog.ts';
import {WebSocketServer} from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
const bin=process.env.HOMER_TEST_CODEX_BIN;
const toml=value=>value&&typeof value==='object'?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(value);
for(const transport of ['http','websocket','websocket-native','reject-401','reject-429','reject-503','disconnect','message-limit','tool-disconnect','overloaded'])test(`fixed Codex preserves original threads and history via ${transport}`,{skip:!bin,timeout:120000},async t=>{
 const rejection=transport.startsWith('reject-')?Number(transport.slice(7)):undefined;
 const fault=!!rejection||['disconnect','message-limit','tool-disconnect','overloaded'].includes(transport);let rejected=0,broken=0;
 const providers=transport==='websocket-native'?['openai','openai']:['openai','homer','openai'];
 assert.equal(execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.163.0');
 const parent=resolve('.codex/scratch/dual-source');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'resume-'));
 for(const name of ['home','codex','workspace','tmp'])mkdirSync(join(root,name));
 writeFileSync(join(root,'codex/auth.json'),'{"OPENAI_API_KEY":"synthetic-offline-key"}',{mode:0o600});
 const artifact=join(root,'workspace/kept.txt');writeFileSync(artifact,'synthetic artifact');
 const requests=[],responses=new Map();let sequence=0,prewarms=0,toolCalls=0;
 function reply(data,provider,transport='http'){
  const id=String(++sequence);
  const input=[...(responses.get(data.previous_response_id)??[]),...data.input];
  if(data.generate===false){prewarms++;responses.set('resp_'+id,input);return [{type:'response.completed',response:{id:'resp_'+id,object:'response',status:'completed',output:[],usage:{input_tokens:0,output_tokens:0,total_tokens:0}}}];}
  requests.push({provider,transport,history:JSON.stringify(input),wireInput:JSON.stringify(data.input),previous:data.previous_response_id,model:data.model,effort:data.reasoning?.effort,serviceTier:data.service_tier??null});
  if(provider==='openai')assert.ok(data.input.every(item=>item.type!=='reasoning'||!item.content?.length),'OpenAI rejects foreign reasoning.content beside encrypted_content');
  const reason={id:'rs_'+id,type:'reasoning',summary:[],content:provider==='homer'?[{type:'reasoning_text',text:'synthetic foreign reasoning'}]:[],encrypted_content:provider==='homer'?'synthetic-foreign-stub':'synthetic-native-cipher'};
  const item={id:'msg_'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic-'+id,annotations:[]}]};
  const needsTool=input.some(i=>i.type==='message'&&i.role==='user'&&JSON.stringify(i.content).includes('synthetic-tool-once'))&&!input.some(i=>i.type==='function_call_output'&&i.call_id==='fixture_tool_once');
  const output=needsTool?[{type:'function_call',id:'fc_'+id,call_id:'fixture_tool_once',name:'benchmark_echo',arguments:'{}'}]:[reason,item];
  const response={id:'resp_'+id,object:'response',model:data.model,status:'completed',output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  responses.set(response.id,[...input,...output]);
  return [{type:'response.created',response:{...response,status:'in_progress',output:[]}},...output.flatMap((item,index)=>[{type:'response.output_item.added',output_index:index,item:{...item,content:[]}},{type:'response.output_item.done',output_index:index,item}]),{type:'response.completed',response}];
 }
 const sse=events=>events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join('');
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  res.setHeader('Content-Type','text/event-stream');res.end(sse(reply(JSON.parse(body),'homer')));
 });
 const sockets=new WebSocketServer({noServer:true,perMessageDeflate:false});
 sockets.on('headers',headers=>headers.push('x-codex-turn-state: fixture-turn-state'));
 server.on('upgrade',(req,socket,head)=>{
  if(rejection){rejected++;socket.end(`HTTP/1.1 ${rejection} Synthetic Rejection\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"error":{"message":"synthetic rejection","code":"synthetic_rejection"}}`);return;}
  if(transport==='http'){socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>ws.on('message',message=>{
   const data=JSON.parse(message.toString());
   if(transport==='overloaded'&&data.generate!==false){
    broken++;const error={code:'server_is_overloaded',type:'server_error',message:'synthetic overload'};
    ws.send(JSON.stringify({type:'response.failed',response:{id:'resp_failure_'+broken,status:'failed',output:[],error}}));
    ws.send(JSON.stringify({type:'error',status:503,error}));return;
   }
   if(transport==='tool-disconnect'&&!broken&&data.input.some(item=>item.type==='function_call_output')){broken++;ws.terminate();return;}
   if(data.generate!==false&&['disconnect','message-limit'].includes(transport)){broken++;if(transport==='message-limit')ws.close(1009,'synthetic message limit');else ws.terminate();return;}
   for(const event of reply(data,'openai','websocket'))ws.send(JSON.stringify(event));
  }));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 t.mock.method(HttpsProxyAgent.prototype,'connect',async()=>connectSocket(server.address().port,'127.0.0.1'));
 const dispatcher=new MockAgent();Object.assign(dispatcher,{destroy:()=>dispatcher.close()});dispatcher.disableNetConnect();
 const pool=dispatcher.get('https://chatgpt.com');
 const modelCatalog=membershipModelCatalog('gpt-6.1-sol','high',128000,{inputModalities:['text','image'],reasoningEfforts:['low','high'],webSearch:false,toolSearch:false});
 modelCatalog.models[0].service_tiers=[{id:'priority',name:'Fast',description:'Synthetic Fast'},{id:'ultrafast',name:'Ultrafast',description:'Synthetic Ultrafast'}];
 modelCatalog.models.push({...structuredClone(modelCatalog.models[0]),slug:'synthetic-live-model',display_name:'Synthetic live model'});
 writeFileSync(join(root,'models.json'),JSON.stringify(modelCatalog),{mode:0o600});
 pool.intercept({path:/^\/backend-api\/codex\/models/,method:'GET'}).reply(200,modelCatalog).persist();
 pool.intercept({path:'/backend-api/codex/responses',method:'POST'}).reply(options=>rejection?{statusCode:rejection,data:'{"error":{"message":"synthetic rejection","code":"synthetic_rejection"}}'}:{statusCode:200,data:sse(reply(JSON.parse(String(options.body)),'openai')),responseOptions:{headers:{'content-type':'text/event-stream'}}}).persist();
 const bridge=await nativeHistoryBridge({HTTPS_PROXY:'http://127.0.0.1:9'},dispatcher);
 let thread,peer,passed=false;
 function connect(provider){
  const settings={model:'gpt-6.1-sol',model_provider:provider,cli_auth_credentials_store:'file',approval_policy:'never',web_search:'disabled','features.unbounded_connection_retries':false,'features.responses_websockets':false,'features.responses_websockets_v2':false,'features.memories':false,'memories.generate_memories':false,'memories.use_memories':false,'features.apps':false,'features.plugins':false,'features.hooks':false,'features.shell_tool':false,'features.skip_host_skill_discovery':true,'analytics.enabled':false,'feedback.enabled':false};
  settings['features.enable_request_compression']=false;
  settings.model_catalog_json=join(root,'models.json');
  if(provider==='openai')settings.openai_base_url=bridge.baseUrl;
  else settings['model_providers.homer']={name:'homer',base_url:origin+'/homer',wire_api:'responses',requires_openai_auth:false,supports_websockets:false};
  const child=spawn(bin,['app-server','--stdio',...Object.entries(settings).flatMap(([k,v])=>['-c',k+'='+toml(v)])],{cwd:join(root,'workspace'),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(root,'home'),CODEX_HOME:join(root,'codex'),TMPDIR:join(root,'tmp')}});
  child.stderr.resume();const exited=new Promise(r=>child.once('exit',r));
  const pending=new Map(),events=[];let sequence=0,started=false;
  createInterface({input:child.stdout}).on('line',line=>{
   const value=JSON.parse(line),request=pending.get(value.id);
   if(request&&!value.method){pending.delete(value.id);clearTimeout(request.timer);value.error?request.reject(Error(JSON.stringify(value.error))):request.resolve(value.result);}
   else if(value.id!==undefined&&value.method==='item/tool/call'){toolCalls++;child.stdin.write(JSON.stringify({id:value.id,result:{success:true,contentItems:[{type:'inputText',text:'42'}]}})+'\n');}
   else events.push(value);
  });
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
   const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('timeout: '+method));},15000);
   pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  return {async run(marker,selection,observeFailure=false){
   if(!started){
    await rpc('initialize',{clientInfo:{name:'homer-dual-source-test',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
    const value=await rpc(thread?'thread/resume':'thread/start',{...(thread?{threadId:thread}:{dynamicTools:[{name:'benchmark_echo',description:'Synthetic constant tool',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}),model:'gpt-6.1-sol',cwd:join(root,'workspace'),approvalPolicy:'never',sandbox:'read-only',environments:[]});
    if(thread)assert.equal(value.thread.id,thread);thread=value.thread.id;assert.equal(value.thread.modelProvider,provider);started=true;
   }
   if(selection)await rpc('thread/settings/update',{threadId:thread,...selection});
   {
    const turn=await rpc('turn/start',{threadId:thread,...selection,environments:[],input:[{type:'text',text:marker}]});
    const deadline=Date.now()+(observeFailure?90000:15000);let completed;
    while(Date.now()<deadline){completed=events.find(e=>e.method==='turn/completed'&&e.params.turn.id===turn.turn.id);if(completed)break;await new Promise(r=>setTimeout(r,10));}
    if(observeFailure){assert.ok(completed,'native transport must reach a terminal turn');return completed.params.turn.status;}
    assert.equal(completed?.params.turn.status,'completed');
   }
   const observed=(await rpc('thread/read',{threadId:thread,includeTurns:true})).thread;
   assert.equal(observed.id,thread);return observed.path;
  },async close(){child.kill('SIGTERM');await exited;for(const p of pending.values())clearTimeout(p.timer);}};
 }
 try{
  if(fault){
   peer=connect('openai');const status=await peer.run(transport==='tool-disconnect'?'synthetic-tool-once':'synthetic-failure-path',undefined,true);
   if(rejection){assert.equal(status,'failed');assert.ok(rejected>0);assert.ok(rejected<=10);}
   else if(transport==='tool-disconnect'){assert.equal(status,'completed');assert.equal(broken,1);assert.equal(toolCalls,1);}
   else{assert.ok(broken>0);assert.ok(broken<=10);assert.equal(requests.length,status==='completed'?1:0);}
   t.diagnostic(JSON.stringify({transport,status,handshakeRejections:rejected,interruptedRequests:broken,generations:requests.length,httpGenerations:requests.filter(r=>r.transport==='http').length,websocketGenerations:requests.filter(r=>r.transport==='websocket').length}));
   assert.equal(toolCalls,transport==='tool-disconnect'?1:0);passed=true;return;
  }
  let rollout;
  for(const [index,provider]of providers.entries()){peer=connect(provider);rollout=await peer.run('synthetic-marker-'+index+(index===0?' synthetic-large-context '.repeat(2000):''));await peer.close();peer=undefined;}
  assert.deepEqual(requests.map(r=>r.provider),providers);
  if(transport!=='websocket-native')assert.match(requests.at(-1).history,/synthetic foreign reasoning/);
  assert.match(requests.at(-1).history,/synthetic-native-cipher/);
  assert.match(requests.at(-1).history,/synthetic-marker-0/);
  assert.match(requests.at(-1).history,/synthetic-marker-1/);
  if(transport!=='websocket-native')assert.match(readFileSync(rollout,'utf8'),/synthetic foreign reasoning/);
  assert.match(readFileSync(rollout,'utf8'),/synthetic-native-cipher/);
  assert.equal(readFileSync(artifact,'utf8'),'synthetic artifact');
  assert.equal(readFileSync(join(root,'codex/auth.json'),'utf8'),'{"OPENAI_API_KEY":"synthetic-offline-key"}');

  peer=connect('openai');
  for(const serviceTier of ['priority','ultrafast',null]){
   const selection={model:serviceTier==='priority'?'gpt-6.1-sol':'synthetic-live-model',effort:'low',serviceTier};await peer.run('synthetic-speed-'+(serviceTier??'standard'),selection);
   assert.equal(requests.at(-1).model,selection.model);assert.equal(requests.at(-1).effort,'low');assert.equal(requests.at(-1).serviceTier,serviceTier);
  }
  await peer.run('synthetic-tool-once');assert.equal(toolCalls,1);
  await peer.run('synthetic-final-turn');
  if(transport!=='http'){assert.ok(prewarms>0);assert.ok(requests.at(-1).previous);assert.ok(requests.at(-1).wireInput.length<1000);assert.doesNotMatch(requests.at(-1).wireInput,/synthetic-large-context/);}
  await peer.close();peer=undefined;
  passed=true;
 }finally{await peer?.close();await bridge.close();for(const ws of sockets.clients)ws.terminate();sockets.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(passed)rmSync(root,{recursive:true,force:true});}
});
