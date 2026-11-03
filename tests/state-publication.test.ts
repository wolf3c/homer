import test from 'node:test';
import assert from 'node:assert/strict';
import {StatePublication} from '../src/state-publication.js';

test('publication delivers a complete snapshot during invalidation, then the latest revision',async()=>{
 let builds=0,completed!:()=>void;const delivered:number[]=[],finished=new Promise<void>(resolve=>{completed=resolve;});
 const publication=new StatePublication(async()=>{const value=++builds;if(builds<5)publication.invalidate();return value;},value=>{delivered.push(value);if(value===5)completed();},()=>assert.fail('unexpected unavailable'),()=>true,5);
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  await publication.flush();
  assert.deepEqual(delivered,[1]);assert.equal(builds,1);
  await Promise.race([finished,new Promise<void>((_resolve,reject)=>{deadline=setTimeout(()=>reject(Error('test_publication_timeout')),10000);})]);
  assert.deepEqual(delivered,[1,2,3,4,5]);
 }finally{if(deadline)clearTimeout(deadline);publication.close();}
});

test('publication shares reads and discards an old epoch before returning',async()=>{
 let release!:(value:number)=>void,builds=0;
 const publication=new StatePublication(()=>++builds===1?new Promise<number>(resolve=>{release=resolve;}):Promise.resolve(2),()=>{},()=>{},()=>false);
 try{
  const first=publication.read();assert.equal(publication.read(),first);
  publication.reset();release(1);
  assert.equal(await first,2);assert.equal(builds,2);
 }finally{publication.close();}
});

test('publication rejects reads after close, including a build already in flight',async()=>{
 let release!:(value:number)=>void;
 const publication=new StatePublication(()=>new Promise<number>(resolve=>{release=resolve;}),()=>assert.fail('closed delivery'),()=>{},()=>false);
 const pending=publication.read();publication.close();release(1);
 await assert.rejects(pending,/web_server_closed/);
 await assert.rejects(publication.read(),/web_server_closed/);
});
