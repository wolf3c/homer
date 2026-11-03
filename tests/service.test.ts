import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Homer, type Message } from "../src/service.js";
import { Store } from "../src/store.js";
import type { Config } from "../src/config.js";
import type {
  EngineLike,
  EngineOptions,
  ToolCall,
  TurnResult,
} from "../src/engine.js";
import {
  MEETING_REVISION,
  assertMeetingArtifact,
} from "./scenarios/meeting-revision.js";
const tick = () => new Promise((r) => setTimeout(r, 10));
async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error("test_wait_timeout");
    await tick();
  }
}
let sequence = 0;
function fixture(
  name: string,
  mode:
    | "normal"
    | "hang"
    | "unconfirmed"
    | "failed"
    | "empty"
    | "start-fail" = "normal",
  timeoutMs = 5000,
) {
  const base = resolve(".codex/scratch/service-tests/" + name);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base + "/workspace/materials", { recursive: true });
  mkdirSync(base + "/runtime", { recursive: true });
  writeFileSync(
    base + "/workspace/materials/meeting.md",
    "林青：写初稿，2026-10-20。整理反馈：负责人和时间待确认。",
  );
  const config: Config = {
    workspace: base + "/workspace",
    runtime: base + "/runtime",
    codexBin: "/usr/bin/false",
    codexHome: base + "/engine",
    model: "mock-only",
    requiresOpenaiAuth: false,
    timeoutMs,
    mainTimeoutMs: 1000,
    stopGraceMs: 100,
  };
  const messages: Message[] = [];
  const scriptedMessages = new Map<string, Record<string, unknown>>();
  const workerDocuments: string[] = [];
  const workerEngines: Fake[] = [];
  const engineOptions: EngineOptions[] = [];
  let active = 0,
    maxActive = 0;
  let sinkFails = false;
  let progressFails = false;
  let mainStopFails = false;
  let mainDeliveryFails = false;
  let mainDeliveryEmpty = false;
  let deliveryGate: Promise<void> | undefined;
  let releaseDelivery: (() => void) | undefined;
  let deliveryWaiting = false;
  class Fake extends EventEmitter implements EngineLike {
    threadId = "mock-thread-" + ++sequence;
    turnId?: string;
    release?: () => void;
    pendingResolve?: (r: TurnResult) => void;
    isWorker: boolean;
    constructor(
      readonly options: EngineOptions,
      readonly tool: (call: ToolCall) => Promise<unknown>,
    ) {
      super();
      this.threadId=options.threadId??this.threadId;
      this.isWorker = options.tools.some((t) => t.name === "read_material");
      if (this.isWorker) workerEngines.push(this);
    }
    async start() {
      if (mode === "start-fail" && !this.isWorker)
        throw new Error("mock_start_failed");
      return this.threadId;
    }
    async call(tool: string, args: unknown) {
      return this.tool({
        threadId: this.threadId,
        turnId: this.turnId!,
        callId: "call-" + ++sequence,
        tool,
        arguments: args,
      });
    }
    async turn(
      text: string,
      options?: { onStarted?: (id: string) => void },
    ): Promise<TurnResult> {
      this.turnId = "mock-turn-" + ++sequence;
      options?.onStarted?.(this.turnId);
      if (this.isWorker) {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (mode === "hang" || mode === "unconfirmed") {
            return await new Promise<TurnResult>(
              (r) => (this.pendingResolve = r),
            );
          }
          await new Promise<void>((r) => (this.release = r));
          if (mode === "failed") throw new Error("mock_engine_failed");
          if (mode !== "empty") {
            await this.call("read_material", {});
            await this.call("write_markdown", {
              filename: "actions.md",
              content:
                workerDocuments.shift() ??
                "# 行动清单\n\n- 林青：写初稿，2026-10-20\n- 待确认：整理反馈；负责人和时间待确认。",
            });
          }
          return {
            status: "completed",
            text: "已写入",
            usage: { total: { totalTokens: 10 } },
          };
        } finally {
          active--;
        }
      }
      if (text.startsWith("[执行结果待审阅]")) {
        const id = text.match(/runId=([\w-]+)/)![1]!;
        const inspected:any=await this.call("inspect_run", { runId: id });
        const facts=await this.call('work_inspect',{taskId:null,runId:id,resultId:null}) as any;
        const result=facts.results.find((r:any)=>r.runId===id&&!r.completionResultId&&r.state==='offered');
        if(!inspected.artifact||JSON.parse(result.payloadJson).execution?.status!=='completed'){
          await this.call('work_inspect',{taskId:null,runId:null,resultId:result.id});
          await this.call('task_review',{operationId:'review-failure-'+id,taskId:facts.task.id,version:facts.task.headVersion,expectedTaskRevision:facts.task.revision,resultId:result.id,accepted:true,outcome:'failed',reason:inspected.run.errorCode??'artifact_missing',evidence:{},children:[]});
          if (mainDeliveryFails) throw new Error("mock_main_disconnected");
          if (mainDeliveryEmpty) return { status: "completed", text: "" };
          return {status:'completed',text:'已核对执行失败及缺失成果。'};
        }
        await this.call("review_artifact", {
          runId: id,
          accepted: true,
          summary: "行动与待确认项已核验",
          reason: "符合要求",
        });
        return { status: "completed", text: "审核完成" };
      }
      if (text.startsWith("[执行结果待交付]")) {
        if (mainDeliveryFails) throw new Error("mock_main_disconnected");
        if (mainDeliveryEmpty) return { status: "completed", text: "" };
        const data: any = await this.call("list_work", {});
        const id = text.match(/runId=([\w-]+)/)![1]!;
        const r = data.runs.find((r: any) => r.id === id);
        return {
          status: "completed",
          text: `${r.status} ${r.artifact ?? r.errorCode}`,
        };
      }
      if(text.startsWith('[内部协作事件')){
        for(const notice of JSON.parse(text.slice(text.indexOf('\n')+1)))await this.call('inbox_ack',{operationId:'ack-'+notice.id,messageId:notice.id,disposition:'processed',reason:'Synthetic event inspected',resultId:null});
        return {status:'completed',text:''};
      }
      const p = scriptedMessages.get(text) ?? JSON.parse(text);
      if (p.action === "dispatch_many") {
        const results = [];
        for (const title of ["第一件", "第二件", "第三件"])
          results.push(await this.call("dispatch_work", {
            title, goal: "行动清单", material: "meeting.md", matterId: null,
          }));
        return { status: "completed", text: JSON.stringify(results) };
      }
      if (p.action === "dispatch")
        return {
          status: "completed",
          text: JSON.stringify(
            await this.call("dispatch_work", {
              title: p.title ?? "会议",
              goal: p.goal ?? "行动清单",
              material: p.material ?? "meeting.md",
              matterId: p.matterId ?? null,
            }),
          ),
        };
      if (p.action === "stop")
        return {
          status: "completed",
          text: JSON.stringify(await this.call("stop_work", { runId: p.id })),
        };
      if (p.action === "status")
        return {
          status: "completed",
          text: JSON.stringify(await this.call("list_work", {})),
        };
      if (p.action === "invalid_review") {
        await assert.rejects(
          () =>
            this.call("review_artifact", {
              runId: p.id,
              accepted: true,
              summary: "fake",
              reason: "fake",
            }),
          /review_requires_inspection/,
        );
        return { status: "completed", text: "拒绝未经检查的验收" };
      }
      return { status: "completed", text: p.text ?? "记住了" };
    }
    async interrupt() {
      return false;
    }
    async close() {
      this.pendingResolve?.({ status: "interrupted", text: "" });
      this.release?.();
      return this.isWorker ? mode !== "unconfirmed" : !mainStopFails;
    }
  }
  const app = new Homer(
    config,
    async (m) => {
      if (
        (sinkFails && m.type === "delivery") ||
        (progressFails && m.type === "progress")
      )
        throw new Error("sink_closed");
      if (m.type === "delivery" && deliveryGate) {
        deliveryWaiting = true;
        await deliveryGate;
      }
      messages.push(m);
    },
    (o, h) => { engineOptions.push(o); return new Fake(o, h); },
  );
  return {
    app,
    messages,
    workerEngines,
    engineOptions,
    respondTo(message: string, response: Record<string, unknown>) {
      scriptedMessages.set(message, response);
    },
    workerWrites(...documents: string[]) {
      workerDocuments.push(...documents);
    },
    get maxActive() {
      return maxActive;
    },
    failDelivery() {
      sinkFails = true;
    },
    failMainStop() {
      mainStopFails = true;
    },
    emptyMainDelivery() {
      mainDeliveryEmpty = true;
    },
    failMainDelivery() {
      mainDeliveryFails = true;
    },
    failProgress() {
      progressFails = true;
    },
    pauseDelivery() {
      deliveryGate = new Promise<void>((r) => (releaseDelivery = r));
    },
    releaseDelivery() {
      releaseDelivery?.();
    },
    get deliveryWaiting() {
      return deliveryWaiting;
    },
  };
}

