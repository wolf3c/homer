import type {ReasoningEffort} from './model-config.js';
import {materializeModelCatalog} from './model-catalog.js';

import {validateContextTuning as validateDeepSeekTuning,type ContextTuning as DeepSeekTuning} from './model-context.js';
export {validateContextTuning as validateDeepSeekTuning,type ContextTuning as DeepSeekTuning} from './model-context.js';
export function deepseekProfile(config:{model:string;baseUrl?:string;effort?:ReasoningEffort|null;fast?:boolean;deepseek?:DeepSeekTuning;context?:DeepSeekTuning}){
 if(config.context)return undefined;
 const tuning=validateDeepSeekTuning(config.deepseek);
 if(config.model!=='deepseek-flash'||!config.baseUrl||new URL(config.baseUrl).hostname==='api.openai.com')return undefined;
 if(config.effort!==undefined&&!['low','high','max'].includes(config.effort??''))throw Error('invalid_deepseek_effort');
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
export function materializeDeepSeekCatalog(runtime:string){return materializeModelCatalog(runtime,deepseekCatalog);}
