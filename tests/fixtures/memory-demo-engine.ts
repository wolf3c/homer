// Offline synthetic agent for behavior tests and the explicitly labelled demo.
// Never selected by product defaults; it makes no model/network requests.
import {EventEmitter} from 'node:events';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../../src/engine.js';
let seq=0;
export class MemoryDemoEngine extends EventEmitter implements EngineLike {
 threadId:string;turnId?:string;resumable=true;
 private release?: (r:TurnResult)=>void;
 readonly worker:boolean;
 constructor(readonly options:EngineOptions,readonly handler:(c:ToolCall)=>Promise<unknown>,readonly holdWorker=false){
  super();this.worker=options.tools.some(t=>t.name==='read_material');this.threadId=options.threadId??'offline-'+(this.worker?'worker-':'main-')+(++seq);
 }
 async start(){return this.threadId;}
 async call(tool:string,args:unknown):Promise<any>{return this.handler({threadId:this.threadId,turnId:this.turnId!,callId:'offline-call-'+ ++seq,tool,arguments:args});}
 async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
  this.turnId='offline-turn-'+ ++seq;options?.onStarted?.(this.turnId);
  if(this.worker){
   if(this.holdWorker)return new Promise(resolve=>this.release=resolve);
   await this.call('read_material',{});
   await this.call('write_markdown',{filename:'memory-demo.md',content:'# 合成成果\n\n本项目文档使用 Markdown。\n'});
   await this.call('suggest_memory',{content:'本项目文档使用 Markdown。'});
   return {status:'completed',text:'合成成果已写入，待主验收。'};
  }
  if(text.startsWith('[执行结果待审阅]')){
   const runId=text.match(/runId=([\w-]+)/)![1];await this.call('inspect_run',{runId});await this.call('review_artifact',{runId,accepted:true,reason:'合成输入与实际成果已检查。',summary:'文档规范已核对。'});return {status:'completed',text:'合成验收已完成。'};
  }
  if(text.startsWith('[执行结果待交付]'))return {status:'completed',text:'合成成果已交付。'};
  const user=text.split('\n\n[宿主记忆数据')[0]!;
  if(/^(?:请)?记住[:：]/.test(user)) {
   const content=user.replace(/^(?:请)?记住[:：]\s*/,''),r=await this.call('memory_propose',{operationId:'explicit-'+ ++seq,content});
   return {status:'completed',text:r.state==='active'?'保存操作已提交。':'这条记录待确认。'};
  }
  if(/纠正为[:：]/.test(user)){
   const list=await this.call('memory_search',{query:''}),e=list.entries[0];if(e){await this.call('memory_read',{id:e.id});await this.call('memory_correct',{operationId:'correct-'+ ++seq,id:e.id,expectedRevision:e.revision,content:user.split(/纠正为[:：]\s*/)[1]});}return {status:'completed',text:e?'纠正操作已提交。':'没有可纠正的记忆。'};
  }
  if(/^(?:请)?忘掉/.test(user)){
   const list=await this.call('memory_search',{query:''}),e=list.entries[0];if(e){await this.call('memory_read',{id:e.id});await this.call('memory_forget',{operationId:'forget-'+ ++seq,id:e.id,expectedRevision:e.revision});}return {status:'completed',text:e?'遗忘操作已提交。':'没有可忘记的记忆。'};
  }
  if(/^(关闭记忆|暂停记忆|开启记忆|恢复记忆|恢复自动保存)$/.test(user)){
   const s=await this.call('memory_settings',{}),change=user==='关闭记忆'?{enabled:false}:user==='暂停记忆'?{autoSave:false}:user==='恢复自动保存'?{autoSave:true}:{enabled:true};
   try{await this.call('memory_settings',{operationId:'settings-'+ ++seq,expectedRevision:s.revision,...change});}
   catch(error){if(error instanceof Error&&error.message==='memory_always_on')return {status:'completed',text:'记忆与自动保存始终开启，可查询、纠正或遗忘单条。'};throw error;}
   return {status:'completed',text:'记忆设置已更新。'};
  }
  if(user==='派发合成事项'){
   const r=await this.call('dispatch_work',{title:'合成事项',goal:'整理文档',material:'sample.md'});return {status:'completed',text:r.id};
  }
  const s=await this.call('memory_settings',{});if(!s.enabled)return {status:'completed',text:'记忆已关闭。'};
  const result=await this.call('memory_search',{query:''});return {status:'completed',text:result.entries.length?result.entries.map((e:any)=>e.content).join('\n'):'没有已保存的记忆。'};
 }
 async interrupt(){this.release?.({status:'interrupted',text:''});this.release=undefined;return true;}
 async close(){await this.interrupt();return true;}
}
