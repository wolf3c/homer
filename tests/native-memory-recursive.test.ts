import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Memory} from '../src/memory.js';
import {NativeMemory} from '../src/native-memory.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {fixture,main,delegate,running,complete,accept} from './recursive-fixture.js';
for(const boundary of ['review','include','publish'] as const)test('native memory change preserves '+boundary+' and accepted task history',()=>{
 const f=fixture();try{
  new Memory(f.store);const home=join(f.dir,'native'),notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});
  const memory=new NativeMemory(f.store,home);
  f.tasks=new RecursiveTasks(f.store,f.files,{validateActor:a=>{if(a.runId)memory.validateRun(a.runId);},validateResult:id=>memory.validateRun(id),attemptCreated:(run,c)=>memory.bindSnapshot(run.id,c.parentRunId?memory.runSnapshot(c.parentRunId):memory.snapshot(''))});
  const child=delegate(f),actor=running(f,child.taskId),result=complete(f,actor,child.taskId);f.tasks.endSegment(actor.runId!,actor.epoch!,true,true);
  if(boundary!=='review')accept(f,child.taskId,result.resultId);
  const aggregate=()=>{const root=f.tasks.task(f.root.taskId);return f.tasks.complete(main,{operationId:'aggregate',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',payload:{synthetic:true},evidence:{facts:'Synthetic checked'},children:[{childTaskId:child.taskId,childVersion:1,disposition:'included',resultId:result.resultId,reason:'Synthetic'}]});};
  const parent=boundary==='publish'?aggregate():undefined;
  writeFileSync(join(notes,'synthetic-withdrawal.md'),'Synthetic withdrawal; old facts must not be used.');
  if(boundary==='review')accept(f,child.taskId,result.resultId);
  else if(boundary==='include')aggregate();
  else {const root=f.tasks.task(f.root.taskId);f.tasks.publish(main,{operationId:'publish',taskId:root.id,version:1,expectedTaskRevision:root.revision,resultId:parent!.resultId,text:'Synthetic',publishedFileResultId:null});}
  if(boundary!=='review')assert.equal(f.store.db.prepare('SELECT state FROM results WHERE id=?').get(result.resultId)!.state,'accepted');
  assert.equal(f.tasks.deliveries().length,boundary==='publish'?1:0);
 }finally{f.close();}
});
