import type {ExecutionSnapshot} from './execution-limits.js';
// Fixed App Server ThreadTokenUsage counters. Unknown fields never reach Web.
export type TokenCounters=Partial<Record<'totalTokens'|'inputTokens'|'cachedInputTokens'|'outputTokens'|'reasoningOutputTokens',number>>;
export type NativeTokenUsage={execution?:ExecutionSnapshot;total?:TokenCounters;last?:TokenCounters;modelContextWindow?:number};
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
export function nativeTokenUsage(value:unknown):NativeTokenUsage|null{
 if(!value||typeof value!=='object')return null;
 const raw=value as Record<string,unknown>,usage:NativeTokenUsage={};
 for(const section of ['total','last'] as const){
  const source=raw[section];if(!source||typeof source!=='object')continue;
  const counters:TokenCounters={};
  for(const field of ['totalTokens','inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens'] as const){const n=(source as Record<string,unknown>)[field];if(count(n))counters[field]=n;}
  if(Object.keys(counters).length)usage[section]=counters;
 }
 const e=raw.execution as any;
 if(e&&['estimated','unavailable'].includes(e.costStatus)&&count(e.consecutiveCompactions)){
 const complete=['inputTokens','cachedInputTokens','outputTokens'].every(k=>count(e[k]))&&e.cachedInputTokens<=e.inputTokens;
 const estimated=e.costStatus==='estimated'&&complete&&typeof e.estimatedCostCny==='number'&&Number.isFinite(e.estimatedCostCny)&&e.estimatedCostCny>=0;
 usage.execution={costStatus:estimated?'estimated':'unavailable',estimatedCostCny:estimated?e.estimatedCostCny:null,inputTokens:estimated?e.inputTokens:null,cachedInputTokens:estimated?e.cachedInputTokens:null,outputTokens:estimated?e.outputTokens:null,consecutiveCompactions:e.consecutiveCompactions,...(['engine_cost_limit_reached','engine_compaction_loop'].includes(e.stopReason)?{stopReason:e.stopReason}:{})};
 }
 if(!usage.total&&!usage.last&&!usage.execution)return null;
 if(count(raw.modelContextWindow))usage.modelContextWindow=raw.modelContextWindow;
 return usage;
}
