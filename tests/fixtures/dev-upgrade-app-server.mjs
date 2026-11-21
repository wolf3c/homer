#!/usr/bin/env node
// Offline synthetic peer for real process/lock/handoff tests; never a product default.
import { createInterface } from "node:readline";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import {spawnSync,execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
const modelProvider=JSON.parse(process.argv.find(value=>value.startsWith('model_provider='))?.slice('model_provider='.length)??'"openai"');
const projectRootMarkers=JSON.parse(process.argv.find(value=>value.startsWith('project_root_markers='))?.slice('project_root_markers='.length)??'null');
if (process.argv.includes("--version")) { console.log("codex-cli 0.171.0-alpha.7"); process.exit(0); }
const home = process.env.CODEX_HOME;
const log = record => appendFileSync(join(home, "process-events.jsonl"), JSON.stringify(record) + "\n");
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const trustedArg = process.argv.find(a => a.startsWith("mcp_servers.homer_interactions="));
const trusted = trustedArg ? JSON.parse(trustedArg.slice(trustedArg.indexOf("=") + 1).replace(/("(?:[^"\\]|\\.)*")=/g, "$1:")) : undefined;
let worker = false, thread, turn, cwd, count = 0;
function tool(name,args) {
  const id='tool-'+ ++count;
  const item={id,type:'mcpToolCall',server:'homer_interactions',tool:name,arguments:args};
  send({method:'item/started',params:{threadId:thread,turnId:turn,item}});
  const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{callId:id,'x-codex-turn-metadata':{turn_id:turn}}}};
  const {result}=JSON.parse(execFileSync(trusted.command,trusted.args,{cwd:trusted.cwd,input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:5000}));
  send({method:'item/completed',params:{threadId:thread,turnId:turn,item:{...item,status:result.isError?'failed':'completed'}}});
  if(result.isError)throw Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}
