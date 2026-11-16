// Explicit fixed-native acceptance. No account, external provider or daily data.
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {CodexEngine} from '../src/engine.js';
import type {Config} from '../src/config.js';

const binary=process.env.HOMER_TEST_CODEX_BIN??'';
assert.ok(isAbsolute(binary),'explicit project-pinned native binary required');

async function fixture(t:TestContext,firstInput=1){
 const parent=resolve('.codex/scratch/usage-native');mkdirSync(parent,{recursive:true});
 const root=realpathSync(mkdtempSync(join(parent,'permissions-'))),home=join(root,'user'),codexHome=join(root,'codex'),cwd=join(root,'project'),outside=join(root,'outside');
 for(const path of [home,codexHome,cwd,outside,join(root,'tmp')])mkdirSync(path);
 const configText='sandbox_mode = "workspace-write"\napproval_policy = "on-request"\n[sandbox_workspace_write]\nnetwork_access = true\n[features]\napps = false\nplugins = false\nskip_host_skill_discovery = true\n[memories]\ngenerate_memories = false\nuse_memories = false\n';
 writeFileSync(join(codexHome,'config.toml'),configText);
 let requests=0,modelRequests=0,compactRequests=0;const requestShapes:unknown[]=[];
 const server=createServer(async(request,response)=>{
  if(request.method==='POST'&&request.url==='/v1/responses'){
   let body='';for await(const chunk of request)body+=chunk;
   const data=JSON.parse(body);
   if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){response.writeHead(403).end();return;}
   const compact=data.input?.some((item:any)=>item.type==='compaction_trigger');
   if(compact)compactRequests++;else modelRequests++;
   const model=data.model,id=String(modelRequests+compactRequests);
   requestShapes.push({model,inputItems:data.input?.length,compact});
   const item=compact?{id:'cmp-'+id,type:'compaction',encrypted_content:'synthetic-local-summary'}:{id:'msg-'+id,type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Synthetic saved history.',annotations:[]}]};
   const input=!compact&&modelRequests===1?firstInput:1;
   const result={id:'resp-'+id,object:'response',created_at:1,model,status:'completed',output:[item],usage:{input_tokens:input,output_tokens:1,total_tokens:input+1}};
   response.setHeader('Content-Type','text/event-stream');
   for(const event of [{type:'response.created',response:{...result,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:compact?item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:result}])response.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
   response.end();return;
  }
  requests++;response.end('SYNTHETIC_NETWORK');
 });
 server.on('connect',(_request,socket)=>socket.destroy());
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 assert.equal(await (await fetch(origin+'/probe')).text(),'SYNTHETIC_NETWORK');
 const previous=Object.fromEntries(['HOME','TMPDIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'].map(name=>[name,process.env[name]]));process.env.HOME=home;process.env.TMPDIR=join(root,'tmp');
 for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])process.env[name]=origin;
 process.env.NO_PROXY=process.env.no_proxy='127.0.0.1';
 const engines:CodexEngine[]=[];
 t.after(async()=>{
  let stopped=true;for(const engine of engines)stopped=await engine.close()&&stopped;
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
  for(const [name,value] of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;
  assert.ok(stopped,'native owners must exit before cleanup');rmSync(root,{recursive:true,force:true});
 });
 let startResponse:any;
 const open=async(role:'main'|'worker',threadId?:string,chatgpt=false)=>{
  const engine=new CodexEngine({workspace:cwd,runtime:join(root,'runtime'),codexHome,nativeCodexHome:codexHome,codexBin:binary,model:'gpt-6.1-sol',requiresOpenaiAuth:chatgpt,...(chatgpt?{desktopModelSource:'codex',pauseOldDesktopWork:true,desktopResources:{} as Config['desktopResources'],chatgpt:{main:{model:'gpt-6.1-sol',effort:'medium',serviceTier:null}}}:{baseUrl:origin+'/v1'}),fast:false,stopGraceMs:1000},{cwd,role,nativeTools:role,threadId,readRoots:[cwd],instructions:'Synthetic local permission verification.',tools:[]},async()=>{throw Error('unexpected_model_tool');});
  engine.on('spawn',()=>createInterface({input:(engine as any).child.stdout}).on('line',line=>{
   const result=JSON.parse(line).result;
   if(result?.thread&&result.approvalPolicy!==undefined&&result.sandbox)startResponse=result;
  }));
  const request=engine.request.bind(engine);
  engine.request=async(method,params)=>{
   if(chatgpt&&method==='thread/settings/update'){
    const models=await request('model/list',{includeHidden:true});
    assert.ok(models.data.some((model:any)=>model.model===(params as any).model),'synthetic provider must advertise the selected model: '+JSON.stringify(models.data.map((model:any)=>model.model)));
   }
   return request(method,params);
  };
  engines.push(engine);await engine.start();
  await engine.request('thread/memoryMode/set',{threadId:engine.threadId,mode:'disabled'});
  return engine;
 };
 return {cwd,outside,codexHome,configText,origin,open,requestShapes,get startResponse(){return startResponse;},get requests(){return requests;},get modelRequests(){return modelRequests;},get compactRequests(){return compactRequests;}};
}

