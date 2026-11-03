import {test} from 'node:test';import assert from 'node:assert/strict';
import {CodexEngine} from '../src/engine.js';import type {Config} from '../src/config.js';
const config:Config={workspace:process.cwd(),runtime:process.cwd()+'/.codex/scratch/limits',codexHome:process.cwd()+'/.codex/scratch/limits/home',codexBin:process.execPath,model:'deepseek-flash',baseUrl:'https://example.test/v1',requiresOpenaiAuth:false,stopGraceMs:100};
function peer(extra:Partial<Config>={}){const engine=new CodexEngine({...config,...extra},{cwd:process.cwd(),readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));const sent:any[]=[];engine['send']=(m:any)=>{sent.push(m);};engine.threadId='thread';const receive=(m:any)=>engine['receive'](JSON.stringify(m));return {engine,sent,receive,event:(method:string,params:any)=>receive({method,params:{threadId:'thread',turnId:'turn',...params}})};}
async function begin(p:ReturnType<typeof peer>){const work=p.engine.turn('synthetic');await p.receive({id:p.sent[0].id,result:{turn:{id:'turn'}}});await Promise.resolve();return {work};}
test('implicit DeepSeek guard without native tools interrupts once, ACK stays pending, terminal retains text',async()=>{const p=peer();let done=false;const {work}=await begin(p);void work.then(()=>{done=true});const compact=(id:string)=>p.event('item/completed',{item:{type:'contextCompaction',id}});await compact('1');await compact('1');await compact('2');assert.equal(p.sent.length,1);await p.event('item/completed',{threadId:'stale',item:{type:'contextCompaction',id:'wrong'}});await compact('3');await compact('4');assert.equal(p.sent.length,2);assert.equal(p.sent[1].method,'turn/interrupt');await p.receive({id:p.sent[1].id,result:{}});assert.equal(done,false);await assert.rejects(p.engine.turn('again'),/engine_turn_busy/);await p.event('item/completed',{item:{type:'agentMessage',id:'text',text:'partial'}});await p.event('turn/completed',{turn:{id:'turn',status:'interrupted'}});const result=await work;assert.equal(result.errorCode,'engine_compaction_loop');assert.equal(result.text,'partial');assert.equal((result.usage as any).execution.stopReason,'engine_compaction_loop');await p.engine.close();});
test('cost limit uses observed usage and generic models have no implicit loop guard',async()=>{const pricing={inputCnyPerMillion:2,cachedInputCnyPerMillion:0,outputCnyPerMillion:3};const p=peer({model:'other',executionLimits:{maxCostCny:0.001,pricing}});const {work}=await begin(p);const frame={total:{inputTokens:1000,cachedInputTokens:0,outputTokens:0}};await p.event('thread/tokenUsage/updated',{tokenUsage:frame});await p.event('thread/tokenUsage/updated',{tokenUsage:frame});assert.equal(p.sent.length,2);await p.event('turn/completed',{turn:{id:'turn',status:'interrupted'}});assert.equal((await work).errorCode,'engine_cost_limit_reached');await p.engine.close();});
test('direct invalid config rejected before any turn',()=>assert.throws(()=>peer({executionLimits:{maxCostCny:1}}),/invalid_execution_limits/));
test('new turn resets execution projection, generic loop disabled, resumed baseline excludes history',async()=>{
 const p=peer({model:'other',executionLimits:{pricing:{inputCnyPerMillion:2,cachedInputCnyPerMillion:0,outputCnyPerMillion:3}}});p.engine.resumable=true;const usage:any[]=[];p.engine.on('usage',u=>usage.push(u));const {work}=await begin(p);assert.equal(usage[0].execution.estimatedCostCny,null);
 await p.event('thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:1100,cachedInputTokens:0,outputTokens:10},last:{inputTokens:100,cachedInputTokens:0,outputTokens:10}}});assert.equal(usage.at(-1).execution.estimatedCostCny,0.00023);
 for(let i=0;i<5;i++)await p.event('item/completed',{item:{id:String(i),type:'contextCompaction'}});assert.equal(p.sent.length,1);
 await p.event('turn/completed',{turn:{id:'turn',status:'completed'}});await work;await p.engine.close();
});
test('guard preserves delta-only partial text and late interrupt ACK cannot affect next turn',async()=>{
 const p=peer({executionLimits:{maxConsecutiveCompactions:2}});const {work}=await begin(p);
 await p.event('item/agentMessage/delta',{itemId:'partial',delta:'unfinished'});
 for(const id of ['a','b'])await p.event('item/completed',{item:{type:'contextCompaction',id}});
 await p.event('turn/completed',{turn:{id:'turn',status:'interrupted'}});assert.equal((await work).text,'unfinished');
 const next=p.engine.turn('next');const start=p.sent.findLast(m=>m.method==='turn/start');await p.receive({id:start.id,result:{turn:{id:'next'}}});await p.receive({id:p.sent[1].id,result:{}});
 await p.event('turn/completed',{turn:{id:'next',status:'completed'}});assert.equal((await next).errorCode,undefined);await p.engine.close();
});
test('novel successful native output resets but failed and duplicate completed items do not',async()=>{
 const p=peer();const {work}=await begin(p);
 const compact=(id:string)=>p.event('item/completed',{item:{type:'contextCompaction',id}});
 const command=(id:string,output:string,status='completed')=>p.event('item/completed',{item:{type:'commandExecution',id,status,exitCode:status==='completed'?0:1,aggregatedOutput:output}});
 await command('read','a');await compact('a');await command('read2','a');await command('fail','b','failed');await compact('b');assert.equal(p.sent.length,1);
 await command('new','b');await compact('c');await compact('d');assert.equal(p.sent.length,1);await command('new','changed duplicate');await compact('e');assert.equal(p.sent.length,2);
 await p.event('turn/completed',{turn:{id:'turn',status:'interrupted'}});await work;await p.engine.close();
});
test('late dynamic handler completion cannot reset or publish into another turn',async()=>{
 const p=peer({executionLimits:{maxConsecutiveCompactions:2}});let release!:(v:unknown)=>void;
 (p.engine as any).handleTool=()=>new Promise(resolve=>{release=resolve;});
 const {work}=await begin(p);const dynamic=p.receive({id:500,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'old',tool:'synthetic',arguments:{}}});await Promise.resolve();
 await p.event('turn/completed',{turn:{id:'turn',status:'completed'}});await work;
 const next=p.engine.turn('next');const start=p.sent.findLast(m=>m.method==='turn/start');await p.receive({id:start.id,result:{turn:{id:'next'}}});
 await p.event('item/completed',{turnId:'next',item:{type:'contextCompaction',id:'one'}});release({status:'completed',text:'new evidence from old turn'});await dynamic;
 await p.event('item/completed',{turnId:'next',item:{type:'contextCompaction',id:'two'}});assert.equal(p.sent.filter(m=>m.method==='turn/interrupt').length,1);
 await p.event('turn/completed',{turn:{id:'next',status:'interrupted'}});assert.equal((await next).errorCode,'engine_compaction_loop');await p.engine.close();
});
test('ordinary native model preserves exact usage notifications without unsolicited execution projection',async()=>{
 const p=peer({model:'other'}),updates:any[]=[];p.engine.on('usage',u=>updates.push(u));const {work}=await begin(p);assert.equal(updates.length,0);
 const usage={total:{inputTokens:1,cachedInputTokens:0,outputTokens:2}};await p.event('thread/tokenUsage/updated',{tokenUsage:usage});assert.deepEqual(updates,[usage]);
 for(let i=0;i<4;i++)await p.event('item/completed',{item:{type:'contextCompaction',id:String(i)}});assert.equal(p.sent.length,1);assert.equal(updates.length,1);
 await p.event('item/completed',{item:{type:'commandExecution',id:'large-read',status:'completed',exitCode:0,aggregatedOutput:'x'.repeat(262144)}});
 await p.receive({id:501,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'ordinary',tool:'synthetic',arguments:{}}});
 assert.equal((p.engine['active']!.execution as any).fingerprints.size,0,'ordinary models must not normalize or hash tool evidence');
 assert.equal((p.engine['active']!.execution as any).compactions.size,0);
 await p.event('turn/completed',{turn:{id:'turn',status:'completed'}});assert.deepEqual((await work).usage,usage);await p.engine.close();
});
for(const code of ['engine_cost_limit_reached','engine_compaction_loop'] as const)test(`guard race retains native completed and exact ${code}`,async()=>{
 const p=peer(code==='engine_cost_limit_reached'?{executionLimits:{maxCostCny:0.001,pricing:{inputCnyPerMillion:2,cachedInputCnyPerMillion:0,outputCnyPerMillion:3}}}:{});
 const {work}=await begin(p);
 if(code==='engine_cost_limit_reached')await p.event('thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:1000,cachedInputTokens:0,outputTokens:0}}});
 else for(let i=0;i<4;i++)await p.event('item/completed',{item:{type:'contextCompaction',id:String(i)}});
 assert.equal(p.sent.filter(m=>m.method==='turn/interrupt').length,1);
 await p.event('item/completed',{item:{type:'agentMessage',id:'partial',phase:'final_answer',text:'Synthetic partial evidence.'}});
 await p.event('turn/completed',{turn:{id:'turn',status:'completed'}});
 const result=await work;assert.equal(result.status,'completed');assert.equal(result.errorCode,code);assert.equal(result.text,'Synthetic partial evidence.');assert.equal((result.usage as any).execution.stopReason,code);
 assert.equal(result.messages?.[0]?.text,'Synthetic partial evidence.');
 await p.receive({id:p.sent.find(m=>m.method==='turn/interrupt').id,result:{}});await p.engine.close();
});