test("HMR-MEETING-001: offline host regression runs dispatch, live query, delivery and immutable revision", async () => {
  const scenario = MEETING_REVISION;
  const f = fixture(scenario.id);
  const a = f.app;
  const m = scenario.messages;
  // Scripted peer responses are synthetic. Natural-language tool selection is checked only in test:real.
  copyFileSync(
    scenario.fixture.path,
    a.files.materials + "/" + scenario.fixture.filename,
  );
  f.respondTo(m.remember, { action: "chat", text: "收到" });
  f.respondTo(m.recall, { action: "chat", text: "海鸥47" });
  f.respondTo(m.dispatch, {
    action: "dispatch",
    material: scenario.fixture.filename,
  });
  f.respondTo(m.progress, { action: "status" });
  const boundaries =
    "\n## 仅讨论\n帮助文档：周五讨论，未形成行动承诺。\n## 暂缓\n预算申请暂缓，不表示已批准。\n";
  f.workerWrites(
    "# 行动清单\n| 行动 | 负责人 | 时间 |\n| 初稿 | 林青 | 2026-10-20 前 |\n| 检查导出流程 | 陈舟 | 待确认 |\n| 整理试用反馈 | 待确认 | 待确认 |\n" +
      boundaries,
    "# 按负责人分组\n## 林青\n初稿：2026-10-20 前。\n## 陈舟\n检查导出流程：日期待确认。\n## 负责人及时间待确认\n整理试用反馈：负责人和日期待确认。\n" +
      boundaries,
  );
  try {
    await a.start();
    await a.message(m.remember, scenario.id + ":remember");
    assert.match(await a.message(m.recall, scenario.id + ":recall"), /海鸥47/);
    assert.equal(a.store.runs().length, 0);
    await a.message(m.dispatch, scenario.id + ":dispatch");
    await until(() => !!f.workerEngines[0]?.release);
    const progress = JSON.parse(
      await a.message(m.progress, scenario.id + ":query"),
    );
    assert.equal(progress.runs[0].status, "running");
    f.workerEngines[0]!.release!();
    await a.idle();
    const original = a.store.runs()[0]!;
    assert.equal(original.status, "succeeded");
    assert.equal(original.delivery, "delivered");
    const verified = a.files.verify(
      a.files.prepareRun(original.matterId, original.id),
      original.artifact!,
    );
    assertMeetingArtifact(verified.content);
    const revisionMessage = m.revise.replace("{matterId}", original.matterId);
    f.respondTo(revisionMessage, {
      action: "dispatch",
      matterId: original.matterId,
      material: scenario.fixture.filename,
      goal: "按负责人分组，保留事实和原文件",
    });
    await a.message(revisionMessage, scenario.id + ":revise");
    await until(() => !!f.workerEngines[1]?.release);
    f.workerEngines[1]!.release!();
    await a.idle();
    const revised = a.store.runs()[1]!;
    assert.equal(a.store.runs().length, 2);
    assert.equal(revised.matterId, original.matterId);
    assert.notEqual(revised.threadId, original.threadId);
    assert.notEqual(revised.artifact, original.artifact);
    assert.equal(revised.status, "succeeded");
    assert.equal(revised.delivery, "delivered");
    assertMeetingArtifact(readFileSync(revised.artifact!, "utf8"), true);
    assert.equal(
      a.files.verify(
        a.files.prepareRun(original.matterId, original.id),
        original.artifact!,
      ).sha256,
      verified.sha256,
    );
    assert.equal(f.maxActive, 1);
    assert.equal(f.messages.filter((msg) => msg.type === "delivery").length, 2);
  } finally {
    await a.close();
  }
});

