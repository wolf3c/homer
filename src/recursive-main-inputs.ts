import { createHash, randomUUID } from 'node:crypto';
import {validatePreviewIntent} from './user-intent.js';
import type { RecursiveTasks } from './recursive-tasks.js';
import { recursiveHash } from './recursive-tasks.js';
import { conversationInput, encodeConversationReferences, type ConversationHistory, type ConversationInput, type ConversationAcceptance, type ConversationReceipt, type ConversationMessage } from './web-history.js';
type InterruptTarget = {
  generationId: string;
  messageId: string;
};
type InputPayload = {
  requestId: string;
  source: string;
  inputHash: string;
  inputRevision: number;
  priority: number;
  queueOrder?: number;
  interrupt?: InterruptTarget;
  interruptState?: 'requested' | 'confirmed' | 'failed' | 'uncertain';
  terminal?: 'completed' | 'failed' | 'interrupted' | 'cancelled';
};
type Row = {
  kind:string;
  taskId:string|null;
  taskVersion:number|null;
  senderAgentId:string;
  senderRunId:string|null;
  id: string;
  seq: number;
  payloadJson: string;
  receiptState: string;
  revision: number;
  offeredTurnId: string | null;
  replyId: string;
  threadId: string;
  detailsJson: string | null;
  hasRequest: number;
  resultJson?:string|null;
};
const inputRows = `SELECT m.id,m.seq,m.kind,m.taskId,m.taskVersion,m.senderAgentId,m.senderRunId,
  CASE WHEN m.kind='user_input' THEN m.payloadJson ELSE '{}' END payloadJson,
  r.state AS receiptState,r.revision,r.offeredTurnId,i.replyId,CASE WHEN m.kind='user_input' THEN i.threadId ELSE s.threadId END threadId,o.detailsJson,
  (m.kind='user_input' AND EXISTS(SELECT 1 FROM requests q WHERE q.id=json_extract(m.payloadJson,'$.requestId'))) AS hasRequest
  FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id
  LEFT JOIN conversation_inputs i ON i.requestId=CASE WHEN m.kind='user_input' THEN json_extract(m.payloadJson,'$.requestId') END
  LEFT JOIN operations o ON o.id=m.operationKey
  LEFT JOIN task_versions v ON v.taskId=m.taskId AND v.version=m.taskVersion
  LEFT JOIN conversation_inputs s ON s.requestId=v.sourceRequestId`;
