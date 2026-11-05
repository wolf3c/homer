import {createHash} from 'node:crypto';
import type {Tool} from './engine.js';
import {object, string} from './tools.js';
import type {Actor, Authority, RecursiveTasks} from './recursive-tasks.js';

const str = {type: 'string'}, text = {type: 'string', minLength: 1, maxLength: 24000};
const integer = {type: 'integer', minimum: 0};
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const array = (items: unknown) => ({type: 'array', items});
const enumeration = (...values: string[]) => ({type: 'string', enum: values});
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): Tool {
  return {type: 'function', name, description, inputSchema: obj(properties, required)};
}

export const RECURSIVE_TOOLS: Tool[] = [
  tool('task_create', 'Record one user goal without starting a Worker. Host binds the current user or event scope. Optionally take up existing pendingIds; the first selected item supplies the primary real user source. resultIds select accepted evidence for this work; only a real user turn can add its sources. Workers still select results through worker_open. Notes and historical references never grant authority.', {goal: text, notes: {type: 'string', maxLength: 24000}, title: {type: 'string', minLength: 1, maxLength: 80}, workingDirectory: str, pendingIds: array(str), resultIds: array(str)}, ['goal']),
  tool('work_inspect', 'Select exactly one taskId, accepted resultId or host-returned operationKey. Task reading returns current goal, notes, version.authority, Worker sessions and deliveries. sourceHistoryIds are readable history, not current dispatch authority; sourceRequestId reads one historical original user message. Result reading verifies actual content/bytes. Operation reading returns its original receipt, not permission to replay it; inspect task/delivery facts for current state. After recovery inspect existing Workers and committed receipts before more work.', {taskId: str, sourceRequestId: str, resultId: str, operationKey: str}, []),
  tool('task_update', 'Update goal or notes, or explicitly pause, resume, cancel or settle the whole task. A changed goal requires actual user authority; notes do not change permission. Pause/cancel freeze new starts and require confirmed Worker exit. settle requires outcome and no live/unknown work. Waiting and next steps belong in notes. Use separate calls for changing requirements and controlling execution.', {taskId: str, goal: text, notes: {type: 'string', maxLength: 24000}, action: enumeration('pause', 'resume', 'cancel', 'settle'), outcome: enumeration('succeeded', 'partial', 'failed'), reason: text}, ['taskId']),
  tool('worker_open', 'Open a Worker conversation under an existing task. Give its assignment as message. Omit taskId only when the current scope identifies exactly one task; otherwise select it explicitly. Host binds real user sources, directory and permissions. resultIds transfer only exact authorized accepted results. Accepted means queued, not started. Inspect existing sessions/committed receipts after recovery; do not open another to repair a lost reply.', {taskId: str, message: text, workingDirectory: str, resultIds: array(str)}, ['message']),
  tool('worker_send', 'Send a message to the existing Worker conversation. workerId is the first Run ID returned when it was opened. An idle session resumes its native thread; a busy one queues ordinary messages. immediate=true requests exact-current-turn supplementation; receipt does not prove adoption of new requirements or grant permission. Unknown effects require checking the original receipt.', {workerId: str, message: text, immediate: {type: 'boolean'}}, ['workerId', 'message']),
  tool('worker_read', 'Read durable original public messages and execution facts for one Worker conversation, preserving their actual goals and message identities. Follow nextCursor using after. Select messageId and optionally an itemId from nativeMessages to read one original public item. Follow nextOffset using offset for long text. A missing/unknown result is not success; this read does not adopt a formal result.', {workerId: str, after: integer, limit: {type: 'integer', minimum: 1, maximum: 50}, messageId: str, itemId: str, offset: integer}, ['workerId']),
  tool('worker_interrupt', 'Interrupt the selected Worker conversation current execution, retaining history and other sessions. Requested is distinct from confirmed exit. Do not replace or resume an execution whose exit or side effects remain unknown.', {workerId: str, reason: text}, ['workerId']),
  tool('accept_result', 'Explicitly adopt one accurate message or actual file as a stable formal result. Select exactly one runId for a Worker execution or taskId for Main work. Host binds its actual requirements; messageId or filePath selects the exact source. Read that source first. Ordinary text replies need no formal adoption. File presence and bytes are checked; acceptance does not publish.', {taskId: str, runId: str, messageId: str, filePath: str}, []),
  tool('publish_delivery', 'Explicitly publish selected accepted results and text to an authorized original user source. Host checks exact result versions, files/bytes and channel receipts. No task settlement is implied. prepared means queued: end this turn, do not poll. Unknown sending effects require the original receipt, never re-publication. Ordinary conversation replies need no formal delivery.', {taskId: str, resultIds: array(str), text, sourceRequestId: str}, ['taskId', 'resultIds', 'text']),
  tool('archive_work', 'Archive one exact settled task only under a real user turn and its actual authorization. Inspect completion, stopped executions and unresolved actions first. Does not stop work, delete conversations/files or authorize cleanup.', {taskId: str}),
  tool('restore_work', 'Restore one exact archived task to visible history under actual user authorization. Does not start execution.', {taskId: str}),
];

