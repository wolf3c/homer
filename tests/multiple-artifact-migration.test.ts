// Schema rehearsal uses an isolated synthetic database, never a live snapshot.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,delegate,running,main,accept} from './recursive-fixture.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {Store} from '../src/store.js';
function oldDatabase(){
 const f=fixture(),child=delegate(f,'legacy',undefined,undefined,'markdown'),actor=running(f,child.taskId);f.tasks.markMaterialRead(actor);
 const file=f.tasks.writeMarkdown(actor,{operationId:'file',filename:'old.md',content:'# Historical bytes'}),t=f.tasks.task(child.taskId);
 f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true)!;f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true);accept(f,t.id,file.resultId);
 const root=f.tasks.task(f.root.taskId),result=({operationId:'root-seal',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',evidence:{facts:true},children:[{childTaskId:t.id,childVersion:1,disposition:'included',resultId:file.resultId,reason:'old accepted'}],resultId:null,text:JSON.stringify({summary:'old'}),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
 const delivery=f.tasks.publish(main,{...result,operationId:'publish',taskId:root.id,version:1,expectedTaskRevision:f.tasks.task(root.id).revision,resultId:result.resultId,publishedFileResultId:file.resultId,text:'old delivery'});f.tasks.markDelivery(delivery.deliveryId,'submitting');f.tasks.markDelivery(delivery.deliveryId,'uncertain');
 // Reconstruct exactly the old column/index layout with single-file facts.
 f.store.db.exec(`DROP INDEX one_completed_result_per_run;DROP INDEX one_accepted_result_per_version;DROP INDEX result_completion;DROP INDEX results_run;
 ALTER TABLE results DROP COLUMN completionResultId;ALTER TABLE deliveries DROP COLUMN publishedFileResultIdsJson;
 CREATE UNIQUE INDEX one_result_per_run ON results(runId) WHERE runId IS NOT NULL;
 CREATE UNIQUE INDEX one_accepted_result_per_version ON results(taskId,version) WHERE state='accepted';`);
 f.store.setMeta('recursiveSchemaVersion','2');
 return {...f,actor,file,delivery};
}
function capture(store:Store){return Object.fromEntries((store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,store.db.prepare('SELECT * FROM "'+name+'"').all()]));}

test('unsupported historical layout is refused without rewriting columns, indexes or facts',()=>{
 const f=oldDatabase();try{
  const before=capture(f.store),schema=f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  assert.throws(()=>new RecursiveTasks(f.store,f.files).migrate(),/recursive_schema_unsupported/);
  assert.deepEqual(capture(f.store),before);assert.deepEqual(f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),schema);
 }finally{f.close();}
});
