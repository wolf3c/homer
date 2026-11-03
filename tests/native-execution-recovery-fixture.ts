import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineOptions,ToolCall,TurnResult} from '../src/engine.js';

export function host(){
  const scratch=resolve('.codex/scratch/native-timeout-recovery');mkdirSync(scratch,{recursive:true});
  const dir=mkdtempSync(join(scratch,'host-'));
  const config={runtime:join(dir,'runtime'),workspace:join(dir,'workspace'),codexHome:join(dir,'home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:40,mainTimeoutMs:40,stopGraceMs:20};
  mkdirSync(config.runtime);mkdirSync(config.workspace);
  const peers:Peer[]=[],events:any[]=[];let sequence=0;
  class Peer extends EventEmitter{
    threadId:string;turnId='';resumable=true;available=true;nativeBusy=false;stopConfirmed=true;startError='';mismatch=false;
    seen:string[]=[];closed=0;imageProbes=0;images:number[]=[];release?:()=>void;
    behavior:(text:string)=>Promise<TurnResult>=async text=>({status:'completed',text});
    constructor(readonly options:EngineOptions,readonly handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-original-thread';}
    async start(){if(this.startError)throw Error(this.startError);return this.mismatch?'synthetic-wrong-thread':this.threadId;}
    call(tool:string,args:unknown){return this.handler({threadId:this.threadId,turnId:this.turnId,callId:'call-'+ ++sequence,tool,arguments:args});}
    async imageCapability(){this.imageProbes++;if(!this.available||this.closed)throw Error('engine_disconnected');return true;}
    async turn(text:string,opts?:{onStarted?:(id:string)=>void;images?:unknown[]}){this.seen.push(text);this.images.push(opts?.images?.length??0);this.turnId='turn-'+ ++sequence;opts?.onStarted?.(this.turnId);return this.behavior(text);}
    async interrupt(){this.release?.();return true;}
    async close(){this.closed++;this.release?.();return this.stopConfirmed;}
  }
  let configureNext:((peer:Peer)=>void)|undefined;
  const app=new Homer(config,async e=>{events.push(e);},(options,handler)=>{const p=new Peer(options,handler);configureNext?.(p);configureNext=undefined;peers.push(p);return p;});
  return{app,peers,events,dir,config,next(fn:(peer:Peer)=>void){configureNext=fn;},async close(){await app.close();rmSync(dir,{recursive:true,force:true});}};
}
