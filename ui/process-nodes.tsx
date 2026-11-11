import {Send,CornerDownRight,Clock3,LoaderCircle,RotateCcw,MessagesSquare,MessageCircleQuestion,ShieldQuestion,Activity,Inbox,Check,CircleDashed,CircleX,OctagonAlert,CircleStop,Pause,RefreshCw,CheckCheck} from 'lucide-react';
import type {TaskSemanticIcon} from '../src/task-status';
import type {TaskMessageSource} from '../src/conversation-projection';
const semanticIcons={Send,CornerDownRight,Clock3,LoaderCircle,RotateCcw,MessagesSquare,MessageCircleQuestion,ShieldQuestion,Activity,Inbox,Check,CircleDashed,CircleX,OctagonAlert,CircleStop,Pause,RefreshCw,CheckCheck};
export function SemanticTaskIcon({icon}:{icon:TaskSemanticIcon}){
 const Icon=semanticIcons[icon],spin=icon==='LoaderCircle'?' animate-spin motion-reduce:animate-none':'';
 return <Icon aria-hidden="true" className={'size-3.5 shrink-0'+spin} strokeWidth={2}/>;
}
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInterval } from '@mantine/hooks';
import type { ProcessNode, ProcessItem } from '../src/main-process';
import type { WebState,WebProcessNode } from '../src/web-contract';
import { compactProcessAction, confirmedTerminal, fixedDuration, formatDuration, projectProcessItems, snapshotDuration, toolActivityText, type ProcessObservation } from './process-presentation';
import './process-nodes.css';
import './vendor/assistant-ui/run-activity.css';
import { RunActivity, type RunActivityEntry } from './vendor/assistant-ui/run-activity';
import { TaskCard } from './vendor/task-status/task-card';
import './vendor/task-status/components.css';

export function InactiveInteractionNotes({items=[]}:{items?:WebState['inactiveInteractions']}) {
  return <>{items.map(item=><p key={item.id} className="message-state" style={{display:'block'}}>{item.code==='interaction_user_cancelled'?'用户已取消本次请求。':item.code==='capability_approval_timeout'?'等待用户确认已超时。':item.kind==='authorization'?'原授权请求已失效，旧决定不能恢复此回调。':'原提问回调已失效，旧卡片不能继续提交。'}可在原事项对话核对当前状态。</p>)}</>;
}
export const ProcessDetailsContext=createContext<(id:string,signal:AbortSignal)=>Promise<WebProcessNode>>(async()=>{throw Error('history_protocol_required');});
export const ProcessObservationContext = createContext<ProcessObservation>({connected:false});

