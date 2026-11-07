import {createHash} from 'node:crypto';
import type {Tool} from './engine.js';
import {object, string} from './tools.js';
import type {Actor, Authority, RecursiveTasks, WorkerMessageScope} from './recursive-tasks.js';
import type {AttachmentRef} from './media-store.js';
export type MessageAttachmentInput={path:string}|AttachmentRef;

const str = {type: 'string'}, text = {type: 'string', minLength: 1, maxLength: 24000};
const integer = {type: 'integer', minimum: 0};
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const array = (items: unknown) => ({type: 'array', items});
const attachments = array(obj({path: {type:'string',minLength:1,maxLength:4096},assetId:str,revision:{type:'integer',minimum:1}},[]));
const enumeration = (...values: string[]) => ({type: 'string', enum: values});
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): Tool {
  return {type: 'function', name, description, inputSchema: obj(properties, required)};
}

export const RECURSIVE_TOOLS: Tool[] = [
  tool('task_create', 'Record one goal without commissioning or starting execution. Use worker_open for the first authorized dispatch. Notes and source history never grant authority.', {goal: text, notes: {type: 'string', maxLength: 24000}, title: {type: 'string', minLength: 1, maxLength: 80}, workingDirectory: str}, ['goal']),
  tool('work_inspect', 'Select exactly one taskId, messageId or host-returned operationKey. Read a task and its Worker sessions, an authorized user-conversation message, or an operation receipt. With taskId, sourceRequestId selects an original user instruction for review. A receipt or history reference does not authorize replay.', {taskId: str, sourceRequestId: str, messageId: str, operationKey: str}, []),
  tool('task_update', 'Update goal or notes, or explicitly pause, resume, cancel or settle the whole task. '
    + 'To settle, send only taskId, action "settle", outcome ("succeeded", "partial" or "failed"), and optional notes. Choose outcome from the recorded work when the user asks to settle. '
    + 'A goal change requires actual user authority. A paused goal change stays paused. Resume can include a new goal, and reopening settled work requires a new user request. Neither starts a Worker.',
    {taskId: str, goal: text, notes: {type: 'string', maxLength: 24000}, action: enumeration('pause', 'resume', 'cancel', 'settle'), outcome: enumeration('succeeded', 'partial', 'failed'), reason: text}, ['taskId']),
  tool('worker_open', 'Open a Worker conversation. With taskId use that authorized task, otherwise atomically create a task for the current assignment. Optional attachments each select either an absolute path or an exact assetId and revision. Accepted means queued. Inspect existing sessions and receipts after recovery before retrying.', {taskId: str, message: text, workingDirectory: str, attachments}, ['message']),
  tool('worker_send', 'Send a message to the existing Worker conversation. An idle session resumes its native thread and a busy one queues the message. immediate=true supplements the exact current turn. Optional attachments each select either an absolute path or an exact assetId and revision. Inspect the original receipt for unknown effects.', {workerId: str, message: text, immediate: {type: 'boolean'}, attachments}, ['workerId', 'message']),
  tool('worker_read', 'Read original public messages and execution facts for one Worker conversation. Follow nextCursor using after. Select messageId and optionally itemId from nativeMessages to read one original public item. Follow nextOffset using offset for long text.', {workerId: str, after: integer, limit: {type: 'integer', minimum: 1, maximum: 50}, messageId: str, itemId: str, offset: integer}, ['workerId']),
  tool('worker_interrupt', 'Interrupt the selected Worker conversation current execution, retaining history and other sessions. Requested is distinct from confirmed exit. Do not replace or resume an execution whose exit or side effects remain unknown.', {workerId: str, reason: text}, ['workerId']),
  tool('send_user_message', 'Commit an explicit user-visible message with text, selected attachments, or both. Each attachment selects an absolute path or exact assetId and revision. Select taskId when a message is explicitly about one task. Inspect the original receipt after recovery.', {text: {type:'string',maxLength:24000}, attachments, taskId:str}, []),
  tool('archive_work', 'Archive one exact settled task only under a real user turn and its actual authorization. Inspect completion, stopped executions and unresolved actions first. Does not stop work, delete conversations/files or authorize cleanup.', {taskId: str}),
  tool('restore_work', 'Restore one exact archived task to visible history under actual user authorization. Does not start execution.', {taskId: str}),
];

