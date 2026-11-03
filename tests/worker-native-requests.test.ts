import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerNativeRequests } from "../src/worker-native-requests.js";
import type { InteractionResolution } from "../src/worker-interactions.js";

const params = { threadId: "worker-thread", turnId: "worker-turn", itemId: "cmd-1", kind: "command", command: "node --version", cwd: "/synthetic/project", availableDecisions: ["accept", "decline"] };
function setup(worker = false) {
  let active = true, forwarded = 0;
  let answer!: (resolution: InteractionResolution) => void;
  const sent: any[] = [], delivered: (string | number)[] = [], invalidated: (string | number)[] = [];
  const bridge = new WorkerNativeRequests({
    worker,
    current: () => ({ active, threadId: params.threadId, turnId: params.turnId }),
    forward: async () => { forwarded++; return new Promise<InteractionResolution>(resolve => { answer = resolve; }); },
    send: message => { sent.push(message); },
    delivered: id => { delivered.push(id); },
    invalidated: id => { invalidated.push(id); },
  });
  return { bridge, sent, delivered, invalidated, approve: () => answer({ status: "approved", decision: { action: "approve", reason: "Current authorized check" } }), stop: () => { active = false; }, forwarded: () => forwarded };
}

test("HMR-INTERACTION-PROTOCOL: server callback stays open until the correlated main decision", async () => {
  const s = setup();
  const receive = s.bridge.receive(71, "item/commandExecution/requestApproval", params);
  await Promise.resolve();
  assert.equal(s.sent.length, 0);
  assert.equal(s.forwarded(), 1);
  s.approve();
  await receive;
  assert.deepEqual(s.sent, [{ id: 71, result: { decision: "accept" } }]);
  assert.equal(s.delivered.length, 0);
  s.bridge.resolved(params.threadId, 71);
  assert.deepEqual(s.delivered, [71]);
});

test('Worker native children share connection ownership and keep their real request scope', async()=>{
 const s=setup(true),child={...params,threadId:'native-child',turnId:'child-turn'};
 const first=s.bridge.receive(91,'item/commandExecution/requestApproval',child);
 assert.equal(s.forwarded(),1);assert.equal(s.bridge.hasPending,true);
 s.approve();await first;
 assert.deepEqual(s.sent,[{id:91,result:{decision:'accept'}}]);assert.equal(s.bridge.hasPending,false);
 s.bridge.resolved(child.threadId,91);assert.deepEqual(s.delivered,[91]);
});
test('child turn end invalidates only its request; parent end invalidates the segment', async()=>{
 const answers=new Map<number,(r:InteractionResolution)=>void>(),invalidated:number[]=[];
 const bridge=new WorkerNativeRequests({worker:true,current:()=>({active:true,threadId:params.threadId,turnId:params.turnId}),forward:r=>new Promise(resolve=>answers.set(Number(r.requestId),resolve)),send:()=>{},delivered:()=>{},invalidated:id=>invalidated.push(Number(id))});
 const a=bridge.receive(1,'item/commandExecution/requestApproval',{...params,threadId:'child-a',turnId:'turn-a'});
 const b=bridge.receive(2,'item/commandExecution/requestApproval',{...params,threadId:'child-b',turnId:'turn-b'});
 bridge.endTurn('turn-a','child-a');await a;assert.deepEqual(invalidated,[1]);assert.equal(bridge.hasPending,true);
 bridge.endTurn(params.turnId,params.threadId);await b;assert.deepEqual(invalidated,[1,2]);assert.equal(bridge.hasPending,false);
});

test("HMR-INTERACTION-PROTOCOL: duplicate callbacks share one decision and one wire response", async () => {
  const s = setup();
  const first = s.bridge.receive("same-id", "item/commandExecution/requestApproval", params);
  const repeat = s.bridge.receive("same-id", "item/commandExecution/requestApproval", params);
  s.approve();
  await Promise.all([first, repeat]);
  assert.equal(s.forwarded(), 1);
  assert.equal(s.sent.length, 1);
  await s.bridge.receive("same-id", "item/commandExecution/requestApproval", params);
  assert.equal(s.sent.length, 1);
});

