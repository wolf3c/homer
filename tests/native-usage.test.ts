import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {nativeTokenUsage} from '../src/native-usage.js';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';

test('native usage exposes only finite nonnegative token counters, never raw payloads or estimated money',()=>{
 const usage={total:{totalTokens:120,inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningOutputTokens:10,raw:'must-not-expose'},last:{totalTokens:12,inputTokens:10,outputTokens:2},modelContextWindow:1000,token:'must-not-expose'};
 assert.deepEqual(nativeTokenUsage(usage),{total:{totalTokens:120,inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningOutputTokens:10},last:{totalTokens:12,inputTokens:10,outputTokens:2},modelContextWindow:1000});
 assert.equal(nativeTokenUsage(null),null);
 assert.equal(nativeTokenUsage({total:{totalTokens:-1,inputTokens:Infinity,outputTokens:'2'},last:{totalTokens:NaN}}),null);
 assert.deepEqual(nativeTokenUsage({total:{totalTokens:0,inputTokens:1.5},modelContextWindow:-1}),{total:{totalTokens:0}});
});

test('same Homer Web bridge reports persisted native usage without a second counter or billing claim',async()=>{
 const root=resolve('.codex/scratch/native-capabilities-implementation');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'usage-state-'));
 const config={workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'codex'),nativeCodexHome:join(dir,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};mkdirSync(config.workspace);mkdirSync(config.runtime);
 const usage={total:{totalTokens:32,inputTokens:30,outputTokens:2},last:{totalTokens:12},raw:'must-not-expose'};
 class Peer extends EventEmitter{threadId='synthetic-usage-thread';turnId='synthetic-usage-turn';resumable=true;async start(){return this.threadId;}async turn(_text:string,options?:any){options?.onStarted?.(this.turnId);this.emit('usage',usage);return {status:'completed',text:'合成用量回执',usage};}async interrupt(){return true;}async close(){return true;}}
 const make=()=>new Homer(config,async()=>{},()=>new Peer());let app=make();
 try{await app.start();assert.equal((await homerWebBridge(app).history!.state()).usage,null);await app.message('合成用量');const state=await homerWebBridge(app).history!.state();assert.deepEqual(state.usage,{total:{totalTokens:32,inputTokens:30,outputTokens:2},last:{totalTokens:12}});assert.ok(!JSON.stringify(state).includes('must-not-expose'));await app.close();app=make();await app.start();assert.deepEqual((await homerWebBridge(app).history!.state()).usage,state.usage);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('execution safe projection rejects malformed estimates and keeps guard-only snapshots',()=>{
 const execution={costStatus:'estimated',estimatedCostCny:0,inputTokens:1,cachedInputTokens:0,outputTokens:0,consecutiveCompactions:2,stopReason:'engine_compaction_loop',raw:'private'};
 assert.equal(nativeTokenUsage({execution})?.execution?.estimatedCostCny,0);
 for(const bad of [{inputTokens:1.5},{cachedInputTokens:2},{estimatedCostCny:Infinity},{costStatus:'unavailable'}]){
 const projected=nativeTokenUsage({execution:{...execution,...bad}})?.execution;
 assert.equal(projected?.costStatus,'unavailable');assert.equal(projected?.estimatedCostCny,null);
 }
 assert.ok(!JSON.stringify(nativeTokenUsage({execution})).includes('private'));
});
