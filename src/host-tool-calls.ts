import type {EngineLike,ToolCall} from './engine.js';
import {recursiveHash} from './recursive-tasks.js';

type NativeStart=Omit<ToolCall,'callId'>&{itemId:string};
type Calls={threadId:string;turnId:string;starts:Map<string,string|null>;waiters:Map<symbol,{callId:string;finish:()=>void}>};
const scheduled=(tool:string)=>['schedule_create','schedule_list','schedule_update','schedule_cancel'].includes(tool);
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200;
const live=(engine:EngineLike,threadId:string,turnId:string)=>engine.threadId===threadId&&engine.turnId===turnId&&engine.turnActive!==false&&engine.available!==false;

export class HostToolCalls {
  private engines=new WeakMap<EngineLike,Calls>();
  clear(engine:EngineLike) {
    const calls=this.engines.get(engine);
    this.engines.delete(engine);
    for(const waiter of calls?.waiters.values()??[])waiter.finish();
  }
  private state(engine:EngineLike,threadId:string,turnId:string) {
    let calls=this.engines.get(engine);
    if(!calls||calls.threadId!==threadId||calls.turnId!==turnId){
      this.clear(engine);
      calls={threadId,turnId,starts:new Map(),waiters:new Map()};this.engines.set(engine,calls);
    }
    return calls;
  }
  observe(engine:EngineLike,call:NativeStart) {
    if(!scheduled(call.tool)||!validId(call.itemId)||!validId(call.threadId)||!validId(call.turnId)||!live(engine,call.threadId,call.turnId))return;
    const calls=this.state(engine,call.threadId,call.turnId),fingerprint=recursiveHash([call.tool,call.arguments]);
    if(calls.starts.has(call.itemId)){
      if(calls.starts.get(call.itemId)!==fingerprint)calls.starts.set(call.itemId,null);
    }else if(calls.starts.size<256)calls.starts.set(call.itemId,fingerprint);
    for(const waiter of calls.waiters.values())if(waiter.callId===call.itemId)waiter.finish();
  }
  async authenticate(engine:EngineLike,tool:string,args:unknown,meta:unknown,guard:()=>boolean):Promise<Pick<ToolCall,'threadId'|'turnId'|'callId'>> {
    const identity=meta as {callId?:unknown;'x-codex-turn-metadata'?:{turn_id?:unknown}}|undefined;
    const callId=identity?.callId,turnId=identity?.['x-codex-turn-metadata']?.turn_id,threadId=engine.threadId;
    if(!scheduled(tool)||!validId(callId)||!validId(turnId)||!validId(threadId)||!live(engine,threadId,turnId)||!guard())throw Error('schedule_call_scope_denied');
    const calls=this.state(engine,threadId,turnId);
    if(!calls.starts.has(callId)){
      if(calls.waiters.size>=32)throw Error('schedule_call_scope_denied');
      await new Promise<void>(resolve=>{
        const key=Symbol(),finish=()=>{clearTimeout(timer);calls.waiters.delete(key);resolve();};
        const timer=setTimeout(finish,1000);calls.waiters.set(key,{callId,finish});
      });
    }
    if(this.engines.get(engine)!==calls||!live(engine,threadId,turnId)||!guard()||calls.starts.get(callId)!==recursiveHash([tool,args]))throw Error('schedule_call_scope_denied');
    // The host transaction deduplicates writes; exact live retries may recover its committed receipt.
    return {threadId,turnId,callId};
  }
}
