// Unsupported historical databases are refused; no compatibility conversion remains.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,openWorker,running,main,complete} from './recursive-fixture.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import type {Store} from '../src/store.js';
function capture(store:Store){return Object.fromEntries((store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(({name})=>[name,store.db.prepare('SELECT * FROM "'+name+'"').all()]));}

test('unsupported historical layout is refused without rewriting columns, indexes or facts',()=>{
 const f=fixture();try{
  const opened=openWorker(f),actor=running(f,opened.runId),written=f.tasks.writeMarkdown(actor,{operationId:'file',filename:'old.md',content:'# Historical bytes'});
  complete(f,actor);
  const accepted=f.tasks.adoptResult(main,{operationId:'adopt',taskId:f.task.taskId,version:1,runId:opened.runId,filePath:written.path});
  const delivery=f.tasks.publish(main,{operationId:'publish',taskId:f.task.taskId,version:1,resultIds:[accepted.resultId],text:'Historical delivery'});
  f.tasks.markDelivery(delivery.deliveryId,'submitting');f.tasks.markDelivery(delivery.deliveryId,'uncertain');
  f.store.db.exec("ALTER TABLE deliveries RENAME COLUMN resultIdsJson TO publishedFileResultId;CREATE UNIQUE INDEX one_result_per_run ON results(runId) WHERE runId IS NOT NULL;");
  f.store.setMeta('recursiveSchemaVersion','2');
  const before=capture(f.store),schema=f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  assert.throws(()=>new RecursiveTasks(f.store,f.files).migrate(),/recursive_schema_unsupported/);
  assert.deepEqual(capture(f.store),before);assert.deepEqual(f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),schema);
 }finally{f.close();}
});
