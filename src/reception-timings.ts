import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
export type ReceptionPhase='accepted'|'head'|'claimed'|'main_prepare'|'capabilities_start'|'capabilities_end'|'native_start'|'native_completed'|'background_refreshed'|'engine_settled'|'host_finalize_start'|'host_finalize_end'|'output_wait_start'|'output_wait_end'|'reply_delivery_start'|'reply_delivery_end'|'output_ipc_start'|'output_ipc_sent'|'output_ipc_ack'|'round_end'|'state_history';
type Identity={requestId?:string;messageId?:string;generationId?:string;turnId?:string;processId?:string;outputId?:string;kind?:'user'|'internal'};
export type ReceptionTiming=Identity & {phase:ReceptionPhase;at:number;monotonicMs:number;status?:string;durationMs?:number};
// Bounded, process-local diagnostics. No prompt, SQL parameters, tool data,
// message text, filesystem paths, URLs or engine error bodies are accepted.
export class ReceptionTimings {
 private records:ReceptionTiming[]=[];
 private histogram=monitorEventLoopDelay({resolution:20});
 constructor(){this.histogram.enable();}
 measure<T>(phase:ReceptionPhase,read:()=>T):T{
  const start=performance.now();
  try{return read();}finally{this.mark(phase,{},undefined,performance.now()-start);}
 }
 mark(phase:ReceptionPhase,identity:Identity={},status?:string,durationMs?:number){
  try{
   const safe:Identity={};
   for(const key of ['requestId','messageId','generationId','turnId','processId','outputId'] as const){const value=identity[key];if(typeof value==='string'&&/^[\w:.-]{1,150}$/.test(value))safe[key]=value;}
   if(identity.kind==='user'||identity.kind==='internal')safe.kind=identity.kind;
   this.records.push({...safe,phase,at:Date.now(),monotonicMs:performance.now(),...(status&&/^[a-z][a-z0-9_]{0,70}$/.test(status)?{status}:{}),...(durationMs!==undefined&&Number.isFinite(durationMs)?{durationMs}:{})});
   if(this.records.length>512)this.records.splice(0,this.records.length-512);
  }catch{/* Diagnostics cannot prevent reception. */}
 }
 read(){const ms=(value:number)=>Number.isFinite(value)?value/1e6:null;return {capacity:512,records:this.records.map(record=>({...record})),eventLoopDelay:{meanMs:ms(this.histogram.mean),p95Ms:ms(this.histogram.percentile(95)),maxMs:ms(this.histogram.max)}};}
 close(){this.histogram.disable();}
}
