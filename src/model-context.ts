export type ContextTuning={contextWindow?:number;autoCompactTokenLimit?:number;autoCompactTokenLimitScope?:'total'|'body_after_prefix'};
export function validateContextTuning(value:unknown):Required<ContextTuning>{
 if(value!==undefined&&(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['contextWindow','autoCompactTokenLimit','autoCompactTokenLimitScope'].includes(k))))throw Error('invalid_model_context');
 const tuning=value as ContextTuning|undefined;
 if(tuning&&Object.values(tuning).some(value=>value===null))throw Error('invalid_model_context');
 const contextWindow=tuning?.contextWindow??272000,autoCompactTokenLimitScope=tuning?.autoCompactTokenLimitScope??'total';
 if(!Number.isInteger(contextWindow)||contextWindow<32768||contextWindow>1048576)throw Error('invalid_model_context_window');
 if(!['total','body_after_prefix'].includes(autoCompactTokenLimitScope))throw Error('invalid_model_auto_compact_token_limit_scope');
 // Pinned ModelInfo clamps total-scope thresholds to floor(context * 9 / 10).
 // Prefix-relative scope reads the configured growth threshold directly.
 const totalCapacity=Math.floor(contextWindow*9/10);
 const autoCompactTokenLimit=tuning?.autoCompactTokenLimit??(autoCompactTokenLimitScope==='total'?Math.min(250000,totalCapacity):250000);
 if(!Number.isInteger(autoCompactTokenLimit)||autoCompactTokenLimit<=0||autoCompactTokenLimit>=contextWindow*0.95||(autoCompactTokenLimitScope==='total'&&autoCompactTokenLimit>totalCapacity))throw Error('invalid_model_auto_compact_token_limit');
 return {contextWindow,autoCompactTokenLimit,autoCompactTokenLimitScope};
}
