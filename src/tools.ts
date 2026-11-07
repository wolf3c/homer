import type { Tool } from "./engine.js";
const str = { type: "string" };
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
    "Read a bounded page of user tasks and lightweight Worker progress. Archived history is excluded unless includeArchived is true. Filter by task state; follow nextCursor. Open one task with work_inspect for notes, sources, conversations and message references. Does not start or clean up work.",
    {state:{type:'string',enum:['open','paused','settled']},includeArchived:{type:'boolean'},cursor:str,limit:{type:'integer',minimum:1,maximum:80}},
    [],
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
