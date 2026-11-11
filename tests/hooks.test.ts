import test from 'node:test';
import assert from 'node:assert/strict';
import {createHooks} from '../src/hooks.js';

type Events={committed:{id:number};changed:{id:number}};
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('registration receives only its event, asynchronously, with isolated instances',async()=>{
 const errors:string[]=[],seen:number[]=[],otherSeen:number[]=[];
 const hooks=createHooks<Events>(['committed','changed'],()=>{errors.push('failure');});
 const other=createHooks<Events>(['committed','changed'],()=>{});
 hooks.listener.on('committed',({id})=>{seen.push(id);});
 other.listener.on('committed',({id})=>{otherSeen.push(id);});
 hooks.emit('changed',{id:1});
 hooks.emit('committed',{id:2});
 assert.deepEqual(seen,[]);
 await tick();
 assert.deepEqual(seen,[2]);assert.deepEqual(otherSeen,[]);assert.deepEqual(errors,[]);
 hooks.close();other.close();
});

test('unsubscribe clears scheduled and pending work and is idempotent',async()=>{
 const hooks=createHooks<Events>(['committed'],()=>{});
 const seen:number[]=[];
 const cancel=hooks.listener.on('committed',({id})=>{seen.push(id);});
 hooks.emit('committed',{id:1});cancel();cancel();await tick();assert.equal(seen.length,0);
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const off=hooks.listener.on('committed',async({id})=>{seen.push(id);await gate;});
 hooks.emit('committed',{id:2});await tick();
 hooks.emit('committed',{id:3});off();release();await tick();await tick();
 assert.deepEqual(seen,[2]);
 hooks.close();
});

test('shutdown discards pending work without waiting for an in-flight callback',async()=>{
 const hooks=createHooks<Events>(['committed'],()=>{throw Error('diagnostic failure');});
 const seen:number[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 hooks.listener.on('committed',async({id})=>{seen.push(id);await gate;throw Error('after close');});
 hooks.emit('committed',{id:1});await tick();
 hooks.emit('committed',{id:2});hooks.close();hooks.close();
 hooks.emit('committed',{id:3});release();await tick();await tick();
 assert.deepEqual(seen,[1]);assert.throws(()=>hooks.listener.on('committed',()=>{}),/hook_unavailable/);
});

test('failed callbacks release their slot even if diagnostics throw',async()=>{
 const seen:number[]=[];
 const hooks=createHooks<Events>(['committed'],()=>{throw Error('private diagnostic');});
 hooks.listener.on('committed',({id})=>{seen.push(id);throw Error('private listener');});
 hooks.emit('committed',{id:1});await tick();await tick();
 hooks.emit('committed',{id:2});await tick();assert.deepEqual(seen,[1,2]);hooks.close();
});

test('unsubscribing and re-registering the same handler keeps the new registration independent',async()=>{
 const hooks=createHooks<Events>(['committed'],()=>{});
 const seen:number[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const handler=async({id}:{id:number})=>{seen.push(id);await gate;};
 const old=hooks.listener.on('committed',handler);
 hooks.emit('committed',{id:1});await tick();
 hooks.emit('committed',{id:2});old();
 const current=hooks.listener.on('committed',handler);
 hooks.emit('committed',{id:3});await tick();
 hooks.emit('committed',{id:4});current();release();await tick();await tick();
 assert.deepEqual(seen,[1,3]);hooks.close();
});