test("HMR-PARALLEL-001: main stays responsive while independent Workers overlap", async () => {
  const f = fixture("queue");
  const a = f.app;
  await a.start();
  await a.message(JSON.stringify({ action: "chat", text: "你好" }), "chat");
  assert.equal(a.store.runs().length, 0);
  await a.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.release);
  const snapshot = JSON.parse(
    await a.message(JSON.stringify({ action: "status" }), "status"),
  );
  assert.equal(snapshot.runs[0].status, "running");
  await a.message(
    JSON.stringify({ action: "dispatch", title: "第二件" }),
    "second",
  );
  await until(() => !!f.workerEngines[1]?.release);
  assert.equal(a.store.runs()[0]?.status, "running");
  assert.equal(a.store.runs()[1]?.status, "running");
  f.workerEngines[1]!.release!();
  await until(() => a.store.runs()[1]?.delivery === "delivered");
  assert.equal(a.store.runs()[0]?.status, "running");
  f.workerEngines[0]!.release!();
  await a.idle();
  assert.equal(f.maxActive, 2);
  assert.ok(a.store.runs().every((r) => r.status === "succeeded"));
  assert.ok(a.store.runs().every((r) => r.delivery === "delivered"));
  assert.notEqual(a.store.runs()[0]?.threadId, a.store.runs()[1]?.threadId);
  await a.close();
});

