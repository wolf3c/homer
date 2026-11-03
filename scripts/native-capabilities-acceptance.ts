// Fixed native engine, empty HOME, synthetic threads and loopback MCP only.
// Native turns use only the loopback fake Responses endpoint. No real model,
// account, existing session or existing configuration is read.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {nativeTokenUsage} from '../src/native-usage.js';
import {CodexEngine} from '../src/engine.js';
import {nativeMcpLogout} from '../src/native-mcp-logout.js';
import {NativeCapabilities} from '../src/native-capabilities.js';
import {MAIN_TOOLS} from '../src/tools.js';
const root=resolve('.codex/scratch/native-capabilities-implementation');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'native-acceptance-'));
const bin=resolve(process.argv[2]??'.codex/private/engines/codex-0.163.0/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
const config={appData:dir,codexHome:join(dir,'codex'),codexBin:bin,workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),baseUrl:'' as string,model:'gpt-6.1-sol',effort:'medium' as const,requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:1000};
mkdirSync(config.workspace,{recursive:true});mkdirSync(config.runtime,{recursive:true});
// Native built-in skills are not user-granted Homer capabilities. The engine
// fences them off per thread while native discovery remains the source.
const make=(threadId?:string)=>new CodexEngine(config,{cwd:config.workspace,readRoots:[config.workspace],instructions:'Synthetic protocol check. No model.',tools:MAIN_TOOLS,threadId,nativeCapabilities:true},async()=>{throw Error('model_tools_never_called');});
let pauseResponses=false;const heldResponses=new Set<import('node:http').ServerResponse>();
let engine:CodexEngine|undefined;let origin='';let tokenExchanges=0;let protectedCalls=0;const mockPrompts:{skillBody:boolean;systemSkill:boolean;disabledBody:boolean;skillDescription:boolean}[]=[];
const mcpResult=(m:any)=>{if(m.method==='initialize')return {protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'homer-loopback-mcp',version:'1'}};if(m.method==='ping')return {};if(m.method==='tools/list')return {tools:[{name:'echo',description:'Synthetic loopback echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};if(m.method==='tools/call')return {content:[{type:'text',text:'synthetic-http:'+m.params.arguments.text}],isError:false};if(m.method==='resources/list')return {resources:[]};if(m.method==='resources/templates/list')return {resourceTemplates:[]};return {};};
const http=createServer(async(req,res)=>{const u=new URL(req.url!,origin);const json=(v:any)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
 if(u.pathname==='/v1/responses'){
  let raw='';for await(const c of req)raw+=c;mockPrompts.push({skillBody:raw.includes('未给日期及负责人须标待确认。'),systemSkill:raw.includes('Use for Codex models/pricing'),disabledBody:raw.includes('NEVER_LOAD_DISABLED_SYNTHETIC_BODY'),skillDescription:raw.includes('修正合成清单')});
  res.setHeader('Content-Type','text/event-stream');const item={id:'msg-synthetic-'+mockPrompts.length,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic native Skill receipt.',annotations:[]}]};const response={id:'resp-synthetic-'+mockPrompts.length,object:'response',created_at:1,model:'gpt-6.1-sol',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'Synthetic native Skill receipt.'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]){res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');if(pauseResponses&&event.type==='response.output_text.delta'){heldResponses.add(res);res.on('close',()=>heldResponses.delete(res));return;}}return res.end();
 }
 if(u.pathname==='/.well-known/oauth-protected-resource'){return json({resource:origin+'/protected',authorization_servers:[origin],scopes_supported:['echo']});}
 if(u.pathname==='/.well-known/oauth-authorization-server'){return json({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});}
 if(u.pathname==='/register'){let b='';for await(const c of req)b+=c;const data=JSON.parse(b);return json({...data,client_id:'synthetic-client',token_endpoint_auth_method:'none'});}
 if(u.pathname==='/authorize'){const target=new URL(u.searchParams.get('redirect_uri')!);target.searchParams.set('code','synthetic-code');target.searchParams.set('state',u.searchParams.get('state')!);res.writeHead(302,{Location:target.toString()});return res.end();}
 if(u.pathname==='/token'){tokenExchanges++;return json({access_token:'synthetic-local-only-token',token_type:'Bearer',expires_in:3600,scope:'echo'});}
 if(u.pathname==='/protected'&&req.headers.authorization!=='Bearer synthetic-local-only-token'){protectedCalls++;res.writeHead(401,{'WWW-Authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`});return res.end();}
 if(req.method==='GET'){res.writeHead(405);return res.end();}if(req.method==='DELETE'){res.writeHead(200);return res.end();}
 let raw='';for await(const c of req)raw+=c;let m:any;try{m=JSON.parse(raw);}catch{res.writeHead(400);return res.end();}if(m.id===undefined){res.writeHead(202);return res.end();}json({jsonrpc:'2.0',id:m.id,result:mcpResult(m)});
});await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(http.address() as any).port;
const checks:Record<string,any>={modelCalled:false,realAccountUsed:false,isolatedHome:true};
try{
 config.baseUrl=origin+'/v1';engine=make();const thread=await engine.start();assert.equal(engine.version,'0.163.0');checks.codex=engine.version;
 await engine.request('thread/inject_items',{threadId:thread,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Homer synthetic native capability recovery marker.'}]}]});
 const manager=new NativeCapabilities(config.codexHome,(m,p)=>engine!.request(m,p),()=>true,(name,server)=>nativeMcpLogout(config,name,server));
 const saved=await manager.manage({action:'skill_save',name:'meeting-actions',description:'整理合成清单',body:'未给日期须标待确认。',expectedHash:null},'agent');
 let state=await manager.state();assert.ok(state.skills.some((s:any)=>s.name==='meeting-actions'&&s.enabled));checks.nativeSkillDiscovery=true;
 await manager.manage({action:'skill_toggle',name:'meeting-actions',enabled:false,expectedVersion:state.version},'agent');state=await manager.state();assert.equal(state.skills[0].enabled,false);await manager.manage({action:'skill_toggle',name:'meeting-actions',enabled:true,expectedVersion:state.version},'agent');
 await manager.manage({action:'skill_save',name:'meeting-actions',description:'修正合成清单',body:'未给日期及负责人须标待确认。',expectedHash:saved.hash},'agent');checks.nativeSkillCreateUpdateDisableEnable=true;
 const raw='---\nname: standard-display\ndescription: Synthetic standard metadata\nmetadata:\n  owner: Homer\n---\n\nSynthetic raw method.\n';
 const rawSaved=await manager.manage({action:'skill_save',name:'standard-folder',content:raw,expectedHash:null},'agent');state=await manager.state();assert.equal(state.skills.find((s:any)=>s.name==='standard-folder')?.skillName,'standard-display');
 await assert.rejects(()=>manager.manage({action:'skill_save',name:'standard-folder',content:'---\nname: broken\n---\n\nMissing description.',expectedHash:rawSaved.hash},'agent'),/capability_skill_native_invalid/);assert.equal(readFileSync(join(config.codexHome,'skills/standard-folder/SKILL.md'),'utf8'),raw);checks.nativeStandardMetadataAndInvalidRollback=true;

 for(const [name,server]of [['stdio',{command:process.execPath,args:[resolve('tests/fixtures/native-capability-mcp.mjs')],enabled_tools:['echo']}],['http',{url:origin+'/mcp',enabled_tools:['echo']}] ] as const){state=await manager.state();await manager.manage({action:'mcp_save',name,server,expectedVersion:state.version,approve:true},'user');}
 await engine.refreshCapabilities();
 // Native reload updates active thread connections at the next safe boundary.
 for(const server of ['stdio','http']){const inventory=await engine.request('mcpServerStatus/list',{threadId:thread,serverName:server,detail:'full',limit:100});assert.ok(inventory.data.find((s:any)=>s.name===server)?.tools.echo);const called=await engine.request('mcpServer/tool/call',{threadId:thread,server,tool:'echo',arguments:{text:'native-call'}});assert.notEqual(called.isError,true);assert.match(called.content[0].text,/synthetic.*native-call/);checks[server+'ActualNativeCall']=true;}
 state=await manager.state();const stdioConfig=state.servers.find((s:any)=>s.name==='stdio')!.server;
 await manager.manage({action:'mcp_save',name:'stdio',server:{...stdioConfig,enabled_tools:[]},expectedVersion:state.version},'agent');await engine.refreshCapabilities();
 const narrowed=await engine.request('mcpServerStatus/list',{threadId:thread,serverName:'stdio',detail:'full'});assert.equal(Object.keys(narrowed.data[0]?.tools??{}).length,0);
 let denied=false;try{const result=await engine.request('mcpServer/tool/call',{threadId:thread,server:'stdio',tool:'echo',arguments:{text:'must-deny'}});denied=result.isError===true;}catch{denied=true;}assert.equal(denied,true);checks.nativeToolScopeEnforced=true;
 state=await manager.state();await manager.manage({action:'mcp_save',name:'stdio',server:stdioConfig,expectedVersion:state.version,approve:true},'user');await engine.refreshCapabilities();
 state=await manager.state();await manager.manage({action:'mcp_toggle',name:'stdio',enabled:false,expectedVersion:state.version},'agent');await engine.refreshCapabilities();let inventory=await engine.request('mcpServerStatus/list',{threadId:thread,serverName:'stdio',detail:'full'});assert.ok(!inventory.data[0]||inventory.data[0].runtimeStatus==='disabled'||Object.keys(inventory.data[0].tools).length===0);checks.nativeMcpDisable=true;
 state=await manager.state();await manager.manage({action:'mcp_toggle',name:'stdio',enabled:true,expectedVersion:state.version},'agent');await engine.refreshCapabilities();
 state=await manager.state();await manager.manage({action:'mcp_save',name:'oauthmock',server:{url:origin+'/protected',enabled_tools:['echo']},expectedVersion:state.version,approve:true},'user');await engine.refreshCapabilities();state=await manager.state();const login=await manager.manage({action:'oauth',name:'oauthmock',approve:true,expectedVersion:state.version},'user');assert.equal(new URL(login.authorizationUrl).origin,origin);await fetch(login.authorizationUrl);for(let i=0;i<30&&!tokenExchanges;i++)await new Promise(r=>setTimeout(r,100));assert.equal(tokenExchanges,1);checks.nativeMockOAuth=true;checks.protectedChallengeObserved=protectedCalls>0;await engine.refreshCapabilities();const authorizedCall=await engine.request('mcpServer/tool/call',{threadId:thread,server:'oauthmock',tool:'echo',arguments:{text:'authorized-synthetic-call'}});assert.notEqual(authorizedCall.isError,true);assert.match(authorizedCall.content[0].text,/authorized-synthetic-call/);checks.nativeOAuthActualCall=true;
 const skillInput={name:'meeting-actions',path:join(config.codexHome,'skills/meeting-actions/SKILL.md')};
 const skillTurn=await engine.turn('Use $meeting-actions on this synthetic input only.',{skills:[skillInput]});assert.equal(skillTurn.status,'completed');assert.ok(nativeTokenUsage(skillTurn.usage)?.total?.totalTokens);checks.nativeUsageCounters=true;assert.equal(mockPrompts.at(-1)?.skillBody,true);assert.equal(mockPrompts.at(-1)?.systemSkill,false);checks.nativeSkillBodyLoadedOnDemand=true;
 // Hold only a loopback fake Responses stream: real native delta, steer and
 // interrupt protocols are exercised without any model or account.
 pauseResponses=true;let streamed=false;const onDelta=()=>{streamed=true;};engine.on('textDelta',onDelta);
 const interruptedTurn=engine.turn('Synthetic streaming and interruption protocol probe.');
 try{for(let i=0;i<60&&!streamed;i++)await new Promise(r=>setTimeout(r,50));assert.equal(streamed,true);checks.nativeStreamingDeltaBeforeCompletion=true;
 const activeTurn=engine.turnId!;assert.equal((await engine.steer(activeTurn,'Synthetic additional instruction within this active turn.')).turnId,activeTurn);checks.nativeSteerReceived=true;
 await engine.interrupt();const terminal=await interruptedTurn;assert.equal(terminal.status,'interrupted');checks.nativeInterruptTerminalConfirmed=true;
 }finally{pauseResponses=false;engine.off('textDelta',onDelta);for(const response of heldResponses)response.destroy();heldResponses.clear();}
 state=await manager.state();await manager.manage({action:'skill_toggle',name:'meeting-actions',enabled:false,expectedVersion:state.version},'agent');await engine.refreshCapabilities();
 await manager.manage({action:'skill_save',name:'disabled-only',description:'Synthetic disabled selector check',body:'NEVER_LOAD_DISABLED_SYNTHETIC_BODY',expectedHash:null},'agent');state=await manager.state();await manager.manage({action:'skill_toggle',name:'disabled-only',enabled:false,expectedVersion:state.version},'agent');await engine.refreshCapabilities();
 await engine.turn('Synthetic input selecting a disabled Skill.',{skills:[{name:'disabled-only',path:join(config.codexHome,'skills/disabled-only/SKILL.md')}]});checks.nativeExplicitSkillBypassesDisable=mockPrompts.at(-1)?.disabledBody===true;assert.equal(checks.nativeExplicitSkillBypassesDisable,true);
checks.mockResponsesOnly=true;checks.mockProviderRequests=mockPrompts.length;
 const history=await engine.request('thread/read',{threadId:thread,includeTurns:true});const meta=(s:string)=>s.split('\n').filter(Boolean).map(l=>JSON.parse(l)).find(m=>m.type==='session_meta').payload;const before=meta(readFileSync(history.thread.path,'utf8'));assert.deepEqual(before.dynamic_tools.map((t:any)=>t.name),MAIN_TOOLS.map(t=>t.name));assert.ok(history.thread.path.startsWith(config.codexHome));
 await engine.close();
 // Only this new synthetic native database is seeded. Real logs and credentials
 // are never opened. The next native startup must prune its own old log row.
 const logDb=new DatabaseSync(join(config.codexHome,'logs_2.sqlite'));
 const insert=logDb.prepare('INSERT INTO logs (ts,ts_nanos,level,target,feedback_log_body,estimated_bytes) VALUES (?,0,?,?,?,64)');
 insert.run(Math.floor(Date.now()/1000)-11*86400,'INFO','homer_synthetic_retention_old','synthetic-old-log');
 insert.run(Math.floor(Date.now()/1000),'INFO','homer_synthetic_retention_recent','synthetic-recent-log');logDb.close();
 engine=make(thread);assert.equal(await engine.start(),thread);
 const logs=new DatabaseSync(join(config.codexHome,'logs_2.sqlite'),{readOnly:true});
 for(let i=0;i<40&&Number(logs.prepare("SELECT COUNT(*) AS n FROM logs WHERE target='homer_synthetic_retention_old'").get()!.n)>0;i++)await new Promise(r=>setTimeout(r,50));
 assert.equal(Number(logs.prepare("SELECT COUNT(*) AS n FROM logs WHERE target='homer_synthetic_retention_old'").get()!.n),0);
 assert.equal(Number(logs.prepare("SELECT COUNT(*) AS n FROM logs WHERE target='homer_synthetic_retention_recent'").get()!.n),1);logs.close();checks.nativeLogAgeRetention=true;
 // Native reload must reuse the native credential store after process restart.
 await engine.refreshCapabilities();
 const resumedAuth=await engine.request('mcpServerStatus/list',{threadId:thread,serverName:'oauthmock',detail:'full'});
 assert.equal(resumedAuth.data.find((s:any)=>s.name==='oauthmock')?.authStatus,'oAuth');
 const resumedCall=await engine.request('mcpServer/tool/call',{threadId:thread,server:'oauthmock',tool:'echo',arguments:{text:'resumed-oauth-call'}});assert.notEqual(resumedCall.isError,true);assert.match(resumedCall.content[0].text,/resumed-oauth-call/);assert.equal(tokenExchanges,1);checks.nativeOAuthCredentialRestart=true;
 const otherHome=join(dir,'separate-empty-codex');mkdirSync(otherHome);
 const other=new CodexEngine({...config,codexHome:otherHome,nativeCodexHome:otherHome},{cwd:config.workspace,readRoots:[],instructions:'Synthetic credential isolation. No thread.',tools:[],nativeCapabilities:true,controlOnly:true},async()=>{throw Error('no_tools');});
 try{await other.start();const isolated=new NativeCapabilities(otherHome,(m,p)=>other.request(m,p),()=>true);const initial=await isolated.state();await isolated.manage({action:'mcp_save',name:'oauthmock',server:{url:origin+'/protected',enabled_tools:['echo']},expectedVersion:initial.version,approve:true},'user');const catalog=await isolated.manage({action:'catalog',name:'oauthmock'},'user');assert.equal(catalog.data.find((s:any)=>s.name==='oauthmock')?.authStatus,'notLoggedIn');assert.equal(existsSync(join(otherHome,'.credentials.json')),false);checks.nativeOAuthSeparateHomeNotLoggedIn=true;}finally{await other.close();}
 state=await manager.state();await assert.rejects(()=>manager.manage({action:'oauth_logout',name:'oauthmock',expectedVersion:state.version,approve:true},'agent'),/capability_user_approval_required/);await manager.manage({action:'oauth_logout',name:'oauthmock',expectedVersion:state.version,approve:true},'user');await engine.close();engine=make(thread);assert.equal(await engine.start(),thread);const loggedOut=await engine.request('mcpServerStatus/list',{threadId:thread,serverName:'oauthmock',detail:'full'});assert.equal(loggedOut.data.find((s:any)=>s.name==='oauthmock')?.authStatus,'notLoggedIn');assert.equal(tokenExchanges,1);checks.nativeOAuthCliLogoutAndRestart=true;
 const resumed=await engine.request('thread/read',{threadId:thread,includeTurns:true});assert.match(readFileSync(resumed.thread.path,'utf8'),/synthetic native capability recovery marker/);assert.deepEqual(meta(readFileSync(resumed.thread.path,'utf8')).dynamic_tools,before.dynamic_tools);checks.syntheticThreadResumed=true;checks.originalFiveToolsHash=createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex');
 state=await manager.state();await manager.manage({action:'mcp_remove',name:'http',expectedVersion:state.version},'user');assert.ok(!(await manager.state()).servers.some((s:any)=>s.name==='http'));checks.nativeMcpRemove=true;
 await engine.close();engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[config.workspace],instructions:'Synthetic Worker boundary only.',tools:[],nativeCapabilities:false},async()=>{throw Error('worker_tools_never_called');});await engine.start();
 const workerCatalog=await engine.request('mcpServerStatus/list',{threadId:engine.threadId,detail:'full',limit:100});assert.ok(workerCatalog.data.every((s:any)=>Object.keys(s.tools??{}).length===0));
 await engine.turn('Synthetic Worker, no inherited Skills or MCP.');assert.equal(mockPrompts.at(-1)?.skillDescription,false);assert.equal(mockPrompts.at(-1)?.disabledBody,false);checks.workerInheritedMcpAndSkillsDisabled=true;checks.mockProviderRequests=mockPrompts.length;
 const paths:Record<string,unknown>={};
 const scan=(folder:string,prefix='')=>{for(const entry of readdirSync(folder)){const relative=prefix+entry,full=join(folder,entry),stat=lstatSync(full);paths[relative]={kind:stat.isSymbolicLink()?'symlink':stat.isDirectory()?'directory':'file',bytes:stat.size};if(stat.isDirectory()&&!stat.isSymbolicLink())scan(full,relative+'/');}};scan(config.codexHome);
 assert.ok(Object.keys(paths).some(p=>p.startsWith('sessions/')&&p.endsWith('.jsonl')));assert.ok(paths['state_5.sqlite']);assert.ok(paths['logs_2.sqlite']);assert.equal(paths['.credentials.json'],undefined);assert.ok(paths['host-home']);assert.ok(paths['tmp']);
 const effective=await engine.request('config/read',{includeLayers:true});assert.equal(effective.config.sqlite_home,config.codexHome);assert.equal(effective.config.log_dir,join(config.codexHome,'log'));assert.equal(effective.config.mcp_oauth_credentials_store,'file');checks.nativePathsVerified=true;
 writeFileSync(join(root,'native-persistence-paths.json'),JSON.stringify({scope:'new synthetic HOME only; filenames and sizes, no file bodies',home:config.codexHome,effective:{sqlite_home:effective.config.sqlite_home,log_dir:effective.config.log_dir,mcp_oauth_credentials_store:effective.config.mcp_oauth_credentials_store},entries:paths},null,2));
 checks.dataEntries=readdirSync(config.codexHome).filter(p=>!p.includes('auth')).sort();checks.nativeHome=dir;writeFileSync(join(root,'native-acceptance-checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}catch(error){console.error(error instanceof Error?error.message:'native_acceptance_failed');process.exitCode=1;writeFileSync(join(root,'native-acceptance-partial.json'),JSON.stringify(checks,null,2));}
finally{for(const response of heldResponses)response.destroy();await engine?.close();await new Promise<void>(r=>http.close(()=>r()));}