test("HMR-INTERACTION-PROTOCOL: mismatched thread/turn is refused without reaching main", async () => {
  const s = setup();
  await s.bridge.receive(1, "item/commandExecution/requestApproval", { ...params, threadId: "other" });
  await s.bridge.receive(2, "item/permissions/requestApproval", { ...params, turnId: "old", permissions: { network: { enabled: true } } });
  assert.equal(s.forwarded(), 0);
  assert.deepEqual(s.sent, [{ id: 1, result: { decision: "decline" } }, { id: 2, result: { permissions: {}, scope: "turn" } }]);
});

test("HMR-INTERACTION-PROTOCOL: stopping between approval and send cannot authorize the stopped run", async () => {
  const s = setup();
  const receive = s.bridge.receive(1, "item/commandExecution/requestApproval", params);
  s.approve();
  s.stop();
  await receive;
  assert.equal(s.sent.length, 0);
  assert.deepEqual(s.invalidated, [1]);
});

test("HMR-INTERACTION-PROTOCOL: disconnect and server cancellation settle without late approval", async () => {
  for (const how of ["close", "resolved", "turnEnd"] as const) {
    const s = setup();
    const receive = s.bridge.receive(1, "item/commandExecution/requestApproval", params);
    if (how === "close") s.bridge.close();
    else if (how === "resolved") s.bridge.resolved(params.threadId, 1);
    else s.bridge.endTurn(params.turnId);
    await receive;
    s.approve();
    await Promise.resolve();
    assert.equal(s.sent.length, 0);
    assert.deepEqual(s.invalidated, [1]);
  }
});

test("HMR-INTERACTION-PROTOCOL: unknown methods remain refused and secret questions never reach main", async () => {
  const s = setup();
  assert.equal(await s.bridge.receive(1, "unknown/request", {}), false);
  await s.bridge.receive(2, "item/tool/requestUserInput", { ...params, questions: [{ id: "secret", question: "Password", isSecret: true }] });
  assert.equal(s.forwarded(), 0);
  assert.equal(s.sent[0].error.message, "interaction_secret_input_unsupported");
});

test('native plugin installation elicitation is bound to its real thread and turn',async()=>{const s=setup();const receive=s.bridge.receive('install-native','mcpServer/elicitation/request',{threadId:params.threadId,turnId:params.turnId,serverName:'codex_apps',mode:'form',_meta:{codex_approval_kind:'tool_suggestion',tool_type:'plugin',suggest_type:'install',tool_id:'sample@native'},message:'Install the explicitly requested plugin',requestedSchema:{type:'object',properties:{}}});await Promise.resolve();assert.equal(s.forwarded(),1);s.approve();await receive;assert.deepEqual(s.sent,[{id:'install-native',result:{action:'accept',content:null,_meta:null}}]);});

