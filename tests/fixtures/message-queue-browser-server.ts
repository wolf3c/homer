// Isolated real Homer/SQLite/Web bridge with a deterministic held engine.
// Never reads config, native HOME, credentials or a production listener.
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../../src/service.js';
import type {EngineLike,TurnResult} from '../../src/engine.js';
import {homerWebBridge} from '../../src/web-homer.js';
import {createWebServer} from '../../src/web-server.js';

export const queueUntil=async(check:()=>boolean)=>{const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw Error('synthetic_queue_timeout');await new Promise(done=>setTimeout(done,10));}};
export async function queueBrowserFixture(webDir:string,count=3,parent=resolve('.codex/scratch/message-queue-implementation')){
 mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'isolated-host-'));mkdirSync(join(dir,'runtime'));
 const turns:string[]=[];let release:((value:TurnResult)=>void)|undefined,closed=false;
 class Engine extends EventEmitter implements EngineLike{
  threadId='synthetic-queue-browser';turnId?:string;
  async start(){return this.threadId;}
  async turn(text:string,options?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='synthetic-turn-'+turns.length;options?.onStarted?.(this.turnId);turns.push(text);
   return new Promise(done=>{release=result=>{release=undefined;done(result);};});
  }
  async close(){closed=true;release?.({status:'interrupted',text:''});return true;}
  async interrupt(){release?.({status:'interrupted',text:'合成回复已停止'});return true;}
 }
 const app=new Homer({workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'empty-home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100},async()=>{},()=>new Engine());
 await app.start();app.submitMessage({requestId:'A',text:'正在核对第一份合成材料，后续消息依次处理。'});await queueUntil(()=>!!release);
 const refs=[];
 for(let n=0;n<10;n++){
  const ref=app.media.intent('B','web:'+app.store.meta('mainThread'),'file',`合成需求说明_第${n+1}份_待核对的完整文件名.txt`),lease=app.media.claim(ref)!;
  app.media.ready(ref,lease,Buffer.from('Synthetic queue attachment '+n),'text/plain');refs.push(ref);
 }
 if(count===3){
  app.submitMessage({requestId:'B',text:'整理需求说明，保留需要确认的事项。',attachments:refs});
  app.submitMessage({requestId:'C',text:'补充验收条件，核对负责人和交付时间。'});
  app.submitMessage({requestId:'D',text:'最后检查这个很长的中文说明，以及 https://example.invalid/'+ 'long-path-without-spaces'.repeat(16)});
 }else for(let n=0;n<count;n++)app.submitMessage({requestId:'q'+n,text:'合成排队消息 '+n});
 const bridge=homerWebBridge(app),changes:{action:string;input:unknown}[]=[],discards:unknown[]=[];
 let releaseMove:(()=>void)|undefined;
 const mode={loseNextMove:false,holdNextMove:false,loseNextCancel:false,loseNextEdit:false,hideOperations:false,legacy:false,offline:false};
 const move=bridge.queue!.move!;bridge.queue!.move=async input=>{changes.push({action:'move',input});if(mode.holdNextMove){mode.holdNextMove=false;await new Promise<void>(done=>{releaseMove=done;});}const value=await move(input);if(mode.loseNextMove){mode.loseNextMove=false;throw Error('synthetic_response_lost');}return value;};
 const edit=bridge.queue!.edit;bridge.queue!.edit=async input=>{changes.push({action:'edit',input});const result=await edit(input);if(mode.loseNextEdit){mode.loseNextEdit=false;throw Error('synthetic_edit_response_lost');}return result;};
 const cancel=bridge.queue!.cancel;bridge.queue!.cancel=async input=>{changes.push({action:'cancel',input});const result=await cancel(input);if(mode.loseNextCancel){mode.loseNextCancel=false;throw Error('synthetic_cancel_response_lost');}return result;};
 const receipts=bridge.history!.receipts;bridge.history!.receipts=async input=>{const value=await receipts(input);if(mode.legacy)return {acceptedRequestIds:value.acceptedRequestIds,statuses:value.statuses.map(({requestId,state})=>({requestId,state}))};return mode.hideOperations?{...value,operations:value.operations?.map(({result:_result,...item})=>({...item,committed:false}))}:value;};
 const state=bridge.history!.state;bridge.history!.state=async()=>{if(mode.offline)throw Error('synthetic_offline');const value=await state();if(!mode.legacy)return value;const {queueDispatch:_queueDispatch,...rest}=value;return {...rest,features:{...value.features,queueDispatch:undefined,queueSources:undefined}};};
 const discard=bridge.media!.discard!;bridge.media!.discard=async input=>{discards.push(input);return discard(input);};
 const server=await createWebServer({bridge,port:0,uiDirectory:resolve(webDir),logoPath:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
 return {app,server,dir,refs,turns,changes,discards,mode,closed:()=>closed,release(){release?.({status:'completed',text:'合成材料已核对，等待处理后续消息。'});},releaseMove(){releaseMove?.();releaseMove=undefined;},order:()=>app.inputs.dispatchPage(undefined,app.webReadEpoch,'all').items.filter(item=>item.state==='queued').map(item=>item.messageId),close:async(stage:((name:string)=>void)=()=>{})=>{releaseMove?.();stage('server');await server.close();stage('app');await app.close();stage('files');rmSync(dir,{recursive:true,force:true});}};
}
