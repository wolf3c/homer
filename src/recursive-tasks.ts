import {isExecutionGuardStop} from './execution-limits.js';
import {publicActivityName,type PublicActivity,type ActivityTarget,type ActivityLink} from './activity-facts.js';
import {USER_AUTHORITY_MAX_LENGTH} from './user-intent.js';
import {AttachmentInputError,parseAttachmentReference} from './attachment-reference.js';
import type {AttachmentRef} from './media-store.js';
import { createHash, randomUUID } from 'node:crypto';
import { PendingItems, type PendingSelection } from './pending-items.js';
import { join, isAbsolute } from 'node:path';
import { realpathSync,statSync } from 'node:fs';
import type { Store, Run, Dispatch } from './store.js';
import type { Files } from './files.js';
import type {TurnResult} from './engine.js';
// Host-created connection context. This object is never accepted from tool arguments.
export type Actor = {
  agentId: string;
  sourceRequestId?: string;
  runId?: string;
  epoch?: number;
  threadId?: string;
  turnId?: string;
};
export type Outcome = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export type Contract = {
  presentation?:{title:string;description?:string};
  workingDirectory?:string;
  goal: string;
  inputs: {
    type: 'material' | 'result' | 'attachment';
    id: string;
  }[];
  resultKind: 'markdown' | 'file' | 'structured' | 'aggregate';
  acceptance: {
    criteria: {
      id: string;
      required: boolean;
      description: string;
    }[];
  };
};
export type Authority = {
  sourceRequestIds?: string[];
  sourceRequestId: string | null;
  description: string;
  materials: string[];
  resultIds: string[];
  attachments?:string[];
  collaborateTaskIds: string[];
  // Historical host-generated budget, retained verbatim when reading old facts.
  // It no longer grants or limits execution; sources and scope still do.
  maxActiveMs?: number;
};
export type Task = {
  id: string;
  matterId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  createdByAgentId: string;
  parentVersion: number | null;
  executorKind: 'main' | 'worker';
  executorAgentId: string;
  coordinatorAgentId: string;
  headVersion: number;
  currentRunId: string | null;
  state: string;
  outcome: Outcome | null;
  revision: number;
  controlState: 'normal' | 'held' | 'stopping';
  subtreeStopOpId: string | null;
  historyState?: 'visible' | 'archived' | 'deleted';
  waitingEnteredAt?: number | null;
  reviewEnteredAt?: number | null;
  settledAt?: number | null;
};
export type TaskRun = Run & {
  taskId: string;
  workingDirectory?:string|null;
  contractVersion: number;
  targetVersion: number | null;
  phase: string;
  epoch: number;
  stateRevision: number;
  activeMs: number;
  checkpointJson: string | null;
  replacesRunId: string | null;
};
type Version = {
  presentationJson?:string|null;
  taskId: string;
  version: number;
  goal: string;
  inputsJson: string;
  resultKind: Contract['resultKind'];
  acceptanceJson: string;
  authorityJson: string;
  sourceRequestId: string | null;
  triggerOpId: string;
  workingDirectory?:string|null;
};
type Result = {
  id: string;
  taskId: string;
  version: number;
  runId: string | null;
  producerAgentId: string;
  kind: Contract['resultKind'];
  payloadJson: string;
  filePath: string | null;
  sha256: string | null;
  state: string;
  outcome: Outcome | null;
  reviewAgentId: string | null;
  reviewReason: string | null;
  evidenceJson: string;
  operationKey: string;
  completionResultId: string | null;
};
type Delivery = {
  id: string;
  rootTaskId: string;
  version: number;
  resultId: string | null;
  outcome: Outcome;
  publishedFileResultId: string | null;
  publishedFileResultIdsJson: string | null;
  routeSourceRequestId: string | null;
  text: string;
  historyMessageId: string;
  state: string;
  revision: number;
  attemptedAt: number | null;
  revokedAt: number | null;
  operationKey: string;
};
type Message = {
  seq: number;
  id: string;
  senderAgentId: string;
  senderRunId: string | null;
  senderEpoch: number | null;
  recipientAgentId: string;
  taskId: string | null;
  taskVersion: number | null;
  targetRunId: string | null;
  kind: string;
  replyTo: string | null;
  causationId: string | null;
  operationKey: string;
  payloadJson: string;
};
type Operation = {
  id: string;
  actorAgentId: string;
  scopeId: string;
  operationId: string;
  kind: string;
  payloadHash: string;
  state: string;
  detailsJson: string;
  responseJson: string | null;
  revision: number;
};
type TaskSelector = { taskId?: string; runId?: string; resultId?: string };
type InspectionSelector = TaskSelector & { operationId?: string; operationScopeId?: string };
type Mutation = {
  operationId: string;
  taskId: string;
  version: number;
  expectedTaskRevision: number;
};
export type ChildResolution = {
  childTaskId: string;
  childVersion: number;
  disposition: 'included' | 'gap' | 'stopped' | 'transferred';
  resultId?: string;
  nextCoordinatorId?: string;
  reason: string;
};
export type WaitCondition = {
  type: 'result_or_terminal' | 'accepted_result';
  taskId: string;
  version: number;
} | {
  type: 'message';
  messageId?: string;
  replyTo?: string;
};
// Emitted only after a new creation transaction has rolled back completely.
export class TaskCreationRejected extends Error {}
// A typed, rolled-back contract denial; never classifies arbitrary engine errors.
export class ReviewDecisionRequired extends Error {
  constructor(readonly response: Record<string, unknown>) { super('review_decision_required'); }
}
export class ReviewBlocked extends Error {
  constructor(readonly response:Record<string,unknown>) { super(String(response.code)); }
}
export type RecursiveTaskLifecycle = {
  operationConfirmed?(actor:Actor,key:string,kind:string,response:Record<string,unknown>):void;
  validateAttachments?(sourceRequestId:string,refs:readonly AttachmentRef[]):void;
  validateActor(actor: Actor): void;
  reviewExitConfirmed?(run:TaskRun):boolean;
};
const live = (r: Run) => ['queued', 'running', 'awaiting_review'].includes(r.status);
const id = (kind: string) => kind + '-' + randomUUID();
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v !== undefined).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export const recursiveHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const json = (value: unknown) => JSON.stringify(value);
function requireText(value: unknown, max = 24000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error('task_invalid_input');
}
function requireObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('task_invalid_input');
}
export const RECURSIVE_SCHEMA_VERSION='4';
const RESULT_COLUMNS='id,taskId,version,runId,producerAgentId,kind,payloadJson,filePath,sha256,state,outcome,reviewAgentId,reviewReason,evidenceJson,operationKey';
const DELIVERY_COLUMNS='id,rootTaskId,version,resultId,outcome,publishedFileResultId,routeSourceRequestId,text,historyMessageId,state,revision,attemptedAt,revokedAt,operationKey';
// One domain module on the existing Store connection and transaction owner.
// It owns task truth, not a second store, authority service, or scheduler.
export class RecursiveTasks {
  private inspected = new Map<string, string>();
  readonly pending = new PendingItems(this);
  constructor(readonly store: Store, readonly files: Files, private lifecycle?: RecursiveTaskLifecycle) { }
  private get db() { return this.store.db; }
  private one<T>(sql: string, ...args: (string | number | null)[]): T | undefined { return this.db.prepare(sql).get(...args) as T | undefined; }
  private all<T>(sql: string, ...args: (string | number | null)[]): T[] { return this.db.prepare(sql).all(...args) as T[]; }
  private sql(sql: string, ...args: (string | number | null)[]) { return this.db.prepare(sql).run(...args); }
  private tx<T>(fn: () => T): T { return this.store.transaction(fn); }
  private column(table: string, name: string, definition: string) {
    if (!this.all<{
      name: string;
    }>('PRAGMA table_info(' + table + ')').some(c => c.name === name))
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  migrate() {
    this.migrateTasks();
    for(const name of ['waitingEnteredAt','reviewEnteredAt','settledAt'])this.column('tasks',name,'INTEGER');
    this.column('task_versions','presentationJson','TEXT');
    // Existing recipient/state index cannot serve legacy selectors, which join
    // on messageId and filter state. Keep receipt/recipient semantics unchanged.
    this.db.exec("CREATE INDEX IF NOT EXISTS agent_receipt_state ON agent_receipts(state,messageId)");
    this.pending.migrate();
  }
  private migrateTasks() {
    if (this.store.meta('recursiveSchemaVersion') === RECURSIVE_SCHEMA_VERSION) {
      // A matching historical schema number does not authorize an old business
      // tree. Refuse it before pending/recovery writes; never rewrite history.
      if (this.one(`SELECT 1 FROM tasks t LEFT JOIN tasks p ON p.id=t.parentTaskId
        WHERE t.coordinatorAgentId IS NOT ?
          OR (t.parentTaskId IS NULL AND t.rootTaskId<>t.id)
          OR (t.parentTaskId IS NOT NULL AND (p.id IS NULL OR p.executorKind<>'main'
            OR p.parentTaskId IS NOT NULL OR t.executorKind<>'worker' OR t.rootTaskId<>p.id)) LIMIT 1`,this.store.meta('mainAgentId')??null))
        throw Error('task_business_layer_unsupported');
      return;
    }
    if (this.store.meta('recursiveSchemaVersion') || this.store.matters().length) throw Error('recursive_schema_unsupported');
    this.tx(() => {
      this.column('matters', 'rootTaskId', 'TEXT');
      this.column('matters', 'revision', 'INTEGER NOT NULL DEFAULT 0');
      for (const [name, definition] of Object.entries({ taskId: 'TEXT', contractVersion: 'INTEGER', targetVersion: 'INTEGER', workingDirectory:'TEXT', phase: "TEXT NOT NULL DEFAULT 'ready'", epoch: 'INTEGER NOT NULL DEFAULT 0', stateRevision: 'INTEGER NOT NULL DEFAULT 0', activeMs: 'INTEGER NOT NULL DEFAULT 0', checkpointJson: 'TEXT', replacesRunId: 'TEXT' }))
        this.column('runs', name, definition);
      this.db.exec(`
CREATE TABLE tasks(id TEXT PRIMARY KEY,matterId TEXT NOT NULL REFERENCES matters(id),rootTaskId TEXT NOT NULL REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,parentTaskId TEXT REFERENCES tasks(id),createdByAgentId TEXT NOT NULL,parentVersion INTEGER,executorKind TEXT NOT NULL CHECK(executorKind IN ('main','worker')),executorAgentId TEXT NOT NULL,coordinatorAgentId TEXT NOT NULL,headVersion INTEGER NOT NULL,currentRunId TEXT REFERENCES runs(id),state TEXT NOT NULL,outcome TEXT,revision INTEGER NOT NULL,controlState TEXT NOT NULL,subtreeStopOpId TEXT REFERENCES operations(id),historyState TEXT NOT NULL DEFAULT 'visible' CHECK(historyState IN ('visible','archived','deleted')),CHECK(parentTaskId IS NULL OR (executorKind='worker' AND parentTaskId=rootTaskId)));
CREATE TABLE operations(id TEXT PRIMARY KEY,actorAgentId TEXT NOT NULL,scopeId TEXT NOT NULL,operationId TEXT NOT NULL,kind TEXT NOT NULL,payloadHash TEXT NOT NULL,state TEXT NOT NULL,detailsJson TEXT NOT NULL,responseJson TEXT,revision INTEGER NOT NULL DEFAULT 0,UNIQUE(actorAgentId,scopeId,operationId));
CREATE TABLE task_versions(taskId TEXT NOT NULL REFERENCES tasks(id),version INTEGER NOT NULL,goal TEXT NOT NULL,inputsJson TEXT NOT NULL,resultKind TEXT NOT NULL,acceptanceJson TEXT NOT NULL,authorityJson TEXT NOT NULL,sourceRequestId TEXT,triggerOpId TEXT NOT NULL UNIQUE REFERENCES operations(id),workingDirectory TEXT,presentationJson TEXT,PRIMARY KEY(taskId,version));
CREATE TABLE task_dependencies(taskId TEXT NOT NULL,version INTEGER NOT NULL,dependsOnTaskId TEXT NOT NULL,dependsOnVersion INTEGER NOT NULL,required INTEGER NOT NULL,condition TEXT NOT NULL DEFAULT 'accepted_result',PRIMARY KEY(taskId,version,dependsOnTaskId,dependsOnVersion),FOREIGN KEY(taskId,version) REFERENCES task_versions(taskId,version),FOREIGN KEY(dependsOnTaskId,dependsOnVersion) REFERENCES task_versions(taskId,version));
CREATE TABLE child_resolutions(parentTaskId TEXT NOT NULL,parentVersion INTEGER NOT NULL,childTaskId TEXT NOT NULL REFERENCES tasks(id),childVersion INTEGER NOT NULL,disposition TEXT NOT NULL,resultId TEXT REFERENCES results(id),nextCoordinatorId TEXT,reason TEXT NOT NULL,operationKey TEXT NOT NULL REFERENCES operations(id),PRIMARY KEY(parentTaskId,parentVersion,childTaskId),FOREIGN KEY(parentTaskId,parentVersion) REFERENCES task_versions(taskId,version));
CREATE TABLE agent_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,senderAgentId TEXT NOT NULL,senderRunId TEXT REFERENCES runs(id),senderEpoch INTEGER,recipientAgentId TEXT NOT NULL,taskId TEXT REFERENCES tasks(id),taskVersion INTEGER,targetRunId TEXT REFERENCES runs(id),kind TEXT NOT NULL,replyTo TEXT REFERENCES agent_messages(id),causationId TEXT REFERENCES agent_messages(id),operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),payloadJson TEXT NOT NULL);
CREATE TABLE agent_receipts(messageId TEXT NOT NULL REFERENCES agent_messages(id),recipientAgentId TEXT NOT NULL,state TEXT NOT NULL,offeredRunId TEXT REFERENCES runs(id),offeredEpoch INTEGER,offeredTurnId TEXT,processedBy TEXT,resultRef TEXT REFERENCES results(id),revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(messageId,recipientAgentId));
CREATE TABLE run_waits(id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES runs(id),epoch INTEGER NOT NULL,contractVersion INTEGER NOT NULL,conditionJson TEXT NOT NULL,state TEXT NOT NULL,operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),satisfiedBy TEXT);
CREATE TABLE results(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,version INTEGER NOT NULL,runId TEXT REFERENCES runs(id),producerAgentId TEXT NOT NULL,kind TEXT NOT NULL,payloadJson TEXT NOT NULL,filePath TEXT,sha256 TEXT,state TEXT NOT NULL,outcome TEXT,reviewAgentId TEXT,reviewReason TEXT,evidenceJson TEXT NOT NULL,operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),completionResultId TEXT REFERENCES results(id),FOREIGN KEY(taskId,version) REFERENCES task_versions(taskId,version));
CREATE TABLE deliveries(id TEXT PRIMARY KEY,rootTaskId TEXT NOT NULL,version INTEGER NOT NULL,resultId TEXT REFERENCES results(id),outcome TEXT NOT NULL,publishedFileResultId TEXT REFERENCES results(id),publishedFileResultIdsJson TEXT,routeSourceRequestId TEXT,text TEXT NOT NULL,historyMessageId TEXT UNIQUE,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,attemptedAt INTEGER,revokedAt INTEGER,operationKey TEXT NOT NULL UNIQUE REFERENCES operations(id),UNIQUE(rootTaskId,version),FOREIGN KEY(rootTaskId,version) REFERENCES task_versions(taskId,version));
CREATE UNIQUE INDEX one_root_per_matter ON tasks(matterId) WHERE parentTaskId IS NULL;
CREATE UNIQUE INDEX one_worker_identity ON tasks(executorAgentId) WHERE executorKind='worker';
CREATE UNIQUE INDEX one_live_run_per_task ON runs(taskId) WHERE status IN ('queued','running','awaiting_review');
CREATE UNIQUE INDEX one_open_wait_per_run ON run_waits(runId) WHERE state IN ('armed','ready');
CREATE UNIQUE INDEX one_completed_result_per_run ON results(runId) WHERE runId IS NOT NULL AND outcome IS NOT NULL AND completionResultId IS NULL;
CREATE INDEX result_completion ON results(completionResultId);
CREATE INDEX results_run ON results(runId);
CREATE UNIQUE INDEX one_accepted_result_per_version ON results(taskId,version) WHERE state='accepted' AND completionResultId IS NULL;
CREATE INDEX agent_inbox ON agent_receipts(recipientAgentId,state);
`);
      this.column('task_versions','workingDirectory','TEXT');
      this.column('task_versions','presentationJson','TEXT');
      this.column('runs','workingDirectory','TEXT');
      const main = this.store.meta('mainAgentId') ?? 'main:' + randomUUID();
      this.store.setMeta('mainAgentId', main);
      this.store.setMeta('recursiveSchemaVersion', RECURSIVE_SCHEMA_VERSION);
    });
  }
  task(taskId: string): Task {
    const t = this.one<Task>('SELECT * FROM tasks WHERE id=?', taskId); if (!t)
      throw Error('task_not_found'); return t;
  }
  tasks(): Task[] { return this.all('SELECT * FROM tasks ORDER BY rowid'); }
  listHistory(query:{includeArchived?:boolean;cursor?:string;limit?:number}={}) {
    const limit=query.limit??20;
    if(!Number.isSafeInteger(limit)||limit<1||limit>80||query.includeArchived!==undefined&&typeof query.includeArchived!=='boolean'||query.cursor!==undefined&&(!/^\d+$/.test(query.cursor)||!Number.isSafeInteger(Number(query.cursor))))throw Error('history_query_invalid');
    const rows=this.all<Task&{position:number}>(`SELECT t.*,t.rowid AS position FROM tasks t JOIN tasks root ON root.id=t.rootTaskId WHERE t.rowid>? AND ${query.includeArchived?"t.historyState<>'deleted' AND root.historyState<>'deleted'":"t.historyState='visible' AND root.historyState='visible'"} ORDER BY t.rowid LIMIT ?`,Number(query.cursor??0),limit+1);
    return {tasks:rows.slice(0,limit).map(({position:_position,...task})=>task),nextCursor:rows.length>limit?String(rows[limit-1]!.position):null};
  }
  private historyBusy(taskId:string, except?:string) {
    return !!this.one("SELECT 1 FROM operations WHERE scopeId=? AND kind='delete_worker_history' AND state IN ('accepted','dispatching','uncertain') AND id<>?",taskId,except??'');
  }
  private historyWritable(task:Task) {
    if(task.historyState!=='visible')throw Error('task_history_not_visible');
    if(this.historyBusy(task.id))throw Error('task_history_busy');
  }
  private historyActor(actor:Actor) {
    if(!this.main(actor)||actor.threadId!==this.store.meta('mainThread'))throw Error('history_actor_denied');
    if(!actor.sourceRequestId)throw Error('history_source_required');
    this.actorTask(actor);
    this.pending.source(actor,actor.sourceRequestId);
  }
  private historyTarget(input:Mutation) {
    const t=this.task(input.taskId);
    if(t.headVersion!==input.version)throw Error('task_version_conflict');
    if(t.revision!==input.expectedTaskRevision)throw Error('task_revision_conflict');
    return t;
  }
  private historyBlockers(task:Task,except?:string) {
    const scope=this.all<{id:string}>('SELECT id FROM tasks WHERE id=? OR parentTaskId=?',task.id,task.id).map(t=>t.id);
    const marks=scope.map(()=>'?').join(','),blocked:{reason:string;id?:string}[]=[];
    const add=(reason:string,row:unknown)=>{if(row)blocked.push({reason,...(typeof (row as any).id==='string'?{id:(row as any).id}:{})});};
    add('task_unsettled',this.one(`SELECT id FROM tasks WHERE id IN (${marks}) AND (state<>'settled' OR controlState<>'normal') LIMIT 1`,...scope));
    const runs=this.all<TaskRun>(`SELECT * FROM runs WHERE taskId IN (${marks})`,...scope);
    for(const r of runs)if(r.phase!=='ended'||!['succeeded','failed','cancelled','interrupted'].includes(r.status)||['restart_unconfirmed','engine_stop_unconfirmed'].includes(r.errorCode??'')||this.store.meta('lease:'+r.id)||this.lifecycle?.reviewExitConfirmed?.(r)===false){blocked.push({reason:'run_not_closed',id:r.id});break;}
    add('operation_unresolved',this.one(`SELECT id FROM operations WHERE scopeId IN (${marks}) AND state IN ('accepted','dispatching','uncertain') AND id<>? LIMIT 1`,...scope,except??''));
    add('result_unreviewed',this.one(`SELECT id FROM results WHERE taskId IN (${marks}) AND state IN ('staged','offered') LIMIT 1`,...scope));
    add('delivery_unresolved',this.one("SELECT id FROM deliveries WHERE rootTaskId=? AND state NOT IN ('recorded','revoked') LIMIT 1",task.rootTaskId));
    if(['succeeded','partial'].includes(task.outcome??'')&&!this.one("SELECT 1 FROM deliveries WHERE rootTaskId=? AND state='recorded' AND revokedAt IS NULL",task.rootTaskId))blocked.push({reason:'delivery_missing'});
    const relevant=`(m.taskId IN (${marks}) OR m.recipientAgentId IN (SELECT executorAgentId FROM tasks WHERE id IN (${marks}) AND executorKind='worker') OR m.targetRunId IN (SELECT id FROM runs WHERE taskId IN (${marks})))`;
    add('message_unprocessed',this.one(`SELECT m.id FROM agent_messages m LEFT JOIN agent_receipts r ON r.messageId=m.id WHERE ${relevant} AND (r.state IS NULL OR r.state NOT IN ('processed','rejected')) LIMIT 1`,...scope,...scope,...scope));
    if(this.table('worker_interactions'))add('interaction_unresolved',this.one(`SELECT i.id FROM worker_interactions i JOIN runs r ON r.id=i.runId WHERE r.taskId IN (${marks}) AND (i.state IN ('pending_main','pending_user') OR i.state IN ('approved','answered') AND i.deliveredAt IS NULL) LIMIT 1`,...scope));
    add('wait_unresolved',this.one(`SELECT w.id FROM run_waits w JOIN runs r ON r.id=w.runId WHERE r.taskId IN (${marks}) AND w.state IN ('armed','ready') LIMIT 1`,...scope));
    add('pending_item_open',this.one(`SELECT id FROM pending_items WHERE state='open' AND (relatedTaskId IN (${marks}) OR linkedTaskId IN (${marks})) LIMIT 1`,...scope,...scope));
    const sources=`SELECT sourceRequestId FROM task_versions WHERE taskId IN (${marks})`;
    add('source_input_unprocessed',this.one(`SELECT m.id FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='user_input' AND json_extract(m.payloadJson,'$.requestId') IN (${sources}) AND r.state NOT IN ('processed','rejected') LIMIT 1`,...scope));
    if(this.table('media_assets'))add('attachment_in_progress',this.one(`SELECT id FROM media_assets WHERE requestId IN (${sources}) AND (lease IS NOT NULL OR state IN ('downloading','pending','preparing')) LIMIT 1`,...scope));
    if(this.table('wechat_outbox'))add('channel_unresolved',this.one(`SELECT id FROM wechat_outbox WHERE requestId IN (${sources}) AND state<>'sent' LIMIT 1`,...scope));
    if(this.table('tg_outbox')&&this.table('tg_routes'))add('channel_unresolved',this.one(`SELECT id FROM tg_outbox WHERE origin IN (SELECT origin FROM tg_routes WHERE requestId IN (${sources})) AND state<>'sent' LIMIT 1`,...scope));
    // ACK is business handling, not proof that the coordination turn/report ended.
    add('coordination_consumer_unresolved',this.one(`SELECT m.id FROM agent_messages m JOIN meta p ON p.key GLOB 'publicMainNode:v1:*' JOIN json_each(p.value,'$.sourceMessageIds') s ON s.value=m.id WHERE ${relevant} AND json_extract(p.value,'$.threadId')=? AND (json_extract(p.value,'$.state')<>'worked' OR json_extract(p.value,'$.status')='unknown') LIMIT 1`,...scope,...scope,...scope,this.store.meta('mainThread')!));
    add('coordination_report_unconfirmed',this.one(`WITH reported AS MATERIALIZED (
      SELECT s.value FROM meta p,json_each(p.value,'$.sourceMessageIds') s WHERE p.key GLOB 'publicMainNode:v1:*' AND s.type='text' AND json_extract(p.value,'$.threadId')=? AND json_extract(p.value,'$.state')='worked' AND json_extract(p.value,'$.status')<>'unknown' AND EXISTS(SELECT 1 FROM conversation_messages c WHERE c.id IN (json_extract(p.value,'$.messageId'),json_extract(p.value,'$.replyMessageId'),json_extract(p.value,'$.final.id')) AND c.text<>'')
    ) SELECT m.id FROM agent_messages m JOIN operations o ON o.id=m.operationKey WHERE ${relevant} AND o.kind='send' AND m.recipientAgentId=? AND m.id NOT IN (SELECT value FROM reported) AND NOT(m.payloadJson='{"historyDeleted":true}' AND EXISTS(SELECT 1 FROM tasks owner WHERE owner.id=m.taskId AND owner.historyState='deleted')) LIMIT 1`,this.store.meta('mainThread')!,...scope,...scope,...scope,this.store.meta('mainAgentId')!));
    return blocked;
  }
  archiveHistory(actor:Actor,input:Mutation,archive:boolean) {
    this.historyActor(actor);
    return this.mutation(actor,input.taskId,input.operationId,archive?'archive_work':'restore_work',input,key=>{
      const t=this.historyTarget(input);
      if(t.historyState==='deleted')throw Error('history_deleted');
      if(archive){const blockers=this.historyBlockers(t,key);if(blockers.length)return {state:'skipped',taskId:t.id,blockers};}
      const state=archive?'archived':'visible';
      if(t.historyState!==state)this.sql('UPDATE tasks SET historyState=?,revision=revision+1 WHERE id=?',state,t.id);
      return {state:archive?'archived':'restored',taskId:t.id,revision:this.task(t.id).revision,diskBytesReclaimed:null};
    });
  }
  async deleteHistory(actor:Actor,input:Mutation&{runId?:string;expectedRunRevision?:number},rpc?:(method:string,params:any)=>Promise<any>):Promise<Record<string,unknown>> {
    this.historyActor(actor);
    if(input.runId===undefined) {
      if(input.expectedRunRevision!==undefined)throw Error('history_run_selector_invalid');
      return this.mutation(actor,input.taskId,input.operationId,'delete_work',input,key=>{
        const t=this.historyTarget(input);
        if(t.historyState==='deleted')return {state:'already_deleted',taskId:t.id,deletedMessages:0};
        const blockers=this.historyBlockers(t,key);
        const messages=this.all<{id:string}>("SELECT m.id FROM agent_messages m JOIN operations o ON o.id=m.operationKey WHERE m.taskId=? AND o.kind='send' AND m.kind<>'user_input'",t.id);
        if(messages.length) {
          const ids=json(messages.map(m=>m.id)),targets='SELECT value FROM json_each(?)';
          const reply=this.one<{id:string}>(`SELECT replyTo AS id FROM agent_messages WHERE replyTo IN (${targets}) UNION ALL SELECT causationId AS id FROM agent_messages WHERE causationId IN (${targets}) LIMIT 1`,ids,ids);
          const wait=this.one<{id:string}>(`SELECT q.value AS id FROM run_waits w,json_each(json_array(json_extract(w.conditionJson,'$.messageId'),json_extract(w.conditionJson,'$.replyTo'),w.satisfiedBy)) q WHERE q.value IN (${targets}) LIMIT 1`,ids);
          const quote=this.one<{id:string}>(`SELECT q.value AS id FROM conversation_messages c,json_tree(c.quote) q WHERE q.value IN (${targets}) LIMIT 1`,ids);
          const reference=reply??wait??quote;if(reference)blockers.push({reason:'message_referenced',id:reference.id});
          const result=this.one<{id:string}>(`SELECT r.id FROM results r,json_tree(r.payloadJson) q WHERE q.value IN (${targets}) UNION ALL SELECT r.id FROM results r,json_tree(r.evidenceJson) q WHERE q.value IN (${targets}) LIMIT 1`,ids,ids);
          if(result)blockers.push({reason:'result_references_message',id:result.id});
        }
        if(blockers.length)return {state:'skipped',taskId:t.id,blockers};
        if(!messages.length)return {state:'no_deletable_content',taskId:t.id,deletedMessages:0};
        for(const m of messages)this.sql('UPDATE agent_messages SET payloadJson=? WHERE id=?','{"historyDeleted":true}',m.id);
        this.sql("UPDATE tasks SET historyState='deleted',revision=revision+1 WHERE id=?",t.id);
        return {state:'deleted',taskId:t.id,deletedMessages:messages.length,diskBytesReclaimed:null};
      });
    }
    if(!Number.isSafeInteger(input.expectedRunRevision)||!rpc)throw Error('history_native_unavailable');
    const binding=this.store.meta('binding')??this.store.meta('mainThread')!;
    const prior=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,input.taskId,input.operationId);
    const finish=(key:string,response:Record<string,unknown>,uncertain=false)=>{
      this.sql('UPDATE operations SET state=?,responseJson=?,revision=revision+1 WHERE id=?',uncertain?'uncertain':'confirmed',json({...response,operationKey:key}),key);
      return {...response,operationKey:key};
    };
    if(prior) {
      if(prior.kind!=='delete_worker_history'||prior.payloadHash!==recursiveHash(input))throw Error('operation_payload_conflict');
      if(!['accepted','dispatching','uncertain'].includes(prior.state))return JSON.parse(prior.responseJson!);
      const details=JSON.parse(prior.detailsJson);
      if(details.binding!==binding) return {state:'uncertain',operationKey:prior.id,reason:'history_binding_changed'};
      if(details.phase!=='deleting')return {state:'uncertain',operationKey:prior.id,reason:'history_native_in_progress'};
      // A prior RPC may have completed. Reconcile absence only, never issue delete again.
      try{await rpc('thread/read',{threadId:details.threadId,includeTurns:false});}
      catch(error){if(error instanceof Error&&error.message==='engine_thread_not_found')return finish(prior.id,{state:'deleted',runId:input.runId,taskId:input.taskId,deletedThreads:1,diskBytesReclaimed:null});}
      return {state:'uncertain',operationKey:prior.id,runId:input.runId,reason:'history_native_outcome_unknown'};
    }
    const started=this.mutation(actor,input.taskId,input.operationId,'delete_worker_history',input,key=>{
      const t=this.historyTarget(input),r=this.run(input.runId!);
      if(r.taskId!==t.id||r.stateRevision!==input.expectedRunRevision)throw Error('history_run_revision_conflict');
      if(!r.threadId||r.threadId===this.store.meta('mainThread')||t.executorKind!=='worker')throw Error('history_thread_denied');
      if(this.one("SELECT 1 FROM operations WHERE scopeId=? AND kind='delete_worker_history' AND state='confirmed' AND json_extract(detailsJson,'$.runId')=? AND json_extract(detailsJson,'$.threadId')=? AND json_extract(detailsJson,'$.binding')=? AND json_extract(responseJson,'$.state')='deleted'",t.id,r.id,r.threadId,binding))return {state:'already_deleted',taskId:t.id,runId:r.id,deletedThreads:0};
      const blockers=this.historyBlockers(t,key);
      if(blockers.length)return {state:'skipped',taskId:t.id,runId:r.id,blockers};
      this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({runId:r.id,threadId:r.threadId,binding,phase:'checking'}),key);
      return {state:'checking',taskId:t.id,runId:r.id,threadId:r.threadId};
    },'accepted');
    if(started.state!=='checking'){
      this.sql("UPDATE operations SET state='confirmed' WHERE id=?",started.operationKey);
      return started;
    }
    const key=started.operationKey,threadId=started.threadId;
    try {
      const read=await rpc('thread/read',{threadId,includeTurns:false});
      if(read?.thread?.id!==threadId||read.thread.status?.type!=='notLoaded')return finish(key,{state:'skipped',runId:input.runId,reason:'history_native_not_closed'});
      for(const archived of [false,true]) {
        const descendants=await rpc('thread/list',{ancestorThreadId:threadId,archived,modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'],useStateDbOnly:true,limit:1});
        if(!Array.isArray(descendants?.data)||descendants.data.length||descendants.nextCursor)return finish(key,{state:'skipped',runId:input.runId,reason:'history_native_descendants_unconfirmed'});
      }
      this.tx(()=>{
        this.historyActor(actor);this.historyTarget(input);
        const blockers=this.historyBlockers(this.task(input.taskId),key);
        if(blockers.length)throw Error('history_native_facts_changed');
        if(this.run(input.runId!).stateRevision!==input.expectedRunRevision)throw Error('history_run_revision_conflict');
        this.sql("UPDATE operations SET state='dispatching',detailsJson=json_set(detailsJson,'$.phase','deleting'),revision=revision+1 WHERE id=?",key);
      });
    }catch {return finish(key,{state:'failed',runId:input.runId,reason:'history_native_check_failed'});}
    try {await rpc('thread/delete',{threadId});}
    catch {return finish(key,{state:'uncertain',runId:input.runId,reason:'history_native_outcome_unknown'},true);}
    return finish(key,{state:'deleted',runId:input.runId,taskId:input.taskId,deletedThreads:1,diskBytesReclaimed:null});
  }
  run(runId: string): TaskRun {
    const r = this.store.run(runId) as TaskRun | undefined; if (!r?.taskId)
      throw Error('run_not_found'); return r;
  }
  workingDirectory(runId:string){const run=this.run(runId);return run.workingDirectory??this.contract(run.taskId,run.contractVersion).workingDirectory??this.files.workspace;}
  selectWorkingDirectory(actor:Actor,path:string){this.guard(actor);this.sql('UPDATE runs SET workingDirectory=? WHERE id=?',path,actor.runId!);return path;}
  children(taskId: string): Task[] { return this.all('SELECT * FROM tasks WHERE parentTaskId=? ORDER BY rowid', taskId); }
  version(taskId: string, version: number): Version {
    const v = this.one<Version>('SELECT * FROM task_versions WHERE taskId=? AND version=?', taskId, version); if (!v)
      throw Error('task_version_not_found'); return v;
  }
  contract(taskId: string, version: number): Contract { const v = this.version(taskId, version); return { goal: v.goal, inputs: JSON.parse(v.inputsJson), resultKind: v.resultKind, acceptance: JSON.parse(v.acceptanceJson), ...(v.workingDirectory?{workingDirectory:v.workingDirectory}:{}),...(v.presentationJson?{presentation:JSON.parse(v.presentationJson)}:{}) }; }
  authority(taskId: string, version: number): Authority { return JSON.parse(this.version(taskId, version).authorityJson); }
  private requireMain(actor: Actor) {
    if (!this.main(actor)) throw Error('task_main_required');
    this.actorTask(actor);
  }
  private main(actor: Actor) { return actor.agentId === this.store.meta('mainAgentId') && !actor.runId; }
  private actorTask(actor: Actor): Task | undefined {
    if (this.main(actor)) {
      this.lifecycle?.validateActor(actor);
      return;
    }
    if (!actor.runId)
      throw Error('agent_identity_denied');
    const r = this.run(actor.runId), t = this.task(r.taskId);
    if (t.executorAgentId !== actor.agentId)
      throw Error('agent_identity_denied');
    if (r.epoch !== actor.epoch)
      throw Error('run_epoch_stale');
    if (r.status !== 'running' || r.threadId !== actor.threadId || r.turnId !== actor.turnId)
      throw Error('run_not_live');
    this.lifecycle?.validateActor(actor);
    return t;
  }
  private readAllowed(actor: Actor, t: Task) {
    const own = this.actorTask(actor);
    if (!own)
      return;
    const a = this.authority(own.id, own.headVersion);
    if (own.matterId !== t.matterId && !a.collaborateTaskIds.includes(t.id))
      throw Error('agent_scope_denied');
  }
  private check(actor: Actor, input: Mutation, options: {
    phases?: string[];
    allowAdopt?: boolean;
  } = {}) {
    const t = this.task(input.taskId);
    this.readAllowed(actor, t);
    this.historyWritable(t);
    if (t.headVersion !== input.version)
      throw Error('task_version_conflict');
    if (t.revision !== input.expectedTaskRevision)
      throw Error('task_revision_conflict');
    if (!this.main(actor) && t.executorAgentId !== actor.agentId)
      throw Error('task_owner_denied');
    for (const member of t.parentTaskId ? [t, this.task(t.parentTaskId)] : [t]) {
      this.historyWritable(member);
      if (member.subtreeStopOpId || member.controlState === 'stopping') throw Error('task_stop_requested');
      if (member.controlState === 'held') throw Error('task_held');
    }
    if (actor.runId) {
      const r = this.run(actor.runId);
      if (r.stopRequestedAt)
        throw Error('run_stop_requested');
      if (r.targetVersion && !options.allowAdopt)
        throw Error('run_adopt_required');
      if (options.phases && !options.phases.includes(r.phase))
        throw Error(r.phase === 'yielding' ? 'run_yield_requested' : 'run_phase_denied');
    }
    return t;
  }
  guard(actor:Actor,phases=['executing']){
    if(!actor.runId)throw Error('run_required');const run=this.run(actor.runId),task=this.task(run.taskId);
    return this.check(actor,{operationId:'host_guard',taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision},{phases});
  }
  private validateContract(c: Contract, a: Authority,scopeTaskId?:string) {
    requireText(c.goal);
    if(c.presentation!==undefined){requireObject(c.presentation);requireText(c.presentation.title,80);if(c.presentation.description!==undefined)requireText(c.presentation.description,320);}
    if(c.workingDirectory!==undefined){
      if(typeof c.workingDirectory!=='string'||!isAbsolute(c.workingDirectory)||realpathSync(c.workingDirectory)!==c.workingDirectory||!statSync(c.workingDirectory).isDirectory())throw Error('task_working_directory_invalid');
    }
    if (!['markdown', 'file','structured', 'aggregate'].includes(c.resultKind) || !Array.isArray(c.inputs) || !Array.isArray(c.acceptance?.criteria))
      throw Error('task_invalid_contract');
    const ids = new Set<string>();
    for (const item of c.acceptance.criteria) {
      requireText(item.id, 100);
      requireText(item.description);
      if (typeof item.required !== 'boolean' || ids.has(item.id))
        throw Error('task_invalid_criteria');
      ids.add(item.id);
    }
    const attachments:AttachmentRef[]=[];
    for (const item of c.inputs) {
      if(item.type==='attachment'){
        attachments.push(parseAttachmentReference(item.id));
        if(!a.attachments?.includes(item.id))throw new AttachmentInputError('task_authority_input_denied');
        continue;
      }
      if (item.type === 'material' ? !a.materials.includes(item.id) : item.type === 'result' ? !a.resultIds.includes(item.id)&&!(scopeTaskId&&this.one("SELECT 1 FROM results r JOIN tasks t ON t.id=r.taskId WHERE r.id=? AND r.state='accepted' AND t.rootTaskId=?",item.id,this.task(scopeTaskId).rootTaskId)) : true)
        throw Error('task_authority_input_denied');
    }
    if(attachments.length){
      if(!a.sourceRequestId)throw new AttachmentInputError('task_authority_input_denied');
      this.lifecycle?.validateAttachments?.(a.sourceRequestId,attachments);
    }
    if (Buffer.byteLength(json(c)) > 128 * 1024)
      throw Error('task_contract_too_large');
  }
  // Called only at actual lifecycle entries, before changing the old facts.
  // Request overlays do not close an underlying waiting/review interval.
  private markWaitingEntry(t:Task,r=t.currentRunId?this.run(t.currentRunId):undefined) {
    const waiting=t.controlState!=='normal'||t.state==='recovery'||(r? r.id!==t.currentRunId||r.contractVersion!==t.headVersion||r.phase==='uncertain'||r.phase==='held'||r.stopRequestedAt!=null&&r.phase!=='ended'||r.phase!=='ended'&&!(r.status==='running'&&r.phase==='executing'):t.state!=='settled'&&t.state!=='reviewing');
    if(!waiting)this.sql('UPDATE tasks SET waitingEnteredAt=? WHERE id=?',Date.now(),t.id);
  }
  private insertTask(t: Task) { this.sql('INSERT INTO tasks(id,matterId,rootTaskId,parentTaskId,createdByAgentId,parentVersion,executorKind,executorAgentId,coordinatorAgentId,headVersion,currentRunId,state,outcome,revision,controlState,subtreeStopOpId,waitingEnteredAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',t.id,t.matterId,t.rootTaskId,t.parentTaskId,t.createdByAgentId,t.parentVersion,t.executorKind,t.executorAgentId,t.coordinatorAgentId,t.headVersion,t.currentRunId,t.state,t.outcome,t.revision,t.controlState,t.subtreeStopOpId,Date.now()); }
  private insertOperation(key: string, actor: string, scope: string, operationId: string, kind: string, payload: unknown, state = 'accepted') {
    this.sql('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,NULL,0)', key, actor, scope, operationId, kind, recursiveHash(payload), state, json({}));
  }
  private mutation<T extends Record<string, unknown>>(actor: Actor, scope: string, operationId: string, kind: string, payload: unknown, fn: (key: string) => T, state = 'confirmed'): T & {
    operationKey: string;
  } {
    requireText(operationId, 200);
    try{return this.tx(() => {
      const prior = this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?', actor.agentId, scope, operationId);
      if (prior) {
        if (prior.kind !== kind || prior.payloadHash !== recursiveHash(payload))
          throw Error('operation_payload_conflict');
        if (!prior.responseJson)
          throw Error('operation_uncertain');
        return JSON.parse(prior.responseJson);
      }
      // MCP connections live across turns. A late call from a finished wait
      // segment may read persisted state, but cannot perform a fresh mutation.
      // Returning a prior receipt above remains harmless and idempotent.
      if(actor.runId){
        const run=this.run(actor.runId),task=this.task(run.taskId);
        this.check(actor,{operationId,taskId:task.id,version:task.headVersion,expectedTaskRevision:task.revision},{phases:['executing'],allowAdopt:kind==='adopt'});
      }
      const key = id('op');
      this.insertOperation(key, actor.agentId, scope, operationId, kind, payload);
      const response = { ...fn(key), operationKey: key };
      this.lifecycle?.operationConfirmed?.(actor,key,kind,response);
      const finalState = state === 'accepted' && response.state === 'confirmed' ? 'confirmed' : state;
      this.sql('UPDATE operations SET state=?,responseJson=?,revision=revision+1 WHERE id=?', finalState, json(response), key);
      return response;
    });}catch(error){
      // No receipt lookup or post-commit effect can produce this marker.
      // Store.transaction rethrows a rollback failure instead of the input error.
      if(['create_root','create_pending_root','delegate'].includes(kind)&&error instanceof AttachmentInputError)throw new TaskCreationRejected(error.message);
      throw error;
    }
  }
  private insertVersion(taskId: string, version: number, c: Contract, a: Authority, key: string) { this.sql('INSERT INTO task_versions(taskId,version,goal,inputsJson,resultKind,acceptanceJson,authorityJson,sourceRequestId,triggerOpId,workingDirectory,presentationJson) VALUES(?,?,?,?,?,?,?,?,?,?,?)', taskId, version, c.goal, json(c.inputs), c.resultKind, json(c.acceptance), json(a), a.sourceRequestId, key,c.workingDirectory??null,c.presentation?json(c.presentation):null); }
  private newRun(t: Task, version: number, key: string, replaces: string | null = null, legacyRequestId?: string) {
    const runId = id('run'), c = this.contract(t.id, version), a = this.authority(t.id, version);
    this.sql("INSERT INTO runs(id,matterId,requestId,sourceRequestId,goal,material,status,delivery,createdAt,taskId,contractVersion,epoch,replacesRunId,checkpointJson) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?,?,?)", runId, t.matterId, legacyRequestId ?? 'internal:' + key, a.sourceRequestId, c.goal, c.inputs.find(x => x.type === 'material')?.id ?? '', legacyRequestId?'pending':'internal', Date.now(), t.id, version, replaces ? this.run(replaces).epoch + 1 : 0, replaces, json({ usedBudget: this.usedBudget(t.id), ...(legacyRequestId ? { legacy: true } : {}) }));
    if (a.sourceRequestId)
      this.sql('INSERT INTO worker_authorities(runId,sourceRequestId,description) VALUES(?,?,?)', runId, a.sourceRequestId, a.description);
    this.sql("UPDATE tasks SET currentRunId=?,state='queued',outcome=NULL,waitingEnteredAt=(SELECT createdAt FROM runs WHERE id=?),reviewEnteredAt=NULL,settledAt=NULL WHERE id=?", runId, runId, t.id);
    this.sql('UPDATE runs SET workingDirectory=? WHERE id=?',c.workingDirectory??this.files.workspace,runId);
    return runId;
  }
  requirePendingActor(actor: Actor) {
    if (!this.main(actor) || actor.threadId !== this.store.meta('mainThread')) throw Error('pending_actor_denied');
    this.actorTask(actor);
  }
  pendingMutation<T extends Record<string, unknown>>(actor: Actor, operationId: string, kind: 'pending_add' | 'pending_update', payload: unknown, write: () => T) {
    this.requirePendingActor(actor);
    return this.mutation(actor, 'pending_items', operationId, kind, payload, write);
  }
  createRoot(actor: Actor, input: {
    operationId: string; title: string; contract: Contract; authority: Authority;
    executorKind?: 'main' | 'worker'; legacyRequestId?: string; dependencies?: {taskId:string;version:number;required?:boolean}[];
  }) {
    this.requireMain(actor);
    // Old root receipts did not hash dependencies. Recover those receipts before
    // rejecting this unsupported field on a fresh mutation, without rewriting history.
    const {dependencies,...canonical}=input;
    return this.mutation(actor, actor.sourceRequestId ?? '', input.operationId, 'create_root', canonical, key => {
      if(dependencies?.length)throw new TaskCreationRejected('task_root_dependencies_not_supported');
      if (!this.main(actor) || !actor.sourceRequestId || actor.sourceRequestId !== input.authority.sourceRequestId || !this.trustedSource(actor.sourceRequestId))
        throw Error('task_authority_source_denied');
      return this.insertRoot(actor, input, key);
    });
  }
  createPendingRoot(actor: Actor, input: { operationId: string; title: string; contract: Contract; executorKind?: 'main' | 'worker'; dependencies?: {taskId:string;version:number;required?:boolean}[] }, selection: PendingSelection, resolveAuthority: () => Authority, defaultDirectory = this.files.workspace) {
    this.requirePendingActor(actor);
    const {dependencies,...canonical}=input;
    return this.mutation(actor, 'pending_dispatch', input.operationId, 'create_pending_root', { ...canonical, selection }, key => {
      if(dependencies?.length)throw new TaskCreationRejected('task_root_dependencies_not_supported');
      this.pending.validateSelection(actor, selection);
      // Resolve inside the transaction AFTER receipt lookup; a lost reply can
      // always be recovered even when the selected revisions have advanced.
      const authority = resolveAuthority();
      if (authority.sourceRequestId !== selection.primarySourceRequestId) throw Error('task_authority_source_denied');
      const receipt = this.insertRoot(actor, { ...input, contract: { ...input.contract, workingDirectory: input.contract.workingDirectory ?? defaultDirectory }, authority }, key);
      this.pending.link(selection, receipt.taskId);
      return { ...receipt, pendingItems: selection.items.map(ref => ({ id: ref.id, previousRevision: ref.expectedRevision, revision: ref.expectedRevision + 1 })) };
    });
  }
  private insertRoot(actor: Actor, input: { title: string; contract: Contract; authority: Authority; executorKind?: 'main' | 'worker'; legacyRequestId?: string }, key: string) {
    requireText(input.title, 200);
    requireText(input.authority.description,USER_AUTHORITY_MAX_LENGTH);
    input = { ...input, contract: { ...input.contract, workingDirectory: input.contract.workingDirectory ?? this.files.workspace } };
    this.validateContract(input.contract, input.authority);
    const matterId = id('matter'), taskId = id('task'), kind = input.executorKind ?? 'main';
    this.sql("INSERT INTO matters(id,title,status,createdAt,rootTaskId) VALUES(?,?,'queued',?,?)", matterId, input.title, Date.now(), taskId);
    this.insertTask({ id: taskId, matterId, rootTaskId: taskId, parentTaskId: null, createdByAgentId: actor.agentId, parentVersion: null, executorKind: kind, executorAgentId: kind === 'main' ? actor.agentId : 'worker:' + taskId, coordinatorAgentId: actor.agentId, headVersion: 1, currentRunId: null, state: kind === 'main' ? 'waiting' : 'queued', outcome: null, revision: 1, controlState: 'normal', subtreeStopOpId: null });
    this.insertVersion(taskId, 1, input.contract, input.authority, key);
    const runId = kind === 'worker' ? this.newRun(this.task(taskId), 1, key, null, input.legacyRequestId) : null;
    this.project(taskId);
    return { taskId, matterId, agentId: this.task(taskId).executorAgentId, version: 1, runId, state: 'queued' };
  }
  legacyDispatch(actor: Actor, d: Dispatch, authority: Authority): TaskRun {
    if (!this.main(actor) || !actor.sourceRequestId || actor.sourceRequestId !== d.sourceRequestId)
      throw Error('dispatch_requires_user_message');
    const duplicate = this.store.runs().find(r => r.requestId === d.requestId);
    if (duplicate)
      return this.run(duplicate.id);
    const contract: Contract = { ...(d.title.trim()&&d.title.length<=80?{presentation:{title:d.title.trim()}}:{}),goal: d.goal, inputs: [{ type: 'material', id: d.material }], resultKind: 'markdown', acceptance: { criteria: [{ id: 'legacy', required: true, description: 'Original file goal, source and artifact inspected' }] } };
    if (!d.matterId) {
      const root = this.createRoot(actor, { operationId: 'legacy:' + d.requestId, title: d.title, contract, authority, executorKind: 'worker', legacyRequestId: d.requestId });
      return this.run(root.runId!);
    }
    const matter = this.one<{
      rootTaskId: string;
    }>('SELECT rootTaskId FROM matters WHERE id=?', d.matterId);
    if (!matter)
      throw Error('matter_not_found');
    const t = this.task(matter.rootTaskId);
    if (t.executorKind !== 'worker')
      throw Error('legacy_root_executor_conflict');
    const receipt = this.mutation(actor, t.id, d.requestId, 'legacy_dispatch', d, key => {
      if (t.currentRunId && live(this.run(t.currentRunId)))
        throw Error('matter_busy');
      this.validateContract(contract, authority);
      const version = this.one<{
        n: number;
      }>('SELECT max(version)+1 AS n FROM task_versions WHERE taskId=?', t.id)!.n;
      this.insertVersion(t.id, version, contract, authority, key);
      this.sql("UPDATE tasks SET headVersion=?,state='queued',outcome=NULL,revision=revision+1 WHERE id=?", version, t.id);
      const runId = this.newRun(this.task(t.id), version, key, t.currentRunId, d.requestId);
      this.project(t.id);
      return { runId, version };
    });
    return this.run(receipt.runId);
  }
  private trustedSource(source: string) {
    const queued = this.one<{
      state: string;
    }>("SELECT r.state FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='user_input' AND m.senderAgentId=? AND m.recipientAgentId=? AND json_extract(m.payloadJson,'$.requestId')=?", 'user:' + this.store.meta('mainAgentId'), this.store.meta('mainAgentId')!, source);
    if (queued)
      return ['offered', 'received', 'processed', 'uncertain'].includes(queued.state);
    return !!this.store.request(source) || this.table('conversation_inputs') && !!this.one('SELECT 1 FROM conversation_inputs WHERE requestId=?', source);
  }
  private table(name: string) { return !!this.one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name); }
  delegate(actor: Actor, input: Mutation & {
    contract: Contract;
    dependencies: {
      taskId: string;
      version: number;
      required?: boolean;
    }[];
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'delegate', input, key => {
      const p = this.check(actor, input, { phases: ['executing'] });
      if (p.parentTaskId || p.executorKind !== 'main') throw Error('task_parent_denied');
      if (p.state === 'settled')
        throw Error('task_terminal');
      if (p.currentRunId && ['ended','uncertain'].includes(this.run(p.currentRunId).phase))
        throw Error('task_end_requested');
      const authority = { ...this.authority(p.id, p.headVersion) };
      // Persisted scope is never a substitute for a real user source.
      if(!authority.sourceRequestId||!this.trustedSource(authority.sourceRequestId))throw Error('task_authority_source_denied');
      authority.attachments=this.contract(p.id,p.headVersion).inputs.filter(x=>x.type==='attachment').map(x=>x.id);
      const inherited=actor.runId?this.workingDirectory(actor.runId):this.contract(p.id,p.headVersion).workingDirectory??this.files.workspace;
      input={...input,contract:{...input.contract,workingDirectory:input.contract.workingDirectory??inherited}};
      this.validateContract(input.contract, authority,p.id);
      const taskId = id('task');
      this.insertTask({ id: taskId, matterId: p.matterId, rootTaskId: p.rootTaskId, parentTaskId: p.id, createdByAgentId: actor.agentId, parentVersion: p.headVersion, executorKind: 'worker', executorAgentId: 'worker:' + taskId, coordinatorAgentId: actor.agentId, headVersion: 1, currentRunId: null, state: 'queued', outcome: null, revision: 1, controlState: 'normal', subtreeStopOpId: null });
      this.insertVersion(taskId, 1, input.contract, authority, key);
      for (const d of input.dependencies ?? [])
        this.dependency(taskId, 1, d.taskId, d.version, d.required !== false);
      const runId = this.newRun(this.task(taskId), 1, key);
      this.bump(p.id);
      this.project(p.id);
      return { taskId, matterId: p.matterId, agentId: 'worker:' + taskId, version: 1, runId, state: 'queued' };
    });
  }
  private bump(taskId: string) { this.sql('UPDATE tasks SET revision=revision+1 WHERE id=?', taskId); }
  private dependency(taskId: string, version: number, to: string, toVersion: number, required: boolean) {
    const t = this.task(taskId), other = this.task(to);
    this.version(to, toVersion);
    if (t.matterId !== other.matterId)
      throw Error('dependency_scope_denied');
    const visit = (at: string, v: number, seen = new Set<string>()): boolean => {
      if (at === taskId && v === version)
        return true; const key = at + ':' + v; if (seen.has(key))
        return false; seen.add(key); return this.all<{
          dependsOnTaskId: string;
          dependsOnVersion: number;
        }>('SELECT * FROM task_dependencies WHERE taskId=? AND version=? AND required=1', at, v).some(x => visit(x.dependsOnTaskId, x.dependsOnVersion, seen));
    };
    if (required && visit(to, toVersion))
      throw Error('dependency_cycle');
    this.sql('INSERT INTO task_dependencies VALUES(?,?,?,?,?,\'accepted_result\')', taskId, version, to, toVersion, required ? 1 : 0);
  }
  addDependency(actor: Actor, input: Mutation & {
    dependsOnTaskId: string;
    dependsOnVersion: number;
    required: boolean;
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'dependency', input, () => {
      const t = this.check(actor, input, { phases: ['executing'] });
      if (t.state === 'settled')
        throw Error('task_terminal');
      this.dependency(t.id, input.version, input.dependsOnTaskId, input.dependsOnVersion, input.required);
      this.bump(t.id);
      this.project(t.id);
      return { taskId: t.id, version: input.version, dependsOnTaskId: input.dependsOnTaskId, dependsOnVersion: input.dependsOnVersion, state: 'confirmed' };
    });
  }
  usedBudget(taskId: string) {
    const root = this.task(taskId).rootTaskId; return Number(this.one<{
      used: number;
    }>('SELECT coalesce(sum(r.activeMs),0) AS used FROM runs r JOIN tasks t ON r.taskId=t.id WHERE t.rootTaskId=?', root)!.used);
  }
  charge(runId: string, epoch: number, ms: number) {
    if (!Number.isSafeInteger(ms) || ms < 0)
      throw Error('run_budget_invalid'); const r = this.run(runId); if (r.epoch !== epoch)
      throw Error('run_epoch_stale'); this.sql('UPDATE runs SET activeMs=activeMs+? WHERE id=?', ms, runId); return this.usedBudget(r.taskId);
  }
  claim(runId?: string): TaskRun | undefined {
    return this.tx(() => {
      const r = runId ? this.run(runId) : this.all<TaskRun>("SELECT * FROM runs WHERE taskId IS NOT NULL AND (status='queued' OR (status='running' AND phase='ready')) ORDER BY createdAt,rowid").find(x => this.canClaim(x));
      if (!r || !this.canClaim(r))
        return;
      const t = this.task(r.taskId);
      const authority=this.authority(t.id,r.contractVersion);
      if(!authority.sourceRequestId||!this.trustedSource(authority.sourceRequestId)){
        this.fail(r,'task_authority_source_denied');return;
      }
      this.sql("UPDATE run_waits SET state='consumed' WHERE runId=? AND state='ready'", r.id);
      this.sql("UPDATE runs SET status='running',phase='starting',stateRevision=stateRevision+1,startedAt=coalesce(startedAt,?) WHERE id=?", Date.now(), r.id);
      this.sql("UPDATE agent_receipts SET state='offered',offeredRunId=?,offeredEpoch=?,revision=revision+1 WHERE recipientAgentId=? AND state IN ('pending','uncertain') AND messageId IN (SELECT id FROM agent_messages WHERE recipientAgentId=? AND (targetRunId IS NULL OR targetRunId=?))", r.id, r.epoch, t.executorAgentId, t.executorAgentId, r.id);
      this.bump(t.id);
      this.project(t.id);
      return this.run(r.id);
    });
  }
  private canClaim(r: TaskRun) {
    if (r.stopRequestedAt || !(r.status === 'queued' || r.status === 'running' && r.phase === 'ready')) return false;
    const t = this.task(r.taskId);
    return (t.parentTaskId ? [t, this.task(t.parentTaskId)] : [t]).every(member =>
      member.historyState === 'visible' && !this.historyBusy(member.id) && member.controlState === 'normal' && !member.subtreeStopOpId);
  }

