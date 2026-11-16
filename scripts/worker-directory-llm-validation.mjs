// Explicit paid acceptance; no default test, daily runtime, or refresh-token use.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,realpathSync,readdirSync,chmodSync} from 'node:fs';
import {join,dirname,resolve,relative,sep} from 'node:path';
import {userInfo,tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

const mode=process.argv[2],specFile=process.argv[3];
assert.ok(['--paid','--self-check'].includes(mode)&&specFile,'explicit_mode_and_spec_required');
assert.equal(process.versions.node,'22.22.0');
const repo=resolve(import.meta.dirname,'..'),spec=JSON.parse(readFileSync(specFile,'utf8'));
const source=realpathSync(spec.source),profiles=realpathSync(spec.privateRoot),out=realpathSync(spec.reportDirectory),bin=realpathSync(spec.codexBin);
const inside=(parent,path)=>path===parent||path.startsWith(parent+sep);
assert.ok(inside(join(repo,'.codex/scratch'),source)&&inside(join(repo,'.codex/scratch'),out));
assert.ok(inside(join(repo,'.codex/private'),profiles));
assert.notEqual(profiles,join(repo,'.codex/private'));
assert.equal(readdirSync(profiles).length,0,'empty_private_root_required');
const {Homer}=await import(pathToFileURL(join(source,'dist/service.js')));
const {CodexEngine}=await import(pathToFileURL(join(source,'dist/engine.js')));
const {nativeTokenUsage}=await import(pathToFileURL(join(source,'dist/native-usage.js')));
const {LIST_WORK_DIRECTORIES}=await import(pathToFileURL(join(source,'dist/work-directories.js')));
const {MAIN_DYNAMIC_TOOLS,MAIN_TOOLS_HASH}=await import(pathToFileURL(join(source,'dist/recursive-tools.js')));
const {loadPrompts}=await import(pathToFileURL(join(source,'dist/prompts.js')));
const currentMain=loadPrompts().main;
let legacyMain;
if(spec.legacyPromptsDirectory!==undefined){
 const directory=realpathSync(spec.legacyPromptsDirectory);assert.ok(inside(source,directory));
 legacyMain=loadPrompts(pathToFileURL(directory+sep)).main;assert.notEqual(legacyMain,currentMain);
 assert.ok(Array.isArray(spec.trials)&&spec.trials.length>0&&spec.trials.length<=3,'legacy_trials_require_explicit_three_turn_cap');
}
const directoryRule=readFileSync(join(source,'prompts/main.md'),'utf8').split('\n').find(line=>line.includes('worker_open.workingDirectory'));
assert.ok(directoryRule,'directory_rule_required');
const model='gpt-6.1-terra',wrapper=join(profiles,'codex');
const realHomeFallbackBefore=existsSync(join(userInfo().homedir,'.homer-project-root'));
writeFileSync(wrapper,'#!/bin/sh\nexport LOG_FORMAT=json\nexport RUST_LOG=error,codex_otel.trace_safe=info\nexec '+JSON.stringify(bin)+' "$@"\n',{mode:0o700});chmodSync(wrapper,0o700);
const root=realpathSync(mkdtempSync(join(process.platform==='darwin'?'/private/tmp':realpathSync(tmpdir()),'hmwd2-')));chmodSync(root,0o700);
const home=join(root,'home'),workspace=join(home,'Main');
const put=(p,text='')=>{const path=join(home,p);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,text,{mode:0o600});return path;};
mkdirSync(workspace,{recursive:true});
const known=['Documents','Desktop','Downloads'].map(n=>join(home,n));for(const p of known)mkdirSync(p,{recursive:true});
const rules={
 'Projects/clients/星桥/AGENTS.md':'SYNTHETIC_CLIENT_RULE\n客户星桥的业务文档。',
 'Projects/clients/星桥/contracts/AGENTS.md':'SYNTHETIC_CONTRACT_RULE\n合同文件只读核对；保持条款编号。',
 'Projects/tools/atlas/AGENTS.md':'SYNTHETIC_ATLAS_RULE\nAtlas 桌面工具。',
 'Projects/tools/atlas/native/AGENTS.md':'SYNTHETIC_NATIVE_RULE\n原生导出模块；只读分析，不改源文件。',
 'Documents/operations/ledger-assistant/AGENTS.md':'SYNTHETIC_LEDGER_RULE\n账簿助手项目。',
};
for(const [p,text]of Object.entries(rules))put(p,text+'\n');
put('Projects/clients/星桥/contracts/current/draft.txt','星桥合同草稿\n第一条 服务范围。\n');
put('Projects/clients/星桥/README.md','星桥客户资料，当前合同位于 contracts/current/draft.txt。\n');
put('Projects/tools/atlas/README.md','Atlas 桌面工具。原生导出模块位于 native/export.txt。\n');
put('Projects/tools/atlas/native/export.txt','原生导出模块说明：校验文件名、编码和目录权限。\n');
put('Documents/operations/ledger-assistant/README.md','项目中文名：账簿助手；导入规则位于 rules/import.txt。\n');
put('Documents/operations/ledger-assistant/rules/import.txt','账簿助手导入规则：表头日期、科目、金额，金额以分存储。\n');
put('Downloads/reference.txt','只作为参考样式。\n');put('Downloads/sample.csv','日期,科目,金额\n2026-11-01,办公用品,1200\n');
const target=p=>join(home,p),cases=[
 {id:'K1',expected:['Projects/clients/星桥/contracts','Projects/clients/星桥/contracts/current'],rule:'CONTRACT',text:'请安排一个 Worker 只读核对 '+target('Projects/clients/星桥/contracts/current/draft.txt')+' 的条款编号和明显缺漏，给我简短意见，不修改文件。'},
 {id:'K2',expected:['Projects/tools/atlas/native'],rule:'NATIVE',text:'请安排一个 Worker 只读分析 '+target('Projects/tools/atlas/native')+' 的导出模块，参照 '+target('Downloads/reference.txt')+' 的呈现方式提出改进建议，不改文件。'},
 {id:'K3',expected:['Main'],rule:null,text:'请安排一个 Worker 写一段 100 字左右的会议准时开始提醒文案。没有现有项目或本地资料要处理，直接给出文字即可，不创建文件。'},
 {id:'U1',expected:['Projects/clients/星桥/contracts','Projects/clients/星桥/contracts/current'],rule:'CONTRACT',text:'请安排一个 Worker 只读核对星桥客户当前合同草稿的条款编号和明显缺漏，给我简短意见，不修改文件。资料在本机客户工作目录中。'},
 {id:'U2',expected:['Projects/tools/atlas/native'],rule:'NATIVE',text:'请安排一个 Worker 只读分析本机 Atlas 桌面工具的原生导出模块，给我简短改进建议，不改文件。'},
 {id:'U3',expected:['Documents/operations/ledger-assistant','Documents/operations/ledger-assistant/rules'],rule:'LEDGER',text:'请安排一个 Worker 按本机账簿助手项目的既有导入规则，检查 '+target('Downloads/sample.csv')+' 是否符合要求，给我简短说明，不改任何文件。这个 CSV 只是输入样本。'},
];
const allTrials=[...cases.map(c=>({...c,trial:c.id})),...['U1','U2','U1','U2'].map((id,i)=>({...cases.find(c=>c.id===id),trial:id+'-'+(Math.floor(i/2)+2)}))];
if(spec.trials!==undefined)assert.ok(Array.isArray(spec.trials)&&spec.trials.length>0&&new Set(spec.trials).size===spec.trials.length&&spec.trials.every(id=>allTrials.some(c=>c.trial===id)),'invalid_trial_selection');
if(spec.stopOnFailure!==undefined)assert.equal(typeof spec.stopOnFailure,'boolean','invalid_stop_on_failure');
const trials=spec.trials?spec.trials.map(id=>allTrials.find(c=>c.trial===id)):allTrials;
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
save('locations.json',{source,profiles,syntheticRoot:root});
save('plan.json',{model,effort:'medium',legacyMain:!!legacyMain,trials:trials.map(({text,...c})=>c),limits:{msPerTrial:180000,mainUsageUpdatesPerTrial:12},worker:'native engine, held loopback responses only'});
const toml=v=>v&&typeof v==='object'?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+toml(x)).join(',')+'}':JSON.stringify(v);
function profile(id){
 const base=join(profiles,id),codex=join(base,'codex'),runtime=join(base,'rt');for(const p of [codex,runtime])mkdirSync(p,{recursive:true,mode:0o700});
 writeFileSync(join(codex,'config.toml'),[
  'default_permissions="trial"','approval_policy="never"','web_search="disabled"','shell_environment_policy.inherit="none"',
  'shell_environment_policy.set={PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"}',
  'features.skip_host_skill_discovery=true','features.apps=false','features.plugins=false','memories.generate_memories=false','memories.use_memories=false',
  'permissions.trial.filesystem='+toml({':root':'deny',':minimal':'read',[userInfo().homedir]:'deny','/bin':'read','/sbin':'read','/usr':'read','/System':'read','/opt/homebrew':'read',[home]:'read',[dirname(bin)]:'read'}),
  'permissions.trial.network.enabled=false',
 ].join('\n')+'\n',{mode:0o600});
 return {workspace,runtime,codexHome:codex,nativeCodexHome:codex,codexBin:wrapper,model,effort:'medium',serviceTier:null,fast:false,requiresOpenaiAuth:true,stopGraceMs:1000};
}
const numeric=n=>(typeof n==='number'||typeof n==='string'&&/^\d+$/.test(n))&&Number.isSafeInteger(Number(n))&&Number(n)>=0?Number(n):null;
const probeModel='gpt-6.1-sol',probeText='Run the local synthetic verification.';
function observe(e,m,onBudget=()=>{}){
 let buffer='',dropping=false;const seen=new Set();m.traceResponses=[];m.fs=[];m.tools=[];m.lookup=0;m.workDirectory=0;m.retries=0;
 e.on('spawn',()=>{e.child.stderr.setEncoding('utf8');e.child.stderr.on('data',chunk=>{
  for(const part of chunk.split(/(?<=\n)/)){
   if(!dropping){buffer+=part;if(Buffer.byteLength(buffer)>65536){buffer='';dropping=true;}}
   if(!part.endsWith('\n'))continue;
   if(!dropping)try{const event=JSON.parse(buffer),f=event.fields;
    if(event.target==='codex_otel.trace_safe'&&f?.['app.version']==='0.171.0-alpha.7'&&f['conversation.id']===e.threadId&&f['event.name']==='codex.sse_event'&&f['event.kind']==='response.completed'){
     m.traceResponses.push({inputTokens:numeric(f.input_token_count),outputTokens:numeric(f.output_token_count),cachedInputTokens:numeric(f.cached_input_token_count??f.cached_token_count),reasoningOutputTokens:numeric(f.reasoning_token_count),model:['gpt-6.1-terra','gpt-5.6-terra','gpt-6.1-sol'].includes(f.model)?f.model:null});
    }
   }catch{}buffer='';dropping=false;
  }
 });});
 e.on('usage',u=>{m.tokens=nativeTokenUsage(u)?.total??null;m.usageUpdates=(m.usageUpdates??0)+1;if(m.usageUpdates>=12)onBudget();});
 e.on('turnRetry',()=>m.retries++);
 e.on('hostMcpToolStarted',v=>{m.tools.push({tool:v.tool,atMs:Math.round(performance.now()-(m.started??performance.now()))});if(v.tool==='list_work_directories')m.lookup++;if(v.tool==='work_directory')m.workDirectory++;});
 e.on('nativeProcess',v=>{
  if(!['command','readFiles','search','listFiles','inspectFiles'].includes(v.category)||seen.has(v.itemId))return;seen.add(v.itemId);
  const input=JSON.stringify(v.content?.input??{});m.fs.push({category:v.category,afterLookup:m.lookup>0,branches:['Main','Projects','Documents','Downloads','clients','星桥','contracts','atlas','native','operations','ledger-assistant'].filter(p=>input.includes(p)),mentionsMarkers:/AGENTS\.md|AGENTS\.override\.md|TEAM_GUIDE\.md|\.codex|\.agents/.test(input),mentionsReadme:/README/i.test(input)});
 });
}
async function loopback(script){
 const state={requests:0,taskRequests:0,ruleSeen:false,allowed:false,denied:true,requestHasTools:[]};let sent=false;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/responses')return res.writeHead(403).end();
  req.setEncoding('utf8');
  let raw='';try{for await(const c of req){raw+=c;if(raw.length>2*1024*1024){res.writeHead(413).end();return;}}}catch{res.destroy();return;}
  let data;try{data=JSON.parse(raw);}catch{res.writeHead(400).end();return;}
  if(!data||typeof data!=='object'||!Array.isArray(data.input)){res.writeHead(400).end();return;}
  const hasCatalog=Object.hasOwn(data,'tools')||(data.input??[]).some(v=>v.type==='additional_tools');state.requests++;state.requestHasTools.push(hasCatalog);
  if(script===undefined){if(hasCatalog)state.taskRequests++;if(state.rule&&JSON.stringify(data.input).includes('SYNTHETIC_'+state.rule+'_RULE'))state.ruleSeen=true;return;}
  const outputs=JSON.stringify((data.input??[]).filter(v=>v.type?.includes('output')));state.allowed||=outputs.includes('SYNTHETIC_ALLOWED');state.denied&&=!outputs.includes('SYNTHETIC_OUTSIDE_DENIED');
  const probe=data.model===probeModel&&data.max_output_tokens!==0&&data.input.some(item=>item.role==='user'&&item.content?.some(part=>part.text===probeText));
  const n=String(state.requests),call=!!script&&!sent&&hasCatalog&&probe;if(call)sent=true;
  const item=call?{id:'call-'+n,type:'custom_tool_call',namespace:'functions',name:'exec',call_id:'synthetic-'+n,input:script}:{id:'msg-'+n,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic local completion.',annotations:[]}]};
  const response={id:'resp-'+n,object:'response',model:data.model,created_at:1,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.setHeader('Content-Type','text/event-stream');for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));state.url='http://127.0.0.1:'+server.address().port+'/v1';
 state.close=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));};return state;
}
let shutdownConfirmed=true;
const legacyUser='SYNTHETIC_SAVED_MAIN_USER',legacyAssistant='SYNTHETIC_SAVED_MAIN_ASSISTANT';
async function prepareLegacyMain(config,app){
 const e=new CodexEngine(config,{cwd:workspace,readRoots:[workspace],instructions:legacyMain+'\n默认工作目录：'+workspace+'。Worker 可选择获准的项目目录。',tools:MAIN_DYNAMIC_TOOLS,nativeTools:'main'},async()=>{throw Error('legacy_seed_tool_call_denied');}),observed={};
 if(config.requiresOpenaiAuth)authenticate(e);observe(e,observed);
 const request=e.request.bind(e);e.request=async(method,params)=>{assert.ok(!['turn/start','thread/compact/start'].includes(method),'legacy_seed_model_turn_denied');return request(method,params);};
 let thread,attachment;
 try{
  await e.start();assert.equal(e.version,'0.171.0-alpha.7');
  await e.request('thread/inject_items',{threadId:e.threadId,items:[{type:'message',role:'user',content:[{type:'input_text',text:legacyUser}]},{type:'message',role:'assistant',content:[{type:'output_text',text:legacyAssistant}]}]});
  ({attachment}=await e.request('thread/attachment/add',{threadId:e.threadId,attachmentType:'synthetic.document',identityKey:'directory-resume',payload:{name:'fixture.txt',contents:'SYNTHETIC_LEGACY_ATTACHMENT'}}));
  ({thread}=await e.request('thread/read',{threadId:e.threadId,includeTurns:true}));assert.ok(inside(config.codexHome,realpathSync(thread.path)));
 }finally{const stopped=await e.close();shutdownConfirmed=stopped&&shutdownConfirmed;assert.ok(stopped,'legacy_seed_shutdown_unconfirmed');}
 const prefix=readFileSync(thread.path),rows=prefix.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(rows.some(row=>row.type==='response_item'&&row.payload.role==='developer'&&row.payload.content?.some(part=>part.text?.includes(legacyMain))));
 assert.ok(!rows.some(row=>row.type==='token_usage_record')&&observed.traceResponses.length===0,'legacy_seed_must_not_use_model');
 app.store.setMeta('mainThread',thread.id);app.store.setMeta('mainToolsHash',MAIN_TOOLS_HASH);app.store.setMeta('mainPromptHash',createHash('sha256').update(JSON.stringify([thread.id,legacyMain])).digest('hex'));
 return {threadId:thread.id,path:thread.path,prefix,attachment};
}
function observeAdoption(e,m){
 const request=e.request.bind(e);m.promptInjections=0;
 e.request=async(method,params)=>{const result=await request(method,params);if(method==='thread/inject_items'){m.promptInjections++;m.completeCurrentPromptInjected=params.items?.some(item=>item.role==='developer'&&item.content?.some(part=>part.text?.endsWith(currentMain)))===true;}return result;};
}
async function verifyLegacyMain(app,e,saved,m){
 const {thread}=await e.request('thread/read',{threadId:e.threadId,includeTurns:true});
 assert.equal(e.threadId,saved.threadId);assert.equal(thread.path,saved.path);assert.equal(app.store.meta('mainToolsHash'),MAIN_TOOLS_HASH);
 const bytes=readFileSync(thread.path),rows=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(bytes.subarray(0,saved.prefix.length).equals(saved.prefix));
 const meta=rows.find(row=>row.type==='session_meta')?.payload;assert.deepEqual(meta.dynamic_tools,MAIN_DYNAMIC_TOOLS);
 assert.deepEqual((await e.request('thread/attachment/list',{threadId:e.threadId})).data,[saved.attachment]);
 for(const marker of [legacyUser,legacyAssistant])assert.ok(bytes.includes(Buffer.from(marker)));
 assert.ok(rows.some(row=>row.type==='response_item'&&row.payload.role==='developer'&&row.payload.content?.some(part=>part.text?.includes(currentMain))));
 assert.equal(m.promptInjections,1);assert.equal(m.completeCurrentPromptInjected,true);
 assert.equal(app.store.meta('mainPromptHash'),createHash('sha256').update(JSON.stringify([saved.threadId,currentMain])).digest('hex'));
 m.originalThreadRetained=true;m.legacyHistoryPrefixRetained=true;m.legacyAttachmentRetained=true;m.legacyToolsRetained=true;m.legacyPromptAdopted=true;
}
async function selfCheck(){
 for(const value of [undefined,null,'',false,-1,0.5,'bad'])assert.equal(numeric(value),null);
 assert.equal(numeric(0),0);assert.equal(numeric('12'),12);
 const denied=join(profiles,'outside.txt');writeFileSync(denied,'SYNTHETIC_OUTSIDE_DENIED',{mode:0o600});put('Main/allowed.txt','SYNTHETIC_ALLOWED');
 const command='cat '+JSON.stringify(target('Main/allowed.txt'))+'; if cat '+JSON.stringify(denied)+' 2>/dev/null; then exit 17; fi; if touch '+JSON.stringify(target('Main/blocked-write'))+' 2>/dev/null; then exit 19; fi';
 const local=await loopback('text(await tools.exec_command('+JSON.stringify({cmd:command,workdir:workspace,login:false})+'));'),m={};
 const e=new CodexEngine({...profile('offline'),model:probeModel,baseUrl:local.url,requiresOpenaiAuth:false},{cwd:workspace,readRoots:[workspace],instructions:'Synthetic offline verification.',tools:[],nativeTools:'main'},async()=>{});observe(e,m);
 try{
  for(const body of [{model:'gpt-5.6-terra',input:[{role:'user',content:[{type:'input_text',text:probeText}]}],tools:[]},{model:probeModel,input:[],tools:[]}]){
   const response=await fetch(local.url+'/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);assert.ok(!(await response.text()).includes('custom_tool_call'),'background_request_must_not_consume_probe');
  }
  await e.start();assert.equal(e.version,'0.171.0-alpha.7');assert.equal((await e.turn(probeText)).status,'completed');await delay(100);console.log(JSON.stringify({phase:'offline-probe',allowed:local.allowed,denied:local.denied,writeExists:existsSync(target('Main/blocked-write')),requestHasTools:local.requestHasTools,fs:m.fs.length,trace:m.traceResponses,tokens:m.tokens}));assert.ok(local.allowed&&local.denied&&!existsSync(target('Main/blocked-write')));assert.equal(m.fs.length,1);assert.equal(m.tokens.totalTokens,4);assert.ok(m.traceResponses.length>=2&&m.traceResponses.every(r=>r.inputTokens===1&&r.outputTokens===1));
 }
 finally{shutdownConfirmed=await e.close()&&shutdownConfirmed;await local.close();}
 assert.ok(shutdownConfirmed,'preflight_shutdown_unconfirmed');
 console.log(JSON.stringify({phase:'self-check',passed:true,sandboxReadWriteBoundaries:true,tokenTelemetry:true}));
 if(legacyMain){
  const local=await loopback(''),config={...profile('legacy-offline'),baseUrl:local.url,requiresOpenaiAuth:false},m={},engines=[];let main;
  const app=new Homer(config,async()=>{},(options,handle)=>{const e=new CodexEngine(config,options,handle);main=e;observeAdoption(e,m);engines.push(e);return e;},[],async()=>({home,folders:known}));
  try{const saved=await prepareLegacyMain(config,app);await app.start();await verifyLegacyMain(app,main,saved,m);assert.equal(local.requests,0,'legacy_preparation_and_restore_must_not_use_model');console.log(JSON.stringify({phase:'legacy-self-check',passed:true,originalThreadRetained:true,completeCurrentPromptInjected:true,modelRequests:0}));}
  finally{try{await app.close({requireAllOwnersConfirmed:true});}catch{shutdownConfirmed=false;}for(const e of engines)shutdownConfirmed=await e.close()&&shutdownConfirmed;await local.close();}
  assert.ok(shutdownConfirmed,'preflight_shutdown_unconfirmed');
 }
}
const safeError=e=>/^[a-z_]{3,80}$/.test(e?.message??'')?e.message:'validation_operation_failed';
function nativeEvidence(c,m,engines){
 const threads=new Map(engines.filter(e=>e.threadId).map(e=>[e.threadId,e.options.nativeTools]));
 const visit=dir=>{for(const name of readdirSync(dir,{withFileTypes:true})){const path=join(dir,name.name);if(name.isDirectory())visit(path);else if(name.name.endsWith('.jsonl')){
  const rows=readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l)),meta=rows.find(r=>r.type==='session_meta')?.payload;if(!threads.has(meta?.id))continue;
  if(threads.get(meta.id)==='main'){
   m.directoryRuleInNativeHistory=JSON.stringify(rows).includes(directoryRule);
   const fileCalls=new Set();m.filesystemOutputHints=[];
   for(const row of rows){const v=row.payload;if(row.type==='response_item'&&v.type==='custom_tool_call'&&v.input?.includes('tools.exec_command'))fileCalls.add(v.call_id);if(row.type==='response_item'&&v.type==='custom_tool_call_output'&&fileCalls.has(v.call_id)){const output=JSON.stringify(v.output);m.filesystemOutputHints.push(['星桥','contracts','current','draft.txt','atlas','native','ledger-assistant','AGENTS.md','README.md'].filter(word=>output.includes(word)));}}
   let pending=false,rounds=0,responses=0;for(const r of rows){if(r.type==='response_item'&&['custom_tool_call','function_call','tool_search_call'].includes(r.payload.type))pending=true;if(r.type==='token_usage_record'){responses++;if(pending)rounds++;pending=false;}}
   m.toolRounds=rounds;m.modelResponses=responses;
   const total=rows.filter(r=>r.type==='event_msg'&&r.payload.type==='token_count').at(-1)?.payload.info?.total_token_usage;
   const fields={inputTokens:'input_tokens',cachedInputTokens:'cached_input_tokens',outputTokens:'output_tokens',reasoningOutputTokens:'reasoning_output_tokens',totalTokens:'total_tokens'};
   m.usageMatchesNative=!!total&&Object.entries(fields).every(([a,b])=>m.tokens?.[a]===total[b]);
  }else{
   const text=JSON.stringify(rows.filter(r=>r.type==='response_item').map(r=>r.payload));m.workers.push({cwd:relative(home,meta.cwd),rules:['CLIENT','CONTRACT','ATLAS','NATIVE','LEDGER'].filter(tag=>text.includes('SYNTHETIC_'+tag+'_RULE'))});
   const user=rows.filter(r=>r.type==='response_item'&&r.payload.role==='user').at(-1)?.payload;
   const assignment=(user?.content??[]).map(c=>c.text??'').join('\n');m.workerAssignmentAsksLocate=/(定位|查找|寻找|找到|搜索).{0,45}(项目|目录|文件|草稿|本机|Atlas|账簿|模块)/u.test(assignment);
  }
 }}};
 const sessions=join(profiles,c.trial,'codex/sessions');if(existsSync(sessions))visit(sessions);
}
let access,account;const protectedFiles=[];
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function authenticate(e,m){const request=e.request.bind(e);let ready=false;e.request=async(method,params)=>{
 if(['config/read','turn/start'].includes(method)&&params?.cwd&&!inside(home,resolve(params.cwd)))throw Error('fixture_boundary_denied');
 if(method==='config/read'&&!ready){ready=true;const r=await request('account/login/start',{type:'chatgptAuthTokens',accessToken:access,chatgptAccountId:account,chatgptPlanType:null});assert.equal(r.type,'chatgptAuthTokens');}
 const result=await request(method,params);
 if(m&&method==='mcpServerStatus/list'){const tool=result.data?.find(s=>s.name==='homer_interactions')?.tools?.list_work_directories;m.directoryToolInInventory=!!tool;m.directoryDescriptionMatches=typeof tool?.description==='string'?tool.description===LIST_WORK_DIRECTORIES.description:null;}
 return result;
};}
async function run(c){
 assert.ok(!existsSync(join(profiles,c.trial)),'trial_profile_already_exists');
 const config=profile(c.trial),local=await loopback();local.rule=c.rule;
 const m={id:c.id,trial:c.trial,expected:c.expected,dispatches:[],workers:[],business:[],openAttempts:[],traceResponses:[],fs:[],lookup:0,workDirectory:0,tools:[],retries:0,started:0},engines=[];let app,timer,rejectBudget,mainEngine,saved,stage='boot';
 const budget=new Promise((_,reject)=>{rejectBudget=reject;});
 app=new Homer(config,async()=>{},(options,handler)=>{
  assert.ok(inside(home,resolve(options.cwd)),'fixture_boundary_denied');const main=options.nativeTools==='main';
  const e=new CodexEngine(main?config:{...config,baseUrl:local.url,requiresOpenaiAuth:false},options,async call=>{
   if(main)m.business.push(call.tool);
   if(main&&call.tool==='worker_open'){const value=call.arguments?.workingDirectory;m.openAttempts.push({workingDirectoryProvided:typeof value==='string',suppliedDirectory:typeof value!=='string'?null:inside(home,resolve(value))?relative(home,resolve(value)):'outside_fixture'});}
   const result=await handler(call);
   if(main&&call.tool==='worker_open'){const run=result?.workerId&&app.tasks.run(result.workerId);m.dispatches.push({cwd:run?relative(home,run.workingDirectory):null,atMs:Math.round(performance.now()-m.started),accepted:!!run});}return result;
  });engines.push(e);
  if(main){authenticate(e,m);if(legacyMain)observeAdoption(e,m);observe(e,m,()=>rejectBudget(Error('model_response_budget_exceeded')));e.on('turnRetry',()=>rejectBudget(Error('native_retry_not_authorized')));const turn=e.turn.bind(e);e.turn=async(...args)=>{const r=await turn(...args);m.lastTurnStatus=r.status;m.lastTurnError=r.errorCode??null;return r;};}return e;
 },[],async(includeFolders=true)=>({home,folders:includeFolders?known:[]}));
 try{
  if(legacyMain){saved=await prepareLegacyMain(config,app);m.seededWithoutModel=true;}
  timer=setTimeout(()=>rejectBudget(Error('trial_time_budget_exceeded')),180000);const boot=performance.now();await Promise.race([app.start(),budget]);m.bootMs=Math.round(performance.now()-boot);
  if(saved){mainEngine=engines.find(e=>e.options.nativeTools==='main');await verifyLegacyMain(app,mainEngine,saved,m);assert.equal(m.traceResponses.length,0,'restoration_must_not_use_model');}
  stage='model';m.started=performance.now();
  await Promise.race([app.message(c.text,'directory-check-'+c.trial),budget]);m.mainTurnMs=Math.round(performance.now()-m.started);m.mainDirectoryUnchanged=!app.store.meta('mainWorkingDirectory');
  stage='settle';const end=performance.now()+3000;while(performance.now()<end){if(local.taskRequests>0&&m.traceResponses.length>=(m.usageUpdates??0)+1)break;await delay(50);}await delay(100);
  m.workerTaskRequestObserved=local.taskRequests>0;m.workerRuleSeenInRequest=!c.rule||local.ruleSeen;m.status=m.lastTurnStatus==='completed'?'completed':'incomplete';
  if(saved)await verifyLegacyMain(app,mainEngine,saved,m);
 }catch(e){m.status='incomplete';m.stage=stage;m.errorCode=safeError(e);}
 finally{clearTimeout(timer);try{await app.close({requireAllOwnersConfirmed:true});}catch{shutdownConfirmed=false;m.shutdownFailed=true;}for(const e of engines)shutdownConfirmed=await e.close()&&shutdownConfirmed;await local.close();}
 nativeEvidence(c,m,engines);m.cwdCorrect=m.dispatches.length===1&&m.dispatches[0].accepted&&c.expected.includes(m.dispatches[0].cwd);
 m.workerNativeCwdMatches=m.workers.length===1&&m.workers[0].cwd===m.dispatches[0]?.cwd;
 m.requiredRuleLoaded=m.workers.length===1&&(!c.rule||m.workers[0].rules.includes(c.rule));
 m.queryBehaviorCorrect=c.id.startsWith('K')?m.lookup===0:m.lookup>=1&&m.fs.some(f=>f.afterLookup);
 m.passed=m.status==='completed'&&m.cwdCorrect&&m.queryBehaviorCorrect&&m.mainDirectoryUnchanged&&m.workerNativeCwdMatches&&m.requiredRuleLoaded&&m.usageMatchesNative&&m.workerTaskRequestObserved&&(!legacyMain||m.legacyPromptAdopted&&m.originalThreadRetained&&m.legacyToolsRetained&&m.legacyHistoryPrefixRetained&&m.legacyAttachmentRetained);
 m.observedAllResponseTokens=m.traceResponses.length>0&&m.traceResponses.every(r=>r.inputTokens!==null&&r.outputTokens!==null)?{inputTokens:m.traceResponses.reduce((a,r)=>a+r.inputTokens,0),outputTokens:m.traceResponses.reduce((a,r)=>a+r.outputTokens,0)}:null;
 delete m.started;save(c.trial+'.json',m);console.log(JSON.stringify({phase:'trial',trial:c.trial,passed:m.passed,cwd:m.dispatches[0]?.cwd??null,lookup:m.lookup,fs:m.fs.length,rounds:m.toolRounds,tokens:m.tokens?.totalTokens??null,dispatchMs:m.dispatches[0]?.atMs??null,status:m.status}));return m;
}
const report={at:new Date().toISOString(),model,effort:'medium',serviceTier:null,legacyMain:!!legacyMain,results:[]};
try{
 await selfCheck();
 assert.ok(shutdownConfirmed,'preflight_shutdown_unconfirmed');
 if(mode==='--paid'){
  const auth=realpathSync(spec.authFile);protectedFiles.push({path:auth,hash:digest(auth)});if(spec.dailyProfile){const p=realpathSync(spec.dailyProfile);protectedFiles.push({path:p,hash:digest(p)});}
  const tokens=JSON.parse(readFileSync(auth,'utf8')).tokens;access=tokens.access_token;account=tokens.account_id;assert.ok(access&&account);assert.ok(JSON.parse(Buffer.from(access.split('.')[1],'base64url')).exp*1000>Date.now()+600000);
  const seed=new CodexEngine(profile('auth-only'),{cwd:workspace,readRoots:[workspace],instructions:'No model turn.',tools:[],nativeTools:'main'},async()=>{});authenticate(seed);try{await seed.start();assert.equal(seed.version,'0.171.0-alpha.7');}finally{shutdownConfirmed=await seed.close()&&shutdownConfirmed;}
  for(const c of trials){const result=await run(c);report.results.push(result);if(result.status==='incomplete'||!shutdownConfirmed||!protectedFiles.every(f=>digest(f.path)===f.hash)||existsSync(join(userInfo().homedir,'.homer-project-root'))!==realHomeFallbackBefore||spec.stopOnFailure&&!result.passed)break;}
 }
}catch(e){report.errorCode=safeError(e);process.exitCode=1;console.log(JSON.stringify({phase:'validation-failed',code:report.errorCode,name:e.name,frames:e.stack?.split('\n').filter(l=>/^\s+at /.test(l)).slice(0,2),expected:['number','boolean'].includes(typeof e.expected)?e.expected:undefined,actual:['number','boolean'].includes(typeof e.actual)?e.actual:undefined}));}
finally{
 report.shutdownConfirmed=shutdownConfirmed;report.protectedFilesUnchanged=protectedFiles.every(f=>digest(f.path)===f.hash);report.realHomeFallbackExists=existsSync(join(userInfo().homedir,'.homer-project-root'));report.realHomeFallbackUnchanged=report.realHomeFallbackExists===realHomeFallbackBefore;report.endedAt=new Date().toISOString();save('results.json',report);
 console.log(JSON.stringify({phase:'summary',trials:report.results.length,passed:report.results.filter(r=>r.passed).length,shutdownConfirmed,protectedFilesUnchanged:report.protectedFilesUnchanged}));
 if(!shutdownConfirmed||!report.protectedFilesUnchanged||!report.realHomeFallbackUnchanged||mode==='--paid'&&(report.results.length!==trials.length||report.results.some(r=>!r.passed)))process.exitCode=1;
}
