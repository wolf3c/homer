import {useId,useLayoutEffect,useRef,useState} from 'react';
import {ListTodoIcon,ChevronRightIcon,BotIcon} from 'lucide-react';
import {Collapsible} from '@base-ui/react/collapsible';
import type {WebState} from '../src/web-contract';
import type {OverviewPage} from '../src/task-overview';
import {taskName} from '../src/task-presentation';
import {cn} from './vendor/task-status/utils';
import {useTaskStatusData} from './task-status-data';
import {Popover,PopoverTrigger,PopoverContent} from './vendor/task-status/popover';
import {ghostButton} from './vendor/task-status/surfaces';
import {createPortal} from 'react-dom';
import './vendor/task-status/components.css';
import './task-status.css';
function TaskStatusRow({label,workerCount,running,selected,onSelect}:{
 label:string;workerCount:number;running:boolean;selected:boolean;onSelect?:()=>void;
}){
 const id=useId();
 const Row=onSelect?'button':'div';
 const description=[running&&id+'-running',workerCount>0&&id+'-workers'].filter(Boolean).join(' ');
 return <Row data-slot="task-status-row" data-item-row="true" className="status-task-row" title={label}
  {...(onSelect?{type:'button' as const,onClick:onSelect,'aria-labelledby':id,'aria-describedby':description||undefined,'aria-pressed':selected}:{})}>
  <span id={id} className="status-task-title">{label}</span>
  {running&&<span id={id+'-running'} className="status-task-running" role="img" aria-label="运行中" title="运行中">
   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5"/>
    <path d="M7 1a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5"/>
   </svg>
  </span>}
  {workerCount>0&&<span id={id+'-workers'} className="status-task-workers" role="img" aria-label={workerCount+' 个 Worker'} title={workerCount+' 个 Worker'}><BotIcon size={16} aria-hidden="true"/>{workerCount}</span>}
 </Row>;
}
type ListProps={state:WebState;connected:boolean};
function TaskPage({state,connected,view}:ListProps & {view:NonNullable<OverviewPage['view']>}){
 const [pages,setPages]=useState<number[]>([]);
 const [selectedId,setSelectedId]=useState<string>();
 const section=useRef<HTMLElement>(null);
 const anchor=useRef<{id:string;top:number;scrollTop:number}|null>(null);
 const before=pages.at(-1),archived=view==='archived';
 const path=!archived&&!before?'/api/tasks':`/api/tasks/list/${view}${before?'/before/'+before:''}`;
 const {data,error,busy,stale,refresh}=useTaskStatusData(state,connected,path,()=>{
  const list=section.current?.closest('.status-list');if(!list)return;
  const top=list.getBoundingClientRect().top;
  const row=Array.from(list.querySelectorAll<HTMLElement>('[data-todo-id]')).find(row=>row.getBoundingClientRect().bottom>top);
  anchor.current=row&&section.current?.contains(row)?{id:row.dataset.todoId!,top:row.getBoundingClientRect().top,scrollTop:list.scrollTop}:null;
 });
 const tasks=data?.tasks??[];
 useLayoutEffect(()=>{
  const saved=anchor.current;anchor.current=null;
  const list=section.current?.closest('.status-list');if(!saved||!list||list.scrollTop!==saved.scrollTop)return;
  const row=Array.from(section.current!.querySelectorAll<HTMLElement>('[data-todo-id]')).find(r=>r.dataset.todoId===saved.id);
  if(row)list.scrollTop+=row.getBoundingClientRect().top-saved.top;
 },[data]);
 function changePage(next:number[]){
  setPages(next);
  setSelectedId(undefined);
  section.current?.focus({preventScroll:true});
  section.current?.scrollIntoView({block:'nearest'});
 }
 return <section ref={section} tabIndex={-1} aria-label={archived?'已归档事项':'当前事项'}>
  {(error||stale&&data)&&<div role="status">{error||'连接尚未确认。'}{data?' 显示上次记录。':''}{error&&<button type="button" className={ghostButton} disabled={busy||!connected} onClick={()=>refresh(true)}>重试</button>}</div>}
  {!data&&!error&&<p role="status">{connected?'正在读取事项记录…':'等待连接后读取事项记录。'}</p>}
  {data&&!tasks.length&&<p>{archived?'暂无已归档事项。':'暂无当前事项。'}</p>}
  <div className="flex flex-col gap-1">{tasks.map(task=>{
   const title=taskName(task).text;
   return <section key={task.id} data-todo-id={task.id} aria-label={title}>
    <TaskStatusRow label={title} workerCount={task.workers.length} running={!archived&&!stale&&task.hasExecutingWorker===true}
     selected={task.id===selectedId} onSelect={archived?undefined:()=>setSelectedId(id=>id===task.id?undefined:task.id)}/>
    {!archived&&<div role="status" aria-atomic="true">{task.id===selectedId&&<p className="status-full-title"><span>完整标题</span>{title}</p>}</div>}
   </section>;
  })}</div>
  {!!pages.length&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>changePage(pages.slice(0,-1))}>上一页</button>}
  {data?.nextCursor&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>changePage([...pages,data.nextCursor!])}>下一页</button>}
 </section>;
}
function TaskList(props:ListProps){
 const [archived,setArchived]=useState(false);
 const list=useRef<HTMLDivElement>(null),currentPosition=useRef(0);
 useLayoutEffect(()=>{if(!archived&&list.current)list.current.scrollTop=currentPosition.current;},[archived]);
 return <div className="status-list" ref={list} role="region" aria-label="事项列表" tabIndex={0}>
  <TaskPage {...props} view="visible"/>
  <Collapsible.Root open={archived} onOpenChange={value=>{if(value)currentPosition.current=list.current?.scrollTop??0;setArchived(value);}}>
   <Collapsible.Trigger className={ghostButton+' status-archive-toggle min-h-11 w-full gap-1 px-1.5 text-xs'}>
    已归档<ChevronRightIcon aria-hidden="true" className={cn('size-3',archived&&'rotate-90')}/>
   </Collapsible.Trigger>
   <Collapsible.Panel>{archived&&<TaskPage {...props} view="archived"/>}</Collapsible.Panel>
  </Collapsible.Root>
 </div>;
}
export function TaskStatusPopover({state,connected,asideContainer,onBeforeLayoutChange}:ListProps & {asideContainer:HTMLElement|null;onBeforeLayoutChange:()=>void}){
 const [wide,setWide]=useState(false),[pinned,setPinned]=useState(true),[popupOpen,setPopupOpen]=useState(false);
 const open=wide?pinned:popupOpen;
 const togglePinned=()=>{onBeforeLayoutChange();setPinned(!pinned);};
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
 const title='工作状态';
 const content=<TaskList key={state.threadId+':'+(state.history?.readEpoch??'legacy')} state={state} connected={connected}/>;
 return <><div className="homer-task-status"><Popover open={!wide&&popupOpen} onOpenChange={value=>{if(!wide)setPopupOpen(value);}}><PopoverTrigger asChild>
  <button id="task-status-trigger" type="button" className={ghostButton+' status-entry'} aria-label={title} title={title} aria-expanded={open} aria-controls="task-status-panel" aria-haspopup={wide?undefined:'dialog'} onClick={wide?togglePinned:undefined}>
   <span className="status-entry-icon" aria-hidden="true">
    <ListTodoIcon size={18}/>
   </span>
  </button>
  </PopoverTrigger>
  {!wide&&<PopoverContent id="task-status-panel" className="homer-task-status status-popover w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-3 shadow-none motion-reduce:animate-none" align="end" side="bottom" sideOffset={12} collisionPadding={12} aria-label="工作状态卡片" aria-describedby={undefined} onEscapeKeyDown={event=>event.stopPropagation()}>{content}</PopoverContent>}
 </Popover></div>
 {wide&&pinned&&asideContainer&&createPortal(<aside id="task-status-panel" className="homer-task-status status-aside" aria-label="工作状态卡片">{content}</aside>,asideContainer)}</>;
}
