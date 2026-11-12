import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer,type Message} from '../../src/service.js';
import type {EngineLike,EngineOptions,ToolCall,TurnResult} from '../../src/engine.js';
import type {ChannelAdapter} from '../../src/channel-plugin.js';
export const until=async(check:()=>boolean)=>{
  const end=performance.now()+4000;
  while(!check()){if(performance.now()>end)throw Error('worker_chat_test_timeout');await new Promise(resolve=>setTimeout(resolve,5));}
};
export function fixture(adapters?:readonly ChannelAdapter[], beforeEngineStart?:()=>Promise<void>){
  const scratch=resolve('.codex/scratch/worker-chat-b');mkdirSync(scratch,{recursive:true});
  const root=mkdtempSync(join(scratch,'case-'));mkdirSync(join(root,'workspace'));mkdirSync(join(root,'runtime'));
  const engines:Peer[]=[],events:Message[]=[],inputs:string[]=[];
  let script:((engine:Peer,text:string)=>Promise<TurnResult>)|undefined,sink:((message:Message)=>Promise<void>)|undefined,sequence=0;
  class Peer extends EventEmitter implements EngineLike{
    threadId:string;turnId?:string;input?:string;finish?:(result:TurnResult)=>void;steer?:EngineLike['steer'];
    constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'thread-'+ ++sequence;engines.push(this);}
    async start(){await beforeEngineStart?.();return this.threadId;}
    async request(method:string){return method==='skills/list'?{data:[{skills:[{name:'homer-archive-review',path:join(root,'empty-home/skills/homer-archive-review/SKILL.md'),enabled:true}]}]}:{};}
    async call(tool:string,args:unknown,callId='call-'+ ++sequence):Promise<any>{const result=await this.handle({threadId:this.threadId,turnId:this.turnId!,callId,tool,arguments:args});this.emit('toolResponse',callId);return result;}
    async turn(text:string,options?:{onStarted?:(turnId:string)=>void}){
      this.turnId='turn-'+ ++sequence;options?.onStarted?.(this.turnId);
      if(this.options.role==='worker'){
        this.input=text;
        return new Promise<TurnResult>(resolve=>{this.finish=resolve;});
      }
      inputs.push(text);return script?script(this,text):{status:'completed',text:'Synthetic reply'};
    }
    async interrupt(){this.finish?.({status:'interrupted',text:'',messages:[]});this.finish=undefined;return true;}
    async close(){await this.interrupt();return true;}
  }
  const config={runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexBin:'/usr/bin/false',codexHome:join(root,'empty-home'),nativeCodexHome:join(root,'empty-home'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:50};
  const create=()=>new Homer(config,async message=>{events.push(message);await sink?.(message);},(options,handle)=>new Peer(options,handle),adapters);
  let app=create();
  return {get app(){return app;},engines,events,inputs,setSink(value:NonNullable<typeof sink>){sink=value;},async restart(beforeStart?:(app:Homer)=>void){await app.close();app=create();beforeStart?.(app);await app.start();},setScript(value:NonNullable<typeof script>){script=value;},async close(){await app.close();rmSync(root,{recursive:true,force:true});}};
}
