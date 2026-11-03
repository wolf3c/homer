import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import type {EngineOptions,ToolCall} from '../src/engine.js';

const until=async(check:()=>boolean)=>{const deadline=Date.now()+5000;while(!check()){assert.ok(Date.now()<deadline,'synthetic skill approval wait');await new Promise(r=>setTimeout(r,5));}};
test('service main and Worker skill requests use real user cards and retain protected HOME boundaries across main resume',async()=>{
 const scratch=resolve('.codex/scratch/native-system-skills-implementation');mkdirSync(scratch,{recursive:true});
 const dir=mkdtempSync(join(scratch,'skill-svc-')),home=join(dir,'codex'),workspace=join(dir,'workspace'),runtime=join(dir,'runtime');
 mkdirSync(join(workspace,'materials'),{recursive:true});mkdirSync(runtime);writeFileSync(join(workspace,'materials/synthetic.md'),'Synthetic material.');
 const config={appData:dir,codexHome:home,nativeCodexHome:home,codexBin:'/usr/bin/false',workspace,runtime,model:'synthetic',requiresOpenaiAuth:false,timeoutMs:10000,mainTimeoutMs:10000,stopGraceMs:100};
 let serial=0;const outcomes:string[]=[],starts:EngineOptions[]=[];
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;
  constructor(readonly options:EngineOptions,readonly handler:(c:ToolCall)=>Promise<unknown>){super();starts.push(options);this.threadId=options.threadId??'synthetic-thread-'+ ++serial;}
  async start(){return this.threadId;}
  async close(){return true;}
  async interrupt(){return true;}
  async call(tool:string,args:unknown){const callId='call-'+ ++serial;const result=await this.handler({threadId:this.threadId,turnId:this.turnId,callId,tool,arguments:args});this.emit('toolResponse',callId);return result;}
  async approvals(){
   const role=this.options.nativeTools!;
   for(const target of [join(home,'skills/synthetic-package',role==='main'?'scripts/run.py':'agents/openai.yaml'),join(home,'config.toml')]){
    const result=await this.options.onInteraction!({method:'item/fileChange/requestApproval',threadId:this.threadId,turnId:this.turnId,requestId:++serial,itemId:'synthetic-file-'+serial,kind:'authorization',details:{operation:{changes:[{path:target,kind:{type:'add'},diff:'+synthetic'}]}}});
    outcomes.push(role+':'+result.status);
   }
  }
  async turn(text:string,o?:{onStarted?:(id:string)=>void}){
   this.turnId='synthetic-turn-'+ ++serial;o?.onStarted?.(this.turnId);
   if(this.options.nativeTools==='worker'){
    await this.approvals();await this.call('write_markdown',{filename:'synthetic.md',content:'# Synthetic result'});
   }else if(text==='synthetic skill request'){
    await this.approvals();await this.call('dispatch_work',{title:'Synthetic skill package',goal:'Synthetic authorized full package check',material:'synthetic.md'});
   }
   return {status:'completed',text:'Synthetic receipt.'};
  }
 }
 const factory=(o:EngineOptions,h:(c:ToolCall)=>Promise<unknown>)=>new Peer(o,h);
 let app=new Homer(config,async()=>{},factory);
 try{
  for(const mode of ['start','resume']){
   if(mode==='resume'){const thread=app.store.meta('mainThread');await app.close();app=new Homer(config,async()=>{},factory);await app.start();assert.equal(starts.at(-1)?.threadId,thread);}else await app.start();
   const before=outcomes.length;app.submitMessage({requestId:mode+'-user-task',text:'synthetic skill request'});
   for(let n=0;n<4;n++){
    await until(()=>app.interactions.list().some(i=>i.state==='pending_user'));
    const pending=app.interactions.inspect(app.interactions.list().find(i=>i.state==='pending_user')!.id);
    const bridge=homerWebBridge(app);
    if(pending.userQuestion!.includes(join(home,'config.toml'))){
     await assert.rejects(()=>bridge.respond(pending.id,{requestId:mode+'-blocked-'+n,text:'允许本次操作'}),/interaction_capability_denied/);
     assert.equal(app.interactions.inspect(pending.id).state,'pending_user');
     await bridge.respond(pending.id,{requestId:mode+'-deny-'+n,text:'拒绝本次操作'});
    }else{
     assert.throws(()=>app.interactions.respond(pending.id,{action:'approve',reason:'forged model'},{userMessageId:'forged'}),/main_native_user_decision_required/);
     await bridge.respond(pending.id,{requestId:mode+'-allow-'+n,text:'允许本次操作'});
    }
    await until(()=>outcomes.length>before+n);
   }
   await app.idle();assert.deepEqual(outcomes.slice(before),['main:approved','main:denied','worker:approved','worker:denied']);
  }
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
