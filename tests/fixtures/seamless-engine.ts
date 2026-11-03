// Copied into an isolated fixture's src by dev-gateway.test.mjs. No Codex spawn.
import {EventEmitter} from 'node:events';
import {existsSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import type {EngineLike,EngineOptions,TurnResult} from '../../src/engine.js';
export const syntheticEngine=(options:EngineOptions):EngineLike=>new SyntheticEngine(options);
class SyntheticEngine extends EventEmitter implements EngineLike {
 readonly resumable=true;
 readonly threadId:string;
 turnId?:string;
 private closed=false;
 private interrupted=false;
 private root:string;
 constructor(options:EngineOptions){super();this.threadId=options.threadId??'synthetic-gateway-main';this.root=join(dirname(options.cwd),"runtime");}
 async start(){
  if(existsSync(join(this.root,'hold-resume'))){writeFileSync(join(this.root,'resume-waiting'),'1');while(!this.closed&&!existsSync(join(this.root,'release-resume')))await new Promise(r=>setTimeout(r,10));}
  return this.threadId;
 }
 async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
  this.interrupted=false;this.turnId='turn-'+Date.now();options?.onStarted?.(this.turnId);
  this.emit('textDelta',{threadId:this.threadId,turnId:this.turnId,delta:'Synthetic streaming'});
  if(text==='hold-main'){
   writeFileSync(join(this.root,'main-running'),'1');
   while(!this.closed&&!this.interrupted&&!existsSync(join(this.root,'release-main')))await new Promise(r=>setTimeout(r,10));
  }
  return {status:this.interrupted||this.closed?'interrupted':'completed',text:'Synthetic reply'};
 }
 async interrupt(){this.interrupted=true;return true;}
 async close(){this.closed=true;this.interrupted=true;return true;}
}
