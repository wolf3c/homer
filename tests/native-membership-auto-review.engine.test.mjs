// Fixed native engine, fresh homes, synthetic authentication and loopback only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {CodexEngine,codexVersion} from '../src/engine.ts';
import {memberRuntimeConfig,resolveMemberSelection} from '../src/member-models.ts';
import {Store} from '../src/store.ts';
import {NativeThreadBindings} from '../src/native-thread-bindings.ts';

const binary=process.env.HOMER_TEST_CODEX_BIN;
const defaults=resolveMemberSelection(null);
const cases=[];
for(const role of ['main','worker'])for(const mode of ['allow','deny','error','manual','managed','never','parse-error','stop']){
 cases.push({role,mode,actor:defaults[role]});
}
for(const [model,effort] of [
 ['gpt-6-luna','none'],['gpt-6-sol','xhigh'],['gpt-6-astra','max'],['gpt-6.1-sol','high'],
 ['gpt-6.2-sol','low'],['gpt-6.2-astra','medium'],['deepseek-flash','none'],
])cases.push({role:'worker',mode:'allow',actor:{model,effort}});

for(const {role,mode,actor} of cases)test(`native desktop auto review ${role} ${mode} ${actor.model}`,{timeout:60000},async t=>{
 assert.ok(binary,'HOMER_TEST_CODEX_BIN must select the fixed binary');
 assert.equal(codexVersion(binary),'codex-cli 0.171.0-alpha.7');
 const root=mkdtempSync('/private/tmp/homer-auto-review-');
 for(const d of ['runtime','workspace','codex','home','tmp'])mkdirSync(join(root,d),{mode:0o700});
 const saved=Object.fromEntries(['HOME','CODEX_HOME','HOMER_DEEPSEEK_TOKEN','TMPDIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'].map(k=>[k,process.env[k]]));
 for(const k of Object.keys(saved))delete process.env[k];
 Object.assign(process.env,{HOME:join(root,'home'),CODEX_HOME:join(root,'codex'),TMPDIR:join(root,'tmp'),HOMER_DEEPSEEK_TOKEN:'synthetic-membership-key',NO_PROXY:'127.0.0.1'});
 const explicit=mode==='manual'?'approvals_reviewer="user"\n':mode==='never'?'approval_policy="never"\n':'';
 writeFileSync(join(root,'codex/config.toml'),explicit+'sandbox_mode="workspace-write"\n[features]\nplugins=false\n[memories]\ngenerate_memories=false\nuse_memories=false\n');
 let reviewStarted,releaseReview;const started=new Promise(r=>reviewStarted=r),release=new Promise(r=>releaseReview=r);
 const requests=[];let serverError,actorCalls=0,hostApprovals=0,sequence=0;
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(req.url,'/v1/responses');assert.equal(req.headers.authorization,'Bearer synthetic-membership-key');
   let body='';for await(const part of req)body+=part;
   const data=JSON.parse(body);
   if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
   requests.push(data);
   const reviewer=data.text?.format?.type==='json_schema';
   assert.equal(data.model,reviewer?'gpt-6-luna':actor.model);
   assert.equal(data.reasoning.effort,reviewer?'low':actor.effort);
   if(reviewer&&mode==='stop'){reviewStarted();await release;}
   if(reviewer&&mode==='error'){res.writeHead(401,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'synthetic rejection',code:'invalid_api_key'}}));return;}
   const id='synthetic-'+ ++sequence;
   const command={cmd:'printf synthetic-review-executed > '+join(root,'workspace/executed.txt'),sandbox_permissions:'require_escalated',justification:'Synthetic authorized approval test',max_output_tokens:100};
   const directTool=actor.model==='deepseek-flash';
   if(!reviewer&&actorCalls===0){
    const tools=[...(data.tools??[]),...(data.input??[]).filter(i=>i.type==='additional_tools').flatMap(i=>i.tools)].flatMap(t=>t.tools??[t]);
    assert.ok(tools.some(t=>directTool?t.type==='function'&&t.name==='exec_command':t.type==='custom'&&t.name==='exec'));
   }
   const toolItem=directTool?{id:'fc-'+id,type:'function_call',call_id:'synthetic-exec',name:'exec_command',arguments:JSON.stringify(command)}:{id:'fc-'+id,type:'custom_tool_call',call_id:'synthetic-exec',name:'exec',input:'const result=await tools.exec_command('+JSON.stringify(command)+'); text(result);'};
   const item=reviewer?{id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:mode==='parse-error'?'not valid JSON':JSON.stringify({outcome:mode==='deny'?'deny':'allow',rationale:'Synthetic policy result'}),annotations:[]}]}:
    actorCalls++===0?toolItem:
    {id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic done',annotations:[]}]};
   const response={id,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:1,total_tokens:11}};
   const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
   res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));
  }catch(error){serverError=error;res.writeHead(500).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const desktopConnection=memberRuntimeConfig(resolveMemberSelection({...defaults,[role]:actor}),`http://127.0.0.1:${server.address().port}`);
 const config={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:binary,model:'unused',requiresOpenaiAuth:false,stopGraceMs:1000,desktopModelSource:'website',dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},desktopConnection};
 const store=new Store(join(root,'bindings.sqlite')),bindings=new NativeThreadBindings(store);
 let engine,thread,source='website';
 const manual=mode==='manual'||mode==='managed';
 const make=()=>{
  const e=new CodexEngine({...config,desktopModelSource:source},{role,nativeTools:role,nativeThreads:bindings,threadId:thread,cwd:config.workspace,readRoots:[],instructions:'Synthetic offline approval test. User authorizes printf synthetic-review-executed.',tools:[],onInteraction:async()=>{hostApprovals++;return {status:'denied',decision:{action:'deny',reason:'unexpected host approval'}};}},async()=>{throw Error('no host tools');});
  if(mode==='managed'){
   const request=e.request.bind(e);
   e.request=(method,params)=>method==='configRequirements/read'?Promise.resolve({requirements:{allowedApprovalsReviewers:['user']}}):request(method,params);
  }
  const send=e.nativeRequest.bind(e);e.nativeRequest=async(method,params)=>{const result=await send(method,params);if(['thread/start','thread/resume','thread/fork'].includes(method)){assert.equal(result.approvalsReviewer,manual?'user':'auto_review');assert.equal(result.approvalPolicy,mode==='never'?'never':'on-request');}return result;};return e;
 };
 try{
  if(mode==='allow'||mode==='never'||manual){
   source='codex';engine=make();await engine.start();
   assert.equal((await engine.request('config/read',{})).config.model_catalog_json??null,null);
   await engine.close();source='website';
  }
  engine=make();thread=await engine.start();
  const turning=engine.turn('Run printf synthetic-review-executed, with escalation for this synthetic approval test.');
  if(mode==='stop'){await started;await engine.interrupt();releaseReview();}
  const result=await turning;
  assert.ifError(serverError);assert.ok(['completed','failed','interrupted'].includes(result.status));
  const reviews=requests.filter(r=>r.text?.format?.type==='json_schema');
  assert.equal(reviews.length>0,!manual&&mode!=='never','native reviewer routing');
  assert.equal(existsSync(join(root,'workspace/executed.txt')),mode==='allow','only approved actions execute');
  assert.equal(hostApprovals,manual?1:0);
  await engine.close();engine=make();assert.equal(await engine.start(),thread);
  assert.equal((await engine.turn('Synthetic resumed message.')).status,'completed');
  if(mode==='allow'){
   await engine.close();source='codex';engine=make();assert.equal(await engine.start(),thread);
   await engine.close();engine=make();assert.equal(await engine.start(),thread);
   await engine.close();source='website';engine=make();assert.equal(await engine.start(),thread);
  }
  t.diagnostic(JSON.stringify({role,models:[...new Set(requests.map(r=>r.model))],hostApprovals,resumed:true}));
 }catch(error){
  if(error.displayMessage)t.diagnostic(error.displayMessage);
  throw error;
 }finally{
  releaseReview();await engine?.close();store.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
  rmSync(root,{recursive:true,force:true});
 }
});

