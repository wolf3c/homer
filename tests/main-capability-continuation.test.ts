import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineLike} from '../src/engine.js';
for(const scenario of ['adopt','stop-refresh','new-user','busy','refresh-failed','bounded','denied','unknown','no-refresh','stop-boundary','stale-delta','stale-owner','pending-limit','logout-refresh','empty-install-result'] as const){
 test('same request capability continuation: '+scenario,async()=>{
  mkdirSync('.codex/scratch',{recursive:true});const root=mkdtempSync(resolve('.codex/scratch/main-adopt-'));
  const config={appData:root,codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:3000,mainTimeoutMs:3000,stopGraceMs:100};
  for(const p of [config.codexHome,config.runtime,config.workspace])mkdirSync(p);
  let app:Homer,turns=0,refreshes=0,writes=0,closes=0,started=false;const order:string[]=[],events:any[]=[],owners:any[]=[],refreshForces:boolean[]=[];
  class Peer extends EventEmitter implements EngineLike{
   threadId='synthetic-main';turnId='';resumable=true;
   async start(){return this.threadId;}async close(){closes++;return true;}async interrupt(){return true;}
   async refreshCapabilities(force=false){refreshForces.push(force);refreshes++;if(!started)return{pending:false};
    if(scenario==='refresh-failed')throw Error('synthetic_reload_failed');
    if(scenario==='stop-refresh')await app.stopMain(app['mainContext']!.messageId!);
    if(scenario==='pending-limit'||scenario==='busy'&&refreshes<4)return{pending:true};return{pending:false};
   }
   async turn(text:string,options?:any){turns++;this.turnId='turn-'+turns;options?.onStarted?.(this.turnId);started=true;
    const context=app['mainContext']!;owners.push({...context.generation});order.push(context.requestId!);
    if(context.requestId==='original'&&(turns===1||scenario==='bounded')){
     if(scenario==='denied'||scenario==='unknown')return{status:'completed',text:scenario};
     await app.manageCapabilities({action:'skill_save',name:'fixture-'+(++writes),description:'Synthetic fixture.',body:'Only a fixture.',expectedHash:null},'agent');
     if(['new-user'].includes(scenario)&&turns===1)app.submitMessage({requestId:'new-user',text:'A newer user task.'});
     if(scenario==='stop-boundary')await app.stopMain(context.messageId!);
    }else if(context.requestId==='original'){
     if(scenario==='stale-owner')assert.throws(()=>app.inputs.continued(context.queuedInput!.messageId,context.queuedInput!.revision+1,context.generation!.generationId,'turn-1','forged'),/queue_revision_conflict/);
     if(scenario==='stale-delta'){this.emit('textDelta',{threadId:this.threadId,turnId:'turn-1',delta:'STALE_DELTA'});this.emit('textDelta',{threadId:this.threadId,turnId:this.turnId,delta:'CURRENT_DELTA'});}
     assert.match(text,/同一用户请求/);assert.doesNotMatch(text,/A newer user task/);}
    if(scenario==='empty-install-result'&&turns===1)return{status:'completed',text:''};
    return{status:'completed',text:context.requestId==='new-user'?'New task result.':'Original task result '+turns};
   }
  }
  const peer=new Peer();if(scenario==='no-refresh')Object.defineProperty(peer,'refreshCapabilities',{value:undefined});
  app=new Homer(config,async e=>{events.push(e);},()=>peer);
  app['nativeRpc']=async(method:string)=>method==='config/read'?{config:{},layers:[{name:{type:'user',file:join(config.codexHome,'config.toml')},version:'1',config:{}}]}:method==='skills/list'?{data:[]}:{};
  try{
   await app.start();if(scenario==='logout-refresh')await app.manageCapabilities({action:'account_logout',approve:true});const hash=app.store.meta('mainToolsHash');app.submitMessage({requestId:'original',text:'A user task needing a local Skill.'});await app.idle();
   assert.equal(app.store.meta('mainThread'),'synthetic-main');assert.equal(app.store.meta('mainToolsHash'),hash);
   const terminal=events.filter(e=>e.type==='main_terminal'&&e.sourceRequestId==='original');assert.equal(terminal.length,1);
   assert.equal(events.filter(e=>e.type==='reply'&&e.requestId==='original').length,1);
   assert.equal(app.inputs.list().filter(i=>i.input.requestId==='original').length,1);
   assert.equal(app['mainBroken'],false);assert.equal(closes,0);
   if(['stop-refresh','stop-boundary'].includes(scenario)){assert.equal(turns,1);assert.equal(terminal[0].status,'interrupted');}
   else if(['denied','unknown','no-refresh','refresh-failed','pending-limit'].includes(scenario)){assert.equal(turns,1);if(scenario==='refresh-failed'||scenario==='no-refresh'||scenario==='pending-limit')assert.match(terminal[0].text,/待采用/);}
   else if(scenario==='bounded'){assert.equal(turns,3);assert.equal(writes,3);assert.match(terminal[0].text,/续接上限/);}
   else{assert.equal(turns,scenario==='new-user'?3:2);assert.equal(writes,1);assert.equal(app['nativeDirty'],false);assert.equal(refreshForces.at(-1),false,'Skill discovery must not force credential/registry reconnect');if(scenario==='logout-refresh')assert.equal(refreshForces[0],true,'logout must still invalidate the old authenticated child');
    const original=owners.filter(x=>x.sourceRequestId==='original');assert.equal(original.length,2);assert.equal(original[0].generationId,original[1].generationId);assert.notEqual(original[0].turnId,original[1].turnId);
    if(scenario==='new-user')assert.deepEqual(order,['original','original','new-user']);if(scenario==='busy')assert.ok(refreshes>=4);
    if(scenario==='stale-delta'){assert.ok(!events.some(e=>e.type==='delta'&&e.text==='STALE_DELTA'));assert.ok(events.some(e=>e.type==='delta'&&e.text==='CURRENT_DELTA'));}
   }
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
 });
}
