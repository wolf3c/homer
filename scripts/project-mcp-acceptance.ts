// Fixed 0.163.0 project-layer acceptance. Default mode has no native thread,
// accounts, model turns or external MCP. Trust is prewritten fixture data only.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
const binary=process.argv[2];assert.ok(binary,'fixed_codex_binary_required');
const root=resolve('.codex/scratch/native-mcp-config-implementation');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'project-acceptance-')),home=join(dir,'home');mkdirSync(join(home,'homer-control'),{recursive:true});
const toml=(v:any):string=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+toml(x)).join(',')+'}':JSON.stringify(v);
const projects:Record<string,string>={};const projectFiles:Record<string,string>={};
for(const id of ['a','b','untrusted','unknown']){const cwd=join(dir,id);projects[id]=cwd;mkdirSync(join(cwd,'.codex'),{recursive:true});writeFileSync(join(cwd,'.fixture-project-root'),'');const file=join(cwd,'.codex/config.toml'),content='mcp_servers='+toml({['only_'+id]:{command:'synthetic-do-not-run',enabled_tools:['read']},shared:{args:[id],enabled_tools:[id],enabled:false},project_disabled:{command:'synthetic-do-not-run',enabled:false}})+'\n';writeFileSync(file,content);projectFiles[file]=content;}
const user={project_root_markers:['.fixture-project-root'],projects:{[projects.a!]:{trust_level:'trusted'},[projects.b!]:{trust_level:'trusted'},[projects.untrusted!]:{trust_level:'untrusted'}},mcp_servers:{shared:{command:'synthetic-do-not-run',args:['user'],enabled_tools:['user']},user_disabled:{command:'synthetic-do-not-run',enabled:false}},analytics:{enabled:false},feedback:{enabled:false}};
const file=join(home,'config.toml'),before=Object.entries(user).map(([k,v])=>k+'='+toml(v)).join('\n')+'\n';writeFileSync(file,before);
const config={appData:dir,codexHome:home,nativeCodexHome:home,codexBin:resolve(binary),workspace:projects.a!,runtime:join(dir,'runtime'),model:'synthetic-no-model',requiresOpenaiAuth:false,stopGraceMs:1000};
const receipt:any={fixedVersion:'0.163.0',isolatedHome:true,noAccounts:true,noThreadOrModel:true,noExternalMcp:true,checks:[]};
const engine=(cwd:string,internal=false)=>new CodexEngine(config,{cwd,readRoots:[],instructions:'Project config protocol only.',tools:[],controlOnly:true,...(internal?{interactionMcp:{command:'/usr/bin/true',args:[],cwd:dir,catalog:[]}}:{})},async()=>{throw Error('no_model_tools');});
try{
 for(const id of ['a','b','untrusted','unknown','a']){const e=engine(projects[id]!);try{await e.start();assert.equal(e.version,'0.163.0');assert.equal(e.threadId,undefined);const r=await e.request('config/read',{cwd:projects[id],includeLayers:true}),s=r.config.mcp_servers,trust=['a','b'].includes(id);assert.equal(!!s['only_'+id],trust);assert.equal(s.shared.args[0],trust?id:'user');assert.deepEqual(s.shared.enabled_tools,[trust?id:'user']);assert.equal(s.shared.enabled,trust?false:true);assert.equal(s.user_disabled.enabled,false);if(trust)assert.equal(s.project_disabled.enabled,false);const layer=r.layers.find((l:any)=>l.name.type==='project');assert.equal(!!layer?.disabledReason,!trust);receipt.checks.push('native engine CWD '+id+': trust, same-name precedence, disabled and scope preserved');}finally{await e.close();}}
 // A file-backed declaration must not merge options into the host endpoint,
 // even though the session override supplies matching command/args/cwd.
 const aFile=join(projects.a!,'.codex/config.toml');writeFileSync(aFile,projectFiles[aFile]!.trimEnd().slice(0,-1)+',"homer_interactions"='+toml({command:'/usr/bin/true',args:[],cwd:dir,env:{SYNTHETIC_INJECT:'blocked'}})+'}\n');let e=engine(projects.a!,true);try{await assert.rejects(()=>e.start(),/engine_interaction_mcp_boundary_mismatch/);}finally{await e.close();writeFileSync(aFile,projectFiles[aFile]!);}
 e=engine(projects.a!,true);try{await e.start();assert.equal(e.threadId,undefined);}finally{await e.close();}receipt.checks.push('active project reserved-name injection refused; legitimate host endpoint accepted before thread creation');
 for(const [path,content]of Object.entries(projectFiles))assert.equal(readFileSync(path,'utf8'),content);assert.equal(readFileSync(file,'utf8'),before);receipt.projectAndUserFilesUnchanged=true;receipt.passed=true;
}finally{rmSync(dir,{recursive:true,force:true});}
writeFileSync(join(root,'project-mcp-acceptance-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
