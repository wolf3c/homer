import {WorkerCardEvents,type WorkerCardInput,type WorkerCardSnapshot} from './worker-card-events.js';
import type { DatabaseSync } from 'node:sqlite';
import {publicActivityName,type PublicActivity} from './activity-facts.js';
import { PROGRESS_LABELS } from './main-progress.js';
import type {ToolContent} from './tool-content.js';

export type ProcessTiming = { startedAtMs?: number; endedAtMs?: number; durationMs?: number; timingSource?: 'native' | 'hostObserved'; timingState?: 'running' | 'terminal' | 'unknown' };
export type TurnTimingEvidence = { startedAtMs?: number; endedAtMs?: number; durationMs?: number; observedAtMs?: number };
export type NativeToolCategory = 'readFiles' | 'search' | 'listFiles' | 'inspectFiles' | 'command' | 'fileChange' | 'webSearch' | 'imageView' | 'imageGeneration' | 'externalTool';
export type NativeProcessEvent = {
  threadId: string; turnId: string; itemId: string; category: NativeToolCategory;
  status: 'running' | 'completed' | 'failed' | 'declined' | 'interrupted' | 'unknown';
  completed: boolean; fileCount?: number; label?:string; toolName?:string; content?:ToolContent;
} & TurnTimingEvidence;
export const nativeLabels: Record<NativeToolCategory, string> = {readFiles:'读取文件',search:'查找内容',listFiles:'列出文件',inspectFiles:'检查文件',command:'运行命令',fileChange:'修改文件',webSearch:'搜索网页',imageView:'查看图片',imageGeneration:'生成图片',externalTool:'调用外部工具'};
const validMs = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
type TurnClock = { hostStartedAtMs: number; nativeStartedAtMs?: number; hostEndedAtMs?: number; nativeEndedAtMs?: number; nativeDurationMs?: number };
export type ProcessItem = { id: string; seq: number; revision: number } & (
  { kind: 'commentary'; text: string; phase?: string | null; role?: 'assistant'; turnId?: string; itemId?: string; completed?: boolean } |
  ({ kind: 'tool'; activity?:PublicActivity; label: string; toolName?:string; content?:ToolContent; status: NativeProcessEvent['status'] | 'blocked'; category?: NativeToolCategory | 'host'; threadId?: string; turnId?: string; itemId?: string; invocationCount?: number; fileCount?: number } & ProcessTiming) |
  { kind: 'workerEvent'; eventKey:string; event?:WorkerCardSnapshot } |
  { kind: 'worker'; label?: string; taskId: string; version: number; taskRevision: number; runId: string | null; runRevision: number | null; runStatus: string | null; resultState: string | null; epoch: number | null; state: string; controlState: string; outcome: string | null; phase: string | null; stopRequested: boolean }
);
export type ProcessNode = ProcessTiming & {
  id: string; threadId: string; seq: number; revision: number;
  sourceKind: 'user' | 'worker' | 'scheduled'; sourceMessageIds: string[]; sourceEventId?: string; messageId: string; replyMessageId?: string;
  replyPolicy?: 'explicitFinal';
  state: 'working' | 'worked'; status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
  turnIds: string[]; endEventId?: string; items: ProcessItem[];
  toolStatusCounts?: Partial<Record<Extract<ProcessItem,{kind:'tool'}>['status'],number>>;
  final?: { id: string; text: string };
  details?:'unloaded';
};
type Stored = ProcessNode & { turnClocks?: Record<string, TurnClock>; itemClocks?: Record<string, TurnClock>; finalCandidate?: { id: string; text: string }; completedItemIds: string[]; itemPhases: Record<string, string | null>; uncertainTurnIds?:string[] };
const prefix = 'publicMainNode:v1:';

