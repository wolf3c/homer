import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nativeInteraction,
  nativeResponse,
} from "../src/worker-interaction-protocol.js";

// Synthetic wire fixtures checked against `codex-cli 0.154.0 app-server generate-ts --experimental`.
const bound = { threadId: "worker-thread", turnId: "worker-turn", itemId: "item-1" };
const command = () => nativeInteraction("item/commandExecution/requestApproval", {
  ...bound, kind: "command", startedAtMs: 1, environmentId: null,
  command: "node --version", cwd: "/synthetic/project", availableDecisions: ["accept", "decline"],
});

test("HMR-INTERACTION-PROTOCOL: native approval is one request, never a session/policy grant", () => {
  const request = command()!;
  assert.equal(request.kind, "authorization");
  assert.deepEqual(nativeResponse(request, { action: "approve", reason: "task check" }), { decision: "accept" });
  assert.deepEqual(nativeResponse(request, { action: "deny", reason: "outside task" }), { decision: "decline" });
  assert.throws(() => nativeResponse(request, { action: "answer", reason: "wrong kind", answer: "yes" }), /interaction_response_kind/);
  const unsupported = nativeInteraction("item/commandExecution/requestApproval", {
    ...bound, kind: "command", command: "test", availableDecisions: ["acceptForSession", "decline"],
  })!;
  assert.throws(() => nativeResponse(unsupported, { action: "approve", reason: "no one-shot choice" }), /interaction_approval_unavailable/);
});

test("HMR-INTERACTION-PROTOCOL: permissions return only a requested subset with turn scope", () => {
  const request = nativeInteraction("item/permissions/requestApproval", {
    ...bound, cwd: "/synthetic/project", permissions: {
      network: { enabled: true }, fileSystem: { read: ["/synthetic/project"], write: ["/synthetic/project/result"] },
    },
  })!;
  assert.deepEqual(nativeResponse(request, { action: "approve", reason: "bounded", permissions: { fileSystem: { write: ["/synthetic/project/result"] } } }), {
    permissions: { fileSystem: { read: null, write: ["/synthetic/project/result"] } }, scope: "turn",
  });
  assert.throws(() => nativeResponse(request, { action: "approve", reason: "bad", permissions: { fileSystem: { read: ["/"] } } }), /interaction_permission_scope/);
  assert.throws(() => nativeResponse(request, { action: "approve", reason: "needs explicit subset" }), /interaction_permission_scope/);
  assert.throws(() => nativeResponse(request, { action: "approve", reason: "no session grants", permissions: { network: { enabled: true }, scope: "session" } }), /interaction_permission_scope/);
  assert.deepEqual(nativeResponse(request, { action: "deny", reason: "no" }), { permissions: {}, scope: "turn" });
});

test("HMR-INTERACTION-PROTOCOL: questions require every exact ID and never default to empty answers", () => {
  const request = nativeInteraction("item/tool/requestUserInput", {
    ...bound, isBlocking: true, autoResolutionMs: null,
    questions: [{ id: "format", header: "Format", question: "Which format?", isOther: false, isSecret: false, options: [{ label: "Markdown", description: "local output" }] }],
  })!;
  assert.deepEqual(nativeResponse(request, { action: "answer", reason: "goal specifies it", answers: { format: ["Markdown"] } }), { answers: { format: { answers: ["Markdown"] } } });
  const invalid: Record<string, string[]>[] = [{}, { wrong: ["Markdown"] }, { format: [] }, { format: ["PDF"] }, { format: ["Markdown"], extra: ["x"] }];
  for (const answers of invalid)
    assert.throws(() => nativeResponse(request, { action: "answer", reason: "invalid", answers }), /interaction_answer_scope/);
  const opaqueId = nativeInteraction("item/tool/requestUserInput", { ...bound, questions: [{ id: "__proto__", question: "Opaque ID?", isOther: true }] })!;
  assert.equal(JSON.stringify(nativeResponse(opaqueId, { action: "answer", reason: "Literal ID", answers: Object.fromEntries([["__proto__", ["literal answer"]]]) })), '{"answers":{"__proto__":{"answers":["literal answer"]}}}');
  assert.throws(() => nativeInteraction("item/tool/requestUserInput", { ...bound, questions: [{ id: "password", question: "Secret", isSecret: true }] }), /interaction_secret_input_unsupported/);
});

test("HMR-INTERACTION-PROTOCOL: modern permission entries compare exact values independently of JSON key order", () => {
  const request = nativeInteraction("item/permissions/requestApproval", { ...bound, permissions: { fileSystem: { read: null, write: null, entries: [{ access: "read", path: { path: "/synthetic/project", type: "path" } }] } } })!;
  const grant = { fileSystem: { entries: [{ path: { type: "path", path: "/synthetic/project" }, access: "read" }] } };
  assert.deepEqual(nativeResponse(request, { action: "approve", reason: "Exact read subset", permissions: grant }), {
    permissions: { fileSystem: { read: null, write: null, ...grant.fileSystem } }, scope: "turn",
  });
});

test("HMR-INTERACTION-PROTOCOL: malformed, ambiguous and unknown requests fail closed", () => {
  assert.equal(nativeInteraction("unknown/method", {}), undefined);
  assert.throws(() => nativeInteraction("item/fileChange/requestApproval", { threadId: "x" }), /interaction_invalid_request/);
  assert.throws(() => nativeInteraction("item/tool/requestUserInput", { ...bound, questions: [{ id: "q", question: "A" }, { id: "q", question: "B" }] }), /interaction_invalid_request/);
  const file = nativeInteraction("item/fileChange/requestApproval", { ...bound, grantRoot: "/synthetic" })!;
  assert.throws(() => nativeResponse(file, { action: "approve", reason: "root grant is session-wide" }), /interaction_approval_unavailable/);
});

test('ordinary MCP accepts arbitrary servers and keeps each decision scoped to this request',()=>{
 for(const serverName of ['arbitrary-alpha','任意服务乙'])for(const [action,want] of [['approve','accept'],['deny','decline'],['cancel','cancel']] as const){
  const request=nativeInteraction('mcpServer/elicitation/request',{threadId:'thread',turnId:'turn',serverName,mode:'form',message:'Review this operation',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:['target'],persist:true}})!;
  assert.equal(request.itemId,'mcp-elicitation');
  assert.deepEqual(nativeResponse(request,{action,reason:'Actual current user decision'}),{action:want,content:null,_meta:null});
 }
});
test('MCP nullable scope and unsupported forms keep accurate local classifications',()=>{
 const p={threadId:'thread',turnId:'turn',serverName:'any',mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}};
 for(const [patch,code] of [[{turnId:null},'interaction_scope_denied'],[{mode:'url',_meta:null},'interaction_elicitation_unavailable'],[{_meta:null},'interaction_elicitation_unavailable'],[{requestedSchema:{type:'object',properties:{},required:['hidden']}},'interaction_elicitation_unavailable'],[{_meta:{codex_approval_kind:'mcp_tool_call',tool_title:12}},'interaction_invalid_request']] as const)assert.throws(()=>nativeInteraction('mcpServer/elicitation/request',{...p,...patch}),new RegExp(code));
});
