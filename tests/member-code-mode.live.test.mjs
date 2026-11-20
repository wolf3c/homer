import './fixtures/synthetic-home.mjs';
// Explicit paid acceptance; credentials are supplied only by the authorized launcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,realpathSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

assert.equal(process.env.HOMER_MEMBER_CODE_MODE_ACCEPTANCE,'1','explicit_member_acceptance_required');
const synthetic=process.env.HOMER_MEMBER_CODE_MODE_SYNTHETIC==='1';
const moduleUrl=process.env.HOMER_TEST_SERVICE_MODULE,binary=process.env.HOMER_TEST_CODEX_BIN,output=process.env.HOMER_MEMBER_CODE_MODE_REPORT;
assert.ok(moduleUrl?.startsWith('file://')&&isAbsolute(binary??'')&&isAbsolute(output??''),'explicit_candidate_and_report_required');
assert.ok(['.codex/scratch/','.codex/private/'].some(path=>output.startsWith(resolve('.')+'/'+path)),'ignored_report_required');
assert.equal(realpathSync(dirname(output)),dirname(output),'canonical_report_directory');
assert.throws(()=>lstatSync(output),{code:'ENOENT'},'new_report_required');
execFileSync('git',['check-ignore','-q','--',output],{stdio:'ignore'});
const {Homer}=await import(moduleUrl),{CodexEngine}=await import(new URL('./engine.js',moduleUrl));
const {queryHomerMemberSelection}=await import(new URL('./homer-account.js',moduleUrl));
const {memberCatalogPath,memberRuntimeConfig,resolveMemberSelection}=await import(new URL('./member-models.js',moduleUrl));
const secret=process.env.HOMER_MEMBER_TEST_TOKEN;delete process.env.HOMER_MEMBER_TEST_TOKEN;
assert.ok(synthetic||typeof secret==='string'&&secret.length>=10,'explicit_member_token_required');
const sha=text=>createHash('sha256').update(text).digest('hex');
const tool={type:'function',name:'code_mode_receipt',description:'Return a fresh opaque local verification string. No arguments or side effects. Call once through JavaScript exec, then print its result with text().',inputSchema:{type:'object',properties:{},additionalProperties:false}};

