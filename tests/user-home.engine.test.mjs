import './fixtures/synthetic-home.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import childProcess,{execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';

const moduleUrl=process.env.HOMER_TEST_SERVICE_MODULE,bin=process.env.HOMER_TEST_CODEX_BIN;
assert.equal(process.platform,'darwin','home_native_acceptance_requires_macos');
assert.ok(moduleUrl?.startsWith('file://'),'explicit service module required');
assert.ok(bin&&isAbsolute(bin),'explicit fixed native executable required');
const {Homer}=await import(moduleUrl);
const {CodexEngine,codexVersion}=await import(new URL('./engine.js',moduleUrl));
const fixedVersion=codexVersion(bin);
const baselineBin=process.env.HOMER_TEST_CODEX_BASELINE_BIN,baselineModule=process.env.HOMER_TEST_BASELINE_ENGINE_MODULE;
assert.equal(!!baselineBin,!!baselineModule,'baseline native binary and compiled engine must be supplied together');
if(baselineBin)assert.ok(isAbsolute(baselineBin)&&baselineModule.startsWith('file://'),'explicit isolated baseline paths required');
const seeds=[{Engine:CodexEngine,bin,version:fixedVersion}];
if(baselineBin)seeds.push({Engine:(await import(baselineModule)).CodexEngine,bin:baselineBin,version:codexVersion(baselineBin)});
// A shell wrapper changes the lease identity at exec; keep the real executable.
const spawn=childProcess.spawn;
childProcess.spawn=(file,args,options)=>spawn(file,args,seeds.some(seed=>seed.bin===file)?{...options,env:{...options.env,ZDOTDIR:options.env.HOME,BASH_ENV:join(options.env.HOME,'empty-shell.env')}}:options);
syncBuiltinESMExports();
const {MAIN_DYNAMIC_TOOLS,MAIN_TOOLS_HASH}=await import(new URL('./recursive-tools.js',moduleUrl));
const {loadPrompts}=await import(new URL('./prompts.js',moduleUrl));
const secretName='HOMER_HOME_FIXTURE_TOKEN';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>process.platform==='win32'?"'"+value.replaceAll("'","''")+"'":"'"+value.replaceAll("'","'\\''")+"'";
const toml=value=>value&&typeof value==='object'&&!Array.isArray(value)?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(value);
const textValues=value=>{
 if(typeof value==='string'){try{const decoded=JSON.parse(value);if(decoded!==value)return textValues(decoded);}catch{}return [value];}
 if(Array.isArray(value))return value.flatMap(textValues);
 if(value&&typeof value==='object')return Object.values(value).flatMap(textValues);
 return [];
};