  bind(runId: string, epoch: number, threadId: string, turnId: string) {
    this.tx(() => {
      const r = this.run(runId); if (r.epoch !== epoch || r.phase !== 'starting' || r.stopRequestedAt)
        throw Error('run_epoch_or_phase_conflict'); this.sql("UPDATE runs SET phase='executing',threadId=?,turnId=?,stateRevision=stateRevision+1 WHERE id=?", threadId, turnId, runId); this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.executionAcknowledged',1) WHERE id=?",runId); this.sql("UPDATE agent_receipts SET state='received',offeredTurnId=?,revision=revision+1 WHERE offeredRunId=? AND offeredEpoch=? AND recipientAgentId=? AND state='offered' AND messageId IN (SELECT id FROM agent_messages WHERE recipientAgentId=? AND (targetRunId IS NULL OR targetRunId=?))", turnId, runId, epoch, this.task(r.taskId).executorAgentId, this.task(r.taskId).executorAgentId, runId); this.bump(r.taskId); this.project(r.taskId);
    });
  }
  private pendingRpc(runId: string) { return this.table('worker_interactions') && !!this.one("SELECT 1 FROM worker_interactions WHERE runId=? AND state IN ('pending_main','pending_user')", runId); }
  rpc(runId: string, epoch: number, waiting: boolean) {
    this.tx(() => {
      const r = this.run(runId); if (r.epoch !== epoch || r.status !== 'running' || r.stopRequestedAt)
        throw Error('run_epoch_stale'); if (waiting && !['executing','rpc_wait'].includes(r.phase))
        throw Error('run_disposition_pending'); if (waiting && r.phase === 'rpc_wait') return; if (!waiting && r.phase !== 'rpc_wait')
        return; if(waiting)this.markWaitingEntry(this.task(r.taskId),r); this.sql('UPDATE runs SET phase=?,stateRevision=stateRevision+1 WHERE id=?', waiting ? 'rpc_wait' : 'executing', runId); this.bump(r.taskId); this.project(r.taskId);
    });
  }
  wait(actor: Actor, input: Mutation & {
    condition: WaitCondition;
  }) {
    const runId=actor.runId;
    if (!runId) throw Error('task_wait_requires_run');
    return this.mutation(actor, input.taskId, input.operationId, 'wait', input, key => {
      const t = this.check(actor, input, { phases: ['executing'] });
      if (this.pendingRpc(runId))
        throw Error('interaction_pending');
      if (input.condition.type !== 'message') {
        const other = this.task(input.condition.taskId);
        this.readAllowed(actor, other);
        this.version(other.id, input.condition.version);
        if (other.id === t.id)
          throw Error('wait_self_deadlock');
      }
      else if (!input.condition.messageId && !input.condition.replyTo)
        throw Error('wait_condition_invalid');
      this.markWaitingEntry(t);
      const waitId = id('wait'), satisfied = this.condition(t.executorAgentId, input.condition, runId);
      this.sql('INSERT INTO run_waits VALUES(?,?,?,?,?,?,?,?)', waitId, runId, actor.epoch!, t.headVersion, json(input.condition), satisfied ? 'ready' : 'armed', key, satisfied);
      this.sql("UPDATE runs SET phase='yielding',stateRevision=stateRevision+1 WHERE id=?", runId);
      this.bump(t.id);
      this.project(t.id);
      return { waitId, state: satisfied ? 'ready' : 'waiting' };
    });
  }
  private condition(agent: string, c: WaitCondition, runId: string): string | null {
    if (c.type === 'message')
      return this.one<{
        id: string;
      }>(`SELECT m.id FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE r.recipientAgentId=? AND r.state NOT IN ('processed','rejected') AND (m.targetRunId IS NULL OR m.targetRunId=?) AND ${c.messageId ? 'm.id=?' : 'm.replyTo=?'} ORDER BY m.seq LIMIT 1`, agent, runId, c.messageId ?? c.replyTo!)?.id ?? null;
    const result = this.one<Result>(`SELECT * FROM results WHERE taskId=? AND version=? AND completionResultId IS NULL AND state ${c.type === 'accepted_result' ? "='accepted'" : "IN ('offered','accepted')"} LIMIT 1`, c.taskId, c.version);
    if (result)
      return result.id;
    // A rejected version cannot become accepted. Wake the precise old-version
    // waiter with an explicit revision event, never as an accepted dependency.
    const revision = this.one<{id:string}>("SELECT r.id FROM results r JOIN runs x ON x.id=r.runId WHERE r.taskId=? AND r.version=? AND r.completionResultId IS NULL AND r.state='rejected' AND x.errorCode='revision_requested' LIMIT 1", c.taskId, c.version);
    if(revision)return 'revision_requested:'+revision.id;
    if (c.type === 'result_or_terminal') {
      const t = this.task(c.taskId);
      if (t.headVersion === c.version && t.state === 'settled')
        return 'terminal:' + t.id + ':' + c.version;
    }
    return null;
  }
  private wake() {
    for (const w of this.all<{
      id: string;
      runId: string;
      conditionJson: string;
    }>("SELECT * FROM run_waits WHERE state='armed'")) {
      const r = this.run(w.runId), t = this.task(r.taskId), satisfied = this.condition(t.executorAgentId, JSON.parse(w.conditionJson), r.id);
      if (!satisfied)
        continue;
      this.sql("UPDATE run_waits SET state='ready',satisfiedBy=? WHERE id=?", satisfied, w.id);
      if (r.phase === 'parked') {
        this.sql("UPDATE runs SET phase='ready',stateRevision=stateRevision+1 WHERE id=?", r.id);
        this.bump(t.id);
        this.project(t.id);
      }
    }
  }
  private message(actor: Actor, key: string, recipient: string, taskId: string, version: number, kind: string, payload: unknown, replyTo: string | null = null, target: string | null = null) { const messageId = id('message'); this.sql('INSERT INTO agent_messages(id,senderAgentId,senderRunId,senderEpoch,recipientAgentId,taskId,taskVersion,targetRunId,kind,replyTo,causationId,operationKey,payloadJson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', messageId, actor.agentId, actor.runId ?? null, actor.epoch ?? null, recipient, taskId, version, target, kind, replyTo, null, key, json(payload)); this.sql("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES(?,?,'pending')", messageId, recipient); this.wake(); return messageId; }
  private notify(t: Task, kind: string, payload: unknown) { const key = id('op'); this.insertOperation(key, 'host', t.id, key, 'notify', {}, 'confirmed'); return this.message({ agentId: 'host' }, key, t.coordinatorAgentId, t.id, t.headVersion, kind, payload); }
  queueInteraction(interactionId:string){
    const row=this.one<{taskId:string;contractVersion:number;runId:string;state:string}>("SELECT r.taskId,coalesce(i.contractVersion,r.contractVersion) contractVersion,i.runId,i.state FROM worker_interactions i JOIN runs r ON r.id=i.runId WHERE i.id=? AND r.taskId IS NOT NULL",interactionId);
    if(!row||row.state!=='pending_main')return;
    if(!this.store.db.isTransaction)throw Error('queue_transaction_required');
    // The interaction owner has already opened a savepoint. Do not start a
    // second BEGIN here: its original question and inbox notice commit together.
    const key='interaction-notice:'+interactionId;
    if(this.one('SELECT 1 FROM operations WHERE id=?',key))return;
    this.insertOperation(key,'host',interactionId,'main-notice','notify_interaction',{interactionId},'confirmed');
    const messageId=this.message({agentId:'host'},key,this.store.meta('mainAgentId')!,row.taskId,row.contractVersion,'interaction_required',{interactionId,runId:row.runId});
    this.sql('UPDATE operations SET responseJson=? WHERE id=?',json({messageId,state:'accepted',operationKey:key}),key);
  }
  send(actor: Actor, input: Mutation & {
    recipientAgentId: string;
    kind: string;
    payload: unknown;
    replyTo?: string;
    targetRunId?: string;
  }) {
    return this.mutation(actor, input.taskId, input.operationId, 'send', input, key => {
      const own = this.check(actor, input, { phases: ['executing'] });
      requireText(input.kind, 80);
      if (input.kind === 'user_input')
        throw Error('message_kind_reserved');
      if (Buffer.byteLength(json(input.payload)) > 128 * 1024)
        throw Error('message_too_large');
      if (input.recipientAgentId === actor.agentId)
        throw Error('agent_self_message_denied');
      const recipient = this.tasks().find(t => t.executorKind === 'worker' && t.executorAgentId === input.recipientAgentId);
      if (input.recipientAgentId === this.store.meta('mainAgentId')) {
        if (input.taskId !== own.id)
          throw Error('agent_scope_denied');
      }
      else {
        if (!recipient)
          throw Error('agent_scope_denied');
        if (recipient.state === 'settled')
          throw Error('task_terminal');
        if (recipient.matterId !== own.matterId && !this.authority(own.id, own.headVersion).collaborateTaskIds.includes(recipient.id))
          throw Error('agent_scope_denied');
      }
      if (input.replyTo) {
        const original = this.one<Message>('SELECT * FROM agent_messages WHERE id=?', input.replyTo);
        if(original?.taskId&&this.task(original.taskId).historyState==='deleted'&&original.payloadJson==='{"historyDeleted":true}')throw Error('message_history_deleted');
        if (!original || original.recipientAgentId !== actor.agentId || original.senderAgentId !== input.recipientAgentId)
          throw Error('message_reply_scope_denied');
      }
      if (input.targetRunId && (!recipient || recipient.currentRunId !== input.targetRunId))
        throw Error('message_target_stale');
      const messageId = this.message(actor, key, input.recipientAgentId, own.id, own.headVersion, input.kind, input.payload, input.replyTo ?? null, input.targetRunId ?? null);
      return {
        messageId, seq: this.one<{
          seq: number;
        }>('SELECT seq FROM agent_messages WHERE id=?', messageId)!.seq, state: 'accepted'
      };
    });
  }
  inbox(actor: Actor, after = 0) { this.actorTask(actor); return this.all<Message>("SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE r.recipientAgentId=? AND r.state NOT IN ('processed','rejected') AND m.kind<>'user_input' AND (m.targetRunId IS NULL OR m.targetRunId=?) AND m.seq>? ORDER BY m.seq LIMIT 100", actor.agentId, actor.runId ?? null, after).map(m => ({ ...m, payload: JSON.parse(m.payloadJson) })); }
  offerMainMessages() {
    return this.tx(() => {
      const agent = this.store.meta('mainAgentId')!;
      const messages = this.all<Message>("SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE r.recipientAgentId=? AND r.state IN ('pending','uncertain') AND m.kind<>'user_input' AND m.targetRunId IS NULL ORDER BY m.seq LIMIT 100", agent);
      for (const m of messages)
        this.sql("UPDATE agent_receipts SET state='offered',revision=revision+1 WHERE messageId=?", m.id);
      return messages.map(m => ({ ...m, payload: JSON.parse(m.payloadJson) }));
    });
  }
  receiveMainMessages(messageIds: string[], turnId: string) {this.tx(()=>this.receiveMainMessagesInTransaction(messageIds,turnId));}
  receiveMainMessagesInTransaction(messageIds: string[], turnId: string) {
    for (const messageId of messageIds)
      this.sql("UPDATE agent_receipts SET state='received',offeredTurnId=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state='offered' AND messageId IN (SELECT id FROM agent_messages WHERE targetRunId IS NULL)",turnId,messageId,this.store.meta('mainAgentId')!);
  }
  ack(actor: Actor, input: {
    operationId: string;
    messageId: string;
    disposition: 'processed' | 'rejected';
    reason: string;
    resultId?: string;
  }) {
    // A stable agent can outlive a Run. Fence targeted retries before the
    // operation cache, so a new Run cannot reuse an old Run's confirmed ACK.
    const target = this.one<Pick<Message, 'recipientAgentId' | 'targetRunId'>>('SELECT recipientAgentId,targetRunId FROM agent_messages WHERE id=?', input.messageId);
    if (target?.targetRunId) {
      this.actorTask(actor);
      if (target.recipientAgentId !== actor.agentId)
        throw Error('message_recipient_denied');
      if (target.targetRunId !== actor.runId)
        throw Error('message_target_stale');
    }
    return this.mutation(actor, input.messageId, input.operationId, 'ack', input, () => {
      this.actorTask(actor); const m = this.one<Message>('SELECT * FROM agent_messages WHERE id=?', input.messageId); if (!m || m.recipientAgentId !== actor.agentId)
        throw Error('message_recipient_denied'); if (m.kind === 'user_input')
        throw Error('message_kind_reserved'); if (!['processed', 'rejected'].includes(input.disposition))
        throw Error('message_disposition_invalid'); requireText(input.reason); this.sql('UPDATE agent_receipts SET state=?,processedBy=?,resultRef=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=?', input.disposition, actor.runId ?? actor.agentId, input.resultId ?? null, m.id, actor.agentId); return { messageId: m.id, state: input.disposition };
    });
  }
  private result(resultId: string): Result {
    const r = this.one<Result>('SELECT * FROM results WHERE id=?', resultId); if (!r)
      throw Error('result_not_found'); return r;
  }
  private completionResults(result: Result): Result[] {
    const primary = result.completionResultId ?? result.id;
    return this.all<Result>('SELECT * FROM results WHERE id=? OR completionResultId=? ORDER BY rowid',primary,primary);
  }
  // Called only after the original operation returned. No extra inspection,
  // model, file read or business mutation; collectors are best-effort at caller.
  captureActivity(actor:Actor,name:string,args:unknown,receipt:unknown):PublicActivity|undefined {
    if(!this.main(actor))return;
    const a=args as Record<string,unknown>,r=receipt as Record<string,any>;
    if(!a||!r||typeof a!=='object'||typeof r!=='object')return;
    let action:PublicActivity['action'],outcome:PublicActivity['outcome'],taskId:string|undefined,version:number|undefined;
    let operationKey:string|undefined,relatedTarget:ActivityTarget|undefined;
    let result:Result|undefined,run:TaskRun|undefined,delivery:ReturnType<RecursiveTasks['delivery']>|undefined;
    if(name==='work_inspect'||name==='inspect_run'||name==='inspect_result_file'){
      if(name==='work_inspect'&&!r.task)return;
      if(typeof a.resultId==='string')result=this.result(a.resultId);
      if(typeof a.runId==='string')run=this.run(a.runId);
      taskId=typeof a.taskId==='string'?a.taskId:result?.taskId??run?.taskId;
      if(!taskId||name==='work_inspect'&&r.task.id!==taskId)return;
      if(result&&result.taskId!==taskId||run&&run.taskId!==taskId)return;
      if(name==='inspect_run'&&r.run?.id!==run?.id)return;
      if(name==='inspect_result_file'&&!result?.filePath)return;
      if(result?.runId)run=this.run(result.runId);
      version=result?.version??run?.contractVersion??this.task(taskId).headVersion;
      action=result?.filePath?'inspect_file':run?'inspect_run':'inspect_task';
      outcome=result?.filePath?'file_read':'record_read';
    }else if(name==='review_artifact'){
      if(typeof a.runId!=='string')return;run=this.run(a.runId);taskId=run.taskId;version=run.contractVersion;action='review_result';
      if(['review_required','review_blocked'].includes(r.state))outcome='review_required';
      else{
        if(r.runId!==run.id||a.accepted!==true)return;
        result=this.one<Result>("SELECT * FROM results WHERE runId=? AND taskId=? AND version=? AND completionResultId IS NULL AND outcome IS NOT NULL AND state='accepted' AND reviewAgentId=? ORDER BY rowid LIMIT 1",run.id,taskId,version,actor.agentId);
        if(!result)return;outcome='accepted';
      }
    }else if(name==='task_review'){
      if(typeof a.resultId!=='string'||typeof a.taskId!=='string')return;
      result=this.result(a.resultId);taskId=a.taskId;version=result.version;
      if(result.taskId!==taskId||a.version!==version)return;
      if(['review_required','review_blocked'].includes(r.state))outcome='review_required';
      else if(r.resultId!==result.id)return;
      else if(r.decision==='request_changes'&&result.state==='rejected')outcome='changes_requested';
      else if(r.state==='accepted'&&result.state==='accepted')outcome='accepted';
      else if(r.state==='rejected'&&result.state==='rejected')outcome='rejected';else return;
      if(result.runId)run=this.run(result.runId);action='review_result';
      if(typeof r.operationKey==='string'){
        const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',r.operationKey);
        if(op?.kind==='review'&&op.scopeId===taskId&&op.actorAgentId===actor.agentId){
          const d=JSON.parse(op.detailsJson);operationKey=op.id;
          if(outcome==='changes_requested'&&op.state==='confirmed'&&d.resultId===result.id&&d.previousVersion===version&&d.previousRunId===result.runId&&d.version===r.version&&d.runId===r.runId){
            const next=this.run(d.runId);if(next.taskId===taskId&&next.contractVersion===d.version&&next.replacesRunId===result.runId)relatedTarget={taskId,version:d.version,runId:next.id,operationKey:op.id};
          }
        }
      }
    }else if(['task_update','task_stop','task_continue'].includes(name)){
      if(typeof a.taskId!=='string'||typeof r.operationKey!=='string')return;
      const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',r.operationKey);
      const kind=name==='task_update'?'update':name==='task_stop'?'stop':'continue';
      if(!op||op.kind!==kind||op.actorAgentId!==actor.agentId||op.scopeId!==a.taskId||op.operationId!==a.operationId)return;
      const d=JSON.parse(op.detailsJson),stored=JSON.parse(op.responseJson??'{}');
      if(stored.taskId!==a.taskId||stored.state!==r.state)return;
      taskId=a.taskId;version=kind==='update'?d.version:Number(a.version);operationKey=op.id;
      if(!Number.isSafeInteger(version))return;
      action=kind==='update'?'update_task':kind==='stop'?'stop_task':'continue_task';
      if(op.state==='uncertain')outcome='operation_uncertain';
      else if(op.state==='failed'||op.state==='cancelled')outcome='operation_failed';
      else if(kind==='stop'){
        if(r.state==='requested')outcome='stop_requested';
        else if(r.state==='confirmed'&&Array.isArray(d.taskIds)&&d.taskIds.length&&d.runIds.every((id:string)=>{const run=this.run(id);return run.status==='cancelled'&&run.phase==='ended';}))outcome='stop_confirmed';
        else if(r.state==='confirmed'&&Array.isArray(stored.targets)&&!stored.targets.length&&!d.taskIds)outcome='stop_noop';else return;
      }else if(kind==='continue'){
        if(r.state==='queued')outcome='continue_queued';else if(r.state==='ready')outcome='continue_ready';else return;
      }else{
        if(d.mode!==a.mode||r.version!==d.version)return;
        if(d.mode==='queue'&&r.state==='queued')outcome='update_queued';
        else if(d.mode==='steer'&&r.state==='accepted')outcome='update_accepted';
        else if(d.mode==='stop_replace'&&r.state==='requested')outcome='stop_requested';
        else if(d.mode==='stop_replace'&&r.state==='confirmed')outcome='update_confirmed';else return;
      }
      // An operation target may describe a new contract before any Run adopts it.
      if(typeof stored.runId==='string'){const candidate=this.run(stored.runId);if(candidate.taskId===taskId&&candidate.contractVersion===version)run=candidate;}
    }else if(name==='publish_delivery'){
      if(typeof r.deliveryId!=='string')return;delivery=this.delivery(r.deliveryId);
      if(delivery.rootTaskId!==a.taskId||delivery.version!==a.version||delivery.revokedAt!==null)return;
      taskId=delivery.rootTaskId;version=delivery.version;action='prepare_delivery';
      // The response itself, never a transport return or a later scheduler state.
      if(r.state==='recorded')outcome='delivery_recorded';else if(r.state==='prepared')outcome='delivery_prepared';else return;
    }else if(name==='task_delegate'){
      if(typeof r.taskId!=='string'||typeof r.operationKey!=='string')return;
      taskId=r.taskId;version=Number(r.version??1);action='create_task';outcome='created';
    }else return;
    const task=this.task(taskId);this.readAllowed(actor,task);
    if(!operationKey&&typeof r.operationKey==='string'){
      const op=this.one<Operation>('SELECT * FROM operations WHERE id=?',r.operationKey);
      if(op?.actorAgentId===actor.agentId&&(op.scopeId===task.id||action==='create_task'&&this.version(task.id,version!).triggerOpId===op.id))operationKey=op.id;
    }
    const v=this.version(task.id,version!);
    const title=v.presentationJson?publicActivityName(JSON.parse(v.presentationJson).title):undefined;
    const filename=result?.filePath?publicActivityName(result.filePath.split(/[\\/]/).at(-1)):undefined;
    return {schemaVersion:1,action,outcome,...(filename??title?{objectName:filename??title}:{}),target:{taskId:task.id,version:v.version,...(run?{runId:run.id}:{}),...(result?{resultId:result.id}:{}),...(delivery?{deliveryId:delivery.id}:{}),...(operationKey?{operationKey}:{})},...(relatedTarget?{relatedTarget}:{})};
  }
  // SELECT-only: never creates acceptance inspection evidence or file grants.
  executionReadScope(actor:Actor,selector:import('./worker-execution.js').ExecutionSelector,threadId:string){
    if(!threadId||![selector.rootTaskId,selector.taskId,selector.runId].every(id=>typeof id==='string'&&/^[\w:-]{1,100}$/.test(id)))throw Error('execution_scope_denied');
    const task=this.task(selector.taskId),root=this.task(selector.rootTaskId),run=this.run(selector.runId);
    this.readAllowed(actor,task);
    if(root.id!==root.rootTaskId||root.parentTaskId!==null||task.rootTaskId!==root.id||task.historyState!=='visible'||root.historyState!=='visible'||task.executorKind!=='worker'||run.taskId!==task.id||!this.activityLink({taskId:task.id,version:run.contractVersion,runId:run.id},threadId))throw Error('execution_scope_denied');
    return {taskId:task.id,rootTaskId:root.id,runId:run.id,version:run.contractVersion};
  }
  // Existing Web thread scope + exact stored relationship, never ID-as-grant.
  // Does not call inspect(), which would create acceptance inspection evidence.
  activityLink(target:ActivityTarget,threadId:string):ActivityLink|undefined {
    try{
      const task=this.task(target.taskId),v=this.version(task.id,target.version);
      if(!v.sourceRequestId||!this.one('SELECT 1 FROM conversation_inputs WHERE requestId=? AND threadId=?',v.sourceRequestId,threadId))return;
      if(target.runId){const run=this.run(target.runId);if(run.taskId!==task.id||run.contractVersion!==v.version)return;}
      if(target.resultId){const result=this.result(target.resultId);if(result.taskId!==task.id||result.version!==v.version||target.runId&&result.runId!==target.runId)return;}
      if(target.deliveryId){const d=this.delivery(target.deliveryId);if(d.rootTaskId!==task.id||d.version!==v.version||d.revokedAt!==null||d.state==='revoked')return;}
      const link:ActivityLink={task:{...target,rootTaskId:task.rootTaskId}};
      // Publication owner still owns revocation, exact result scope and file grants.
      const d=target.deliveryId?this.delivery(target.deliveryId):undefined;
      const id=target.resultId??d?.publishedFileResultIds[0];
      const file=id?this.publishedResult(id,{sourceRequestId:v.sourceRequestId}):undefined;
      if(file&&(!d||file.deliveryId===d.id)){
        link.artifact={id:file.resultId,title:publicActivityName(file.path.split(/[\\/]/).at(-1))??'成果文件'};
      }
      const publication=d??(file?this.delivery(file.deliveryId):undefined);
      if(publication?.state==='recorded'&&this.one("SELECT 1 FROM conversation_messages WHERE id=? AND threadId=? AND role='assistant'",publication.historyMessageId,threadId))link.messageId=publication.historyMessageId;
      return link;
    }catch{return;}
  }
  private inspectionKey(actor: Actor, resultId: string) { return json([actor.agentId, actor.runId ?? null, actor.epoch ?? null, actor.turnId ?? 'host', resultId]); }
  inspect(actor: Actor, selector: TaskSelector & { operationId?: undefined; operationScopeId?: undefined }): ReturnType<RecursiveTasks['inspectTask']>;
  inspect(actor: Actor, selector: InspectionSelector): ReturnType<RecursiveTasks['inspectTask']> | ReturnType<RecursiveTasks['inspectOperation']>;
  inspect(actor: Actor, selector: InspectionSelector) {
    if (selector.operationId !== undefined || selector.operationScopeId !== undefined) {
      if (selector.operationId === undefined || selector.taskId !== undefined || selector.runId !== undefined || selector.resultId !== undefined)
        throw Error('operation_selector_invalid');
      return this.inspectOperation(actor, selector.operationId, selector.operationScopeId);
    }
    return this.inspectTask(actor, selector);
  }
  private inspectOperation(actor: Actor, operationId: string, scopeId?: string) {
    this.actorTask(actor);
    requireText(operationId, 200);
    if (scopeId !== undefined) requireText(scopeId, 200);
    type Receipt = Pick<Operation, 'id' | 'operationId' | 'scopeId' | 'kind' | 'state' | 'revision' | 'responseJson' | 'detailsJson'>;
    const columns = 'id,operationId,scopeId,kind,state,revision,responseJson,detailsJson';
    const rows = scopeId === undefined
      ? this.all<Receipt>(`SELECT ${columns} FROM operations WHERE actorAgentId=? AND operationId=? ORDER BY scopeId,id LIMIT 21`, actor.agentId, operationId)
      : this.all<Receipt>(`SELECT ${columns} FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=? LIMIT 1`, actor.agentId, scopeId, operationId);
    if (!rows.length) throw Error('operation_not_found');
    if (!this.main(actor)) for (const row of rows) {
      // Worker operation scopes are tasks, except ACKs scoped to a message.
      // A historical receipt does not bypass the current entity read gate.
      const task = this.one<Task>('SELECT * FROM tasks WHERE id=?', row.scopeId)
        ?? (row.kind === 'ack' ? this.one<Task>('SELECT t.* FROM tasks t JOIN agent_messages m ON m.taskId=t.id WHERE m.id=?', row.scopeId) : undefined);
      if (!task) throw Error('agent_scope_denied');
      this.readAllowed(actor, task);
    }
    if (rows.length === 1) {
      const { responseJson, detailsJson, ...receipt } = rows[0]!;
      return { operation: { ...receipt, response: responseJson === null ? null : JSON.parse(responseJson), details: JSON.parse(detailsJson) }, candidates: [], truncated: false };
    }
    const candidates = rows.slice(0, 20).map(row => {
      const response = JSON.parse(row.responseJson ?? '{}') as Record<string, unknown>;
      const references: Record<string, string | number> = {};
      for (const key of ['taskId', 'runId', 'resultId', 'deliveryId', 'messageId', 'version']) {
        const value = response[key];
        if (typeof value === 'string' || typeof value === 'number') references[key] = value;
      }
      return { id: row.id, scopeId: row.scopeId, kind: row.kind, state: row.state, revision: row.revision, references };
    });
    return { operation: null, candidates, truncated: rows.length > 20 };
  }
  private inspectTask(actor: Actor, selector: TaskSelector) {
    const result = selector.resultId ? this.result(selector.resultId) : undefined;
    const t = this.task(selector.taskId ?? (selector.runId ? this.run(selector.runId).taskId : result?.taskId) ?? '');
    this.readAllowed(actor, t);
    if (result && result.taskId !== t.id || selector.runId && this.run(selector.runId).taskId !== t.id)
      throw Error('task_selector_conflict');
    const version = this.version(t.id, t.headVersion);
    const run=selector.runId?this.run(selector.runId):t.currentRunId?this.run(t.currentRunId):null;
    const history=run?this.one<Operation>("SELECT * FROM operations WHERE scopeId=? AND kind='delete_worker_history' AND json_extract(detailsJson,'$.runId')=? AND json_extract(detailsJson,'$.threadId')=? AND (state IN ('accepted','dispatching','uncertain') OR json_extract(responseJson,'$.state')='deleted') ORDER BY rowid DESC LIMIT 1",t.id,run.id,run.threadId):undefined;
    const nativeHistory=history?{state:history.state==='confirmed'?JSON.parse(history.responseJson??'{}').state:history.state==='uncertain'?'uncertain':JSON.parse(history.detailsJson).phase,operationId:history.operationId,operationScopeId:history.scopeId}:null;
    const actual = result ? this.actualResult(result) : null;
    if (result)
      this.inspected.set(this.inspectionKey(actor, result.id), recursiveHash(actual));
    this.inspected.set(this.inspectionKey(actor, 'contract:' + t.id), recursiveHash(this.contract(t.id, t.headVersion)));
    return { task: t, contract: this.contract(t.id, t.headVersion), contractHash: recursiveHash(this.contract(t.id, t.headVersion)), authoritySummary: { sourceRequestId: version.sourceRequestId }, run, nativeHistory, children: this.children(t.id), dependencies: this.all('SELECT * FROM task_dependencies WHERE taskId=? AND version=?', t.id, t.headVersion), results: this.all<Result>('SELECT * FROM results WHERE taskId=? ORDER BY rowid', t.id), actualResult: actual, completionResultIds: result ? this.completionResults(result).map(r=>r.id) : [], operations: this.all<Operation>("SELECT id,kind,state,revision FROM operations WHERE scopeId=? AND state IN ('accepted','dispatching','uncertain')", t.id) };
  }
  private actualResult(r: Result) {
    if (r.filePath) {
      if (!r.runId)
        throw Error('result_file_run_missing');
      const run = this.run(r.runId), actual = this.files.verify(this.files.prepareRun(run.matterId, run.id), r.filePath);
      if (r.sha256 && r.sha256 !== actual.sha256)
        throw Error('result_hash_mismatch');
      return { id: r.id, version: r.version, payload: JSON.parse(r.payloadJson), file: actual };
    }
    return { id: r.id, version: r.version, payload: JSON.parse(r.payloadJson), file: null };
  }
  markMaterialRead(actor: Actor) {
    const t = this.actorTask(actor); if (!t || !actor.runId)
      throw Error('run_required'); const r = this.run(actor.runId); if (r.phase !== 'executing' || r.targetVersion)
      throw Error('run_not_writable'); const checkpoint = JSON.parse(r.checkpointJson ?? '{}'); this.sql('UPDATE runs SET checkpointJson=? WHERE id=?', json({ ...checkpoint, materialRead: true }), r.id);
  }
  writeMarkdown(actor: Actor, input: {
    operationId: string;
    filename: string;
    content: string;
  }) {
    return this.stageFile(actor,input);
  }
  writeFile(actor:Actor,input:{operationId:string;filename:string;bytes:Buffer;sourcePath?:string}){return this.stageFile(actor,{operationId:input.operationId,filename:input.filename,content:'',binary:input.bytes,...(input.sourcePath?{sourcePath:input.sourcePath}:{})});}
  private stageFile(actor:Actor,input:{operationId:string;filename:string;content:string;binary?:Buffer;sourcePath?:string}){
    if (!actor.runId)
      throw Error('run_required');
    const runId = actor.runId, t = this.task(this.run(runId).taskId), scope = t.id;
    const intent = this.mutation<{
      runId: string;
      path: string;
      sha256: string;
      state: string;
      resultId?: string;
      workspaceSource?:{path:string;sha256:string};
    }>(actor, scope, input.operationId, input.binary?'write_file':'write_markdown', input.binary?{filename:input.filename,sha256:createHash('sha256').update(input.binary).digest('hex')}:input, key => {
      this.check(actor, { operationId: input.operationId, taskId: t.id, version: t.headVersion, expectedTaskRevision: t.revision }, { phases: ['executing'] });
      const run = this.run(runId), inputs = this.contract(t.id, run.contractVersion).inputs;
      if (inputs.some(input => input.type === 'material' || input.type === 'result' || input.type === 'attachment') && !JSON.parse(run.checkpointJson ?? '{}').materialRead)
        throw Error('read_material_first');
      if (input.binary?(!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,110}$/u.test(input.filename)||!input.binary.length||input.binary.length>50*1024*1024):(!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,99}\.md$/u.test(input.filename) || !input.content.trim() || Buffer.byteLength(input.content) > 128 * 1024))
        throw Error('artifact_input_denied');
      const r = this.run(runId), path = join(this.files.prepareRun(r.matterId, r.id), input.filename), sha256 = input.binary?createHash('sha256').update(input.binary).digest('hex'):recursiveHash(input.content);
      // Only the host's workspace staging passes this field. Verify it again at
      // the result owner; no tool schema or browser request accepts provenance.
      const source=input.sourcePath?this.files.verify(this.files.prepareRun(r.matterId,r.id),input.sourcePath):undefined;
      if(source&&source.sha256!==sha256)throw Error('artifact_source_changed');
      const provenance=source?{workspaceSource:{path:source.path,sha256:source.sha256}}:{};
      if (this.one('SELECT 1 FROM results WHERE runId=? AND filePath=?',runId,path) || this.one("SELECT 1 FROM operations WHERE scopeId=? AND kind IN ('write_markdown','write_file') AND id<>? AND state<>'failed' AND json_extract(detailsJson,'$.runId')=? AND json_extract(detailsJson,'$.path')=?",scope,key,runId,path))
        throw Error('artifact_filename_conflict');
      this.sql('UPDATE operations SET detailsJson=? WHERE id=?', json({ runId, epoch: r.epoch, path, sha256 }), key);
      return { runId, path, sha256, state: 'intent',...provenance };
    }, 'dispatching');
    if (intent.state === 'staged') {
      if (!intent.resultId)
        throw Error('artifact_intent_conflict');
      return { ...intent, resultId: intent.resultId };
    }
    this.actorTask(actor);
    const r = this.run(runId);
    if (r.targetVersion || r.phase !== 'executing' || r.stopRequestedAt)
      throw Error('run_not_writable');
    let actual: ReturnType<Files['verify']>;
    try {
      actual = this.files.verify(this.files.prepareRun(r.matterId, r.id), intent.path);
    }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'material_missing')
        throw error;
      if(input.binary)this.files.writeBinary(this.files.prepareRun(r.matterId,r.id),input.filename,input.binary);else this.files.writeMarkdown(this.files.prepareRun(r.matterId, r.id), input.filename, input.content);
      actual = this.files.verify(this.files.prepareRun(r.matterId, r.id), intent.path);
    }
    if (actual.sha256 !== intent.sha256)
      throw Error('artifact_intent_hash_mismatch');
    return this.tx(() => {
      this.actorTask(actor);
      const current = this.run(runId);
      if (current.epoch !== r.epoch || current.phase !== 'executing' || current.stopRequestedAt)
        throw Error('run_epoch_stale');
      let result = this.one<Result>('SELECT * FROM results WHERE operationKey=?', intent.operationKey);
      if (result && result.sha256 !== actual.sha256)
        throw Error('artifact_intent_conflict');
      if (!result) {
        const resultId = id('result');
        this.sql(`INSERT INTO results(${RESULT_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, resultId, t.id, r.contractVersion, runId, actor.agentId, input.binary?'file':'markdown', json(intent.workspaceSource?{workspaceSource:intent.workspaceSource}:{}), actual.path, actual.sha256, 'staged', null, null, null, '{}', intent.operationKey);
        result = this.result(resultId);
      }
      const receipt = { ...intent, resultId: result.id, state: 'staged' };
      this.sql("UPDATE operations SET state='confirmed',responseJson=?,revision=revision+1 WHERE id=?", json(receipt), intent.operationKey);
      this.sql('UPDATE runs SET artifact=coalesce(artifact,?) WHERE id=?', actual.path, runId);
      return receipt;
    });
  }
  private resolutions(t: Task, outcome: Outcome, children: ChildResolution[], key: string) {
    if (!Array.isArray(children))
      throw Error('child_resolutions_required');
    const actual = this.children(t.id), given = new Map(children.map(c => [c.childTaskId, c]));
    if (given.size !== children.length || given.size !== actual.length)
      throw Error('child_resolution_missing');
    for (const child of actual) {
      const c = given.get(child.id);
      if (!c || c.childVersion !== child.headVersion)
        throw Error('child_version_conflict');
      requireText(c.reason);
      if (c.disposition === 'included') {
        if (!c.resultId)
          throw Error('child_result_required');
        const result = this.result(c.resultId);
        if (result.taskId !== child.id || result.version !== c.childVersion || result.state !== 'accepted' || result.completionResultId)
          throw Error('child_result_not_accepted');
        if (outcome === 'succeeded' && result.outcome !== 'succeeded')
          throw Error('child_required_gap');
      }
      else if (c.disposition === 'gap') {
        if (outcome === 'succeeded')
          throw Error('child_gap_prevents_success');
        if (child.state !== 'settled')
          throw Error('child_active_gap');
      }
      else if (c.disposition === 'stopped') {
        if (child.outcome !== 'cancelled' || child.controlState === 'stopping')
          throw Error('child_stop_unconfirmed');
      }
      else if (c.disposition === 'transferred') {
        if (!c.nextCoordinatorId || child.coordinatorAgentId !== c.nextCoordinatorId || child.controlState !== 'normal')
          throw Error('child_transfer_unconfirmed');
        if (outcome === 'succeeded')
          throw Error('child_transferred_gap');
      }
      else
        throw Error('child_disposition_invalid');
      this.sql('INSERT INTO child_resolutions VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(parentTaskId,parentVersion,childTaskId) DO UPDATE SET childVersion=excluded.childVersion,disposition=excluded.disposition,resultId=excluded.resultId,nextCoordinatorId=excluded.nextCoordinatorId,reason=excluded.reason,operationKey=excluded.operationKey', t.id, t.headVersion, child.id, c.childVersion, c.disposition, c.resultId ?? null, c.nextCoordinatorId ?? null, c.reason, key);
    }
    if (outcome === 'succeeded')
      for (const dep of this.all<{
        dependsOnTaskId: string;
        dependsOnVersion: number;
      }>('SELECT * FROM task_dependencies WHERE taskId=? AND version=? AND required=1', t.id, t.headVersion))
        if (!this.one("SELECT 1 FROM results WHERE taskId=? AND version=? AND completionResultId IS NULL AND state='accepted' AND outcome='succeeded'", dep.dependsOnTaskId, dep.dependsOnVersion))
          throw Error('dependency_unsatisfied');
  }
  // Completed public items are the only checkpointed content: no deltas or tools.
  recordWorkerOutput(runId:string,epoch:number,message:{threadId?:string;turnId?:string;itemId:string;phase?:string|null;text:string}) {
    const run=this.run(runId);
    if(run.epoch!==epoch||run.threadId!==message.threadId||run.turnId!==message.turnId||!['executing','rpc_wait','yielding'].includes(run.phase)||run.stopRequestedAt)return;
    const checkpoint=JSON.parse(run.checkpointJson??'{}');
    const messages:NonNullable<TurnResult['messages']>=checkpoint.workerOutput??[];
    const index=messages.findIndex(item=>item.itemId===message.itemId);
    const item={itemId:message.itemId,phase:message.phase??null,text:message.text};
    if(index>=0&&messages[index]!.phase===item.phase&&messages[index]!.text===item.text)return;
    if(index<0)messages.push(item);else messages[index]=item;
    checkpoint.workerOutput=messages;
    this.sql('UPDATE runs SET checkpointJson=? WHERE id=?',json(checkpoint),runId);
  }
  recordWorkerTerminal(runId:string,epoch:number,result:TurnResult) {
    const run=this.run(runId);
    if(run.epoch!==epoch||run.stopRequestedAt||!['starting','executing','rpc_wait','yielding'].includes(run.phase))return;
    this.sql("UPDATE runs SET checkpointJson=json_set(coalesce(checkpointJson,'{}'),'$.workerTerminal',json(?)) WHERE id=? AND json_type(coalesce(checkpointJson,'{}'),'$.workerTerminal') IS NULL",json(result),runId);
  }
  endSegment(runId:string,epoch:number,terminal:TurnResult,engineClosed:boolean) {
    return this.tx(()=>this.finishSegment(runId,epoch,terminal,engineClosed));
  }
  private finishSegment(runId:string,epoch:number,terminal:TurnResult,engineClosed:boolean) {
      const r=this.run(runId),operationId='worker-return:'+runId+':'+epoch+':'+(r.turnId??'startup');
      const prior=this.one<Operation>("SELECT * FROM operations WHERE actorAgentId='host' AND scopeId=? AND operationId=?",r.taskId,operationId);
      if(prior?.responseJson)return JSON.parse(prior.responseJson) as {resultId:string;resultIds:string[]};
      if(r.epoch!==epoch||r.stopRequestedAt||!live(r))return;
      if(terminal.status==='completed'&&!isExecutionGuardStop(terminal.errorCode)&&['parked','ready'].includes(r.phase))return;
      if(terminal.status==='completed'&&!isExecutionGuardStop(terminal.errorCode)&&r.phase==='yielding'){
        const wait=this.one<{state:string}>("SELECT state FROM run_waits WHERE runId=? AND state IN ('armed','ready')",runId);
        if(wait){
          this.sql("UPDATE runs SET phase=?,turnId=NULL,checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.workerOutput','$.workerTerminal'),stateRevision=stateRevision+1 WHERE id=?",wait.state==='ready'?'ready':'parked',runId);
          this.bump(r.taskId);this.project(r.taskId);return;
        }
        terminal={...terminal,status:'unconfirmed',errorCode:'wait_intent_missing'};
      }
      const task=this.task(r.taskId),checkpoint=JSON.parse(r.checkpointJson??'{}');
      if(engineClosed&&!r.targetVersion&&terminal.status!=='unconfirmed'&&task.currentRunId===r.id&&task.headVersion===r.contractVersion)this.sql('UPDATE tasks SET reviewEnteredAt=? WHERE id=?',Date.now(),task.id);else this.markWaitingEntry(task,r);
      const messages:NonNullable<TurnResult['messages']>=terminal.messages??checkpoint.workerOutput??[];
      const final=messages.filter(m=>m.phase==='final_answer');
      const text=messages.length?(final.length?final:messages.filter(m=>m.phase===null)).map(m=>m.text).join('\n\n'):terminal.text;
      // Reuse a historical staged candidate as stored; never create a second
      // primary verdict for its Run or replace its previously selected files.
      const recorded=this.one<Result>("SELECT * FROM results WHERE runId=? AND version=? AND state='staged' AND outcome IS NOT NULL AND completionResultId IS NULL",runId,r.contractVersion);
      const files=recorded?this.completionResults(recorded).filter(item=>item.filePath):this.all<Result>("SELECT * FROM results WHERE runId=? AND version=? AND state='staged' AND filePath IS NOT NULL AND completionResultId IS NULL ORDER BY rowid",runId,r.contractVersion);
      const primary=recorded??files[0],key=id('op'),resultId=primary?.id??id('result');
      this.insertOperation(key,'host',task.id,operationId,'worker_return',{},'confirmed');
      const payload={...(primary?JSON.parse(primary.payloadJson):{}),...(!recorded||text?{text}:{}),messages,execution:{status:terminal.status,errorCode:terminal.errorCode??null,nativeOutputError:terminal.nativeOutputError??null,exitConfirmed:engineClosed}};
      if(primary)this.sql("UPDATE results SET state='offered',payloadJson=? WHERE id=?",json(payload),resultId);
      else this.sql(`INSERT INTO results(${RESULT_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,resultId,task.id,r.contractVersion,runId,task.executorAgentId,'structured',json(payload),null,null,'offered',null,null,null,'{}',key);
      for(const file of files)if(file.id!==resultId)this.sql("UPDATE results SET completionResultId=?,state='offered' WHERE id=?",resultId,file.id);
      const resultIds=[resultId,...files.filter(f=>f.id!==resultId).map(f=>f.id)],response={resultId,resultIds};
      this.sql("UPDATE operations SET responseJson=? WHERE id=?",json(response),key);
      this.sql("UPDATE runs SET status='awaiting_review',phase=?,artifact=coalesce(artifact,?),errorCode=?,endedAt=?,checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.workerOutput','$.workerTerminal'),stateRevision=stateRevision+1 WHERE id=?",engineClosed?'ended':'uncertain',files[0]?.filePath??null,terminal.errorCode??(engineClosed?null:'engine_stop_unconfirmed'),Date.now(),runId);
      this.sql("UPDATE run_waits SET state='cancelled' WHERE runId=? AND state IN ('armed','ready')",runId);
      this.cancelInteractions(runId,'worker_turn_ended');
      this.sql('UPDATE tasks SET state=?,outcome=NULL,revision=revision+1 WHERE id=?',engineClosed&&!r.targetVersion?'reviewing':'recovery',task.id);
      const kind=terminal.status==='completed'&&!terminal.errorCode?'result_ready':'terminal';
      // The existing notification is created in this transaction, once per return.
      this.notify({...task,headVersion:r.contractVersion},kind,{runId,epoch,version:r.contractVersion,resultId,resultIds,...(terminal.errorCode?{code:terminal.errorCode}:{}),startupFailure:!r.turnId&&terminal.status==='failed'});
      this.project(task.id);this.wake();return response;
  }
  private validateOutcome(t:Task,outcome:Outcome,evidence:Record<string,unknown>,children:ChildResolution[],key:string) {
    if(!['succeeded','partial','failed','cancelled','interrupted'].includes(outcome))throw Error('task_outcome_invalid');
    requireObject(evidence);
    if(outcome==='succeeded')for(const criterion of this.contract(t.id,t.headVersion).acceptance.criteria)
      if(criterion.required&&!evidence[criterion.id])throw Error('task_criterion_missing');
    if(outcome==='partial'&&!evidence.gaps)throw Error('task_partial_requires_gaps');
    this.resolutions(t,outcome,children,key);
  }
  review(actor: Actor, input: Mutation & {
    resultId: string;
    accepted?: boolean;
    decision?: 'accept' | 'request_changes' | 'terminal_failure';
    revision?: { contract:Contract; children:{taskId:string;action:'retain'}[]; queuedDisposition:{version:number;action:'cancel'}[] };
    outcome: Outcome;
    reason: string;
    evidence?:Record<string,unknown>;
    children?:ChildResolution[];
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'review', input, key => {
      const t = this.check(actor, input, { phases: ['executing'] });
      if (!this.main(actor) && t.coordinatorAgentId !== actor.agentId)
        throw Error('result_reviewer_denied');
      if(input.decision!==undefined&&input.accepted!==undefined)throw Error('task_invalid_verdict');
      if(input.decision===undefined&&input.accepted===false)throw new ReviewDecisionRequired({ok:false,state:'review_required',code:'review_decision_required',applied:false,taskId:t.id,version:t.headVersion,taskRevision:t.revision,runId:t.currentRunId,resultId:input.resultId,nextTool:'task_review',requiredField:'decision'});
      if(input.decision===undefined&&input.accepted!==true)throw Error('task_invalid_verdict');
      if(input.decision!==undefined&&!['accept','request_changes','terminal_failure'].includes(input.decision))throw Error('task_invalid_verdict');
      const accepted=input.decision==='accept'||input.accepted===true;
      if(input.decision!=='request_changes'&&input.revision!==undefined)throw Error('task_invalid_verdict');
      if(input.decision==='terminal_failure'&&input.outcome!=='failed')throw Error('result_outcome_conflict');
      const r = this.result(input.resultId);
      if (r.taskId !== t.id || r.version !== t.headVersion || r.runId !== t.currentRunId || r.completionResultId || r.state !== 'offered')
        throw Error('result_not_offered');
      const members=this.completionResults(r);
      for(const member of members) {
        if(member.taskId!==r.taskId || member.version!==r.version || member.runId!==r.runId || member.state!=='offered')throw Error('result_scope_denied');
        if (this.inspected.get(this.inspectionKey(actor, member.id)) !== recursiveHash(this.actualResult(member)))throw Error('result_inspection_required');
      }
      requireText(input.reason);
      if(input.decision==='request_changes') {
        const revision=input.revision, previous=r.runId?this.run(r.runId):undefined;
        if(!revision)throw Error('task_invalid_contract');
        if(r.outcome!==null&&input.outcome!==r.outcome)throw Error('result_outcome_conflict');
        const blocked=(code:string)=>new ReviewBlocked({ok:false,state:'review_blocked',code,applied:false,taskId:t.id,version:t.headVersion,taskRevision:t.revision,runId:t.currentRunId,resultId:r.id});
        if(!previous||previous.phase!=='ended'||previous.stopRequestedAt||this.store.meta('lease:'+previous.id)||this.lifecycle?.reviewExitConfirmed?.(previous)!==true)throw blocked('run_stop_unconfirmed');
        if(this.one("SELECT 1 FROM operations WHERE scopeId=? AND state IN ('accepted','dispatching','uncertain') AND NOT(kind='update' AND state='accepted' AND coalesce(json_extract(detailsJson,'$.mode'),'')='queue') AND id<>?",t.id,key)||this.pendingRpc(previous.id))throw blocked('review_effects_unresolved');
        const authority=this.authority(t.id,t.headVersion);
        if(!authority.sourceRequestId||!this.trustedSource(authority.sourceRequestId))throw Error('task_authority_source_denied');
        const contract={...revision.contract,workingDirectory:revision.contract.workingDirectory??this.contract(t.id,t.headVersion).workingDirectory??this.files.workspace};
        this.validateContract(contract,authority,t.id);
        const children=this.children(t.id).filter(c=>c.state!=='settled');
        if(new Set(revision.children.map(c=>c.taskId)).size!==revision.children.length||revision.children.length!==children.length||children.some(c=>c.controlState!=='normal'||!revision.children.some(d=>d.taskId===c.id&&d.action==='retain')))throw blocked('review_child_disposition_required');
        // Keep the first contract small: affected children must already have an
        // explicit, confirmed disposition. Never guess retain or do async stops
        // inside this transaction. Queue rebase is outside this review branch.
        const queued=this.queuedVersions(t.id);
        if(new Set(revision.queuedDisposition.map(q=>q.version)).size!==revision.queuedDisposition.length||revision.queuedDisposition.length!==queued.length||queued.some(q=>!revision.queuedDisposition.some(d=>d.version===q.version&&d.action==='cancel')))throw blocked('review_queued_disposition_required');
        for(const q of queued)this.sql("UPDATE operations SET state='cancelled',revision=revision+1 WHERE id=?",q.operationKey);
        const version=this.one<{n:number}>('SELECT max(version)+1 AS n FROM task_versions WHERE taskId=?',t.id)!.n;
        this.sql("UPDATE results SET state='rejected',reviewAgentId=?,reviewReason=? WHERE id=? OR completionResultId=?",actor.agentId,input.reason,r.id,r.id);
        this.sql("UPDATE runs SET status='interrupted',phase='ended',epoch=epoch+1,errorCode='revision_requested',endedAt=coalesce(endedAt,?),stateRevision=stateRevision+1 WHERE id=?",Date.now(),previous.id);
        this.insertVersion(t.id,version,contract,authority,key);
        this.sql("UPDATE tasks SET headVersion=?,state='waiting',outcome=NULL,revision=revision+1 WHERE id=?",version,t.id);
        const runId=this.newRun(this.task(t.id),version,key,previous.id);
        // newRun creates an internal attempt, without the legacy auto-complete flag.
        this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({decision:'request_changes',previousVersion:t.headVersion,previousRunId:previous.id,resultId:r.id,version,runId}),key);
        this.project(t.id);this.notify(this.task(t.id),'revision_requested',{previousVersion:t.headVersion,resultId:r.id,version,runId});this.wake();
        return {taskId:t.id,version,taskRevision:this.task(t.id).revision,decision:'request_changes',state:'queued',outcome:null,runId,replacesRunId:previous.id,resultId:r.id,resultIds:members.map(m=>m.id),started:false};
      }
      if(r.outcome===null){
        const previous=r.runId?this.run(r.runId):undefined;
        if(accepted&&(!previous||previous.phase!=='ended'||this.store.meta('lease:'+previous.id)||this.lifecycle?.reviewExitConfirmed?.(previous)===false))throw Error('run_stop_unconfirmed');
        if(accepted&&previous&&(this.pendingRpc(previous.id)||this.one("SELECT 1 FROM operations WHERE scopeId=? AND state IN ('dispatching','uncertain') AND id<>?",t.id,key)))throw Error('review_effects_unresolved');
        if(accepted&&input.outcome==='succeeded'&&['file','markdown'].includes(this.contract(t.id,t.headVersion).resultKind)&&!members.some(m=>m.filePath))throw Error('artifact_missing');
        if(accepted&&['succeeded','partial'].includes(input.outcome)&&!members.some(m=>m.filePath)&&!String(JSON.parse(r.payloadJson).text??'').trim())throw Error('result_empty');
        this.validateOutcome(t,input.outcome,input.evidence??{},input.children??[],key);
        this.sql('UPDATE results SET outcome=?,evidenceJson=? WHERE id=? OR completionResultId=?',input.outcome,json(input.evidence??{}),r.id,r.id);
      }else if(accepted&&r.outcome!==input.outcome)throw Error('result_outcome_conflict');
      requireText(input.reason);
      this.sql('UPDATE results SET state=?,reviewAgentId=?,reviewReason=? WHERE id=? OR completionResultId=?', accepted ? 'accepted' : 'rejected', actor.agentId, input.reason, r.id,r.id);
      const outcome = accepted ? input.outcome : 'failed';
      if (r.runId)
        this.sql("UPDATE runs SET status=?,phase='ended',endedAt=?,errorCode=?,stateRevision=stateRevision+1 WHERE id=?", outcome === 'succeeded' || outcome === 'partial' ? 'succeeded' : outcome, Date.now(), accepted ? (outcome==='failed'?this.run(r.runId).errorCode:null) : 'content_rejected', r.runId);
      this.sql("UPDATE tasks SET state='settled',outcome=?,settledAt=?,revision=revision+1 WHERE id=?", outcome, Date.now(), t.id);
      this.project(t.id);
      const confirmation=this.notify(t, accepted ? 'result_accepted' : 'terminal', { resultId: r.id, outcome });
      // The successful reviewer already knows this fact; retain its audit without another model turn.
      if(accepted&&outcome==='succeeded'&&t.coordinatorAgentId===actor.agentId)
        this.sql("UPDATE agent_receipts SET state='processed',processedBy=?,resultRef=?,revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state='pending'",actor.agentId,r.id,confirmation,actor.agentId);
      this.wake();
      if (!accepted && t.executorKind === 'main')
        this.holdChildren(t);
      this.activateQueue(t.id);
      if(input.decision==='accept')this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({decision:'accept'}),key);
      if(!accepted)this.markWaitingEntry(t);
      if(!accepted&&r.runId)this.sql("UPDATE runs SET phase='uncertain',stateRevision=stateRevision+1 WHERE id=?",r.runId);
      if(!accepted)this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({decision:'terminal_failure',closure:'pending',taskId:t.id,version:t.headVersion,runId:r.runId}),key);
      const current=this.task(t.id);
      const publication=accepted&&t.id===t.rootTaskId&&current.state==='settled'&&current.headVersion===input.version?{nextTool:'publish_delivery',taskId:t.id,version:input.version,taskRevision:current.revision}:{};
      return { resultId: r.id, state: accepted ? 'accepted' : 'rejected', outcome, ...publication, ...(!accepted?{decision:'terminal_failure',taskId:t.id,version:t.headVersion,runId:r.runId}:{}) };
    });
  }
  legacyReviewReceipt(actor:Actor,runId:string,operationId:string,accepted:boolean,reason:string) {
    const run=this.run(runId),task=this.task(run.taskId);this.readAllowed(actor,task);
    const op=this.one<Operation>('SELECT * FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?',actor.agentId,task.id,operationId);
    if(!op)return null;
    if(op.kind!=='review'||!op.responseJson)throw Error(op.responseJson?'operation_payload_conflict':'operation_uncertain');
    if(JSON.parse(op.detailsJson).decision!==undefined)throw Error('operation_payload_conflict');
    const receipt=JSON.parse(op.responseJson),result=this.result(receipt.resultId);
    if(result.taskId!==task.id||result.runId!==runId||result.version!==run.contractVersion||result.reviewAgentId!==actor.agentId||result.reviewReason!==reason||receipt.state!==(accepted?'accepted':'rejected'))throw Error('operation_payload_conflict');
    return receipt as Record<string,unknown>;
  }
  deferReview(actor:Actor,input:Mutation & {runId:string;code:string}) {
    this.requireMain(actor);
    return this.mutation(actor,input.taskId,input.operationId,'review_required',input,key=>{
      const t=this.check(actor,input,{phases:['executing']});
      if(t.currentRunId!==input.runId||this.run(input.runId).status!=='awaiting_review'||!['review_decision_required','run_stop_unconfirmed','review_effects_unresolved','review_child_disposition_required','review_queued_disposition_required'].includes(input.code))throw Error('result_not_offered');
      this.sql('UPDATE operations SET detailsJson=? WHERE id=?',json({runId:input.runId,code:input.code}),key);
      this.notify(t,'review_required',{runId:input.runId,code:input.code});
      return {taskId:t.id,runId:input.runId,state:'review_required',code:input.code,applied:false};
    });
  }
  private fail(r: TaskRun, code: string, uncertain = false,startupUnconfirmed=false) {
    if (!live(r))
      return;
    if(uncertain)this.markWaitingEntry(this.task(r.taskId),r);
    this.sql("UPDATE runs SET status=?,phase=?,epoch=epoch+1,errorCode=?,endedAt=?,stateRevision=stateRevision+1 WHERE id=?", uncertain ? 'interrupted' : 'failed', uncertain ? 'uncertain' : 'ended', code, Date.now(), r.id);
    this.sql("UPDATE results SET state='invalid' WHERE runId=? AND state<>'accepted'", r.id);
    this.sql("UPDATE run_waits SET state='cancelled' WHERE runId=? AND state IN ('armed','ready')", r.id);
    this.cancelInteractions(r.id, code);
    const t = this.task(r.taskId);
    this.sql('UPDATE tasks SET state=?,outcome=?,settledAt=?,revision=revision+1 WHERE id=?', uncertain ? 'recovery' : 'settled', uncertain ? null : 'failed', uncertain?null:Date.now(), t.id);
    this.project(t.id);
    this.notify(t, 'terminal', { runId: r.id, code,version:r.contractVersion,startupFailure:!uncertain&&!startupUnconfirmed&&code!=='engine_rpc_timeout'&&['ready','starting'].includes(r.phase)&&!JSON.parse(r.checkpointJson??'{}').executionAcknowledged });
    this.wake();
  }
  failRun(runId: string, epoch: number, code: string, uncertain = false,startupUnconfirmed=false) {
    this.tx(() => {
      const r = this.run(runId); if (r.epoch !== epoch)
        throw Error('run_epoch_stale'); this.fail(r, code, uncertain,startupUnconfirmed);
    });
  }
  private project(taskId: string) {
    const t = this.task(taskId);
    if (t.state !== 'settled' && t.state !== 'recovery') {
      const r = t.currentRunId ? this.run(t.currentRunId) : undefined;
      if (r) {
        const state = r.status === 'queued' ? 'queued' : r.status === 'awaiting_review' ? 'reviewing' : r.status === 'running' ? ['parked', 'yielding', 'rpc_wait', 'held'].includes(r.phase) ? 'waiting' : 'working' : 'settled';
        const outcome = live(r) ? null : r.status;
        this.sql('UPDATE tasks SET state=?,outcome=? WHERE id=?', state, outcome, t.id);
      }
      else
        this.sql("UPDATE tasks SET state='waiting' WHERE id=?", t.id);
    }
    const root = this.task(t.rootTaskId);
    const status = root.state === 'settled' ? (root.outcome === 'partial' ? 'failed' : root.outcome ?? 'interrupted') : root.state === 'queued' ? 'queued' : root.state === 'reviewing' ? 'awaiting_review' : 'running';
    this.sql('UPDATE matters SET status=?,revision=revision+1 WHERE id=?', status, t.matterId);
  }
  private cancelInteractions(runId: string, code: string) {
    if (this.table('worker_interactions'))
      this.sql("UPDATE worker_interactions SET state='cancelled',code=?,updatedAt=? WHERE runId=? AND state IN ('pending_main','pending_user')", code, Date.now(), runId);
  }
  private holdChildren(t: Task) {
    const main = this.store.meta('mainAgentId')!;
    for (const child of this.children(t.id)) {
      if (child.state === 'settled')
        continue;
      const newlyHeld = child.controlState !== 'held';
      if(newlyHeld)this.markWaitingEntry(child);
      if (newlyHeld)
        this.sql("UPDATE tasks SET coordinatorAgentId=?,controlState='held',revision=revision+1 WHERE id=?", main, child.id);
      if (child.currentRunId) {
        const r = this.run(child.currentRunId);
        if (live(r)) {
          if (newlyHeld)
            this.sql("UPDATE runs SET epoch=epoch+1,phase=?,stateRevision=stateRevision+1 WHERE id=?", r.phase === 'executing' || r.phase === 'rpc_wait' || r.phase === 'yielding' || r.phase === 'starting' ? 'uncertain' : 'held', r.id);
          this.cancelInteractions(r.id, 'parent_unavailable');
          this.sql("UPDATE run_waits SET state='cancelled' WHERE runId=? AND state IN ('armed','ready')", r.id);
        }
      }
      if (newlyHeld)
        this.notify(this.task(child.id), 'supervision_required', { parentTaskId: child.parentTaskId, controlState: 'held' });
    }
  }
  stop(actor: Actor, input: Mutation & {
    scope: 'self' | 'subtree';
    reason: string;
    runOnly?: boolean;
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'stop', input, key => {
      const t = this.task(input.taskId);
      this.readAllowed(actor, t);
      if (t.revision !== input.expectedTaskRevision || t.headVersion !== input.version)
        throw Error('task_revision_conflict');
      requireText(input.reason);
      if (t.state === 'settled')
        return { state: 'confirmed', taskId: t.id, targets: [], outcome: t.outcome };
      const targets: Task[] = [t];
      if (input.scope === 'subtree') {
        targets.push(...this.children(t.id));
        this.sql('UPDATE tasks SET subtreeStopOpId=? WHERE id=?', key, t.id);
      }
      const runs: string[] = [];
      for (const target of targets) {
        this.markWaitingEntry(target);
        this.sql("UPDATE tasks SET controlState='stopping',revision=revision+1 WHERE id=?", target.id);
        if (target.currentRunId) {
          const r = this.run(target.currentRunId);
          if (live(r)) {
            runs.push(r.id);
            this.sql('UPDATE runs SET stopRequestedAt=coalesce(stopRequestedAt,?),stopReason=?,epoch=epoch+1,stateRevision=stateRevision+1 WHERE id=?', Date.now(), input.reason, r.id);
            this.cancelInteractions(r.id, 'worker_stopped');
            this.sql("UPDATE run_waits SET state='cancelled' WHERE runId=? AND state IN ('armed','ready')", r.id);
            this.sql("UPDATE results SET state='invalid' WHERE runId=? AND state<>'accepted'", r.id);
          }
        }
      }
      if (input.scope === 'self' && t.executorKind === 'main')
        this.holdChildren(t);
      this.sql('UPDATE operations SET detailsJson=? WHERE id=?', json({ taskIds: targets.map(x => x.id), runIds: runs, runOnly: input.runOnly ?? false }), key);
      return { taskId: t.id, state: 'requested', targets: runs, heldRunIds: this.children(t.id).filter(c => c.controlState !== 'normal' || this.task(c.id).controlState === 'held').map(c => c.currentRunId).filter(Boolean) };
    }, 'accepted');
  }
  confirmStop(operationKey: string, confirmed: boolean) {
    return this.tx(() => {
      const op = this.operation(operationKey), details = JSON.parse(op.detailsJson);
      if (op.state === 'confirmed'||op.state==='uncertain'&&!confirmed)
        return JSON.parse(op.responseJson!);
      if (!['stop', 'update'].includes(op.kind))
        throw Error('operation_kind_conflict');
      for (const runId of details.runIds ?? []) {
        const r = this.run(runId);
        this.sql("UPDATE runs SET status=?,phase=?,endedAt=?,stateRevision=stateRevision+1 WHERE id=?", confirmed ? 'cancelled' : 'interrupted', confirmed ? 'ended' : 'uncertain', Date.now(), r.id);
        if (confirmed)
          this.sql("UPDATE operations SET state='cancelled',revision=revision+1 WHERE kind='update' AND state IN ('accepted','dispatching','uncertain') AND json_extract(detailsJson,'$.mode')='steer' AND json_extract(detailsJson,'$.runId')=?", r.id);
      }
      for (const taskId of details.taskIds ?? []) {
        const t = this.task(taskId);
        if (confirmed && !details.runOnly)
          for (const child of this.children(t.id)) {
            this.sql('INSERT OR REPLACE INTO child_resolutions VALUES(?,?,?,?,?,?,?,?,?)', t.id, t.headVersion, child.id, child.headVersion, child.state === 'settled' ? 'gap' : 'transferred', null, child.state === 'settled' ? null : child.coordinatorAgentId, child.state === 'settled' ? 'parent_stopped_child_fact_retained' : 'main_supervision_required', op.id);
          }
        this.markWaitingEntry(t);
        this.sql('UPDATE tasks SET controlState=?,state=?,outcome=?,settledAt=?,revision=revision+1 WHERE id=?', confirmed ? 'normal' : 'stopping', confirmed && !details.runOnly ? 'settled' : 'recovery', confirmed && !details.runOnly ? 'cancelled' : null,confirmed&&!details.runOnly?(t.state==='settled'?t.settledAt??null:Date.now()):null,t.id);
        this.project(t.id);
        const run=t.currentRunId?this.run(t.currentRunId):undefined,checkpoint=JSON.parse(run?.checkpointJson??'{}');
        const messages:NonNullable<TurnResult['messages']>=checkpoint.workerTerminal?.messages??checkpoint.workerOutput??[];
        const final=messages.filter(m=>m.phase==='final_answer');
        this.notify(this.task(t.id),'terminal',{stopConfirmed:confirmed,...(run?{runId:run.id,version:run.contractVersion,resultIds:this.all<Result>('SELECT * FROM results WHERE runId=?',run.id).map(r=>r.id),output:{text:messages.length?(final.length?final:messages.filter(m=>m.phase===null)).map(m=>m.text).join('\n\n'):checkpoint.workerTerminal?.text??'',messages}}:{})});
        if(run)this.sql("UPDATE runs SET checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.workerOutput','$.workerTerminal') WHERE id=?",run.id);
      }
      if (confirmed && details.replacement) {
        const t = this.task(op.scopeId);
        if (t.executorKind === 'worker') {
          const runId = this.newRun(t, t.headVersion, op.id, details.runIds?.[0] ?? null);
          details.replacementRunId = runId;
        }
        else
          this.sql("UPDATE tasks SET state='waiting',outcome=NULL WHERE id=?", t.id);
        this.project(t.id);
      }
      const response = { ...JSON.parse(op.responseJson ?? '{}'), state: confirmed ? 'confirmed' : 'uncertain', settlements: (details.taskIds ?? []).map((taskId: string) => ({ taskId, version: this.task(taskId).headVersion, outcome: this.task(taskId).outcome })), ...(details.replacementRunId ? { runId: details.replacementRunId } : {}) };
      this.sql('UPDATE operations SET state=?,detailsJson=?,responseJson=?,revision=revision+1 WHERE id=?', response.state, json(details), json(response), op.id);
      this.wake();
      return response;
    });
  }
  operation(key: string): Operation {
    const op = this.one<Operation>('SELECT * FROM operations WHERE id=?', key); if (!op)
      throw Error('operation_not_found'); return op;
  }
  update(actor: Actor, input: Mutation & {
    mode: 'steer' | 'stop_replace' | 'queue';
    contract: Contract;
    children: {
      taskId: string;
      action: 'retain' | 'update' | 'stop' | 'transfer';
      coordinatorAgentId?: string;
    }[];
    queuedDisposition: {
      version: number;
      action: 'cancel' | 'rebase';
      contract?: Contract;
    }[];
    independent?: boolean;
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'update', input, key => {
      const t = this.task(input.taskId);
      this.readAllowed(actor, t);
      if (t.revision !== input.expectedTaskRevision || t.headVersion !== input.version)
        throw Error('task_revision_conflict');
      if (t.controlState === 'stopping' || t.subtreeStopOpId)
        throw Error('task_stop_requested');
      const current = t.currentRunId ? this.run(t.currentRunId) : undefined;
      if(input.mode==='stop_replace'&&this.one("SELECT 1 FROM operations WHERE scopeId=? AND kind='review' AND json_extract(detailsJson,'$.decision')='terminal_failure' AND coalesce(json_extract(detailsJson,'$.closure'),'')<>'confirmed'",t.id))throw Error('review_closure_unconfirmed');
      if (input.mode === 'stop_replace' && current && !live(current) && current.phase === 'uncertain')
        throw Error('run_stop_unconfirmed');
      if (input.mode === 'steer' && (!current || current.status !== 'running' || current.phase !== 'executing' || !current.turnId || current.targetVersion || current.stopRequestedAt || this.pendingRpc(current.id) || this.one('SELECT 1 FROM results WHERE runId=?', current.id)))
        throw Error('task_steer_not_applicable');
      if (!['steer', 'stop_replace', 'queue'].includes(input.mode))
        throw Error('task_update_mode_invalid');
      if (input.mode === 'queue' && t.state === 'settled')
        throw Error('task_queue_not_applicable');
      const a = this.authority(t.id, t.headVersion);
      const previousDirectory=this.contract(t.id,t.headVersion).workingDirectory??this.files.workspace;
      input={...input,contract:{...input.contract,workingDirectory:input.contract.workingDirectory??previousDirectory}};
      if(input.mode==='steer'&&input.contract.workingDirectory!==previousDirectory)throw Error('task_directory_change_requires_new_attempt');
      this.validateContract(input.contract, a,t.id);
      const queued = this.queuedVersions(t.id);
      if (input.mode !== 'queue')
        for (const q of queued) {
          const disposition = input.queuedDisposition.find(d => d.version === q.version);
          if (!disposition)
            throw Error('task_queued_disposition_required');
          if (disposition.action === 'rebase' && !disposition.contract)
            throw Error('task_rebase_contract_required');
          this.sql("UPDATE operations SET state='cancelled',revision=revision+1 WHERE id=?", q.operationKey);
        }
      const version = this.one<{
        n: number;
      }>('SELECT max(version)+1 AS n FROM task_versions WHERE taskId=?', t.id)!.n;
      this.insertVersion(t.id, version, input.contract, a, key);
      if (input.mode === 'queue') {
        this.sql('UPDATE operations SET detailsJson=? WHERE id=?', json({ mode: 'queue', version, predecessor: queued.at(-1)?.version ?? t.headVersion, independent: input.independent ?? false, state: 'ordered' }), key);
        this.bump(t.id);
        return { taskId: t.id, version, state: 'queued', contractHash: recursiveHash(input.contract) };
      }
      let predecessor = version;
      for (const old of queued) {
        const disposition = input.queuedDisposition.find(d => d.version === old.version)!;
        if (disposition.action !== 'rebase')
          continue;
        const rebased = disposition.contract!;
        this.validateContract(rebased, a,t.id);
        const rebasedVersion = this.one<{
          n: number;
        }>('SELECT max(version)+1 AS n FROM task_versions WHERE taskId=?', t.id)!.n;
        const rebaseKey = id('op');
        this.insertOperation(rebaseKey, actor.agentId, t.id, input.operationId + ':rebase:' + old.version, 'update', rebased, 'accepted');
        this.insertVersion(t.id, rebasedVersion, rebased, a, rebaseKey);
        this.sql('UPDATE operations SET detailsJson=?,responseJson=? WHERE id=?', json({ mode: 'queue', version: rebasedVersion, predecessor, independent: old.independent, state: 'ordered', supersedesOperationKey: old.operationKey }), json({ taskId: t.id, version: rebasedVersion, state: 'queued', operationKey: rebaseKey }), rebaseKey);
        predecessor = rebasedVersion;
      }
      this.sql("UPDATE deliveries SET state='revoked',revokedAt=?,revision=revision+1 WHERE rootTaskId=? AND version=? AND state='prepared'", Date.now(), t.rootTaskId, t.headVersion);
      this.sql("UPDATE tasks SET headVersion=?,outcome=NULL,state='waiting',waitingEnteredAt=?,reviewEnteredAt=NULL,settledAt=NULL,revision=revision+1 WHERE id=?", version, Date.now(), t.id);
      if (input.mode === 'steer') {
        this.sql('UPDATE runs SET targetVersion=?,stateRevision=stateRevision+1 WHERE id=?', version, current!.id);
        this.sql('UPDATE operations SET detailsJson=? WHERE id=?', json({ mode: 'steer', version, runId: current!.id, epoch: current!.epoch, threadId: current!.threadId, expectedTurnId: current!.turnId, adopted: false }), key);
        this.project(t.id);
        return { taskId: t.id, version, state: 'accepted', runId: current!.id, expectedTurnId: current!.turnId, contractHash: recursiveHash(input.contract) };
      }
      const actualChildren=this.children(t.id),childStops:Record<string,unknown>[]=[],childActions:Record<string,unknown>[]=[];
      if(new Set(input.children.map(c=>c.taskId)).size!==input.children.length||input.children.some(c=>!actualChildren.some(a=>a.id===c.taskId)))throw Error('child_disposition_invalid');
      for (const child of actualChildren.filter(x => x.state !== 'settled')) {
        const disposition = input.children.find(x => x.taskId === child.id);
        if(disposition?.action==='transfer'&&(!disposition.coordinatorAgentId||disposition.coordinatorAgentId===child.executorAgentId||disposition.coordinatorAgentId!==this.store.meta('mainAgentId')))throw Error('task_coordinator_invalid');
        if(disposition?.action==='stop'){
          const stopKey=id('op'),run=child.currentRunId?this.run(child.currentRunId):null,targets=run&&live(run)?[run.id]:[];
          this.insertOperation(stopKey,actor.agentId,child.id,input.operationId+':stop:'+child.id,'stop',{parentOperationKey:key},'accepted');
          this.markWaitingEntry(child);
          this.sql("UPDATE tasks SET controlState='stopping',revision=revision+1 WHERE id=?",child.id);
          if(targets.length){this.sql("UPDATE runs SET epoch=epoch+1,stopRequestedAt=coalesce(stopRequestedAt,?),stopReason='parent_contract_replaced',stateRevision=stateRevision+1 WHERE id=?",Date.now(),run!.id);this.cancelInteractions(run!.id,'parent_contract_replaced');this.sql("UPDATE run_waits SET state='cancelled' WHERE runId=? AND state IN ('armed','ready')",run!.id);this.sql("UPDATE results SET state='invalid' WHERE runId=? AND state<>'accepted'",run!.id);}
          const receipt={taskId:child.id,state:'requested',targets,operationKey:stopKey};
          this.sql('UPDATE operations SET detailsJson=?,responseJson=? WHERE id=?',json({taskIds:[child.id],runIds:targets,runOnly:false}),json(receipt),stopKey);childStops.push(receipt);childActions.push({taskId:child.id,action:'stop',state:'requested'});continue;
        }
        if (!disposition || disposition.action !== 'retain') {
          this.markWaitingEntry(child);
          this.sql("UPDATE tasks SET controlState='held',revision=revision+1 WHERE id=?", child.id);
          if (child.currentRunId) {
            this.sql("UPDATE runs SET epoch=epoch+1,phase=CASE WHEN phase IN ('executing','starting','rpc_wait','yielding') THEN 'uncertain' ELSE 'held' END,stateRevision=stateRevision+1 WHERE id=? AND status='running'", child.currentRunId);
            this.cancelInteractions(child.currentRunId, 'parent_version_replaced');
          }
          childActions.push({taskId:child.id,action:disposition?.action??'hold',state:disposition?.action==='update'?'held_update_required':disposition?.action==='transfer'?'transfer_pending_stop_confirmation':'held',...(disposition?.coordinatorAgentId?{coordinatorAgentId:disposition.coordinatorAgentId}:{})});
        }
        else childActions.push({taskId:child.id,action:'retain',state:'retained'});
      }
      const runIds: string[] = [];
      if (current && live(current)) {
        runIds.push(current.id);
        this.sql('UPDATE runs SET epoch=epoch+1,stopRequestedAt=coalesce(stopRequestedAt,?),stopReason=\'replace\',stateRevision=stateRevision+1 WHERE id=?', Date.now(), current.id);
        this.cancelInteractions(current.id, 'contract_replaced');
        this.sql("UPDATE run_waits SET state='cancelled' WHERE runId=? AND state IN ('armed','ready')", current.id);
        this.sql("UPDATE results SET state='invalid' WHERE runId=? AND state<>'accepted'", current.id);
      }
      this.sql('UPDATE operations SET detailsJson=? WHERE id=?', json({ mode: 'stop_replace', version, taskIds: [t.id], runIds, replacement: true, runOnly: true }), key);
      if (!runIds.length) {
        let runId: string | null = null;
        if (t.executorKind === 'worker')
          runId = this.newRun(this.task(t.id), version, key, current?.id ?? null);
        this.project(t.id);
        return { taskId: t.id, version, runId, state: 'confirmed',childStops,childActions, contractHash: recursiveHash(input.contract) };
      }
      this.sql("UPDATE tasks SET controlState='stopping' WHERE id=?", t.id);
      this.project(t.id);
      return { taskId: t.id, version, state: 'requested', targets: runIds,childStops,childActions, contractHash: recursiveHash(input.contract) };
    }, input.mode === 'queue' || input.mode === 'steer' ? 'accepted' : 'accepted');
  }
  markSteer(operationKey: string, state: 'dispatching' | 'received' | 'failed' | 'uncertain') {
    this.tx(() => {
      const op = this.operation(operationKey), d = JSON.parse(op.detailsJson); if (op.kind !== 'update' || d.mode !== 'steer')
        throw Error('operation_kind_conflict'); if (op.state === 'confirmed')
        return; this.sql('UPDATE operations SET state=?,detailsJson=?,revision=revision+1 WHERE id=?', state === 'received' ? 'dispatching' : state, json({ ...d, rpcState: state }), op.id); if (state === 'uncertain')
        this.sql("UPDATE runs SET phase='uncertain',stateRevision=stateRevision+1 WHERE id=?", d.runId);
    });
  }
  adopt(actor: Actor, input: Mutation & {
    contractHash: string;
  }) {
    return this.mutation(actor, input.taskId, input.operationId, 'adopt', input, () => {
      const t = this.check(actor, input, { allowAdopt: true, phases: ['executing'] });
      if (!actor.runId || t.executorAgentId !== actor.agentId)
        throw Error('task_executor_required');
      const r = this.run(actor.runId);
      if (r.targetVersion !== input.version)
        throw Error('task_adopt_target_conflict');
      const hash = recursiveHash(this.contract(t.id, input.version));
      if (input.contractHash !== hash || this.inspected.get(this.inspectionKey(actor, 'contract:' + t.id)) !== hash)
        throw Error('task_adopt_inspection_required');
      // A read of the previous contract does not satisfy the adopted inputs.
      this.sql("UPDATE runs SET contractVersion=?,targetVersion=NULL,checkpointJson=json_remove(coalesce(checkpointJson,'{}'),'$.materialRead'),stateRevision=stateRevision+1 WHERE id=?", input.version, r.id);
      const op = this.version(t.id, input.version).triggerOpId;
      this.sql("UPDATE operations SET state='confirmed',detailsJson=json_set(detailsJson,'$.adopted',json('true')),revision=revision+1 WHERE id=?", op);
      this.bump(t.id);
      return { taskId: t.id, version: input.version, state: 'adopted' };
    });
  }
  queuedVersions(taskId: string) {
    return this.all<Operation>("SELECT * FROM operations WHERE scopeId=? AND kind='update' AND state='accepted' AND json_extract(detailsJson,'$.mode')='queue' ORDER BY rowid", taskId).map(o => ({ ...JSON.parse(o.detailsJson), operationKey: o.id })) as {
      version: number;
      predecessor: number;
      independent: boolean;
      operationKey: string;
    }[];
  }
  private activateQueue(taskId: string) {
    const t = this.task(taskId);
    if (t.state !== 'settled')
      return;
    const queue = this.queuedVersions(t.id), next = queue[0];
    if (!next)
      return;
    if (t.outcome === 'failed' || t.outcome === 'interrupted') {
      this.sql("UPDATE operations SET detailsJson=json_set(detailsJson,'$.state','blocked'),revision=revision+1 WHERE id=?", next.operationKey);
      return;
    }
    if (t.outcome === 'cancelled' && !next.independent) {
      this.sql("UPDATE operations SET state='cancelled',revision=revision+1 WHERE id=?", next.operationKey);
      return;
    }
    if (this.children(t.id).some(child => !this.one('SELECT 1 FROM child_resolutions WHERE parentTaskId=? AND parentVersion=? AND childTaskId=?', t.id, t.headVersion, child.id)))
      return;
    this.sql("UPDATE tasks SET headVersion=?,state='waiting',outcome=NULL,waitingEnteredAt=?,reviewEnteredAt=NULL,settledAt=NULL,revision=revision+1 WHERE id=?", next.version, Date.now(), t.id);
    const runId = t.executorKind === 'worker' ? this.newRun(this.task(t.id), next.version, next.operationKey, t.currentRunId) : null;
    const old = JSON.parse(this.operation(next.operationKey).responseJson ?? '{}');
    this.sql("UPDATE operations SET state='confirmed',responseJson=?,revision=revision+1 WHERE id=?", json({ ...old, state: 'activated', runId }), next.operationKey);
    this.project(t.id);
  }
  takeover(actor: Actor, input: Mutation & {
    coordinatorAgentId: string;
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'takeover', input, () => {
      const t = this.task(input.taskId);
      if (t.headVersion !== input.version || t.revision !== input.expectedTaskRevision)
        throw Error('task_revision_conflict');
      if (t.subtreeStopOpId || t.controlState === 'stopping')
        throw Error('task_stop_requested');
      if (input.coordinatorAgentId !== this.store.meta('mainAgentId'))
        throw Error('task_coordinator_invalid');
      if (t.currentRunId && this.run(t.currentRunId).phase === 'uncertain')
        throw Error('run_stop_unconfirmed');
      const authority=this.authority(t.id,t.headVersion);
      if(!authority.sourceRequestId||!this.trustedSource(authority.sourceRequestId))throw Error('task_authority_source_denied');
      if(t.controlState!=='normal'&&t.state!=='recovery'&&t.currentRunId){
        const r=this.run(t.currentRunId);if(r.contractVersion===t.headVersion&&r.phase==='ended'&&r.status==='awaiting_review')this.sql('UPDATE tasks SET reviewEnteredAt=? WHERE id=?',Date.now(),t.id);
      }
      this.sql("UPDATE tasks SET coordinatorAgentId=?,controlState='normal',revision=revision+1 WHERE id=?", input.coordinatorAgentId, t.id);
      return { taskId: t.id, state: 'taken_over' };
    });
  }
  continue(actor: Actor, input: Mutation) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'continue', input, key => {
      const t = this.check(actor, input, {});
      if (t.state === 'settled')
        throw Error('task_terminal');
      const old = t.currentRunId ? this.run(t.currentRunId) : undefined;
      if (this.one("SELECT 1 FROM operations WHERE scopeId=? AND state='uncertain'", t.id))
        throw Error('operation_uncertain');
      if (old && live(old)) {
        if (old.phase !== 'held')
          throw Error('task_run_busy');
        this.sql("UPDATE runs SET phase='ready',stateRevision=stateRevision+1 WHERE id=?", old.id);
        this.project(t.id);
        this.bump(t.id);
        return { taskId: t.id, runId: old.id, state: 'ready', method: 'same_process' };
      }
      if (old?.phase === 'uncertain')
        throw Error('run_stop_unconfirmed');
      const authority = this.authority(t.id, t.headVersion);
      if (!authority.sourceRequestId || !this.trustedSource(authority.sourceRequestId))
        throw Error('task_authority_source_denied');
      const runId = t.executorKind === 'worker' ? this.newRun(t, t.headVersion, key, old?.id ?? null) : null;
      if (!runId)
        this.sql("UPDATE tasks SET state='waiting',outcome=NULL WHERE id=?", t.id);
      this.bump(t.id);
      this.project(t.id);
      return { taskId: t.id, runId, state: runId ? 'queued' : 'coordination_ready', method: 'new_attempt' };
    });
  }
  reconcile() {
    this.tx(() => {
      for(const original of this.all<TaskRun>("SELECT * FROM runs WHERE taskId IS NOT NULL AND status IN ('queued','running','awaiting_review')")){
        const r=this.run(original.id);
        if(r.status==='awaiting_review'){
          // start() has already confirmed closure of every persisted lease.
          if(r.phase==='uncertain'){
            const task=this.task(r.taskId);if(task.currentRunId===r.id&&task.headVersion===r.contractVersion&&task.controlState==='normal')this.sql('UPDATE tasks SET reviewEnteredAt=? WHERE id=?',Date.now(),task.id);
            this.sql("UPDATE runs SET phase='ended',stateRevision=stateRevision+1 WHERE id=?",r.id);
            this.sql("UPDATE tasks SET state='reviewing',revision=revision+1 WHERE id=? AND outcome IS NULL",r.taskId);
          }
          continue;
        }
        // A wait turn ended, but its retained engine did not survive restart.
        const saved=r.phase==='yielding'?undefined:JSON.parse(r.checkpointJson??'{}').workerTerminal;
        this.finishSegment(r.id,r.epoch,saved??{status:'unconfirmed',text:'',errorCode:'restart_unconfirmed'},true);
        this.sql("UPDATE runs SET epoch=epoch+1,status=CASE WHEN ? THEN status ELSE 'interrupted' END,stateRevision=stateRevision+1 WHERE id=?",saved?1:0,r.id);
        if(!saved)this.sql("UPDATE tasks SET state='recovery',outcome=NULL,revision=revision+1 WHERE id=?",r.taskId);
        this.project(r.taskId);
      }
      this.sql("UPDATE agent_receipts SET state='uncertain',revision=revision+1 WHERE state IN ('offered','received')");
      this.sql("UPDATE operations SET state='uncertain',revision=revision+1 WHERE state='dispatching'");
      this.sql("UPDATE operations SET state='confirmed',responseJson=json_object('state','failed','reason','history_native_check_interrupted','operationKey',id),revision=revision+1 WHERE kind='delete_worker_history' AND state='accepted' AND json_extract(detailsJson,'$.phase')='checking'");
      this.sql("UPDATE deliveries SET state='uncertain',revision=revision+1 WHERE state='submitting'");
      this.sql("UPDATE operations SET detailsJson=json_set(detailsJson,'$.state','blocked'),revision=revision+1 WHERE kind='update' AND state='accepted' AND json_extract(detailsJson,'$.mode')='queue'");
    });
  }
  publish(actor: Actor, input: Mutation & {
    resultId: string | null;
    text: string;
    publishedFileResultId: string | null;
    publishedFileResultIds?: string[];
    outcome?:Outcome;
    evidence?:Record<string,unknown>;
    children?:ChildResolution[];
  }) {
    this.requireMain(actor);
    return this.mutation(actor, input.taskId, input.operationId, 'publish', input, key => {
      if (!this.main(actor))
        throw Error('delivery_main_required');
      const t = this.task(input.taskId);
      if (t.id !== t.rootTaskId || t.revision !== input.expectedTaskRevision)
        throw Error('delivery_root_not_settled');
      requireText(input.text, 24000);
      if(t.executorKind==='main'&&t.state!=='settled'&&!input.resultId){
        this.check(actor,input,{});
        if(['markdown','file'].includes(this.contract(t.id,input.version).resultKind))throw Error('artifact_missing');
        this.validateOutcome(t,input.outcome!,input.evidence!,input.children!,key);
        const resultId=id('result');
        this.sql(`INSERT INTO results(${RESULT_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,resultId,t.id,input.version,null,actor.agentId,'aggregate',json({text:input.text}),null,null,'accepted',input.outcome!,actor.agentId,null,json(input.evidence),key);
        // Structural roots already entered review when every current child was
        // accepted. Preserve that fact through native publication, including null.
        const priorReview=!t.currentRunId&&t.controlState==='normal'&&t.state!=='recovery'?this.one<{ready:number;enteredAt:number|null}>(`SELECT count(*)>0 AND min(coalesce(c.controlState='normal' AND c.state<>'recovery' AND r.contractVersion=c.headVersion AND r.phase='ended' AND r.status='succeeded' AND result.state='accepted' AND result.outcome IN ('succeeded','partial'),0)) AS ready,max(CASE WHEN typeof(r.endedAt)='integer' AND r.endedAt BETWEEN 0 AND 9007199254740991 THEN r.endedAt END) AS enteredAt
          FROM tasks c LEFT JOIN runs r ON r.id=c.currentRunId AND r.taskId=c.id LEFT JOIN results result ON result.id=(SELECT id FROM results WHERE taskId=c.id AND version=c.headVersion AND runId=c.currentRunId AND completionResultId IS NULL AND state<>'staged' ORDER BY rowid DESC LIMIT 1)
          WHERE c.parentTaskId=? AND c.rootTaskId=? AND c.executorKind='worker' AND c.historyState='visible'`,t.id,t.id):undefined;
        this.sql('UPDATE tasks SET reviewEnteredAt=? WHERE id=?',priorReview?.ready?priorReview.enteredAt:Date.now(),t.id);
        this.sql("UPDATE tasks SET state='settled',outcome=?,settledAt=?,revision=revision+1 WHERE id=?",input.outcome!,Date.now(),t.id);
        input={...input,resultId};this.project(t.id);
      }
      let outcome: Outcome | null = null;
      if (input.resultId) {
        const r = this.result(input.resultId);
        if (r.taskId !== t.id || r.version !== input.version || r.completionResultId || r.state !== 'accepted')
          throw Error('delivery_result_not_accepted');
        outcome = r.outcome;
      }
      else if (t.headVersion === input.version && t.state === 'settled')
        outcome = t.outcome;
      else
        for (const receipt of this.all<Operation>("SELECT * FROM operations WHERE scopeId=? AND state='confirmed' AND kind='stop'", t.id)) {
          const prior = JSON.parse(receipt.responseJson ?? '{}').settlements?.find((s: {
            taskId: string;
            version: number;
          }) => s.taskId === t.id && s.version === input.version);
          if (prior)
            outcome = prior.outcome;
        }
      if (!outcome)
        throw Error('delivery_root_not_settled');
      if(input.outcome!==undefined&&input.outcome!==outcome)throw Error('result_outcome_conflict');
      if (!input.resultId && (outcome === 'succeeded' || outcome === 'partial'))
        throw Error('delivery_result_required');
      const fileIds=input.publishedFileResultIds ?? (input.publishedFileResultId ? [input.publishedFileResultId] : []);
      if(!Array.isArray(fileIds) || fileIds.some(id=>typeof id!=='string'||!id) || new Set(fileIds).size!==fileIds.length || input.publishedFileResultIds && input.publishedFileResultId && fileIds[0]!==input.publishedFileResultId)throw Error('delivery_file_selection_invalid');
      for (const fileId of fileIds) {
        const r = this.result(fileId), producer = this.task(r.taskId);
        if (producer.matterId !== t.matterId || r.state !== 'accepted' || !r.filePath || !r.runId)
          throw Error('delivery_file_not_accepted');
        // Follow this published version's exact accepted result chain, never
        // current heads or merely the existence of an included child task.
        if (!input.resultId)
          throw Error('delivery_result_required');
        let includedResultId = input.resultId;
        if (producer.id !== t.id) {
          if (producer.parentTaskId !== t.id) throw Error('delivery_file_scope_denied');
          const resolution = this.one<{disposition:string;childVersion:number;resultId:string|null}>(
            'SELECT * FROM child_resolutions WHERE parentTaskId=? AND parentVersion=? AND childTaskId=?',t.id,input.version,producer.id);
          if (!resolution || resolution.disposition !== 'included' || !resolution.resultId) throw Error('delivery_file_not_included');
          const included = this.result(resolution.resultId);
          if (included.taskId !== producer.id || included.version !== resolution.childVersion || included.state !== 'accepted') throw Error('delivery_file_not_included');
          includedResultId = included.id;
        }
        if (includedResultId !== (r.completionResultId ?? r.id))
          throw Error('delivery_file_not_included');
        this.actualResult(r);
      }
      const deliveryId = id('delivery'), historyMessageId = id('message'), source = this.authority(t.id, input.version).sourceRequestId;
      if (!source || !this.trustedSource(source))
        throw Error('delivery_source_unresolved');
      if(t.headVersion===input.version&&t.state==='settled'&&!input.resultId)this.sql('UPDATE tasks SET reviewEnteredAt=? WHERE id=?',Date.now(),t.id);
      this.sql(`INSERT INTO deliveries(${DELIVERY_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,'prepared',0,NULL,NULL,?)`, deliveryId, t.id, input.version, input.resultId, outcome, fileIds[0] ?? null, source, input.text, historyMessageId, key);
      this.sql('UPDATE deliveries SET publishedFileResultIdsJson=? WHERE id=?',json(fileIds),deliveryId);
      this.activateQueue(t.id);
      return { deliveryId, historyMessageId, state: 'prepared', outcome, resultId:input.resultId, nextAction:'end_turn' };
    });
  }
  delivery(deliveryId: string) {
    const d = this.one<Delivery>('SELECT * FROM deliveries WHERE id=?', deliveryId); if (!d)
      throw Error('delivery_not_found'); return this.deliveryView(d);
  }
  private deliveryView(d:Delivery) { return {...d,publishedFileResultIds:d.publishedFileResultIdsJson ? JSON.parse(d.publishedFileResultIdsJson) as string[] : d.publishedFileResultId ? [d.publishedFileResultId] : []}; }
  deliveries(rootIds?:readonly string[]) { return (rootIds===undefined?this.all<Delivery>('SELECT * FROM deliveries ORDER BY rowid'):this.all<Delivery>('SELECT * FROM deliveries WHERE rootTaskId IN (SELECT value FROM json_each(?)) ORDER BY rowid',json(rootIds))).map(d=>this.deliveryView(d)); }
  pendingDeliveries() { return this.all<Delivery>("SELECT * FROM deliveries WHERE state='prepared' ORDER BY rowid").map(d=>this.deliveryView(d)); }
  markDelivery(deliveryId: string, state: 'submitting' | 'recorded' | 'uncertain' | 'revoked') {
    return this.tx(() => {
      const d = this.delivery(deliveryId); if (d.state === state)
        return d; if (d.state === 'revoked' || d.state === 'recorded' && state !== 'revoked' || d.state === 'uncertain' && state !== 'revoked')
        throw Error('delivery_transition_denied'); this.sql('UPDATE deliveries SET state=?,attemptedAt=coalesce(attemptedAt,?),revokedAt=?,revision=revision+1 WHERE id=?', state, Date.now(), state === 'revoked' ? Date.now() : null, d.id); return this.delivery(deliveryId);
    });
  }
  publishedArtifacts(runId: string, viewer?: {sourceRequestId?: string}) {
    return this.publishedFiles({runId},viewer);
  }
  publishedArtifact(runId: string, viewer?: {sourceRequestId?: string}) {
    return this.publishedArtifacts(runId,viewer)[0];
  }
  publishedResult(resultId:string,viewer?:{sourceRequestId?:string}) {
    return this.publishedFiles({resultId},viewer)[0];
  }
  publishedRevealTarget(resultId:string){
    if(!/^result-[\w-]{1,100}$/.test(resultId))throw Error('artifact_not_authorized');
    let file:ReturnType<RecursiveTasks['publishedResult']>;
    try{file=this.publishedResult(resultId);}catch(error){if(error instanceof SyntaxError)throw Error('artifact_source_invalid');throw error;}
    if(!file)throw Error('artifact_not_authorized');
    const result=this.result(resultId);
    if(!result.sha256)throw Error('artifact_version_unknown');
    const payload=JSON.parse(result.payloadJson);
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('artifact_source_invalid');
    if(!Object.hasOwn(payload,'workspaceSource'))return {path:file.path,target:'published' as const};
    const source=payload.workspaceSource;
    if(!source||typeof source.path!=='string'||source.sha256!==file.sha256)throw Error('artifact_source_invalid');
    if(source.path===file.path)return {path:file.path,target:'source' as const};
    const run=this.run(file.runId),actual=this.files.verify(this.files.prepareRun(run.matterId,run.id),source.path);
    if(actual.sha256!==source.sha256)throw Error('artifact_source_changed');
    return {path:actual.path,target:'source' as const};
  }
  publishedForMessages(historyMessageIds:readonly string[]){if(historyMessageIds.length>80)throw Error('publication_ids_limit');return historyMessageIds.length?this.publishedFiles({historyMessageIds}):[];}
  private publishedFiles(selector:{runId?:string;resultId?:string;historyMessageIds?:readonly string[]},viewer?:{sourceRequestId?:string}) {
    const rows=selector.historyMessageIds?this.all<Delivery>(`SELECT d.* FROM json_each(?) wanted CROSS JOIN deliveries d ON d.historyMessageId=wanted.value
      WHERE d.state IN ('prepared','submitting','recorded','uncertain') AND d.revokedAt IS NULL ORDER BY d.rowid DESC`,json([...new Set(selector.historyMessageIds)]))
      :this.all<Delivery>(`SELECT DISTINCT d.* FROM deliveries d JOIN results r
      ON r.id=d.publishedFileResultId OR EXISTS(SELECT 1 FROM json_each(d.publishedFileResultIdsJson) f WHERE f.value=r.id)
      WHERE ${selector.resultId?'r.id=?':'r.runId=?'} AND r.state='accepted'
      AND d.state IN ('prepared','submitting','recorded','uncertain') AND d.revokedAt IS NULL ORDER BY d.rowid DESC`,selector.resultId ?? selector.runId!);
    const files=[];
    const seen=new Set<string>();
    for(const row of rows) {
      if(viewer?.sourceRequestId && row.routeSourceRequestId!==viewer.sourceRequestId)continue;
      for(const id of this.deliveryView(row).publishedFileResultIds) {
        if(seen.has(id)||selector.resultId&&id!==selector.resultId)continue;
        const result=this.result(id);
        if(result.state!=='accepted'||!result.runId||selector.runId&&result.runId!==selector.runId)continue;
        const actual=this.actualResult(result);
        if(!actual.file)throw Error('delivery_file_not_accepted');
        seen.add(id);
        files.push({deliveryId:row.id,routeSourceRequestId:row.routeSourceRequestId,historyMessageId:row.historyMessageId,runId:result.runId,resultId:result.id,version:result.version,outcome:result.outcome,...actual.file});
      }
    }
    return files;
  }
  // Retain historical receipts. Only a known terminal target with matching
  // recipient and ended phase is inert; unknown/fenced source facts still block.
  safeToUpgrade() { return !this.one("SELECT 1 FROM runs WHERE taskId IS NOT NULL AND (status IN ('queued','running','awaiting_review') OR phase='uncertain')") && !this.one("SELECT 1 FROM tasks WHERE controlState IN ('held','stopping') OR state='recovery'") && !this.one("SELECT 1 FROM operations WHERE state IN ('accepted','dispatching','uncertain')") && !this.one(`SELECT 1 FROM agent_receipts r LEFT JOIN agent_messages m ON m.id=r.messageId
      WHERE r.state IN ('pending','offered','received','uncertain','blocked') AND NOT EXISTS (
        SELECT 1 FROM runs target JOIN tasks t ON t.id=target.taskId
        WHERE target.id=m.targetRunId AND t.executorAgentId=r.recipientAgentId
        AND m.recipientAgentId=r.recipientAgentId
        AND target.status IN ('succeeded','failed','cancelled','interrupted') AND target.phase='ended'
      )`) && !this.one("SELECT 1 FROM deliveries WHERE state IN ('prepared','submitting','uncertain')"); }
}
