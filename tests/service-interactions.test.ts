import {callHostMcp} from './fixtures/host-mcp-call.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Homer, type Message } from "../src/service.js";
import type { Config } from "../src/config.js";
import type { EngineOptions, ToolCall, TurnResult } from "../src/engine.js";
import { loadPrompts } from "../src/prompts.js";
import { homerWebBridge } from "../src/web-homer.js";

async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error("interaction_test_timeout"); await new Promise(done => setTimeout(done, 5)); }
}
type InteractionScenario = {
  reply?: TurnResult;
  skipDecision?: boolean;
  skipDelivery?: boolean;
  handoff?: boolean;
  namedTask?: boolean;
};
async function fixture(mode: "answer" | "user" | "deny" | "approve" | "direct" | "hang", workers = 1, scenario: InteractionScenario = {}) {
  const root = resolve(".codex/scratch/worker-interactions"); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(root + "/svc-");
  const runtime = join(dir, "rt"), workspace = join(dir, "ws");
  mkdirSync(runtime); mkdirSync(workspace);
  const config: Config = { runtime, workspace, codexHome:join(dir,"home"),nativeCodexHome:join(dir,"home"), codexBin: "/usr/bin/false", model: "mock", effort: "medium", requiresOpenaiAuth: false, stopGraceMs: 50 };
  const messages: Message[] = [], resumes: string[] = [], engines: Fake[] = [], mainInputs:string[]=[];
  const handoffs: string[] = [], interactionTurns: string[] = [], pausedWorkers: (() => void)[] = [];
  const releaseWorkers = () => { for (const release of pausedWorkers.splice(0)) release(); };
  let sequence = 0;
  let app: Homer;
  class Fake extends EventEmitter {
    threadId: string; turnId?: string; worker: boolean; closed = false;
    constructor(readonly options: EngineOptions, readonly handler: (call: ToolCall) => Promise<unknown>) {
      super(); this.threadId = options.threadId ?? "thread-" + ++sequence;
      this.worker = options.role === "worker"; engines.push(this);
    }
    async start() { return this.threadId; }
    async call(tool: string, args: unknown): Promise<any> {
      const callId = "call-" + ++sequence;
      const result = await this.handler({ threadId: this.threadId, turnId: this.turnId!, callId, tool, arguments: args });
      if (!this.closed && !(this.worker && tool === "ask_main" && scenario.skipDelivery)) this.emit("toolResponse", callId);
      return result;
    }
    async turn(text: string, hooks?: { onStarted?: (id: string) => void }): Promise<TurnResult> {
      this.turnId = "turn-" + ++sequence; hooks?.onStarted?.(this.turnId);
      if (this.worker) {
        let reply: any;
        if (mode === "approve" || mode === "deny" || mode === "direct") {
          const requestId = "native-" + this.threadId;
          reply = await this.options.onInteraction!({ requestId, method: "item/permissions/requestApproval", threadId: this.threadId, turnId: this.turnId, itemId: "perm-1", kind: "authorization", details: { threadId: this.threadId, turnId: this.turnId, itemId: "perm-1", cwd: this.options.cwd, permissions: { network: null, fileSystem: { read: [this.options.cwd], write: null } } } });
          if (!scenario.skipDelivery) this.emit("interactionDelivered", requestId);
        } else reply = await this.call("ask_main", { question: `合成问题 ${this.threadId}：采用哪个格式？` });
        if (scenario.skipDelivery) await new Promise<void>(done => pausedWorkers.push(done));
        if (this.closed || reply.status === "cancelled" || reply.status === "expired") return { status: "interrupted", text: "stopped" };
        resumes.push(this.threadId);
        writeFileSync(join(this.options.cwd, "answer-" + this.threadId + ".md"), `# 合成成果\n${reply.answer ?? reply.decision?.action ?? reply.status}`);
        return { status: "completed", text: "Written" };
      }
      mainInputs.push(text);
      if (text === "dispatch") {
        for (let i = 0; i < workers; i++) await this.call("worker_open", { message: "按用户要求生成 Markdown " + i, ...(scenario.namedTask ? {title:"整理 Markdown " + i} : {}) });
      } else if (app["mainContext"]?.interactionId) {
        const id = app["mainContext"]!.interactionId!;
        interactionTurns.push(id);
        const item = await callHostMcp(this.options, "inspect_interaction", { interactionId: id });
        if (scenario.handoff) {
          const path = join(workspace, "handoff-" + id + ".json");
          writeFileSync(path, JSON.stringify({ source: "synthetic", format: "Markdown" }));
          handoffs.push(path);
          this.emit("nativeProcess", { threadId: this.threadId, turnId: this.turnId, itemId: "handoff-" + id, category: "fileChange", status: "completed", completed: true, fileCount: 1 });
        }
        if (mode === "user" || mode === "hang") {
          await callHostMcp(this.options, "escalate_interaction", { interactionId: id, question: `请指定 ${item.runId} 的格式`, reason: "合成歧义" });
          return scenario.reply ?? { status: "completed", text: `请指定 ${item.runId} 的格式。` };
        }
        if (scenario.skipDecision) return scenario.reply ?? { status: "completed", text: "已处理" };
        if (mode === "approve") {
          await callHostMcp(this.options, "escalate_interaction", { interactionId: id, question: "确认范围", reason: "需要用户决定" });
          await assert.rejects(callHostMcp(this.options, "respond_interaction", { interactionId: id, action: "approve", reason: "No user decision" }), /interaction_user_decision_required/);
          return {status:"completed",text:"需要用户确认。"};
        }
        await callHostMcp(this.options, "respond_interaction", { interactionId: id, action: mode === "direct" ? "approve" : mode === "deny" ? "deny" : "answer", reason: "当前任务范围与材料足够判断", answer: mode === "answer" ? item.threadId : null, answers: null, permissions: mode === "direct" ? item.details.params.permissions : null });
        return scenario.reply ?? { status: "completed", text: "已处理" };
      } else if (mode === "approve" && text.includes("[用户答复原待答]")) {
        const id = /interactionId=([^。]+)/.exec(text)![1]!;
        const item = await callHostMcp(this.options, "inspect_interaction", { interactionId: id });
        for (const permissions of [{network:{enabled:true}}, {fileSystem:{read:[resolve(item.details.params.cwd,"..")]}}]) {
          await assert.rejects(callHostMcp(this.options, "respond_interaction", {interactionId:id,action:"approve",reason:"Overbroad",permissions}),/interaction_permission_scope/);
          assert.equal(app.interactions.inspect(id).state,"pending_user");
        }
        await callHostMcp(this.options, "respond_interaction",{interactionId:id,action:"approve",reason:"应用用户的明确许可"});
      } else if (text === "empty-user-reply") {
        return { status: "completed", text: "" };
      } else if (text.startsWith("reply ")) {
        const id = text.slice(6).split(/\s/)[0]!;
        await callHostMcp(this.options, "inspect_interaction", { interactionId: id });
        await callHostMcp(this.options, "respond_interaction", { interactionId: id, action: "answer", reason: "用户补充", answer: "用户指定格式", answers: null, permissions: null });

      }
      return { status: "completed", text: "已处理" };
    }
    async interrupt() { return false; }
    async close() { this.closed = true; return true; }
  }
  app = new Homer(config, async message => { messages.push(message); }, (options, handler) => new Fake(options, handler));
  await app.start();
  return { app, config, messages, engines, resumes, handoffs, interactionTurns, releaseWorkers, mainInputs,
    events: () => app.store.db.prepare("SELECT type,code FROM events ORDER BY seq").all() as { type: string; code: string | null }[],
    async restart() {
      await app.close();
      app = new Homer(config, async message => { messages.push(message); }, (options, handler) => new Fake(options, handler));
      await app.start();
      return app;
    },
    async cleanup() { releaseWorkers(); await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

async function approveRequested(f:Awaited<ReturnType<typeof fixture>>,count:number){
  await until(() => f.app.interactions.list().filter(item=>item.state==="pending_user").length===count);
  const cards=await homerWebBridge(f.app).history!.interactions(0,f.app.webReadEpoch);
  assert.equal(cards.items.length,count);assert.equal(f.resumes.length,0);
  for(const [index,card] of cards.items.entries())f.app.submitMessage({requestId:"approval-"+index,interactionId:card.id,text:"允许本次操作"});
}

test('Main approves native Worker requests through its MCP without showing user cards',async()=>{
  const f=await fixture('direct',2,{reply:{status:'completed',text:''}});
  try{
    await f.app.message('dispatch','user-task');
    await until(()=>f.resumes.length===2||f.events().some(event=>event.type==='internal_processing_failed'));
    assert.equal(f.resumes.length,2);
    await f.app.idle();
    const items=f.app.interactions.list();assert.equal(items.length,2);
    for(const item of items){
      const decided=f.app.interactions.inspect(item.id);
      assert.equal(decided.state,'approved');assert.ok(decided.details.review);assert.ok(decided.deliveredAt);
      assert.equal(decided.userQuestion,null);assert.equal(decided.responseUserMessageId,null);
    }
    assert.equal((await homerWebBridge(f.app).history!.interactions(0,f.app.webReadEpoch)).items.length,0);
    assert.equal(f.messages.filter(message=>message.type==='reply').length,1);
    assert.ok(f.app.store.runs().every(run=>run.status==='succeeded'));
  }finally{await f.cleanup();}
});

// Synthetic regression derived from a completed Worker decision followed by an
// empty main reply; no production requests, file contents or identifiers.
for (const mode of ["answer", "approve", "deny"] as const) {
  test(`HMR-INTERACTION-002: delivered ${mode} completes silent collaboration without replaying file writes`, async () => {
    const f = await fixture(mode, 2, { reply: { status: "completed", text: "" }, handoff: true });
    try {
      await f.app.message("dispatch", "user-task");
      if(mode==="approve")await approveRequested(f,2);
      await f.app.idle();
      const interactions = f.app.interactions.list();
      assert.equal(interactions.length, 2);
      assert.ok(interactions.every(item => item.state === (mode === "answer" ? "answered" : mode === "approve" ? "approved" : "denied") && item.deliveredAt !== null));
      assert.equal(f.messages.filter(message => message.type === "reply").length, mode==="approve"?3:1, "only actual user requests get public replies");
      assert.equal(f.resumes.length, 2);
      assert.ok(f.app.store.runs().every(run => run.status === "succeeded"));
      assert.equal(f.handoffs.length, 2);
      assert.equal(new Set(f.interactionTurns).size, 2);
      assert.equal(f.interactionTurns.length, 2);
      for (const path of f.handoffs) assert.equal(JSON.parse(readFileSync(path, "utf8")).source, "synthetic");
      assert.ok(!f.events().some(event => event.type === "internal_processing_failed" || event.type === "main_turn_failed"));
    } finally { await f.cleanup(); }
  });
}

test("HMR-INTERACTION-002: a successful file write without a decision does not excuse an empty reply", async () => {
  const f = await fixture("answer", 1, { reply: { status: "completed", text: "" }, skipDecision: true, handoff: true });
  try {
    await f.app.message("dispatch", "user-task");
    await until(()=>f.events().some(event=>event.type==='internal_processing_failed'));
    assert.equal(f.app.interactions.list()[0]?.state, "pending_main","failed coordination preserves the original question for recovery");
    assert.equal(f.resumes.length, 0);
    assert.equal(f.handoffs.length, 1);
    assert.equal(JSON.parse(readFileSync(f.handoffs[0]!, "utf8")).source, "synthetic");
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "main_empty_reply"));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: a decision without delivery confirmation does not excuse an empty reply", async () => {
  const f = await fixture("answer", 1, { reply: { status: "completed", text: "" }, skipDelivery: true });
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.events().some(event => event.type === "internal_processing_failed"));
    assert.equal(f.app.interactions.list()[0]?.deliveredAt, null);
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "main_empty_reply"));
    f.releaseWorkers(); await f.app.idle();
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: escalation still requires a nonempty user question", async () => {
  const f = await fixture("user", 1, { reply: { status: "completed", text: "" } });
  try {
    await f.app.message("dispatch", "user-task");
    await until(()=>f.events().some(event=>event.type==='internal_processing_failed'));
    assert.equal(f.app.interactions.list()[0]?.state, "pending_user");
    assert.equal(f.messages.filter(message => message.type === "question").length, 0);
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "main_empty_reply"));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: native failure after a delivered decision remains failed without replay", async () => {
  const f = await fixture("answer", 1, { reply: { status: "failed", text: "", errorCode: "synthetic_native_failure" }, handoff: true });
  try {
    await f.app.message("dispatch", "user-task"); await f.app.idle();
    const item = f.app.interactions.list()[0]!;
    assert.equal(item.state, "answered"); assert.notEqual(item.deliveredAt, null);
    assert.ok(f.events().some(event => event.type === "internal_processing_failed" && event.code === "synthetic_native_failure"));
    assert.equal(f.handoffs.length, 1); assert.equal(f.interactionTurns.length, 1);
    assert.equal(JSON.parse(readFileSync(f.handoffs[0]!, "utf8")).source, "synthetic");
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-002: ordinary user turns still reject an empty reply", async () => {
  const f = await fixture("answer");
  try {
    assert.match(await f.app.message("empty-user-reply", "empty-request"), /main_empty_reply/);
    assert.ok(f.app.history.list(f.app.store.meta("mainThread")!).some(message => message.requestId === "empty-request" && message.role === "assistant" && message.status === "failed"));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: service main answers and original two Workers finish without cross-routing", async () => {
  const f = await fixture("answer", 2, {namedTask:true});
  try {
    await f.app.message("dispatch", "user-task"); await f.app.idle();
    assert.equal(f.resumes.length, 2);
    assert.ok(f.app.store.runs().every(run => run.status === "succeeded"));
    for (const run of f.app.store.runs()) assert.ok(readFileSync(join(f.config.workspace, "answer-" + run.threadId + ".md"), "utf8").includes(run.threadId!));
    assert.equal(f.app.interactions.list().length, 2);
    assert.ok(f.app.interactions.list().every(item => item.deliveredAt !== null));
    assert.deepEqual(f.app.tasks.tasks().map(task=>task.title).sort(),["整理 Markdown 0","整理 Markdown 1"]);
    assert.deepEqual(f.app.tasks.tasks().map(task=>f.app.tasks.version(task.id,task.headVersion).goal).sort(),["按用户要求生成 Markdown 0","按用户要求生成 Markdown 1"]);
    const mainTools=f.engines.find(engine => !engine.worker)!.options.tools.map(tool=>tool.name);
    assert.ok(mainTools.includes("task_create")&&mainTools.includes("worker_open"));assert.ok(!mainTools.includes("dispatch_work"));
    const prompts = loadPrompts();
    assert.ok(f.engines.find(engine => !engine.worker)!.options.instructions.startsWith(prompts.main));
    assert.ok(f.engines.filter(engine => engine.worker).every(engine => engine.options.instructions.startsWith(prompts.worker)));
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: user escalation keeps Worker alive beyond timeout and main accepts unrelated messages", async () => {
  const f = await fixture("user", 2);
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.app.interactions.list().filter(item=>item.state==='pending_user').length===2);
    const pending = f.app.interactions.list();
    assert.deepEqual((await homerWebBridge(f.app).history!.interactions(0,f.app.webReadEpoch)).items.map(card=>card.id).sort(),pending.map(item=>item.id).sort());
    assert.equal(f.app.upgradeStatus().safe, false, "waiting Workers retain ownership and block automatic upgrades");
    await new Promise(done => setTimeout(done, 200));
    assert.ok(f.app.store.runs().every(run => run.status === "running"));
    assert.equal(await f.app.message("unrelated chat", "other-message"), "已处理");
    assert.equal(f.resumes.length, 0);
    assert.ok(pending.every(item=>f.mainInputs.at(-1)!.includes(item.id)), "ordinary conversation discovers both pending questions without auto-answering either");
    await f.app.message("reply " + pending[1]!.id, "user-answer-b");
    await until(() => f.resumes.length === 1);
    assert.equal(f.app.interactions.inspect(pending[0]!.id).state, "pending_user");
    assert.equal(f.app.upgradeStatus().safe, false, "one remaining user question still blocks handoff");
    await f.app.message("reply " + pending[0]!.id, "user-answer-a");
    await f.app.idle();
    assert.equal(f.app.upgradeStatus().safe, true);
    assert.ok(f.app.store.runs().every(run => run.status === "succeeded"));
    assert.equal(f.app.interactions.inspect(pending[1]!.id).responseUserMessageId, "user-answer-b");
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: actual service native approvals and denials return to the owning Worker", async () => {
  for (const mode of ["approve", "deny"] as const) {
    const f = await fixture(mode);
    try {
      await f.app.message("dispatch", "user-task");
      if(mode==="approve")await approveRequested(f,1);
      await f.app.idle();
      const item = f.app.interactions.list()[0]!;
      assert.equal(item.state, mode === "approve" ? "approved" : "denied");
      assert.equal(f.resumes.length, 1);
      assert.equal(f.app.store.runs()[0]!.status, "succeeded");
    } finally { await f.cleanup(); }
  }
});