test("T05/T10: explicit revisions preserve artifacts; duplicate user requests do not launch twice", async () => {
  const f = fixture("revision");
  const a = f.app;
  await a.start();
  const input = JSON.stringify({ action: "dispatch" });
  await a.message(input, "same");
  await until(() => !!f.workerEngines[0]?.release);
  await a.message(input, "same");
  assert.equal(a.store.runs().length, 1);
  await assert.rejects(
    () => a.message("different", "same"),
    /request_id_conflict/,
  );
  f.workerEngines[0]!.release!();
  await a.idle();
  const r = a.store.runs()[0]!;
  const receipt = await a.message(input, "same");
  assert.match(receipt, /历史/);
  assert.match(receipt, /succeeded/);
  assert.equal(a.store.runs().length, 1);
  await a.message(
    JSON.stringify({ action: "dispatch", matterId: r.matterId }),
    "revision",
  );
  await until(() => !!f.workerEngines[1]?.release);
  f.workerEngines[1]!.release!();
  await a.idle();
  const revised = a.store.runs()[1]!;
  assert.equal(revised.matterId, r.matterId);
  assert.notEqual(revised.artifact, r.artifact);
  assert.ok(
    a.files.verify(a.files.prepareRun(r.matterId, r.id), r.artifact!).bytes,
  );
  await a.close();
});

test("T07: missing material, actual engine failure and absent artifact cannot report success", async () => {
  for (const [mode, material, code] of [
    ["normal", "missing.md", "material_missing"],
    ["failed", "meeting.md", "mock_engine_failed"],
    ["empty", "meeting.md", "artifact_missing"],
  ] as const) {
    const f = fixture("failure-" + mode, mode);
    const a = f.app;
    await a.start();
    await a.message(JSON.stringify({ action: "dispatch", material }), "first");
    await until(() => !!f.workerEngines[0]?.release);
    f.workerEngines[0]!.release!();
    await a.idle();
    const r = a.store.runs()[0]!;
    assert.equal(r.status, "failed");
    if(mode==='empty'){
      assert.equal(r.errorCode,null,'missing deliverable is an explicit review verdict, not an engine error');
      const result=a.tasks.inspect({agentId:a.store.meta('mainAgentId')!},{runId:r.id}).results.find(result=>result.runId===r.id&&!result.completionResultId)!;
      assert.equal(result.reviewReason,'artifact_missing');
      assert.equal(JSON.parse(result.payloadJson).execution.status,'completed');
    }else assert.equal(r.errorCode, code);
    assert.equal(r.artifact, null);
    await a.close();
  }
});