export type RecursiveToolEffects = {
  rootWorkingDirectory?: () => string;
  currentTaskId?: () => string | undefined;
  rootAuthority: (actor: Actor, pendingIds?: string[]) => Authority;
  wake: () => void;
  stop: (receipt: Record<string, unknown>) => Promise<unknown>;
  steer: (receipt: Record<string, unknown>) => Promise<unknown>;
};

export function toolOperationId(actor: Actor, callId?: string): string {
  if (!actor.threadId || !actor.turnId || typeof callId !== 'string' || !callId.trim()) throw Error('tool_call_identity_required');
  return 'native:' + createHash('sha256').update(JSON.stringify([actor.threadId, actor.turnId, callId])).digest('hex');
}

// Model-side JSON schema is not a trusted validation boundary.
type ArgumentIssue = {path: string; rule: string; fields?: string[]; allowedFields?: string[]};
class InvalidToolArguments extends Error {
  constructor(readonly issues: ArgumentIssue[]) { super('invalid_tool_arguments'); }
}
export function validateToolArguments(value: unknown, schema: Record<string, unknown>): void {
  const issues: ArgumentIssue[] = [];
  const issue = (value: ArgumentIssue) => { if (issues.length < 16) issues.push(value); };
  const validate = (value: unknown, schema: Record<string, unknown>, path: string): void => {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = types.some(type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : typeof value === type);
    if (!matches) { issue({path, rule: 'type'}); return; }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) issue({path, rule: 'enum'});
    if (value === null) return;
    if (typeof value === 'string' && (typeof schema.minLength === 'number' && value.length < schema.minLength || typeof schema.maxLength === 'number' && value.length > schema.maxLength)) issue({path, rule: 'length'});
    if (typeof value === 'number' && (typeof schema.minimum === 'number' && value < schema.minimum || typeof schema.maximum === 'number' && value > schema.maximum)) issue({path, rule: 'range'});
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) validate(item, object(schema.items), path + '[' + index + ']');
      return;
    }
    if (typeof value === 'object') {
      const record = object(value), properties = schema.properties ? object(schema.properties) : {};
      const missing = Array.isArray(schema.required) ? schema.required.filter(key => typeof key === 'string' && !Object.hasOwn(record, key)) : [];
      if (missing.length) issue({path, rule: 'required', fields: missing});
      if (schema.additionalProperties === false && Object.keys(record).some(key => !Object.hasOwn(properties, key))) issue({path, rule: 'additionalProperties', allowedFields: Object.keys(properties)});
      // Paths come from the schema, never untrusted argument names or values.
      for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(record, key)) validate(record[key], object(child), path + '.' + key);
    }
  };
  validate(value, schema, '$');
  if (issues.length) throw new InvalidToolArguments(issues);
}