async function fixture(t,{keyEnv=false,ownAccount=true}={}){
 // A real Git ancestor would invalidate the no-Git boundary case.
 const root=realpathSync(mkdtempSync(join(tmpdir(),'homer-home-'))),user=join(root,'user home_合成'),home=join(root,'codex'),repo=join(user,'project'),oldHome=join(home,'host-home'),outside=join(root,'outside.txt');
 const engines=[],apps=[],policies=new Map(),retained=[],previous={};let server;
 const state={requests:0,catalogs:0,rejected:0,marker:null,script:null,sent:false,results:[],homerGuidance:false,ordinaryGuidance:false};
 t.after(async()=>{
  let stopped=true;try{for(const app of apps)await app.close({requireAllOwnersConfirmed:true});}catch{stopped=false;}
  for(const engine of engines)stopped=await engine.close()&&stopped;
  server?.closeAllConnections();if(server?.listening)await new Promise(r=>server.close(r));
  for(const [name,value]of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;
  assert.ok(stopped,'native owners must exit before removing the isolated fixture');
  assert.equal(state.rejected,0,'all model traffic must stay on the local synthetic Responses route');
  for(const [path,sha]of retained)assert.equal(hash(readFileSync(path)),sha);
  rmSync(root,{recursive:true,force:true});
 });
 t.diagnostic(JSON.stringify({syntheticFixtureRoot:root}));
 for(const path of [user,home,repo,oldHome,join(root,'runtime'),join(root,'tmp'),join(user,'.codex')])mkdirSync(path,{recursive:true,mode:0o700});
 for(const path of [user,oldHome])writeFileSync(join(path,'empty-shell.env'),'');
 writeFileSync(outside,'SYNTHETIC_OUTSIDE_UNCHANGED');writeFileSync(join(oldHome,'retain.txt'),'SYNTHETIC_OLD_HOME');
 const gitConfig=(name,email)=>'[user]\nname = '+name+'\nemail = '+email+'\n[commit]\ngpgsign = false\n';
 writeFileSync(join(user,'.gitconfig'),gitConfig('Synthetic Current User','current@example.invalid'));
 writeFileSync(join(oldHome,'.gitconfig'),gitConfig('Synthetic Legacy User','legacy@example.invalid'));
 writeFileSync(join(user,'.codex/auth.json'),JSON.stringify({OPENAI_API_KEY:'SYNTHETIC_ORDINARY_PROFILE_ONLY'}));
 if(ownAccount)writeFileSync(join(home,'auth.json'),JSON.stringify({OPENAI_API_KEY:'SYNTHETIC_HOMER_PROFILE_ONLY'}),{mode:0o600});
 writeFileSync(join(user,'.codex/config.toml'),'project_doc_fallback_filenames = ["ORDINARY_CONTEXT.md"]\n');
 writeFileSync(join(user,'.codex/AGENTS.md'),'FORBIDDEN_ORDINARY_GUIDANCE');
 writeFileSync(join(home,'AGENTS.md'),'SYNTHETIC_HOMER_GUIDANCE');
 writeFileSync(join(user,'.homer-project-root'),'');writeFileSync(join(repo,'AGENTS.md'),'SYNTHETIC_PROJECT_GUIDANCE');
 const gitEnv={PATH:process.env.PATH,HOME:user,CODEX_HOME:home,GIT_CONFIG_NOSYSTEM:'1',...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,USERPROFILE:user,TEMP:join(root,'tmp'),TMP:join(root,'tmp')}:{})};
 const git=(args,cwd=repo)=>execFileSync('git',['-C',cwd,...args],{env:gitEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','--quiet']);git(['commit','--quiet','--allow-empty','-m','Synthetic fixture']);
 server=createServer(async(req,res)=>{
  if(req.method==='GET'&&new URL(req.url,'http://localhost').pathname==='/v1/models'){state.catalogs++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[]}));return;}
  if(req.method!=='POST'||req.url!=='/v1/responses'){state.rejected++;res.writeHead(403).end();return;}
  req.setEncoding('utf8');let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>2*1024*1024){state.rejected++;res.writeHead(413).end();return;}}
  let data;try{data=JSON.parse(body);}catch{state.rejected++;res.writeHead(400).end();return;}
  state.requests++;if(state.requests>40){state.rejected++;res.writeHead(429).end();return;}
  const texts=textValues(data.input);state.homerGuidance||=texts.some(s=>s.includes('SYNTHETIC_HOMER_GUIDANCE'));state.ordinaryGuidance||=texts.some(s=>s.includes('FORBIDDEN_ORDINARY_GUIDANCE'));
  for(const text of texts)for(const line of text.split('\n')){
   const match=line.match(/SYNTHETIC_HOME_RESULT=(\{[^\n]*\})/);if(match){try{const value=JSON.parse(match[1]);if(!state.results.some(r=>r.marker===value.marker))state.results.push(value);}catch{}}
  }
  const hasTools=Array.isArray(data.tools)&&data.tools.length>0||(data.input??[]).some(item=>item.type==='additional_tools');
  const probe=!state.sent&&state.script&&hasTools&&data.model==='gpt-6.1-sol'&&data.max_output_tokens!==0&&(data.input??[]).some(item=>item.role==='user'&&textValues(item.content).some(s=>s.includes(state.marker)));
  if(probe)state.sent=true;
  const n=String(state.requests),item=probe?{id:'call-home-'+n,type:'custom_tool_call',namespace:'functions',name:'exec',call_id:'home-'+n,input:state.script}:{id:'msg-home-'+n,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic local completion.',annotations:[]}]};
  const response={id:'resp-home-'+n,object:'response',model:data.model,created_at:1,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.setHeader('Content-Type','text/event-stream');for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();
 });
 server.on('connect',(_req,socket)=>{state.rejected++;socket.on('error',()=>{});socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(origin+'/v1/models')).status,200,'the loopback target must be reachable outside the native sandbox');
 const environment={HOME:user,CODEX_HOME:home,...(process.platform==='win32'?{USERPROFILE:user}:{}),[secretName]:'SYNTHETIC_NEVER_FORWARD',HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,http_proxy:origin,https_proxy:origin,all_proxy:origin,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
 for(const [name,value]of Object.entries(environment)){previous[name]=process.env[name];process.env[name]=value;}
 const native={openai_base_url:origin+'/v1',check_for_update_on_startup:false,analytics:{enabled:false},feedback:{enabled:false},features:{apps:false,plugins:false,skip_host_skill_discovery:true},memories:{generate_memories:false,use_memories:false},project_root_markers:['.git','.homer-project-root'],
  default_permissions:'home_fixture',approval_policy:'on-request',permissions:{home_fixture:{filesystem:{':root':'deny',':minimal':'read','/usr':'read','/bin':'read','/sbin':'read','/System':'read','/Library':'read','/opt/homebrew':'read',[user]:'read',[home]:'read',[dirname(process.execPath)]:'read',...Object.fromEntries(seeds.map(seed=>[dirname(seed.bin),'read']))},network:{enabled:false}}},
  shell_environment_policy:{inherit:'none',set:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',SYNTHETIC_PROFILE_SETTING:'retained',ZDOTDIR:user,BASH_ENV:join(user,'empty-shell.env')}}};
 const writeConfig=()=>writeFileSync(join(home,'config.toml'),Object.entries(native).map(([k,v])=>k+'='+toml(v)).join('\n')+'\n');writeConfig();
 const config={workspace:repo,runtime:join(root,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:bin,baseUrl:origin+'/v1',model:'gpt-6.1-sol',requiresOpenaiAuth:false,stopGraceMs:1000,...(keyEnv?{keyEnv:secretName}:{})};
 let sequence=0;
 const track=e=>{
  const method=typeof e.nativeRequest==='function'?'nativeRequest':'request',request=e[method].bind(e);
  e[method]=async(name,params)=>{
   const result=await request(name,params);
   if(['thread/start','thread/resume'].includes(name)){
    assert.equal(result.activePermissionProfile?.id,'home_fixture');assert.equal(result.approvalPolicy,'on-request');assert.equal(result.approvalsReviewer,'user');
    assert.ok(result.sandbox?.type,'the native sandbox snapshot must exist');assert.equal(result.cwd,e.options.cwd);
    const effective=(await request('config/read',{cwd:e.options.cwd,includeLayers:true})).config;
    assert.ok(effective.permissions?.home_fixture?.filesystem,'the selected native filesystem policy must exist');
    assert.equal(effective.permissions.home_fixture.network.enabled,false);
    policies.set(e,{profile:result.activePermissionProfile,sandbox:result.sandbox,approval:result.approvalPolicy,reviewer:result.approvalsReviewer,cwd:result.cwd,permissions:effective.permissions.home_fixture});
   }
   return result;
  };engines.push(e);return e;
 };
 const make=(role='worker',threadId,cwd=repo,instructions='Synthetic local HOME inspection.',tools=[],seed=seeds[0])=>
  track(new seed.Engine({...config,codexBin:seed.bin},{cwd,readRoots:[],instructions,tools,nativeTools:role,role,threadId,onInteraction:async()=>({status:'denied',decision:{action:'deny',reason:'synthetic_unexpected_approval'}})},async()=>{throw Error('unexpected_host_tool');}));
 const inspect=async(engine,submit)=>{
  const marker='SYNTHETIC_HOME_PROBE_'+(++sequence);state.marker=marker;state.sent=false;
  const code=`const fs=require('node:fs'),cp=require('node:child_process');const info={marker:${JSON.stringify(marker)},home:process.env.HOME??null,codexHome:process.env.CODEX_HOME??null,secretPresent:!!process.env[${JSON.stringify(secretName)}],profileSetting:process.env.SYNTHETIC_PROFILE_SETTING??null};
if(${JSON.stringify([user,oldHome])}.includes(info.home)){const git=(args)=>{try{return cp.execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{return null;}};info.name=git(['config','--get','user.name']);info.email=git(['config','--get','user.email']);info.author=info.name&&info.email?git(['var','GIT_AUTHOR_IDENT']):null;info.committer=info.name&&info.email?git(['var','GIT_COMMITTER_IDENT']):null;info.gitRoot=git(['rev-parse','--show-toplevel']);}
try{fs.writeFileSync(${JSON.stringify(outside)},'SYNTHETIC_UNEXPECTED_WRITE');info.outsideWrite=true;}catch{info.outsideWrite=false;}
info.curlAvailable=cp.spawnSync('/usr/bin/curl',['-q','--version'],{stdio:'ignore',timeout:3000}).status===0;
info.networkBlocked=cp.spawnSync('/usr/bin/curl',['-q','--noproxy','*','--connect-timeout','1','--max-time','2',${JSON.stringify(origin+'/v1/models')}],{stdio:'ignore',timeout:3000}).status!==0;
process.stdout.write('SYNTHETIC_HOME_RESULT='+JSON.stringify(info));`;
  const command=(process.platform==='win32'?'& ':'')+quote(process.execPath)+' -e '+quote(code);
  state.script='text(await tools.exec_command('+JSON.stringify({cmd:command,workdir:engine.options.cwd,shell:'/bin/zsh',login:false})+'));';
  const result=await (submit?submit(marker):engine.turn(marker));assert.equal(result?.status??'completed','completed');
  const found=state.results.find(r=>r.marker===marker);assert.ok(found,'the real native command must return its environment and Git observation');return found;
 };
 retained.push(...[join(oldHome,'retain.txt'),join(oldHome,'.gitconfig'),...(ownAccount?[join(home,'auth.json')]:[]),join(user,'.codex/auth.json'),join(user,'.codex/config.toml')].map(path=>[path,hash(readFileSync(path))]));
 return {root,user,home,oldHome,repo,outside,config,git,state,engines,apps,policies,track,make,inspect,native,writeConfig};
}

function currentIdentity(f,info,{name='Synthetic Current User',email='current@example.invalid',gitRoot=f.repo}={}){
 assert.equal(info.home,f.user);assert.equal(info.codexHome,f.home);assert.equal(info.name,name);assert.equal(info.email,email);
 assert.ok(info.author?.startsWith(name+' <'+email+'> '));assert.ok(info.committer?.startsWith(name+' <'+email+'> '));
 assert.equal(info.gitRoot,gitRoot);assert.equal(info.secretPresent,false);assert.equal(info.profileSetting,'retained');assert.equal(info.outsideWrite,false);
 assert.equal(info.curlAvailable,true);assert.equal(info.networkBlocked,true);
 assert.equal(readFileSync(f.outside,'utf8'),'SYNTHETIC_OUTSIDE_UNCHANGED');
}

async function seedLegacy(f,role,seed){
 const instructions=role==='main'?loadPrompts().main:'Synthetic saved Worker instructions.',tools=role==='main'?MAIN_DYNAMIC_TOOLS:[];
 f.native.shell_environment_policy.inherit='all';f.writeConfig();process.env.HOME=f.oldHome;if(process.platform==='win32')process.env.USERPROFILE=f.oldHome;
 const engine=f.make(role,undefined,f.repo,instructions,tools,seed);
 try{
  await engine.start();assert.equal('codex-cli '+engine.version,seed.version);const old=await f.inspect(engine);assert.equal(old.home,f.oldHome);assert.equal(old.name,'Synthetic Legacy User');assert.equal(old.outsideWrite,false);assert.equal(old.curlAvailable,true);assert.equal(old.networkBlocked,true);
  const {attachment}=await engine.request('thread/attachment/add',{threadId:engine.threadId,attachmentType:'synthetic.document',identityKey:'home-restore',payload:{name:'fixture.txt',contents:'SYNTHETIC_ATTACHMENT'}});
  const {thread}=await engine.request('thread/read',{threadId:engine.threadId,includeTurns:true});
  assert.ok(f.policies.has(engine));return {threadId:thread.id,path:thread.path,prefix:readFileSync(thread.path),attachment,instructions,policy:f.policies.get(engine)};
 }finally{assert.ok(await engine.close());process.env.HOME=f.user;if(process.platform==='win32')process.env.USERPROFILE=f.user;f.native.shell_environment_policy.inherit='none';f.writeConfig();}
}

async function retainedThread(engine,saved){
 const {thread}=await engine.request('thread/read',{threadId:engine.threadId,includeTurns:true});assert.equal(thread.id,saved.threadId);assert.equal(thread.path,saved.path);
 assert.ok(readFileSync(thread.path).subarray(0,saved.prefix.length).equals(saved.prefix));
 assert.deepEqual((await engine.request('thread/attachment/list',{threadId:engine.threadId})).data,[saved.attachment]);
}

test('native commands retain HOME and the independent Codex profile with inherit=none and never receive the provider token',{timeout:60000},async t=>{
 const f=await fixture(t,{keyEnv:true}),e=f.make();
 try{await e.start();assert.equal('codex-cli '+e.version,fixedVersion);currentIdentity(f,await f.inspect(e));assert.equal(f.state.homerGuidance,true);assert.equal(f.state.ordinaryGuidance,false);}
 finally{assert.ok(await e.close());}
});

for(const seed of seeds){
test('Homer resumes a saved Main from '+seed.version+' with a new HOME and retains its original history, attachment and native tools',{timeout:90000},async t=>{
 const f=await fixture(t),saved=await seedLegacy(f,'main',seed);let main;
 const app=new Homer(f.config,async()=>{},(options,handle)=>{const e=f.track(new CodexEngine(f.config,options,handle));if(options.nativeTools==='main')main=e;return e;},[],async()=>({home:f.user,folders:[]}));f.apps.push(app);
 app.store.setMeta('mainThread',saved.threadId);app.store.setMeta('mainToolsHash',MAIN_TOOLS_HASH);app.store.setMeta('mainPromptHash',hash(JSON.stringify([saved.threadId,loadPrompts().main])));
 await app.start();assert.equal(main.threadId,saved.threadId);assert.ok(f.policies.has(main));assert.deepEqual(f.policies.get(main),saved.policy);await retainedThread(main,saved);
 currentIdentity(f,await f.inspect(main,marker=>app.message(marker,'synthetic-home-restore')));await retainedThread(main,saved);
 const first=JSON.parse(readFileSync(saved.path,'utf8').split('\n')[0]);assert.deepEqual(first.payload.dynamic_tools??[],MAIN_DYNAMIC_TOOLS);
 assert.equal(app.store.meta('mainThread'),saved.threadId);assert.equal(app.store.meta('mainToolsHash'),MAIN_TOOLS_HASH);assert.equal(app.store.meta('mainWorkingDirectory'),undefined);
});

test('a saved native Worker from '+seed.version+' adopts the new HOME without rewriting its prior history or permissions',{timeout:90000},async t=>{
 const f=await fixture(t),saved=await seedLegacy(f,'worker',seed),e=f.make('worker',saved.threadId);
 try{await e.start();await retainedThread(e,saved);assert.ok(f.policies.has(e));assert.deepEqual(f.policies.get(e),saved.policy);currentIdentity(f,await f.inspect(e));await retainedThread(e,saved);}
 finally{assert.ok(await e.close());}
});
}

test('native Git keeps repository overrides, worktree roots and no-Git boundaries while HOME changes',{timeout:90000},async t=>{
 const f=await fixture(t),sub=join(f.repo,'sub'),worktree=join(f.user,'linked worktree'),notes=join(f.user,'notes');
 mkdirSync(sub);mkdirSync(notes);f.git(['worktree','add','--quiet','--detach',worktree]);writeFileSync(join(worktree,'AGENTS.md'),'SYNTHETIC_WORKTREE_GUIDANCE');
 for(const cwd of [f.repo,sub,worktree,notes]){
  const e=f.make('worker',undefined,cwd);
  try{await e.start();currentIdentity(f,await f.inspect(e),{gitRoot:cwd===notes?null:cwd===sub?f.repo:cwd});assert.deepEqual((await e.request('config/read',{cwd,includeLayers:true})).config.project_root_markers,['.git','.homer-project-root']);}
  finally{assert.ok(await e.close());}
 }
 assert.equal(existsSync(join(worktree,'.git')),true);
 f.git(['config','user.name','Synthetic Repository User']);f.git(['config','user.email','repository@example.invalid']);
 writeFileSync(join(f.repo,'.gitconfig'),'[user]\nname = MUST_NOT_BE_DISCOVERED\nemail = ignored@example.invalid\n');
 const e=f.make();try{await e.start();currentIdentity(f,await f.inspect(e),{name:'Synthetic Repository User',email:'repository@example.invalid'});}finally{assert.ok(await e.close());}
});

for(const ownAccount of [true,false])test('native account control '+(ownAccount?'retains its own account and config':'does not fall back to the ordinary Codex account from HOME'),{timeout:60000},async t=>{
 // Homer.nativeRpc manages accounts through the unoverridden native provider.
 const f=await fixture(t,{ownAccount}),e=new CodexEngine({...f.config,baseUrl:undefined,requiresOpenaiAuth:true},{cwd:f.repo,readRoots:[],instructions:'Synthetic control inspection.',tools:[],controlOnly:true},async()=>{throw Error('no_tools');});f.engines.push(e);
 try{
  await e.start();assert.equal('codex-cli '+e.version,fixedVersion);const config=await e.request('config/read',{cwd:f.repo,includeLayers:true});
  assert.ok(config.layers.some(layer=>layer.name.type==='user'&&layer.name.file===join(f.home,'config.toml')));
  assert.ok(!config.layers.some(layer=>layer.name.file===join(f.user,'.codex/config.toml')));
  assert.ok(!config.config.project_doc_fallback_filenames.includes('ORDINARY_CONTEXT.md'));
  assert.deepEqual((await e.request('account/read',{refreshToken:false})).account,ownAccount?{type:'apiKey'}:null);assert.equal(f.state.requests,0);
 }finally{assert.ok(await e.close());}
});
