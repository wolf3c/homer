import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync,constants,openSync,fstatSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ReasoningEffort} from './model-config.js';
import {canonicalDir} from './files.js';

export type DeepSeekTuning={contextWindow?:number;autoCompactTokenLimit?:number;autoCompactTokenLimitScope?:'total'|'body_after_prefix'};
export function validateDeepSeekTuning(value:unknown):Required<DeepSeekTuning>{
 if(value!==undefined&&(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['contextWindow','autoCompactTokenLimit','autoCompactTokenLimitScope'].includes(k))))throw Error('invalid_deepseek');
 const tuning=value as DeepSeekTuning|undefined;
 if(tuning&&Object.values(tuning).some(value=>value===null))throw Error('invalid_deepseek');
 const contextWindow=tuning?.contextWindow??272000,autoCompactTokenLimitScope=tuning?.autoCompactTokenLimitScope??'total';
 if(!Number.isInteger(contextWindow)||contextWindow<32768||contextWindow>1048576)throw Error('invalid_deepseek_context_window');
 if(!['total','body_after_prefix'].includes(autoCompactTokenLimitScope))throw Error('invalid_deepseek_auto_compact_token_limit_scope');
 // Pinned ModelInfo clamps total-scope thresholds to floor(context * 9 / 10).
 // Prefix-relative scope reads the configured growth threshold directly.
 const totalCapacity=Math.floor(contextWindow*9/10);
 const autoCompactTokenLimit=tuning?.autoCompactTokenLimit??(autoCompactTokenLimitScope==='total'?Math.min(250000,totalCapacity):250000);
 if(!Number.isInteger(autoCompactTokenLimit)||autoCompactTokenLimit<=0||autoCompactTokenLimit>=contextWindow*0.95||(autoCompactTokenLimitScope==='total'&&autoCompactTokenLimit>totalCapacity))throw Error('invalid_deepseek_auto_compact_token_limit');
 return {contextWindow,autoCompactTokenLimit,autoCompactTokenLimitScope};
}
export function deepseekProfile(config:{model:string;baseUrl?:string;effort?:ReasoningEffort;fast?:boolean;deepseek?:DeepSeekTuning}){
 const tuning=validateDeepSeekTuning(config.deepseek);
 if(config.model!=='deepseek-flash'||!config.baseUrl||new URL(config.baseUrl).hostname==='api.openai.com')return undefined;
 if(config.effort!==undefined&&!['low','high','max'].includes(config.effort))throw Error('invalid_deepseek_effort');
 return {...tuning,effort:config.effort??'high' as ReasoningEffort,fast:config.fast??false};
}
// DeepSeek's official Codex guide, projected onto ModelInfo in Codex 0.163.0.
// The catalog deserializer requires an instruction template. Homer supplies its
// task and capability policy through developerInstructions on every thread.
const deepseekModel={
 slug:'deepseek-flash',display_name:'DeepSeek-Flash',description:'DeepSeek agentic model with image input',
 model_messages:{instructions_template:'You are Codex, a coding agent working with the user in a shared workspace. Follow the developer instructions and complete the user\'s authorized task. Use the available tools when needed and report observed results clearly.'},
 default_reasoning_level:'high',supported_reasoning_levels:['low','high','max'].map(effort=>({effort,description:effort})),
 shell_type:'shell_command',visibility:'list',supported_in_api:true,priority:1,
 availability_nux:null,upgrade:null,support_verbosity:true,default_verbosity:'low',
 apply_patch_tool_type:'freeform',web_search_tool_type:'text',truncation_policy:{mode:'tokens',limit:10000},
 context_window:1048576,max_context_window:1048576,effective_context_window_percent:95,
 experimental_supported_tools:[],input_modalities:['text','image'],supports_image_detail_original:true,
 supports_search_tool:true,tool_mode:null,multi_agent_version:'v2',
 default_reasoning_summary:'none',include_skills_usage_instructions:false,use_responses_lite:false,
};
export const deepseekCatalog={models:[deepseekModel]};
export function materializeDeepSeekCatalog(runtime:string){
 canonicalDir(runtime);
 const directory=join(runtime,'model-catalogs');
 mkdirSync(directory,{mode:0o700,recursive:true});
 if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory()||(lstatSync(directory).mode&0o077)!==0)throw Error('invalid_deepseek_catalog_directory');
 const path=join(directory,'deepseek-codex-0.163.0-v1.json'),content=JSON.stringify(deepseekCatalog)+'\n';
 const read=()=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>65536||(stat.mode&0o077)!==0)throw Error('invalid_deepseek_catalog_file');return readFileSync(fd,'utf8');}finally{closeSync(fd);}};
 try{if(read()===content)return path;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('invalid_deepseek_catalog_file');}
 const temporary=join(directory,'.catalog-'+randomUUID());
 try{writeFileSync(temporary,content,{mode:0o600,flag:'wx'});renameSync(temporary,path);}finally{rmSync(temporary,{force:true});}
 if(read()!==content)throw Error('invalid_deepseek_catalog_file');
 return path;
}
