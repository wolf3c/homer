import {test} from 'node:test';import assert from 'node:assert/strict';
import {mobileChannel,type MobileChannelPort} from '../src/mobile-channel.js';
const pair=()=>{
 let left!:(data:Uint8Array)=>void,right!:(data:Uint8Array)=>void;let closed=false;
 const a:MobileChannelPort={send:data=>queueMicrotask(()=>right(data)),buffered:()=>0,closed:()=>closed,close:()=>{closed=true;},receive:fn=>{left=fn;}};
 const b:MobileChannelPort={...a,send:data=>queueMicrotask(()=>left(data)),receive:fn=>{right=fn;}};
 return {a,b,closed:()=>closed};
};
test('ordered channel chunks large existing payloads and keeps packets separate',async()=>{
 const p=pair(),values:unknown[]=[],left=mobileChannel(p.a,()=>{}),right=mobileChannel(p.b,value=>values.push(value));
 await Promise.all([left.send({data:'x'.repeat(200000)}),left.send({data:'next'})]);
 assert.deepEqual(values,[{data:'x'.repeat(200000)},{data:'next'}]);assert.equal(p.closed(),false);left.close();right.close();
});
test('malformed/oversized frames close the connection before retaining an unbounded body',async()=>{
 const p=pair();mobileChannel(p.b,()=>assert.fail('must not deliver'));const frame=new Uint8Array(4);new DataView(frame.buffer).setUint32(0,32*1024*1024);p.a.send(frame);await new Promise(resolve=>setImmediate(resolve));assert.equal(p.closed(),true);
});

test('two legal 8 MiB file responses can share the ordered channel without disconnecting chat',async()=>{
 const p=pair(),values:any[]=[],left=mobileChannel(p.a,()=>{}),right=mobileChannel(p.b,value=>values.push(value));
 const data=Buffer.alloc(8*1024*1024,37).toString('base64');
 await Promise.all([left.send({id:'1',result:{data}}),left.send({id:'2',result:{data}})]);
 assert.equal(p.closed(),false);assert.deepEqual(values.map(value=>value.id),['1','2']);
 assert.ok(values.every(value=>value.result.data===data));
 await left.send({event:'state',value:{current:true}});assert.equal(values[2].value.current,true);left.close();right.close();
});
