import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {DragDropProvider,type DragStartEvent,type DragEndEvent} from '@dnd-kit/react';
import {isSortable} from '@dnd-kit/react/sortable';
import {RestrictToVerticalAxis} from '@dnd-kit/abstract/modifiers';
import type {DispatchQueuePage,WebState} from '../src/web-contract';
import {MessageQueue} from './vendor/assistant-ui/message-queue';
import {queuePost,queueMoveBefore,type QueueOperations} from './queue-operations';
import {isVisibleConversationMessage} from './chat-date';
import './homer-message-queue.css';

type QueueItem=DispatchQueuePage<'all'>['items'][number];
const textOf=(item:QueueItem)=>item.origin==='user'?item.input.text||item.user?.media?.map(asset=>asset.filename).join('、')||'引用消息':item.text;
const summaryOf=(item:QueueItem)=>[item.origin==='user'&&(!item.editable||item.state!=='queued')?item.statusText:undefined,textOf(item)].filter(Boolean).join(' · ');
function queueFocus(element:HTMLElement|null){
 return ()=>{if(element?.contains(document.activeElement))document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({preventScroll:true});};
}
export function HomerMessageQueue({state,connected,operations,editorBusy=false}:{state:WebState;connected:boolean;operations:QueueOperations;editorBusy?:boolean}){
 const [page,setPage]=useState<DispatchQueuePage<'all'>>(),[checking,setChecking]=useState(true),[cursor,setCursor]=useState<string>(),[refresh,setRefresh]=useState(0);
 const [loadedFor,setLoadedFor]=useState('');
 const [expanded,setExpanded]=useState(false),contentId=useId();
 const [dragging,setDragging]=useState(false),[dragReset,setDragReset]=useState(0);
 const restoreFocus=useRef<{id:string;threadId:string;epoch?:string;cursor?:string;scrollTop?:number}|undefined>(undefined);
 const dragSnapshot=useRef<{messageId:string;revision:number;threadId:string;readEpoch:string;orderVersion:string;queryKey:string;group:string;items:readonly QueueItem[]}|undefined>(undefined);
 const latest=useRef({state,page,queryKey:'',disabled:true});
 const supported=state.features?.queueSources===1,epoch=state.history?.readEpoch,version=state.queueDispatch?.orderVersion;
 const queryKey=JSON.stringify([state.threadId,epoch,version,cursor,refresh]);
 useEffect(()=>{const update=()=>{setCursor(undefined);setRefresh(n=>n+1);};window.addEventListener('homer-queue-updated',update);return()=>window.removeEventListener('homer-queue-updated',update);},[]);
 useEffect(()=>{setCursor(undefined);},[state.threadId,version,epoch]);
 useEffect(()=>{
  if(!connected||!supported||!epoch)return;
  const controller=new AbortController();setChecking(true);
  void queuePost<DispatchQueuePage<'all'>>('/api/history/queue',{view:'dispatch-v1',sources:'all',readEpoch:epoch,...(cursor?{cursor}:{})},controller.signal).then(value=>{
   if(controller.signal.aborted||latest.current.state.threadId!==value.threadId||latest.current.state.history?.readEpoch!==value.readEpoch||latest.current.queryKey!==queryKey)return;
   setPage(value);setLoadedFor(queryKey);setChecking(false);
  }).catch(error=>{if(controller.signal.aborted)return;if(error.message==='queue_cursor_expired'&&cursor){setCursor(undefined);return;}});
  return()=>controller.abort();
 },[connected,supported,state.threadId,epoch,version,cursor,refresh]);
 const legacy=(state.queue??[]).flatMap((item,index)=>item.user?[{...item,origin:'user',user:item.user,movable:false,position:index+1,statusText:item.statusText??'状态待核对'} as QueueItem]:[]);
 const items=supported?page?.items??[]:legacy;
 const verified=!supported||!!page&&loadedFor===queryKey&&page.readEpoch===epoch&&page.orderVersion===version;
 const disabled=!connected||!verified||(supported&&checking)||operations.locked||editorBusy;
 latest.current={state,page,queryKey,disabled};
 const dragScope=JSON.stringify([queryKey,disabled||!supported]);
 useLayoutEffect(()=>{dragSnapshot.current=undefined;setDragging(false);return()=>{dragSnapshot.current=undefined;};},[dragScope]);
 function dragStart(event:DragStartEvent){
  const source=event.operation.source,current=latest.current;
  if(current.disabled||!supported||!current.page||!epoch||!isSortable(source))return;
  const item=current.page.items.find(item=>item.messageId===source.id);
  if(!item||item.state!=='queued'||!item.movable||typeof source.initialGroup!=='string')return;
  dragSnapshot.current={messageId:item.messageId,revision:item.revision,threadId:state.threadId,readEpoch:epoch,orderVersion:current.page.orderVersion,queryKey:current.queryKey,group:source.initialGroup,items:current.page.items};
  restoreFocus.current={id:item.messageId,threadId:state.threadId,epoch,cursor,scrollTop:source.element?.closest<HTMLElement>('.aui-queue-list')?.scrollTop};setDragging(true);
 }
 function dragEnd(event:DragEndEvent){
  const snapshot=dragSnapshot.current;dragSnapshot.current=undefined;setDragging(false);setDragReset(n=>n+1);
  const {source,target}=event.operation,current=latest.current;
  if(!snapshot||event.canceled||!target||!isSortable(source)||current.disabled||current.state.features?.queueSources!==1||current.queryKey!==snapshot.queryKey||current.page?.items!==snapshot.items||current.state.threadId!==snapshot.threadId||current.state.history?.readEpoch!==snapshot.readEpoch||current.page.orderVersion!==snapshot.orderVersion||source.id!==snapshot.messageId||source.initialGroup!==snapshot.group||source.group!==snapshot.group)return;
  const item=current.page.items.find(item=>item.messageId===snapshot.messageId);
  if(!item||item.revision!==snapshot.revision)return;
  const beforeMessageId=queueMoveBefore(snapshot.items,snapshot.messageId,source.initialIndex,source.index);
  if(beforeMessageId===undefined)return;
  void operations.run('move',{messageId:snapshot.messageId,operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,threadId:snapshot.threadId,readEpoch:snapshot.readEpoch,expectedOrderVersion:snapshot.orderVersion,beforeMessageId});
 }
 async function cancel(id:string){
  const item=items.find(item=>item.messageId===id);
  if(disabled||dragging||!item||item.origin!=='user'||item.state!=='queued'||!item.editable)return;
  const result=await operations.run('cancel',{operationId:crypto.randomUUID(),expectedRevision:item.revision,threadId:state.threadId,readEpoch:epoch,requestId:item.input.requestId});
  if(result){restoreFocus.current={id,threadId:state.threadId,epoch,cursor};}
 }
 useEffect(()=>{
  const saved=restoreFocus.current;if(!saved||disabled||dragging||!expanded)return;
  restoreFocus.current=undefined;if(saved.threadId!==state.threadId||saved.epoch!==epoch)return;
  requestAnimationFrame(()=>{
   if(latest.current.disabled||latest.current.queryKey!==queryKey||latest.current.state.threadId!==saved.threadId||latest.current.state.history?.readEpoch!==saved.epoch)return;
   const list=document.querySelector<HTMLElement>('.homer-message-queue .aui-queue-list');if(list&&saved.cursor===cursor&&saved.scrollTop!==undefined)list.scrollTop=saved.scrollTop;
   const exact=saved.cursor===cursor?document.querySelector<HTMLElement>(`[data-queue-message="${CSS.escape(saved.id)}"] button:not(:disabled)`):null,first=document.querySelector<HTMLElement>('[data-slot="message-queue"] button:not(:disabled)'),button=exact?.getClientRects().length?exact:first?.getClientRects().length?first:document.querySelector<HTMLElement>('[contenteditable="true"]');button?.focus({preventScroll:true});
  });
 },[page,disabled,dragging,dragReset,state.threadId,epoch,cursor,expanded]);
 const displayedWorkers=new Set(state.messages.flatMap(message=>{
  const node=message.process;
  return isVisibleConversationMessage(message)&&message.role==='assistant'&&message.threadId===state.threadId&&node?.threadId===state.threadId&&node.sourceKind==='worker'&&node.turnIds.length>0?node.sourceMessageIds:[];
 }));
 const messages=items.map(item=>({id:item.messageId,origin:item.origin,state:item.state,position:item.position,text:summaryOf(item),movable:supported&&item.state==='queued'&&item.movable,cancellable:item.origin==='user'&&item.state==='queued'&&item.editable,hidden:verified&&item.origin==='worker'&&item.state==='processing'&&displayedWorkers.has(item.messageId)}));
 const visibleCount=messages.filter(message=>!message.hidden).length;
 if(!visibleCount&&!state.queueDispatch?.totalWaiting&&!cursor&&!page?.nextCursor)return null;
 return <section ref={queueFocus} className="homer-message-queue" aria-label="消息队列">
  <button className="queue-toggle" type="button" aria-expanded={expanded} aria-controls={contentId} disabled={dragging} onClick={()=>setExpanded(!expanded)}>
   <span className="queue-toggle-label"><ChevronRightIcon size={16} aria-hidden="true"/><span>消息队列 · 已加载 {visibleCount} 条</span></span>
  </button>
  <div id={contentId} hidden={!expanded}>
  <DragDropProvider key={JSON.stringify([dragScope,dragReset])} modifiers={[RestrictToVerticalAxis]} onDragStart={dragStart} onDragEnd={dragEnd}>
   <MessageQueue messages={messages} dragDisabled={disabled||!supported} cancelDisabled={disabled||dragging} onCancel={id=>void cancel(id)}/>
  </DragDropProvider>
   {supported&&(cursor||page?.nextCursor)&&<div className="queue-pages">{cursor&&<button type="button" disabled={disabled||dragging} onClick={()=>setCursor(undefined)}>返回待发送首页</button>}{page?.nextCursor&&<button type="button" disabled={disabled||dragging} onClick={()=>setCursor(page.nextCursor!)}>查看下一页</button>}</div>}
  </div>
 </section>;
}
