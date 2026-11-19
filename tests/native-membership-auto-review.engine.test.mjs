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
for(const role of ['main','worker'])for(const mode of ['allow','deny','error','manual','managed','never','parse-error','stop'])test(`native desktop auto review ${role} ${mode}`,{timeout:60000},async t=>{
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
   assert.equal(data.model,reviewer?'gpt-6-luna':'gpt-6.1-terra');
   assert.equal(data.reasoning.effort,reviewer?'low':role==='main'?'medium':'high');
   if(reviewer&&mode==='stop'){reviewStarted();await release;}
   if(reviewer&&mode==='error'){res.writeHead(401,{'Content-Type':'application/json'}).end(JSON.stringify({error:{message:'synthetic rejection',code:'invalid_api_key'}}));return;}
   const id='synthetic-'+ ++sequence;
   const command={cmd:'printf synthetic-review-executed > '+join(root,'workspace/executed.txt'),sandbox_permissions:'require_escalated',justification:'Synthetic authorized approval test',max_output_tokens:100};
   const toolItem={id:'fc-'+id,type:'custom_tool_call',call_id:'synthetic-exec',name:'exec',input:'const result=await tools.exec_command('+JSON.stringify(command)+'); text(result);'};
   const item=reviewer?{id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:mode==='parse-error'?'not valid JSON':JSON.stringify({outcome:mode==='deny'?'deny':'allow',rationale:'Synthetic policy result'}),annotations:[]}]}:
    actorCalls++===0?toolItem:
    {id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic done',annotations:[]}]};
   const response={id,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:1,total_tokens:11}};
   const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
   res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));
  }catch(error){serverError=error;res.writeHead(500).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const desktopConnection=memberRuntimeConfig(resolveMemberSelection(null),`http://127.0.0.1:${server.address().port}`);
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
