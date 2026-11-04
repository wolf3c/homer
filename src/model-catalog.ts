import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync,constants,openSync,fstatSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalDir} from './files.js';
import {validReasoningEffort} from './model-config.js';

export type ModelCapabilities={inputModalities:('text'|'image')[];reasoningEfforts:string[];webSearch:boolean;toolSearch:boolean};
export function validateModelCapabilities(value:unknown,effort:string|null):ModelCapabilities{
 const invalid=():never=>{throw Error('invalid_model_capabilities');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==4||!['inputModalities','reasoningEfforts','webSearch','toolSearch'].every(k=>Object.hasOwn(v,k)))return invalid();
 if(!Array.isArray(v.inputModalities)||!v.inputModalities.includes('text')||v.inputModalities.some(m=>m!=='text'&&m!=='image')||new Set(v.inputModalities).size!==v.inputModalities.length)return invalid();
 if(!Array.isArray(v.reasoningEfforts)||v.reasoningEfforts.length>32||v.reasoningEfforts.some(e=>!validReasoningEffort(e))||new Set(v.reasoningEfforts).size!==v.reasoningEfforts.length||
  (effort===null?v.reasoningEfforts.length!==0:!v.reasoningEfforts.includes(effort))||typeof v.webSearch!=='boolean'||typeof v.toolSearch!=='boolean')return invalid();
 return {inputModalities:[...v.inputModalities],reasoningEfforts:[...v.reasoningEfforts],webSearch:v.webSearch,toolSearch:v.toolSearch} as ModelCapabilities;
}
export function membershipModelCatalog(model:string,effort:string|null,contextWindow:number,capabilities:ModelCapabilities){
 return {models:[{
  slug:model,display_name:model,description:model,
  model_messages:{instructions_template:'You are Codex, a coding agent working with the user in a shared workspace. Follow the developer instructions and complete the user\'s authorized task. Use the available tools when needed and report observed results clearly.'},
  default_reasoning_level:effort,supported_reasoning_levels:capabilities.reasoningEfforts.map(effort=>({effort,description:effort})),supports_reasoning_summary_parameter:effort!==null,supports_reasoning_effort_updates:effort!==null,
  shell_type:'shell_command',visibility:'list',supported_in_api:true,priority:1,availability_nux:null,upgrade:null,
  support_verbosity:false,default_verbosity:'low',apply_patch_tool_type:'freeform',web_search_tool_type:'text',truncation_policy:{mode:'tokens',limit:10000},
  context_window:contextWindow,max_context_window:contextWindow,effective_context_window_percent:95,
  experimental_supported_tools:[],input_modalities:[...capabilities.inputModalities],supports_image_detail_original:false,
  supports_search_tool:capabilities.toolSearch,tool_mode:null,multi_agent_version:'v2',default_reasoning_summary:'none',include_skills_usage_instructions:false,use_responses_lite:false,
 }]};
}
export function materializeModelCatalog(runtime:string,catalog:unknown){
 canonicalDir(runtime);
 const directory=join(runtime,'model-catalogs');
 mkdirSync(directory,{mode:0o700,recursive:true});
 if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory()||(lstatSync(directory).mode&0o077)!==0)throw Error('invalid_model_catalog_directory');
 const content=JSON.stringify(catalog)+'\n',path=join(directory,'codex-0.163.0-'+createHash('sha256').update(content).digest('hex')+'.json');
 const read=()=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>65536||(stat.mode&0o077)!==0)throw Error('invalid_model_catalog_file');return readFileSync(fd,'utf8');}finally{closeSync(fd);}};
 try{if(read()===content)return path;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('invalid_model_catalog_file');}
 const temporary=join(directory,'.catalog-'+randomUUID());
 try{writeFileSync(temporary,content,{mode:0o600,flag:'wx'});renameSync(temporary,path);}finally{rmSync(temporary,{force:true});}
 if(read()!==content)throw Error('invalid_model_catalog_file');
 return path;
}
