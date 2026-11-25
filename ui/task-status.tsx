import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ArchiveIcon,ListTodoIcon,ChevronRightIcon,BotIcon,MessageCirclePlus} from 'lucide-react';
import {Collapsible} from '@base-ui/react/collapsible';
import type {TaskArchiveResult,WebState} from '../src/web-contract';
import type {OverviewTask,TaskDetail,TaskOverview} from '../src/task-overview';
import type {TaskReference} from '../src/web-history';
import {connectionFetch} from './web-connection-client';
import {taskName} from '../src/task-presentation';
import {cn} from './vendor/task-status/utils';
import {useTaskStatusData} from './task-status-data';
import {Popover,PopoverTrigger,PopoverContent} from './vendor/task-status/popover';
import {ghostButton} from './vendor/task-status/surfaces';
import {createPortal} from 'react-dom';
import './vendor/task-status/components.css';
import './task-status.css';
function archiveReason(reason:string){
 switch(reason){
  case 'interaction_unresolved':return '仍有待答问题或待审批操作。';
  case 'run_not_closed':return 'Worker 执行尚未结束。';
  case 'operation_unresolved':
  case 'worker_effect_unconfirmed':
  case 'main_effect_unconfirmed':return '仍有操作结果待确认。';
  case 'archive_source_unavailable':return '暂时无法核实归档复核所需的原委托。';
  case 'archive_review_skill_unavailable':return '归档复核 Skill 暂不可用。';
  case 'main_engine_unavailable':return 'Homer 暂不可用。';
  default:return '仍有事项记录待处理。';
 }
}
function TaskStatusRow({label,workerCount,running,archived,onReference,onOpen,archive}:{
 label:string;workerCount:number;running:boolean;archived:boolean;onReference?:()=>void;onOpen?:(trigger:HTMLElement)=>void;
 archive?:{reason:string|null;pending:boolean;activate:()=>void};
}){
 const archiveReasonId=useId();
 return <div className="status-task-entry" data-reference={onReference?'available':undefined} data-workers={workerCount>0?'present':undefined} data-top-action={running||archive?'present':undefined}>
 <div data-slot="task-status-row" data-item-row="true" className="status-task-row" title={label}>
  {onOpen?<button type="button" className="status-task-title status-task-open" onClick={event=>onOpen(event.currentTarget)}>{label}</button>
    :<span className={archived?'status-task-title':'status-task-title status-task-title-truncated'}>{label}</span>}
  {running&&<span className="status-task-running" role="img" aria-label="运行中" title="运行中">
   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5"/>
    <path d="M7 1a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5"/>
   </svg>
  </span>}
  {workerCount>0&&<span className="status-task-workers" role="img" aria-label={workerCount+' 个 Worker'} title={workerCount+' 个 Worker'}><BotIcon size={16} aria-hidden="true"/>{workerCount}</span>}
 </div>
 {archive&&<button type="button" className="status-task-archive" aria-label={(archive.pending?'正在归档：':'归档事项：')+label}
  title={archive.reason??(archive.pending?'正在归档…':'归档事项')} disabled={!!archive.reason&&!archive.pending}
  aria-disabled={archive.pending||undefined} aria-describedby={archive.reason?archiveReasonId:undefined} onClick={archive.activate}><ArchiveIcon size={16} aria-hidden/></button>}
 {archive?.reason&&<span id={archiveReasonId} className="sr-only">{archive.reason}</span>}
 {onReference&&<button type="button" className="status-task-reference" aria-label={'引用事项：'+label} title="引用到对话" onClick={onReference}><MessageCirclePlus size={16} aria-hidden/></button>}
 </div>;
}
type TaskLocation={taskId:string;threadId:string;readEpoch?:string};
type ListProps={connected:boolean;refreshKey:unknown;running?:ReadonlySet<string>;onReference?:(value:TaskReference)=>void;location?:TaskLocation;onLocated?:()=>void;onOpen?:(task:OverviewTask,trigger:HTMLElement)=>void};
type TaskRead=ReturnType<typeof useTaskStatusData>;
function TaskSection({archived,connected,read,tasks,tail,running,onReference,onOpen,onArchive,archiving}:{
 archived:boolean;connected:boolean;read:TaskRead;tasks:OverviewTask[];tail:React.RefObject<HTMLDivElement|null>;
 running?:ReadonlySet<string>;onReference?:ListProps['onReference'];onOpen?:ListProps['onOpen'];
 onArchive?:(task:OverviewTask)=>void;archiving?:ReadonlySet<string>;
}){
 const {data,reading,failure,stale,retry}=read;
 const retryButton=failure&&<button type="button" className={ghostButton} disabled={!!reading||!connected} onClick={event=>{
  if(document.activeElement===event.currentTarget)event.currentTarget.closest('section')?.focus({preventScroll:true});
  retry();
 }}>重试</button>;
 return <section tabIndex={-1} aria-label={archived?'已归档事项':'当前事项'}>
  {(failure==='refresh'||stale&&data)&&<div role="status">{failure==='refresh'?'任务记录暂时无法读取。':'连接尚未确认。'}{data?' 显示上次记录。':''}{failure==='refresh'&&retryButton}</div>}
  {!data&&!failure&&<p role="status">{connected?'正在读取事项记录…':'等待连接后读取事项记录。'}</p>}
  {data&&!data.tasks.length&&<p>{archived?'暂无已归档事项。':'暂无当前事项。'}</p>}
  <div className="flex flex-col gap-1">{tasks.map(task=>{
   const title=taskName(task).text;
   const executing=!archived&&connected&&(running?running.has(task.id):!stale&&task.hasExecutingWorker===true);
   const archive=onArchive&&!archived&&!stale&&!executing&&task.archiveBlocker!==undefined?{
    reason:task.archiveBlocker?archiveReason(task.archiveBlocker):null,pending:archiving?.has(task.id)===true,activate:()=>onArchive(task),
   }:undefined;
   return <section key={task.id} id={'task-'+encodeURIComponent(task.id)} data-todo-id={task.id} aria-label={title} tabIndex={-1}>
    <TaskStatusRow label={title} workerCount={task.workers.length} running={executing} archived={archived} archive={archive} onOpen={onOpen?trigger=>onOpen(task,trigger):undefined}
     onReference={onReference&&!stale?()=>onReference({taskId:task.id,version:task.headVersion,title}):undefined}/>
    {task.workers.some(worker=>worker.workTitle)&&<ul className="status-worker-assignments" aria-label="Worker 分工">
     {task.workers.filter(worker=>worker.workTitle).map(worker=>{
      const previous=worker.assignments?.slice(0,-1)??[];
      return <li key={worker.id}>{worker.workTitle}{previous.length>0&&<details>
       <summary>此前分工</summary><ul>{previous.map(item=><li key={item.messageId}>{item.title}</li>)}</ul>
      </details>}</li>;
     })}
    </ul>}
    {archived&&task.archiveReviewIssue&&<p className="status-archive-notice" role="status">{task.archiveReviewIssue==='failed'?'归档复核失败，事项已归档。':'归档复核结果待确认。'}</p>}
   </section>;
  })}</div>
  {reading==='append'&&<p role="status">正在读取更多事项…</p>}
  {failure==='append'&&<div role="status">暂时无法读取更多事项。{retryButton}</div>}
  <div ref={tail} className="status-list-tail" aria-hidden="true"/>
 </section>;
}