test("T08: cancellation is separate from confirmation; timeout and unconfirmed stop never succeed", async () => {
  for (const mode of ["hang", "unconfirmed"] as const) {
    const f = fixture("stop-" + mode, mode);
    const a = f.app;
    await a.start();
    await a.message(JSON.stringify({ action: "dispatch" }), "first");
    await until(() => !!f.workerEngines[0]?.pendingResolve);
    const r = a.store.runs()[0]!;
    const stopping = a.stop(r.id);
    assert.ok(a.store.run(r.id)?.stopRequestedAt);
    await stopping;
    await a.idle();
    assert.equal(
      a.store.run(r.id)?.status,
      mode === "hang" ? "cancelled" : "interrupted",
    );
    const types = a.store.events(r.id).map((e) => e.type);
    assert.ok(types.indexOf("stop_requested") < types.indexOf("finished"));
    await a.close();
  }
  const f = fixture("timeout", "hang", 100);
  await f.app.start();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "timeout");
  await f.app.idle();
  assert.equal(f.app.store.runs()[0]?.errorCode, "timeout");
  assert.equal(f.app.store.runs()[0]?.status, "failed");
  await f.app.close();
});

test("T10: failed output acknowledgement keeps result pending for restart", async () => {
  const f = fixture("receipt");
  const a = f.app;
  await a.start();
  f.failDelivery();
  await a.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.release);
  f.workerEngines[0]!.release!();
  await a.idle();
  assert.equal(a.store.runs()[0]?.delivery, "pending");
  await a.close();
});

test("T07/T10: failed main coordination keeps reviewed facts without claiming user delivery", async () => {
  const f = fixture("main-delivery-failure", "failed");
  await f.app.start();
  f.failMainDelivery();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.release);
  f.workerEngines[0]!.release!();
  await f.app.idle();
  const run = f.app.store.runs()[0]!;
  assert.equal(run.status, "failed");
  assert.notEqual(run.delivery, "delivered");
  assert.equal(f.messages.filter((m) => m.type === "delivery").length, 0);
  assert.equal(f.app.tasks.task(f.app.tasks.run(run.id).taskId).outcome,'failed');
  await f.app.close();
});

test("T07/T10: empty legacy coordination reply preserves the outcome without fabricating delivery", async () => {
  const f = fixture("main-delivery-empty", "failed");
  try {
    await f.app.start();
    f.emptyMainDelivery();
    await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
    await until(() => !!f.workerEngines[0]?.release);
    f.workerEngines[0]!.release!();
    await f.app.idle();
    const run = f.app.store.runs()[0]!;
    assert.equal(run.status, "failed");
    assert.notEqual(run.delivery, "delivered");
    const delivery = f.messages.filter((m) => m.type === "delivery");
    assert.equal(delivery.length, 0);
    assert.equal(await f.app.message(JSON.stringify({ action: "chat", text: "after failure" }), "after-empty-delivery"), "after failure");
  } finally {
    await f.app.close();
  }
});

test("T11: main rejects parent traversal; no Worker can be launched with out of scope material", async () => {
  const f = fixture("scope");
  await f.app.start();
  const reply = await f.app.message(
    JSON.stringify({ action: "dispatch", material: "../private.md" }),
    "outside",
  );
  assert.match(reply, /material_path_denied/);
  assert.equal(f.app.store.runs().length, 0);
  await f.app.close();
});

test("T08: an unavailable progress sink cannot prevent a real stop attempt", async () => {
  const f = fixture("progress-output-failure", "hang");
  await f.app.start();
  f.failProgress();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.pendingResolve);
  const id = f.app.store.runs()[0]!.id;
  await f.app.stop(id);
  await f.app.idle();
  assert.equal(f.app.store.run(id)?.status, "cancelled");
  await f.app.close();
});
test("T08: a throwing Worker close persists an unconfirmed stop without hanging the caller",async()=>{
  const f=fixture('stop-close-throws','hang');await f.app.start();
  await f.app.message(JSON.stringify({action:'dispatch'}),'synthetic-stop-close');await until(()=>!!f.workerEngines[0]?.pendingResolve);
  const worker=f.workerEngines[0]!,close=worker.close.bind(worker),id=f.app.store.runs()[0]!.id;
  worker.close=async()=>{throw Error('synthetic_close_failure');};
  try{
    await f.app.stop(id);assert.equal(f.app.tasks.run(id).phase,'uncertain');assert.equal(f.app.upgradeStatus().safe,false);
    assert.equal(f.app.tasks.task(f.app.tasks.run(id).taskId).controlState,'stopping');
  }finally{worker.close=close;await close();await f.app.idle();await f.app.close();}
});

