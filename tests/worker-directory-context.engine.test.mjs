import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as requestHttp} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync,truncateSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {peer,metadata} from './fixtures/native-main-resume.mjs';

const moduleUrl=process.env.HOMER_TEST_SERVICE_MODULE,bin=process.env.HOMER_TEST_CODEX_BIN;
assert.ok(moduleUrl?.startsWith('file://'),'explicit service module required');
assert.ok(bin&&isAbsolute(bin),'explicit fixed native binary required');
const {Homer}=await import(moduleUrl);
const {CodexEngine}=await import(new URL('./engine.js',moduleUrl));
const {MAIN_DYNAMIC_TOOLS,MAIN_TOOLS_HASH}=await import(new URL('./recursive-tools.js',moduleUrl));
const {loadPrompts}=await import(new URL('./prompts.js',moduleUrl));
const {prepareWorkerProjectRoot}=await import(new URL('./worker-project-root.js',moduleUrl));
const toml=value=>value&&typeof value==='object'&&!Array.isArray(value)?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(value);
const configText=value=>Object.entries(value).map(([k,v])=>k+'='+toml(v)).join('\n')+'\n';

async function until(predicate){const end=Date.now()+15000;while(Date.now()<end){const value=predicate();if(value)return value;await delay(20);}assert.fail('isolated native condition timed out');}
async function fixture(t){
 // Outside the checkout: its real Git ancestor must not affect the no-root case.
 const root=realpathSync(mkdtempSync(join(process.platform==='darwin'?realpathSync('/tmp'):tmpdir(),'hm-dir-'))),home=join(root,'codex'),user=join(root,'user'),cwd=join(user,'Main');
 for(const path of [home,cwd,join(root,'tmp'),join(root,'host-home'),join(root,'runtime')])mkdirSync(path,{recursive:true,mode:0o700});
 const requests=[],waiting=[];
 let hold=false;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/responses')return res.writeHead(403).end();
  req.setEncoding('utf8');
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);requests.push(data);
  const finish=()=>{
   const n=String(requests.length),item={id:'msg-'+n,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic local response.',annotations:[]}]};
   const response={id:'resp-'+n,object:'response',created_at:1,model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
   res.setHeader('Content-Type','text/event-stream');
   for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();
  };
  if(hold)waiting.push(finish);else finish();
 });
 server.on('connect',(_req,socket)=>{
  socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const previous={};for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NO_PROXY','no_proxy']){previous[name]=process.env[name];process.env[name]=name.toLowerCase()==='no_proxy'?'127.0.0.1,localhost':origin;}
 const nativeConfig={analytics:{enabled:false},feedback:{enabled:false},check_for_update_on_startup:false,features:{skip_host_skill_discovery:true},memories:{generate_memories:false,use_memories:false}};
 const userConfig=join(home,'config.toml');writeFileSync(userConfig,configText(nativeConfig));
 const config={workspace:cwd,runtime:join(root,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:bin,baseUrl:origin+'/v1',model:'gpt-6.1-sol',requiresOpenaiAuth:false,stopGraceMs:1000};
 const engines=[];
 let cleaned=false;
 const cleanup=async()=>{
  if(cleaned)return;cleaned=true;
  for(const finish of waiting.splice(0))finish();
  let stopped=true;for(const engine of engines)stopped=await engine.close()&&stopped;
  server.closeAllConnections();await new Promise(r=>server.close(r));
  for(const [name,value]of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;
  assert.ok(stopped,'native process shutdown must be confirmed before removing fixture');rmSync(root,{recursive:true,force:true});
 };
 t.after(cleanup);
 return {root,home,user,cwd,requests,engines,config,nativeConfig,userConfig,cleanup,server,baseUrl:origin+'/v1',hold(value){hold=value;},release(){for(const finish of waiting.splice(0))finish();}};
}

test('the synthetic directory provider preserves UTF-8 split between HTTP chunks',{timeout:15000},async t=>{
 const f=await fixture(t),text='目录规则_UTF8';
 const body=Buffer.from(JSON.stringify({model:'synthetic',input:[{role:'developer',content:[{type:'input_text',text}]}]}));
 const split=body.indexOf(Buffer.from('目'))+1;assert.ok(split>0);
 const firstChunk=new Promise(resolve=>f.server.once('request',req=>req.once('readable',resolve)));
 let send;
 const completed=new Promise((resolve,reject)=>{
  send=requestHttp(f.baseUrl+'/responses',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',resolve);res.on('error',reject);});
  send.setTimeout(5000,()=>send.destroy(Error('synthetic_http_timeout')));send.on('error',reject);send.write(body.subarray(0,split));
 });
 await Promise.race([firstChunk,completed]);await new Promise(resolve=>setImmediate(resolve));send.end(body.subarray(split));await completed;
 assert.equal(f.requests.length,1);assert.ok(f.requests[0].input[0].content[0].text===text,'split UTF-8 bytes must preserve the request text');
});

test('native new and legacy Main expose and call the new MCP tool on the same thread and retain dynamic declarations',{timeout:90000},async t=>{
 for(const legacy of [false,true]){
  const f=await fixture(t);let seed,oldThread;
  if(legacy){
   seed=peer({...f,calls:[],provider:'homer'},bin,f.baseUrl);await seed.init();
   const {thread}=await seed.request('thread/start',{model:'gpt-6.1-sol',modelProvider:'homer',cwd:f.cwd,approvalPolicy:'on-request',sandbox:'read-only',environments:[],config:{mcp_servers:{}},developerInstructions:'LEGACY_DIRECTORY_MAIN',dynamicTools:MAIN_DYNAMIC_TOOLS});oldThread=thread;
   const cursor=seed.events.length;await seed.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Synthetic saved Main history.'}]});
   await until(()=>seed.events.slice(cursor).some(e=>e.method==='turn/completed'));await seed.close();seed=undefined;
  }
  let main,mainHandle,listingAvailable=true;const workerInventories=[];
  const app=new Homer(f.config,async()=>{},(options,handle)=>{
   const engine=new CodexEngine(f.config,options,handle);
   if(options.nativeTools==='main'){main=engine;mainHandle=handle;}
   else{const start=engine.start.bind(engine);engine.start=async()=>{const id=await start();workerInventories.push(await engine.request('mcpServerStatus/list',{threadId:id,detail:'full',limit:100}));return id;};}
   f.engines.push(engine);return engine;
  },[],async(includeFolders=true)=>{if(includeFolders&&!listingAvailable)throw Error('synthetic_known_folder_unavailable');return {home:f.user,folders:[]};});
  try{
   if(oldThread){app.store.setMeta('mainThread',oldThread.id);app.store.setMeta('mainToolsHash',MAIN_TOOLS_HASH);}
   await app.start();assert.equal(main.version,'0.171.0-alpha.7');if(oldThread)assert.equal(main.threadId,oldThread.id);
   const inventory=await main.request('mcpServerStatus/list',{threadId:main.threadId,detail:'full',limit:100});assert.ok(inventory.data.find(e=>e.name==='homer_interactions')?.tools.list_work_directories);
   const project=join(f.user,'Projects/atlas');mkdirSync(project,{recursive:true});writeFileSync(join(project,'TEAM_GUIDE.md'),'SYNTHETIC_PRIVATE_BODY');
   f.hold(true);const count=f.requests.length;app.submitMessage({requestId:'native-directory-'+legacy,text:'Find the atlas work location for a later Worker.'});
   await until(()=>f.requests.length>count);const mainRequest=f.requests[count];
   const developer=(mainRequest.input??[]).filter(item=>item.role==='developer').flatMap(item=>item.content??[]).map(part=>part.text??'');
   const currentPrompt=loadPrompts().main;assert.equal(developer.filter(text=>text.includes(currentPrompt)).length,1,'the complete current Main prompt must reach the native request once');
   if(oldThread)assert.ok(developer.findIndex(text=>text.includes(currentPrompt))>developer.findIndex(text=>text.includes('LEGACY_DIRECTORY_MAIN')),'the adopted prompt must follow any replayed legacy guidance');
   const result=await main.request('mcpServer/tool/call',{threadId:main.threadId,server:'homer_interactions',tool:'list_work_directories',arguments:{}});
   assert.notEqual(result.isError,true);const reference=JSON.parse(result.content[0].text);assert.equal(reference.complete,true);assert.match(reference.directoryReference,/atlas/);assert.doesNotMatch(result.content[0].text,/SYNTHETIC_PRIVATE_BODY/);
   let receipt;
   if(!legacy){
    listingAvailable=false; // Candidate folder lookup must not become a Worker prerequisite.
    const work=join(f.user,'Documents/worker/current');mkdirSync(work,{recursive:true});writeFileSync(join(f.user,'Documents/worker/AGENTS.md'),'SERVICE_WORKER_PARENT_GUIDANCE');
    receipt=await mainHandle({threadId:main.threadId,turnId:main.turnId,callId:'synthetic-worker-directory',tool:'worker_open',arguments:{message:'Synthetic native directory verification only.',title:'Directory verification',workingDirectory:work}});
   }
   f.release();f.hold(false);await app.idle();
   assert.equal(app.store.meta('mainToolsHash'),MAIN_TOOLS_HASH);assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
   const {thread}=await main.request('thread/read',{threadId:main.threadId,includeTurns:true});assert.deepEqual(metadata(f,thread.path).dynamic_tools,MAIN_DYNAMIC_TOOLS);
   assert.match(JSON.stringify(mainRequest.input),/list_work_directories/);
   if(oldThread){assert.equal(thread.path,oldThread.path);assert.match(JSON.stringify(mainRequest.input),/Synthetic saved Main history/);}
   if(receipt){
    assert.equal(app.tasks.run(receipt.workerId).workingDirectory,join(f.user,'Documents/worker/current'));
    assert.ok(f.requests.some(request=>JSON.stringify(request.input).includes('SERVICE_WORKER_PARENT_GUIDANCE')),'actual Homer Worker cold preparation must load parent guidance');
    assert.equal(readFileSync(join(f.user,'.homer-project-root'),'utf8'),'');
    assert.equal(workerInventories.length,1);const workerInventory=workerInventories[0];assert.equal(workerInventory.data.find(e=>e.name==='homer_interactions')?.tools.list_work_directories,undefined);
   }
  }finally{f.release();await app.close();await seed?.close();await f.cleanup();}
 }
});

for(const [history,checkpoint] of [['full',null],['compacted',null],['interrupted','initial'],['compact-first','initial'],['interrupted','after-history'],['compact-first','after-history']])test(`Homer prompt injection preserves ${history} native history${checkpoint?' ('+checkpoint+' checkpoint)':''}`,{timeout:60000},async t=>{
 const f=await fixture(t),current=loadPrompts().main;
 const directoryRule=current.split('\n').find(line=>line.includes('worker_open.workingDirectory'));assert.ok(directoryRule);
 const legacy='SYNTHETIC_LEGACY_DIRECTORY_MAIN\n目录不明确时可先在默认目录派工，由 Worker 自己寻找项目。\n默认工作目录：'+f.cwd+'。Worker 可选择获准的项目目录。';
 const savedUser='SYNTHETIC_DURABLE_DIRECTORY_USER',savedAssistant='SYNTHETIC_DURABLE_DIRECTORY_ASSISTANT';
 const injections=[],copies=[];let seed,app,main,threadId;
 const open=()=>new Homer(f.config,async()=>{},(options,handle)=>{
  assert.equal(options.nativeTools,'main');assert.equal(options.threadId,threadId);
  const engine=new CodexEngine(f.config,options,handle),request=engine.request.bind(engine);
  engine.request=async(method,params)=>{const result=await request(method,params);if(method==='thread/inject_items')injections.push(params);return result;};
  main=engine;f.engines.push(engine);return engine;
 },[],async()=>({home:f.user,folders:[]}));
 const promptHash=prompt=>createHash('sha256').update(JSON.stringify([threadId,prompt])).digest('hex');
 function checkRequest(request,phase){
  assert.ok(request,'the synthetic provider must receive the native request');
  const developer=(request.input??[]).filter(item=>item.role==='developer').flatMap(item=>item.content??[]).map(part=>part.text??'').join('\n');
  const count=developer.split(current).length-1;assert.ok(count>=1,'the complete current Main prompt must reach the native request');
  assert.ok(developer.includes(directoryRule),'the entire directory rule must reach the native request');
  assert.ok(developer.lastIndexOf(current)>developer.lastIndexOf('SYNTHETIC_LEGACY_DIRECTORY_MAIN'),'current guidance must follow any replayed legacy guidance');
  const input=JSON.stringify(request.input);
  if(history==='full'||checkpoint==='after-history'&&(history==='interrupted'||phase==='compact-before-business'))for(const marker of [savedUser,savedAssistant])assert.ok(input.includes(marker),'uncompacted business history must remain in the request');
  if(history==='compacted'||history==='compact-first'&&phase!=='compact-before-business')assert.ok(input.includes('Synthetic local response.'),'the native compaction output must remain in the request');
  copies.push({phase,currentPromptCopies:count,legacyPromptCopies:developer.split('SYNTHETIC_LEGACY_DIRECTORY_MAIN').length-1});
 }
 async function business(text,phase){
  const count=f.requests.length;await app.message(text);
  checkRequest(f.requests.slice(count).find(request=>JSON.stringify(request.input).includes(text)),phase);
 }
 try{
  seed=peer({...f,calls:[],provider:'homer'},bin,f.baseUrl);await seed.init();
  const {thread}=await seed.request('thread/start',{model:'gpt-6.1-sol',modelProvider:'homer',cwd:f.cwd,approvalPolicy:'on-request',sandbox:'read-only',environments:[],config:{mcp_servers:{}},developerInstructions:legacy,dynamicTools:MAIN_DYNAMIC_TOOLS});threadId=thread.id;
  // Native injection persists its own checkpoint before these history items.
  await seed.request('thread/inject_items',{threadId,items:[{type:'message',role:'user',content:[{type:'input_text',text:savedUser}]},{type:'message',role:'assistant',content:[{type:'output_text',text:savedAssistant}]}]});
  const {attachment}=await seed.request('thread/attachment/add',{threadId,attachmentType:'synthetic.document',identityKey:'directory-resume-artifact',payload:{name:'fixture.txt',contents:'SYNTHETIC_DIRECTORY_ATTACHMENT'}});
  let cursor=seed.events.length;
  await seed.request('turn/start',{threadId,input:[{type:'text',text:'Synthetic legacy directory turn.'}]});
  await until(()=>seed.events.slice(cursor).some(event=>event.method==='turn/completed'&&event.params.turn.status==='completed'));
  if(history==='compacted'){
   cursor=seed.events.length;await seed.request('thread/compact/start',{threadId});
   await until(()=>seed.events.slice(cursor).some(event=>event.method==='turn/completed'&&event.params.turn.status==='completed'));
   assert.ok(seed.events.slice(cursor).some(event=>event.method==='item/completed'&&event.params.item.type==='contextCompaction'));
  }
  const before=(await seed.request('thread/read',{threadId,includeTurns:true})).thread;
  await seed.close();seed=undefined;
  let prefix=readFileSync(before.path);
  if(history==='interrupted'||history==='compact-first'){
   const lines=prefix.toString('utf8').trimEnd().split('\n'),index=checkpoint==='initial'?lines.findIndex(line=>JSON.parse(line).type==='turn_context'):lines.findLastIndex(line=>JSON.parse(line).type==='turn_context');assert.ok(index>0);
   prefix=Buffer.from(lines.slice(0,index).join('\n')+'\n');truncateSync(before.path,prefix.length);
   assert.ok(prefix.toString('utf8').trimEnd().split('\n').some(line=>JSON.parse(line).payload?.content?.some(part=>part.text===legacy)),'the interrupted prefix must retain the old native context');
  }
  for(const marker of [savedUser,savedAssistant])assert.equal(prefix.includes(Buffer.from(marker)),checkpoint!=='initial','only the initial checkpoint precedes all saved business messages');
  if(history==='compacted')assert.ok(prefix.toString('utf8').split('\n').filter(Boolean).some(line=>JSON.parse(line).type==='compacted'));
  async function checkState(){
   assert.equal(main.threadId,threadId);assert.equal(main.version,'0.171.0-alpha.7');
   const after=(await main.request('thread/read',{threadId,includeTurns:true})).thread;assert.equal(after.path,before.path);
   assert.ok(readFileSync(after.path).subarray(0,prefix.length).equals(prefix),'the durable rollout prefix must remain byte-for-byte intact');
   assert.deepEqual(metadata(f,after.path).dynamic_tools,MAIN_DYNAMIC_TOOLS);
   assert.deepEqual((await main.request('thread/attachment/list',{threadId})).data,[attachment]);
   assert.equal(app.store.meta('mainThread'),threadId);assert.equal(app.store.meta('mainToolsHash'),MAIN_TOOLS_HASH);assert.equal(app.store.meta('mainPromptHash'),promptHash(current));
  }
  app=open();app.store.setMeta('mainThread',threadId);app.store.setMeta('mainToolsHash',MAIN_TOOLS_HASH);app.store.setMeta('mainPromptHash',promptHash(legacy));
  let count=f.requests.length;await app.start();assert.equal(f.requests.length,count,'restoration and injection must not make model requests');
  assert.equal(injections.length,1,'Homer must adopt the changed prompt exactly once');
  assert.equal(injections[0].threadId,threadId);assert.equal(injections[0].items.length,1);assert.equal(injections[0].items[0].role,'developer');assert.ok(injections[0].items[0].content[0].text.endsWith(current));
  await checkState();
  if(history==='compact-first'){
   count=f.requests.length;await main.compact();await until(()=>!main.nativeBusy);
   checkRequest(f.requests[count],'compact-before-business');
  }
  await business('SYNTHETIC_FIRST_DIRECTORY_RESUME','first-business');await checkState();
  await app.close({requireAllOwnersConfirmed:true});app=undefined;
  app=open();count=f.requests.length;await app.start();assert.equal(f.requests.length,count,'cold restart must not make model requests');
  assert.equal(injections.length,1,'acknowledged adoption must survive cold restart without reinjection');
  await business('SYNTHETIC_RESTARTED_DIRECTORY_RESUME','after-cold-restart');await checkState();
  t.diagnostic(JSON.stringify({history,checkpoint,requests:copies,injections:injections.length,originalThread:true,durableHistoryPrefix:true,savedBusinessHistory:checkpoint!=='initial',attachments:true,dynamicTools:true}));
 }finally{await app?.close({requireAllOwnersConfirmed:true});await seed?.close();await f.cleanup();}
});

test('native Worker root preparation preserves hierarchy, Git/custom roots, trust, cold resume and failure before model',{timeout:90000},async t=>{
 const f=await fixture(t),customer=join(f.user,'Documents/customer'),cwd=join(customer,'contracts/current');mkdirSync(cwd,{recursive:true});
 for(const [path,text]of [[f.user,'ROOT_HOME_GUIDANCE'],[customer,'ROOT_CUSTOMER_GUIDANCE'],[join(customer,'contracts'),'ROOT_CONTRACT_GUIDANCE'],[cwd,'ROOT_CURRENT_GUIDANCE']])writeFileSync(join(path,'AGENTS.md'),text);
 mkdirSync(join(customer,'sibling'));writeFileSync(join(customer,'sibling/AGENTS.md'),'ROOT_SIBLING_MUST_NOT_LOAD');
 const control=new CodexEngine(f.config,{cwd:f.cwd,readRoots:[],instructions:'Configuration only.',tools:[],controlOnly:true},async()=>{throw Error('no_tools');});f.engines.push(control);await control.start();
 async function open(path,threadId){
  const e=new CodexEngine(f.config,{role:'worker',cwd:path,readRoots:[path],instructions:'Synthetic Worker verification.',tools:[],nativeTools:'worker',threadId,
   prepareProjectContext:async(path,signal)=>prepareWorkerProjectRoot(path,f.user,(await control.request('config/read',{cwd:path,includeLayers:true})).config.project_root_markers,()=>!signal.aborted)},async()=>{throw Error('no_tools');});f.engines.push(e);await e.start();assert.equal(e.version,'0.171.0-alpha.7');return e;
 }
 async function turn(e,text='Synthetic local task.'){
  const count=f.requests.length;assert.equal((await e.turn(text)).status,'completed');
  const task=f.requests.slice(count).find(request=>JSON.stringify(request.input).includes(text));assert.ok(task,'local task request must reach only the synthetic provider');return JSON.stringify(task.input);
 }
 let e=await open(cwd);const first=await turn(e);
 for(const marker of ['ROOT_HOME_GUIDANCE','ROOT_CUSTOMER_GUIDANCE','ROOT_CONTRACT_GUIDANCE','ROOT_CURRENT_GUIDANCE'])assert.match(first,new RegExp(marker));assert.doesNotMatch(first,/ROOT_SIBLING_MUST_NOT_LOAD/);
 assert.equal(readFileSync(join(f.user,'.homer-project-root'),'utf8'),'');const id=e.threadId;assert.ok(await e.close());
 e=await open(cwd,id);assert.equal(e.threadId,id);assert.match(await turn(e),/ROOT_CURRENT_GUIDANCE/);assert.ok(await e.close());
 writeFileSync(join(cwd,'AGENTS.override.md'),'ROOT_CURRENT_OVERRIDE');e=await open(cwd);const overridden=await turn(e);assert.match(overridden,/ROOT_CURRENT_OVERRIDE/);assert.doesNotMatch(overridden,/ROOT_CURRENT_GUIDANCE/);assert.match(overridden,/ROOT_CUSTOMER_GUIDANCE/);assert.ok(await e.close());rmSync(join(cwd,'AGENTS.override.md'));
 const git=join(f.user,'GitProject'),sub=join(git,'sub');mkdirSync(sub,{recursive:true});writeFileSync(join(git,'.git'),'gitdir: synthetic');writeFileSync(join(git,'AGENTS.md'),'ROOT_GIT_GUIDANCE');
 e=await open(sub);const gitInput=await turn(e);assert.match(gitInput,/ROOT_GIT_GUIDANCE/);assert.doesNotMatch(gitInput,/ROOT_HOME_GUIDANCE/);assert.ok(await e.close());
 const custom=join(f.user,'CustomProject'),deep=join(custom,'nested');mkdirSync(deep,{recursive:true});writeFileSync(join(custom,'.custom-root'),'');writeFileSync(join(custom,'AGENTS.md'),'ROOT_CUSTOM_GUIDANCE');
 f.nativeConfig.project_root_markers=['.custom-root'];writeFileSync(f.userConfig,configText(f.nativeConfig));
 e=await open(deep);const effective=await e.request('config/read',{cwd:deep,includeLayers:true});assert.deepEqual(effective.config.project_root_markers,['.custom-root','.git','.homer-project-root']);const customInput=await turn(e);assert.match(customInput,/ROOT_CUSTOM_GUIDANCE/);assert.doesNotMatch(customInput,/ROOT_HOME_GUIDANCE/);assert.ok(await e.close());
 const outside=join(f.root,'outside/child');mkdirSync(outside,{recursive:true});writeFileSync(join(f.root,'outside/AGENTS.md'),'ROOT_OUTSIDE_PARENT_MUST_NOT_LOAD');writeFileSync(join(outside,'AGENTS.md'),'ROOT_OUTSIDE_CURRENT');
 e=await open(outside);const outsideInput=await turn(e);assert.match(outsideInput,/ROOT_OUTSIDE_CURRENT/);assert.doesNotMatch(outsideInput,/ROOT_OUTSIDE_PARENT_MUST_NOT_LOAD/);assert.ok(await e.close());
 const projectCodex=join(customer,'.codex');mkdirSync(projectCodex);writeFileSync(join(projectCodex,'config.toml'),'project_doc_fallback_filenames = ["TEAM_GUIDE.md"]\n');
 const configBefore=readFileSync(f.userConfig,'utf8');e=await open(cwd);const untrusted=await e.request('config/read',{cwd,includeLayers:true});assert.ok(untrusted.layers.some(layer=>layer.name.type==='project'&&layer.disabledReason));assert.equal(readFileSync(f.userConfig,'utf8'),configBefore);assert.ok(await e.close());
 f.nativeConfig.projects={[f.user]:{trust_level:'trusted'}};writeFileSync(f.userConfig,configText(f.nativeConfig));
 const skill=join(customer,'.agents/skills/directory-native');mkdirSync(skill,{recursive:true});writeFileSync(join(skill,'SKILL.md'),'---\nname: directory-native\ndescription: Synthetic project directory skill\n---\nSYNTHETIC_SKILL_BODY\n');
 e=await open(cwd);const trusted=await e.request('config/read',{cwd,includeLayers:true});assert.deepEqual(trusted.config.project_doc_fallback_filenames,['TEAM_GUIDE.md']);assert.ok(trusted.layers.some(layer=>layer.name.type==='project'&&!layer.disabledReason));
 const listed=await e.request('skills/list',{cwds:[cwd],forceReload:true});assert.ok(listed.data.flatMap(entry=>entry.skills??[]).some(entry=>entry.name==='directory-native'));assert.ok(await e.close());
 const trustedBefore=readFileSync(f.userConfig,'utf8');writeFileSync(f.userConfig,'invalid = [');const configFailureRequests=f.requests.length;await assert.rejects(open(cwd));assert.equal(f.requests.length,configFailureRequests);writeFileSync(f.userConfig,trustedBefore);
 rmSync(join(f.user,'.homer-project-root'));mkdirSync(join(f.user,'.homer-project-root'));const before=f.requests.length;await assert.rejects(open(cwd),/worker_project_root_unavailable/);assert.equal(f.requests.length,before);
 // A valid Git root continues even when the unrelated fallback is unusable.
 f.nativeConfig.project_root_markers=['.not-dir/root',...f.nativeConfig.project_root_markers];writeFileSync(join(sub,'.not-dir'),'not a directory');writeFileSync(f.userConfig,configText(f.nativeConfig));const gitConfigBefore=readFileSync(f.userConfig,'utf8');
 e=await open(sub);assert.match(await turn(e),/ROOT_GIT_GUIDANCE/);assert.ok(await e.close());
 assert.equal(readFileSync(f.userConfig,'utf8'),gitConfigBefore);
});

test('a home fallback keeps native guidance inheritance for newly visible project-layer markers',{timeout:60000},async t=>{
 const f=await fixture(t),project=join(f.user,'Documents/customer'),cwd=join(project,'contracts');mkdirSync(join(project,'.codex'),{recursive:true});mkdirSync(cwd);
 writeFileSync(join(f.user,'.homer-project-root'),'');writeFileSync(join(cwd,'.project-only-root'),'');
 writeFileSync(join(f.user,'AGENTS.md'),'LAYER_HOME_GUIDANCE');writeFileSync(join(project,'AGENTS.md'),'LAYER_PARENT_GUIDANCE');writeFileSync(join(cwd,'AGENTS.md'),'LAYER_CURRENT_GUIDANCE');
 writeFileSync(join(project,'.codex/config.toml'),'project_root_markers = [".project-only-root"]\n');
 f.nativeConfig.projects={[f.user]:{trust_level:'trusted'}};
 f.nativeConfig.project_root_markers=['.git','.homer-project-root'];writeFileSync(f.userConfig,configText(f.nativeConfig));
 const open=async prepareProjectContext=>{const e=new CodexEngine(f.config,{role:'worker',cwd,readRoots:[cwd],instructions:'Synthetic project layer comparison.',tools:[],nativeTools:'worker',prepareProjectContext},async()=>{throw Error('no_tools');});f.engines.push(e);await e.start();return e;};
 const input=async e=>{const count=f.requests.length;await e.turn('Synthetic layer task.');const request=f.requests.slice(count).find(r=>JSON.stringify(r.input).includes('Synthetic layer task.'));assert.ok(request);return JSON.stringify(request.input);};
 let e=await open();const baselineConfig=await e.request('config/read',{cwd,includeLayers:true});
 assert.deepEqual(baselineConfig.config.project_root_markers,['.project-only-root']);assert.ok(baselineConfig.layers.some(layer=>layer.name.type==='project'&&!layer.disabledReason));
 const baseline=await input(e);assert.ok(await e.close());
 f.nativeConfig.project_root_markers=['.git'];writeFileSync(f.userConfig,configText(f.nativeConfig));
 const control=new CodexEngine(f.config,{cwd:f.cwd,readRoots:[],instructions:'Configuration only.',tools:[],controlOnly:true},async()=>{throw Error('no_tools');});f.engines.push(control);await control.start();
 e=await open(async(path,signal)=>prepareWorkerProjectRoot(path,f.user,(await control.request('config/read',{cwd:path,includeLayers:true})).config.project_root_markers,()=>!signal.aborted));const actual=await input(e);
 for(const marker of ['LAYER_HOME_GUIDANCE','LAYER_PARENT_GUIDANCE','LAYER_CURRENT_GUIDANCE'])assert.equal(actual.includes(marker),baseline.includes(marker),marker+' must follow the same native project-layer root semantics');
});