test('final Homer Main and Worker complete member Code Mode Only loops',{timeout:180000},async()=>{
 const parent=resolve('.codex/private/member-code-mode-final-20261116');
 for(const path of [resolve('.codex'),resolve('.codex/private'),parent]){
  if(!existsSync(path))mkdirSync(path,{mode:0o700});
  const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(realpathSync(path),path);
  assert.equal(stat.mode&(path===resolve('.codex')?0o022:0o077),0,'private_fixture_permissions');
 }
 const root=realpathSync(mkdtempSync(join(parent,synthetic?'synthetic-':'real-'))),workspace=join(root,'workspace'),runtime=join(root,'runtime'),home=join(root,'codex'),hostHome=join(root,'host');
 for(const path of [workspace,runtime,home,hostHome,join(root,'tmp')])mkdirSync(path,{mode:0o700});
 mkdirSync(join(workspace,'.git'));writeFileSync(join(workspace,'.homer-project-root'),'');
 writeFileSync(join(home,'config.toml'),`model_catalog_json=${JSON.stringify(memberCatalogPath)}\napproval_policy="never"\ndefault_permissions="member_probe"\n[permissions.member_probe.filesystem]\n":root"="deny"\n${JSON.stringify(workspace)}="read"\n[permissions.member_probe.network]\nenabled=false\n[features]\nplugins=false\napps=false\nhooks=false\nskip_host_skill_discovery=true\n[memories]\ngenerate_memories=false\nuse_memories=false\n`,{mode:0o600});
 const roleReport=()=>({toolCalls:0,codeHashes:[],codeCallsReceipt:false,codeModeHostObserved:false,resultReturned:false,finalMatches:false,turns:0,completedTurns:0});
 const report={schema:1,synthetic,version:'0.171.0-alpha.7',roles:{main:roleReport(),worker:roleReport()},requests:[],maxRequests:8,maxOutputTokens:2048,blockedRequests:0,blockedBackground:0,forbiddenNativeEffects:0,observerRawBodiesSaved:false,credentialsSaved:false,startedAt:new Date().toISOString()};
 const markers={},seenCalls=new Set(),engines=[],loopbackKey=randomUUID();let app,observerFailure,server,passed=false;
 const names=['HOME','TMPDIR','HOMER_MEMBER_LOOPBACK_KEY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
 const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const inspectItem=(item,role)=>{
  const r=report.roles[role];
  if(item?.type==='custom_tool_call'&&item.name==='exec'&&typeof item.input==='string'&&!seenCalls.has(role+item.call_id)){
   seenCalls.add(role+item.call_id);r.codeHashes.push(sha(item.input));r.codeCallsReceipt||=item.input.includes(tool.name);
  }
 };
 const observer=(record,role)=>{
  let buffer='';const decoder=new TextDecoder();
  return new Transform({transform(chunk,_encoding,done){
   try{
    buffer+=decoder.decode(chunk,{stream:true});assert.ok(buffer.length<2*1024*1024,'bounded_event_buffer');let match;
    while((match=/\r?\n\r?\n/.exec(buffer))){
     const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
     const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
     if(!data||data==='[DONE]')continue;const event=JSON.parse(data);
     if(event.type==='response.output_item.done')inspectItem(event.item,role);
     if(event.response?.model)record.responseModel=event.response.model;
     if(event.type==='response.completed'){
      record.completed=true;for(const item of event.response.output??[])inspectItem(item,role);
      const u=event.response.usage;if(u)record.usage={inputTokens:u.input_tokens,outputTokens:u.output_tokens,cachedInputTokens:u.input_tokens_details?.cached_tokens??0};
     }
    }
    done(null,chunk);
   }catch(error){done(error);}
  }});
 };
 try{
  assert.equal(process.version,'v22.22.0');assert.equal(execFileSync(binary,['--version'],{encoding:'utf8',timeout:10000}).trim(),'codex-cli 0.171.0-alpha.7');
  const selection=synthetic?resolveMemberSelection(null):await queryHomerMemberSelection({websiteOrigin:'https://super-tree.com'});
  const delivered=memberRuntimeConfig(selection,'https://models.super-tree.com');
  for(const role of ['main','worker'])assert.match(delivered[role].model,/^gpt-6\.1(?:-|$)/,'member_gpt_6_1_required');
  report.models=Object.fromEntries(['main','worker'].map(role=>[role,{model:delivered[role].model,effort:delivered[role].effort}]));
  server=createServer(async(req,res)=>{
   let record;
   try{
    const role=req.url==='/main/v1/responses'?'main':req.url==='/worker/v1/responses'?'worker':undefined;
    if(req.method!=='POST'||!role){res.writeHead(403).end();return;}
    assert.equal(req.headers.authorization,'Bearer '+loopbackKey,'isolated_transport_auth');
    let body='';for await(const part of req){body+=part;assert.ok(Buffer.byteLength(body)<2*1024*1024,'bounded_request');}
    const data=JSON.parse(body),r=report.roles[role];
    if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){report.blockedBackground++;res.writeHead(403).end();return;}
    assert.notEqual(data.generate,false,'no_paid_prewarm');assert.equal(data.model,delivered[role].model,'actual_role_model');assert.equal(data.reasoning?.effort,delivered[role].effort,'actual_role_effort');
    const input=data.input??[],tools=[...(data.tools??[]),...input.filter(item=>item.type==='additional_tools').flatMap(item=>item.tools??[])].flatMap(item=>item.tools??[item]);
    assert.ok(tools.some(item=>item.type==='custom'&&item.name==='exec'&&item.format?.syntax==='lark'),'automatic_code_mode_only');
    assert.ok(!tools.some(item=>item.type==='function'&&item.name===tool.name),'receipt_not_exposed_directly');
    if(report.requests.length>=report.maxRequests){report.blockedRequests++;res.writeHead(429).end();return;}
    const returned=!!markers[role]&&input.some(item=>item.type==='custom_tool_call_output'&&JSON.stringify(item).includes(markers[role]));
    r.resultReturned||=returned;record={role,ordinal:report.requests.length+1,customExec:true,lark:true,resultReturned:returned};report.requests.push(record);
    data.max_output_tokens=report.maxOutputTokens;
    res.setHeader('content-type','text/event-stream');
    if(synthetic){
     const id='synthetic-'+record.ordinal,internal=JSON.stringify(input.findLast(item=>item.role==='user')??{}).includes('内部协作输入');
     const assignment='This is an authorized isolated Code Mode Only acceptance. Use exec JavaScript to call tools.code_mode_receipt({}) exactly once, print its result with text(), then reply only with its verification string. Do not read files, run commands, browse, spawn subagents, or call other tools.';
     const code='const value=await tools.code_mode_receipt({}); '+(role==='main'?`const task=await tools.task_create({goal:${JSON.stringify(assignment)},title:"Code Mode verification"}); const taskId=JSON.stringify(task).match(/task-[0-9a-f-]{36}/)[0]; await tools.worker_open({taskId,workingDirectory:${JSON.stringify(workspace)}}); `:'')+'text(value);';
     const item=!r.toolCalls?{type:'custom_tool_call',id:'code-'+id,call_id:'call-'+id,name:'exec',input:code}:{type:'message',id:'msg-'+id,role:'assistant',content:[{type:'output_text',text:internal?'':markers[role],annotations:[]}]};
     const response={id,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
     const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.done',item},{type:'response.completed',response}];
     res.writeHead(200);await pipeline(Readable.from([events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join('')]),observer(record,role),res);record.httpStatus=200;return;
    }
    const upstream=await fetch(delivered[role].baseUrl+'/responses',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify(data),signal:AbortSignal.timeout(90000)});
    record.httpStatus=upstream.status;record.azureHeaderPresent=['apim-request-id','x-ms-region','x-ms-request-id'].some(name=>upstream.headers.has(name));
    res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});
    await pipeline(Readable.fromWeb(upstream.body),observer(record,role),res);
   }catch(error){
    if(error?.code==='ERR_STREAM_PREMATURE_CLOSE'&&record?.completed&&res.destroyed)return;
    observerFailure??=error;res.destroy();
   }
  });
  server.on('connect',(_req,socket)=>socket.destroy());server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
  process.env.HOME=hostHome;process.env.TMPDIR=join(root,'tmp');process.env.HOMER_MEMBER_LOOPBACK_KEY=loopbackKey;
  for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])process.env[name]=origin;
  process.env.NO_PROXY=process.env.no_proxy='127.0.0.1,localhost';
  const config={appData:root,workspace,runtime,codexHome:home,nativeCodexHome:home,codexBin:binary,...delivered.main,baseUrl:origin+'/main/v1',keyEnv:'HOMER_MEMBER_LOOPBACK_KEY',requiresOpenaiAuth:false,stopGraceMs:1000};
  app=new Homer(config,async()=>{},(options,handler)=>{
   const role=options.role==='worker'?'worker':'main',r=report.roles[role];
   const engine=new CodexEngine({...config,...delivered[role],baseUrl:origin+'/'+role+'/v1'},{...options,tools:[...options.tools,tool]},async call=>{
    if(call.tool!==tool.name)return handler(call);
    assert.equal(call.threadId,engine.threadId);assert.equal(call.turnId,engine.turnId);assert.equal(Object.keys(call.arguments??{}).length,0,'no_receipt_arguments');assert.equal(++r.toolCalls,1,'single_local_execution');
    markers[role]='LOCAL_'+randomUUID().replaceAll('-','');
    r.codeModeHostObserved=execFileSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).split('\n').some(line=>{const parts=line.trim().split(/\s+/);return Number(parts[1])===engine.pid&&parts.slice(2).join(' ').endsWith('/codex-code-mode-host');});
    return {verification:markers[role]};
   });
   const turn=engine.turn.bind(engine);engine.turn=async(text,options)=>{
    assert.ok(++r.turns<=3,'bounded_homer_turns');const result=await turn(text,options);if(result.status==='completed')r.completedTurns++;
    if(markers[role]&&result.text.trim()===markers[role])r.finalMatches=true;return result;
   };
   engine.on('nativeProcess',event=>{if(['command','fileChange','imageGeneration','webSearch'].includes(event.category))report.forbiddenNativeEffects++;});
   engines.push(engine);return engine;
  },[],async()=>({home:workspace,folders:[]}));
  await app.start();
  let deadline;
  try{await Promise.race([(async()=>{
   await app.message(`This is a bounded authorized isolated Code Mode Only acceptance. First use exec JavaScript to call tools.code_mode_receipt({}) exactly once and print its result with text(). Also record one task with task_create (title "Code Mode verification") and open exactly one Worker with worker_open using its returned taskId and workingDirectory=${JSON.stringify(workspace)}. Use this task goal: "Use exec JavaScript to call tools.code_mode_receipt({}) exactly once, print its result with text(), then reply only with its verification string. Do not read files, run commands, browse, spawn subagents or call other tools." Your own final reply must be only your own verification string. The Worker result is delivered separately; on its internal return do not launch new work, call tools, or send a user message. No other operations are authorized.`,'member-code-mode-final');
   await app.idle();
  })(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('member_acceptance_deadline')),110000);})]);}
  finally{clearTimeout(deadline);}
  if(observerFailure)throw observerFailure;
  for(const role of ['main','worker']){
   const r=report.roles[role];assert.equal(r.toolCalls,1,'role_local_execution_once');assert.ok(r.codeHashes.length>0&&r.codeCallsReceipt,'model_generated_javascript');
   assert.ok(r.codeModeHostObserved&&r.resultReturned&&r.finalMatches,'complete_local_round_trip');assert.ok(r.completedTurns>=1,'native_completed');
  }
  assert.equal(app.store.runs().length,1,'one_real_homer_worker');assert.equal(app.store.runs()[0].status,'succeeded','worker_host_return');
  assert.equal(report.forbiddenNativeEffects,0);assert.equal(report.blockedRequests,0);assert.ok(report.requests.every(r=>r.httpStatus===200&&r.completed),'all_upstream_completed');
  report.nativeHomesIsolated=engines.every(engine=>resolve(engine.config.codexHome)===home);assert.ok(report.nativeHomesIsolated);passed=true;
 }catch(error){
  const reason=/^[a-z][a-z0-9_]{1,80}$/.test(error?.message??'')?error.message:'member_acceptance_failed';
  report.failure={reason,code:/^[a-zA-Z0-9_]{1,80}$/.test(error?.code??'')?error.code:'acceptance_failed'};throw Error(reason);
 }
 finally{
  let stopped=false;try{await app?.close({requireAllOwnersConfirmed:true});stopped=true;}finally{
   server?.closeAllConnections();if(server)await new Promise(done=>server.close(done));
   for(const [name,value] of Object.entries(before))if(value===undefined)delete process.env[name];else process.env[name]=value;
   report.ownersStopped=stopped;if(stopped){rmSync(root,{recursive:true,force:true});report.privateRuntimeRemoved=true;}
   report.passed=passed&&stopped;report.finishedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
 }
});