test("T10: a result finishing while another delivery waits is drained without needing restart", async () => {
  const f = fixture("concurrent-deliveries", "failed");
  await f.app.start();
  f.pauseDelivery();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await f.app.message(
    JSON.stringify({ action: "dispatch", title: "第二件" }),
    "second",
  );
  await until(() => !!f.workerEngines[0]?.release);
  f.workerEngines[0]!.release!();
  await until(() => f.deliveryWaiting && !!f.workerEngines[1]?.release);
  f.workerEngines[1]!.release!();
  await until(() => f.app.store.runs().some((r) => r.status === "awaiting_review"));
  f.releaseDelivery();
  await f.app.idle();
  assert.ok(f.app.store.runs().every((r) => r.status === "failed"));
  assert.equal(f.messages.filter((m) => m.type === "delivery").length, 2);
  assert.equal(f.app.store.pendingDeliveries().length, 0);
  await f.app.close();
});

test("T08: unconfirmed main-engine shutdown is reported as an error", async () => {
  const f = fixture("main-stop-unconfirmed");
  await f.app.start();
  f.failMainStop();
  await assert.rejects(() => f.app.close(), /main_stop_unconfirmed/);
  assert.ok(
    f.messages.some(
      (m) => m.type === "error" && m.text.includes("main_stop_unconfirmed"),
    ),
  );
});

test("T07: failed startup retains its cause and cleanup can safely run", async () => {
  const f = fixture("startup-failure", "start-fail");
  await assert.rejects(() => f.app.start(), /mock_start_failed/);
  await assert.doesNotReject(() => f.app.close());
});

test("T08: main stop tool returns confirmed terminal state after emitting the separate request", async () => {
  const f = fixture("main-stop-facts", "hang");
  await f.app.start();
  await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
  await until(() => !!f.workerEngines[0]?.pendingResolve);
  const id = f.app.store.runs()[0]!.id;
  const result = JSON.parse(
    await f.app.message(JSON.stringify({ action: "stop", id }), "stop"),
  );
  assert.equal(result.status, "cancelled");
  assert.ok(f.app.store.events(id).some((e) => e.type === "stop_requested"));
  await f.app.idle();
  await f.app.close();
});

test("T07: an unwritable output directory fails the claimed run instead of leaving a phantom Worker", async () => {
  const f = fixture("unwritable-output");
  await f.app.start();
  chmodSync(f.app.files.outputs, 0o500);
  try {
    await f.app.message(JSON.stringify({ action: "dispatch" }), "first");
    await f.app.idle();
    assert.equal(f.app.store.runs()[0]?.status, "failed");
    assert.equal(f.workerEngines.length, 0);
  } finally {
    chmodSync(f.app.files.outputs, 0o700);
    await f.app.close();
  }
});

test("HMR-PARALLEL-001: one message can dispatch several Workers; replay adds none", async () => {
  const f = fixture("multi-dispatch");
  try {
    await f.app.start();
    const input = JSON.stringify({ action: "dispatch_many" });
    await f.app.message(input, "multi");
    await until(() => f.workerEngines.length === 3 && f.workerEngines.every(e => !!e.release));
    assert.equal(f.maxActive, 3);
    assert.equal(f.app.store.runs().length, 3);
    assert.equal(new Set(f.app.store.runs().map(r => r.matterId)).size, 3);
    await f.app.message(input, "multi");
    assert.equal(f.app.store.runs().length, 3);
    for (const engine of [...f.workerEngines].reverse()) engine.release!();
    await f.app.idle();
    assert.ok(f.app.store.runs().every(r => r.status === "succeeded" && r.delivery === "delivered"));
    assert.equal(new Set(f.app.store.runs().map(r => r.artifact)).size, 3);
    const receipt = await f.app.message(input, "multi");
    for (const r of f.app.store.runs()) assert.ok(receipt.includes(r.artifact!));
  } finally { await f.app.close(); }
});