export class RecursiveTools {
  constructor(readonly tasks: RecursiveTasks, private effects: RecursiveToolEffects) {}
  async call(actor: Actor, name: string, args: unknown, callId?: string): Promise<unknown> {
    const definition = RECURSIVE_TOOLS.find(tool => tool.name === name);
    if (!definition) throw Error('tool_denied');
    if (actor.runId) throw Error('task_main_required');
    validateToolArguments(args, definition.inputSchema);
    const a = object(args);
    if (name === 'work_inspect') {
      if (['taskId', 'resultId', 'operationKey'].filter(key => a[key] !== undefined).length !== 1 || a.sourceRequestId !== undefined && a.taskId === undefined) throw Error('invalid_tool_arguments');
      if (a.resultId !== undefined) return this.tasks.readResult(actor, string(a.resultId, 200));
      if (a.operationKey !== undefined) {
        const op = this.tasks.operation(string(a.operationKey, 200));
        return this.tasks.inspectOperation(actor, op.operationId, op.scopeId);
      }
      const {sourceRequestIds, version, ...task} = this.tasks.readTask(actor, string(a.taskId, 200));
      const {authorityJson, ...versionFacts} = version;
      const details = {...task, sourceHistoryIds: sourceRequestIds, version: {...versionFacts, authority: JSON.parse(authorityJson) as Authority}};
      if (a.sourceRequestId === undefined) return details;
      const source = string(a.sourceRequestId, 200);
      if (!sourceRequestIds.includes(source)) throw Error('task_authority_source_denied');
      return {...details, source: this.tasks.pending.source(actor, source)};
    }
    if (name === 'worker_read') return this.tasks.workerRead(actor, a as {workerId: string; after?: number; limit?: number; messageId?: string; itemId?: string; offset?: number});
    const operationId = toolOperationId(actor, callId);
    actor = {...actor, operationPayload: {tool: name, arguments: args}};
    let result: unknown;
    if (name === 'task_create') {
      result = this.tasks.createTask(actor, {operationId, goal: string(a.goal, 24000), ...(a.notes === undefined ? {} : {notes: a.notes as string}), ...(a.title === undefined ? {} : {title: string(a.title, 80)}), ...(a.resultIds === undefined ? {} : {resultIds: a.resultIds as string[]}), workingDirectory: a.workingDirectory === undefined ? this.effects.rootWorkingDirectory?.() : string(a.workingDirectory, 4096), authority: this.effects.rootAuthority(actor, a.pendingIds as string[] | undefined)});
    } else if (name === 'worker_open') {
      const taskId = a.taskId ?? this.effects.currentTaskId?.();
      if (!taskId) throw Error('task_selection_required');
      result = this.tasks.workerOpen(actor, {operationId, taskId: string(taskId, 200), text: string(a.message, 24000), ...(a.workingDirectory === undefined ? {} : {workingDirectory: string(a.workingDirectory, 4096)}), ...(a.resultIds === undefined ? {} : {resultIds: a.resultIds as string[]})});
    } else if (name === 'worker_send') {
      const receipt = this.tasks.workerSend(actor, {operationId, workerId: string(a.workerId, 200), text: string(a.message, 24000), ...(a.immediate === undefined ? {} : {immediate: a.immediate as boolean})});
      result = a.immediate ? await this.effects.steer(receipt) : receipt;
    } else if (name === 'worker_interrupt') {
      result = await this.effects.stop(this.tasks.workerStop(actor, {operationId, workerId: string(a.workerId, 200), ...(a.reason === undefined ? {} : {reason: string(a.reason, 24000)})}));
    } else if (name === 'accept_result') {
      if (Number(a.taskId !== undefined) + Number(a.runId !== undefined) !== 1) throw Error('invalid_tool_arguments');
      const run = a.runId === undefined ? undefined : this.tasks.run(string(a.runId, 200));
      const task = this.tasks.task(run?.taskId ?? string(a.taskId, 200));
      result = this.tasks.adoptResult(actor, {operationId, taskId: task.id, version: run?.version ?? task.headVersion, ...(run ? {runId: run.id} : {}), ...(a.messageId === undefined ? {} : {messageId: string(a.messageId, 200)}), ...(a.filePath === undefined ? {} : {filePath: string(a.filePath, 4096)})});
    } else {
      const taskId = string(a.taskId, 200), task = this.tasks.task(taskId);
      const mutation = {operationId, taskId, expectedRevision: task.revision};
      if (name === 'task_update') {
        if (a.action !== undefined && (a.goal !== undefined || a.action !== 'settle' && (a.notes !== undefined || a.outcome !== undefined))) throw Error('invalid_tool_arguments');
        if (a.action === 'settle') {
          if (a.outcome === undefined || a.reason !== undefined) throw Error('invalid_tool_arguments');
          result = this.tasks.settleTask(actor, {...mutation, outcome: a.outcome as 'succeeded' | 'partial' | 'failed', ...(a.notes === undefined ? {} : {notes: a.notes as string})});
        } else if (a.action !== undefined) {
          const receipt = this.tasks.controlTask(actor, {...mutation, action: a.action as 'pause' | 'resume' | 'cancel', ...(a.reason === undefined ? {} : {reason: string(a.reason, 24000)})});
          result = a.action === 'resume' ? receipt : await this.effects.stop(receipt);
        } else {
          if (a.outcome !== undefined || a.reason !== undefined || a.goal === undefined && a.notes === undefined) throw Error('invalid_tool_arguments');
          const receipt = this.tasks.updateTask(actor, {...mutation, patch: {...(a.goal === undefined ? {} : {goal: string(a.goal, 24000)}), ...(a.notes === undefined ? {} : {notes: a.notes as string})}, ...(a.goal === undefined ? {} : {authority: this.effects.rootAuthority(actor)})});
          result = a.goal !== undefined && receipt.targets.length ? await this.effects.stop(receipt) : receipt;
        }
      } else if (name === 'publish_delivery') {
        result = this.tasks.publish(actor, {operationId, taskId, version: task.headVersion, resultIds: a.resultIds as string[], text: string(a.text, 24000), ...(a.sourceRequestId === undefined ? {} : {sourceRequestId: string(a.sourceRequestId, 200)})});
      } else if (name === 'archive_work' || name === 'restore_work') {
        result = this.tasks.archiveHistory(actor, mutation, name === 'archive_work');
      } else throw Error('tool_denied');
    }
    this.effects.wake();
    return result;
  }
}
