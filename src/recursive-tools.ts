import type { PendingSelection } from './pending-items.js';
import type { Tool } from './engine.js';
import { object, string } from './tools.js';
import { TaskCreationRejected, ReviewDecisionRequired, ReviewBlocked, type Actor, type Authority, type Contract, type ChildResolution, type Outcome, type WaitCondition, type RecursiveTasks } from './recursive-tasks.js';
const str = { type: 'string' }, nullable = { type: ['string', 'null'] }, integer = { type: 'integer', minimum: 0 };
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items: unknown) => ({ type: 'array', items });
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const criterion = obj({ id: str, required: { type: 'boolean' }, description: str });
const contract = obj({ workingDirectory: {type:'string',description:'Absolute existing task project directory. Root defaults to the main selected directory; children inherit their parent. Steer cannot relocate an active attempt.'}, goal: str, inputs: array(obj({ type: enumeration('material', 'result','attachment'), id: {type:'string',description:'For attachment, copy the supplied reference.id verbatim: asset-<UUID>@<positive safe integer revision>. Never omit/coerce the revision, select latest, or infer authority from syntax. material and result IDs retain their own semantics.'} })), resultKind: enumeration('markdown','file', 'structured', 'aggregate'), acceptance: obj({ criteria: array(criterion) }) },['goal','inputs','resultKind','acceptance']);
(contract.properties as Record<string,unknown>).presentation=obj({title:{type:'string',minLength:1,maxLength:80},description:{type:'string',minLength:1,maxLength:320}},['title']);
const common = { operationId: str, taskId: str, version: integer, expectedTaskRevision: integer };
const outcome = enumeration('succeeded', 'partial', 'failed', 'cancelled', 'interrupted');
const child = obj({ childTaskId: str, childVersion: integer, disposition: enumeration('included', 'gap', 'stopped', 'transferred'), resultId: nullable, reason: str });
function tool(name: string, description: string, properties: Record<string, unknown>): Tool { return { type: 'function', name, description, inputSchema: obj(properties) }; }
export const WORKER_RECURSIVE_TOOL_NAMES = ['work_inspect','agent_send','inbox_read','inbox_ack','task_wait','adopt_version'];
export const RECURSIVE_TOOLS: Tool[] = [
  tool('archive_work','Main user turn only: archive one exact settled Task from default discovery. Inspect evidence and follow actual user authorization. No stopping, native thread deletion, result deletion or scheduled cleanup.',common),
  tool('restore_work','Main user turn only: cancel archival of one exact Task. Does not start execution or recover permanently deleted bodies.',common),
  tool('delete_work','Main user turn only: irreversible deletion within the exact user-authorized scope. Without runId remove eligible, fully consumed internal send bodies of this Task, retaining results/reviews/publication and identity. With runId and expectedRunRevision delete only that ended Worker native conversation; descendants/references/live/unknown facts block. Inspect first; ask in ordinary conversation if scope is not explicitly authorized. No files, main thread, cascade, inferred age policy or automatic retries.',{...common}),
  tool('task_delegate', 'Create optional independent work under a current task, with its own acceptance contract. Only main creates business Workers. parentTaskId must be null or a main-executed root; nested business Workers are denied. Internal collaboration uses Codex native subagents. parentTaskId=null creates a root only in a real user main turn. Host captures identity, source, authority. Copy attachment reference objects from the host source/read results. task_attachment_reference_invalid means invalid syntax; task_authority_input_denied means unavailable or out of scope. Neither permits automatic ID repair or replay; recover an uncertain receipt using the same operationId and unchanged payload; Workers inherit the authorized scope. Reuse existing Workers after recovery. Include contract.presentation with a short user-facing title and description; never include private authority or internal handoff instructions.', { operationId: str, parentTaskId: nullable, parentVersion: { type: ['integer', 'null'] }, expectedTaskRevision: { type: ['integer', 'null'] }, title: nullable, executorKind: enumeration('main', 'worker'), contract, dependencies: array(obj({ taskId: str, version: integer, required: { type: 'boolean' } })) }),
  tool('work_inspect', 'Read persistent task contract, current version/revision, children, dependencies, operations and actual result bytes/hash. Inspect the result in THIS turn before reviewing. After compaction/recovery read this source of truth again.', { taskId: nullable, runId: nullable, resultId: nullable }),
  tool('agent_send', 'Persist a direct internal message. accepted means queued, not received/processed/completed. A message is neither a dependency nor authorization. Use exact task/version and replyTo when answering. targetRunId restricts receipt and ACK to that exact Run; omit it for delivery across attempts of the same Worker. No user-channel output.', { ...common, recipientAgentId: str, kind: str, payload: { type: 'object', additionalProperties: true }, replyTo: nullable, targetRunId: nullable }),
  tool('inbox_read', 'Main coordination reads only its current claimed input. A real user turn may inspect previously claimed, ended blocked/uncertain inputs for recovery; these are history, not fresh business inputs. Never exposes later pending messages. Worker reads its own inbox and exact Run targets. Preserve IDs and inspect original operations before recovery.', { after: integer }),
  tool('inbox_ack', 'Only the recipient can acknowledge processing/rejection. Main may acknowledge its current input, or a previously claimed ended blocked/uncertain input while following a real user recovery request. Do not replay business to repair a report. This records consumption, not a public report, task acceptance or new authority.', { operationId: str, messageId: str, disposition: enumeration('processed', 'rejected'), reason: str, resultId: nullable }),
  tool('task_wait', 'Worker with a live Run only: persist a precise wait, then END this turn. Main ends its reply directly without this tool. The call returns immediately; host starts another turn on the SAME Run/thread after the condition is satisfied and this turn ended. No further side effects after wait. Coordinators should wait result_or_terminal, not accepted_result they must themselves review.', { ...common, condition: obj({ type: enumeration('result_or_terminal', 'accepted_result', 'message'), taskId: nullable, version: { type: ['integer', 'null'] }, messageId: nullable, replyTo: nullable }) }),
  tool('task_review', 'Coordinator acceptance of one automatically returned candidate and its staged file group after work_inspect of EVERY completionResultId in this same turn. Review the primary resultId once; never settle members separately. Accepted partial remains partial; a child failure never automatically fails the root. Internal accepted results cannot be downloaded until explicit root publication.', { ...common, resultId: str, accepted: { type: 'boolean' }, outcome, reason: str }),
  tool('task_update', 'Choose explicitly: steer active unwritten executing turn and await adopt_version; stop_replace confirms old engine exit before a new attempt; queue preserves current work and activates a later full contract. New queue updates on settled tasks fail with task_queue_not_applicable; use work_inspect for the current version/revision, then explicitly choose stop_replace on the same task for a new attempt, with required child and queued-version dispositions. Existing authority and stop fences still apply. Host never silently substitutes modes. Root main aggregate steer is not applicable. Disposition all queued versions when changing the head.', { ...common, mode: enumeration('steer', 'stop_replace', 'queue'), contract, children: array(obj({ taskId: str, action: enumeration('retain', 'update', 'stop', 'transfer') })), queuedDisposition: array(obj({ version: integer, action: enumeration('cancel', 'rebase'), contract: { ...contract, type: ['object', 'null'] } })), independent: { type: 'boolean' } }),
  tool('adopt_version', 'Executor acknowledgement only after reading the new full contract via work_inspect in this turn. RPC steer acceptance alone is not adoption. Host binds Run, epoch and turn; no writing/delegation/completion until adopted.', { ...common, contractHash: str }),
  tool('task_stop', 'Persist stop request for precise self or entire subtree. requested is distinct from confirmed engine exit. self holds unresolved children for explicit main takeover; siblings continue. An ancestor subtree fence forbids further delegated side effects.', { ...common, scope: enumeration('self', 'subtree'), reason: str }),
  tool('task_continue', 'Explicitly continue from persistent recovery. Keeps task identity, children, messages and recorded execution time. After a process restart creates a NEW attempt; never claims old Worker RPC resumed. Unknown effects block replay.', common),
  tool('task_takeover', 'Assign explicit coordinator responsibility for held work within the same authorization. Does not turn cancelled tasks into success or lift an ancestor stop fence.', common),
  tool('publish_delivery', 'Main only: formally publish settled ROOT version to its original trusted user source. Choose accepted files explicitly with optional publishedFileResultIds; the legacy publishedFileResultId selects one file or null. If both are provided the legacy id must match the first array id. Multiple files are individually downloadable in Web; Wechat/Telegram send one text notice directing to Web. Descendant results stay internal unless explicitly included and published. recorded means host/channel receipt, not user read.', { ...common, resultId: nullable, text: str, publishedFileResultId: nullable }),
];
const deleteSchema=RECURSIVE_TOOLS.find(t=>t.name==='delete_work')!.inputSchema as {properties:Record<string,unknown>};
deleteSchema.properties.runId=str;
deleteSchema.properties.expectedRunRevision=integer;
// Explicit review decision is additive. Fresh accepted:false is a typed denial;
// existing operation receipts are resolved by the domain before that denial.
const reviewSchema=RECURSIVE_TOOLS.find(t=>t.name==='task_review')!.inputSchema as {properties:Record<string,unknown>;required:string[]};
reviewSchema.properties.decision=enumeration('accept','request_changes','terminal_failure');
reviewSchema.properties.revision=obj({contract,children:array(obj({taskId:str,action:enumeration('retain')})),queuedDisposition:array(obj({version:integer,action:enumeration('cancel')}))});
(reviewSchema.properties.revision as Record<string,unknown>).description='For decision=request_changes only. Supply {contract, children, queuedDisposition}; both arrays belong INSIDE revision and must be explicit even when empty. Top-level children instead describes acceptance of existing child results; queuedDisposition is not a top-level review field.';
reviewSchema.required=Object.keys(common).concat(['resultId','outcome','reason']);
reviewSchema.properties.evidence={type:'object',additionalProperties:true};
(reviewSchema.properties.evidence as Record<string,unknown>).description='For accepting a new automatic candidate, include evidence for every required contract.acceptance criterion ID; for partial also describe gaps. Execution completion alone is not evidence.';
reviewSchema.properties.children=array(child);
RECURSIVE_TOOLS.find(t=>t.name==='task_review')!.description+=' Host returns candidates automatically without a business outcome. For these candidates supply evidence and children when accepting or terminating; verify criteria and every child, and report gaps for partial. Native completion does not prove business success.';
const publicationSchema=RECURSIVE_TOOLS.find(t=>t.name==='publish_delivery')!.inputSchema as {properties:Record<string,unknown>};
Object.assign(publicationSchema.properties,{outcome,evidence:{type:'object',additionalProperties:true},children:array(child)});
RECURSIVE_TOOLS.find(t=>t.name==='publish_delivery')!.description+=' For an unsettled main-executed root, use resultId=null and supply outcome, evidence and children: this validates and settles the aggregate atomically with preparing delivery. No separate completion call.';
RECURSIVE_TOOLS.find(t=>t.name==='publish_delivery')!.description+=' A prepared receipt with nextAction=end_turn means publication is queued. Acknowledge the current claimed inbox input if needed, then end the assistant turn directly. The host records delivery after this turn ends; do not poll or wait for recorded in this turn.';
RECURSIVE_TOOLS.find(t=>t.name==='task_review')!.description+=' For repairable quality gaps use decision=request_changes with concrete reason and a complete revision contract. Retain only already-valid normal children; explicitly cancel each queued version. Resolve affected children with existing tools before review. Explicit terminal_failure ends the goal; accepted:true retains its existing outcome semantics. Never send fresh accepted:false. A review_required response means no goal mutation and requires an explicit decision.';
RECURSIVE_TOOLS.find(t=>t.name==='task_review')!.description+=' Always include taskId and version, including for request_changes. Never supply both accepted and decision. For acceptance use decision=accept and omit accepted.';
RECURSIVE_TOOLS.find(t=>t.name==='task_wait')!.description+=' A revision_requested:<resultId> wake means the exact old version was superseded, NOT accepted and NOT whole-task failure. Inspect the task and explicitly rebind any new-version wait/dependency; never silently follow latest.';
// Additive optional field keeps historical single-file calls valid.
publicationSchema.properties.publishedFileResultIds=array(str);
const delegateTool = RECURSIVE_TOOLS.find(t => t.name === 'task_delegate')!;
const delegateSchema = delegateTool.inputSchema as { properties: Record<string, unknown> };
delegateSchema.properties.pending = obj({ items: array(obj({ id: str, expectedRevision: {type:'integer',minimum:1} })), sourceRequestIds: array(str), primarySourceRequestId: str });
delegateTool.description += ' Main may explicitly select pending items/revisions and real sourceRequestIds with one primarySourceRequestId, including in event turns. This records links atomically without closing items; it grants no new authorization. Inspect original sources, use pending_list operationScope=pending_dispatch for receipts.';
delegateTool.description += ' For roots, title must be nonempty and dependencies must be []. Nonempty root dependencies are unsupported, never silently enforced. Historical receipts retain their original meaning. For children title may be null; dependencies constrain acceptance, not scheduling.';
const inspectTool = RECURSIVE_TOOLS.find(t => t.name === 'work_inspect')!;
const inspectSchema = inspectTool.inputSchema as { properties: Record<string, unknown> };
inspectSchema.properties.operationId = str;
inspectSchema.properties.operationScopeId = str;
inspectTool.description += ' To recover your own operation after a lost response, set taskId/runId/resultId=null and supply operationId; optional operationScopeId selects its exact original scope. Scope alone or mixed selectors are invalid. Multiple scopes return operation=null and up to 20 stable candidates with truncated; inspect their source/entity identities and select an explicit scope, never assume the latest succeeded. response is the original persisted response snapshot; state/details describe only the operation phase. Read the returned entity IDs with work_inspect or list_work for current result/delivery facts. This read never retries work, authorizes a new root, or counts as inspecting actual result bytes or the contract for review/adoption.';
export type RecursiveToolEffects = {
  historyNative?: (method:string,params:any)=>Promise<any>;
  rootWorkingDirectory?: () => string;
  rootAuthority: (actor: Actor, selection?: PendingSelection) => Authority;
  wake: () => void;
  stop: (receipt: Record<string, unknown>) => Promise<unknown>;
  update: (receipt: Record<string, unknown>, mode: string) => Promise<unknown>;
};
const num = (v: unknown) => {
  if (!Number.isSafeInteger(v) || Number(v) < 0)
    throw Error('task_invalid_version'); return Number(v);
};
const optional = (v: unknown) => v == null ? undefined : string(v, 200);
// Enforce the same small schema vocabulary used by this catalog at the host
// boundary. Model-side JSON schema is not a trusted validation layer.
type ArgumentIssue={path:string;rule:string;fields?:string[];allowedFields?:string[]};
class InvalidToolArguments extends Error {
  constructor(readonly issues:ArgumentIssue[]){super('invalid_tool_arguments');}
}
export function validateToolArguments(value: unknown, schema: Record<string, unknown>): void {
  const issues:ArgumentIssue[]=[];
  const issue=(value:ArgumentIssue)=>{if(issues.length<16)issues.push(value);};
  const validate=(value:unknown,schema:Record<string,unknown>,path:string):void=>{
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matches = types.some(type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : typeof value === type);
  if (!matches){issue({path,rule:'type'});return;}
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))issue({path,rule:'enum'});
  if (value === null)
    return;
  if (typeof value === 'string' && (typeof schema.minLength === 'number' && value.length < schema.minLength || typeof schema.maxLength === 'number' && value.length > schema.maxLength))
    issue({path,rule:'length'});
  if (typeof value === 'number' && (typeof schema.minimum === 'number' && value < schema.minimum || typeof schema.maximum === 'number' && value > schema.maximum))
    issue({path,rule:'range'});
  if (Array.isArray(value)) {
    for (const [index,item] of value.entries())
      validate(item, object(schema.items),path+'['+index+']');
    return;
  }
  if (typeof value === 'object') {
    const record = object(value), properties = schema.properties ? object(schema.properties) : {};
    const missing=Array.isArray(schema.required)?schema.required.filter(key=>typeof key==='string'&&!Object.hasOwn(record,key)):[];
    if(missing.length)issue({path,rule:'required',fields:missing});
    if(schema.additionalProperties===false&&Object.keys(record).some(key=>!Object.hasOwn(properties,key)))issue({path,rule:'additionalProperties',allowedFields:Object.keys(properties)});
    // Paths and details come only from the trusted schema, never argument names or values.
    for(const [key,child] of Object.entries(properties))if(Object.hasOwn(record,key))validate(record[key],object(child),path+'.'+key);
  }
  };
  validate(value,schema,'$');
  if(issues.length)throw new InvalidToolArguments(issues);
}
export class RecursiveTools {
  constructor(readonly tasks: RecursiveTasks, private effects: RecursiveToolEffects) { }
  async call(actor: Actor, name: string, args: unknown): Promise<unknown> {
    const definition = RECURSIVE_TOOLS.find(t => t.name === name);
    if (!definition)
      throw Error('tool_denied');
    if (actor.runId && !WORKER_RECURSIVE_TOOL_NAMES.includes(name)) throw Error('task_main_required');
    // Decode only the removed legacy fields, without changing the catalog or operation payload.
    let validationSchema=definition.inputSchema;
    if(['task_takeover','task_update','task_review','publish_delivery'].includes(name)){
      validationSchema=structuredClone(validationSchema);
      const properties=object(validationSchema.properties);
      if(name==='task_takeover')properties.coordinatorAgentId=str;
      else{
        const children=object(object(properties.children).items);
        object(children.properties)[name==='task_update'?'coordinatorAgentId':'nextCoordinatorId']=nullable;
      }
    }
    try{validateToolArguments(args, validationSchema);}
    catch(error){
      if(name==='task_review'&&error instanceof InvalidToolArguments)return {ok:false,state:'review_invalid_arguments',code:'invalid_tool_arguments',applied:false,issues:error.issues};
      throw error;
    }
    const a = object(args);
    if(['archive_work','restore_work','delete_work'].includes(name)) {
      const input={operationId:string(a.operationId,200),taskId:string(a.taskId,200),version:num(a.version),expectedTaskRevision:num(a.expectedTaskRevision)};
      if(name==='delete_work')return this.tasks.deleteHistory(actor,{...input,...(a.runId===undefined?{}:{runId:string(a.runId,200)}),...(a.expectedRunRevision===undefined?{}:{expectedRunRevision:num(a.expectedRunRevision)})},this.effects.historyNative);
      return this.tasks.archiveHistory(actor,input,name==='archive_work');
    }
    if (name === 'work_inspect')
      return this.tasks.inspect(actor, { taskId: optional(a.taskId), runId: optional(a.runId), resultId: optional(a.resultId), operationId: optional(a.operationId), operationScopeId: optional(a.operationScopeId) });
    if (name === 'inbox_read')
      return this.tasks.inbox(actor, num(a.after));
    if (name === 'inbox_ack')
      return this.tasks.ack(actor, { operationId: string(a.operationId, 200), messageId: string(a.messageId, 200), disposition: string(a.disposition, 20) as 'processed' | 'rejected', reason: string(a.reason), ...(a.resultId ? { resultId: string(a.resultId, 200) } : {}) });
    if (name === 'task_delegate') {
      let result: unknown;
      if (a.parentTaskId == null) {
        if(typeof a.title!=='string'||!a.title.trim())throw new TaskCreationRejected('task_root_title_required');
        const input = { operationId: string(a.operationId, 200), title: string(a.title, 200), contract: object(a.contract) as Contract, executorKind: a.executorKind === 'main' ? 'main' as const : 'worker' as const,dependencies:a.dependencies as {taskId:string;version:number;required?:boolean}[] };
        result = a.pending ? this.tasks.createPendingRoot(actor, input, a.pending as PendingSelection, () => this.effects.rootAuthority(actor, a.pending as PendingSelection), this.effects.rootWorkingDirectory?.()) : this.tasks.createRoot(actor, { ...input, authority: this.effects.rootAuthority(actor) });
      }
      else {
        if (a.executorKind !== 'worker') throw Error('task_parent_denied');
        if (a.pending !== undefined) throw Error('pending_root_required');
        result = this.tasks.delegate(actor, {
          operationId: string(a.operationId, 200), taskId: string(a.parentTaskId, 200), version: num(a.parentVersion), expectedTaskRevision: num(a.expectedTaskRevision), contract: object(a.contract) as Contract, dependencies: a.dependencies as {
            taskId: string;
            version: number;
            required?: boolean;
          }[]
        });
      }
      this.effects.wake();
      return result;
    }
    const common = { operationId: string(a.operationId, 200), taskId: string(a.taskId, 200), version: num(a.version), expectedTaskRevision: num(a.expectedTaskRevision) };
    let result: unknown;
    if (name === 'agent_send')
      result = this.tasks.send(actor, { ...common, recipientAgentId: string(a.recipientAgentId, 200), kind: string(a.kind, 80), payload: object(a.payload), ...(a.replyTo ? { replyTo: string(a.replyTo, 200) } : {}), ...(a.targetRunId ? { targetRunId: string(a.targetRunId, 200) } : {}) });
    else if (name === 'task_wait') {
      const c = object(a.condition);
      const condition: WaitCondition = c.type === 'message' ? { type: 'message', messageId: optional(c.messageId), replyTo: optional(c.replyTo) } : { type: string(c.type, 30) as 'result_or_terminal' | 'accepted_result', taskId: string(c.taskId, 200), version: num(c.version) };
      result = this.tasks.wait(actor, { ...common, condition });
    }
    else if (name === 'task_review') {
      try {
        result=this.tasks.review(actor,{...common,resultId:string(a.resultId,200),outcome:string(a.outcome,30) as Outcome,reason:string(a.reason),...(a.evidence===undefined?{}:{evidence:object(a.evidence)}),...(a.children===undefined?{}:{children:a.children as ChildResolution[]}),...(a.accepted===undefined?{}:{accepted:a.accepted as boolean}),...(a.decision===undefined?{}:{decision:string(a.decision,30) as 'accept'|'request_changes'|'terminal_failure'}),...(a.revision===undefined?{}:{revision:a.revision as NonNullable<Parameters<RecursiveTasks['review']>[1]['revision']>})});
      } catch(error) {if(error instanceof ReviewDecisionRequired||error instanceof ReviewBlocked)return error.response;throw error;}
    }
    else if (name === 'task_update') {
      const mode = string(a.mode, 30) as 'steer' | 'stop_replace' | 'queue';
      const receipt = this.tasks.update(actor, { ...common, mode, contract: object(a.contract) as Contract, children: a.children as Parameters<RecursiveTasks['update']>[1]['children'], queuedDisposition: a.queuedDisposition as Parameters<RecursiveTasks['update']>[1]['queuedDisposition'], independent: a.independent === true });
      result = await this.effects.update(receipt, mode);
    }
    else if (name === 'adopt_version')
      result = this.tasks.adopt(actor, { ...common, contractHash: string(a.contractHash, 64) });
    else if (name === 'task_stop') {
      const receipt = this.tasks.stop(actor, { ...common, scope: string(a.scope, 20) as 'self' | 'subtree', reason: string(a.reason) });
      result = await this.effects.stop(receipt);
    }
    else if (name === 'task_continue')
      result = this.tasks.continue(actor, common);
    else if (name === 'task_takeover')
      result = this.tasks.takeover(actor, { ...common, ...(a.coordinatorAgentId===undefined?{}:{coordinatorAgentId:string(a.coordinatorAgentId,200)}) });
    else if (name === 'publish_delivery')
      result = this.tasks.publish(actor, { ...common, resultId: a.resultId == null ? null : string(a.resultId, 200), text: string(a.text, 24000), publishedFileResultId: a.publishedFileResultId == null ? null : string(a.publishedFileResultId, 200), ...(a.publishedFileResultIds===undefined?{}:{publishedFileResultIds:a.publishedFileResultIds as string[]}),...(a.outcome===undefined?{}:{outcome:string(a.outcome,30) as Outcome}),...(a.evidence===undefined?{}:{evidence:object(a.evidence)}),...(a.children===undefined?{}:{children:a.children as ChildResolution[]}) });
    else
      throw Error('tool_denied');
    this.effects.wake();
    return result;
  }
}