test("HMR-PARALLEL-001: stopping one Worker leaves the other running; shutdown stops all", async () => {
  const f = fixture("parallel-stop", "hang");
  await f.app.start();
  try {
    await f.app.message(JSON.stringify({ action: "dispatch_many" }), "many");
    await until(() => f.workerEngines.length === 3 && f.workerEngines.every(e => !!e.pendingResolve));
    const [one, two, three] = f.app.store.runs();
    await f.app.stop(two!.id);
    assert.equal(f.app.store.run(two!.id)?.status, "cancelled");
    assert.equal(f.app.store.run(one!.id)?.status, "running");
    assert.equal(f.app.store.run(three!.id)?.status, "running");
    const snapshot = JSON.parse(await f.app.message(JSON.stringify({ action: "status" }), "query"));
    assert.equal(snapshot.runs.filter((r: any) => r.status === "running").length, 2);
    await f.app.close();
    assert.equal(f.messages.filter(m => m.type === "progress" && m.text.includes("已确认停止")).length, 3);
  } finally { await f.app.close(); }
});

test("HMR-PARALLEL-001: one failed Worker does not block another artifact and delivery", async () => {
  const f = fixture("parallel-partial-failure");
  try {
    await f.app.start();
    await f.app.message(JSON.stringify({ action: "dispatch", material: "missing.md" }), "missing");
    await f.app.message(JSON.stringify({ action: "dispatch" }), "valid");
    await until(() => f.workerEngines.length === 2 && f.workerEngines.every(e => !!e.release));
    for (const e of f.workerEngines) e.release!();
    await f.app.idle();
    const [failed, succeeded] = f.app.store.runs();
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.errorCode, "material_missing");
    assert.equal(succeeded?.status, "succeeded");
    assert.ok(f.app.store.runs().every(r => r.delivery === "delivered"));
  } finally { await f.app.close(); }
});

test("HMR-UPGRADE-001: safe boundary waits for queued main work, workers and delivery", async () => {
  const f = fixture("upgrade-boundary");
  const a = f.app;
  try {
    await a.start();
    await a.idle();
    assert.equal(a.upgradeStatus().safe, true);
    const turn = a.message(JSON.stringify({ action: "chat", text: "hello" }));
    assert.equal(a.upgradeStatus().safe, false);
    await turn;
    await a.message(JSON.stringify({ action: "dispatch", material: "meeting.md" }));
    await until(() => !!f.workerEngines[0]?.release);
    assert.equal(a.upgradeStatus().safe, false);
    f.pauseDelivery();
    f.workerEngines[0]!.release!();
    await until(() => f.deliveryWaiting);
    assert.equal(a.upgradeStatus().safe, false);
    f.releaseDelivery();
    await a.idle();
    assert.equal(a.upgradeStatus().safe, true);
  } finally { await a.close(); }
});

test("T09: tool upgrades never silently replace the saved main conversation", async () => {
  const f = fixture("tool-definition-upgrade");
  f.app.store.setMeta("mainThread", "legacy-main");
  f.app.store.setMeta("mainToolsHash", "old-tools");
  try {
    await assert.rejects(() => f.app.start(), /main_tools_migration_required/);
    assert.equal(f.engineOptions.length, 0);
    const saved = new Store(f.app.config.runtime + "/homer.sqlite");
    try {
      assert.equal(saved.meta("mainThread"), "legacy-main");
      assert.equal(saved.meta("mainToolsHash"), "old-tools");
    } finally { saved.close(); }
  } finally { await f.app.close(); }
});

