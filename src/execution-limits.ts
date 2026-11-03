import {createHash} from 'node:crypto';
export type ExecutionLimits={maxCostCny?:number;pricing?:{inputCnyPerMillion:number;cachedInputCnyPerMillion:number;outputCnyPerMillion:number};maxConsecutiveCompactions?:number};
export type ExecutionSnapshot={costStatus:'estimated'|'unavailable';estimatedCostCny:number|null;inputTokens:number|null;cachedInputTokens:number|null;outputTokens:number|null;consecutiveCompactions:number;stopReason?:'engine_cost_limit_reached'|'engine_compaction_loop'};
export function isExecutionGuardStop(code:unknown):boolean{return code==='engine_cost_limit_reached'||code==='engine_compaction_loop';}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateExecutionLimits(value:unknown):ExecutionLimits{
 if(value===undefined)return {};
 if(!object(value)||Object.keys(value).some(k=>!['maxCostCny','pricing','maxConsecutiveCompactions'].includes(k)))throw Error('invalid_execution_limits');
 if(value.maxCostCny!==undefined&&(typeof value.maxCostCny!=='number'||!Number.isFinite(value.maxCostCny)||value.maxCostCny<=0))throw Error('invalid_execution_limits');
 if(value.maxConsecutiveCompactions!==undefined&&(!Number.isInteger(value.maxConsecutiveCompactions)||(value.maxConsecutiveCompactions!==0&&(Number(value.maxConsecutiveCompactions)<2||Number(value.maxConsecutiveCompactions)>100))))throw Error('invalid_execution_limits');
 if(value.pricing!==undefined){const p=value.pricing,keys=['inputCnyPerMillion','cachedInputCnyPerMillion','outputCnyPerMillion'];if(!object(p)||Object.keys(p).some(k=>!keys.includes(k))||keys.some(k=>typeof p[k]!=='number'||!Number.isFinite(p[k])||Number(p[k])<0))throw Error('invalid_execution_limits');}
 if(value.maxCostCny!==undefined&&value.pricing===undefined)throw Error('invalid_execution_limits');
 return value as ExecutionLimits;
}
type Counters={inputTokens:number;cachedInputTokens:number;outputTokens:number};
export function executionCounters(value:unknown):Counters|undefined{
 if(!object(value))return;
 const keys=['inputTokens','cachedInputTokens','outputTokens'] as const;
 if(keys.some(k=>typeof value[k]!=='number'||!Number.isSafeInteger(value[k])||Number(value[k])<0)||Number(value.cachedInputTokens)>Number(value.inputTokens))return;
 return {inputTokens:Number(value.inputTokens),cachedInputTokens:Number(value.cachedInputTokens),outputTokens:Number(value.outputTokens)};
}
const keys=['inputTokens','cachedInputTokens','outputTokens'] as const;
export class TurnExecution{
 private baseline?:Counters;private previous?:Counters;private invalid=false;private compactions=new Set<string>();private fingerprints=new Set<string>();
 snapshot:ExecutionSnapshot={costStatus:'unavailable',estimatedCostCny:null,inputTokens:null,cachedInputTokens:null,outputTokens:null,consecutiveCompactions:0};
 constructor(readonly limits:ExecutionLimits,baseline?:Counters){this.baseline=baseline;this.previous=baseline;}
 usage(raw:unknown){
 const total=executionCounters(object(raw)?raw.total:undefined),last=executionCounters(object(raw)?raw.last:undefined);
 let delta:Counters|undefined;
 if(!this.baseline&&(!total||!last||keys.some(k=>last[k]>total[k])))this.invalid=true;
 if(total&&!this.invalid){
  if(!this.baseline&&last&&keys.every(k=>last[k]<=total[k])){
    this.baseline=executionCounters({inputTokens:total.inputTokens-last.inputTokens,cachedInputTokens:total.cachedInputTokens-last.cachedInputTokens,outputTokens:total.outputTokens-last.outputTokens});
    if(!this.baseline)this.invalid=true;
  }
  if(this.previous&&keys.some(k=>total[k]<this.previous![k]))this.invalid=true;
  this.previous=total;
  if(this.baseline&&keys.every(k=>total[k]>=this.baseline![k]))delta=executionCounters({inputTokens:total.inputTokens-this.baseline.inputTokens,cachedInputTokens:total.cachedInputTokens-this.baseline.cachedInputTokens,outputTokens:total.outputTokens-this.baseline.outputTokens});
 }
 const p=this.limits.pricing;
 const cost=delta&&p?((delta.inputTokens-delta.cachedInputTokens)*p.inputCnyPerMillion+delta.cachedInputTokens*p.cachedInputCnyPerMillion+delta.outputTokens*p.outputCnyPerMillion)/1e6:undefined;
 const valid=!this.invalid&&cost!==undefined&&Number.isFinite(cost);
 this.snapshot={...this.snapshot,costStatus:valid?'estimated':'unavailable',estimatedCostCny:valid?cost:null,inputTokens:valid?delta!.inputTokens:null,cachedInputTokens:valid?delta!.cachedInputTokens:null,outputTokens:valid?delta!.outputTokens:null};
 if(valid&&this.limits.maxCostCny!==undefined&&cost>=this.limits.maxCostCny&&!this.snapshot.stopReason)this.snapshot.stopReason='engine_cost_limit_reached';
 return {...this.snapshot};
 }
 compact(id:string){if(!this.compactions.has(id)){this.compactions.add(id);this.snapshot.consecutiveCompactions++;if(this.limits.maxConsecutiveCompactions&&this.snapshot.consecutiveCompactions>=this.limits.maxConsecutiveCompactions&&!this.snapshot.stopReason)this.snapshot.stopReason='engine_compaction_loop';}return {...this.snapshot};}
 evidence(item:any){
 if(!item||item.status==='failed'||item.status==='interrupted'||item.success===false||item.failure)return;
 let value:unknown;
 if(item.type==='commandExecution'&&item.status==='completed'&&item.exitCode===0)value=item.aggregatedOutput;
 if(item.type==='mcpToolCall'&&item.status==='completed'&&!item.error&&!item.result?.isError){
   const {content,structuredContent}=item.result??{};
   const present=(v:any)=>v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length>0)&&(!object(v)||Object.keys(v).length>0);
   if(present(content)||present(structuredContent))value={content,structuredContent};
 }
 if(item.type==='dynamicToolCall'&&item.success===true)value=item.contentItems;
 if(item.type==='fileChange'&&item.status==='completed')value=item.changes;
 if(item.type==='imageGeneration'&&item.status==='completed')value=item.result;
 if(value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length))return;
 const stable=(v:any):any=>{
   if(typeof v==='string'){try{return stable(JSON.parse(v));}catch{return v;}}
   if(Array.isArray(v))return v.map(stable);
   if(object(v))return Object.fromEntries(Object.keys(v).sort().filter(k=>!['_meta','durationMs','duration','startedAt','completedAt','startedAtMs','completedAtMs','timestamp','observedAtMs','callId','turnId','threadId','id'].includes(k)).map(k=>[k,stable(v[k])]));
   return v;
 };
 const failed=(v:any):boolean=>Array.isArray(v)?v.some(failed):object(v)?v.success===false||v.isError===true||!!v.error||['failed','error','interrupted','waiting','pending','running','queued'].includes(String(v.status))||Object.values(v).some(failed):typeof v==='string'?(()=>{try{return failed(JSON.parse(v));}catch{return false;}})():false;
 if(failed(value))return;
 const digest=createHash('sha256').update(JSON.stringify([item.type,stable(value)])).digest('hex');
 if(this.fingerprints.has(digest))return;
 // Stop accepting new resets once bounded memory fills; never forget old evidence.
 if(this.fingerprints.size>=1024)return;
 this.fingerprints.add(digest);this.snapshot.consecutiveCompactions=0;
 }
}
