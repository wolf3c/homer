#!/usr/bin/env node
// Protocol fixture only. No network, account access, native threads or model calls.
import {createInterface} from 'node:readline';
import {join} from 'node:path';
if(process.argv.includes('--version')){console.log('codex-cli 0.163.0');process.exit(0);}
let threadMethod,threadParams,threadSettings={model:"old-model",effort:"xhigh",serviceTier:"priority"};
const args=process.argv.slice(2),model=JSON.parse(args.find(arg=>arg.startsWith('model='))?.slice(6)??'null');
const setting=name=>{const value=args.find(arg=>arg.startsWith(name+'='));return value?JSON.parse(value.slice(name.length+1)):undefined;};
const consolidationModel=setting('memories.consolidation_model'),extractionModel=setting('memories.extract_model'),generateMemories=setting('memories.generate_memories');
const trustedArg=args.find(arg=>arg.startsWith('mcp_servers.homer_interactions='));
const trusted=trustedArg?JSON.parse(trustedArg.slice(trustedArg.indexOf('=')+1).replace(/("(?:[^"\\]|\\.)*")=/g,'$1:')):undefined;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;let result={};
  if(m.method==='initialize')result={userAgent:'codex/0.163.0',codexHome:process.env.CODEX_HOME};
  if(m.method==='config/read')result={config:{...Object.fromEntries(['model','model_catalog_json','model_context_window','model_auto_compact_token_limit','model_auto_compact_token_limit_scope','web_search'].map(name=>[name,setting(name)])),features:{memories:true},memories:{dedicated_tools:true,generate_memories:generateMemories,extract_model:extractionModel,consolidation_model:consolidationModel},mcp_servers:trusted?{homer_interactions:trusted}:{}},layers:[{name:{type:'user',file:join(process.env.CODEX_HOME,'config.toml')},version:'synthetic-config',config:{}}]};
  if(m.method==='mcpServerStatus/list')result={data:trusted?[{name:'homer_interactions',tools:Object.fromEntries(trusted.enabled_tools.map(name=>[name,{}]))}]:[]};
  if(m.method==='environment/info')result={shell:'/bin/zsh'};
  if(m.method==='model/list'){const page={data:[{id:model,model,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','high','max'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:model==='synthetic-standard-only'?[]:[{id:'priority',name:'Fast',description:'Synthetic catalog'},...(model==='synthetic-ultrafast'?[{id:'ultrafast',name:'Ultrafast',description:'Synthetic catalog'}]:[])]}],nextCursor:null};page.data[0].inputModalities=['text','image'];if(model==='synthetic-page-standard')page.data[0].serviceTiers=[];result=['synthetic-page-two','synthetic-page-standard'].includes(model)&&!m.params.cursor?{data:[{id:'first',model:'first',inputModalities:['text'],serviceTiers:[]}],nextCursor:'second'}:page;}
  if(m.method==='thread/start'||m.method==='thread/resume'){
    threadMethod=m.method;threadParams=m.params;
    result={thread:{id:'synthetic-model-thread'},activePermissionProfile:{id:'homer'},approvalPolicy:m.params.approvalPolicy};
  }
  if(m.method==='thread/settings/update')threadSettings={...threadSettings,...m.params};
  if(m.method==='thread/backgroundTerminals/list')result={data:[]};
  if(m.method==='turn/start')result={turn:{id:'synthetic-turn'}};
  send({id:m.id,result});
  if(m.method==='turn/start'){
    // Missing fields remain absent, so tests detect omission rather than inheritance.
    const text=JSON.stringify({contextWindow:setting('model_context_window'),autoCompactTokenLimit:setting('model_auto_compact_token_limit'),autoCompactTokenLimitScope:setting('model_auto_compact_token_limit_scope'),openaiBaseUrl:setting('openai_base_url'),requestCompression:setting('features.enable_request_compression'),threadMethod,threadSettings,threadServiceTier:threadParams.serviceTier,turnServiceTier:m.params.serviceTier,model:threadParams.model,effort:m.params.effort,consolidationModel,extractionModel,generateMemories});
    send({method:'item/completed',params:{threadId:'synthetic-model-thread',turnId:'synthetic-turn',item:{id:'synthetic-item',type:'agentMessage',phase:'final_answer',text}}});
    send({method:'turn/completed',params:{threadId:'synthetic-model-thread',turn:{id:'synthetic-turn',status:'completed'}}});
  }
});
