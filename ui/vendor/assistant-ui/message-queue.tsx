// MIT, AgentbaseAI Inc. Pinned source and necessary service mapping: see README.md.
import type {ComponentProps} from 'react';
import type {MainDispatchInput} from '../../../src/recursive-main-inputs';
import {BotIcon,UserRoundIcon,XIcon} from 'lucide-react';
import {useSortable} from '@dnd-kit/react/sortable';
import './message-queue.css';
export interface QueueMessage{id:string;text:string;origin:'user'|'worker';state:MainDispatchInput['state'];position?:number;cancellable?:boolean;movable?:boolean;hidden?:boolean}
function QueueRow({message,index,group,dragDisabled,cancelDisabled,onCancel}:{message:QueueMessage;index:number;group:string;dragDisabled:boolean;cancelDisabled?:boolean;onCancel?:(id:string)=>void}){
 const {ref,handleRef,isDragging}=useSortable({id:message.id,index,group,type:group,accept:group,disabled:dragDisabled});
 const position=message.position??index+1;
 const source=message.origin==='worker'?'Worker':'用户';
 const SourceIcon=message.origin==='worker'?BotIcon:UserRoundIcon;
 return <li ref={dragDisabled?undefined:ref} data-queue-message={message.id} data-queue-state={message.state} data-dragging={isDragging||undefined} className="aui-queue-field">
  {message.movable&&!dragDisabled?<button ref={handleRef} type="button" className="aui-queue-number queue-drag-handle" aria-label={`${source}消息，第 ${position} 条，拖动调整顺序`} title={`${source}消息 · 拖动调整顺序`} aria-description="空格或回车拿起，上下方向键移动，空格、回车或 Tab 确认，Escape 取消。"><SourceIcon size={16} aria-hidden="true"/></button>:<span className="aui-queue-number queue-source-icon" role="img" aria-label={`${source}消息，第 ${position} 条`} title={`${source}消息`}><SourceIcon size={16} aria-hidden="true"/></span>}
  <span className="aui-queue-text" title={message.text}>{message.text}</span>
  {onCancel&&message.state==='queued'&&message.cancellable!==false&&<button type="button" className="aui-queue-remove" aria-label={`取消发送第 ${position} 条待发送消息`} disabled={cancelDisabled} onClick={()=>onCancel(message.id)}><XIcon size={14} aria-hidden="true"/></button>}
 </li>;
}
export function MessageQueue({messages,onCancel,cancelDisabled,dragDisabled=true,className,...props}:Omit<ComponentProps<'div'>,'children'|'onCancel'>&{messages:readonly QueueMessage[];onCancel?:(id:string)=>void;cancelDisabled?:boolean;dragDisabled?:boolean}){
 let start=0;
 return <div data-slot="message-queue" className={['aui-message-queue',className].filter(Boolean).join(' ')} {...props}>
  <ul className="aui-queue-list">{messages.map((message,index)=>{
   const movable=message.state==='queued'&&message.movable;
   if(!movable||messages[index-1]?.state!=='queued'||!messages[index-1]?.movable)start=index;
   const alone=start===index&&(messages[index+1]?.state!=='queued'||!messages[index+1]?.movable);
   return message.hidden?null:<QueueRow key={message.id} message={{...message,position:message.position??index+1}} index={index-start} group={messages[start].id} dragDisabled={dragDisabled||!movable||alone} cancelDisabled={cancelDisabled} onCancel={onCancel}/>;
  })}</ul>
 </div>;
}