export type QueuedInput = {
  origin:'user';
  messageId: string;
  seq: number;
  revision: number;
  inputRevision: number;
  input: ConversationInput;
  replyId: string;
  state: 'queued' | 'processing' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'uncertain';
  source: string;
  editable?:boolean;
  preparation?:'ready'|'preparing'|'failed';
  generationId?: string;
  interruptState?: InputPayload['interruptState'];
  interruptTarget?: InterruptTarget;
};
export type WorkerInput={origin:'worker';messageId:string;seq:number;revision:number;state:QueuedInput['state'];source:string;editable:false;kind:string;taskId:string|null;taskVersion:number|null;senderAgentId:string;runId:string|null;payload:unknown;text:string;};
export type MainInput=QueuedInput|WorkerInput;
export type MainInputLifecycle = {
  // Runs inside the claim transaction after the exact revision is fenced.
  // Only claim adopts the actual revision; enqueue merely records its source.
  claim(input: ConversationInput, threadId: string): void;
  readiness?(input:ConversationInput):'ready'|'preparing'|'failed';
  accepted?(input:ConversationInput,threadId:string):void;
  edited?(input:ConversationInput,threadId:string):void;
  cancelled?(requestId:string):void;
  mutation?(scope:QueueScope):void;
};
export type QueueScope={threadId?:string;readEpoch?:string};
export type QueueChange=QueueScope&{requestId:string;operationId:string;expectedRevision:number};
export type QueueMove=(QueueChange&{beforeRequestId:string|null}|{messageId:string;requestId?:never;operationId:string;expectedRevision:number;beforeMessageId:string|null})&{threadId:string;readEpoch:string;expectedOrderVersion:string};
export type DispatchInput=QueuedInput&{movable:boolean;position?:number;segmentStartRequestId?:string;nextRequestId?:string|null;moveUpBeforeRequestId?:string;moveDownBeforeRequestId?:string|null};
export type MainDispatchInput=MainInput&{movable:boolean;position?:number;firstMessageId?:string;nextMessageId?:string|null;previousMessageId?:string;moveDownBeforeMessageId?:string|null};
export type QueueOperationResult={requestId?:string;state:string;revision:number;inputRevision?:number;action?:'move';messageId?:string;orderVersion?:string;changed?:{requestId?:string;messageId?:string;revision:number}[];noOp?:true};
const rank="coalesce(CASE WHEN m.kind='user_input' THEN json_extract(m.payloadJson,'$.queueOrder') ELSE json_extract(o.detailsJson,'$.mainQueueOrder') END,m.seq)";
const dispatchOrder=rank+',m.seq';
export class MainInputClaimError extends Error{
  constructor(readonly messageId:string,readonly requestId:string,readonly revision:number,cause:unknown){
    super(cause instanceof Error&&/^[a-z][a-z0-9_]{1,70}$/.test(cause.message)?cause.message:'queue_claim_failed');
  }
}
// A projection and transaction API over the SAME agent_messages/receipts inbox.
// Message body and quotes remain in conversation_messages. No second queue table.
export class MainInputs {
  private readonly pausedActiveMessages:Set<string>;
  constructor(readonly tasks: RecursiveTasks, readonly history: ConversationHistory, private validateQuotes?: (input: ConversationInput) => void, private lifecycle?: MainInputLifecycle, private dispatchPolicy?:{pausedThroughSeq:number;pausedThroughProcessSeq?:number;resumeWorkers?:boolean}) {
    if(dispatchPolicy&&(!Number.isSafeInteger(dispatchPolicy.pausedThroughSeq)||dispatchPolicy.pausedThroughSeq<0||!Number.isSafeInteger(dispatchPolicy.pausedThroughProcessSeq??0)||(dispatchPolicy.pausedThroughProcessSeq??0)<0))throw Error('queue_pause_boundary_invalid');
    this.pausedActiveMessages=new Set(dispatchPolicy?this.db.prepare("SELECT r.messageId FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE r.recipientAgentId=? AND m.seq<=? AND r.state IN ('offered','received')").all(this.agent,dispatchPolicy.pausedThroughSeq).map(row=>String(row.messageId)):[]);
  }
  private get store() { return this.tasks.store; }
  private get db() { return this.store.db; }
  private get agent() { return this.store.meta('mainAgentId')!; }
  private row(requestId: string) { return this.db.prepare(inputRows+" WHERE m.kind='user_input' AND m.recipientAgentId=? AND json_extract(m.payloadJson,'$.requestId')=?").get(this.agent, requestId) as Row | undefined; }
  private payload(row: Row): InputPayload { return JSON.parse(row.payloadJson); }
  private rowEditable(row:Row){return row.receiptState==='pending'&&!row.offeredTurnId&&!JSON.parse(row.detailsJson??'{}').turnId&&!row.hasRequest;}
  private current(row: Row, message?: ConversationMessage): QueuedInput {
    const p = this.payload(row);
    message ??= this.history.inputs(row.threadId, [p.requestId]).get(p.requestId);
    if (!message) throw Error('queue_input_missing');
    const details = JSON.parse(row.detailsJson ?? '{}');
    const input = conversationInput({ requestId: p.requestId, text: message.text,...(message.attachments?{attachments:message.attachments}:{}),...(message.resourceReference?{resourceReference:message.resourceReference}:{}),...(message.resourceReferences?{resourceReferences:message.resourceReferences}:{}), ...(message.quotes ? { quotes: message.quotes } : message.quote ? { quote: message.quote } : {}), ...(details.interactionId ? { interactionId: details.interactionId } : {}) });
    return { origin:'user',messageId: row.id, seq: row.seq, revision: row.revision, inputRevision: p.inputRevision, input, replyId: row.replyId, source: p.source,editable:this.rowEditable(row),...(row.receiptState==='pending'?{preparation:this.preparation(input)}:{}), state: row.receiptState === 'pending' ? 'queued' : ['offered', 'received'].includes(row.receiptState) ? 'processing' : row.receiptState === 'uncertain' ? 'uncertain' : p.terminal ?? 'failed', ...(row.offeredTurnId ? { generationId: row.offeredTurnId } : {}), ...(p.interruptState ? { interruptState: p.interruptState, interruptTarget: p.interrupt } : {}) };
  }
  list(): QueuedInput[] {
    const rows=this.db.prepare(inputRows+" WHERE m.kind='user_input' AND m.recipientAgentId=? ORDER BY m.seq").all(this.agent) as Row[];
    const threads=new Map<string,string[]>();
    for(const row of rows){const ids=threads.get(row.threadId)??[];ids.push(this.payload(row).requestId);threads.set(row.threadId,ids);}
    const messages=new Map([...threads].map(([threadId,ids])=>[threadId,this.history.inputs(threadId,ids)]));
    return rows.map(row=>this.current(row,messages.get(row.threadId)?.get(this.payload(row).requestId)));
  }
  byRequestIds(ids:readonly string[]):QueuedInput[]{
    if(ids.length>160)throw Error('input_ids_limit');
    if(!ids.length)return [];
    const rows=this.db.prepare(inputRows+` WHERE m.kind='user_input' AND m.recipientAgentId=? AND json_extract(m.payloadJson,'$.requestId') IN (${ids.map(()=>'?').join(',')}) ORDER BY m.seq`).all(this.agent,...ids) as Row[];
    const threads=new Map<string,string[]>();for(const row of rows){const list=threads.get(row.threadId)??[];list.push(this.payload(row).requestId);threads.set(row.threadId,list);}
    const messages=new Map([...threads].map(([thread,ids])=>[thread,this.history.inputs(thread,ids)]));
    return rows.map(row=>this.current(row,messages.get(row.threadId)?.get(this.payload(row).requestId)));
  }
  activePage(after=0){
    if(!Number.isSafeInteger(after)||after<0)throw Error('input_cursor_invalid');
    const rows=this.db.prepare(inputRows.replace('FROM agent_messages m','FROM web_active_inputs w CROSS JOIN agent_messages m ON m.id=w.messageId')+" WHERE w.seq>? AND m.kind='user_input' AND m.recipientAgentId=? ORDER BY w.seq LIMIT 81").all(after,this.agent) as Row[];
    return {items:rows.slice(0,80).map(row=>this.current(row)),after:rows.length>80?rows[79]!.seq:null};
  }
  private order(row:Row){return row.kind==='user_input'?this.payload(row).queueOrder??row.seq:JSON.parse(row.detailsJson??'{}').mainQueueOrder??row.seq;}
  private workerCurrent(row:Row,body?:string):WorkerInput{
    const payload=JSON.parse(body??String(this.db.prepare('SELECT payloadJson FROM agent_messages WHERE id=?').get(row.id)!.payloadJson));
    const fields=Object(payload) as Record<string,unknown>;
    let text=typeof fields.text==='string'?fields.text:typeof fields.question==='string'?fields.question:JSON.stringify(payload,null,2);
    if(row.senderAgentId==='host'){
      text=row.kind==='interaction_required'?'Worker 有问题需要主 Agent 协调。':row.kind==='terminal'?'Worker 执行状态已变化，等待主 Agent 核对。':'Worker 返回了业务更新，等待主 Agent 处理。';
      if(row.kind==='result_ready'&&typeof fields.resultId==='string'){
        const resultJson=row.resultJson===undefined?this.db.prepare('SELECT payloadJson FROM results WHERE id=? AND taskId=? AND version=?').get(fields.resultId,row.taskId,row.taskVersion)?.payloadJson:row.resultJson;
        const body=typeof resultJson==='string'?JSON.parse(resultJson):undefined;
        const summary=body?.text??body?.summary;if(typeof summary==='string'&&summary.trim())text=summary;
      }
    }
    return {origin:'worker',messageId:row.id,seq:row.seq,revision:row.revision,state:row.receiptState==='pending'?'queued':['offered','received'].includes(row.receiptState)?'processing':'uncertain',source:'worker',editable:false,kind:row.kind,taskId:row.taskId,taskVersion:row.taskVersion,senderAgentId:row.senderAgentId,runId:row.senderRunId??(row.senderAgentId==='host'&&typeof fields.runId==='string'?fields.runId:null),payload,text};
  }
  private rowByMessage(messageId:string){return this.db.prepare(inputRows+' WHERE m.id=? AND m.recipientAgentId=? AND m.targetRunId IS NULL').get(messageId,this.agent) as Row|undefined;}
  private dispatchRows(view:'all'|'head'|'active'='all'){
    const sql=inputRows.replace('FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id','FROM agent_receipts r CROSS JOIN agent_messages m ON m.id=r.messageId');
    const state=view==='head'?"='pending'":view==='active'?"IN ('offered','received')":"IN ('pending','offered','received','uncertain')";
    const paused=view==='head'&&this.dispatchPolicy!==undefined;
    const rows=this.db.prepare(sql+" WHERE r.recipientAgentId=? AND r.state "+state+" AND m.recipientAgentId=r.recipientAgentId AND m.targetRunId IS NULL AND (CASE WHEN m.kind='user_input' THEN i.threadId ELSE s.threadId END)=?"+(paused?" AND (m.seq>?"+(this.dispatchPolicy!.resumeWorkers?" OR m.kind<>'user_input'":'')+")":'')+' ORDER BY '+dispatchOrder+(view==='head'?' LIMIT 1':'')).all(this.agent,this.store.meta('mainThread')!,...(paused?[this.dispatchPolicy!.pausedThroughSeq]:[])) as Row[];
    // Ignore owners inherited at startup, never a Worker claimed by this instance.
    return view==='active'&&this.dispatchPolicy?rows.filter(row=>row.seq>this.dispatchPolicy!.pausedThroughSeq||this.dispatchPolicy!.resumeWorkers&&row.kind!=='user_input'&&!this.pausedActiveMessages.has(row.id)):rows;
  }
  private dispatchSnapshot(){
    const rows=this.dispatchRows();
    const movable=rows.map(row=>this.rowEditable(row));
    const orderVersion=recursiveHash(rows.map((row,index)=>[row.id,row.revision,row.receiptState,this.order(row),movable[index]]));
    return {rows,movable,orderVersion,totalWaiting:rows.filter(row=>row.receiptState==='pending').length};
  }
  resumeWorkerMessages(){if(this.dispatchPolicy)this.dispatchPolicy.resumeWorkers=true;}
  dispatchSummary(){
    const {rows,orderVersion,totalWaiting}=this.dispatchSnapshot();
    const awaitingUser=this.dispatchPolicy&&!this.dispatchPolicy.resumeWorkers&&rows.some(row=>row.kind!=='user_input'&&row.receiptState==='pending'&&row.seq<=this.dispatchPolicy!.pausedThroughSeq);
    const unscoped=Number(this.db.prepare(`SELECT count(*) total FROM agent_receipts r CROSS JOIN agent_messages m ON m.id=r.messageId
      LEFT JOIN task_versions v ON v.taskId=m.taskId AND v.version=m.taskVersion
      LEFT JOIN conversation_inputs i ON i.requestId=v.sourceRequestId
      WHERE r.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND m.recipientAgentId=r.recipientAgentId AND m.kind<>'user_input' AND m.targetRunId IS NULL
        AND r.state IN ('pending','offered','received','uncertain','blocked') AND i.threadId IS NULL`).get()!.total);
    return {orderVersion,totalWaiting,...(awaitingUser?{awaitingUser:true as const}:{}),...(unscoped?{unscoped}:{})};
  }
  dispatchPage(cursor?:string,readEpoch?:string):{items:DispatchInput[];orderVersion:string;totalWaiting:number;nextCursor:string|null};
  dispatchPage(cursor:string|undefined,readEpoch:string,sources:'all'):{items:MainDispatchInput[];orderVersion:string;totalWaiting:number;nextCursor:string|null};
  dispatchPage(cursor?:string,readEpoch='',sources?:'all'){
    const {rows,movable,orderVersion,totalWaiting}=this.dispatchSnapshot(),threadId=this.store.meta('mainThread')!;
    if(sources!=='all'&&rows.some(row=>row.kind!=='user_input'))throw Error('queue_sources_required');
    let start=0;
    if(cursor){
      let value;try{if(cursor.length>1000)throw Error();value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{throw Error('queue_cursor_invalid');}
      if(value?.v!==1||value.threadId!==threadId||value.readEpoch!==readEpoch||value.orderVersion!==orderVersion||value.sources!==sources)throw Error('queue_cursor_expired');
      const index=rows.findIndex(row=>row.id===value.last);if(index<0)throw Error('queue_cursor_expired');start=index+1;
    }
    const end=Math.min(start+80,rows.length),selected=rows.slice(start,end);
    const messages=this.history.inputs(threadId,selected.filter(row=>row.kind==='user_input').map(row=>this.payload(row).requestId));
    const workerIds=selected.filter(row=>row.kind!=='user_input').map(row=>row.id);
    const bodies=new Map(workerIds.length?this.db.prepare(`SELECT m.id,m.payloadJson,r.payloadJson resultJson FROM agent_messages m
      LEFT JOIN results r ON m.senderAgentId='host' AND m.kind='result_ready' AND r.id=json_extract(m.payloadJson,'$.resultId') AND r.taskId=m.taskId AND r.version=m.taskVersion
      WHERE m.id IN (${workerIds.map(()=>'?').join(',')})`).all(...workerIds).map(row=>[String(row.id),{payloadJson:String(row.payloadJson),resultJson:row.resultJson as string|null}]):[]);
    let position=rows.slice(0,start).filter(row=>row.receiptState==='pending').length;
    const pending=rows.filter(row=>row.receiptState==='pending');
    const positions=new Map(pending.map((row,index)=>[row.id,index]));
    const items=selected.map((row,offset)=>{
      const index=start+offset,body=bodies.get(row.id),item=row.kind==='user_input'?this.current(row,messages.get(this.payload(row).requestId)):this.workerCurrent({...row,resultJson:body?.resultJson},body?.payloadJson);
      const at=positions.get(row.id)??-1;
      const shared={...item,movable:movable[index]!,...(row.receiptState==='pending'?{position:++position,firstMessageId:pending[0]?.id,nextMessageId:pending[at+1]?.id??null,previousMessageId:pending[at-1]?.id,moveDownBeforeMessageId:pending[at+2]?.id??null}:{})};
      if(sources==='all'||item.origin==='worker')return shared;
      return {...shared,segmentStartRequestId:pending[0]?this.payload(pending[0]).requestId:undefined,nextRequestId:pending[at+1]?this.payload(pending[at+1]!).requestId:null,moveUpBeforeRequestId:pending[at-1]?this.payload(pending[at-1]!).requestId:undefined,moveDownBeforeRequestId:pending[at+2]?this.payload(pending[at+2]!).requestId:null};
    });
    const nextCursor=end<rows.length?Buffer.from(JSON.stringify({v:1,threadId,readEpoch,orderVersion,last:rows[end-1]!.id,...(sources?{sources}:{})})).toString('base64url'):null;
    return {items,orderVersion,totalWaiting,nextCursor};
  }
  operationReceipt(scopeId:string,operationId:string){
    const row=this.db.prepare("SELECT responseJson FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=? AND kind='user_queue_change'").get('user:'+this.agent,scopeId,operationId);
    return row?JSON.parse(String(row.responseJson)) as QueueOperationResult:undefined;
  }
  recoveryMessages(after=0,messageId?:string){
    // Historical, already claimed inputs only. This never offers pending work.
    return this.db.prepare(`SELECT m.* FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id
      JOIN task_versions v ON v.taskId=m.taskId AND v.version=m.taskVersion
      JOIN conversation_inputs i ON i.requestId=v.sourceRequestId
      WHERE m.recipientAgentId=? AND i.threadId=? AND m.kind<>'user_input' AND m.targetRunId IS NULL
        AND r.state IN ('blocked','uncertain') AND m.seq>? ${this.dispatchPolicy?'AND m.seq>?':''} ${messageId?'AND m.id=?':''}
        AND EXISTS(SELECT 1 FROM meta p,json_each(p.value,'$.sourceMessageIds') s
          WHERE p.key GLOB 'publicMainNode:v1:*' AND json_extract(p.value,'$.threadId')=i.threadId
            AND json_extract(p.value,'$.sourceKind')='worker' AND json_extract(p.value,'$.state')='worked' AND s.value=m.id)
      ORDER BY m.seq LIMIT 80`).all(this.agent,this.store.meta('mainThread')!,after,...(this.dispatchPolicy?[this.dispatchPolicy.pausedThroughSeq]:[]),...(messageId?[messageId]:[])).map(row=>({...row,payload:JSON.parse(String(row.payloadJson))}));
  }
  messageBelongs(messageId:string){return this.rowByMessage(messageId)?.threadId===this.store.meta('mainThread');}
  private scope(row:Row,input:QueueScope){
    const thread=this.store.meta('mainThread');
    if(row.threadId!==thread||(input.threadId!==undefined&&input.threadId!==thread))throw Error('queue_thread_conflict');
    this.lifecycle?.mutation?.(input);
  }
  move(input:QueueMove){
    const byMessage='messageId' in input,scopeId=byMessage?input.messageId:input.requestId;
    return this.mutate(scopeId,input.operationId,{action:'move',...input},row=>{
      this.scope(row,input);
      if(row.receiptState!=='pending')throw Error('queue_input_processing');
      if(row.revision!==input.expectedRevision)throw Error('queue_revision_conflict');
      if(!this.rowEditable(row))throw Error('queue_input_locked');
      const {rows,orderVersion}=this.dispatchSnapshot();if(input.expectedOrderVersion!==orderVersion)throw Error('queue_order_conflict');
      if(!byMessage&&rows.some(item=>item.kind!=='user_input'))throw Error('queue_sources_required');
      const pending=rows.filter(item=>item.receiptState==='pending'),anchor=byMessage?input.beforeMessageId:input.beforeRequestId;
      const identity=(item:Row)=>byMessage?item.id:this.payload(item).requestId;
      if(!pending.some(item=>item.id===row.id))throw Error('queue_input_not_movable');
      if(anchor!==null&&!pending.some(item=>identity(item)===anchor))throw Error('queue_anchor_invalid');
      const reordered=pending.filter(item=>item.id!==row.id);
      const insert=anchor===identity(row)?pending.findIndex(item=>item.id===row.id):anchor===null?reordered.length:reordered.findIndex(item=>identity(item)===anchor);
      reordered.splice(insert,0,row);
      if(reordered.some((item,index)=>item.id!==pending[index]!.id&&!this.rowEditable(item)))throw Error('queue_input_locked');
      const changed:{messageId:string;requestId?:string;revision:number}[]=[];
      for(let n=0;n<pending.length;n++){
        const item=reordered[n]!;if(item.id===pending[n]!.id)continue;const slot=this.order(pending[n]!);
        if(item.kind==='user_input')this.db.prepare('UPDATE agent_messages SET payloadJson=? WHERE id=?').run(JSON.stringify({...this.payload(item),queueOrder:slot}),item.id);
        else this.db.prepare("UPDATE operations SET detailsJson=json_set(detailsJson,'$.mainQueueOrder',?) WHERE id=(SELECT operationKey FROM agent_messages WHERE id=?)").run(slot,item.id);
        this.db.prepare('UPDATE agent_receipts SET revision=revision+1 WHERE messageId=?').run(item.id);
        changed.push({messageId:item.id,...(item.kind==='user_input'?{requestId:this.payload(item).requestId}:{}),revision:item.revision+1});
      }
      return {...(!byMessage?{requestId:input.requestId}:{}),action:'move' as const,messageId:row.id,state:'queued',revision:row.revision+(changed.some(item=>item.messageId===row.id)?1:0),orderVersion:changed.length?this.dispatchSummary().orderVersion:orderVersion,changed,...(!changed.length?{noOp:true as const}:{})};
    },byMessage);
  }
  pendingInterrupts(){
    return (this.db.prepare(inputRows+" WHERE m.kind='user_input' AND m.recipientAgentId=? AND r.state='pending' AND json_extract(m.payloadJson,'$.interruptState')='requested'"+(this.dispatchPolicy?' AND m.seq>?':'')+' ORDER BY m.seq').all(this.agent,...(this.dispatchPolicy?[this.dispatchPolicy.pausedThroughSeq]:[])) as Row[]).map(row=>this.current(row));
  }
  preparation(input:ConversationInput){return this.lifecycle?.readiness?.(input)??'ready';}
  // Readiness observes the same durable head that transactional claim
  // owns. A preparing head blocks both selectors without skipping later inputs.
  private candidate():Row|undefined {
    return this.dispatchRows('head')[0];
  }
  runnableHead():QueuedInput|undefined;
  runnableHead(sources:'all'):MainInput|undefined;
  runnableHead(sources?:'all'){
    const row=this.candidate();if(!row)return;
    if(row.kind!=='user_input'){if(sources!=='all')throw Error('queue_sources_required');return this.workerCurrent(row);}
    const head=this.current(row);return head.preparation==='preparing'?undefined:head;
  }
  runnable(){return !!this.runnableHead('all');}
  accept(value: ConversationInput, acceptance?: ConversationAcceptance, interrupt?: InterruptTarget): ConversationReceipt & {
    queueMessageId?: string;
    queueState?: string;
    revision?: number;
  } {
    const input = conversationInput(value), thread = this.store.meta('mainThread');
    // Typed native answers belong to the live native callback, never this inbox.
    if(input.questionAnswers)throw Error('interaction_response_kind');
    if (!thread)
      throw Error('queue_thread_missing');
    let queueMessageId: string | undefined;
    const receipt = this.history.accept(thread, input, {
      source: acceptance?.source,validateFresh:()=>{validatePreviewIntent(input);this.validateQuotes?.(input);}, persist: receipt => {
        if (receipt.fresh) {
          const key = 'op-' + randomUUID(), messageId = 'message-' + randomUUID();
          const payload: InputPayload = { requestId: input.requestId, source: acceptance?.source ?? 'local', inputHash: recursiveHash(input), inputRevision: 1, priority: interrupt ? 1 : acceptance?.source==='first_launch' ? -1 : 0, ...(interrupt ? { interrupt, interruptState: 'requested' } : {}) };
          this.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson,responseJson,revision) VALUES(?,?,?,?,?,?,'confirmed',?,?,0)").run(key, 'user:' + this.agent, input.requestId, 'accept', 'user_accept', recursiveHash(input), JSON.stringify(input.interactionId ? { interactionId: input.interactionId } : {}), JSON.stringify({ messageId, replyId: receipt.replyId }));
          this.db.prepare("INSERT INTO agent_messages(id,senderAgentId,recipientAgentId,kind,operationKey,payloadJson) VALUES(?,?,?,'user_input',?,?)").run(messageId, 'user:' + this.agent, this.agent, key, JSON.stringify(payload));
          this.db.prepare("INSERT INTO agent_receipts(messageId,recipientAgentId,state) VALUES(?,?,'pending')").run(messageId, this.agent);
          this.db.prepare("UPDATE conversation_messages SET status='queued' WHERE requestId=? AND threadId=?").run(input.requestId, thread);
          queueMessageId = messageId;
          this.lifecycle?.accepted?.(input,thread);
        }
        else {
          const previous = this.row(input.requestId);
          queueMessageId = previous?.id;
          // A retry cannot upgrade an ordinary send into an interrupt.
          if (interrupt && previous && JSON.stringify(this.payload(previous).interrupt) !== JSON.stringify(interrupt))
            throw Error('queue_interrupt_payload_conflict');
        }
        return acceptance?.persist(receipt);
      }
    });
    const row = this.row(input.requestId);
    return { ...receipt, ...(queueMessageId ? { queueMessageId, queueState: row ? this.current(row).state : 'uncertain', revision: row?.revision } : {}) };
  }
  private mutate<T>(requestId: string, operationId: string, payload: unknown, fn: (row: Row, p: InputPayload) => T,byMessage=false): T {
    if (!/^[\w:.-]{1,150}$/.test(operationId))
      throw Error('queue_operation_invalid');
    return this.store.transaction(() => {
      const existing = this.db.prepare('SELECT payloadHash,responseJson FROM operations WHERE actorAgentId=? AND scopeId=? AND operationId=?').get('user:' + this.agent, requestId, operationId);
      if (existing) {
        if (existing.payloadHash !== recursiveHash(payload))
          throw Error('queue_operation_conflict');
        return JSON.parse(String(existing.responseJson));
      }
      const row = byMessage?this.rowByMessage(requestId):this.row(requestId);
      if (!row)
        throw Error('queue_input_not_found');
      const response = fn(row, this.payload(row));
      this.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson,responseJson,revision) VALUES(?,?,?,?,?,?,'confirmed','{}',?,0)").run('op-' + randomUUID(), 'user:' + this.agent, requestId, operationId, 'user_queue_change', recursiveHash(payload), JSON.stringify(response));
      return response;
    });
  }
  private editable(row: Row, expectedRevision: number) {
    if (row.receiptState !== 'pending')
      throw Error('queue_input_processing'); if (row.revision !== expectedRevision)
      throw Error('queue_revision_conflict');
    if(!this.current(row).editable)throw Error('queue_input_locked');
  }
  edit(input: QueueScope & {
    requestId: string;
    operationId: string;
    expectedRevision: number;
    input: ConversationInput;
  }) {
    const updated = conversationInput(input.input);
    if(updated.questionAnswers)throw Error('interaction_response_kind');
    if (updated.requestId !== input.requestId)
      throw Error('queue_request_id_conflict');
    return this.mutate(input.requestId, input.operationId, input, (row, p) => {
      this.scope(row,input);
      this.editable(row, input.expectedRevision);
      validatePreviewIntent(updated);
      if(updated.interactionId!==this.current(row).input.interactionId)throw Error('queue_interaction_conflict');
      if((updated.resourceReference||updated.resourceReferences)&&JSON.stringify([updated.resourceReference,updated.resourceReferences])!==JSON.stringify([this.current(row).input.resourceReference,this.current(row).input.resourceReferences]))throw Error('queue_quote_validation_required');
      if (this.validateQuotes)
        this.validateQuotes({...updated,resourceReference:undefined,resourceReferences:undefined});
      else if (updated.quotes?.length || updated.quote) {
        const previous = this.current(row).input;
        if (JSON.stringify(updated.quotes ?? updated.quote) !== JSON.stringify(previous.quotes ?? previous.quote))
          throw Error('queue_quote_validation_required');
      }
      const thread = this.store.meta('mainThread')!;
      const oldRefs=this.current(row).input.attachments??[];
      // Editors may keep/remove the exact scoped assets; adding assets requires intake.
      if(updated.attachments?.some(ref=>!oldRefs.some(old=>old.assetId===ref.assetId&&old.revision===ref.revision)))throw Error('media_scope_denied');
      this.db.prepare('DELETE FROM conversation_attachments WHERE requestId=?').run(input.requestId);
      if(updated.attachments?.length)this.db.prepare('INSERT INTO conversation_attachments VALUES(?,?)').run(input.requestId,JSON.stringify(updated.attachments));
      this.db.prepare("UPDATE conversation_messages SET text=?,quote=? WHERE requestId=? AND threadId=? AND role='user'").run(updated.text, encodeConversationReferences(updated), p.requestId, thread);
      this.db.prepare('UPDATE agent_messages SET payloadJson=? WHERE id=?').run(JSON.stringify({ ...p, inputHash: recursiveHash(updated), inputRevision: p.inputRevision + 1 }), row.id);
      this.db.prepare('UPDATE operations SET detailsJson=? WHERE id=(SELECT operationKey FROM agent_messages WHERE id=?)').run(JSON.stringify(updated.interactionId ? { interactionId: updated.interactionId } : {}), row.id);
      this.db.prepare('UPDATE agent_receipts SET revision=revision+1 WHERE messageId=? AND state=\'pending\'').run(row.id);
      this.lifecycle?.edited?.(updated,thread);
      return { requestId: p.requestId, state: 'queued', revision: row.revision + 1, inputRevision: p.inputRevision + 1 };
    });
  }
  cancel(input: QueueScope & {
    requestId: string;
    operationId: string;
    expectedRevision: number;
  }) {
    return this.mutate(input.requestId, input.operationId, input, (row, p) => {
      this.scope(row,input);
      this.editable(row, input.expectedRevision);
      this.db.prepare("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId=? AND state='pending'").run(row.id);
      this.db.prepare('UPDATE agent_messages SET payloadJson=? WHERE id=?').run(JSON.stringify({ ...p, terminal: 'cancelled' }), row.id);
      this.db.prepare("UPDATE conversation_messages SET status='cancelled' WHERE requestId=? AND threadId=?").run(p.requestId, this.store.meta('mainThread')!);
      this.lifecycle?.cancelled?.(p.requestId);
      return { requestId: p.requestId, state: 'cancelled', revision: row.revision + 1 };
    });
  }
  claim(suspended:{messageId:string;revision:number;generationId:string}[],sources:'all'):MainInput|undefined;
  claim(suspended?:{messageId:string;revision:number;generationId:string}[]):QueuedInput|undefined;
  claim(suspended:{messageId:string;revision:number;generationId:string}[]=[],sources?:'all'):MainInput|undefined {
    let selected:Row|undefined;
    try{return this.store.transaction(() => {
      const processFence=this.dispatchPolicy?" AND json_extract(value,'$.seq')>?":"";
      if(this.db.prepare("SELECT 1 FROM meta WHERE key GLOB 'publicMainNode:v1:*' AND json_extract(value,'$.threadId')=(SELECT value FROM meta WHERE key='mainThread') AND json_extract(value,'$.state')='working'"+processFence+' LIMIT 1').get(...(this.dispatchPolicy?[this.dispatchPolicy.pausedThroughProcessSeq??0]:[])))return;
      const active=this.dispatchRows('active');
      if(active.some(row=>!suspended.some(owner=>row.receiptState==='received'&&row.id===owner.messageId&&row.revision===owner.revision&&row.offeredTurnId===owner.generationId)))return;
      const row = this.candidate();
      if (!row)
        return;
      if(row.kind!=='user_input'){
        if(sources!=='all')throw Error('queue_sources_required');
        const current=this.workerCurrent(row);
        const changed=this.db.prepare("UPDATE agent_receipts SET state='offered',revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state='pending' AND revision=?").run(row.id,this.agent,row.revision);
        return changed.changes?{...current,state:'processing' as const,revision:row.revision+1}:undefined;
      }
      selected=row;
      const p = this.payload(row), current = this.current(row);
      const preparation=this.preparation(current.input);
      if(preparation==='preparing')return;
      if(preparation==='failed')throw Error('media_preparation_failed');
      if (recursiveHash(current.input) !== p.inputHash)
        throw Error('queue_input_hash_conflict');
      const change = this.db.prepare("UPDATE agent_receipts SET state='offered',revision=revision+1 WHERE messageId=? AND state='pending' AND revision=?").run(row.id, row.revision);
      if (!change.changes)
        return;
      this.db.prepare("UPDATE conversation_messages SET status='processing' WHERE requestId=? AND role='user'").run(p.requestId);
      this.db.prepare("UPDATE conversation_messages SET status='running' WHERE id=?").run(current.replyId);
      const hash=createHash('sha256').update(current.input.text).digest('hex');
      const previous=this.store.request(p.requestId);
      if(previous)throw Error(previous.hash===hash?'request_interrupted_use_new_id':'request_id_conflict');
      this.store.startRequest(p.requestId,hash);
      this.lifecycle?.claim(current.input, this.store.meta('mainThread')!);
      const claimed={...current,state:'processing' as const,editable:false,revision:row.revision+1};
      delete claimed.preparation;return claimed;
    });}catch(error){if(selected)throw new MainInputClaimError(selected.id,this.payload(selected).requestId,selected.revision,error);throw error;}
  }
  failClaim(error:MainInputClaimError){
    return this.store.transaction(()=>{
      const row=this.row(error.requestId);if(!row||row.id!==error.messageId||row.revision!==error.revision||row.receiptState!=='pending')throw Error('queue_revision_conflict');
      const p=this.payload(row);
      this.db.prepare("UPDATE agent_receipts SET state='rejected',revision=revision+1 WHERE messageId=?").run(row.id);
      this.db.prepare('UPDATE agent_messages SET payloadJson=? WHERE id=?').run(JSON.stringify({...p,terminal:'failed'}),row.id);
      this.db.prepare("UPDATE conversation_messages SET status='failed',text=CASE WHEN role='assistant' THEN ? ELSE text END WHERE requestId=?").run(error.message==='media_preparation_failed'?'附件准备失败，整条消息未执行。可查看各附件状态后重新发送可读材料。':'消息未开始处理：来源校验未完成。未自动重跑，可检查状态后另发消息。',p.requestId);
      const reply=this.db.prepare("SELECT id,text FROM conversation_messages WHERE requestId=? AND role='assistant'").get(p.requestId);
      if(reply)this.history.record('input-outcome:'+reply.id,this.store.meta('mainThread')!,String(reply.text),'failed',p.requestId);
      this.lifecycle?.cancelled?.(p.requestId);
    });
  }
  started(messageId: string, revision: number, generationId: string, turnId: string) { return this.store.transaction(() => this.startedInTransaction(messageId, revision, generationId, turnId)); }
  startedInTransaction(messageId: string, revision: number, generationId: string, turnId: string) {
    if (!this.db.isTransaction) throw Error('queue_transaction_required');
      const r = this.db.prepare("SELECT m.payloadJson,r.revision FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.id=? AND m.recipientAgentId=? AND r.state='offered'").get(messageId, this.agent);
      if (!r || r.revision !== revision)
        throw Error('queue_revision_conflict');
      this.db.prepare("UPDATE agent_receipts SET state='received',offeredTurnId=? WHERE messageId=?").run(generationId, messageId);
      // Native turnId is a transport reference only; it is never user identity.
      this.db.prepare('UPDATE operations SET detailsJson=json_set(detailsJson,\'$.turnId\',?) WHERE id=(SELECT operationKey FROM agent_messages WHERE id=?)').run(turnId, messageId);
  }
  continued(messageId:string,revision:number,generationId:string,expectedTurnId:string,turnId:string) { return this.store.transaction(() => this.continuedInTransaction(messageId,revision,generationId,expectedTurnId,turnId)); }
  continuedInTransaction(messageId:string,revision:number,generationId:string,expectedTurnId:string,turnId:string) {
    if (!this.db.isTransaction) throw Error('queue_transaction_required');
      const row=this.db.prepare("SELECT m.operationKey,r.offeredTurnId,r.revision,o.detailsJson FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id JOIN operations o ON o.id=m.operationKey WHERE m.id=? AND m.recipientAgentId=? AND r.state='received'").get(messageId,this.agent);
      if(!row||row.revision!==revision||row.offeredTurnId!==generationId||JSON.parse(String(row.detailsJson)).turnId!==expectedTurnId)throw Error('queue_revision_conflict');
      this.db.prepare("UPDATE operations SET detailsJson=json_set(detailsJson,'$.turnId',?) WHERE id=?").run(turnId,String(row.operationKey));
  }
  finish(messageId: string, revision: number, state: 'completed' | 'failed' | 'interrupted') { return this.store.transaction(() => this.finishInTransaction(messageId,revision,state)); }
  finishInTransaction(messageId: string, revision: number, state: 'completed' | 'failed' | 'interrupted') {
    if (!this.db.isTransaction) throw Error('queue_transaction_required');
      const row = this.db.prepare("SELECT m.id,m.payloadJson,r.revision FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.id=? AND m.recipientAgentId=? AND r.state IN ('offered','received')").get(messageId, this.agent); if (!row || row.revision !== revision)
        throw Error('queue_state_or_revision_conflict'); const p = JSON.parse(String(row.payloadJson)); this.db.prepare("UPDATE agent_receipts SET state='processed',revision=revision+1 WHERE messageId=?").run(messageId); this.db.prepare('UPDATE agent_messages SET payloadJson=? WHERE id=?').run(JSON.stringify({ ...p, terminal: state }), messageId); this.db.prepare("UPDATE conversation_messages SET status=? WHERE requestId=? AND role='user'").run(state, p.requestId);
  }
  uncertain(messageId:string,revision:number) { return this.store.transaction(() => this.uncertainInTransaction(messageId,revision)); }
  uncertainInTransaction(messageId:string,revision:number) {
    if (!this.db.isTransaction) throw Error('queue_transaction_required');
      const changed=this.db.prepare("UPDATE agent_receipts SET state='uncertain',revision=revision+1 WHERE messageId=? AND revision=? AND state IN ('offered','received')").run(messageId,revision);
      if(changed.changes)this.db.prepare("UPDATE conversation_messages SET status='interrupted' WHERE requestId=(SELECT json_extract(payloadJson,'$.requestId') FROM agent_messages WHERE id=?)").run(messageId);
      return !!changed.changes;
  }
  interruptReceipt(messageId: string, state: 'confirmed' | 'failed' | 'uncertain') { this.store.transaction(() => this.interruptReceiptInTransaction(messageId, state)); }
  private interruptReceiptInTransaction(messageId: string, state: 'confirmed' | 'failed' | 'uncertain') {
    const row = this.db.prepare("SELECT payloadJson FROM agent_messages WHERE id=? AND recipientAgentId=? AND kind='user_input'").get(messageId, this.agent);
    if (!row)
      throw Error('queue_input_not_found');
    const p: InputPayload = JSON.parse(String(row.payloadJson));
    if (!p.interrupt)
      throw Error('queue_interrupt_not_requested');
    if (p.interruptState === 'confirmed')
      return;
    if (state === 'confirmed') {
      const target = this.db.prepare("SELECT m.payloadJson,r.state,r.offeredTurnId FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id JOIN conversation_inputs i ON i.requestId=json_extract(m.payloadJson,'$.requestId') WHERE m.kind='user_input' AND m.recipientAgentId=? AND i.replyId=?").get(this.agent, p.interrupt.messageId);
      if (!target || target.offeredTurnId !== p.interrupt.generationId || target.state !== 'processed' || JSON.parse(String(target.payloadJson)).terminal !== 'interrupted')
        throw Error('queue_interrupt_target_not_ended');
    }
    this.db.prepare('UPDATE agent_messages SET payloadJson=? WHERE id=?').run(JSON.stringify({ ...p, interruptState: state }), messageId);
  }
  reconcile() {
    this.store.transaction(() => {
      const active = this.list().filter(r => r.state === 'processing' || r.state === 'uncertain');
      for (const item of active) {
        if(item.state==='processing')this.db.prepare("UPDATE agent_receipts SET state='uncertain',revision=revision+1 WHERE messageId=?").run(item.messageId);
        // An older generic recovery may already have made the receipt uncertain.
        // Synchronize only unfinished history; preserve terminal facts and the receipt.
        this.db.prepare("UPDATE conversation_messages SET status='interrupted' WHERE requestId=? AND threadId=? AND status IN ('queued','processing','running')").run(item.input.requestId,this.store.meta('mainThread')!);
      }
    });
  }
}
