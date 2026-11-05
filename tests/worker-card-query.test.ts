// Synthetic SQL-plan checks; no production history, accounts or model calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {WorkerCardEvents} from '../src/worker-card-events.js';

test('601 requested snapshots read in four bounded primary-key queries',()=>{
 const db=new DatabaseSync(':memory:'),events=new WorkerCardEvents(db);try{
  const input={eventKind:'delegated' as const,title:'合成核对',body:'仅测试批量读取。',bodySource:'description' as const,taskId:'task',version:1,runId:'run',sourceMessageId:null,operationKey:'op',observedAtMs:1};
  db.exec('BEGIN');for(let n=0;n<1000;n++)events.record('thread','node','item-'+n,{...input,eventKey:'event-'+n});db.exec('COMMIT');
  const queries:string[]=[],original=db.prepare.bind(db);db.prepare=(sql:string)=>{if(sql.startsWith('SELECT eventKey,snapshotJson'))queries.push(sql);return original(sql);};
  const wanted=Array.from({length:601},(_,n)=>'event-'+n),result=events.read(wanted);
  assert.equal(result.size,601);assert.deepEqual([...result.keys()].sort(),wanted.sort());assert.equal(queries.length,4);assert.ok(queries.every(sql=>(sql.match(/\?/g)??[]).length<=200));
  const plan=original('EXPLAIN QUERY PLAN '+queries[0]!).all(...Array.from({length:200},(_,n)=>'event-'+n)).map(row=>String(row.detail));assert.ok(plan.some(line=>line.includes('SEARCH worker_card_events')&&line.includes('eventKey=?')));
 }finally{db.close();}
});