test('explicit workspace permissions allow local work and network but deny outside writes without changing trust',{timeout:45000},async t=>{
 const f=await fixture(t),{cwd,outside,codexHome,configText,origin,open}=f;
 for(const role of ['main','worker'] as const){
  const engine=await open(role);
  assert.equal(f.startResponse.sandbox.type,'workspaceWrite');assert.equal(f.startResponse.approvalPolicy,'on-request');
  assert.equal(f.startResponse.sandbox.networkAccess,true);
  const config=await engine.request('config/read',{cwd,includeLayers:true});
  assert.equal(config.config.approval_policy,'on-request');
  const local=join(cwd,role+'.txt'),external=join(outside,role+'.txt');
  const inside=await engine.request('command/exec',{command:['/bin/sh','-c','printf SYNTHETIC_LOCAL > "$1"','fixture',local],cwd,timeoutMs:5000});
  assert.equal(inside.exitCode,0);assert.equal(readFileSync(local,'utf8'),'SYNTHETIC_LOCAL');
  const blocked=await engine.request('command/exec',{command:['/bin/sh','-c','printf SYNTHETIC_OUTSIDE > "$1"','fixture',external],cwd,timeoutMs:5000});
  assert.notEqual(blocked.exitCode,0);assert.equal(existsSync(external),false);
  const network=await engine.request('command/exec',{command:['/usr/bin/curl','--noproxy','*','--connect-timeout','1','--max-time','2',origin+'/probe'],cwd,timeoutMs:4000});
  assert.equal(network.exitCode,0);assert.equal(network.stdout,'SYNTHETIC_NETWORK');
  assert.equal(f.requests,role==='main'?2:3,'the sandboxed command must reach only the verified local server');
  assert.equal(readFileSync(join(codexHome,'config.toml'),'utf8'),configText,'thread start must not silently trust the project or rewrite settings');
  assert.ok(await engine.close());
 }
 assert.equal(f.modelRequests,0,'permission checks must not start generation');
 writeFileSync(join(codexHome,'config.toml'),configText.replace('workspace-write','read-only').replace('network_access = true','network_access = false'));
 const legacy=await open('main');
 assert.equal((await legacy.turn('Synthetic history before the explicit permission change.')).status,'completed');
 const threadId=legacy.threadId!;assert.ok(await legacy.close());
 writeFileSync(join(codexHome,'config.toml'),configText);
 const resumed=await open('main',threadId);
 assert.equal(f.startResponse.approvalPolicy,'on-request');
 assert.equal(f.startResponse.sandbox.type,'workspaceWrite','a restored thread must adopt the explicitly changed native config');
 assert.equal(f.startResponse.sandbox.networkAccess,true);
 assert.equal(resumed.threadId,threadId);assert.equal(f.modelRequests,1,'resume must preserve the thread without creating a new model turn');
 assert.equal(readFileSync(join(codexHome,'config.toml'),'utf8'),configText);
});