function clockTiming(clock: TurnClock): ProcessTiming {
  const native = validMs(clock.nativeStartedAtMs) && validMs(clock.nativeEndedAtMs) && clock.nativeEndedAtMs >= clock.nativeStartedAtMs;
  const startedAtMs = native ? clock.nativeStartedAtMs! : clock.hostStartedAtMs;
  const endedAtMs = native ? clock.nativeEndedAtMs : clock.hostEndedAtMs;
  return {startedAtMs, timingSource:native?'native':'hostObserved', timingState:endedAtMs===undefined?'running':'terminal',
    ...(endedAtMs!==undefined?{endedAtMs,...(endedAtMs>=startedAtMs?{durationMs:native&&validMs(clock.nativeDurationMs)?clock.nativeDurationMs:endedAtMs-startedAtMs}:{})}:{})};
}
function updateNodeTiming(node: Stored) {
  const clocks = node.turnIds.map(id=>node.turnClocks?.[id]);
  if (!clocks.length || clocks.some(clock=>!clock)) return; // Historical records have no inferred clock.
  const first=clocks[0]!,last=clocks.at(-1)!;
  let timing=clockTiming(first);
  if(clocks.length>1){
    // A continuous interval, never a sum of native/tool durations.
    const native=clocks.every(clock=>validMs(clock!.nativeStartedAtMs)&&validMs(clock!.nativeEndedAtMs)&&clock!.nativeEndedAtMs!>=clock!.nativeStartedAtMs!)&&last.nativeEndedAtMs!>=first.nativeStartedAtMs!;
    const startedAtMs=native?first.nativeStartedAtMs!:first.hostStartedAtMs,endedAtMs=native?last.nativeEndedAtMs:last.hostEndedAtMs;
    timing={startedAtMs,timingSource:native?'native':'hostObserved',timingState:endedAtMs===undefined?'running':'terminal',...(endedAtMs!==undefined?{endedAtMs,...(endedAtMs>=startedAtMs?{durationMs:endedAtMs-startedAtMs}:{})}:{})};
  }
  delete node.endedAtMs;delete node.durationMs;Object.assign(node,timing);
}