async function gate(name) { while (!existsSync(join(home, name))) await new Promise(r => setTimeout(r, 15)); }
function complete(text) {
  send({ method: "item/completed", params: { threadId: thread, turnId: turn, item: { id: "reply-" + turn, type: "agentMessage", phase: "final_answer", text } } });
  send({ method: "turn/completed", params: { threadId: thread, turn: { id: turn, status: "completed" } } });
}
createInterface({ input: process.stdin }).on("line", line => { void receive(JSON.parse(line)); });
async function receive(m) {
  if(!m.method)return;
  if (m.method === "initialize") send({ id: m.id, result: { userAgent: "synthetic/0.171.0-alpha.7", codexHome:home } });
  if (m.method === "environment/info") send({id:m.id,result:{shell:"/bin/zsh"}});
  if (m.method === "thread/backgroundTerminals/list") send({id:m.id,result:{data:[]}});
  if (m.method === "thread/memoryMode/set") send({id:m.id,result:{}});
  if (m.method === "thread/inject_items") send({id:m.id,result:{}});
  if (m.method === 'model/list') send({id:m.id,result:{data:[]}}); // Synthetic peer reports no tier catalog; dedicated Fast tests cover advertised priority.
  if (m.method === "config/read") send({ id: m.id, result: { config: { project_root_markers:projectRootMarkers,features:{memories:true},memories:{dedicated_tools:true},mcp_servers: trusted ? { homer_interactions: trusted } : {} },layers:[{name:{type:"user",file:join(home,"config.toml")},version:"synthetic-config-1",config:{}}] } });
  if (m.method === "config/mcpServer/reload") send({id:m.id,result:{}});
  if (m.method === "skills/list") send({id:m.id,result:{data:[]}});
  if (m.method === "mcpServerStatus/list") send({ id: m.id, result: { data: [{ name: "homer_interactions", tools: Object.fromEntries((trusted?.enabled_tools??[]).map(n => [n, {}])) }] } });
  if(m.method==='thread/read')send({id:m.id,result:{thread:{id:m.params.threadId,modelProvider,...(m.params.includeTurns?{turns:[]}: {})}}});
  if (m.method === "thread/start" || m.method === "thread/resume") {
    worker = trusted?.args?.at(-1) === "worker";
    cwd = m.params.environments[0].cwd;
    thread = m.params.threadId ?? (worker ? "synthetic-worker-" + process.pid : "synthetic-main");
    log({ event: "started", pid: process.pid, worker, thread, resumed: m.method === "thread/resume" });
    if (m.method === "thread/resume" && existsSync(join(home, "hold-resume"))) {
      writeFileSync(join(home, "resume-waiting"), "1"); await gate("release-resume");
    }
    send({ id: m.id, result: { thread: { id: thread, modelProvider }, modelProvider, activePermissionProfile: { id: "homer" }, approvalPolicy: m.params.approvalPolicy } });
  }
  if (m.method === "turn/start") {
    turn = "turn-" + ++count;
    send({ id: m.id, result: { turn: { id: turn, status: "inProgress" } } });
    send({ method: "turn/started", params: { threadId: thread, turn: { id: turn } } });
    const text = m.params.input.map(i => i.text ?? "").join("");
    const input = text.startsWith('[内部协作输入') ? JSON.parse(text.split('\n')[1]) : undefined;
    if (worker) {
      writeFileSync(join(home, "worker-running"), String(process.pid));
      // Only this controlled fixture source is changed; no account or real model.
      const base=dirname(home),source=join(base,"src/synthetic-self-development.ts"),test=join(home,"self-development.test.mjs");
      writeFileSync(source,readFileSync(source,"utf8").replace('"before"','"after"'));
      writeFileSync(test,'import{test}from"node:test";import assert from"node:assert/strict";import{syntheticGreeting}from'+JSON.stringify(pathToFileURL(source).href)+';test("synthetic source change",()=>assert.equal(syntheticGreeting,"after"));');
      const check=spawnSync(process.execPath,['--import','tsx','--test',test],{cwd:base,stdio:'ignore',timeout:15000});
      writeFileSync(join(home,"self-development-tested.json"),JSON.stringify({synthetic:true,sourceModified:true,testExit:check.status}));
      await gate("release-worker");
      const inputText=readFileSync(join(cwd,"meeting.md"),"utf8");
      const filePath=join(cwd,"result.md");
      writeFileSync(filePath,inputText.replace("# Synthetic","# Synthetic result"));
      complete("written\n" + filePath);
    } else if (text === "dispatch-synthetic") {
      const {taskId}=await tool('task_create',{title:'Synthetic meeting result',goal:'Read meeting.md and write the synthetic result.'});
      const {workerId}=tool('worker_open',{taskId});
      writeFileSync(join(home,'fixture-worker-id'),workerId);
      complete("dispatched");
    } else if(text==='continue-after-tool-upgrade'){
      const list={jsonrpc:'2.0',id:1,method:'tools/list'};
      const {result}=JSON.parse(execFileSync(trusted.command,trusted.args,{cwd:trusted.cwd,input:JSON.stringify(list)+'\n',encoding:'utf8',timeout:5000}));
      const required=result.tools.find(tool=>tool.name==='worker_message').inputSchema.required;
      if(!required.includes('attachments'))throw Error('synthetic_stale_tool_catalog');
      const receipt=tool('worker_message',{workerId:readFileSync(join(home,'fixture-worker-id'),'utf8'),message:'Continue the original assignment.',attachments:[]});
      if(receipt.route!=='followup')throw Error('synthetic_followup_failed');
      complete('continued-after-upgrade');
    } else if (text === "hold-main") {
      writeFileSync(join(home, "main-running"), "1"); await gate("release-main"); complete("main-finished");
    } else if (input?.kind === 'worker_reply') {
      const reply = await tool('worker_read', {workerId:input.workerId,messageId:input.messageId}), filePath = reply.messages[0].text.trim().split('\n').at(-1);
      if(readFileSync(filePath,'utf8')!=="# Synthetic result\n林青：2026-10-20；待确认。")throw Error('synthetic_result_mismatch');
      await tool('task_update', {taskId:input.taskId,notes:'Checked the Worker report.'});
      complete(`synthetic-delivered [result.md](${pathToFileURL(filePath).href})`);
    } else complete("synthetic-reply");
  }
  if (m.method === "turn/interrupt") send({ id: m.id, result: {} });
}
