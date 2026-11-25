import {useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import type {HistoryPage,HistoryPageRequest} from '../src/web-history-pages';
import type {OverviewTask,TaskDetail} from '../src/task-overview';
import type {MessageQuote} from '../src/web-history';
import {taskName} from '../src/task-presentation';
import {connectionFetch} from './web-connection-client';
import {locateSourceQuote} from './message-source-selection';
import './task-conversation.css';

type Anchor={id?:string;offset:number;scrollTop?:number;bottom:boolean};
type ReadMode='refresh'|'before'|'around'|'latest';
const earlierThreshold=300, earlierReadLimit=3;
export type TaskConversationWindow={
 pages:HistoryPage[]; before:string|null; revision:number; details:boolean; detached?:boolean; task:OverviewTask;
 anchor?:Anchor; continueBefore?:boolean;
};
type Props={
 cache:TaskConversationWindow; threadId:string; readEpoch:string; revision:number; connected:boolean;
 onTask:(task:OverviewTask)=>void; onOriginal:(id:string,quote?:MessageQuote)=>void;
 render:(page:Pick<HistoryPage,'messages'|'artifacts'>,view:RefObject<HTMLDivElement|null>,locate:(id:string,quote?:MessageQuote)=>void,task:OverviewTask,refresh:()=>void,onScroll:()=>void,onRows:()=>void)=>ReactNode;
};

const messageRow=(view:HTMLElement,id:string)=>view.querySelector<HTMLElement>('[data-conversation-message="'+CSS.escape(id)+'"]');
function capture(view:HTMLElement):Anchor{
 const top=view.getBoundingClientRect().top;
 const row=Array.from(view.querySelectorAll<HTMLElement>('[data-conversation-message]')).find(element=>element.getBoundingClientRect().bottom>top);
 return {id:row?.dataset.conversationMessage,offset:row?row.getBoundingClientRect().top-top:view.scrollTop,scrollTop:view.scrollTop,bottom:view.scrollHeight-view.clientHeight-view.scrollTop<4};
}

export function TaskConversation({cache,threadId,readEpoch,revision,connected,onTask,onOriginal,render}:Props){
 const view=useRef<HTMLDivElement>(null), request=useRef<{controller:AbortController;mode:ReadMode}|null>(null), detailsRequest=useRef<AbortController|null>(null);
 const pendingAnchor=useRef<Anchor|null>(cache.anchor??{bottom:true,offset:0});
 const failedRead=useRef<{mode:ReadMode;target?:{id:string;quote?:MessageQuote}}|null>(null);
 const pendingTarget=useRef<{id:string;quote?:MessageQuote}|null>(null);
 const [frame,update]=useState(0),[reading,setReading]=useState<ReadMode|null>(null),[notice,setNotice]=useState(''),[detailNotice,setDetailNotice]=useState('');
 const busy=reading!==null;
 const [attempt,retry]=useState(0);
 const failedRevision=useRef<number|undefined>(undefined);
 const previousScrollTop=useRef(0),touchStartY=useRef<number|undefined>(undefined);
 const historyAction=useRef<HTMLButtonElement|null>(null), restoreActionFocus=useRef(false);
 const bindHistoryAction=useCallback((button:HTMLButtonElement|null)=>{
  if(!button&&historyAction.current===document.activeElement)restoreActionFocus.current=true;
  historyAction.current=button;
 },[]);
 useLayoutEffect(()=>{
  if(!restoreActionFocus.current)return;
  restoreActionFocus.current=false;
  if(document.activeElement===document.body)(historyAction.current??view.current)?.focus({preventScroll:true});
 });
 const latest=useRef({onOriginal,onTask,revision});latest.current={onOriginal,onTask,revision};
 const bump=()=>update(value=>value+1);
 const taskId=cache.task.id;
 const read=useCallback(async (query:HistoryPageRequest, signal:AbortSignal)=>{
  const response=await connectionFetch('/api/history/page',{method:'POST',headers:{'Content-Type':'application/json'},signal,
    body:JSON.stringify({readEpoch,request:{...query,taskId}})});
  const page=await response.json();
  if(!response.ok)throw Error(page.error);
  if(page.threadId!==threadId||page.scope?.taskId!==taskId||!page.scope?.range)throw Error('history_scope_changed');
  return page as HistoryPage;
 },[readEpoch,threadId,taskId]);
 const refreshTask=useCallback(()=>{
  if(!connected)return;
  detailsRequest.current?.abort();
  const controller=new AbortController();detailsRequest.current=controller;
  void connectionFetch('/api/tasks/'+encodeURIComponent(taskId)+'/summary',{signal:controller.signal}).then(async response=>{
   const result:TaskDetail=await response.json();
   if(controller.signal.aborted)return;
   if(!response.ok||result.overview?.id!==taskId)throw Error('task_overview_unavailable');
   cache.task=result.overview;latest.current.onTask(result.overview);setDetailNotice('');bump();
  }).catch(()=>{if(!controller.signal.aborted)setDetailNotice('事项资料暂未刷新，当前显示上次记录。');});
 },[cache,taskId,connected]);
 useEffect(()=>{refreshTask();return()=>detailsRequest.current?.abort();},[refreshTask,revision]);
 useLayoutEffect(()=>()=>{request.current?.controller.abort();detailsRequest.current?.abort();},[cache,readEpoch]);
 useLayoutEffect(()=>{if(!connected)cancelRead();},[connected]);
 function cancelRead(){
  if(!request.current)return;
  request.current.controller.abort();request.current=null;setReading(null);
 }
 function saveAnchor(){
  if(view.current)cache.anchor=capture(view.current);
 }
 function nearTop(){
  const container=view.current;
  return !!container&&container.clientHeight>0&&container.scrollTop<=earlierThreshold;
 }
 function readEarlier(){
  if(!cache.continueBefore&&!failedRead.current&&cache.before&&nearTop())scan('before',undefined,true);
 }
 function onScroll(){
  const top=view.current?.scrollTop??0, movingUp=top<previousScrollTop.current;
  previousScrollTop.current=top;
  saveAnchor();
  if(movingUp)readEarlier();
 }
 function scan(mode:ReadMode,target?:{id:string;quote?:MessageQuote},automatic=false){
  if(!connected||mode==='before'&&!cache.before)return;
  const active=request.current;
  if(active){
   if(active.mode!=='before'||(mode!=='around'&&mode!=='latest'))return;
   active.controller.abort();
  }
  failedRevision.current=undefined;
  const controller=new AbortController();request.current={controller,mode};failedRead.current=null;setReading(mode);setNotice('');
  const signal=controller.signal;
  const readPage=(query:HistoryPageRequest)=>read(query,signal);
  void (async()=>{
   let pages:HistoryPage[], before=cache.before, continueBefore=cache.continueBefore;
   if(mode==='around'&&target){
    const page=await readPage({around:target.id});
    pages=[page];before=page.before;continueBefore=false;
   }else if(mode==='before'){
    const older:HistoryPage[]=[], seen=new Set<string>();
    for(let count=0;count<earlierReadLimit&&before;count++){
     seen.add(before);
     const page=await readPage({before});
     if(signal.aborted)return;
     if(page.revision<latest.current.revision){
      if(cache.revision<latest.current.revision)return; // The newer snapshot will refresh the window.
      throw Error('history_revision_changed');
     }
     before=page.before;
     if(before&&seen.has(before))throw Error('history_cursor_invalid');
     older.unshift(page);
     if(page.messages.length||automatic&&!nearTop())break;
    }
    continueBefore=!!before&&older.length===earlierReadLimit&&!older[0].messages.length;
    pages=[...older,...cache.pages];
   }else if(mode==='latest'||!cache.pages.length){
    const page=await readPage({});pages=[page];before=page.before;continueBefore=false;
   }else{
    pages=[];
    for(const old of cache.pages){
     if(signal.aborted)return;
     pages.push(await readPage({range:old.scope!.range}));
    }
    let after:string|null=cache.detached?null:cache.pages.at(-1)!.scope!.tail;
    while(after&&!signal.aborted){
     const page=await readPage({after});
     if(page.scope!.tail!==after)pages.push(page);
     if(page.after===after)throw Error('history_cursor_invalid');
     after=page.after;
    }
   }
   if(signal.aborted)return;
   const nextRevision=Math.max(...pages.map(page=>page.revision));
   if(nextRevision<cache.revision||mode==='refresh'&&pages.some(page=>page.revision!==nextRevision)){
    failedRevision.current=revision;failedRead.current={mode:'refresh'};
    setNotice('暂时无法读取稳定的历史，请重试。');return;
   }
   if(mode!=='around'&&view.current){
    const anchor=capture(view.current);
    pendingAnchor.current={...anchor,bottom:mode==='before'?false:anchor.bottom};
   }
   if(target){pendingTarget.current=target;cache.detached=true;}
   if(mode==='latest'){cache.detached=false;pendingAnchor.current={bottom:true,offset:0};}
   cache.pages=pages;cache.before=before;cache.continueBefore=continueBefore;
   cache.revision=mode==='before'?Math.min(...pages.map(page=>page.revision)):nextRevision;
   bump();
  })().catch(error=>{
   if(signal.aborted)return;
   if(mode==='around'&&target&&error.message==='history_message_outside_task'){latest.current.onOriginal(target.id,target.quote);return;}
   if(mode==='around'&&error.message==='history_message_not_found'){
    setNotice('原消息已不可读，引用摘录已保留。');return;
   }
   failedRevision.current=revision;failedRead.current={mode,target};setNotice('暂时无法读取事项消息，请重试。');
  }).finally(()=>{
   if(request.current?.controller!==controller)return;
   request.current=null;
   if(!signal.aborted)setReading(null);
  });
 }
 useEffect(()=>{
  if(failedRevision.current!==revision&&!cache.details&&connected&&(!cache.pages.length||cache.revision<revision))scan('refresh');
 },[cache,read,revision,connected,attempt,frame,busy]);
 const ordered=new Map<string,HistoryPage['messages'][number]>();
 for(const page of cache.pages)for(const message of page.messages){ordered.delete(message.id);ordered.set(message.id,message);}
 const owners=new Map(cache.pages.flatMap(page=>page.messages.map(message=>[message.id,page] as const)));
 const artifactMap=new Map(cache.pages.flatMap(page=>(page.artifacts??[]).filter(file=>owners.get(file.messageId)===page)).map(file=>[file.id,file]));
 const messages=[...ordered.values()];
 useEffect(()=>{
  if(!cache.details&&!cache.detached&&cache.pages.length>0&&!messages.length)readEarlier();
 },[cache,read,connected,revision,frame,busy]);
 function focusSource(target:{id:string;quote?:MessageQuote}){
  const container=view.current,row=container&&messageRow(container,target.id);
  if(!row||!container)return;
  container.scrollTop+=row.getBoundingClientRect().top-container.getBoundingClientRect().top-container.clientHeight/3;
  previousScrollTop.current=container.scrollTop;saveAnchor();
  row.focus({preventScroll:true});
  if(target.quote)void locateSourceQuote(target.quote,container).then(range=>{
   if(!range||!row.isConnected||document.activeElement!==row)return;
   const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
  }).catch(()=>{});
 }
 function positionRows(){
  const container=view.current,anchor=pendingAnchor.current,target=pendingTarget.current;
  if(!container)return;
  pendingAnchor.current=null;pendingTarget.current=null;
  if(target)focusSource(target);
  else if(anchor){
   const row=anchor.id?messageRow(container,anchor.id):undefined;
   if(anchor.bottom)container.scrollTop=container.scrollHeight;
   else if(row)container.scrollTop+=row.getBoundingClientRect().top-container.getBoundingClientRect().top-anchor.offset;
   else if(anchor.scrollTop!==undefined)container.scrollTop=anchor.scrollTop;
   previousScrollTop.current=container.scrollTop;saveAnchor();
  }
 }
 function locate(id:string,quote?:MessageQuote){
  if(view.current&&messageRow(view.current,id))focusSource({id,quote});
  else scan('around',{id,quote});
 }
 const {task,details}=cache;
 const loadingEarlier=reading==='before';
 const inReader=(target:EventTarget)=>view.current?.contains(target as Node);
 return <section className="task-conversation" data-task-conversation={taskId}
  onWheelCapture={event=>{if(event.deltaY<0&&!event.ctrlKey&&inReader(event.target))readEarlier();}}
  onTouchStartCapture={event=>{touchStartY.current=inReader(event.target)&&event.touches.length===1?event.touches[0].clientY:undefined;}}
  onTouchMoveCapture={event=>{
   const start=touchStartY.current;
   if(start!==undefined&&event.touches.length===1&&event.touches[0].clientY-start>8){touchStartY.current=undefined;readEarlier();}
  }}
  onKeyDownCapture={event=>{
   if(event.target===view.current&&(['ArrowUp','PageUp','Home'].includes(event.key)||event.key===' '&&event.shiftKey))readEarlier();
  }}>
  <header className="task-conversation-toolbar"><span>{details?'事项详情':'事项对话'}</span>
   <button type="button" onClick={()=>{
    if(!details){saveAnchor();cancelRead();refreshTask();}
    else{pendingAnchor.current=cache.anchor??{bottom:true,offset:0};retry(n=>n+1);}
    failedRevision.current=undefined;cache.details=!details;bump();
   }}>{details?'返回对话':'事项详情'}</button>
  </header>
  {details?<div className="task-conversation-info"><h2>{taskName(task).text}</h2>
   {detailNotice&&<p role="status">{detailNotice} <button type="button" onClick={refreshTask}>重试</button></p>}
   <h3>事项内容</h3><p>{task.goal??'暂无事项内容'}</p>
   <h3>笔记</h3><p>{task.notes||'暂无笔记'}</p>
   <h3>Worker</h3>{task.workers.length?<ul className="task-detail-workers" role="list">{task.workers.map((worker,index)=>{
    const label='Worker '+(index+1);
    const assignments=worker.assignments?.slice().reverse();
    return <li key={worker.id}><span>{label}</span>
     {assignments?.length||worker.workTitle?<ol className="task-worker-timeline" role="list" aria-label={label+' 分工，最新在前'}>
      {assignments?.length?assignments.map(({messageId,title},position)=><li key={messageId} aria-current={position===0?true:undefined}>
       {position===0?<strong>{title}</strong>:title}
      </li>):<li aria-current="true"><strong>{worker.workTitle}</strong></li>}
     </ol>:<span>暂无工作标题</span>}
    </li>;
   })}</ul>:<p>暂无 Worker</p>}
  </div>:<>
   <div className="task-conversation-history">
    <span>仅显示可确认归属的消息，部分早期记录可能只在主对话中。</span>
    {cache.continueBefore&&!failedRead.current&&<button type="button" ref={bindHistoryAction} aria-disabled={busy||!connected} onClick={()=>{if(!busy)scan('before');}}>继续查找</button>}
    {cache.detached&&<button type="button" disabled={busy&&!loadingEarlier||!connected} onClick={()=>scan('latest')}>返回最新</button>}
   </div>
   {notice&&<div className="task-history-notice" role="status">{notice} {notice.startsWith('暂时')&&<button type="button" ref={bindHistoryAction} disabled={busy||!connected} onClick={()=>{if(failedRead.current)scan(failedRead.current.mode,failedRead.current.target);}}>重试</button>}</div>}
   {loadingEarlier&&!!messages.length&&<p className="task-history-notice" role="status">正在读取更早消息…</p>}
   {render({messages,artifacts:[...artifactMap.values()]},view,locate,task,refreshTask,onScroll,positionRows)}
   {!messages.length&&<p className="task-history-empty" role="status">{busy?'正在读取事项消息…':cache.before?'这段历史暂无匹配。':connected?'暂无可确认归属的消息。':'连接恢复后可读取事项消息。'}</p>}
  </>}
 </section>;
}
