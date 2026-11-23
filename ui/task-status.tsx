import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ListTodoIcon,ChevronRightIcon,BotIcon,MessageCirclePlus} from 'lucide-react';
import {Collapsible} from '@base-ui/react/collapsible';
import type {WebState} from '../src/web-contract';
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
function TaskStatusRow({label,workerCount,running,selected,onSelect,onReference}:{
 label:string;workerCount:number;running:boolean;selected:boolean;onSelect?:()=>void;onReference?:()=>void;
}){
 const id=useId();
 const Row=onSelect?'button':'div';
 const description=[running&&id+'-running',workerCount>0&&id+'-workers'].filter(Boolean).join(' ');
 return <div className="status-task-entry" data-reference={onReference?'available':undefined} data-workers={workerCount>0?'present':undefined}>
 <Row data-slot="task-status-row" data-item-row="true" className="status-task-row" title={label}
  {...(onSelect?{type:'button' as const,onClick:onSelect,'aria-labelledby':id,'aria-describedby':description||undefined,'aria-pressed':selected}:{})}>
  <span id={id} className="status-task-title">{label}</span>
  {running&&<span id={id+'-running'} className="status-task-running" role="img" aria-label="运行中" title="运行中">
   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5"/>
    <path d="M7 1a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5"/>
   </svg>
  </span>}
  {workerCount>0&&<span id={id+'-workers'} className="status-task-workers" role="img" aria-label={workerCount+' 个 Worker'} title={workerCount+' 个 Worker'}><BotIcon size={16} aria-hidden="true"/>{workerCount}</span>}
 </Row>
 {onReference&&<button type="button" className="status-task-reference" aria-label={'引用事项：'+label} title="引用到对话" onClick={onReference}><MessageCirclePlus size={16} aria-hidden/></button>}
 </div>;
}
type TaskLocation={taskId:string;threadId:string;readEpoch?:string};
type ListProps={connected:boolean;refreshKey:unknown;running?:ReadonlySet<string>;onReference?:(value:TaskReference)=>void;location?:TaskLocation;onLocated?:()=>void};
type TaskRead=ReturnType<typeof useTaskStatusData>;
function TaskSection({archived,connected,read,tasks,tail,running,onReference}:{
 archived:boolean;connected:boolean;read:TaskRead;tasks:OverviewTask[];tail:React.RefObject<HTMLDivElement|null>;
 running?:ReadonlySet<string>;onReference?:ListProps['onReference'];
}){
 const [selectedId,setSelectedId]=useState<string>();
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
   return <section key={task.id} id={'task-'+encodeURIComponent(task.id)} data-todo-id={task.id} aria-label={title}>
    <TaskStatusRow label={title} workerCount={task.workers.length} running={!archived&&connected&&(running?running.has(task.id):!stale&&task.hasExecutingWorker===true)}
     onReference={onReference&&!stale?()=>onReference({taskId:task.id,version:task.headVersion,title}):undefined}
     selected={task.id===selectedId} onSelect={archived?undefined:()=>setSelectedId(id=>id===task.id?undefined:task.id)}/>
    {!archived&&<div role="status" aria-atomic="true">{task.id===selectedId&&<p className="status-full-title"><span>完整标题</span>{title}</p>}</div>}
   </section>;
  })}</div>
  {reading==='append'&&<p role="status">正在读取更多事项…</p>}
  {failure==='append'&&<div role="status">暂时无法读取更多事项。{retryButton}</div>}
  <div ref={tail} className="status-list-tail" aria-hidden="true"/>
 </section>;
}

