import test from 'node:test';
import assert from 'node:assert/strict';
import { StatePublication } from '../src/state-publication.js';
import { CommittedDatabase } from '../src/committed-database.js';
import { ReceptionTimings } from '../src/reception-timings.js';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('publication: no clients/no work, shared snapshot then latest update, idle connections do not rebuild',{timeout:3000},async()=>{
 let clients=false,calls=0,value=0;const states:number[]=[],gates:ReturnType<typeof deferred<number>>[]=[];
 const second=deferred<void>(),latest=deferred<void>();let deadline:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('publication_test_timeout')),2500);});
 const publisher=new StatePublication(async()=>{calls++;const gate=deferred<number>();gates.push(gate);if(calls===2)second.resolve();return gate.promise;},state=>{states.push(state);if(state===1)latest.resolve();},()=>assert.fail('unexpected failure'),()=>clients,5);
 try{
  for(let i=0;i<20;i++)publisher.invalidate();await sleep(15);assert.equal(calls,0);
  clients=true;const first=publisher.connect();await turn();assert.equal(calls,1);
  const get1=publisher.read(),get2=publisher.read();assert.equal(get1,get2);
  publisher.invalidate();value++;gates[0]!.resolve(0);await first;
  assert.equal(await get1,0);assert.deepEqual(states,[0]);
  await Promise.race([second.promise,timeout]);assert.equal(calls,2);gates[1]!.resolve(value);await Promise.race([latest.promise,timeout]);assert.deepEqual(states,[0,1]);
  await sleep(10);assert.equal(calls,2);const stable=calls;await sleep(25);assert.equal(calls,stable);
 }finally{clearTimeout(deadline);publisher.close();}
});
test('publication: failure retries only unpublished work; reconnect and reset cannot deliver old generation',async()=>{
 let calls=0,failures=0,clients=true;const states:string[]=[];const first=deferred<string>();
 const publisher=new StatePublication(async()=>{calls++;if(calls===1)return first.promise;if(calls===2)throw Error('synthetic_failure');return 'new';},value=>states.push(value),()=>failures++,()=>clients,5);
 try{
  const started=publisher.connect();publisher.reset();first.resolve('old');await started;
  assert.ok(!states.includes('old'));assert.equal(failures,1);
  await sleep(550);assert.ok(states.includes('new'));const stable=calls;await sleep(25);assert.equal(calls,stable);
  clients=false;publisher.invalidate();await sleep(15);assert.equal(calls,stable);
  clients=true;await publisher.connect();assert.equal(states.at(-1),'new');
 }finally{publisher.close();}
});
test('publication: change from delivery callback and multiple clients cannot lose final update',async()=>{
 let value=1,calls=0;const states:number[]=[];
 const publisher=new StatePublication(async()=>{calls++;return value;},state=>{states.push(state);if(state===1){value=2;publisher.invalidate();}},()=>{},()=>true,5);
 try{await Promise.all([publisher.connect(),publisher.connect(),publisher.flush()]);await sleep(30);assert.deepEqual(states,[1,2]);assert.equal(calls,2);}finally{publisher.close();}
});
test('committed owner: writes, nested savepoint release/rollback, failed CAS, rollback and diagnostic/read isolation',async()=>{
 const db=new CommittedDatabase(':memory:');db.exec('CREATE TABLE facts(id TEXT PRIMARY KEY,value TEXT);CREATE TABLE events(type TEXT)');const changes:string[][]=[];db.onChange(tables=>changes.push([...tables].sort()));
 try{
  db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO facts VALUES(?,?)').run('one','Synthetic');await turn();assert.equal(changes.length,0);db.exec('ROLLBACK');await turn();assert.equal(changes.length,0);
  db.exec('BEGIN IMMEDIATE');db.exec('SAVEPOINT nested');db.prepare('INSERT INTO facts VALUES(?,?)').run('one','Synthetic');db.exec('RELEASE nested');await turn();assert.equal(changes.length,0);db.exec('COMMIT');await turn();assert.deepEqual(changes,[['facts']]);
  db.exec('BEGIN');db.exec('SAVEPOINT rolled');db.prepare('UPDATE facts SET value=?').run('Synthetic rejected');db.exec('ROLLBACK TO rolled');db.exec('RELEASE rolled');db.exec('COMMIT');await turn();assert.equal(changes.length,1);
  db.prepare('UPDATE facts SET value=? WHERE id=?').run('Synthetic zero','missing');db.prepare('INSERT INTO events VALUES(?)').run('synthetic');db.prepare('SELECT * FROM facts').all();await turn();assert.equal(changes.length,1);
  db.exec('SAVEPOINT outer');db.prepare('INSERT INTO facts VALUES(?,?)').run('two','Synthetic');db.exec('SAVEPOINT inner');db.prepare('DELETE FROM facts WHERE id=?').run('one');db.exec('ROLLBACK TO inner');db.exec('RELEASE outer');await turn();assert.equal(changes.length,2);assert.equal(db.prepare('SELECT count(*) n FROM facts').get()!.n,2);
 }finally{db.close();}
});
test('timings: strict allowlist, bounded retention, copied results, separate internal rounds',()=>{
 const timings=new ReceptionTimings();try{for(let i=0;i<600;i++)timings.mark('native_start',{processId:'node-'+i,kind:'internal',messageId:undefined,...({text:'SECRET',toolArguments:'SECRET'} as {})},'invalid SECRET');const report=timings.read();assert.equal(report.records.length,512);assert.ok(!JSON.stringify(report).includes('SECRET'));assert.ok(report.records.every(row=>row.kind==='internal'&&!row.messageId));report.records[0]!.status='tampered';assert.notEqual(timings.read().records[0]!.status,'tampered');}finally{timings.close();}
});
