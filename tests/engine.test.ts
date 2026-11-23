import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { CodexEngine, EngineRpcUnconfirmed, type EngineOptions } from "../src/engine.js";
import type { Config } from "../src/config.js";
const config: Config = {
  workspace: resolve(".codex/scratch"),
  runtime: resolve(".codex/scratch/engine-tests"),
  codexBin: resolve("tests/fixtures/mock-app-server.mjs"),
  codexHome: resolve(".codex/scratch/engine-tests/home"), nativeCodexHome: resolve(".codex/scratch/engine-tests/home"),
  model: "mock",
  requiresOpenaiAuth: false,
  stopGraceMs: 100,
};
const options: EngineOptions = {
  cwd: resolve(".codex/scratch"),
  readRoots: [],
  instructions: "transport test",
  tools: [],
};
test("a Worker executable that cannot spawn fails without an unconfirmed RPC or process",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const engine=new CodexEngine({...config,codexBin:resolve("tests/fixtures/no-such-codex")},{...options,role:"worker"},async()=>({}));
  let spawned=false;
  engine.on("spawn",()=>{spawned=true;});
  const start=engine.start();
  void start.catch(()=>{});
  await yieldTurn();
  for(let step=0;step<6;step++){
    t.mock.timers.tick(60000);
    await yieldTurn();
  }
  await assert.rejects(start,error=>error instanceof Error&&error.message==="engine_spawn_failed"&&!(error instanceof EngineRpcUnconfirmed));
  assert.equal(spawned,false);
  assert.equal(engine.pid,undefined);
  assert.equal(await engine.close(),true);
});

test("an OS spawn exception after a confirmed close cannot retain the previous process",async()=>{
  const engine=new CodexEngine({...config},{...options},async()=>({}));
  try{
    await engine.start();
    await engine.turn("first");
    assert.ok(engine.pid);
    engine.config.codexBin=resolve(options.cwd,"x".repeat(10_000));
    await assert.rejects(()=>engine.turn("second",{cwd:resolve("tests")}),/^Error: engine_spawn_failed$/);
    assert.equal(engine.pid,undefined);
  }finally{
    await engine.close();
  }
});

test('initialize preserves the exact pinned prerelease version',async()=>{
 const engine=new CodexEngine(config,options,async()=>({}));
 try{await engine.start();assert.equal(engine.version,'0.171.0-alpha.7');}
 finally{await engine.close();}
});
for(const version of ['0.163.0','0.171.0','0.171.0-alpha.6','0.171.0-alpha.7+other'])
 test('initialize refuses unpinned version '+version,async()=>{
  const engine=new CodexEngine({...config,model:'reported-version:'+version},options,async()=>({}));
  try{await assert.rejects(()=>engine.start(),/^Error: capability_native_version_or_home_mismatch$/);}
  finally{await engine.close();}
 });
test("T10: late duplicate turn notifications cannot finish or contaminate a newer turn", async () => {
  const engine = new CodexEngine(config, options, async () => ({}));
  try {
    await engine.start();
    assert.equal((await engine.turn("first")).text, "FIRST");
    assert.equal((await engine.turn("second")).text, "SECOND");
  } finally {
    await engine.close();
  }
});
test("T07: disconnected App Server rejects active calls without hanging", async () => {
  const engine = new CodexEngine(
    { ...config, model: "disconnect" },
    options,
    async () => ({}),
  );
  try {
    await engine.start();
    assert.equal(engine.available,true);
    await assert.rejects(
      () => engine.turn("disconnect"),
      /engine_disconnected/,
    );
    assert.equal(engine.available,false);
  } finally {
    await engine.close();
  }
});

test('native failed turn is terminal while its process stays usable for a new request',async()=>{
  const engine=new CodexEngine({...config,model:'failed-turn'},options,async()=>({}));
  try{await engine.start();const failed=await engine.turn('first');assert.equal(failed.status,'failed');assert.equal(engine.available,true);
    assert.equal((await engine.turn('new request')).text,'SECOND');assert.equal(engine.available,true);
  }finally{await engine.close();assert.equal(engine.available,false);}
});

test("T11: official tool execution host remains enabled while Homer limits actual tools", async () => {
  const engine = new CodexEngine({ ...config, model: "host-required" }, options, async () => ({}));
  try {
    await engine.start();
    assert.equal((await engine.turn("use a tool")).text, "FIRST");
  } finally { await engine.close(); }
});

 test("configured medium reasoning is sent on every model turn", async () => {
  const engine = new CodexEngine({ ...config, ...{ effort: "medium" }, model: "effort-check" }, options, async () => ({}));
  try {
    await engine.start();
    assert.equal((await engine.turn("hi")).text, "medium");
    assert.equal((await engine.turn("again")).text, "medium");
  } finally { await engine.close(); }
});

test("T09: unavailable persisted thread history is reported without exposing raw engine errors", async () => {
  const engine = new CodexEngine({ ...config, model: "missing-rollout" }, { ...options, threadId: "mock-thread" }, async () => ({}));
  try {
    await assert.rejects(() => engine.start(), /^Error: engine_thread_history_unavailable$/);
  } finally { await engine.close(); }
});

test('resuming a Worker refuses a different native thread before submitting another turn',async()=>{
  const engine=new CodexEngine(config,{...options,role:'worker',threadId:'expected-worker-thread'},async()=>({}));
  try{await assert.rejects(()=>engine.start(),/^Error: engine_resume_thread_mismatch$/);}
  finally{await engine.close();}
});

test('resuming the exact Worker thread can start its next turn',async()=>{
  const engine=new CodexEngine(config,{...options,role:'worker',threadId:'mock-thread'},async()=>({}));
  try{assert.equal(await engine.start(),'mock-thread');assert.equal((await engine.turn('follow-up')).text,'FIRST');}
  finally{await engine.close();}
});


test('ILINK-ENGINE-001: stdio submits native image items without a model catalog prefilter',async()=>{
 const url='data:image/png;base64,aGVsbG8=';
 const engine=new CodexEngine({...config,model:'image-input-check'},options,async()=>({}));
 try{await engine.start();const result=await engine.turn('describe',{images:[{url}]});const items=JSON.parse(result.text);assert.deepEqual(items,[{type:'text',text:'describe',text_elements:[]},{type:'image',url}]);}finally{await engine.close();}
 const text=new CodexEngine({...config,model:'text-only'},options,async()=>({}));
 try{await text.start();assert.equal((await text.turn('describe',{images:[{url}]})).status,'completed');}finally{await text.close();}
});
