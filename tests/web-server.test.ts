import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "node:http";
import { createWebServer,fetch } from "./web-connected-fixture.js";
import type { WebBridge, WebState } from "../src/web-contract.js";

const state: WebState = { threadId: "synthetic-thread", messages: [], isRunning: false, activeMessageId: null, work: [], interactions: [], upgrade: { phase: "running" } };
test('execution route reads the exact task and run without a redundant root selector',async()=>{
 const calls:unknown[]=[];
 const bridge={taskOverview:{execution:async(selector:unknown,before:unknown)=>{calls.push({selector,before});return {items:[]};},call:async()=>({})}} as unknown as WebBridge;
 const web=await createWebServer({bridge,port:0});
 try{
  const path=web.url+'/api/tasks/task-one/execution/run-one/before/page';
  const response=await fetch(path);
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control')??'',/no-store/);
  assert.deepEqual(calls,[{selector:{taskId:'task-one',runId:'run-one'},before:'page'}]);
  assert.equal((await fetch(path+'?runId=run-other')).status,400);
  assert.equal(calls.length,1);
 }finally{await web.close();}
});
test("loopback gateway rejects foreign origins, missing mutation origin, and invalid host", async () => {
  let calls = 0;
  const bridge: WebBridge = { state: async () => state, submit: async () => { calls++; }, stop: async () => {}, respond: async () => {}, artifact: async () => { throw new Error("artifact_unavailable"); } };
  const web = await createWebServer({ bridge, port: 0 });
  try {
    const response = await fetch(web.url + "/api/state");
    assert.equal(response.status, 200);
    assert.equal((await response.json() as WebState).threadId, state.threadId);
    for (const origin of [undefined, "https://foreign.example", "null"]) {
      const result = await fetch(web.url + "/api/messages", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ requestId: "synthetic", text: "合成输入" }) });
      assert.equal(result.status, 403);
    }
    const foreignHost = await new Promise<number | undefined>((accept, reject) => {
      get(web.url + "/api/state", { headers: { Host: "attacker.example" } }, response => { response.resume(); accept(response.statusCode); }).on("error", reject);
    });
    assert.equal(foreignHost, 403);
    assert.equal(calls, 0);
    assert.equal((await fetch(web.url + "/api/messages", { method: "POST", headers: { Origin: web.url, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "synthetic", text: "合成输入" }) })).status, 202);
    assert.equal(calls, 1);
  } finally { await web.close(); }
});

test("gateway forwards quote and interaction IDs and exposes files only by Run ID", async () => {
  let received: unknown;
  const bridge: WebBridge = { state: async () => state, submit: async input => { received = input; }, stop: async () => {}, respond: async (id, input) => { received = { id, input }; }, artifact: async id => {
    if (id !== "run-synthetic") throw new Error("artifact_unavailable");
    return { filename: "合成成果.md", content: "# 合成成果" };
  } };
  const web = await createWebServer({ bridge, port: 0 });
  const headers = { Origin: web.url, "Content-Type": "application/json" };
  try {
    const input = { requestId: "synthetic", text: "补充", quote: { messageId: "message-source", text: "原文" } };
    assert.equal((await fetch(web.url + "/api/messages", { method: "POST", headers, body: JSON.stringify(input) })).status, 202);
    assert.deepEqual(received, input);
    assert.equal((await fetch(web.url + "/api/interactions/interaction-synthetic", { method: "POST", headers, body: JSON.stringify({ requestId: "reply", text: "答复" }) })).status, 202);
    assert.deepEqual(received, { id: "interaction-synthetic", input: { requestId: "reply", text: "答复" } });
    const file = await fetch(web.url + "/api/files/run-synthetic");
    assert.equal(await file.text(), "# 合成成果");
    assert.match(file.headers.get("content-disposition")!, /attachment/);
    assert.equal((await fetch(web.url + "/api/files/run-synthetic?path=/etc/passwd")).status, 400);
    assert.equal((await fetch(web.url + "/api/files/etc%2Fpasswd")).status, 404);
    assert.equal((await fetch(web.url + "/api/files/run-other")).status, 409);
  } finally { await web.close(); }
});

test("SSE reconnect gets current server history and disconnect does not cancel submitted work", async () => {
  let text = "部分", stopped = false;
  const bridge: WebBridge = {
    state: async () => ({ ...state, messages: [{ id: "message-synthetic", threadId: state.threadId, requestId: "request-synthetic", role: "assistant", text, status: "running", createdAt: 1 }] }),
    submit: async () => {}, stop: async () => { stopped = true; }, respond: async () => {}, artifact: async () => { throw new Error("artifact_unavailable"); },
  };
  const web = await createWebServer({ bridge, port: 0 });
  try {
    for (const expected of ["部分", "已完成的合成内容"]) {
      const controller = new AbortController();
      const response = await fetch(web.url + "/api/events", { signal: controller.signal });
      assert.match(response.headers.get("content-type")!, /text\/event-stream/);
      const reader = response.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      assert.ok(first.includes(expected));
      controller.abort(); await reader.cancel().catch(() => {});
      text = "已完成的合成内容";
    }
    assert.equal(stopped, false);
  } finally { await web.close(); }
});

test("gateway forwards annotation-only multi-quotes without accepting a forged trusted channel source", async () => {
  let received: unknown;
  const bridge: WebBridge={state:async()=>state,submit:async input=>{received=input;},stop:async()=>{},respond:async()=>{},artifact:async()=>{throw new Error("artifact_unavailable");}};
  const web=await createWebServer({bridge,port:0});
  try {
    const input={requestId:"synthetic-multi-http",text:"",quotes:[{messageId:"message-synthetic",text:"合成原文",annotation:"合成批注"}]};
    const response=await fetch(web.url+"/api/messages",{method:"POST",headers:{Origin:web.url,"Content-Type":"application/json"},body:JSON.stringify({...input,source:"wechat",persist:"forged"})});
    assert.equal(response.status,202);assert.deepEqual(received,input);
  }finally{await web.close();}
});

for(const path of ['/api/events','/api/history/events'])test(`shutdown ends ${path} whose initial snapshot is still pending`,async()=>{
 let entered!:()=>void,release!:(value:unknown)=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const snapshot=new Promise<unknown>(resolve=>{release=resolve;});
 const read=async()=>{entered();return snapshot;};
 const bridge={state:read,history:{state:read}} as unknown as WebBridge;
 const web=await createWebServer({bridge,port:0});
 const request=get(web.url+path,response=>response.resume());request.on('error',()=>{});
 let closing:Promise<void>|undefined;
 try{
  await started;closing=web.close();release({threadId:'synthetic',messages:[],work:[],interactions:[]});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([closing,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('web_shutdown_waits_for_new_sse')),1000);})]);}
  finally{clearTimeout(timer);}
 }finally{request.destroy();release({});await(closing??web.close());}
});
