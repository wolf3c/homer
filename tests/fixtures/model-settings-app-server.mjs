#!/usr/bin/env node
// Protocol fixture only. No network, account access, native threads or model calls.
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
if(process.argv.includes('--version')){console.log('codex-cli 0.171.0-alpha.7');process.exit(0);}
let threadMethod,threadParams,threadStarts=0,settingsUpdates=0,threadSettings={model:"old-model",effort:"xhigh",serviceTier:"priority"};
const args=process.argv.slice(2),model=JSON.parse(args.find(arg=>arg.startsWith('model='))?.slice(6)??'null');
const setting=name=>{const value=args.find(arg=>arg.startsWith(name+'='));return value?JSON.parse(value.slice(name.length+1).replace(/("(?:[^"\\]|\\.)*")=/g,'$1:')):undefined;};
const modelProvider=setting('model_provider')??'openai';
const database=new DatabaseSync(join(process.env.CODEX_HOME,'state_5.sqlite'));
database.exec('CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,model_provider TEXT,memory_mode TEXT)');
const saved=id=>database.prepare('SELECT * FROM threads WHERE id=?').get(id);
let threadId='synthetic-model-thread',turnId;
const consolidationModel=setting('memories.consolidation_model'),extractionModel=setting('memories.extract_model'),generateMemories=setting('memories.generate_memories');
const trustedArg=args.find(arg=>arg.startsWith('mcp_servers.homer_interactions='));
const trusted=trustedArg?JSON.parse(trustedArg.slice(trustedArg.indexOf('=')+1).replace(/("(?:[^"\\]|\\.)*")=/g,'$1:')):undefined;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;let result={};
  if(m.method==='initialize')result={userAgent:'codex/0.171.0-alpha.7',codexHome:process.env.CODEX_HOME};
  if(m.method==='config/read')result={config:{model_provider:setting('model_provider'),model_providers:{homer:model==='synthetic-ws-ignored'?{...setting('model_providers.homer'),supports_websockets:false}:setting('model_providers.homer')},...Object.fromEntries(['model','model_catalog_json','model_context_window','model_auto_compact_token_limit','model_auto_compact_token_limit_scope','web_search'].map(name=>[name,setting(name)])),features:{memories:true},memories:{dedicated_tools:true,generate_memories:generateMemories,extract_model:extractionModel,consolidation_model:consolidationModel},mcp_servers:trusted?{homer_interactions:trusted}:{}},layers:[{name:{type:'user',file:join(process.env.CODEX_HOME,'config.toml')},version:'synthetic-config',config:{}}]};
  if(m.method==='mcpServerStatus/list')result={data:trusted?[{name:'homer_interactions',tools:Object.fromEntries(trusted.enabled_tools.map(name=>[name,{}]))}]:[]};
  if(m.method==='environment/info')result={shell:'/bin/zsh'};
  if(m.method==='model/list'){const page={data:[{id:model,model,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','high','max'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:model==='synthetic-standard-only'?[]:[{id:'priority',name:'Fast',description:'Synthetic catalog'},...(model==='synthetic-ultrafast'?[{id:'ultrafast',name:'Ultrafast',description:'Synthetic catalog'}]:[])]}],nextCursor:null};page.data[0].inputModalities=['text','image'];if(model==='synthetic-page-standard')page.data[0].serviceTiers=[];result=['synthetic-page-two','synthetic-page-standard'].includes(model)&&!m.params.cursor?{data:[{id:'first',model:'first',inputModalities:['text'],serviceTiers:[]}],nextCursor:'second'}:page;}
  if(model?.startsWith('synthetic-hot')){
    if(m.method==='account/read')result={account:{type:'chatgpt',planType:'promax'}};
    if(m.method==='configRequirements/read')result={requirements:null};
    if(m.method==='model/list')result={data:['synthetic-hot-text','synthetic-hot-image','gpt-6.1-terra'].map(name=>({id:name,model:name,displayName:name,hidden:false,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','medium','high','xhigh'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:[{id:'priority',name:'Fast'},{id:'ultrafast',name:'Ultrafast'}],inputModalities:name==='synthetic-hot-text'?['text']:['text','image']})),nextCursor:null};
  }
  if(m.method==='thread/read')result={thread:{id:m.params.threadId,modelProvider:saved(m.params.threadId)?.model_provider??modelProvider,...(m.params.includeTurns?{turns:[]}: {})}};
  if(['thread/start','thread/resume','thread/fork'].includes(m.method)){
    threadMethod=m.method;threadParams=m.params;threadStarts++;
    threadId=m.method==='thread/resume'?m.params.threadId:m.method==='thread/fork'||saved('synthetic-model-thread')?'synthetic-model-thread-'+randomUUID():'synthetic-model-thread';
    const existing=saved(threadId),provider=existing?.model_provider??modelProvider;
    if(m.method==='thread/resume'&&provider!==modelProvider){send({id:m.id,error:{code:-32600,message:'Cannot change provider on resume'}});return;}
    if(!existing)database.prepare('INSERT INTO threads VALUES(?,?,?)').run(threadId,provider,generateMemories===true?'enabled':'disabled');
    result={thread:{id:threadId,modelProvider:provider,forkedFromId:m.method==='thread/fork'?m.params.threadId:null},modelProvider:provider,activePermissionProfile:{id:'homer'},approvalPolicy:m.params.approvalPolicy};
  }
  if(m.method==='thread/memoryMode/set')database.prepare('UPDATE threads SET memory_mode=? WHERE id=?').run(m.params.mode,m.params.threadId);
  if(m.method==='thread/settings/update'){threadSettings={...threadSettings,...m.params};settingsUpdates++;}
  if(m.method==='thread/backgroundTerminals/list')result={data:[]};
  if(m.method==='fixture/inspect')result={diagnostics:{format:process.env.LOG_FORMAT,filter:process.env.RUST_LOG}};
  if(m.method==='turn/start'){turnId='synthetic-turn-'+randomUUID();result={turn:{id:turnId}};}
  send({id:m.id,result});
  if(m.method==='turn/start'){
    // Missing fields remain absent, so tests detect omission rather than inheritance.
    const text=JSON.stringify({contextWindow:setting('model_context_window'),autoCompactTokenLimit:setting('model_auto_compact_token_limit'),autoCompactTokenLimitScope:setting('model_auto_compact_token_limit_scope'),openaiBaseUrl:setting('openai_base_url'),requestCompression:setting('features.enable_request_compression'),threadMethod,threadSettings,threadServiceTier:threadParams.serviceTier,turnServiceTier:m.params.serviceTier,model:m.params.model??threadParams.model,effort:m.params.effort,consolidationModel,extractionModel,generateMemories,...(model?.startsWith('synthetic-hot')?{threadStarts,settingsUpdates}:{})});
    send({method:'item/completed',params:{threadId,turnId,item:{id:'synthetic-item',type:'agentMessage',phase:'final_answer',text}}});
    send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
  }
});
