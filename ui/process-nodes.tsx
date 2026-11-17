import {Send,CornerDownRight,Clock3,LoaderCircle,RotateCcw,MessagesSquare,MessageCircleQuestion,ShieldQuestion,Activity,Inbox,Check,CircleDashed,CircleX,OctagonAlert,CircleStop,Pause,RefreshCw,CheckCheck} from 'lucide-react';
import type {TaskSemanticIcon} from '../src/task-status';
const semanticIcons={Send,CornerDownRight,Clock3,LoaderCircle,RotateCcw,MessagesSquare,MessageCircleQuestion,ShieldQuestion,Activity,Inbox,Check,CircleDashed,CircleX,OctagonAlert,CircleStop,Pause,RefreshCw,CheckCheck};
export function SemanticTaskIcon({icon}:{icon:TaskSemanticIcon}){
 const Icon=semanticIcons[icon],spin=icon==='LoaderCircle'?' animate-spin motion-reduce:animate-none':'';
 return <Icon aria-hidden="true" className={'size-3.5 shrink-0'+spin} strokeWidth={2}/>;
}
import {useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import type { ProcessNode, ProcessItem } from '../src/main-process';
import type { WebState,WebProcessNode } from '../src/web-contract';
import {confirmedTerminal,projectProcessItems} from './process-presentation';
import './process-nodes.css';
import './vendor/assistant-ui/run-activity.css';
import {CollapsibleRoot as Collapsible,CollapsibleContent,CollapsibleTrigger} from './vendor/assistant-ui/collapsible-root';
import { TaskCard } from './vendor/task-status/task-card';
import './vendor/task-status/components.css';

export function InactiveInteractionNotes({items=[]}:{items?:WebState['inactiveInteractions']}) {
  return <>{items.map(item=><p key={item.id} className="message-state" style={{display:'block'}}>{item.code==='interaction_user_cancelled'?'用户已取消本次请求。':item.code==='capability_approval_timeout'?'等待用户确认已超时。':item.kind==='authorization'?'原授权请求已失效，旧决定不能恢复此回调。':'原提问回调已失效，旧卡片不能继续提交。'}可在原事项对话核对当前状态。</p>)}</>;
}
export function ProcessMessageContent({node,children,taskSourceUnresolved,titledEvents}:{taskSourceUnresolved?:true;titledEvents?:ReadonlySet<string>;node?:WebProcessNode;children:ReactNode}) {
  const workers=useMemo(()=>projectProcessItems(node?.items??[]).items.filter((item):item is Extract<ProcessItem,{kind:'worker'}>=>item.kind==='worker'),[node?.items]);
  return <>
    {node&&<ProcessNodeView key={JSON.stringify([node.threadId,node.id])} node={node} titledEvents={titledEvents}/>}
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
export function ProcessNodeView({node,titledEvents}:{node:ProcessNode;titledEvents?:ReadonlySet<string>}) {
  const [open,setOpen]=useState(false);
  const hide=confirmedTerminal(node)&&node.status==='completed'&&!open;
  const [hidden,setHidden]=useState(hide);
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
  const {items}=useMemo(()=>projectProcessItems(node.items),[node.items]);
  const events=items.filter((item):item is Extract<ProcessItem,{kind:'workerEvent'}>=>item.kind==='workerEvent');
  const detailEvent=(item:Extract<ProcessItem,{kind:'workerEvent'}>)=>titledEvents?.has(item.eventKey)||item.event?.eventKind==='reply_received'&&item.event.bodySource==='reply';
  const details=events.filter(detailEvent);
  return <>{(!hide||!hidden)&&details.length>0&&<Collapsible className="process-node" open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger>协作记录</CollapsibleTrigger>
    <CollapsibleContent>{open&&details.map(item=><WorkerEventCard key={item.id} item={item}/>)}</CollapsibleContent>
  </Collapsible>}{events.filter(item=>!detailEvent(item)).map(item=><WorkerEventCard key={item.id} item={item}/>)}</>;
}