function ProcessDuration({node,observation}:{node:ProcessNode;observation:ProcessObservation}) {
  const current = snapshotDuration(node,observation), fixed = fixedDuration(node);
  const key = JSON.stringify([node.threadId,node.id,observation.readEpoch]);
  const [now,setNow] = useState(()=>performance.now());
  const {start,stop} = useInterval(()=>setNow(performance.now()),1000);
  const last = useRef<{key:string;evidence?:string;anchor?:number;duration?:number}>({key});
  const next = last.current.key === key ? {...last.current} : {key};
  const evidence = JSON.stringify([observation.observedAtMs,node.startedAtMs,node.timingSource]);
  if (current === undefined || fixed !== undefined) next.anchor = undefined;
  else if (next.evidence !== evidence) {
    next.evidence = evidence;
    next.anchor = performance.now();
  }
  // Keep the evidence on loss of eligibility: reconnect needs a new snapshot.
  const anchor = next.anchor;
  const running = current !== undefined && fixed === undefined && anchor !== undefined;
  const duration = fixed ?? (running ? current + Math.max(0,now-anchor) : next.duration);
  next.duration = duration;
  useLayoutEffect(()=>{last.current = next;});
  useEffect(()=>{
    if (running) start();
    else stop();
    return stop;
  },[key,running,start,stop]);
  const stale = fixed === undefined && !running;
  if(duration===undefined)return <span> · 耗时未提供</span>;
  return <span className="process-duration" aria-label={'主 AI 本次处理区间耗时 '+formatDuration(duration)+(stale?'，上次快照，耗时待核实':'')} title={node.timingSource==='native'?'原生时间证据':node.timingSource==='hostObserved'?'宿主接收时刻的观测区间':'没有完整时间证据'}>
    {' · '}{formatDuration(duration)}{stale&&<span> · 上次快照，耗时待核实</span>}
  </span>;
}
// Final answers stay in the existing message slot, outside the original disclosure.
export type ProcessParts={entries:RunActivityEntry[]};
export function ProcessMessageContent({node,renderText,activityText,children,parts,taskSources,taskSourceUnresolved,titledEvents}:{taskSources?:TaskMessageSource[];taskSourceUnresolved?:true;titledEvents?:ReadonlySet<string>;node?:WebProcessNode;renderText:(text:string)=>ReactNode;activityText?:string;children:ReactNode;parts?:ProcessParts}) {
  const observation=useContext(ProcessObservationContext);
  const workers=useMemo(()=>projectProcessItems(node?.items??[]).items.filter((item):item is Extract<ProcessItem,{kind:'worker'}>=>item.kind==='worker'),[node?.items]);
  return <>
    {node&&<ProcessNodeView key={JSON.stringify([node.threadId,node.id])} node={node} renderText={renderText} activityText={activityText} observation={observation} parts={parts} titledEvents={titledEvents} name={node.sourceKind==='worker'?'处理过程':!taskSourceUnresolved&&taskSources?.length===1?taskSources[0].title:undefined}/>}
    {taskSourceUnresolved&&<p className="process-record-note">部分任务来源尚未核实。</p>}
    {children}
    {!!workers.length&&<LegacyWorkerNotes items={workers}/>}
  </>;
}
function LegacyWorkerNotes({items}:{items:Extract<ProcessItem,{kind:'worker'}>[]}){
 return <div className="process-workers" aria-label="旧后台工作记录">{items.map(item=><p key={item.id} className="process-record-note">旧后台工作记录（当时的事件内容未保留）</p>)}</div>;
}
export function WorkerEventCard({item}:{item:Extract<ProcessItem,{kind:'workerEvent'}>}){
  const card=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>()=>{
    const element=card.current;
    if(element?.isConnected&&element.contains(document.activeElement))element.closest<HTMLElement>('[data-conversation-message]')?.focus({preventScroll:true});
  },[]);
  const event=item.event;if(!event)return <p className="process-record-note">Worker 事件内容未能读取。</p>;
  const label=event.eventKind==='delegated'?'当时：已交办':event.eventKind==='reply_received'?'当时：收到回复':'当时：启动失败';
  return <TaskCard ref={card} className="homer-task-status worker-event-card" data-worker-event={item.eventKey}
    label={event.title} meta={label} title={event.title+' · '+label}
    state={event.eventKind==='start_failed'?'failed':'waiting'} statusLabel={label} statusIcon={<SemanticTaskIcon icon={event.eventKind==='delegated'?'Send':event.eventKind==='reply_received'?'Inbox':'CircleX'}/>}>
    <p className="text-xs leading-relaxed">{event.body}</p>
  </TaskCard>;
}
export function ProcessNodeView({node,renderText,activityText,observation={connected:false},parts,name,titledEvents}:{name?:string;titledEvents?:ReadonlySet<string>;node:ProcessNode;renderText:(text:string)=>ReactNode;activityText?:string;observation?:ProcessObservation;parts?:ProcessParts}) {
  const [open,setOpen]=useState(false);
  const terminal=confirmedTerminal(node);
  const hide=terminal&&node.status==='completed'&&!open;
  const [hidden,setHidden]=useState(hide);
  const load=useContext(ProcessDetailsContext),[error,setError]=useState('');
  // Hand off keyboard focus before the completed control leaves the DOM.
  useLayoutEffect(()=>{
    if(hide===hidden)return;
    if(hide){
      const message=document.activeElement?.closest('.process-node')?.closest<HTMLElement>('[data-conversation-message]');
      if(message?.id==='message-'+node.messageId){
        const target=message.querySelector(':scope > :not(.process-node, .message-timestamp)')?message:message.closest<HTMLElement>('.thread-viewport');
        target?.focus({preventScroll:true});
      }
    }
    setHidden(hide);
  },[hide,hidden,node.messageId]);
  useEffect(()=>{
    if(node.details!=='unloaded')return;
    if(!open)return;
    const controller=new AbortController();setError('');
    void load(node.id,controller.signal).catch(()=>{if(!controller.signal.aborted)setError('过程详情未能读取，请收起后重新展开。');});
    return()=>controller.abort();
  },[node.id,node.threadId,node.revision,node.details,open,load]);
  const {items}=useMemo(()=>projectProcessItems(node.items),[node.items]);
  // Named delegations and received previews belong in existing process details.
  const detailEvent=(item:Extract<ProcessItem,{kind:'workerEvent'}>)=>titledEvents?.has(item.eventKey)||item.event?.eventKind==='reply_received'&&item.event.bodySource==='reply';
  let activity:ReactNode;
  if(!hide||!hidden){
    const stale=!observation.connected||!observation.serviceRunning||node.status==='unknown';
    const label=(name||(node.sourceKind==='user'?'当前对话':'当前事项'))+' · '+(terminal?compactProcessAction(node,observation):activityText||compactProcessAction(node,observation));
    const entries=parts?parts.entries.map(entry=>({...entry,label:''})):items.filter(item=>item.kind!=='worker'&&item.kind!=='workerEvent').flatMap<RunActivityEntry>(item=>{
      if(item.kind==='commentary')return item.text&&item.phase!=='final_answer'?[{id:item.id,kind:'commentary',label:'',content:<div className="process-item">{renderText(item.text)}</div>}]:[];
      if(item.content)return []; // New content belongs to the message parts renderer.
      const text=toolActivityText(item,stale); // Legacy summaries have no call body.
      return [{id:item.id,kind:'tool',label:'',content:<p data-tool-id={item.id} data-tool-status={item.status}>{text}</p>}];
    });
    for(const item of items)if(item.kind==='workerEvent'&&detailEvent(item))entries.push({id:item.id,kind:'commentary',label:'',content:<WorkerEventCard item={item}/>});
    if(node.details==='unloaded')entries.push({id:node.id+':loading',kind:'commentary',label:'',content:<p role="status">{error||'过程详情尚未加载…'}</p>});
    activity=<RunActivity className="process-node" status={node.status==='unknown'?'incomplete':node.status==='failed'?'error':node.status==='interrupted'?'cancelled':terminal?'complete':'running'}
      statusLabel={label} durationLabel={<ProcessDuration node={node} observation={observation}/>}
      entries={entries} open={open} onOpenChange={setOpen}
    />;
  }
  return <>{activity}{items.filter((item):item is Extract<ProcessItem,{kind:'workerEvent'}>=>item.kind==='workerEvent'&&!detailEvent(item)).map(item=><WorkerEventCard key={item.id} item={item}/>)}</>;
}
