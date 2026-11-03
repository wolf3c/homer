import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MediaWorkQueue} from '../src/media-work.js';
test('ILINK-VIDEO-01 heavy media work is serial, queued cancellation preserves FIFO and failure releases the slot',async()=>{
 const queue=new MediaWorkQueue(1,2),order:string[]=[];let release!:()=>void;
 const first=queue.run(async()=>{order.push('first');await new Promise<void>(resolve=>release=resolve);throw Error('fixture');});
 const cancel=new AbortController(),second=queue.run(async()=>{order.push('cancelled');},cancel.signal);
 const cancelled=assert.rejects(second,/media_decode_cancelled/);
 const third=queue.run(async()=>{order.push('third');return 3;});
 await assert.rejects(queue.run(async()=>{}),/media_decode_busy/);
 cancel.abort();await cancelled;assert.deepEqual(order,['first']);release();
 await assert.rejects(first,/fixture/);assert.equal(await third,3);assert.deepEqual(order,['first','third']);
 assert.equal(await queue.run(async()=>4),4);
});
test('ILINK-VIDEO-02 pre-cancelled media never enters the work callback',async()=>{
 const queue=new MediaWorkQueue(1,2);let started=false;
 await assert.rejects(queue.run(async()=>{started=true;},AbortSignal.abort()),/media_decode_cancelled/);assert.equal(started,false);
});