test("T09: normal restarts resume the same main conversation; failed resume preserves it", async () => {
  const f = fixture("main-conversation-resume");
  await f.app.start();
  const savedThread = f.app.store.meta("mainThread");
  await f.app.close();
  let attempts = 0;
  const factory = (options: EngineOptions) => {
    assert.equal(options.threadId, savedThread);
    return Object.assign(new EventEmitter(), {
      async start() {
        attempts++;
        if (attempts === 2) throw new Error("engine_resume_failed");
        return attempts === 3 ? "unexpected-new-thread" : options.threadId!;
      },
      async turn() { return {status: "completed", text: "continued"}; },
      async interrupt() { return true; },
      async close() { return true; },
    });
  };
  const resumed = new Homer(f.app.config, async () => {}, factory);
  try {
    await resumed.start();
    assert.equal(resumed.store.meta("mainThread"), savedThread);
  } finally { await resumed.close(); }
  const failed = new Homer(f.app.config, async () => {}, factory);
  await assert.rejects(() => failed.start(), /engine_resume_failed/);
  await failed.close();
  const mismatched = new Homer(f.app.config, async () => {}, factory);
  await assert.rejects(() => mismatched.start(), /main_resume_thread_mismatch/);
  await mismatched.close();
  assert.equal(attempts, 3);
  const saved = new Store(f.app.config.runtime + "/homer.sqlite");
  try { assert.equal(saved.meta("mainThread"), savedThread); }
  finally { saved.close(); }
});

// HMR-MODEL-001: model selection must preserve the conversation and account boundary.
test("T09: legacy bindings upgrade only with the original config, then model changes resume the same thread", async () => {
  const f = fixture("model-switch-binding");
  await f.app.start();
  const config = f.app.config;
  const savedThread = f.app.store.meta("mainThread");
  await f.app.close();
  const legacy = createHash("sha256").update(JSON.stringify({ workspace: config.workspace, model: config.model, codexHome: config.codexHome, baseUrl: config.baseUrl })).digest("hex");
  const store = new Store(config.runtime + "/homer.sqlite");
  store.setMeta("binding", legacy);
  store.db.prepare("DELETE FROM meta WHERE key='bindingVersion'").run();
  store.close();
  assert.throws(() => new Homer({ ...config, model: "gpt-6.1-sol" }, async () => {}), /runtime_configuration_changed/);
  const upgraded = new Homer(config, async () => {});
  await upgraded.close();
  let resumedId: string | undefined;
  const switched = new Homer({ ...config, model: "gpt-6.1-sol", effort: "medium" }, async () => {}, options => {
    resumedId = options.threadId;
    return Object.assign(new EventEmitter(), {
      async start() { return options.threadId!; },
      async turn() { return { status: "completed", text: "continued" }; },
      async interrupt() { return true; },
      async close() { return true; },
    });
  });
  try {
    await switched.start();
    assert.equal(resumedId, savedThread);
    assert.equal(switched.store.meta("mainThread"), savedThread);
    assert.equal(switched.store.meta("bindingVersion"), "2");
  } finally { await switched.close(); }
  for (const changed of [
    { workspace: config.workspace + "-other" },
    { codexHome: config.codexHome + "-other" },
    { baseUrl: "https://example.invalid/v1" },
    { keyEnv: "OTHER_ACCOUNT_KEY" },
    { requiresOpenaiAuth: true },
  ]) assert.throws(() => new Homer({ ...config, ...changed }, async () => {}), /runtime_configuration_changed/);
});

test('accepted user sends notify config checks once; duplicate, rejected and first-launch inputs do not',async()=>{
 const f=fixture('runtime-config-accepted-user-20261029');
 try{
  await f.app.start();const reasons:string[]=[];f.app.onStateChange(reason=>{if(reason)reasons.push(reason);});
  const system={requestId:'synthetic-config-first',text:'synthetic initialization'};
  f.app.submitMessage(system,{source:'first_launch',persist:()=>{}});
  assert.equal(reasons.filter(v=>v==='user-input').length,0);
  const input={requestId:'synthetic-config-user',text:'synthetic user message'};
  assert.equal(f.app.submitMessage(input).fresh,true);assert.equal(reasons.filter(v=>v==='user-input').length,1);
  assert.equal(f.app.submitMessage(input).fresh,false);assert.equal(reasons.filter(v=>v==='user-input').length,1);
  assert.throws(()=>f.app.submitMessage({...input,text:'conflicting retry'}));assert.equal(reasons.filter(v=>v==='user-input').length,1);
 }finally{await f.app.close();}
});
