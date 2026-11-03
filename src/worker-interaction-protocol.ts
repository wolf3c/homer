// Wire contract verified against codex-cli 0.154.0 and 0.163.0 generate-ts --experimental.
// Deliberately excludes session grants and policy amendments. Recheck on engine upgrades.
export type InteractionDecision = {
  action: "approve" | "deny" | "answer" | "cancel";
  reason: string;
  answer?: string;
  answers?: Record<string, string[]>;
  permissions?: unknown;
};
export type NativeInteraction = {
  method: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: "authorization" | "question";
  details: Record<string, unknown>;
};
export const NATIVE_INTERACTION_METHODS = [
  "mcpServer/elicitation/request",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
] as const;

function record(value: unknown, code = "interaction_invalid_request"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, max = 16000): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}
function fail(code = "interaction_invalid_request"): never { throw new Error(code); }

export function nativeInteraction(method: string, params: unknown): NativeInteraction | undefined {
  if (!(NATIVE_INTERACTION_METHODS as readonly string[]).includes(method)) return;
  const p = record(params);
  const mcp = method === "mcpServer/elicitation/request";
  if (!nonempty(p.threadId, 200)) fail();
  if (mcp && p.turnId == null) fail("interaction_scope_denied");
  if (!nonempty(p.turnId, 200) || (!mcp && !nonempty(p.itemId, 200))) fail();
  if (JSON.stringify(p).length > 128 * 1024) fail();
  if (mcp) {
    if (p.mode !== "form") fail("interaction_elicitation_unavailable");
    if (!nonempty(p.serverName, 300) || !nonempty(p.message)) fail();
    if (p._meta == null) fail("interaction_elicitation_unavailable");
    const meta = record(p._meta), schema = record(p.requestedSchema);
    if (schema.type !== "object" || Object.keys(record(schema.properties)).length ||
        Object.keys(schema).some(key => !["$schema", "type", "properties", "required"].includes(key)) ||
        (schema.$schema !== undefined && typeof schema.$schema !== "string") ||
        (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length)))
      fail("interaction_elicitation_unavailable");
    if (meta.codex_approval_kind === "tool_suggestion") {
      if (p.serverName !== "codex_apps" || meta.tool_type !== "plugin" ||
          meta.suggest_type !== "install" || !nonempty(meta.tool_id, 300))
        fail("interaction_elicitation_unavailable");
    } else if (meta.codex_approval_kind === "mcp_tool_call") {
      for (const key of ["tool_title", "tool_description", "tool_name", "source", "connector_id", "connector_name", "connector_description"])
        if (meta[key] != null && typeof meta[key] !== "string") fail();
      if (meta.tool_params_display != null && (!Array.isArray(meta.tool_params_display) || meta.tool_params_display.some(value => {
        const d = record(value);
        return typeof d.name !== "string" || typeof d.display_name !== "string" || !Object.hasOwn(d, "value");
      }))) fail();
    } else fail("interaction_elicitation_unavailable");
  } else if (method === "item/tool/requestUserInput") {
    if (!Array.isArray(p.questions) || !p.questions.length || p.questions.length > 16) fail();
    const ids = new Set<string>();
    for (const value of p.questions) {
      const q = record(value);
      if (q.isSecret === true) fail("interaction_secret_input_unsupported");
      if (!nonempty(q.id, 200) || !nonempty(q.question) || ids.has(q.id)) fail();
      if (q.isSecret !== undefined && typeof q.isSecret !== "boolean") fail();
      if (q.isOther !== undefined && typeof q.isOther !== "boolean") fail();
      if (q.options != null && (!Array.isArray(q.options) || q.options.some(option => !nonempty(record(option).label, 200)))) fail();
      ids.add(q.id);
    }
  } else if (method === "item/permissions/requestApproval") {
    record(p.permissions);
  } else if (method === "item/commandExecution/requestApproval") {
    if (p.kind !== undefined && p.kind !== "command" && p.kind !== "writeStdin") fail();
    if (p.command != null && !nonempty(p.command, 64000)) fail();
    if (p.availableDecisions != null && !Array.isArray(p.availableDecisions)) fail();
  }
  return {
    method, threadId: p.threadId as string, turnId: p.turnId as string,
    itemId: typeof p.itemId==="string"?p.itemId:"mcp-elicitation",
    kind: method === "item/tool/requestUserInput" ? "question" : "authorization",
    // Business state only; never emit this payload in diagnostic events.
    details: JSON.parse(JSON.stringify(p)),
  };
}

