import './fixtures/synthetic-home.mjs';
// Production adapter with a synthetic Node peer and fresh private SQLite files only.
import{test,type TestContext}from'node:test';
import assert from'node:assert/strict';
import{mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync}from'node:fs';
import{join,resolve}from'node:path';
import{DatabaseSync}from'node:sqlite';
import{CodexEngine,type EngineOptions}from'../src/engine.js';
import{Store}from'../src/store.js';
import{NativeThreadBindings}from'../src/native-thread-bindings.js';
import type{Config}from'../src/config.js';
const logical='binding-root',child='binding-child';
type Call={method:string;threadId?:string;mode?:string};
function fixture(t:TestContext,{mode='disabled',state={}}:{mode?:'enabled'|'disabled';state?:Record<string,unknown>}={}){
 const parent=resolve('.codex/scratch/engine-thread-bindings');mkdirSync(parent,{recursive:true});
 const root=realpathSync(mkdtempSync(join(parent,'case-'))),home=join(root,'codex');
 for(const name of['codex','runtime','workspace'])mkdirSync(join(root,name),{mode:0o700});
 writeFileSync(join(home,'fixture.json'),JSON.stringify({sourceId:logical,sourceProvider:'openai',...state}));
 const nativePath=join(home,'state_5.sqlite'),seed=new DatabaseSync(nativePath);
 seed.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,model_provider TEXT,memory_mode TEXT,history TEXT)');
 seed.prepare('INSERT INTO threads VALUES(?,?,?,?)').run(logical,'openai',mode,'synthetic retained context');seed.close();
 const store=new Store(join(root,'homer.sqlite')),bindings=new NativeThreadBindings(store),engines:CodexEngine[]=[];
 bindings.publish(logical,logical,{nativeId:logical,provider:'openai',parentNativeId:null},()=>true);
 const config:Config={codexBin:resolve('tests/fixtures/thread-binding-app-server.mjs'),codexHome:home,nativeCodexHome:home,workspace:join(root,'workspace'),runtime:join(root,'runtime'),model:'synthetic-binding-model',baseUrl:'http://127.0.0.1:9/v1',requiresOpenaiAuth:false,fast:false,serviceTier:null,stopGraceMs:100};
 const create=(role:'main'|'worker'='worker',options:Partial<EngineOptions>={})=>{const engine=new CodexEngine(config,{role,threadId:logical,cwd:config.workspace,readRoots:[],instructions:'Synthetic binding protocol.',tools:[],nativeThreads:bindings,...options},async()=>{throw Error('unexpected_model_tool');});engines.push(engine);return engine;};
 const rows=()=>{const db=new DatabaseSync(nativePath,{readOnly:true});try{return db.prepare('SELECT * FROM threads ORDER BY id').all();}finally{db.close();}};
 const parentRow=()=>rows().find(value=>value.id===logical);
 const original=parentRow(),meta=()=>JSON.stringify(store.db.prepare('SELECT key,value FROM meta ORDER BY key').all()),originalMeta=meta();
 const calls=():Call[]=>existsSync(join(home,'calls.jsonl'))?readFileSync(join(home,'calls.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 const unchanged=()=>{assert.equal(bindings.current(logical)?.nativeId,logical);assert.equal(bindings.segment(child),undefined);assert.equal(meta(),originalMeta);assert.deepEqual(parentRow(),original);assert.equal(calls().filter(value=>value.method==='turn/start').length,0);};
 t.after(async()=>{let stopped=true;for(const engine of engines)if(!await engine.close())stopped=false;store.close();if(stopped)rmSync(root,{recursive:true,force:true});assert.equal(stopped,true,'synthetic peer must stop before deleting private native state');});
 return{home,config,bindings,create,rows,parentRow,original,calls,unchanged,release:()=>writeFileSync(join(home,'release-fork'),'1')};
}
async function pending(home:string){for(let attempt=0;attempt<300;attempt++){if(existsSync(join(home,'fork-pending')))return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('synthetic_fork_marker_timeout');}

for(const role of['main','worker'] as const)for(const mode of['enabled','disabled'] as const)test(role+' provider fork preserves native '+mode+' mode and stable logical identity across cold resume',async t=>{
 const f=fixture(t,{mode}),engine=f.create(role);
 assert.equal(await engine.start(),logical);assert.equal(engine.threadId,logical);assert.equal(engine.nativeThreadId,child);
 assert.deepEqual(f.bindings.current(logical),{logicalId:logical,nativeId:child,provider:'homer',parentNativeId:logical});
 assert.deepEqual(f.parentRow(),f.original);assert.equal(f.rows().find(value=>value.id===child)?.memory_mode,mode);assert.equal(f.rows().find(value=>value.id===child)?.history,f.original?.history);
 assert.equal(f.calls().filter(value=>value.method==='turn/start').length,0);assert.deepEqual(f.calls().filter(value=>value.method==='thread/memoryMode/set'),[{method:'thread/memoryMode/set',threadId:child,mode}]);
 const read=await engine.request('thread/read',{threadId:logical,includeTurns:false});assert.equal(read.thread.id,logical);assert.equal(read.thread.modelProvider,'homer');assert.equal(f.calls().filter(value=>value.method==='thread/read').at(-1)?.threadId,child);
 assert.equal(await engine.close(),true);const prior=f.calls().length,next=f.create(role);assert.equal(await next.start(),logical);assert.equal(next.nativeThreadId,child);
 assert.equal(f.calls().slice(prior).filter(value=>value.method==='thread/fork').length,0);assert.equal(f.calls().slice(prior).find(value=>value.method==='thread/resume')?.threadId,child);
 assert.equal(f.rows().find(value=>value.id===child)?.memory_mode,mode);assert.deepEqual(f.parentRow(),f.original);assert.equal(f.calls().filter(value=>value.method==='turn/start').length,0);
});

test('onStarted stores the accepted native segment while public RPC identity remains logical',async t=>{
 const f=fixture(t),engine=f.create();await engine.start();assert.equal(f.calls().filter(value=>value.method==='turn/start').length,0);
 let accepted:string|undefined;const result=await engine.turn('synthetic explicit local turn',{onStarted:turnId=>{accepted=turnId;f.bindings.bindTurn(logical,engine.nativeThreadId!,turnId,()=>engine.turnId===turnId);}});
 assert.equal(result.status,'completed');assert.equal(result.text,'synthetic binding reply');assert.equal(accepted,'bound-turn');assert.deepEqual(f.bindings.turn(logical,'bound-turn'),{logicalId:logical,nativeId:child,turnId:'bound-turn'});assert.equal(f.calls().find(value=>value.method==='turn/start')?.threadId,child);
});

for(const revoke of['owner','can-fork','source-config'])test('a delayed fork ACK cannot publish after '+revoke+' revocation while the head remains unchanged',async t=>{
 const f=fixture(t,{state:{holdFork:true}});let current=true,canFork=true;
 const engine=f.create('worker',{isCurrent:()=>current,canFork:()=>canFork});const started=engine.start();const rejected=assert.rejects(started,/native_thread_owner_changed/);
 await pending(f.home);assert.ok(f.rows().some(value=>value.id===child),'native fork must exist while its receipt is held');assert.equal(f.bindings.current(logical)?.nativeId,logical);
 if(revoke==='owner')current=false;else if(revoke==='can-fork')canFork=false;else f.config.baseUrl='http://127.0.0.1:10/v1';
 f.release();await rejected;f.unchanged();assert.equal(f.calls().filter(value=>value.method==='thread/memoryMode/set').length,0);
});

test('close cancels a pending fork receipt without publishing its native child',async t=>{
 const f=fixture(t,{state:{holdFork:true}}),engine=f.create();const rejected=assert.rejects(engine.start(),/engine_closed|engine_disconnected/);
 await pending(f.home);assert.ok(f.rows().some(value=>value.id===child),'native fork must exist before cancellation');assert.equal(await engine.close(),true);f.release();await rejected;f.unchanged();
});

for(const fault of['thread-provider','top-provider','parent','same-id','missing-id','empty-id'])test('malformed native fork evidence is fenced before publication: '+fault,async t=>{
 const f=fixture(t,{state:{fault}}),engine=f.create();await assert.rejects(engine.start(),/engine_native_provider_mismatch|engine_resume_thread_mismatch|native_memory_thread_invalid/);f.unchanged();
});

for(const projection of['missing','invalid','ignored'])test('fork mode projection '+projection+' cannot publish a native segment',async t=>{
 const f=fixture(t,{state:{projection}}),engine=f.create();await assert.rejects(engine.start(),/native_memory_mode_missing|native_memory_mode_invalid|native_memory_mode_mismatch/);f.unchanged();
});

for(const source of['missing','invalid'])test('source memory projection '+source+' prevents native fork even when native thread metadata exists',async t=>{
 const f=fixture(t),db=new DatabaseSync(join(f.home,'state_5.sqlite'));if(source==='missing')db.prepare('DELETE FROM threads WHERE id=?').run(logical);else db.prepare('UPDATE threads SET memory_mode=? WHERE id=?').run('unknown',logical);db.close();const before=f.parentRow();
 const engine=f.create();await assert.rejects(engine.start(),source==='missing'?/^Error: native_memory_mode_missing$/:/^Error: native_memory_mode_invalid$/);
 assert.equal(f.bindings.current(logical)?.nativeId,logical);assert.equal(f.bindings.segment(child),undefined);assert.deepEqual(f.parentRow(),before);assert.equal(f.calls().filter(value=>value.method==='thread/fork').length,0);assert.equal(f.calls().filter(value=>value.method==='turn/start').length,0);
});

for(const readFault of['provider','unknown-provider','id'])test('saved native route evidence is checked before fork: '+readFault,async t=>{
 const f=fixture(t,{state:{readFault}}),engine=f.create();await assert.rejects(engine.start(),/^Error: engine_native_provider_mismatch$/);f.unchanged();assert.equal(f.calls().filter(value=>value.method==='thread/fork').length,0);
});
