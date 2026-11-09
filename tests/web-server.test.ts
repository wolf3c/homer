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
  const bridge: WebBridge = { history:{state:async()=>state} as WebBridge['history'], submit: async () => { calls++; }, stop: async () => {}, respond: async () => {} };
  const web = await createWebServer({ bridge, port: 0 });
  try {
    const response = await fetch(web.url + "/api/history/state");
    assert.equal(response.status, 200);
    assert.equal((await response.json() as WebState).threadId, state.threadId);
    for (const origin of [undefined, "https://foreign.example", "null"]) {
      const result = await fetch(web.url + "/api/messages", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ requestId: "synthetic", text: "合成输入" }) });
      assert.equal(result.status, 403);
    }
    const foreignHost = await new Promise<number | undefined>((accept, reject) => {
      get(web.url + "/api/history/state", { headers: { Host: "attacker.example" } }, response => { response.resume(); accept(response.statusCode); }).on("error", reject);
    });
    assert.equal(foreignHost, 403);
    assert.equal(calls, 0);
    assert.equal((await fetch(web.url + "/api/messages", { method: "POST", headers: { Origin: web.url, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "synthetic", text: "合成输入" }) })).status, 202);
    assert.equal(calls, 1);
  } finally { await web.close(); }
});

test("gateway forwards quote and interaction IDs and reads attachments only by their message and revision", async () => {
  let received: unknown;
  const assetId='asset-11111111-1111-4111-8111-111111111111',path='/api/media/message-synthetic/'+assetId+'/1';
  const bridge: WebBridge = { submit: async input => { received = input; }, stop: async () => {}, respond: async (id, input) => { received = { id, input }; }, media:{read:async input=>{
    if(input.messageId!=="message-synthetic"||input.assetId!==assetId||input.revision!==1)throw Error("media_scope_denied");
    return {filename:"合成成果.md",mime:"text/markdown",data:Buffer.from("# 合成成果").toString("base64")};
  }} };
  const web = await createWebServer({ bridge, port: 0 });
  const headers = { Origin: web.url, "Content-Type": "application/json" };
  try {
    const input = { requestId: "synthetic", text: "补充", quote: { messageId: "message-source", text: "原文" } };
    assert.equal((await fetch(web.url + "/api/messages", { method: "POST", headers, body: JSON.stringify(input) })).status, 202);
    assert.deepEqual(received, input);
    assert.equal((await fetch(web.url + "/api/interactions/interaction-synthetic", { method: "POST", headers, body: JSON.stringify({ requestId: "reply", text: "答复" }) })).status, 202);
    assert.deepEqual(received, { id: "interaction-synthetic", input: { requestId: "reply", text: "答复" } });
    const file = await fetch(web.url + path);
    assert.equal(await file.text(), "# 合成成果");
    assert.match(file.headers.get("content-disposition")!, /attachment/);
    assert.equal((await fetch(web.url + path + "?path=/etc/passwd")).status, 400);
    assert.equal((await fetch(web.url + "/api/media/etc%2Fpasswd/"+assetId+"/1")).status, 404);
    assert.equal((await fetch(web.url + path.replace("message-synthetic","message-other"))).status, 409);
  } finally { await web.close(); }
});

test('voice preview is accepted only on the exact attachment GET route',async()=>{
 const ref={messageId:'message-voice',assetId:'asset-11111111-1111-4111-8111-111111111111',revision:2};
 const path='/api/media/'+ref.messageId+'/'+ref.assetId+'/'+ref.revision;
 const original=Buffer.from([0,5,255,7]),preview=Buffer.from([82,73,70,70,1]),calls:unknown[]=[];
 const bridge:WebBridge={submit:async()=>{},stop:async()=>{},respond:async()=>{},media:{read:async input=>{
  calls.push(input);
  return input.preview==='voice'
   ?{filename:'voice.wav',mime:'audio/wav',data:preview.toString('base64')}
   :{filename:'voice.silk',mime:'audio/silk',data:original.toString('base64'),sha256:'a'.repeat(64)};
 }}};
 const web=await createWebServer({bridge,port:0});
 try{
  const file=await fetch(web.url+path);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),original);
  assert.equal(file.headers.get('x-homer-artifact-hash'),'a'.repeat(64));
  const audio=await fetch(web.url+path+'?preview=voice');
  assert.equal(audio.status,200);
  assert.equal(audio.headers.get('content-type'),'audio/wav');
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()),preview);
  for(const suffix of ['?preview=html','?preview=voice&preview=voice','?preview=voice&path=other','/origin?preview=voice','/reveal?preview=voice'])
   assert.equal((await fetch(web.url+path+suffix)).status,400);
  assert.equal((await fetch(web.url+'/api/history/state?preview=voice')).status,400);
  assert.equal((await fetch(web.url+path+'?preview=voice',{method:'POST'})).status,400);
  assert.deepEqual(calls,[ref,{...ref,preview:'voice'}]);
 }finally{await web.close();}
});

test('retired external message gateways have no local entry points',async()=>{
 const bridge:WebBridge={submit:async()=>{},stop:async()=>{},respond:async()=>{}};
 const web=await createWebServer({bridge,port:0});
 try{
  for(const path of ['/api/channels/wechat','/api/channels/telegram','/settings/telegram','/api/files/result-retired'])
   assert.equal((await fetch(web.url+path)).status,404);
  assert.equal((await fetch(web.url+'/api/channels/telegram/configure',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:'{}'})).status,404);
 }finally{await web.close();}
});

test("SSE reconnect gets current server history and disconnect does not cancel submitted work", async () => {
  let text = "部分", stopped = false;
  const bridge: WebBridge = {
    history:{state:async()=>({ ...state, messages: [{ id: "message-synthetic", threadId: state.threadId, requestId: "request-synthetic", role: "assistant", text, status: "running", createdAt: 1 }] })} as WebBridge['history'],
    submit: async () => {}, stop: async () => { stopped = true; }, respond: async () => {},
  };
  const web = await createWebServer({ bridge, port: 0 });
  try {
    for (const expected of ["部分", "已完成的合成内容"]) {
      const controller = new AbortController();
      const response = await fetch(web.url + "/api/history/events", { signal: controller.signal });
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

test("gateway forwards annotation-only multi-quotes without accepting a forged trusted source", async () => {
  let received: unknown;
  const bridge: WebBridge={submit:async input=>{received=input;},stop:async()=>{},respond:async()=>{}};
  const web=await createWebServer({bridge,port:0});
  try {
    const input={requestId:"synthetic-multi-http",text:"",quotes:[{messageId:"message-synthetic",text:"合成原文",annotation:"合成批注"}]};
    const response=await fetch(web.url+"/api/messages",{method:"POST",headers:{Origin:web.url,"Content-Type":"application/json"},body:JSON.stringify({...input,source:"forged-source",persist:"forged"})});
    assert.equal(response.status,202);assert.deepEqual(received,input);
  }finally{await web.close();}
});

test('shutdown ends the paged event stream whose initial snapshot is still pending',async()=>{
 const path='/api/history/events';
 let entered!:()=>void,release!:(value:unknown)=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const snapshot=new Promise<unknown>(resolve=>{release=resolve;});
 const read=async()=>{entered();return snapshot;};
 const bridge={history:{state:read}} as unknown as WebBridge;
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
