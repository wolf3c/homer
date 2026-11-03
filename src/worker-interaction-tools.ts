import type { Tool } from "./engine.js";

const str = { type: "string" };
const nullableString = { type: ["string", "null"] };
function tool(name: string, description: string, properties: Record<string, unknown>): Tool {
  return { type: "function", name, description, inputSchema: {
    type: "object", properties, required: Object.keys(properties), additionalProperties: false,
  } };
}

export const MAIN_INTERACTION_TOOLS: Tool[] = [
  tool("inspect_interaction", "Read one pending Worker question or authorization request, its exact operation and captured user authority. Inspect the run/material too when necessary. No decision is made by inspection.", { interactionId: str }),
  tool("respond_interaction", "Record a reasoned answer, explicit approval or explicit denial for the inspected request. Answering a question never grants action permission. Only requested permission subsets and a single operation are supported. A user reply is associated by the host, not by tool arguments.", {
    interactionId: str,
    action: { type: "string", enum: ["answer", "approve", "deny"] },
    reason: str,
    answer: nullableString,
    answers: {
      type: ["array", "null"], items: {
        type: "object", properties: { questionId: str, answers: { type: "array", items: str, minItems: 1 } },
        required: ["questionId", "answers"], additionalProperties: false,
      },
    },
    permissions: {
      type: ["object", "null"], properties: {
        network: { type: ["object", "null"], properties: { enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false },
        fileSystem: {
          type: ["object", "null"], properties: {
            read: { type: ["array", "null"], items: str }, write: { type: ["array", "null"], items: str },
            entries: { type: ["array", "null"], items: { type: "object", properties: {
              path: { type: "object", properties: { type: { type: "string", enum: ["path"] }, path: str }, required: ["type", "path"], additionalProperties: false },
              access: { type: "string", enum: ["read", "write"] },
            }, required: ["path", "access"], additionalProperties: false } },
          }, required: ["read", "write", "entries"], additionalProperties: false,
        },
      }, required: ["network", "fileSystem"], additionalProperties: false,
    },
  }),
  tool("escalate_interaction", "Mark this request as waiting for the user only when its authority or needed information is missing or unclear. Return from this main turn and ask the recorded question naturally; the original Worker remains pending.", { interactionId: str, question: str, reason: str }),
];

export const WORKER_INTERACTION_TOOLS: Tool[] = [
  tool("ask_main", "Ask the main Agent for task information that is necessary to continue. This call waits and returns to this same Worker. The main Agent may answer, explicitly decline, or ask the user. This is a business question, not permission to perform an operation; native action approvals have their own channel. Never request passwords or tokens.", { question: str }),
];
