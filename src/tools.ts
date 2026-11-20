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
    "List tasks by page. Set includeArchived to include archived tasks. Pass nextCursor as cursor for the next page. Use work_inspect for a task’s details and Workers, or worker_read for a known Worker’s messages and execution facts.",
    {includeArchived:{type:'boolean'},cursor:str,limit:{type:'integer',minimum:1,maximum:80}},
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