function TaskList({connected,refreshKey,running,onReference,onOpen,location,onLocated,archiveScope}:ListProps&{archiveScope?:{threadId:string;readEpoch:string}}){
 const [archived,setArchived]=useState(false);
 const list=useRef<HTMLDivElement>(null);
 const beforeArchive=useRef<ReturnType<typeof readAnchor>>(null);
 const archiveGroup=useRef<HTMLDivElement>(null),archiveToggle=useRef<HTMLButtonElement>(null);
 const currentTail=useRef<HTMLDivElement>(null),archiveTail=useRef<HTMLDivElement>(null);
 const anchor=useRef<ReturnType<typeof readAnchor>>(null);
 const [target,setTarget]=useState<{view:'visible'|'archived';data:TaskOverview}|null>(null);
 const [locationError,setLocationError]=useState(false);
 const locationAnchor=useRef<ReturnType<typeof readAnchor>>(null);
 const locateFocus=useRef<string|undefined>(undefined);
 const archiveRequests=useRef(new Set<string>());
 const [archiving,setArchiving]=useState<ReadonlySet<string>>(()=>new Set());
 const [archiveNotice,setArchiveNotice]=useState('');
 const [archiveRefresh,setArchiveRefresh]=useState(0);
 const [archiveRevisions,setArchiveRevisions]=useState<ReadonlyMap<string,number>>(()=>new Map());
 const listRefreshKey=useMemo(()=>({refreshKey,archiveRefresh}),[refreshKey,archiveRefresh]);

 function isVisible(tail:HTMLElement|null){
  const root=list.current;
  if(!root||!tail)return false;
  const clip=root.getBoundingClientRect(),row=tail.getBoundingClientRect();
  return row.height>0&&row.bottom>clip.top&&row.top<clip.bottom;
 }

 function readAnchor(preferArchive=false){
  const root=list.current;
  if(!root)return null;
  const rows=Array.from(root.querySelectorAll<HTMLElement>('[data-todo-id]'));
  const row=(preferArchive&&rows.find(row=>archiveGroup.current?.contains(row)&&isVisible(row)))
   ||(preferArchive&&isVisible(archiveToggle.current)&&archiveToggle.current)
   ||rows.find(isVisible);
  return {id:row?.dataset.todoId,archiveToggle:row===archiveToggle.current,inArchive:!!row&&!!archiveGroup.current?.contains(row),
   top:row?.getBoundingClientRect().top??0,scrollTop:root.scrollTop};
 }

 function restoreAnchor(saved:NonNullable<ReturnType<typeof readAnchor>>,restoreTop=false){
  const root=list.current;
  if(!root)return;
  const row=saved.archiveToggle?archiveToggle.current
   :Array.from(root.querySelectorAll<HTMLElement>('[data-todo-id]')).find(row=>row.dataset.todoId===saved.id&&!!archiveGroup.current?.contains(row)===saved.inArchive);
  if(row&&saved.scrollTop!==0)root.scrollTop+=row.getBoundingClientRect().top-saved.top;
  else if(restoreTop)root.scrollTop=saved.scrollTop;
 }

 function captureAnchor(){
  if(!target&&!anchor.current&&list.current?.scrollTop)anchor.current=readAnchor(archived);
 }

 const current=useTaskStatusData(false,true,connected,listRefreshKey,()=>{
  const focus=document.activeElement;
  const archiveFocused=focus instanceof HTMLElement&&archiveGroup.current?.contains(focus)&&isVisible(focus);
  return !target&&!archiveFocused&&!(archived&&isVisible(archiveToggle.current))&&isVisible(currentTail.current);
 },captureAnchor);
 const history=useTaskStatusData(true,archived,connected,listRefreshKey,()=>!target&&isVisible(archiveTail.current),captureAnchor);
 const wakeCurrent=current.wake,wakeHistory=history.wake;
 const currentReady=!!(current.data||current.failure);

 function focusTask(taskId:string){
  const row=document.getElementById('task-'+encodeURIComponent(taskId));
  if(!row||!list.current?.contains(row))return false;
  row.scrollIntoView({block:'nearest'});
  row.focus({preventScroll:true});
  return true;
 }

 useEffect(()=>{
  if(!location)return;
  setLocationError(false);
  if(connected&&focusTask(location.taskId)){onLocated?.();return;}
  if(!connected){setLocationError(true);onLocated?.();return;}
  if(!currentReady)return;
  const controller=new AbortController();
  const signal=controller.signal;
  async function read<T>(path:string){
   const response=await connectionFetch(path,{signal});
   if(!response.ok)throw Error('task_location_unavailable');
   return await response.json() as T;
  }
  const timeout=setTimeout(()=>controller.abort('task_location_timeout'),15000);
  void(async()=>{
   try{
    const taskId=location.taskId;
    const {historyState,creationOrder}=await read<TaskDetail>('/api/tasks/'+encodeURIComponent(taskId)+'/summary');
    if(!historyState||!creationOrder||!Number.isSafeInteger(creationOrder+1))throw Error('task_location_unavailable');
    const data=await read<TaskOverview>('/api/tasks/list/'+historyState+'/before/'+(creationOrder+1));
    if(signal.aborted||!data.tasks.some(task=>task.id===taskId))throw Error('task_location_unavailable');
    if(!target)locationAnchor.current=readAnchor(archived);
    locateFocus.current=taskId;
    setTarget({view:historyState,data});
   }catch{if(!signal.aborted||signal.reason==='task_location_timeout')setLocationError(true);}
   finally{clearTimeout(timeout);if(!signal.aborted||signal.reason==='task_location_timeout')onLocated?.();}
  })();
  return()=>{clearTimeout(timeout);controller.abort();};
 },[connected,currentReady,location]);

 useLayoutEffect(()=>{
  if(locateFocus.current&&focusTask(locateFocus.current))locateFocus.current=undefined;
  if(!target&&locationAnchor.current){
   restoreAnchor(locationAnchor.current,true);
   locationAnchor.current=null;
  }
 },[target]);

 useLayoutEffect(()=>{
  const root=list.current;
  if(!root)return;
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting){
    if(entry.target===currentTail.current)wakeCurrent();
    else wakeHistory();
   }
  },{root});
  if(currentTail.current)observer.observe(currentTail.current);
  if(archiveTail.current)observer.observe(archiveTail.current);
  return()=>observer.disconnect();
 },[archived,wakeCurrent,wakeHistory]);

 useLayoutEffect(()=>{
  const saved=anchor.current;anchor.current=null;
  if(saved&&list.current?.scrollTop===saved.scrollTop)restoreAnchor(saved);
  wakeCurrent();
  wakeHistory();
 },[current.data,history.data,current.reading,history.reading,archived,wakeCurrent,wakeHistory]);

 useLayoutEffect(()=>{
  if(!archived&&beforeArchive.current){
   restoreAnchor(beforeArchive.current,true);
   beforeArchive.current=null;
  }
 },[archived]);

 async function archiveTask(task:OverviewTask){
  if(!archiveScope||!connected||task.archiveBlocker!==null||archiveRequests.current.has(task.id))return;
  const title=taskName(task).text;
  const requests=archiveRequests.current;
  requests.add(task.id);
  setArchiving(new Set(requests));
  setArchiveNotice('正在归档「'+title+'」…');
  try{
   const response=await connectionFetch('/api/tasks/archive',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
    body:JSON.stringify({...archiveScope,taskId:task.id,expectedRevision:task.revision,operationId:crypto.randomUUID()}),
   });
   if(!response.ok){
    const error=(await response.json().catch(()=>null))?.error;
    if(['task_revision_conflict','history_epoch_changed','queue_thread_conflict'].includes(error)){
     setArchiveNotice('事项列表已变更，暂未归档。');
     return;
    }
    if(['archive_review_skill_unavailable','main_engine_unavailable'].includes(error)){
     setArchiveNotice('「'+title+'」暂不能归档。'+archiveReason(error));
     return;
    }
    throw Error('task_archive_unconfirmed');
   }
   const result:TaskArchiveResult=await response.json();
   if(result.state==='skipped'){
    setArchiveNotice('「'+title+'」暂不能归档。'+archiveReason(result.reason));
    return;
   }
   if(result.state!=='archived'||result.revision!==task.revision+1)throw Error('task_archive_unconfirmed');
   const focused=document.activeElement?.closest('[data-todo-id]')?.getAttribute('data-todo-id')===task.id;
   if(focused)(archiveToggle.current??list.current)?.focus({preventScroll:true});
   setTarget(value=>value?.view==='visible'&&value.data.tasks.some(item=>item.id===task.id)?null:value);
   setArchiveRevisions(value=>new Map(value).set(task.id,result.revision));
   setArchiveNotice('已归档「'+title+'」，已通知 Homer 复核。');
  }catch{
   setArchiveNotice('未确认「'+title+'」的归档结果，正在刷新事项列表。');
  }finally{
   requests.delete(task.id);
   setArchiving(new Set(requests));
   setArchiveRefresh(value=>value+1);
  }
 }
 const onArchive=archiveScope?archiveTask:undefined;
 const stillCurrent=(task:OverviewTask)=>task.revision>=(archiveRevisions.get(task.id)??-1);
 const currentTasks=current.data?.tasks??[],archivedTasks=archived?history.data?.tasks??[]:[];
 const currentRevisions=new Map(currentTasks.map(task=>[task.id,task.revision]));
 const archivedRevisions=new Map(archivedTasks.map(task=>[task.id,task.revision]));
 return <div className="status-list" ref={list} role="region" aria-label="事项列表" tabIndex={0}
  onFocusCapture={wakeCurrent} onBlurCapture={wakeCurrent} onScroll={wakeCurrent}>
  {locationError&&<p role="status">暂时无法定位所引用的事项。</p>}
  <div className="status-archive-notice" role="status">{archiveNotice}</div>
  {target?<><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>{setTarget(null);list.current?.focus({preventScroll:true});}}>返回事项列表</button>
   <TaskSection archived={target.view==='archived'} connected={connected} read={{...current,data:target.data,reading:null,failure:null,stale:!connected}}
    tasks={target.view==='visible'?target.data.tasks.filter(stillCurrent):target.data.tasks} tail={currentTail}
    running={running} onReference={onReference} onOpen={onOpen} onArchive={onArchive} archiving={archiving}/>
  </>:<>
  <TaskSection archived={false} connected={connected} read={current} tail={currentTail} running={running} onReference={onReference} onOpen={onOpen}
   onArchive={onArchive} archiving={archiving} tasks={currentTasks.filter(task=>stillCurrent(task)&&task.revision>=(archivedRevisions.get(task.id)??-1))}/>
  <div ref={archiveGroup}>
   <Collapsible.Root open={archived} onOpenChange={value=>{if(value)beforeArchive.current=readAnchor();setArchived(value);}}>
    <Collapsible.Trigger ref={archiveToggle} className={ghostButton+' status-archive-toggle min-h-11 w-full gap-1 px-1.5 text-xs'}>
     已归档<ChevronRightIcon aria-hidden="true" className={cn('size-3',archived&&'rotate-90')}/>
    </Collapsible.Trigger>
    <Collapsible.Panel>{archived&&<TaskSection archived connected={connected} read={history} tail={archiveTail} onReference={onReference} onOpen={onOpen}
     tasks={archivedTasks.filter(task=>task.revision>(currentRevisions.get(task.id)??-1))}/>}</Collapsible.Panel>
   </Collapsible.Root>
  </div></>}
 </div>;
}
export function TaskStatusPopover({state,connected,refreshKey,asideContainer,wide,pinned,onPinnedChange,previewModal,onBeforeLayoutChange,onReference,onOpen,location,onLocated}:Omit<ListProps,'running'|'onReference'> & {state:WebState;asideContainer:HTMLElement|null;wide:boolean;pinned:boolean;onPinnedChange:(open:boolean)=>void;previewModal:boolean;onBeforeLayoutChange:()=>void;onReference?:(value:TaskReference)=>boolean}){
 const [popupOpen,setPopupOpen]=useState(false);
 const open=wide?pinned:popupOpen&&!previewModal;
 const focusComposer=useRef(false);
 useLayoutEffect(()=>{if(wide||previewModal)setPopupOpen(false);},[wide,previewModal]);
 useLayoutEffect(()=>{setPopupOpen(false);},[state.threadId,state.history?.readEpoch]);
 const scopedLocation=location?.threadId===state.threadId&&location.readEpoch===state.history?.readEpoch?location:undefined;
 const clearLocation=()=>{if(scopedLocation)onLocated?.();};
 const togglePinned=()=>{onBeforeLayoutChange();if(pinned)clearLocation();onPinnedChange(!pinned);};
 useLayoutEffect(()=>{if(scopedLocation){if(wide)onPinnedChange(true);else if(!previewModal)setPopupOpen(true);}},[scopedLocation,wide,previewModal,onPinnedChange]);
 const running=useMemo(()=>state.runningTaskIds&&new Set(state.runningTaskIds),[state.runningTaskIds]);
 const count=connected?running?.size:undefined;
 const title=count===undefined?(running?'工作状态，运行数量待核实':'工作状态'):count?'工作状态，'+count+' 项事项运行中':'工作状态，无运行中事项';
 const content=<TaskList key={state.threadId+':'+(state.history?.readEpoch??'legacy')} connected={connected} refreshKey={refreshKey}
  archiveScope={state.features?.taskArchive&&state.history&&state.threadId?{threadId:state.threadId,readEpoch:state.history.readEpoch}:undefined}
  running={running} onOpen={onOpen&&((task,trigger)=>{if(!wide)setPopupOpen(false);onOpen(task,wide?trigger:document.getElementById('task-status-trigger')??trigger);})} location={scopedLocation} onLocated={onLocated} onReference={onReference&&((ref)=>{
   if(onReference(ref)&&!wide){focusComposer.current=true;setPopupOpen(false);}
  })}/>;
 return <><div className="homer-task-status"><Popover open={!wide&&open} onOpenChange={value=>{if(!wide){if(!value)clearLocation();setPopupOpen(value);}}}><PopoverTrigger asChild>
  <button id="task-status-trigger" type="button" className={ghostButton+' status-entry'} aria-label={title} title={title} aria-expanded={open} aria-controls="task-status-panel" aria-haspopup={wide?undefined:'dialog'} onClick={wide?togglePinned:undefined}>
   <span className="status-entry-icon" aria-hidden="true">
    <ListTodoIcon size={18}/>
    {!!count&&<span className="status-entry-count">{count>99?'99+':count}</span>}
   </span>
  </button>
  </PopoverTrigger>
  {!wide&&<PopoverContent id="task-status-panel" className="homer-task-status status-popover w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-3 shadow-none motion-reduce:animate-none" align="end" side="bottom" sideOffset={12} collisionPadding={12}
   aria-label="工作状态卡片" aria-describedby={undefined} onEscapeKeyDown={event=>event.stopPropagation()} onCloseAutoFocus={event=>{if(focusComposer.current||previewModal){focusComposer.current=false;event.preventDefault();}}}>{content}</PopoverContent>}
 </Popover></div>
 {wide&&pinned&&asideContainer&&createPortal(<aside id="task-status-panel" className="homer-task-status status-aside" aria-label="工作状态卡片">{content}</aside>,asideContainer)}</>;
}