// Process nodes stay in meta; immutable Worker event bodies have their own table.
// Sequence is an observed event sequence, never a timestamp heuristic.
export class MainProcessHistory {
  private events:WorkerCardEvents;
  constructor(private db: DatabaseSync) {this.events=new WorkerCardEvents(db);}
  private hydrate(nodes:ProcessNode[]):ProcessNode[]{
    const keys=nodes.flatMap(node=>node.items.flatMap(item=>item.kind==='workerEvent'?[item.eventKey]:[]));
    // Retain exact source phases in storage; only known public text phases
    // belong in list, header and detail projections (including legacy rows).
    const events=this.events.read([...new Set(keys)]);return nodes.map(node=>({...node,items:node.items.filter(item=>item.kind!=='commentary'||item.phase==='commentary'||item.phase==='final_answer').map(item=>item.kind==='workerEvent'?{...item,event:events.get(item.eventKey)}:item)}));
  }
  workerEvent(id:string,input:WorkerCardInput){
    const node=this.load(id);if(!node)throw Error('worker_event_anchor_missing');
    this.db.exec('SAVEPOINT worker_event_append');
    try{const itemId='worker-event:'+input.eventKey;const receipt=this.events.record(node.threadId,id,itemId,input);
      if(receipt.created&&node.state!=='working')throw Error('worker_event_anchor_closed');
      if(receipt.created){node.items.push({id:itemId,seq:node.items.length+1,revision:1,kind:'workerEvent',eventKey:input.eventKey});node.revision++;this.save(node);}
      this.db.exec('RELEASE worker_event_append');return receipt;
    }catch(error){this.db.exec('ROLLBACK TO worker_event_append;RELEASE worker_event_append');throw error;}
  }
  exact(id:string):ProcessNode|undefined{
    const stored=this.load(id);if(!stored)return;
    const {finalCandidate:_candidate,completedItemIds:_ids,itemPhases:_phases,uncertainTurnIds:_uncertain,turnClocks:_clocks,itemClocks:_itemClocks,...node}=stored;
    return this.hydrate([node])[0]!;
  }
  headers(ids:readonly string[],details=false):ProcessNode[]{
    if(!ids.length)return [];if(ids.length>80)throw Error('process_ids_limit');
    // A bounded read-only summary keeps risks visible without fetching full tool rows.
    const counts=`(SELECT json_group_object(status,total) FROM (
      SELECT status,COUNT(*) total FROM (
        SELECT json_extract(item.value,'$.status') status,
          ROW_NUMBER() OVER (PARTITION BY json_extract(item.value,'$.id') ORDER BY coalesce(json_extract(item.value,'$.revision'),0) DESC,CAST(item.key AS INTEGER)) latest
        FROM json_each(meta.value,'$.items') item WHERE json_extract(item.value,'$.kind')='tool'
      ) WHERE latest=1 AND status IN ('running','completed','failed','declined','interrupted','unknown','blocked') GROUP BY status
    ))`;
    const selection=details?'value':`CASE WHEN json_extract(value,'$.state')='working' THEN value ELSE json_set(json_remove(value,'$.completedItemIds','$.itemPhases','$.finalCandidate','$.turnClocks','$.itemClocks','$.uncertainTurnIds'),'$.items',json(coalesce((SELECT json_group_array(json(CASE WHEN json_extract(item.value,'$.kind')='tool' THEN json_object('id',json_extract(item.value,'$.id'),'seq',json_extract(item.value,'$.seq'),'revision',json_extract(item.value,'$.revision'),'kind','tool','label',json_extract(item.value,'$.label'),'status',json_extract(item.value,'$.status'),'activity',json_extract(item.value,'$.activity')) ELSE item.value END)) FROM json_each(meta.value,'$.items') item WHERE json_extract(item.value,'$.kind') IN ('worker','workerEvent') OR (json_extract(item.value,'$.kind')='tool' AND json_extract(item.value,'$.activity.action') IN ('update_task','stop_task','continue_task','create_task')) OR (json_extract(meta.value,'$.sourceKind')='user' AND json_extract(item.value,'$.kind')='commentary' AND json_extract(item.value,'$.phase')='final_answer')),'[]')),'$.toolStatusCounts',json(${counts}),'$.details','unloaded') END`;
    return this.hydrate(this.db.prepare(`SELECT ${selection} value FROM meta WHERE key IN (${ids.map(()=>'?').join(',')})`).all(...ids.map(id=>prefix+id)).map(row=>{
      const {finalCandidate:_candidate,completedItemIds:_ids,itemPhases:_phases,uncertainTurnIds:_uncertain,turnClocks:_clocks,itemClocks:_itemClocks,...node}=JSON.parse(String(row.value)) as Stored;return node;
    }));
  }
  private load(id: string): Stored | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(prefix + id);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  coordination(id:string){
    const node=this.load(id);
    if(!node||node.sourceKind==='user'||node.state!=='worked'||node.final?.id!==node.messageId||!node.final.text.trim()||node.sourceMessageIds.length!==1)return;
    if(node.sourceKind==='scheduled'){
      const row=this.db.prepare("SELECT 1 FROM agent_messages m JOIN conversation_messages h ON h.id=? WHERE m.id=? AND m.kind='scheduled_message' AND m.senderAgentId='host' AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND json_extract(m.payloadJson,'$.threadId')=? AND h.threadId=? AND h.text=?").get(node.messageId,node.sourceMessageIds[0]!,node.threadId,node.threadId,node.final.text);
      return row?{messageId:node.messageId,text:node.final.text,sourceRequestId:undefined}:undefined;
    }
    const source=this.db.prepare(`SELECT v.sourceRequestId,CASE WHEN m.senderAgentId='host' AND m.kind='interaction_required' THEN json_extract(m.payloadJson,'$.interactionId') END interactionId FROM agent_messages m
      JOIN task_versions v ON v.taskId=m.taskId AND v.version=m.taskVersion
      JOIN conversation_inputs i ON i.requestId=v.sourceRequestId
      JOIN conversation_messages h ON h.id=? AND h.threadId=i.threadId
      WHERE m.id=? AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId')
        AND i.threadId=? AND h.text=?`).get(node.messageId,node.sourceMessageIds[0]!,node.threadId,node.final.text);
    if(!source)return;
    return {messageId:node.messageId,text:node.final.text,sourceRequestId:String(source.sourceRequestId),...(typeof source.interactionId==='string'?{interactionId:source.interactionId}:{})};
  }
  coordinationIds(threadId:string){
    return this.db.prepare("SELECT json_extract(value,'$.id') id FROM meta WHERE key GLOB 'publicMainNode:v1:*' AND json_extract(value,'$.threadId')=? AND json_extract(value,'$.sourceKind')='worker' AND json_extract(value,'$.state')='worked' AND json_extract(value,'$.final.id')=json_extract(value,'$.messageId') ORDER BY json_extract(value,'$.seq')").all(threadId).map(row=>String(row.id));
  }
  private save(node: Stored) {
    this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(prefix + node.id, JSON.stringify(node));
  }
  start(input: Pick<ProcessNode, 'id' | 'threadId' | 'sourceKind' | 'sourceMessageIds' | 'sourceEventId' | 'messageId' | 'replyMessageId' | 'replyPolicy'>, turnId: string, timing?: TurnTimingEvidence, initialText?:string) {
    const prior = this.load(input.id);
    if (prior) {
      if (prior.state === 'worked' || prior.turnIds.includes(turnId)) return false;
      prior.turnIds.push(turnId);
      if(timing){(prior.turnClocks??={})[turnId]={hostStartedAtMs:validMs(timing.observedAtMs)?timing.observedAtMs:Date.now(),...(validMs(timing.startedAtMs)?{nativeStartedAtMs:timing.startedAtMs}:{})};updateNodeTiming(prior);}
      prior.revision++; this.save(prior); return false;
    }
    const seq = Number(this.db.prepare("SELECT value FROM meta WHERE key='publicMainNodeSeq:v1'").get()?.value ?? 0) + 1;
    this.db.prepare("INSERT INTO meta(key,value) VALUES('publicMainNodeSeq:v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(seq));
    const node:Stored={ ...input, seq, revision: 1, state: 'working', status: 'running', turnIds: [turnId], items: [], completedItemIds: [], itemPhases: {} };
    if(initialText)node.items.push({id:input.id+':source',seq:1,revision:1,kind:'commentary',phase:'commentary',text:initialText,completed:true});
    if(timing){node.turnClocks={[turnId]:{hostStartedAtMs:validMs(timing.observedAtMs)?timing.observedAtMs:Date.now(),...(validMs(timing.startedAtMs)?{nativeStartedAtMs:timing.startedAtMs}:{})}};updateNodeTiming(node);}
    this.save(node);
    return true;
  }
  turnTiming(id:string,turnId:string,terminal:boolean,timing:TurnTimingEvidence){
    const node=this.load(id),clock=node?.turnClocks?.[turnId];
    if(!node||node.state!=='working'||node.turnIds.at(-1)!==turnId||!clock||clock.hostEndedAtMs!==undefined)return;
    if(validMs(timing.startedAtMs))clock.nativeStartedAtMs=timing.startedAtMs;
    if(terminal){clock.hostEndedAtMs=validMs(timing.observedAtMs)?timing.observedAtMs:Date.now();if(validMs(timing.endedAtMs))clock.nativeEndedAtMs=timing.endedAtMs;if(validMs(timing.durationMs))clock.nativeDurationMs=timing.durationMs;}
    updateNodeTiming(node);node.revision++;this.save(node);
  }
  native(id:string,event:NativeProcessEvent){
    const node=this.load(id);
    if(!node||node.threadId!==event.threadId||!node.turnIds.includes(event.turnId)||!Object.hasOwn(nativeLabels,event.category))return;
    const key='native:'+JSON.stringify([event.threadId,event.turnId,event.itemId]);
    const prior=node.items.find(item=>item.id===key);
    if(node.completedItemIds.includes(key)||node.state==='worked'&&(!prior||!event.completed))return;
    if(!['running','completed','failed','declined','interrupted','unknown'].includes(event.status))return;
    const item:Extract<ProcessItem,{kind:'tool'}>=prior?.kind==='tool'?prior:{id:key,seq:node.items.length+1,revision:0,kind:'tool',label:nativeLabels[event.category],status:'running'};
    item.category=event.category;item.label=publicActivityName(event.label)??nativeLabels[event.category];item.threadId=event.threadId;item.turnId=event.turnId;item.itemId=event.itemId;
    item.status=event.status;item.invocationCount=1;
    if(event.toolName)item.toolName=event.toolName;
    if(event.content)item.content={input:event.content.input.state==='not-recorded'&&item.content?item.content.input:event.content.input,output:event.content.output};
    if(event.category==='fileChange'&&Number.isSafeInteger(event.fileCount)&&event.fileCount!>=0)item.fileCount=event.fileCount;
    const clocks=node.itemClocks??={},observed=validMs(event.observedAtMs)?event.observedAtMs:Date.now();
    if(!event.completed&&!clocks[key])clocks[key]={hostStartedAtMs:observed,...(validMs(event.startedAtMs)?{nativeStartedAtMs:event.startedAtMs}:{})};
    const clock=clocks[key];
    if(clock){if(event.completed){clock.hostEndedAtMs=observed;if(validMs(event.startedAtMs))clock.nativeStartedAtMs=event.startedAtMs;if(validMs(event.endedAtMs))clock.nativeEndedAtMs=event.endedAtMs;if(validMs(event.durationMs))clock.nativeDurationMs=event.durationMs;}Object.assign(item,clockTiming(clock));}
    if(event.completed)node.completedItemIds.push(key);
    item.revision++;if(!prior)node.items.push(item);node.revision++;this.save(node);
  }
  uncertain(id:string,turnId:string){
    const node=this.load(id);
    if(!node||node.state!=='working'||!node.turnIds.includes(turnId)||node.uncertainTurnIds?.includes(turnId))return;
    (node.uncertainTurnIds??=[]).push(turnId);node.revision++;this.save(node);
  }
  agent(id: string, event: { turnId: string; itemId: string; phase?: string | null; text?: string; delta?: string; completed: boolean; snapshot?:boolean; order?:string[] }) {
    const node = this.load(id);
    if (!node || node.state !== 'working' || node.sourceKind !== 'user' || !node.turnIds.includes(event.turnId)) return;
    const key = event.turnId + ':' + event.itemId;
    if (node.completedItemIds.includes(key)&&!event.snapshot) return;
    const prior = node.items.find(item => item.id === key);
    const phase=event.phase!==undefined?event.phase:node.itemPhases[key]??null;
    const fenced=node.uncertainTurnIds?.includes(event.turnId)&&!event.completed&&!event.snapshot;
    const text=fenced?(prior?.kind==='commentary'?prior.text:''):event.text!==undefined?event.text:(prior?.kind==='commentary'?prior.text:'')+(event.delta??'');
    let changed=false;
    node.itemPhases[key]=phase;
    if(prior?.kind==='commentary'){
      if(prior.text!==text||prior.phase!==phase||prior.completed!==event.completed){
        prior.text=text;prior.phase=phase;prior.completed=event.completed;prior.role='assistant';prior.revision++;changed=true;
      }
    }else{
      node.items.push({id:key,seq:node.items.length+1,revision:1,kind:'commentary',role:'assistant',text,phase,turnId:event.turnId,itemId:event.itemId,completed:event.completed});changed=true;
    }
    if(event.completed&&!node.completedItemIds.includes(key))node.completedItemIds.push(key);
    if(event.order){
      const ranks=new Map(event.order.map((itemId,index)=>[itemId,index]));
      const slots=node.items.flatMap((item,index)=>'turnId' in item&&item.turnId===event.turnId&&'itemId' in item&&item.itemId&&ranks.has(item.itemId)?[index]:[]);
      const sorted=slots.map(index=>node.items[index]!).sort((a,b)=>ranks.get(('itemId' in a?a.itemId:undefined)!)!-ranks.get(('itemId' in b?b.itemId:undefined)!)!);
      slots.forEach((slot,index)=>{const item=sorted[index]!;if(node.items[slot]!==item){item.seq=slot+1;item.revision++;node.items[slot]=item;changed=true;}});
    }
    const lastFinal=node.items.filter((item):item is Extract<ProcessItem,{kind:'commentary'}>=>item.kind==='commentary'&&item.phase==='final_answer'&&item.completed===true).at(-1);
    if(lastFinal)node.finalCandidate={id:lastFinal.id,text:lastFinal.text};
    if(changed){node.revision++;this.save(node);}
  }
  tool(id: string, activity: { id: string; label: string; phase: 'start' | 'end'; status?: 'completed' | 'failed' | 'blocked'; turnId?:string; activity?:PublicActivity;toolName?:string;content?:ToolContent }) {
    if (!(PROGRESS_LABELS as readonly string[]).includes(activity.label)) return;
    const node = this.load(id); if (!node || node.state !== 'working') return;
    const prior = node.items.find(item => item.id === activity.id);
    const status = activity.phase === 'start' ? 'running' : activity.status ?? 'blocked';
    if (prior?.kind === 'tool') {
      if (prior.status !== 'running' || prior.status === status) return;
      prior.label = activity.label; prior.status = status; if(activity.activity)prior.activity=activity.activity; prior.revision++;
      if(activity.content)prior.content=activity.content;
      if(activity.toolName)prior.toolName=activity.toolName;
    } else node.items.push({ id: activity.id, kind: 'tool', seq: node.items.length + 1, revision: 1, label: activity.label, status,...(activity.activity?{activity:activity.activity}:{}),...(activity.content?{content:activity.content}:{}),...(activity.toolName?{toolName:activity.toolName}:{}),category:'host',turnId:activity.turnId,invocationCount:1 });
    node.revision++; this.save(node);
  }
  worker(id: string, fact: Omit<Extract<ProcessItem, {kind:'worker'}>, 'id' | 'seq' | 'revision' | 'kind'>) {
    fact = {taskId:fact.taskId,version:fact.version,taskRevision:fact.taskRevision,runId:fact.runId,runRevision:fact.runRevision,runStatus:fact.runStatus,resultState:fact.resultState,epoch:fact.epoch,state:fact.state,controlState:fact.controlState,outcome:fact.outcome,phase:fact.phase,stopRequested:fact.stopRequested};
    const node = this.load(id); if (!node) return;
    const prior = node.items.find(item => item.kind === 'worker' && item.taskId === fact.taskId);
    // Legacy records are frozen. New observations use explicit event identities.
    if(prior)return;
    if(node.state!=='working')return;
    node.items.push({ ...fact,id:'worker:'+fact.taskId,kind:'worker',seq:node.items.length+1,revision:1 });
    node.revision++; this.save(node);
  }
  discardNativeFinal(id:string){
    const node=this.load(id);if(!node||node.state!=='working')return;
    const items=node.items.filter(item=>item.kind!=='commentary'||item.phase!=='final_answer');
    if(items.length===node.items.length&&!node.final&&!node.finalCandidate)return;
    node.items=items;delete node.final;delete node.finalCandidate;
    node.revision++;this.save(node);
  }
  finish(id: string, status: ProcessNode['status'], endEventId?: string,publicText?:string) {
    const node = this.load(id); if (!node || node.state === 'worked') return;
    if (!endEventId) {
      node.status = 'unknown';
      if(node.startedAtMs!==undefined){node.timingState='unknown';delete node.endedAtMs;delete node.durationMs;}
      for(const item of node.items)if(item.kind==='tool'&&item.status==='running'&&item.label==='创建任务'){item.label='创建结果待核对';item.status='blocked';item.revision++;}
      node.revision++; this.save(node); return;
    }
    node.state = 'worked'; node.status = status; node.endEventId = endEventId;
    if(node.sourceKind!=='user'&&publicText?.trim())node.final={id:node.messageId,text:publicText};
    if(node.startedAtMs!==undefined&&node.timingState!=='terminal')node.timingState='unknown';
    for (const item of node.items) if (item.kind === 'tool' && item.status === 'running') { if(item.label==='创建任务')item.label='创建结果待核对'; item.status = item.category&&item.category!=='host'?'unknown':'blocked'; item.revision++; }
    if(node.finalCandidate&&status!=='unknown') node.final = node.finalCandidate;
    delete node.finalCandidate; node.revision++; this.save(node);
  }
  reconcileUnknown(threadId:string,engineClosed=false){
    for(const node of this.list(threadId))if(node.state==='working'){
      if(node.status!=='unknown')this.finish(node.id,'unknown');
      // Startup has already confirmed closure of every original engine lease.
      // That ends ownership, but does not confirm the lost model result.
      if(engineClosed)this.finish(node.id,'unknown','host:restart:engine_closed');
    }
  }
  list(threadId: string): ProcessNode[] {
    return this.hydrate(this.db.prepare('SELECT value FROM meta WHERE key LIKE ?').all(prefix + '%').map(row => JSON.parse(String(row.value)) as Stored)
      .filter(node => node.threadId === threadId).sort((a,b) => a.seq-b.seq)
      .map(({finalCandidate: _candidate, completedItemIds: _ids, itemPhases: _phases,uncertainTurnIds:_uncertain,turnClocks:_clocks,itemClocks:_itemClocks, ...node}) => node));
  }
}
