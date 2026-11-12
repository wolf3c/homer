// Internal product defaults shared by the main Agent, Workers and presentation.
// Store only the environment variable name for a key, never a credential value.
// Explicit local configuration and HOMER_* overrides are resolved in config.ts.
// Fixed native protocol accepts a non-empty advertised effort string.
export type ReasoningEffort = string;
export const validReasoningEffort=(value:unknown):value is string=>typeof value==='string'&&/^[\x21-\x7e]{1,64}$/.test(value);
export type ModelRole = "main" | "worker";
export type ChatGPTModelConfig={model:string;effort:ReasoningEffort;serviceTier:string|null};
export type ChatGPTModelOverrides=Partial<Record<ModelRole,ChatGPTModelConfig>>;
export const CHATGPT_MODEL_DEFAULTS:Readonly<Record<ModelRole,Readonly<ChatGPTModelConfig>>>=Object.freeze({
  main:Object.freeze({model:'gpt-6.1-terra',effort:'high',serviceTier:'priority'}),
  worker:Object.freeze({model:'gpt-6.1-terra',effort:'xhigh',serviceTier:null}),
});
export type NativeModel={model:string;displayName:string;defaultReasoningEffort:string;supportedReasoningEfforts:{reasoningEffort:string}[];serviceTiers:{id:string;name:string}[]};
export type NativeModelSettings={current:Record<ModelRole,ChatGPTModelConfig>;defaults:Record<ModelRole,Readonly<ChatGPTModelConfig>>;models?:NativeModel[];error?:string};
export const CHATGPT_MODEL_ERRORS:Record<string,string>={
  chatgpt_model_config_invalid:'模型参数无效，请重新选择。',
  chatgpt_model_selection_unavailable:'所选模型、思考深度或速度已不可用，请重新选择。',
  chatgpt_model_save_failed:'模型设置未能保存，原设置已保留，请检查磁盘后重试。',
  chatgpt_model_source_changed:'模型来源已变化，请重新打开账号设置。',
  native_models_unconfirmed:'模型列表暂时无法确认，请重试。',
  native_account_not_connected:'ChatGPT 登录状态未确认，请重新检查登录。',
  chatgpt_model_apply_unconfirmed:'模型设置保存结果未确认，请重试。',
};
export const chatgptModelError=(message:unknown)=>Object.keys(CHATGPT_MODEL_ERRORS).find(code=>typeof message==='string'&&(message===code||message.endsWith(': '+code)))??'chatgpt_model_apply_unconfirmed';

export function chatgptModelConfig(value:unknown=undefined):Record<ModelRole,ChatGPTModelConfig>{
  if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='main'&&key!=='worker')))throw Error('chatgpt_model_config_invalid');
  const result={main:{...CHATGPT_MODEL_DEFAULTS.main},worker:{...CHATGPT_MODEL_DEFAULTS.worker}};
  for(const role of ['main','worker'] as const){
    const selected=(value as ChatGPTModelOverrides|undefined)?.[role];
    if(selected===undefined)continue;
    if(!selected||typeof selected!=='object'||Array.isArray(selected)||Object.keys(selected).length!==3||Object.keys(selected).some(key=>!['model','effort','serviceTier'].includes(key))||
       typeof selected.model!=='string'||! /^[\x21-\x7e]{1,200}$/.test(selected.model)||!validReasoningEffort(selected.effort)||selected.serviceTier!==null&&!validReasoningEffort(selected.serviceTier))throw Error('chatgpt_model_config_invalid');
    result[role]={model:selected.model,effort:selected.effort,serviceTier:selected.serviceTier};
  }
  return result;
}

export function validateChatGPTSelection(value:unknown,models:NativeModel[]):ChatGPTModelOverrides{
  const roles=chatgptModelConfig(value),overrides:ChatGPTModelOverrides={};
  if(!value||Object.keys(value).length!==2||Object.values(value).includes(undefined))throw Error('chatgpt_model_config_invalid');
  for(const role of ['main','worker'] as const){
    const selected=roles[role],model=models.find(model=>model.model===selected.model);
    if(!model||!(model.supportedReasoningEfforts.length?model.supportedReasoningEfforts.some(option=>option.reasoningEffort===selected.effort):selected.effort===model.defaultReasoningEffort)||
       selected.serviceTier!==null&&!model.serviceTiers.some(tier=>tier.id===selected.serviceTier))throw Error('chatgpt_model_selection_unavailable');
    if(JSON.stringify(selected)!==JSON.stringify(CHATGPT_MODEL_DEFAULTS[role]))overrides[role]=selected;
  }
  return overrides;
}
export const PRODUCT_MODEL_DEFAULTS: Readonly<{
  model: string;
  effort: ReasoningEffort;
  workerEffort: ReasoningEffort;
  fast: boolean;
  workerFast: boolean;
  baseUrl?: string;
  keyEnv?: string;
  requiresOpenaiAuth: boolean;
}> = Object.freeze({
  model: "gpt-6.1-sol",
  effort: "medium",
  workerEffort: "high",
  fast: true,
  workerFast: true,
  baseUrl: undefined,
  keyEnv: undefined,
  requiresOpenaiAuth: true,
});

// Shared by execution and caller-facing configuration projections.
export function effectiveEffort(effort: ReasoningEffort | null | undefined, role: ModelRole = "main"): ReasoningEffort | null {
  return effort===null?null:effort ?? (role === "worker" ? PRODUCT_MODEL_DEFAULTS.workerEffort : PRODUCT_MODEL_DEFAULTS.effort);
}

export function effectiveFast(fast: boolean | undefined, role: ModelRole = "main"): boolean {
  return fast ?? (role === "worker" ? PRODUCT_MODEL_DEFAULTS.workerFast : PRODUCT_MODEL_DEFAULTS.fast);
}
