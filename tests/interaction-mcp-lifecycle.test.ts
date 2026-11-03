import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionFixture} from './interaction-lifecycle-fixture.js';

test('MCP waits for a valid business result beyond the connection timeout',{timeout:25000},async()=>{
 let calls=0;
 const f=await interactionFixture(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,16000));return {state:'completed'};});
 try{const result=await f.call('work_inspect');assert.equal(result.isError,false);assert.equal(JSON.parse(result.content[0].text).state,'completed');assert.equal(calls,1);}finally{await f.close();}
});

test('MCP lost business receipt is unconfirmed, without retrying or claiming cancellation',async()=>{
 let entered!:()=>void,release!:()=>void,calls=0;
 const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const f=await interactionFixture(async()=>{calls++;entered();await gate;return {state:'completed'};});
 try{const response=f.call('work_inspect');await started;await f.server.close();assert.equal((await response).content[0].text,'interaction_result_unconfirmed');assert.equal(calls,1);}finally{release();await f.close();}
});

test('MCP distinguishes failure before connecting from an unknown business result',async()=>{
 const f=await interactionFixture(async()=>assert.fail('must not dispatch'),true);
 try{assert.equal((await f.call('work_inspect')).content[0].text,'interaction_host_unavailable');}finally{await f.close();}
});