test('MCP bridge preserves RPC id types, cancel and local failures without fabricated declines',async()=>{
 const p={threadId:params.threadId,turnId:params.turnId,serverName:'arbitrary',mode:'form',message:'Run',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}};
 const sent:any[]=[],invalidated:any[]=[],answers=new Map<string|number,(r:InteractionResolution)=>void>();
 const bridge=new WorkerNativeRequests({current:()=>({active:true,threadId:params.threadId,turnId:params.turnId}),forward:r=>new Promise(resolve=>answers.set(r.requestId,resolve)),send:m=>sent.push(m),invalidated:(id,code)=>invalidated.push([id,code]),delivered:()=>{}});
 const a=bridge.receive(1,'mcpServer/elicitation/request',p),b=bridge.receive('1','mcpServer/elicitation/request',p);
 assert.equal(answers.size,2);answers.get(1)!({status:'cancelled',decision:{action:'cancel',reason:'user cancel'},code:'interaction_user_cancelled'});answers.get('1')!({status:'expired',code:'capability_approval_timeout'});await Promise.all([a,b]);
 assert.deepEqual(sent,[{id:1,result:{action:'cancel',content:null,_meta:null}},{id:'1',error:{code:-32001,message:'capability_approval_timeout'}}]);assert.deepEqual(invalidated,[['1','capability_approval_timeout']]);assert.equal(bridge.hasPending,false);
 await bridge.receive(2,'mcpServer/elicitation/request',{...p,turnId:'old'});assert.deepEqual(sent.at(-1),{id:2,error:{code:-32001,message:'interaction_scope_denied'}});
});
test('forward and send failures settle once, safely invalidate and never retry a failed send',async()=>{
 for(const fault of ['forward','send']){
  const sent:any[]=[],invalidated:any[]=[];let attempts=0;
  const bridge=new WorkerNativeRequests({current:()=>({active:true,threadId:params.threadId,turnId:params.turnId}),forward:async()=>{if(fault==='forward')throw Error('SENSITIVE_FAILURE');return{status:'approved',decision:{action:'approve',reason:'user'}};},send:m=>{attempts++;if(fault==='send')throw Error('SENSITIVE_WRITE');sent.push(m);},invalidated:(id,code)=>invalidated.push([id,code]),delivered:()=>{}});
  await bridge.receive(1,'item/commandExecution/requestApproval',params);assert.equal(attempts,1);assert.equal(bridge.hasPending,false);assert.deepEqual(invalidated,[[1,fault==='send'?'interaction_send_failed':'interaction_unavailable']]);assert.doesNotMatch(JSON.stringify(sent),/SENSITIVE/);
 }
});

test('conflicting malformed duplicate fences an already approved callback before its send',async()=>{
 const s=setup(),first=s.bridge.receive(1,'item/commandExecution/requestApproval',params);s.approve();
 await s.bridge.receive(1,'item/commandExecution/requestApproval',{threadId:'bad'});await first;
 assert.deepEqual(s.sent,[{id:1,error:{code:-32001,message:'interaction_request_conflict'}}]);assert.equal(s.bridge.hasPending,false);
});
test('user cancel cannot reach a closed, cleared or ended MCP callback',async()=>{
 for(const how of ['close','resolved','endTurn']){
  const answers:any[]=[],sent:any[]=[],invalidated:any[]=[];
  const bridge=new WorkerNativeRequests({current:()=>({active:true,threadId:'thread',turnId:'turn'}),forward:()=>new Promise(resolve=>answers.push(resolve)),send:m=>sent.push(m),delivered:()=>{},invalidated:(id,code)=>invalidated.push([id,code])});
  const pending=bridge.receive(1,'mcpServer/elicitation/request',{threadId:'thread',turnId:'turn',serverName:'any',mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}});
  answers[0]({status:'cancelled',decision:{action:'cancel',reason:'actual user'},code:'interaction_user_cancelled'});
  if(how==='close')bridge.close();else if(how==='resolved')bridge.resolved('thread',1);else bridge.endTurn('turn');await pending;
  assert.equal(sent.length,0);assert.equal(invalidated.length,1);
 }
});

test('deep but valid JSON arguments fail safely without failing the engine connection',async()=>{
 const s=setup();let deep:unknown=null;for(let n=0;n<8000;n++)deep={x:deep};
 await s.bridge.receive(1,'mcpServer/elicitation/request',{threadId:params.threadId,turnId:params.turnId,serverName:'any',mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:deep}});
 assert.deepEqual(s.sent,[{id:1,error:{code:-32001,message:'interaction_unavailable'}}]);assert.deepEqual(s.invalidated,[1]);assert.equal(s.forwarded(),0);assert.equal(s.bridge.hasPending,false);
});