export type RecursiveToolEffects = {
  rootWorkingDirectory?: () => string;
  rootAuthority: (actor: Actor) => Authority | undefined;
  prepareAttachments?: (actor:Actor, operationKey:string, inputs:MessageAttachmentInput[], scope:WorkerMessageScope) => AttachmentRef[];
  readMessage?: (actor:Actor,messageId:string) => unknown;
  sendUserMessage?: (actor:Actor,input:{operationId:string;text?:string;attachments?:MessageAttachmentInput[];taskId?:string}) => unknown;
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

function messageAttachments(value:unknown):MessageAttachmentInput[]|undefined {
  if(value===undefined)return;
  const list=value as Record<string,unknown>[];
  if(list.length>10)throw Error('invalid_attachments');
  return list.map(item=>{
    if(typeof item.path==='string'&&Object.keys(item).length===1)return {path:item.path};
    if(typeof item.assetId==='string'&&/^asset-[a-f0-9-]{36}$/.test(item.assetId)&&typeof item.revision==='number'&&Object.keys(item).length===2)
      return {assetId:item.assetId,revision:item.revision};
    throw Error('invalid_attachments');
  });
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
      if (['taskId', 'messageId', 'operationKey'].filter(key => a[key] !== undefined).length !== 1 || a.sourceRequestId !== undefined && a.taskId === undefined) throw Error('invalid_tool_arguments');
      if (a.messageId !== undefined) {
        if(!this.effects.readMessage)throw Error('message_not_found');
        return this.effects.readMessage(actor,string(a.messageId,200));
      }
      if (a.operationKey !== undefined) {
        const op = this.tasks.operation(string(a.operationKey, 200));
        return this.tasks.inspectOperation(actor, op.operationId, op.scopeId);
      }
      const {sourceRequestIds, version, ...task} = this.tasks.readTask(actor, string(a.taskId, 200));
      const {authorityJson, ...versionFacts} = version;
      const details = {...task, sourceHistoryIds: sourceRequestIds, version: {...versionFacts, authority: JSON.parse(authorityJson??'null') as Authority|null}};
      if (a.sourceRequestId === undefined) return details;
      const source = string(a.sourceRequestId, 200);
      if (!sourceRequestIds.includes(source)) throw Error('task_authority_source_denied');
      return {...details, source: this.tasks.source(actor, source)};
    }
    if (name === 'worker_read') return this.tasks.workerRead(actor, a as {workerId: string; after?: number; limit?: number; messageId?: string; itemId?: string; offset?: number});
    const operationId = toolOperationId(actor, callId);
    actor = {...actor, operationPayload: {tool: name, arguments: args}};
    const refs=messageAttachments(a.attachments);
    const prepare=refs?.length?((key:string,scope:WorkerMessageScope)=>{
      if(!this.effects.prepareAttachments)throw Error('attachment_unavailable');
      return this.effects.prepareAttachments(actor,key,refs,scope);
    }):undefined;
    let result: unknown;
    if (name === 'task_create') {
      result = this.tasks.createTask(actor, {operationId, goal: string(a.goal, 24000), notes:a.notes as string|undefined,
        title:a.title as string|undefined, workingDirectory:a.workingDirectory===undefined?this.effects.rootWorkingDirectory?.():string(a.workingDirectory,4096)});
    } else if (name === 'worker_open') {
      const taskId=a.taskId===undefined?undefined:string(a.taskId,200);
      result=this.tasks.workerOpen(actor,{operationId,taskId,text:string(a.message,24000),
        authority:taskId===undefined?this.effects.rootAuthority(actor):undefined,
        workingDirectory:a.workingDirectory!==undefined?string(a.workingDirectory,4096):taskId===undefined?this.effects.rootWorkingDirectory?.():undefined},prepare);
    } else if (name === 'worker_send') {
      const receipt = this.tasks.workerSend(actor,{operationId,workerId:string(a.workerId,200),text:string(a.message,24000),immediate:a.immediate as boolean|undefined},prepare);
      result = a.immediate ? await this.effects.steer(receipt) : receipt;
    } else if (name === 'worker_interrupt') {
      result = await this.effects.stop(this.tasks.workerStop(actor, {operationId, workerId: string(a.workerId, 200), ...(a.reason === undefined ? {} : {reason: string(a.reason, 24000)})}));
    } else if (name === 'send_user_message') {
      const body=a.text as string|undefined;
      if(!body?.trim()&&!refs?.length)throw Error('invalid_message');
      if(!this.effects.sendUserMessage)throw Error('message_unavailable');
      result=await this.effects.sendUserMessage(actor,{operationId,text:body,attachments:refs,taskId:a.taskId===undefined?undefined:string(a.taskId,200)});
    } else {
      const taskId = string(a.taskId, 200), task = this.tasks.task(taskId);
      const mutation = {operationId, taskId, expectedRevision: task.revision};
      if (name === 'task_update') {
        if (a.action !== undefined && (a.action !== 'resume' && a.goal !== undefined || a.action !== 'settle' && (a.notes !== undefined || a.outcome !== undefined))) throw Error('invalid_tool_arguments');
        if (a.action === 'settle') {
          if (a.outcome === undefined || a.reason !== undefined) throw Error('invalid_tool_arguments');
          result = this.tasks.settleTask(actor, {...mutation, outcome: a.outcome as 'succeeded' | 'partial' | 'failed', ...(a.notes === undefined ? {} : {notes: a.notes as string})});
        } else if (a.action !== undefined) {
          const goal=a.goal===undefined?undefined:string(a.goal,24000);
          const authority=a.action==='resume'&&(goal!==undefined||task.state==='settled')?this.effects.rootAuthority(actor):undefined;
          const receipt = this.tasks.controlTask(actor, {...mutation, action: a.action as 'pause' | 'resume' | 'cancel', goal,authority,...(a.reason === undefined ? {} : {reason: string(a.reason, 24000)})});
          result = a.action === 'resume' ? receipt : await this.effects.stop(receipt);
        } else {
          if (a.outcome !== undefined || a.reason !== undefined || a.goal === undefined && a.notes === undefined) throw Error('invalid_tool_arguments');
          const receipt = this.tasks.updateTask(actor, {...mutation, patch: {...(a.goal === undefined ? {} : {goal: string(a.goal, 24000)}), ...(a.notes === undefined ? {} : {notes: a.notes as string})}, ...(a.goal === undefined ? {} : {authority: this.effects.rootAuthority(actor)})});
          result = a.goal !== undefined && receipt.targets.length ? await this.effects.stop(receipt) : receipt;
        }
      } else if (name === 'archive_work' || name === 'restore_work') {
        result = this.tasks.archiveHistory(actor, mutation, name === 'archive_work');
      } else throw Error('tool_denied');
    }
    this.effects.wake();
    return result;
  }
}
