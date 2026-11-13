// Explicit live-model suite: synthetic content, candidate production bridge, isolated credentials and runtime.
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {request,Agent} from 'undici';
import {nativeHistoryBridge} from '../src/native-history-bridge.ts';
import {codexProxyEnvironment} from '../src/engine.ts';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import WebSocket,{WebSocketServer} from 'ws';

test('candidate HTTP and WebSocket live transport benchmark',{timeout:900000},async context=>{
const binary=process.env.HOMER_TEST_CODEX_BIN,authPath=process.env.HOMER_TEST_AUTH_FILE;
if(!binary||!authPath)throw Error('explicit_HOMER_TEST_CODEX_BIN_and_HOMER_TEST_AUTH_FILE_required');
assert.equal(execFileSync(binary,['--version'],{encoding:'utf8',timeout:5000}).trim(),'codex-cli 0.163.0');
const auth=readFileSync(authPath);
const parent=resolve('.codex/scratch/native-history-transport');mkdirSync(parent,{recursive:true});
const root=mkdtempSync(join(parent,'run-'));
const privateParent=resolve('.codex/private/native-history-transport');mkdirSync(privateParent,{recursive:true,mode:0o700});
const priv=mkdtempSync(join(privateParent,'run-'));
const proxyEnv=codexProxyEnvironment();
const bridge=await nativeHistoryBridge(proxyEnv);
const dispatcher=new Agent();
const results=[];let active,child;
context.signal.addEventListener('abort',()=>child?.kill('SIGTERM'),{once:true});
const sourceHash=createHash('sha256').update(readFileSync(new URL('../src/native-history-bridge.ts',import.meta.url))).digest('hex');
const save=()=>writeFileSync(join(root,'metrics.json'),JSON.stringify({model:'gpt-6.1-terra',effort:'high',compression:false,projectDocumentBytes:0,sourceHash,proxy:Object.keys(proxyEnv).length?'configured':'direct',results},null,2));
function metric(data,transport,bytes){const m={transport,start:performance.now(),requestBytes:bytes,inputItems:data.input?.length,generate:data.generate??null,previousResponse:!!data.previous_response_id,model:data.model,effort:data.reasoning?.effort,responseBytes:0};active.requests.push(m);return m;}
function event(m,e){if(!m)return;const t=performance.now()-m.start;if(!m.firstEventMs)m.firstEventMs=t;if(e.type==='response.output_text.delta'&&!m.firstTextMs)m.firstTextMs=t;if(e.type==='response.completed'||e.type==='response.failed'){m.totalMs=t;m.status=e.response?.status;m.usage=e.response?.usage?{input_tokens:e.response.usage.input_tokens,output_tokens:e.response.usage.output_tokens,cached_tokens:e.response.usage.input_tokens_details?.cached_tokens,reasoning_tokens:e.response.usage.output_tokens_details?.reasoning_tokens}:null;save();}if(e.type==='error'||e.type==='response.failed'){const code=e.error?.code??e.code??e.response?.error?.code;m.errorCode=code==='server_is_overloaded'?code:'upstream_error';active.modelError=m.errorCode;save();}}
const server=createServer(async(req,res)=>{try{
 if(!['/responses','/models'].includes(req.url.split('?')[0])){res.writeHead(404).end();return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
 const headers={...req.headers};for(const k of ['host','connection','content-length','upgrade','transfer-encoding'])delete headers[k];
 const m=req.method==='POST'?metric(JSON.parse(body), 'http',body.length):null;
 const up=await request(bridge.baseUrl+req.url,{method:req.method,headers,body:body.length?body:undefined,dispatcher,bodyTimeout:0,headersTimeout:120000});
 res.writeHead(up.statusCode,{'content-type':up.headers['content-type']??'text/event-stream'});
 if(m)m.httpStatus=up.statusCode;let pending='';
 for await(const c of up.body){res.write(c);if(m){m.responseBytes+=c.length;pending+=c.toString();let idx;while((idx=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,idx);pending=pending.slice(idx+2);for(const l of block.split('\n'))if(l.startsWith('data: ')){try{event(m,JSON.parse(l.slice(6)))}catch{}}}}}
 if(m&&!m.totalMs){m.totalMs=performance.now()-m.start;m.status='incomplete';save();}res.end();
 }catch(e){if(active)active.error='observer_http_'+(e.code??e.name);save();res.destroy();}});
const wss=new WebSocketServer({noServer:true,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
 socket.on('error',()=>socket.destroy());
 if(active.mode==='http'){active.upgradeRejected=(active.upgradeRejected??0)+1;socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
 if(req.url!=='/responses'){socket.destroy();return;}
 const headers={...req.headers};for(const k of Object.keys(headers))if(['host','connection','upgrade'].includes(k)||k.startsWith('sec-websocket'))delete headers[k];
 const t=performance.now(),upstream=new WebSocket(bridge.baseUrl.replace('http:','ws:')+'/responses',{headers,perMessageDeflate:false});
 let client,m,metadata;
 upstream.on('upgrade',res=>metadata=res.headers);
 upstream.on('open',()=>{
  active.wsHandshakeMs=performance.now()-t;active.wsEstablished=true;
  const state=lines=>{for(const name of ['x-codex-turn-state','x-codex-websocket-max-message-bytes','x-models-etag','x-reasoning-included','openai-model'])if(metadata[name])lines.push(name+': '+metadata[name]);};
  wss.on('headers',state);
  try{wss.handleUpgrade(req,socket,head,ws=>{
   client=ws;
   ws.on('message',data=>{const v=JSON.parse(data);if(v.type==='response.create')m=metric(v,'websocket',data.length);upstream.send(data.toString());});
   ws.on('error',()=>upstream.terminate());ws.on('close',()=>upstream.terminate());
  });}finally{wss.off('headers',state);}save();
 });
 upstream.on('message',data=>{if(m){m.responseBytes+=data.length;event(m,JSON.parse(data));}if(client?.readyState===WebSocket.OPEN)client.send(data.toString());});
 upstream.on('unexpected-response',(_req,res)=>{active.wsHttpStatus=res.statusCode;save();res.resume();socket.end('HTTP/1.1 '+res.statusCode+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
 upstream.on('error',e=>{active.wsError=e.code??e.name;save();socket.destroy();});
 upstream.on('close',()=>{client?.terminate();socket.destroy();});socket.on('close',()=>upstream.terminate());
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const toml=v=>v&&typeof v==='object'?'{'+Object.entries(v).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(v);
async function run(mode,size,repeat){
 context.signal.throwIfAborted();
 active={mode,size,repeat,requests:[],turns:[]};results.push(active);save();
 const home=join(priv,mode+'-'+size+'-'+repeat);for(const d of ['home','codex','workspace','tmp'])mkdirSync(join(home,d),{recursive:true,mode:0o700});
 writeFileSync(join(home,'codex/auth.json'),auth,{mode:0o600});
 const settings={project_doc_max_bytes:0,model:'gpt-6.1-terra',model_reasoning_effort:'high',model_provider:'openai',openai_base_url:origin,cli_auth_credentials_store:'file',approval_policy:'never',web_search:'disabled','features.unbounded_connection_retries':false,'features.enable_request_compression':false,'features.memories':false,'features.memories_generate':false,'features.apps':false,'features.plugins':false,'features.hooks':false,'features.shell_tool':false,'features.skip_host_skill_discovery':true,'features.multi_agent':false,'analytics.enabled':false,'feedback.enabled':false};
 child=spawn(binary,['app-server','--stdio',...Object.entries(settings).flatMap(([k,v])=>['-c',k+'='+toml(v)])],{cwd:join(home,'workspace'),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(home,'home'),CODEX_HOME:join(home,'codex'),TMPDIR:join(home,'tmp'),...proxyEnv,NO_PROXY:[proxyEnv.NO_PROXY??proxyEnv.no_proxy,'127.0.0.1,localhost'].filter(Boolean).join(',')}});
 child.stderr.resume();child.stdin.on('error',()=>{});const current=child;const exit=new Promise(r=>{current.once('exit',r);current.once('error',r);});const pending=new Map();
 const stopped=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('isolated_engine_exited'));}pending.clear();};current.once('exit',stopped);current.once('error',stopped);let sequence=0,completed,toolCalls=0;
 createInterface({input:child.stdout}).on('line',line=>{let v;try{v=JSON.parse(line)}catch{return;}
 if(v.method&&v.id!==undefined){if(v.method.includes('tool')&&v.method.includes('call')){toolCalls++;child.stdin.write(JSON.stringify({id:v.id,result:{contentItems:[{type:'inputText',text:'42'}],success:true}})+'\n');}else child.stdin.write(JSON.stringify({id:v.id,error:{code:-32601,message:'unsupported benchmark operation'}})+'\n');}
 else if(pending.has(v.id)){const p=pending.get(v.id);pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error('rpc_'+v.error.code+(/Input exceeds the maximum length/.test(v.error.message)?'_native_input_length_limit':''))):p.resolve(v.result);}
 else if(v.method==='turn/completed')completed=v.params.turn;
 });
 function rpc(method,params={}){return new Promise((resolve,reject)=>{context.signal.throwIfAborted();const id=++sequence,timer=setTimeout(()=>reject(Error('rpc_timeout_'+method)),30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
 try{
 await rpc('initialize',{clientInfo:{name:'homer-transport-benchmark',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 await rpc('model/list',{includeHidden:true});
 const started=await rpc('thread/start',{model:'gpt-6.1-terra',cwd:join(home,'workspace'),approvalPolicy:'never',sandbox:'read-only',environments:[],developerInstructions:'This is an isolated synthetic transport benchmark. Follow each short instruction exactly. Use only the benchmark_echo tool when requested. Never inspect files or use other tools.',dynamicTools:[{name:'benchmark_echo',description:'Return the synthetic constant 42.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
 await rpc('thread/settings/update',{threadId:started.thread.id,model:'gpt-6.1-terra',effort:'high',serviceTier:null});
 const corpus=size!=='short'?Array.from({length:size==='realistic'?28000:2000},(_,i)=>'Synthetic row '+i+': blue square green circle orange triangle.').join('\n'):'';
 if(size==='realistic')await rpc('thread/inject_items',{threadId:started.thread.id,items:[{type:'message',role:'user',content:[{type:'input_text',text:corpus}]}]});
 const prompts=[(size==='realistic'?'':corpus)+'\nReply with only READY. Do not use tools.', 'Call benchmark_echo exactly once and then reply with only its returned number.', 'Reply with only DONE. Do not use tools.'];
 for(let i=0;i<prompts.length;i++){completed=undefined;const t0=performance.now();await rpc('turn/start',{threadId:started.thread.id,environments:[],input:prompts[i].match(/[\s\S]{1,400000}/g).map(text=>({type:'text',text}))});while(!completed&&!active.modelError&&performance.now()-t0<180000){context.signal.throwIfAborted();await new Promise(r=>setTimeout(r,20));}if(active.modelError)throw Error(active.modelError);active.turns.push({index:i,totalMs:performance.now()-t0,status:completed?.status??'timeout',toolCalls});save();if(completed?.status!=='completed')throw Error('turn_'+(completed?.status??'timeout'));}
 active.toolCalls=toolCalls;assert.equal(toolCalls,1);assert.equal(active.requests.filter(x=>x.status==='completed'&&x.usage?.output_tokens>0).length,4);if(mode==='ws')assert.equal(active.wsEstablished,true);
 }catch(e){active.error=e.message;save();throw e;}finally{current.kill('SIGTERM');const killTimer=setTimeout(()=>current.kill('SIGKILL'),3000);await exit;clearTimeout(killTimer);for(const p of pending.values())clearTimeout(p.timer);child=null;rmSync(home,{recursive:true,force:true});}
 save();console.log(JSON.stringify({mode,size,repeat,turns:active.turns,requests:active.requests.length,wsEstablished:active.wsEstablished,error:active.error}));
}
try{
 for(const size of ['long','realistic'])for(const repeat of [1,2])for(const mode of repeat===1?['http','ws']:['ws','http'])await run(mode,size,repeat);
 assert.equal(results.length,8);for(const row of results){assert.equal(row.error,undefined);assert.equal(row.turns.length,3);assert.equal(row.toolCalls,1);assert.ok(row.requests.every(q=>q.status==='completed'));if(row.mode==='ws')assert.ok(row.requests.every(q=>q.transport==='websocket'));}
 for(const size of ['long','realistic']){
  const inputs=results.filter(row=>row.size===size).map(row=>row.requests.find(q=>q.usage?.output_tokens>0).usage.input_tokens);
  assert.ok(Math.max(...inputs)-Math.min(...inputs)<=64,'initial contexts must match apart from ephemeral native metadata');
 }
}finally{
 try{
  child?.kill('SIGTERM');for(const c of wss.clients)c.terminate();server.closeAllConnections();
  const closed=await Promise.allSettled([new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),bridge.close(),dispatcher.close()]);
  if(closed.some(result=>result.status==='rejected'))throw Error('acceptance_close_failed');
 }finally{
  rmSync(priv,{recursive:true,force:true});save();
 }
 const sourceAuthUnchanged=readFileSync(authPath).equals(auth);
 console.log(JSON.stringify({metrics:join(root,'metrics.json'),sessions:results.length,sourceAuthUnchanged,privateRuntimeRemoved:true}));
 assert.equal(sourceAuthUnchanged,true,'source authorization changed during acceptance; external refresh must be checked');
}

});