test("HMR-INTERACTION-001: stop invalidates pending questions and rejects stale responses", async () => {
  const f = await fixture("hang");
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.app.interactions.list()[0]?.state === "pending_user");
    const item = f.app.interactions.list()[0]!;
    await f.app.stop(item.runId);
    assert.equal(f.app.interactions.inspect(item.id).state, "cancelled");
    assert.equal(f.app.store.run(item.runId)!.status, "cancelled");
    assert.throws(() => f.app.interactions.respond(item.id, { action: "answer", answer: "late", reason: "late" }), /interaction_not_live/);
    assert.equal(f.resumes.length, 0);
    assert.equal(JSON.stringify(f.app.store.events(item.runId)).includes("合成问题"), false);
  } finally { await f.cleanup(); }
});

test("HMR-INTERACTION-001: restart reconciles lost callbacks and preserves the original main thread", async () => {
  const f = await fixture("hang");
  try {
    await f.app.message("dispatch", "user-task");
    await until(() => f.app.interactions.list()[0]?.state === "pending_user");
    assert.equal(await f.app.idle({ returnOnUserWait: true }), "waiting_user");
    const item = f.app.interactions.list()[0]!, thread = f.app.store.meta("mainThread");
    await f.app.close();
    // Recreate only synthetic persisted crash state; no live process is adopted.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(f.config.runtime, "homer.sqlite"));
    db.prepare("UPDATE runs SET status='running',endedAt=NULL,stopRequestedAt=NULL,stopReason=NULL WHERE id=?").run(item.runId);
    db.prepare("UPDATE worker_interactions SET state='pending_user',code=NULL,decision=NULL,deliveredAt=NULL WHERE id=?").run(item.id);
    db.close();
    const workerCount = f.engines.filter(engine => engine.worker).length;
    const reopened = await f.restart();
    assert.equal(reopened.store.meta("mainThread"), thread);
    assert.equal(reopened.store.run(item.runId)!.status, "interrupted");
    assert.equal(reopened.interactions.inspect(item.id).state, "expired");
    assert.equal(reopened.interactions.inspect(item.id).code, "process_callback_lost");
    assert.throws(() => reopened.interactions.respond(item.id, { action: "answer", answer: "late", reason: "late" }), /interaction_not_live/);
    assert.equal(f.engines.filter(engine => engine.worker).length, workerCount);
    assert.equal(f.resumes.length, 0);
  } finally { await f.cleanup(); }
});