for(const configured of [false,true])test('ChatGPT Main preserves native '+(configured?'explicit':'default')+' compaction on the same thread',{timeout:45000},async t=>{
 const f=await fixture(t,210000);
 const config='openai_base_url = '+JSON.stringify(f.origin+'/v1')+'\n'+(configured?'model_auto_compact_token_limit = 150000\nmodel_auto_compact_token_limit_scope = "total"\n':'')+f.configText;
 writeFileSync(join(f.codexHome,'config.toml'),config);
 writeFileSync(join(f.codexHome,'auth.json'),JSON.stringify({OPENAI_API_KEY:'synthetic-local-only'}),{mode:0o600});
 const engine=await f.open('main',undefined,true),threadId=engine.threadId!;
 assert.equal(f.startResponse.modelProvider,'openai');
 assert.equal((await engine.turn('Synthetic original user authority. Do not publish or pay.')).status,'completed');
 const first=(await engine.request('thread/read',{threadId,includeTurns:true})).thread,before=readFileSync(first.path);
 const continued=await engine.turn('Continue the same authorized local task.');
 assert.equal(continued.status,'completed',JSON.stringify({shapes:f.requestShapes,compactRequests:f.compactRequests,error:continued.errorCode}));
 const thread=(await engine.request('thread/read',{threadId,includeTurns:true})).thread;
 assert.equal(thread.id,threadId);assert.equal(thread.path,first.path);
 const after=readFileSync(thread.path);assert.ok(after.subarray(0,before.length).equals(before));
 const records=after.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(records.filter(item=>item.type==='compacted').length,configured?1:0);
 assert.equal(f.modelRequests,2);assert.equal(f.compactRequests,configured?1:0);
 assert.equal(readFileSync(join(f.codexHome,'config.toml'),'utf8'),config,'Main must not rewrite native context settings');
});

for(const mode of ['read-only','workspace-write'] as const)test('trusted project '+mode+' without network narrows a saved lower user full-access profile',{timeout:45000},async t=>{
 const f=await fixture(t);
 mkdirSync(join(f.cwd,'.git'));mkdirSync(join(f.cwd,'.codex'));
 const config='default_permissions = ":danger-full-access"\n'+f.configText+'\n[projects.'+JSON.stringify(f.cwd)+']\ntrust_level = "trusted"\n';
 writeFileSync(join(f.codexHome,'config.toml'),config);
 const original=await f.open('main');assert.equal(f.startResponse.sandbox.type,'dangerFullAccess');
 assert.equal((await original.turn('Synthetic saved thread before narrowing permissions.')).status,'completed');
 const threadId=original.threadId!;assert.ok(await original.close());
 const projectConfig='sandbox_mode = "'+mode+'"\n[sandbox_workspace_write]\nnetwork_access = false\n';writeFileSync(join(f.cwd,'.codex/config.toml'),projectConfig);
 const resumed=await f.open('main',threadId);
 assert.equal(f.startResponse.sandbox.type,mode==='read-only'?'readOnly':'workspaceWrite','higher project restrictions must survive native resume');
 if(mode==='workspace-write'){
  assert.equal(f.startResponse.sandbox.networkAccess,false);
  const network=await resumed.request('command/exec',{command:['/usr/bin/curl','--noproxy','*','--connect-timeout','1','--max-time','2',f.origin+'/probe'],cwd:f.cwd,timeoutMs:4000});
  assert.notEqual(network.exitCode,0);assert.equal(f.requests,1);
 }
 assert.equal(resumed.threadId,threadId);assert.equal(f.modelRequests,1);
 assert.equal(readFileSync(join(f.codexHome,'config.toml'),'utf8'),config);
 assert.equal(readFileSync(join(f.cwd,'.codex/config.toml'),'utf8'),projectConfig);
});
