import type { Tool } from "./engine.js";
const str = { type: "string" };
const optStr = { type: ["string", "null"] };
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required = Object.keys(properties),
): Tool {
  return {
    type: "function",
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}
export const MAIN_TOOLS = [
  tool(
    "list_work",
    "Read a bounded page of current persistent Tasks, runs and available material names. Archived/deleted history is excluded by default; includeArchived discovers archives. Use exact work_inspect for deleted identities. Follow nextCursor; no automatic cleanup.",
    {includeArchived:{type:'boolean'},cursor:str,limit:{type:'integer',minimum:1,maximum:80}},
    [],
  ),
  tool(
    "dispatch_work",
    "Create a persistent run and enqueue an independent Worker. Multiple dispatches per user message are supported; independent Workers can run concurrently. For revision provide existing matterId; use null for a new matter.",
    { title: str, goal: str, material: str, matterId: optStr },
  ),
  tool(
    "inspect_run",
    "Read a run and its actual artifact and original material for acceptance. This does not itself approve work.",
    { runId: str },
  ),
  tool(
    "review_artifact",
    "Record content acceptance after inspecting actual source and artifact in this turn. Host validates path/existence/nonempty as well.",
    { runId: str, accepted: { type: "boolean" }, summary: str, reason: str },
  ),
  tool(
    "stop_work",
    "Request stopping the specified run; queued work is cancelled immediately, running work requires confirmation.",
    { runId: str },
  ),
];
// Exact historical five-tool contract before bounded list_work. Native resume
// retains these original definitions; its {} input remains valid today. Fence
// the pair so an unrelated future tool change still requires explicit review.
export function canResumeMainTools(saved: string | undefined, current: string) {
  return saved === current || saved === "e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a" && current === "0c28896bd6042284a909a8b692d41215f92a50df8abe9333f9ded11f3d540056";
}
export const WORKER_TOOLS = [
  tool(
    "read_material",
    "Read the adopted contract's assigned materials, results and attachments. Required before staging a file when these inputs exist, including after adopt_version; optional for empty inputs. The host binds the inputs; takes no arguments.",
    {},
  ),
  tool(
    "read_previous",
    "Read the preceding accepted artifact of this matter, if a revision.",
    {},
  ),
  tool(
    "write_markdown",
    "Create a new nonempty Markdown file in this run's output directory. A file cannot be overwritten.",
    { filename: str, content: str },
  ),
];
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_tool_arguments");
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 12000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("invalid_tool_arguments");
  return value;
}