for(const role of ['main','worker'])test(`native member ${role} switches catalog models on its original thread`,{timeout:60000},async()=>{
 assert.ok(binary,'HOMER_TEST_CODEX_BIN must select the fixed binary');
 assert.equal(codexVersion(binary),'codex-cli 0.171.0-alpha.7');
 const root=mkdtempSync('/private/tmp/homer-member-switch-');
 for(const dir of ['runtime','workspace','codex','home','tmp'])mkdirSync(join(root,dir),{mode:0o700});
 const env={HOME:join(root,'home'),CODEX_HOME:join(root,'codex'),TMPDIR:join(root,'tmp'),HOMER_DEEPSEEK_TOKEN:'synthetic-membership-key',NO_PROXY:'127.0.0.1'};
 const original=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
 Object.assign(process.env,env);
 writeFileSync(join(root,'codex/config.toml'),'[features]\nplugins=false\n[memories]\ngenerate_memories=false\nuse_memories=false\n');
 const calls=[];
 let releaseFirst,beginFirst;
 const firstStarted=new Promise(resolve=>{beginFirst=resolve;});
 const firstRelease=new Promise(resolve=>{releaseFirst=resolve;});
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const data=JSON.parse(body);
  if(req.url!=='/v1/responses'||req.headers.authorization!=='Bearer synthetic-membership-key'){res.writeHead(400).end();return;}
  if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
  calls.push(data);
  const compact=JSON.parse(data.client_metadata?.['x-codex-turn-metadata']??'{}').request_kind==='compaction';
  if(data.input?.at(-1)?.content?.some(part=>part.text==='Reject current selection')){
   res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'The model "gpt-6.1-terra" is not supported'}}));
   return;
  }
  if(calls.length===1){beginFirst();await firstRelease;}
  const id='fixture-'+calls.length;
  const item=calls.length===1?{id:'tool-'+id,type:'custom_tool_call',call_id:'member-fixture-call',name:'exec',input:"text('synthetic member tool result');"}:
   {id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:compact?'Synthetic member summary.':'Synthetic reply',annotations:[]}]};
  const response={id,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:1,total_tokens:11}};
  const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
  res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const config={workspace:join(root,'workspace'),runtime:join(root,'runtime'),codexHome:env.CODEX_HOME,nativeCodexHome:env.CODEX_HOME,codexBin:binary,model:'unused',requiresOpenaiAuth:false,stopGraceMs:1000,desktopModelSource:'website',dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'a'.repeat(64)},desktopConnection:memberRuntimeConfig(defaults,`http://127.0.0.1:${server.address().port}`),member:{subject:'fixture',overrides:{[role]:{model:'retired-model',effort:'high'}}}};
 const open=threadId=>new CodexEngine(config,{role,threadId,cwd:config.workspace,readRoots:[],instructions:'Reply to the synthetic user.',tools:[]},async()=>{throw Error('unexpected_tool');});
 let engine=open();
 try{
  const thread=await engine.start(),pid=engine.pid;
  await assert.rejects(engine.turn('Unavailable'),/engine_model_unavailable/);
  assert.equal(calls.length,0);
  config.member.overrides={};
  const first=engine.turn('First turn');
  await Promise.race([firstStarted,first.then(result=>{throw Error('missing_first_request: '+JSON.stringify(result));})]);
  config.member.overrides={[role]:{model:'deepseek-flash',effort:'none'}};
  assert.equal(engine.config.model,defaults[role].model);
  releaseFirst();
  assert.equal((await first).status,'completed');
  assert.equal((await engine.turn('Second turn')).status,'completed');
  config.member.overrides={[role]:{model:'deepseek-flash',effort:'high'}};
  assert.equal((await engine.turn('Change depth')).status,'completed');
  await engine.compact();
  config.member.overrides={};
  assert.equal((await engine.turn('Restore defaults')).status,'completed');
  assert.equal(engine.threadId,thread);
  assert.ok(pid);
  assert.equal(engine.pid,pid);
  assert.ok(calls.every(data=>data.client_metadata?.thread_id===thread));
  assert.deepEqual(calls.map(({model,reasoning})=>[model,reasoning?.effort]),[
   [defaults[role].model,defaults[role].effort],[defaults[role].model,defaults[role].effort],['deepseek-flash','none'],['deepseek-flash','high'],['deepseek-flash','high'],[defaults[role].model,defaults[role].effort],
  ]);
  assert.ok(calls[2].input.some(item=>item.type==='custom_tool_call'&&item.call_id==='member-fixture-call'));
  assert.ok(calls[2].input.some(item=>item.type==='custom_tool_call_output'&&item.call_id==='member-fixture-call'));
  assert.equal(JSON.parse(calls.at(-2).client_metadata['x-codex-turn-metadata']).request_kind,'compaction');
  assert.ok(calls.at(-1).input.some(item=>item.content?.some(part=>part.text?.includes('Synthetic member summary.'))));
  for(const data of calls.filter(data=>data!==calls.at(-2))){
   const tools=[...(data.tools??[]),...(data.input??[]).filter(item=>item.type==='additional_tools').flatMap(item=>item.tools)].flatMap(tool=>tool.tools??[tool]);
   assert.ok(tools.some(tool=>data.model==='deepseek-flash'?tool.type==='function'&&tool.name==='exec_command':tool.type==='custom'&&tool.name==='exec'),data.model+' model tools');
   assert.equal(data.service_tier??null,null);
  }
  const rejected={model:'gpt-6.1-terra',effort:'low'},unavailable=[];
  config.member.overrides={[role]:rejected};
  engine.on('memberModelUnavailable',selection=>unavailable.push(selection));
  const rejectedResult=await engine.turn('Reject current selection');
  assert.equal(rejectedResult.status,'failed');
  assert.equal(rejectedResult.errorCode,'engine_model_unavailable');
  assert.deepEqual(unavailable,[rejected]);
  assert.equal(calls.length,7);
  assert.deepEqual(config.member.overrides,{[role]:rejected});

  assert.equal(await engine.close(),true);
  config.member.overrides={[role]:{model:'deepseek-flash',effort:'max'}};
  engine=open(thread);
  assert.equal(await engine.start(),thread);
  assert.equal((await engine.turn('Resume with saved choice')).status,'completed');
  assert.equal(calls.at(-1).model,'deepseek-flash');
  assert.equal(calls.at(-1).reasoning.effort,'max');
  assert.equal(calls.at(-1).client_metadata.thread_id,thread);
 }finally{
  releaseFirst();const stopped=await engine.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;
  assert.equal(stopped,true,'native test owner must exit before cleanup');
  rmSync(root,{recursive:true,force:true});
 }
});
