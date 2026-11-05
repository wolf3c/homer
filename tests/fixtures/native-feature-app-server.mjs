#!/usr/bin/env node
import{createInterface}from'node:readline';import{existsSync,readFileSync}from'node:fs';import{join}from'node:path';
const settingsFile=join(process.env.CODEX_HOME,'synthetic-skills.json');const skillConfig=existsSync(settingsFile)?JSON.parse(readFileSync(settingsFile,'utf8')):undefined;
const memoriesFile=join(process.env.CODEX_HOME,'synthetic-memories.json');const memoriesConfig=existsSync(memoriesFile)?JSON.parse(readFileSync(memoriesFile,'utf8')):{};
let threadParams,threadMethod,installed=false;const memoryModeSets=[];const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
const setting=name=>{const arg=process.argv.find(value=>value.startsWith(name+'='));return arg?JSON.parse(arg.slice(name.length+1)):undefined;};
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.163.0',codexHome:process.env.CODEX_HOME};
 if(m.method==='config/read')result={config:{features:{},mcp_servers:{}},layers:[{name:{type:'user',file:join(process.env.CODEX_HOME,'config.toml')},version:'synthetic-v1',config:{mcp_servers:{'Office.Native':{command:'/usr/bin/true',env:{SYNTHETIC_SETTING:'local-fixture'},enabled:true}}}}]};
 if(m.method==='config/read'&&setting('model_catalog_json'))Object.assign(result.config,Object.fromEntries(['model','model_catalog_json','model_context_window','model_auto_compact_token_limit','model_auto_compact_token_limit_scope','web_search'].map(key=>[key,setting(key)])));
 if(m.method==='model/list'&&setting('model_catalog_json'))result={data:[{id:setting('model'),model:setting('model'),defaultReasoningEffort:'high',supportedReasoningEfforts:['low','high','max'].map(reasoningEffort=>({reasoningEffort}))}],nextCursor:null};
 if(m.method==='config/read'&&skillConfig!==undefined)result.config.skills={config:skillConfig};
 if(m.method==='config/read'&&process.argv.includes('features.memories=true')){result.config.features.memories=true;result.config.memories={generate_memories:setting('memories.generate_memories')??null,use_memories:null,dedicated_tools:true,extract_model:setting('memories.extract_model'),consolidation_model:setting('memories.consolidation_model'),...memoriesConfig};}
 if(m.method==='skills/list')result={data:[{skills:[{name:'合成内置方法',path:join(process.env.CODEX_HOME,'skills/.system/native/SKILL.md')},{name:'合成插件方法',path:join(process.env.CODEX_HOME,'plugins/native/skills/example/SKILL.md')},{path:'/synthetic/outside/skills/untrusted/SKILL.md'}]}]};
 if(m.method==='environment/info')result={shell:{}};
 if(m.method==='thread/backgroundTerminals/list')result={data:[]};
 if(m.method==='thread/start'||m.method==='thread/resume'){threadMethod=m.method;threadParams=m.params;result={thread:{id:m.params.threadId??'synthetic-native-feature-thread'},activePermissionProfile:{id:'homer'},approvalPolicy:m.params.approvalPolicy};}
 if(m.method==='thread/memoryMode/set')memoryModeSets.push(m.params);

 if(m.method==='account/read')result={account:{type:'chatgpt',email:'SYNTHETIC_NOT_A_REAL_ACCOUNT',planType:'plus'},requiresOpenaiAuth:true};
 if(m.method==='experimentalFeature/list')result={data:[{name:'browser_use',enabled:true,defaultEnabled:true,stage:'stable'}],nextCursor:null};
 if(m.method==='modelProvider/capabilities/read')result={webSearch:true,imageGeneration:true};
 const plugin={id:'office-sample@synthetic',name:'office-sample',interface:{displayName:'合成办公 Skill'},installed,enabled:installed,availability:'AVAILABLE',installPolicy:'AVAILABLE',source:{type:'local',path:process.env.CODEX_HOME+'/plugins/sample'}};
 if(m.method==='plugin/list')result={marketplaces:[{name:'synthetic-local',path:process.env.CODEX_HOME+'/plugins/marketplace.json',plugins:[plugin]}],marketplaceLoadErrors:[]};
 if(m.method==='plugin/search')result={data:[{plugin,marketplaceName:'synthetic-local',marketplacePath:process.env.CODEX_HOME+'/plugins/marketplace.json'}],nextCursor:null};
 if(m.method==='app/list')result={data:[{id:'synthetic-app',name:'合成连接',isAccessible:false,isEnabled:true,installUrl:null}],nextCursor:null};
 if(m.method==='plugin/read')result={plugin:{summary:plugin,description:'仅合成 UI 验收，无真实插件或依赖安装。',skills:[{name:'合成文档工作方法'}],hooks:[],apps:[],mcpServers:[]}};
 if(m.method==='plugin/install'){installed=true;result={authPolicy:'ON_USE',appsNeedingAuth:[]};}
 if(m.method==='plugin/uninstall'){installed=false;result={};}
 if(m.method==='synthetic/inspect')result={argv:process.argv.slice(2),threadParams,threadMethod,memoryModeSets};
 send({id:m.id,result});});
