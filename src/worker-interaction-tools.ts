import type { Tool } from "./engine.js";

const str = { type: "string" };
const nullableString = { type: ["string", "null"] };
function tool(name: string, description: string, properties: Record<string, unknown>, required=Object.keys(properties)): Tool {
  return { type: "function", name, description, inputSchema: {
    type: "object", properties, required, additionalProperties: false,
  } };
}

export const MAIN_INTERACTION_TOOLS: Tool[] = [
  tool("inspect_interaction", "Read a Worker question or native operation request by its exact interactionId in the active Main turn. Read the original task context and user instructions when needed. Inspection records no decision. Main's own native approvals go to the user through the host approval prompt.", { interactionId: str }),
  tool("respond_interaction", "Inspect this Worker request in the same Main turn first. A pending business question can be answered during background work. A pending native request requires the Main turn handling that request or an active user turn authorized to handle it. Before escalation, decide within the user's actual instructions for the specific operation and requested permission subset. After escalation, follow the actual user decision recorded by the host. Answering a business question grants no action permission.", {
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
  tool("escalate_interaction", "Inspect this Worker request in the same Main turn first. Escalate when the user's instructions do not cover the operation, its impact is unclear, information is missing, or personal confirmation is required. A pending native request requires the Main turn handling that request or an active user turn authorized to handle it. End with a brief nonempty final reply explaining the necessity, scope and impact and asking for the user's decision. For a Worker business question you can offer two to eight choices with distinct IDs, labels and consequences. Free text remains available.", {
    interactionId:str,question:str,reason:str,
    options:{type:'array',minItems:2,maxItems:8,items:{type:'object',properties:{id:str,label:str,description:str},required:['id','label','description'],additionalProperties:false}},
  },['interactionId','question','reason']),
];

export const WORKER_INTERACTION_TOOLS: Tool[] = [
  tool("ask_main", "Ask the main Agent for task information that is necessary to continue. Returns a question ID and pending status immediately. Continue independent work or end this turn if blocked. The answer arrives as a message in this Worker conversation. Do not poll or repeat the question. The main Agent may answer, explicitly decline, or ask the user. This is a business question, not permission to perform an operation; native action approvals have their own channel. Never request passwords or tokens.", { question: str }),
];