// This intentionally requires exact requested paths/entries, not guessed ancestry,
// glob expansion, or caller-supplied session scope.
function permissionSubset(value: unknown, requestedValue: unknown): Record<string, unknown> {
  const code = "interaction_permission_scope";
  const granted = record(value, code), requested = record(requestedValue, code);
  if (Object.keys(granted).some(key => key !== "network" && key !== "fileSystem")) fail(code);
  const result: Record<string, unknown> = {};
  if (granted.network != null) {
    const network = record(granted.network, code), wanted = record(requested.network, code);
    if (Object.keys(network).some(key => key !== "enabled") || network.enabled !== true || wanted.enabled !== true) fail(code);
    result.network = { enabled: true };
  }
  if (granted.fileSystem != null) {
    const fs = record(granted.fileSystem, code), wanted = record(requested.fileSystem, code);
    if (Object.keys(fs).some(key => !["read", "write", "entries", "globScanMaxDepth"].includes(key))) fail(code);
    const narrowed: Record<string, unknown> = { read: null, write: null };
    for (const field of ["read", "write"] as const) {
      const paths = fs[field];
      if (paths != null) {
        if (!Array.isArray(paths) || !Array.isArray(wanted[field])) fail(code);
        const available = wanted[field] as unknown[];
        if (paths.some(path => !nonempty(path, 4096) || !path.startsWith("/") || !available.includes(path))) fail(code);
        narrowed[field] = [...new Set(paths)];
      }
    }
    if (fs.entries != null) {
      if (!Array.isArray(fs.entries) || !Array.isArray(wanted.entries)) fail(code);
      const entryKey = (entry: unknown) => {
        const value = record(entry, code), path = record(value.path, code);
        return JSON.stringify([path.type, path.path, value.access]);
      };
      const entries = wanted.entries.map(entryKey);
      for (const entry of fs.entries) {
        const e = record(entry, code), path = record(e.path, code);
        if (Object.keys(e).some(key => key !== "path" && key !== "access") ||
          path.type !== "path" || !nonempty(path.path, 4096) || !path.path.startsWith("/") ||
          Object.keys(path).some(key => key !== "type" && key !== "path") ||
          !["read", "write"].includes(String(e.access)) || !entries.includes(entryKey(e))) fail(code);
      }
      narrowed.entries = fs.entries;
    }
    if (fs.globScanMaxDepth != null) fail(code); // No wildcard scan grants in this bridge.
    if ((narrowed.read as unknown[] | null)?.length || (narrowed.write as unknown[] | null)?.length || (narrowed.entries as unknown[] | undefined)?.length)
      result.fileSystem = narrowed;
  }
  if (!Object.keys(result).length) fail(code);
  return result;
}

export function nativeResponse(request: NativeInteraction, decision: InteractionDecision): unknown {
  if (!nonempty(decision.reason, 2000)) fail("interaction_reason_required");
  if(request.method==='mcpServer/elicitation/request'){
    const ordinary = (request.details._meta as Record<string, unknown>).codex_approval_kind === 'mcp_tool_call';
    if (decision.action !== 'approve' && decision.action !== 'deny' && !(ordinary && decision.action === 'cancel')) fail('interaction_response_kind');
    return {action: decision.action === 'approve' ? 'accept' : decision.action === 'deny' ? 'decline' : 'cancel', content: null, _meta: null};
  }
  if (request.kind === "question") {
    if (decision.action === "deny") fail("interaction_question_declined");
    if (decision.action !== "answer") fail("interaction_response_kind");
    const answers = record(decision.answers, "interaction_answer_scope");
    const questions = request.details.questions as Record<string, unknown>[];
    if (Object.keys(answers).length !== questions.length) fail("interaction_answer_scope");
    const result: [string, { answers: string[] }][] = [];
    for (const q of questions) {
      const id = q.id as string, list = answers[id];
      if (!Array.isArray(list) || !list.length || list.some(value => !nonempty(value))) fail("interaction_answer_scope");
      const options = q.options as { label: string }[] | null | undefined;
      if (options?.length && q.isOther !== true && list.some(answer => !options.some(option => option.label === answer))) fail("interaction_answer_scope");
      result.push([id, { answers: [...list] }]);
    }
    return { answers: Object.fromEntries(result) };
  }
  if (decision.action !== "approve" && decision.action !== "deny") fail("interaction_response_kind");
  if (request.method === "item/permissions/requestApproval")
    return { permissions: decision.action === "deny" ? {} : permissionSubset(decision.permissions, request.details.permissions), scope: "turn" };
  if (decision.action === "approve") {
    // grantRoot asks for a session-wide root; a single-action bridge cannot grant it.
    if (request.method === "item/fileChange/requestApproval" && request.details.grantRoot) fail("interaction_approval_unavailable");
    const available = request.details.availableDecisions;
    if (Array.isArray(available) && !available.includes("accept")) fail("interaction_approval_unavailable");
    if (request.method === "item/commandExecution/requestApproval" && !request.details.command && !request.details.networkApprovalContext) fail("interaction_approval_unavailable");
  }
  return { decision: decision.action === "approve" ? "accept" : "decline" };
}
