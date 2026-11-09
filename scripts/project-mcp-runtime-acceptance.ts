// Explicitly authorized isolated native threads. No turn or model request.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {CodexEngine} from '../src/engine.js';
const binary=process.argv[2];assert.ok(binary,'fixed_codex_binary_required');
const root=resolve('.codex/scratch/native-mcp-config-implementation');mkdirSync(root,{recursive:true});
const dir=mkdtempSync(join(root,'project-runtime-')),home=join(dir,'home');mkdirSync(home,{mode:0o700});
const receipt:any={fixedVersion:'0.163.0',isolatedHome:true,noAccounts:true,noTurnOrModel:true,checks:[],rpcCounts:{},mcpCounts:{},nonMcpRequests:0,otherRequestKinds:{},cleanup:[]};
let stage='fixture',failure:unknown;const engines:CodexEngine[]=[];const deleted=new Set<string>();
const listener=createServer(async(req,res)=>{
 const route=req.url??'';
 if(!/^\/mcp\/[a-z_-]+$/.test(route)){receipt.nonMcpRequests++;const path=new URL(route,'http://127.0.0.1').pathname;const kind=/\/responses$|\/chat\/completions$|\/completions$/.test(path)?'model-invocation':/\/models$/.test(path)?'model-metadata':path.includes('/.well-known/')?'mcp-auth-discovery':/^[a-z]+:\/\//.test(route)?'rejected-proxy-request':'other-loopback';receipt.otherRequestKinds[kind]=(receipt.otherRequestKinds[kind]??0)+1;res.writeHead(403);res.end();return;}
 if(req.method==='GET'){res.writeHead(405);res.end();return;}
 if(req.method==='DELETE'){res.writeHead(200);res.end();return;}
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}
 let body='';for await(const chunk of req)body+=chunk;
 const message=JSON.parse(body);const key=route.slice(5)+':'+message.method;receipt.mcpCounts[key]=(receipt.mcpCounts[key]??0)+1;
 if(message.id===undefined){res.writeHead(202);res.end();return;}
 let result:any={};
 if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'loopback-fixture',version:'1'}};
 if(message.method==='tools/list')result={tools:['echo','other'].map(name=>({name,description:'Synthetic local check.',inputSchema:{type:'object',properties:{text:{type:'string'}}},annotations:{readOnlyHint:true}}))};
 if(message.method==='tools/call')result={content:[{type:'text',text:route.slice(5)+':'+message.params.name}],isError:false};
 if(message.method==='resources/list')result={resources:[]};
 if(message.method==='resources/templates/list')result={resourceTemplates:[]};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
});
listener.on('connect',(_req,socket)=>{receipt.otherRequestKinds['rejected-proxy-tunnel']=(receipt.otherRequestKinds['rejected-proxy-tunnel']??0)+1;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+(listener.address() as any).port;
// Route any inherited proxy traffic to this rejecting fixture too. No real proxy.
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])process.env[key]=origin;
process.env.NO_PROXY=process.env.no_proxy='127.0.0.1,localhost';
const toml=(v:any):string=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+toml(x)).join(',')+'}':JSON.stringify(v);
const server=(route:string,more:any={})=>({url:origin+'/mcp/'+route,default_tools_approval_mode:'approve',enabled_tools:['echo','other'],...more});
const projects:Record<string,string>={},files:Record<string,string>={};
for(const id of ['a','b','untrusted','unknown','spoof']){const cwd=join(dir,id);projects[id]=cwd;mkdirSync(join(cwd,'.codex'),{recursive:true});writeFileSync(join(cwd,'.fixture-project-root'),'');const mcp=id==='spoof'?{homer_interactions:server('spoof')}:{['only_'+id]:server(id),shared:server('shared_'+id,{enabled_tools:['echo']}),project_disabled:server('project_disabled',{enabled:false})};const file=join(cwd,'.codex/config.toml');files[file]='mcp_servers='+toml(mcp)+'\n';writeFileSync(file,files[file]!);}
const user={project_root_markers:['.fixture-project-root'],projects:Object.fromEntries(['a','b','untrusted','spoof'].map(id=>[projects[id],{trust_level:id==='untrusted'?'untrusted':'trusted'}])),mcp_servers:{shared:server('user'),user_disabled:server('user_disabled',{enabled:false})},analytics:{enabled:false},feedback:{enabled:false},check_for_update_on_startup:false};
const userFile=join(home,'config.toml'),before=Object.entries(user).map(([k,v])=>k+'='+toml(v)).join('\n')+'\n';writeFileSync(userFile,before,{mode:0o600});
const config={appData:dir,codexHome:home,nativeCodexHome:home,codexBin:resolve(binary),workspace:projects.a!,runtime:join(dir,'runtime'),baseUrl:origin+'/v1',model:'gpt-6.1-sol',requiresOpenaiAuth:false,stopGraceMs:1000};
const engine=(id:string,threadId?:string)=>{
 const e=new CodexEngine(config,{cwd:projects[id]!,readRoots:[],instructions:'Isolated local MCP protocol test. No model turns.',tools:[],nativeTools:'main',...(threadId?{threadId}:{})},async()=>{throw Error('no_model_tools');});
 const request=e.request.bind(e);e.request=async(method,params:any)=>{if(method.startsWith('turn/')){receipt.blockedTurnAttempts=(receipt.blockedTurnAttempts??0)+1;throw Error('turn_forbidden');}receipt.rpcCounts[method]=(receipt.rpcCounts[method]??0)+1;const response=await request(method,params);if(['thread/start','thread/resume'].includes(method)){assert.equal(response.thread.cwd,params.cwd??projects[id]);receipt.checks.push(method+' final CWD '+(Object.keys(projects).find(k=>projects[k]===(params.cwd??projects[id]))??'fixture'));}return response;};engines.push(e);return e;
};
const call=(e:CodexEngine,server:string,tool='echo')=>e.request('mcpServer/tool/call',{threadId:e.threadId,server,tool,arguments:{text:'synthetic-local'}});
const denied=async(e:CodexEngine,server:string,tool='echo')=>{let blocked=false;try{blocked=(await call(e,server,tool)).isError===true;}catch{blocked=true;}assert.ok(blocked,'tool_must_be_denied');};
const tagged=async(e:CodexEngine,server:string,tag:string)=>{const r=await call(e,server);assert.notEqual(r.isError,true);assert.equal(r.content[0].text,tag+':echo');};
const removeThread=async(e:CodexEngine)=>{if(!e.threadId||deleted.has(e.threadId))return;try{await e.request('thread/delete',{threadId:e.threadId});deleted.add(e.threadId);receipt.cleanup.push({thread:'synthetic',method:'thread/delete',succeeded:true});}catch{try{await e.request('thread/unsubscribe',{threadId:e.threadId});receipt.cleanup.push({thread:'synthetic',method:'thread/unsubscribe',succeeded:true});}catch{receipt.cleanup.push({thread:'synthetic',method:'supported-close-unavailable',succeeded:false});}}};
try{
 stage='trusted-a';const a=engine('a');await a.start();assert.equal(a.version,'0.163.0');
 let inventory=await a.request('mcpServerStatus/list',{threadId:a.threadId,detail:'full',limit:100});assert.ok(inventory.data.find((s:any)=>s.name==='only_a')?.tools.echo);
 await tagged(a,'only_a','a');await tagged(a,'shared','shared_a');await denied(a,'shared','other');await denied(a,'user_disabled');await denied(a,'project_disabled');receipt.checks.push('trusted project actual connection/call; native project precedence, tool scope and disabled enforced');
 stage='same-thread-cwd';await a.request('thread/settings/update',{threadId:a.threadId,cwd:projects.b});
 inventory=await a.request('mcpServerStatus/list',{threadId:a.threadId,detail:'full',limit:100});
 receipt.sameThreadSettingsUpdateHasB=!!inventory.data.find((s:any)=>s.name==='only_b');
 // Reload is the native API for materializing MCP configuration changes.
 await a.request('config/mcpServer/reload',{});
 inventory=await a.request('mcpServerStatus/list',{threadId:a.threadId,detail:'full',limit:100});
 receipt.sameThreadReloadHasB=!!inventory.data.find((s:any)=>s.name==='only_b');
 if(receipt.sameThreadReloadHasB){await tagged(a,'only_b','b');await tagged(a,'shared','shared_b');}
 receipt.checks.push('same-thread CWD update/reload observed without model');
 stage='resume';await a.request('thread/inject_items',{threadId:a.threadId,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic no-model recovery marker.'}]}]});
 assert.ok(await a.close());const b=engine('b',a.threadId);await b.start();await tagged(b,'only_b','b');await tagged(b,'shared','shared_b');await denied(b,'only_a');receipt.checks.push('native resume at actual B CWD loads B project without user reapplication');
 stage='product-cwd-switch';for(const id of ['a','unknown','b']){await assert.rejects(()=>b.turn('Blocked before native turn.',{cwd:projects[id]}),/turn_forbidden/);if(id==='unknown'){await tagged(b,'shared','user');await denied(b,'only_unknown');await denied(b,'only_b');}else{await tagged(b,'only_'+id,id);await tagged(b,'shared','shared_'+id);}assert.equal(readFileSync(userFile,'utf8'),before);}
 receipt.checks.push('product turn preparation cold-resumes A/unknown/B and loads actual CWD MCP before transport-blocked turn; no implicit trust');await removeThread(b);assert.ok(await b.close());
 for(const id of ['untrusted','unknown','a']){stage=id;const e=engine(id);await e.start();if(id==='a'){await tagged(e,'only_a','a');await tagged(e,'shared','shared_a');}else{await tagged(e,'shared','user');await denied(e,'only_'+id);const effective=await e.request('config/read',{cwd:projects[id],includeLayers:true});assert.ok(effective.layers.find((l:any)=>l.name.type==='project')?.disabledReason);}
 assert.equal(readFileSync(userFile,'utf8'),before,'native_start_must_not_persist_project_trust');await removeThread(e);assert.ok(await e.close());receipt.checks.push('native '+id+' CWD, config/trust unchanged and correct MCP runtime');}
 stage='reserved-name';const spoof=engine('spoof');await assert.rejects(()=>spoof.start(),/engine_interaction_mcp_boundary_mismatch/);assert.equal(spoof.threadId,undefined);assert.ok(await spoof.close());receipt.checks.push('project reserved-name rejected before native thread or MCP connection');
 for(const route of ['unknown','untrusted','spoof','user_disabled','project_disabled'])assert.ok(!Object.keys(receipt.mcpCounts).some(k=>k.startsWith(route+':')),'inactive_server_must_not_connect');
 for(const [file,content]of Object.entries(files))assert.equal(readFileSync(file,'utf8'),content);assert.equal(readFileSync(userFile,'utf8'),before);assert.equal(receipt.otherRequestKinds['model-invocation']??0,0);assert.ok(!Object.keys(receipt.rpcCounts).some(k=>k.startsWith('turn/')));receipt.userAndProjectFilesUnchanged=true;receipt.passed=true;
}catch(error){failure=error;receipt.passed=false;receipt.failedStage=stage;receipt.failureCode=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'runtime_assertion_failed';}
finally{
 let exited=true;for(const e of engines){if(!receipt.passed)await removeThread(e);if(!await e.close())exited=false;}receipt.allNativeProcessesExited=exited;
 await new Promise<void>(r=>listener.close(()=>r()));receipt.loopbackClosed=true;
 if(exited){rmSync(dir,{recursive:true,force:true});receipt.temporaryHomeRemoved=!existsSync(dir);receipt.databaseCleanup='only remove newly created fixture HOME after confirmed process exit; no direct database writes';}
 if(!exited||!receipt.temporaryHomeRemoved){receipt.passed=false;receipt.failedStage='cleanup';failure??=new Error('fixture_cleanup_failed');}
 receipt.nativeTurnsForwarded=Object.keys(receipt.rpcCounts).filter(k=>k.startsWith('turn/')).reduce((n,k)=>n+receipt.rpcCounts[k],0);
 receipt.modelInvocationsObserved=receipt.otherRequestKinds['model-invocation']??0;
 writeFileSync(join(root,'project-mcp-runtime-acceptance-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
}
console.log(JSON.stringify(receipt,null,2));if(failure)throw new Error('project_runtime_acceptance_failed:'+stage);
