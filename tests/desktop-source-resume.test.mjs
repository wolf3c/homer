// Explicit opt-in: fixed Codex, synthetic credentials, isolated HOME and loopback Responses only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {MockAgent} from 'undici';
import {nativeHistoryBridge} from '../src/native-history-bridge.ts';
const bin=process.env.HOMER_TEST_CODEX_BIN;
const toml=value=>value&&typeof value==='object'?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(value);
test('fixed Codex preserves foreign and native reasoning across openai → homer → openai',{skip:!bin,timeout:60000},async()=>{
 const providers=['openai','homer','openai'];
 assert.equal(execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.163.0');
 const parent=resolve('.codex/scratch/dual-source');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'resume-'));
 for(const name of ['home','codex','workspace','tmp'])mkdirSync(join(root,name));
 writeFileSync(join(root,'codex/auth.json'),'{"OPENAI_API_KEY":"synthetic-offline-key"}',{mode:0o600});
 const artifact=join(root,'workspace/kept.txt');writeFileSync(artifact,'synthetic artifact');
 const requests=[];
 function reply(data,provider){
  const id=String(requests.push({provider,history:JSON.stringify(data.input)}));
  if(provider==='openai')assert.ok(data.input.every(item=>item.type!=='reasoning'||!item.content?.length),'OpenAI rejects foreign reasoning.content beside encrypted_content');
  const reason={id:'rs_'+id,type:'reasoning',summary:[],content:provider==='homer'?[{type:'reasoning_text',text:'synthetic foreign reasoning'}]:[],encrypted_content:provider==='homer'?'synthetic-foreign-stub':'synthetic-native-cipher'};
  const item={id:'msg_'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic-'+id,annotations:[]}]};
  const response={id:'resp_'+id,object:'response',model:data.model,status:'completed',output:[reason,item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  return [{type:'response.created',response:{...response,status:'in_progress',output:[]}},...[reason,item].flatMap((item,index)=>[{type:'response.output_item.added',output_index:index,item:{...item,content:[]}},{type:'response.output_item.done',output_index:index,item}]),{type:'response.completed',response}].map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join('');
 }
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  res.setHeader('Content-Type','text/event-stream');res.end(reply(JSON.parse(body),'homer'));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const dispatcher=new MockAgent();Object.assign(dispatcher,{destroy:()=>dispatcher.close()});dispatcher.disableNetConnect();
 const pool=dispatcher.get('https://chatgpt.com');
 pool.intercept({path:/^\/backend-api\/codex\/models/,method:'GET'}).reply(200,{models:[]}).persist();
 pool.intercept({path:'/backend-api/codex/responses',method:'POST'}).reply(options=>({statusCode:200,data:reply(JSON.parse(String(options.body)),'openai'),responseOptions:{headers:{'content-type':'text/event-stream'}}})).persist();
 const bridge=await nativeHistoryBridge({},dispatcher);
 let thread,peer;
 function connect(provider){
  const settings={model:'gpt-6.1-sol',model_provider:provider,cli_auth_credentials_store:'file',approval_policy:'never',web_search:'disabled','features.responses_websockets':false,'features.responses_websockets_v2':false,'features.memories':false,'memories.generate_memories':false,'memories.use_memories':false,'features.apps':false,'features.plugins':false,'features.hooks':false,'features.shell_tool':false,'features.skip_host_skill_discovery':true,'analytics.enabled':false,'feedback.enabled':false};
  settings['features.enable_request_compression']=false;
  if(provider==='openai')settings.openai_base_url=bridge.baseUrl;
  else settings['model_providers.homer']={name:'homer',base_url:origin+'/homer',wire_api:'responses',requires_openai_auth:false,supports_websockets:false};
  const child=spawn(bin,['app-server','--stdio',...Object.entries(settings).flatMap(([k,v])=>['-c',k+'='+toml(v)])],{cwd:join(root,'workspace'),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(root,'home'),CODEX_HOME:join(root,'codex'),TMPDIR:join(root,'tmp')}});
  child.stderr.resume();const exited=new Promise(r=>child.once('exit',r));
  const pending=new Map(),events=[];let sequence=0;
  createInterface({input:child.stdout}).on('line',line=>{
   const value=JSON.parse(line),request=pending.get(value.id);
   if(request&&!value.method){pending.delete(value.id);clearTimeout(request.timer);value.error?request.reject(Error(JSON.stringify(value.error))):request.resolve(value.result);}else events.push(value);
  });
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
   const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('timeout: '+method));},15000);
   pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  return {async run(marker){
   await rpc('initialize',{clientInfo:{name:'homer-dual-source-test',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
   const value=await rpc(thread?'thread/resume':'thread/start',{...(thread?{threadId:thread}:{}),model:'gpt-6.1-sol',cwd:join(root,'workspace'),approvalPolicy:'never',sandbox:'read-only',environments:[]});
   if(thread)assert.equal(value.thread.id,thread);thread=value.thread.id;assert.equal(value.thread.modelProvider,provider);
   {
    const turn=await rpc('turn/start',{threadId:thread,environments:[],input:[{type:'text',text:marker}]});
    const deadline=Date.now()+15000;let completed;
    while(Date.now()<deadline){completed=events.find(e=>e.method==='turn/completed'&&e.params.turn.id===turn.turn.id);if(completed)break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(completed?.params.turn.status,'completed');
   }
   assert.equal((await rpc('thread/read',{threadId:thread,includeTurns:true})).thread.id,thread);
  },async close(){child.kill('SIGTERM');await exited;for(const p of pending.values())clearTimeout(p.timer);}};
 }
 try{
  for(const [index,provider]of providers.entries()){peer=connect(provider);await peer.run('synthetic-marker-'+index);await peer.close();peer=undefined;}
  assert.deepEqual(requests.map(r=>r.provider),providers);
  assert.match(requests.at(-1).history,/synthetic foreign reasoning/);
  assert.match(requests.at(-1).history,/synthetic-native-cipher/);
  assert.match(requests.at(-1).history,/synthetic-marker-0/);
  assert.match(requests.at(-1).history,/synthetic-marker-1/);
  const {readFileSync}=await import('node:fs');
  assert.equal(readFileSync(artifact,'utf8'),'synthetic artifact');
  assert.equal(readFileSync(join(root,'codex/auth.json'),'utf8'),'{"OPENAI_API_KEY":"synthetic-offline-key"}');
 }finally{await peer?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await bridge.close();}
});
