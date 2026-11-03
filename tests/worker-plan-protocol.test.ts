import {test} from 'node:test';import assert from 'node:assert/strict';import {CodexEngine} from '../src/engine.js';import type {Config} from '../src/config.js';
test('plan notifications are emitted only for the active exact native thread and turn',async()=>{
 const engine=new CodexEngine({} as Config,{cwd:'.',readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));
 const transport=engine as unknown as {threadId:string;turnId:string;active:object|undefined;receive(line:string):Promise<void>};
 transport.threadId='t';transport.turnId='u';transport.active={};const events:unknown[]=[];engine.on('publicPlan',e=>events.push(e));
 const notification=(threadId:string,turnId:string)=>JSON.stringify({method:'turn/plan/updated',params:{threadId,turnId,plan:[{step:'核对资料',status:'inProgress'}]}});
 await transport.receive(notification('wrong','u'));await transport.receive(notification('t','old'));assert.equal(events.length,0);
 await transport.receive(notification('t','u'));assert.equal(events.length,1);transport.active=undefined;await transport.receive(notification('t','u'));assert.equal(events.length,1);
});
