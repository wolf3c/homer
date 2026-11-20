import {type ComponentProps,type ReactNode,createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ListTodoIcon,ChevronRightIcon} from 'lucide-react';
import {Collapsible} from '@base-ui/react/collapsible';
import type {WebState,WebArtifact} from '../src/web-contract';
import type {OverviewPage,OverviewTask,OverviewWorker,TaskDetail} from '../src/task-overview';
import {taskName} from '../src/task-presentation';
import {taskCardPresentation,statusTree,rankedStatusMatters,matterStatus,type StatusMatter,type StatusWorker} from '../src/task-status';
import {useTaskStatusData} from './task-status-data';
import {connectionFetch} from './web-connection-client';
import {TaskExecutionRecord,ExecutionObservationContext} from './task-execution-record';
import {FileList} from './file-list';
import {SemanticTaskIcon} from './process-nodes';
import {cn} from './vendor/task-status/utils';
import {Popover,PopoverTrigger,PopoverContent} from './vendor/task-status/popover';
import {ghostButton,mono} from './vendor/task-status/surfaces';
import {createPortal} from 'react-dom';
import './vendor/task-status/components.css';
import './task-status.css';
function workerKey(worker:OverviewWorker){const r=worker.run;return [worker.id,r.id,r.version,r.epoch,r.threadId,r.turnId].join(':');}
function TaskStatusRow({task,worker,label,status,children,...props}:Omit<ComponentProps<'div'>,'children'> & {task:OverviewTask;worker?:OverviewWorker;label:string;status:ReturnType<typeof taskCardPresentation>;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <Collapsible.Root open={open} onOpenChange={setOpen} data-slot="task-status-row" data-state={status.state} {...props}>
  <Collapsible.Trigger className="status-row-trigger flex w-full items-center gap-2.5 rounded-xl px-1.5 py-2 text-start transition-colors hover:bg-foreground/[0.04]" title={status.label?label+' · '+status.label:label}>
   {status.label&&<span className="flex size-3.5 shrink-0 items-center justify-center"><SemanticTaskIcon icon={status.icon}/></span>}
   <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-[13px]">{label}</span>{status.label&&<span className={cn(mono,'truncate text-muted-foreground')}>{status.label}</span>}</span>
   <ChevronRightIcon aria-hidden="true" className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',open&&'rotate-90')}/>
  </Collapsible.Trigger>
  <Collapsible.Panel>{open&&<div className="status-row-body"><div className="status-row-heading"><p>{label}</p>{status.label&&<p className="text-muted-foreground">{status.label}</p>}</div>{children}{worker&&<TaskExecutionRecord task={task} worker={worker}/>}</div>}</Collapsible.Panel>
 </Collapsible.Root>;
}
type HistoryActions={openFile?:(file:WebArtifact,trigger:HTMLButtonElement)=>void;locateMessage?:(id:string)=>void};
const HistoryNavigation=createContext<HistoryActions>({});
function MatterRecords({task}:{task:OverviewTask}){
 const [detail,setDetail]=useState<TaskDetail|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 const {openFile,locateMessage}=useContext(HistoryNavigation),observation=useContext(ExecutionObservationContext);
 useEffect(()=>{
  if(!observation.connected)return;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort('timeout'),15000);setError(false);
  void observation.read('/api/tasks/'+task.id, {signal:controller.signal}).then(async res=>{
   if(!res.ok)throw Error();const result:TaskDetail=await res.json();if(result.taskId!==task.id)throw Error();
   if(!controller.signal.aborted)setDetail(result);
  }).catch(()=>{if(!controller.signal.aborted||controller.signal.reason==='timeout')setError(true);}).finally(()=>clearTimeout(timeout));
  return()=>{clearTimeout(timeout);controller.abort();};
 },[observation.connected,observation.read,task.id,task.revision,attempt]);
 return <>{error?<p role="status">事项记录读取失败。<button type="button" onClick={()=>setAttempt(n=>n+1)}>重试</button></p>:!detail?<p role="status">{observation.connected?'正在读取事项记录…':'等待连接后读取事项记录。'}</p>:<>
  {(detail.requirements?.length??0)>1&&<details><summary>要求记录</summary>{detail.requirements?.map(r=><p key={r.version}>版本 {r.version} · {r.goal}</p>)}</details>}
  {!!detail.recovery?.operations.some(op=>op.state==='uncertain')&&<details><summary>待核实的操作</summary>{detail.recovery.operations.filter(op=>op.state==='uncertain').map(op=><p key={op.id}>{op.kind} · {op.id}</p>)}</details>}
  {!!detail.recovery?.receipts.length&&<details><summary>待核实的回执</summary>{detail.recovery.receipts.map(r=><p key={r.messageId}>版本 {r.taskVersion} · 回执待核实 · {r.messageId}</p>)}</details>}
  {!!detail.publicMessages?.length&&locateMessage&&<details><summary>交办与答复原文</summary>{detail.publicMessages.map(m=><p key={m.id}><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>locateMessage(m.id)}>{m.role==='user'?'原交办':'Homer 答复'} · {m.excerpt||'查看消息'}</button></p>)}</details>}
  {!!detail.artifacts?.length&&openFile&&<FileList files={detail.artifacts} label="事项成果文件" controlsId="canvas-panel" onOpen={openFile}/>}
  {(detail.moreHistory||detail.moreArtifacts||detail.moreMessages)&&<p>仅显示最近 80 条记录。</p>}
 </>}</>;
}
function MatterFacts({task}:{task:OverviewTask}){
 return <>{task.historyState==='visible'&&task.state==='paused'&&<p>已暂停</p>}{task.goal&&<p className="status-output">目标：{task.goal}</p>}{task.notes&&<p className="status-output">工作笔记：{task.notes}</p>}{(task.historyState==='archived'||!!task.uncertainOperation||!!task.uncertainReceipt)&&<MatterRecords task={task}/>}</>;
}
function WorkerView({node,title}:{node:StatusWorker;title?:string}){
 const {task,worker}=node;
 const ownStatus=taskCardPresentation(task,worker),status=title?taskCardPresentation(task):ownStatus;
 const label=title??(worker.title?.trim()||'Worker');
 return <div data-worker-id={worker.id} data-merged={title?'true':undefined} className="flex flex-col gap-3">
  <TaskStatusRow task={task} worker={worker} {...(title?{role:'group','aria-label':title,'data-item-row':'true'}:{})} label={label} status={status}>
   {title&&<MatterFacts task={task}/>}
   {title&&<p>Worker 本轮：{ownStatus.label}</p>}
  </TaskStatusRow>
 </div>;
}
function MatterView({matter}:{matter:StatusMatter}){
 const task=matter.task,title=taskName(task).text,status=matterStatus(matter);
 if(matter.workers.length===1)return <WorkerView key={workerKey(matter.workers[0]!.worker)} node={matter.workers[0]!} title={title}/>;
 return <TaskStatusRow task={task} role="group" aria-label={title} data-item-row="true" label={title} status={status}>
  <MatterFacts task={task}/>
  {!!matter.workers.length&&<div className="flex flex-col gap-1" aria-label={title+'的 Worker'}>{matter.workers.map(node=><WorkerView key={workerKey(node.worker)} node={node}/>)}</div>}
 </TaskStatusRow>;
}
type ListProps={state:WebState;connected:boolean};
function TaskPage({state,connected,view}:ListProps & {view:NonNullable<OverviewPage['view']>}){
 const [pages,setPages]=useState<number[]>([]);
 const section=useRef<HTMLElement>(null);
 const anchor=useRef<{id:string;top:number;scrollTop:number;focus:HTMLElement|null}|null>(null);
 const before=pages.at(-1),archived=view==='archived';
 const path=!archived&&!before?'/api/tasks':`/api/tasks/list/${view}${before?'/before/'+before:''}`;
 const {data,error,busy,stale,refresh}=useTaskStatusData(state,connected,path,()=>{
  const list=section.current?.closest('.status-list');if(!list)return;
  const top=list.getBoundingClientRect().top;
  const row=Array.from(list.querySelectorAll<HTMLElement>('[data-todo-id]')).find(row=>row.getBoundingClientRect().bottom>top);
  anchor.current=row&&section.current?.contains(row)?{id:row.dataset.todoId!,top:row.getBoundingClientRect().top,scrollTop:list.scrollTop,focus:row.contains(document.activeElement)?document.activeElement as HTMLElement:null}:null;
 });
 const matters=useMemo(()=>rankedStatusMatters(statusTree(data?.tasks??[],view)),[data,view]);
 useLayoutEffect(()=>{
  const saved=anchor.current;anchor.current=null;
  const list=section.current?.closest('.status-list');if(!saved||!list||list.scrollTop!==saved.scrollTop)return;
  const row=Array.from(section.current!.querySelectorAll<HTMLElement>('[data-todo-id]')).find(r=>r.dataset.todoId===saved.id);
  if(row)list.scrollTop+=row.getBoundingClientRect().top-saved.top;
  if(saved.focus&&!saved.focus.isConnected&&document.activeElement===document.body)(row?.querySelector<HTMLElement>('.status-row-trigger')??section.current)?.focus({preventScroll:true});
 },[data]);
 function changePage(next:number[]){
  setPages(next);
  section.current?.focus({preventScroll:true});
  section.current?.scrollIntoView({block:'nearest'});
 }
 return <section ref={section} tabIndex={-1} aria-label={archived?'已归档事项':'当前事项'}>
  {(error||stale&&data)&&<div role="status">{error||'连接尚未确认。'}{data?' 显示上次记录。':''}{error&&<button type="button" className={ghostButton} disabled={busy||!connected} onClick={()=>refresh(true)}>重试</button>}</div>}
  {!data&&!error&&<p role="status">{connected?'正在读取事项记录…':'等待连接后读取事项记录。'}</p>}
  {data&&!matters.length&&<p>{archived?'暂无已归档事项。':'暂无当前事项。'}</p>}
  <ExecutionObservationContext.Provider value={{connected:connected&&!stale,scope:state.threadId+':'+(state.history?.readEpoch??'legacy'),read:connectionFetch}}>
   <div className="flex flex-col gap-1">{matters.map(({matter})=><section key={matter.task.id+':'+matter.task.headVersion} data-todo-id={matter.task.id} aria-label={taskName(matter.task).text}><MatterView matter={matter}/></section>)}</div>
  </ExecutionObservationContext.Provider>
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
   <Collapsible.Trigger className={ghostButton+' min-h-11 gap-1 px-2 text-xs'}><ChevronRightIcon aria-hidden="true" className={cn('size-3',archived&&'rotate-90')}/>已归档</Collapsible.Trigger>
   <Collapsible.Panel>{archived&&<TaskPage {...props} view="archived"/>}</Collapsible.Panel>
  </Collapsible.Root>
 </div>;
}
export function TaskStatusPopover({state,connected,asideContainer,onBeforeLayoutChange,openFile,locateMessage}:ListProps & {asideContainer:HTMLElement|null;onBeforeLayoutChange:()=>void} & HistoryActions){
 const [wide,setWide]=useState(false),[pinned,setPinned]=useState(true),[popupOpen,setPopupOpen]=useState(false);
 const open=wide?pinned:popupOpen;
 const setOpen=(value:boolean)=>{if(wide){onBeforeLayoutChange();setPinned(value);}else setPopupOpen(value);};
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
 const content=<HistoryNavigation.Provider value={{openFile:openFile&&((file,trigger)=>{if(!wide)setOpen(false);openFile(file,trigger);}),locateMessage:locateMessage&&(id=>{if(!wide)setOpen(false);locateMessage(id);})}}>
  <TaskList key={state.threadId+':'+(state.history?.readEpoch??'legacy')} state={state} connected={connected}/>
 </HistoryNavigation.Provider>;
 return <><div className="homer-task-status"><Popover open={!wide&&popupOpen} onOpenChange={value=>{if(!wide)setPopupOpen(value);}}><PopoverTrigger asChild>
  <button id="task-status-trigger" type="button" className={ghostButton+' status-entry'} aria-label={title} title={title} aria-expanded={open} aria-controls="task-status-panel" aria-haspopup={wide?undefined:'dialog'} onClick={wide?()=>setOpen(!open):undefined}>
   <span className="status-entry-icon" aria-hidden="true">
    <ListTodoIcon size={18}/>
   </span>
  </button>
  </PopoverTrigger>
  {!wide&&<PopoverContent id="task-status-panel" className="homer-task-status status-popover w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-3 shadow-none motion-reduce:animate-none" align="end" side="bottom" sideOffset={12} collisionPadding={12} aria-label="工作状态卡片" aria-describedby={undefined} onEscapeKeyDown={event=>event.stopPropagation()}>{content}</PopoverContent>}
 </Popover></div>
 {wide&&pinned&&asideContainer&&createPortal(<aside id="task-status-panel" className="homer-task-status status-aside" aria-label="工作状态卡片">{content}</aside>,asideContainer)}</>;
}
