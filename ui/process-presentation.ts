import type { ProcessItem, ProcessNode, ProcessTiming } from '../src/main-process.js';
import type { MainActivity } from '../src/web-contract.js';
import {activityActions,activityOutcomes} from '../src/activity-facts.js';
import {nativeLabels} from '../src/main-process.js';
import {activitySummaryText} from '../src/message-quote.js';

export type ToolItem = Extract<ProcessItem, { kind: 'tool' }>;
export const toolStatusText: Record<ToolItem['status'], string> = {
  running: '调用中', completed: '调用已返回', failed: '调用失败', declined: '调用被拒绝',
  interrupted: '调用已中断', unknown: '结束状态待核实', blocked: '调用受阻，待核实',
};
export function toolActivityText(item:Pick<ToolItem,'label'|'status'|'activity'|'category'|'fileCount'>,stale=false){
  const fact=item.activity;
  const action=fact?activityActions[fact.action]+(fact.objectName?'：'+fact.objectName:''):item.label||'工具名称未保留';
  let result=toolStatusText[item.status]??'结束状态待核实';
  if(item.status==='running'&&stale)result='上次调用中，结束未确认';
  else if(item.status==='completed'&&fact)result=['record_read','attachment_read'].includes(fact.outcome)?'已读取':activityOutcomes[fact.outcome];
  return action+' · '+result+(item.category==='fileChange'&&item.fileCount!==undefined?' · 本次涉及 '+item.fileCount+' 个文件':'');
}

// Latest revision at the first observed position. No timestamp/text heuristics.
export function projectProcessItems(items: readonly ProcessItem[]) {
  const unique = new Map<string, ProcessItem>();
  for (const item of items) {
    const prior = unique.get(item.id);
    if (!prior || item.revision > prior.revision) unique.set(item.id, item);
  }
  return { items: [...unique.values()] };
}

export type ProcessObservation = {
  connected: boolean; threadId?: string; readEpoch?: string; serviceRunning?: boolean; observedAtMs?: number;
  mainActivity?: MainActivity | null; generationTurnId?: string;
};
export const validMs = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function fixedDuration(timing: ProcessTiming): number | undefined {
  if (timing.timingState !== 'terminal' || !timing.timingSource) return;
  if (validMs(timing.durationMs)) return timing.durationMs;
  if (validMs(timing.startedAtMs) && validMs(timing.endedAtMs) && timing.endedAtMs >= timing.startedAtMs) return timing.endedAtMs - timing.startedAtMs;
}
export function snapshotDuration(node: ProcessNode, observation: ProcessObservation): number | undefined {
  const activity = observation.mainActivity, turn = node.turnIds.at(-1);
  if (!observation.connected || !observation.serviceRunning || observation.threadId !== node.threadId || node.state !== 'working' || node.status !== 'running' || node.timingState !== 'running' || !node.timingSource || !activity || activity.processId !== node.id || activity.source !== (node.sourceKind === 'user' ? 'user' : 'internal') || !turn || activity.turnId !== turn || !['native', 'compacting'].includes(activity.stage) || (activity.source === 'user' && observation.generationTurnId !== turn)) return;
  if (validMs(node.startedAtMs) && validMs(observation.observedAtMs) && observation.observedAtMs >= node.startedAtMs) return observation.observedAtMs - node.startedAtMs;
}
export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? hours + 'h ' : ''}${hours || minutes ? minutes + 'm ' : ''}${seconds % 60}s`;
}
export function confirmedTerminal(node: ProcessNode) {
  return node.state === 'worked' && (node.status === 'completed' || node.status === 'failed' || node.status === 'interrupted');
}

// History scope fences readEpoch; historical items cannot establish live work.
export function compactProcessAction(node:ProcessNode,observation:ProcessObservation):string {
  if(confirmedTerminal(node))return node.status==='failed'?'处理失败':node.status==='interrupted'?'已中断':'已结束';
  const activity=observation.mainActivity,turn=node.turnIds.at(-1);
  if(!observation.connected||!observation.serviceRunning||observation.threadId!==node.threadId||node.status!=='running'||!turn||!activity||activity.processId!==node.id||activity.turnId!==turn||activity.source!==(node.sourceKind==='user'?'user':'internal')||(activity.source==='user'&&observation.generationTurnId!==turn)||activity.stage!=='native')return '状态待确认';
  const items=projectProcessItems(node.items).items.filter(item=>'turnId' in item&&item.turnId===turn).sort((a,b)=>b.seq-a.seq);
  const call=items.find((item):item is ToolItem=>item.kind==='tool'&&item.status==='running'&&(item.threadId===node.threadId||item.category==='host'&&!item.threadId));
  if(call)return compactToolAction(call);
  const commentary=items.find(item=>item.kind==='commentary'&&item.phase==='commentary'&&item.itemId&&item.text.trim());
  return activity.summary||(commentary?.kind==='commentary'?activitySummaryText(commentary.text):'')||'处理中';
}
function compactToolAction(item:ToolItem):string {
  const name=item.toolName?.split(/[.:]/).at(-1);
  if(item.category==='command'||name==='exec_command'){
    const input=item.content?.input;
    if(input?.state!=='recorded'||input.redacted||!input.value||typeof input.value!=='object'||Array.isArray(input.value))return '运行命令';
    const command=input.value.command??input.value.cmd;
    // Deliberately not a shell parser. Dynamic/structured commands fall back.
    if(typeof command!=='string'||command.length>2048||/[\n\r;&|`$<>\\(){}]/.test(command))return '运行命令';
    const words=command.trim().split(/\s+/),executable=words[0]?.split('/').at(-1)??'';
    const allowed:Record<string,readonly string[]>={pnpm:['test','build','exec','run','typecheck'],npm:['test','run','exec'],yarn:['test','build','run'],git:['status','diff','show','log','rev-parse'],node:[],python:[],python3:[],rg:[],tsc:[]};
    if(!Object.hasOwn(allowed,executable)||!/^\/?[\w./-]+$/.test(words[0]??''))return '运行命令';
    const sub=allowed[executable]!.includes(words[1]??'')?' '+words[1]:'';
    return '运行 '+executable+sub;
  }
  if(item.category&&item.category!=='host'&&item.category!=='externalTool')return nativeLabels[item.category];
  // functions.exec is arbitrary code, not an already-started nested call.
  if(name==='exec'||!name||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name))return '调用工具';
  return '调用 '+name;
}