function TaskList({connected,refreshKey,running,onReference,location,onLocated}:ListProps){
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

 const current=useTaskStatusData(false,true,connected,refreshKey,()=>{
  const focus=document.activeElement;
  const archiveFocused=focus instanceof HTMLElement&&archiveGroup.current?.contains(focus)&&isVisible(focus);
  return !target&&!archiveFocused&&!(archived&&isVisible(archiveToggle.current))&&isVisible(currentTail.current);
 },captureAnchor);
 const history=useTaskStatusData(true,archived,connected,refreshKey,()=>!target&&isVisible(archiveTail.current),captureAnchor);
 const wakeCurrent=current.wake,wakeHistory=history.wake;
 const currentReady=!!(current.data||current.failure);

 function focusTask(taskId:string){
  const row=document.getElementById('task-'+encodeURIComponent(taskId));
  if(!row||!list.current?.contains(row))return false;
  row.scrollIntoView({block:'nearest'});
  const control=row.querySelector<HTMLButtonElement>('button[data-slot="task-status-row"]');
  if(control)control.focus({preventScroll:true});
  else{row.tabIndex=-1;row.focus({preventScroll:true});}
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

 const currentTasks=current.data?.tasks??[],archivedTasks=archived?history.data?.tasks??[]:[];
 const currentRevisions=new Map(currentTasks.map(task=>[task.id,task.revision]));
 const archivedRevisions=new Map(archivedTasks.map(task=>[task.id,task.revision]));
 return <div className="status-list" ref={list} role="region" aria-label="事项列表" tabIndex={0}
  onFocusCapture={wakeCurrent} onBlurCapture={wakeCurrent} onScroll={wakeCurrent}>
  {locationError&&<p role="status">暂时无法定位所引用的事项。</p>}
  {target?<><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>{setTarget(null);list.current?.focus({preventScroll:true});}}>返回事项列表</button>
   <TaskSection archived={target.view==='archived'} connected={connected} read={{...current,data:target.data,reading:null,failure:null,stale:!connected}}
    tasks={target.data.tasks} tail={currentTail} running={running} onReference={onReference}/>
  </>:<>
  <TaskSection archived={false} connected={connected} read={current} tail={currentTail} running={running} onReference={onReference}
   tasks={currentTasks.filter(task=>task.revision>=(archivedRevisions.get(task.id)??-1))}/>
  <div ref={archiveGroup}>
   <Collapsible.Root open={archived} onOpenChange={value=>{if(value)beforeArchive.current=readAnchor();setArchived(value);}}>
    <Collapsible.Trigger ref={archiveToggle} className={ghostButton+' status-archive-toggle min-h-11 w-full gap-1 px-1.5 text-xs'}>
     已归档<ChevronRightIcon aria-hidden="true" className={cn('size-3',archived&&'rotate-90')}/>
    </Collapsible.Trigger>
    <Collapsible.Panel>{archived&&<TaskSection archived connected={connected} read={history} tail={archiveTail} onReference={onReference}
     tasks={archivedTasks.filter(task=>task.revision>(currentRevisions.get(task.id)??-1))}/>}</Collapsible.Panel>
   </Collapsible.Root>
  </div></>}
 </div>;
}
export function TaskStatusPopover({state,connected,refreshKey,asideContainer,onBeforeLayoutChange,onReference,location,onLocated}:Omit<ListProps,'running'|'onReference'> & {state:WebState;asideContainer:HTMLElement|null;onBeforeLayoutChange:()=>void;onReference?:(value:TaskReference)=>boolean}){
 const [wide,setWide]=useState(false),[pinned,setPinned]=useState(true),[popupOpen,setPopupOpen]=useState(false);
 const open=wide?pinned:popupOpen;
 const focusComposer=useRef(false);
 const beforeLayout=useRef(onBeforeLayoutChange);beforeLayout.current=onBeforeLayoutChange;
 useLayoutEffect(()=>{
  const workspace=asideContainer?.parentElement;if(!workspace)return;
  let previous:boolean|undefined;
  const measure=()=>{
   // 320px summary + at least 800px for the existing conversation and gutters.
   const next=workspace.clientWidth>=1120;if(next===previous)return;
   if(previous!==undefined)beforeLayout.current();previous=next;
   const restoreFocus=document.getElementById('task-status-panel')?.contains(document.activeElement);
   setPopupOpen(false);setWide(next);
   if(restoreFocus)requestAnimationFrame(()=>document.getElementById('task-status-trigger')?.focus({preventScroll:true}));
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(workspace);return()=>observer.disconnect();
 },[asideContainer]);
 useLayoutEffect(()=>{setPopupOpen(false);},[state.threadId,state.history?.readEpoch]);
 const scopedLocation=location?.threadId===state.threadId&&location.readEpoch===state.history?.readEpoch?location:undefined;
 const clearLocation=()=>{if(scopedLocation)onLocated?.();};
 const togglePinned=()=>{onBeforeLayoutChange();if(pinned)clearLocation();setPinned(!pinned);};
 useLayoutEffect(()=>{if(scopedLocation){if(wide)setPinned(true);else setPopupOpen(true);}},[scopedLocation,wide]);
 const running=useMemo(()=>state.runningTaskIds&&new Set(state.runningTaskIds),[state.runningTaskIds]);
 const count=connected?running?.size:undefined;
 const title=count===undefined?(running?'工作状态，运行数量待核实':'工作状态'):count?'工作状态，'+count+' 项事项运行中':'工作状态，无运行中事项';
 const content=<TaskList key={state.threadId+':'+(state.history?.readEpoch??'legacy')} connected={connected} refreshKey={refreshKey}
  running={running} location={scopedLocation} onLocated={onLocated} onReference={onReference&&((ref)=>{
   if(onReference(ref)&&!wide){focusComposer.current=true;setPopupOpen(false);}
  })}/>;
 return <><div className="homer-task-status"><Popover open={!wide&&popupOpen} onOpenChange={value=>{if(!wide){if(!value)clearLocation();setPopupOpen(value);}}}><PopoverTrigger asChild>
  <button id="task-status-trigger" type="button" className={ghostButton+' status-entry'} aria-label={title} title={title} aria-expanded={open} aria-controls="task-status-panel" aria-haspopup={wide?undefined:'dialog'} onClick={wide?togglePinned:undefined}>
   <span className="status-entry-icon" aria-hidden="true">
    <ListTodoIcon size={18}/>
    {!!count&&<span className="status-entry-count">{count>99?'99+':count}</span>}
   </span>
  </button>
  </PopoverTrigger>
  {!wide&&<PopoverContent id="task-status-panel" className="homer-task-status status-popover w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-3 shadow-none motion-reduce:animate-none" align="end" side="bottom" sideOffset={12} collisionPadding={12} aria-label="工作状态卡片" aria-describedby={undefined} onEscapeKeyDown={event=>event.stopPropagation()} onCloseAutoFocus={event=>{if(focusComposer.current){focusComposer.current=false;event.preventDefault();}}}>{content}</PopoverContent>}
 </Popover></div>
 {wide&&pinned&&asideContainer&&createPortal(<aside id="task-status-panel" className="homer-task-status status-aside" aria-label="工作状态卡片">{content}</aside>,asideContainer)}</>;
}
