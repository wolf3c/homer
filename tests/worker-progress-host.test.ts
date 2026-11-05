// Actual Homer execution owner, exclusively injected synthetic engines.
import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import type {TurnResult} from '../src/engine.js';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';import {homerWebBridge} from '../src/web-homer.js';
const until=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('synthetic_progress_timeout');await new Promise(r=>setTimeout(r,5));}};
test('real host captures only current public Worker progress and safely ignores post-close events',async()=>{
 const f=syntheticHost();let workerEvents:EventEmitter|undefined,rootId='',workerThread='',finishWorker:((value:TurnResult)=>void)|undefined;
 try{
  const factory=f.app['factory'];assert.ok(factory);
  f.app['factory']=(options,handler)=>{const engine=factory(options,handler);if(options.role==='worker'){
   workerEvents=engine as unknown as EventEmitter;
   engine.turn=async(_text,turn)=>{workerThread=engine.threadId!;engine.turnId='progress-worker-turn';turn?.onStarted?.(engine.turnId);
    const identity={threadId:engine.threadId,turnId:engine.turnId};
    workerEvents!.emit('publicPlan',{...identity,plan:[{step:'核对合成资料',status:'inProgress'}]});
    workerEvents!.emit('agentMessage',{...identity,itemId:'private',phase:'analysis',completed:true,text:'MUST_NOT_BE_PUBLIC'});
    workerEvents!.emit('nativeProcess',{...identity,itemId:'safe-tool',category:'readFiles',status:'completed',completed:true});
    workerEvents!.emit('agentMessage',{...identity,itemId:'public',phase:'commentary',completed:true,text:'公开合成进展'});
    return new Promise<TurnResult>(resolve=>{finishWorker=resolve;(engine as unknown as {pending:(value:TurnResult)=>void}).pending=resolve;});
   };
  }return engine;};
  await f.app.start();const main=f.engines[0]!;main.turn=async(text,options)=>{if(text!=='synthetic:public-progress')return {status:'completed',text:''};main.turnId='progress-main-turn';options?.onStarted?.(main.turnId);const root=await main.createTask('合成公开进展');rootId=root.taskId;await main.openWorker(rootId,'合成公开进展');return {status:'completed',text:'合成工作已交办'};};
  await f.app.message('synthetic:public-progress','progress-source');await until(()=>!!workerEvents&&f.app.workerProgress.revision>=3);
  const value=await homerWebBridge(f.app).taskOverview!.progress!(rootId);assert.equal(value.workers.length,1);assert.equal(value.workers[0]?.plan?.[0]?.step,'核对合成资料');assert.equal(value.workers[0]?.output?.text,'公开合成进展');assert.ok(!JSON.stringify(value).includes('MUST_NOT_BE_PUBLIC'));
  workerEvents!.emit('agentMessage',{threadId:workerThread,turnId:'old-turn',itemId:'old',phase:'commentary',completed:true,text:'OLD_TURN'});
  assert.equal((await homerWebBridge(f.app).taskOverview!.progress!(rootId)).workers[0]?.output?.text,'公开合成进展');
 }finally{finishWorker?.({status:'completed',text:'Synthetic final'});await f.close();}
 assert.doesNotThrow(()=>workerEvents?.emit('publicPlan',{threadId:workerThread,turnId:'progress-worker-turn',plan:[{step:'late',status:'pending'}]}));
});
