import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine,type EngineOptions} from '../src/engine.js';
function fixture(){
 const root=resolve('.codex/scratch/native-mcp-config-implementation/project-engine');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'case-')),home=join(dir,'home');mkdirSync(home);
 const config={workspace:join(dir,'work'),runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/project-mcp-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:500};
 const user={shared:{command:'user-program',args:['user'],enabled_tools:['user']}};
 const effective={shared:{command:'user-program',args:['project'],enabled_tools:['project'],enabled:false},project:{command:'project-program',enabled_tools:['read']}};
 const layers=[{name:{type:'user',file:join(home,'config.toml')},version:'user-version',config:{mcp_servers:user}},{name:{type:'project',dotCodexFolder:join(dir,'work/.codex')},config:{mcp_servers:{shared:{args:['project'],enabled_tools:['project'],enabled:false},project:effective.project}}}];
 return {dir,home,config,user,effective,layers,engine(id:string,options:Partial<EngineOptions>={},changed:any={}){const cwd=join(dir,id);mkdirSync(cwd,{recursive:true});writeFileSync(join(cwd,'fixture-state.json'),JSON.stringify({config:{config:{mcp_servers:effective},layers},...changed}));return new CodexEngine(config,{cwd,readRoots:[],instructions:'Synthetic protocol only.',tools:[],...options},async()=>{throw Error('no_model_tools');});},close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('dedicated native execution leaves project/user precedence and disabled/tool scope to Codex on start and resume',async()=>{
 const f=fixture();try{for(const [id,options]of [['main',{nativeTools:'main'}],['worker',{nativeTools:'worker'}],['other-project',{threadId:'synthetic-resume'}]] as const){const e=f.engine(id,options);try{await e.start();const r=await e.request('fixture/inspect',{});const start=r.calls.find((c:any)=>['thread/start','thread/resume'].includes(c.method));assert.equal(start.params.cwd,'threadId' in options?join(f.dir,id):undefined,'fresh native threads must not trigger implicit trust via explicit cwd');assert.deepEqual(start.params.runtimeWorkspaceRoots,[join(f.dir,id)]);assert.equal(r.calls.find((c:any)=>c.method==='config/read').params.cwd,join(f.dir,id));assert.equal(r.processCwd,join(f.dir,id));assert.deepEqual(start.params.config.mcp_servers,{},'session must not reapply user MCP over native project precedence');assert.ok(!r.argv.some((a:string)=>/mcp_servers\.(project|shared)\.enabled=false/.test(a)));assert.equal(r.home,join(f.home,'host-home'));}finally{await e.close();}}}finally{f.close();}
});
test('active project/user declarations cannot impersonate the internal server even when CLI identity matches',async()=>{
 const f=fixture(),catalog=[{type:'function' as const,name:'internal',description:'synthetic',inputSchema:{}}],internal={command:'/usr/bin/true',args:['synthetic'],cwd:f.dir};
 try{for(const type of ['project','user']){f.effective['homer_interactions' as keyof typeof f.effective]=internal as any;f.layers.push({name:{type} as any,config:{mcp_servers:{homer_interactions:{env:{INJECT:'synthetic'}}}}} as any);const e=f.engine(type,{interactionMcp:{...internal,catalog}},{catalog:['internal']});try{await assert.rejects(()=>e.start(),/engine_interaction_mcp_boundary_mismatch/);}finally{await e.close();f.layers.pop();}}}finally{f.close();}
});
test('disabled project layers do not acquire trust; legitimate internal identity and exact catalog still apply',async()=>{
 const f=fixture(),catalog=[{type:'function' as const,name:'internal',description:'synthetic',inputSchema:{}}],internal={command:'/usr/bin/true',args:[],cwd:f.dir};
 try{f.effective['homer_interactions' as keyof typeof f.effective]=internal as any;f.layers.push({name:{type:'project'} as any,disabledReason:'untrusted native layer',config:{mcp_servers:{homer_interactions:{command:'untrusted'}}}} as any);
 for(const rogue of [false,true]){const e=f.engine(rogue?'rogue':'untrusted',{interactionMcp:{...internal,catalog}},{catalog:rogue?['internal','rogue']:['internal']});try{if(rogue)await assert.rejects(()=>e.start(),/engine_interaction_tools_unavailable/);else{await e.start();const r=await e.request('fixture/inspect',{});assert.ok(!r.calls.some((c:any)=>c.method==='config/batchWrite'),'engine never grants trust');}}finally{await e.close();}}}finally{f.close();}
});
test('a reserved server without a host-issued internal endpoint is refused before a thread',async()=>{
 const f=fixture();try{f.effective['homer_interactions' as keyof typeof f.effective]={command:'spoof'} as any;f.layers.push({name:{type:'project'} as any,config:{mcp_servers:{homer_interactions:{command:'spoof'}}}} as any);const e=f.engine('reserved');try{await assert.rejects(()=>e.start(),/engine_interaction_mcp_boundary_mismatch/);}finally{await e.close();}}finally{f.close();}
});
test('a project switch or later config refresh cannot admit a newly declared internal impersonator',async()=>{
 const f=fixture(),e=f.engine('safe');try{await e.start();const bad=join(f.dir,'bad');mkdirSync(bad);const layers=[...f.layers,{name:{type:'project'},config:{mcp_servers:{homer_interactions:{command:'spoof'}}}}];const state=JSON.stringify({config:{config:{mcp_servers:{...f.effective,homer_interactions:{command:'spoof'}}},layers}});writeFileSync(join(bad,'fixture-state.json'),state);
 await assert.rejects(()=>e.turn('must not reach turn/start',{cwd:bad}),/engine_interaction_mcp_boundary_mismatch/);
 writeFileSync(join(f.dir,'safe/fixture-state.json'),state); // Later file change at the still-active CWD.
 await assert.rejects(()=>e.refreshCapabilities(),/engine_interaction_mcp_boundary_mismatch/);
 const r=await e.request('fixture/inspect',{});assert.ok(!r.calls.some((c:any)=>c.method==='turn/start'||c.method==='config/mcpServer/reload'));assert.equal(r.calls.filter((c:any)=>c.method==='config/read').at(-1).params.cwd,join(f.dir,'safe'));
 }finally{await e.close();f.close();}
});
test('each synthetic turn checks the requested CWD without injecting an MCP configuration snapshot',async()=>{
 const f=fixture(),e=f.engine('first',{threadId:'synthetic-resume'});f.engine('second');try{await e.start();for(const id of ['first','second','first']){await e.turn('Protocol fixture only.',{cwd:join(f.dir,id)});const r=await e.request('fixture/inspect',{}),turnIndex=r.calls.findLastIndex((c:any)=>c.method==='turn/start');assert.equal(r.calls[turnIndex-1].method,'config/read');assert.equal(r.calls[turnIndex-1].params.cwd,join(f.dir,id));assert.equal(r.calls[turnIndex].params.cwd,join(f.dir,id));assert.equal(r.calls[turnIndex].params.config,undefined);assert.equal(r.calls.find((c:any)=>c.method==='thread/resume').params.cwd,join(f.dir,id),'project CWD switch must cold-resume the native configuration before a turn');}}finally{await e.close();f.close();}
});
test('an empty native thread fails a CWD switch clearly instead of using old project MCP',async()=>{
 const f=fixture(),e=f.engine('first');f.engine('second');try{await e.start();await assert.rejects(()=>e.turn('must not start',{cwd:join(f.dir,'second')}),/engine_project_switch_requires_history/);const r=await e.request('fixture/inspect',{});assert.ok(!r.calls.some((c:any)=>c.method==='turn/start'));}finally{await e.close();f.close();}
});
test('project preparation excludes another turn and configuration refresh until resume finishes',async()=>{
 const f=fixture(),e=f.engine('first',{threadId:'synthetic-resume'});f.engine('second');try{await e.start();const request=e.request.bind(e);let release!:()=>void;const pending=new Promise<void>(r=>release=r);e.request=async(method,params:any)=>{if(method==='config/read'&&params.cwd===join(f.dir,'second'))await pending;return request(method,params);};const first=e.turn('fixture only',{cwd:join(f.dir,'second')});await assert.rejects(()=>e.turn('must wait'),/engine_turn_busy/);await assert.rejects(()=>e.refreshCapabilities(),/capability_engine_busy/);release();assert.equal((await first).status,'completed');}finally{await e.close();f.close();}
});
