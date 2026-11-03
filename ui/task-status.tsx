import {type ComponentProps,type ReactNode,createContext,useContext,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ListTodoIcon,ChevronRightIcon,XIcon} from 'lucide-react';
import {Collapsible} from '@base-ui/react/collapsible';
import {Toggle} from '@base-ui/react/toggle';
import type {WebState} from '../src/web-contract';
import type {OverviewTask} from '../src/task-overview';
import {taskName,validPendingUsers,pendingUserCount} from '../src/task-presentation';
import {taskCardPresentation,taskOwnerLabels,taskUpdateLabels,statusTree,statusCountSnapshot,rankedStatusMatters,statusVisibleLimit,matterStatus,workerStatus,progressMatches,linearPlanIndex,type StatusFilter,type StatusMatter,type StatusWorker,type WorkerProgress,type TaskProgress} from '../src/task-status';
import {useTaskStatusData} from './task-status-data';
import {connectionFetch} from './web-connection-client';
import {TaskExecutionRecord,ExecutionObservationContext} from './task-execution-record';
import {SemanticTaskIcon} from './process-nodes';
import {cn} from './vendor/task-status/utils';
import {AgentPlan} from './vendor/task-status/agent-plan';
import {TodoList} from './vendor/task-status/todo-list';
import {Popover,PopoverTrigger,PopoverContent} from './vendor/task-status/popover';
import {ghostButton,mono} from './vendor/task-status/surfaces';
import {createPortal} from 'react-dom';
import './vendor/task-status/components.css';
import './task-status.css';
type ProgressRead={signature:string;workers?:Map<string,WorkerProgress>;error?:string;loading?:boolean;unavailable?:boolean};
type ReadMap=Record<string,ProgressRead>;
const PendingDisabled=createContext(false);
// One disclosure owner survives presentation changes; keys retain execution identity.
const Disclosures=createContext(new Map<string,string>());
function Pending({task,state,onVisit}:{task:OverviewTask;state:WebState;onVisit:(task:OverviewTask,id:string,after:number)=>void}){
 const disabled=useContext(PendingDisabled);
 return <>{pendingUserCount(task)>validPendingUsers(task).length&&<p>有待处理请求，但当前记录未提供完整定位信息，请在主对话核对。</p>}{validPendingUsers(task).map(q=><div key={q.id} className="status-pending"><p>{state.interactions.find(i=>i.id===q.id&&i.runId===task.currentRunId)?.question??'有一项请求需要你处理，请在原待答卡核对。'}</p><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={disabled} onClick={()=>onVisit(task,q.id,q.after)}>前往原待答卡</button></div>)}</>;
}


function TaskStatusRow({task,label,status,onOpenChange,children,...props}:Omit<ComponentProps<'div'>,'children'> & {task:OverviewTask;label:string;status:ReturnType<typeof workerStatus>;onOpenChange:(open:boolean)=>void;children:ReactNode}){
 const open=useContext(Disclosures).get(task.id)===workerKey(task),presentation=taskCardPresentation(task);
 return <Collapsible.Root open={open} onOpenChange={onOpenChange} data-slot="task-status-row" data-state={status.state} data-attention={presentation.attention} {...props}>
  <Collapsible.Trigger className="status-row-trigger flex w-full items-center gap-2.5 rounded-xl px-1.5 py-2 text-start transition-colors hover:bg-foreground/[0.04]" title={label+' · '+status.label}>
   <span className="flex size-3.5 shrink-0 items-center justify-center"><SemanticTaskIcon icon={presentation.icon}/></span>
   <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-[13px]">{label}</span><span className={cn(mono,'truncate text-muted-foreground')}>{status.label}</span></span>
   <ChevronRightIcon aria-hidden="true" className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',open&&'rotate-90')}/>
  </Collapsible.Trigger>
  <Collapsible.Panel>{open&&<div className="status-row-body"><div className="status-row-heading"><p>{label}</p><p className="text-muted-foreground">{status.label}</p></div>{children}<TaskExecutionRecord key={task.id+':'+task.headVersion+':'+task.currentRunId} task={task}/></div>}</Collapsible.Panel>
 </Collapsible.Root>;
}
function WorkerView({node,title,matter,reads,state,onExpand,onVisit}:{node:StatusWorker;title?:string;matter?:OverviewTask;reads:ReadMap;state:WebState;onExpand:(task:OverviewTask,open:boolean)=>void;onVisit:(task:OverviewTask,id:string,after:number)=>void}){
 const task=node.task,read=reads[task.rootTaskId],candidate=read?.workers?.get(task.id),progress=candidate&&progressMatches(task,candidate)?candidate:undefined;
 const linear=progress?.plan?linearPlanIndex(progress.plan):null;
 const matterNotice=matter&&matter.id!==task.id&&(matter.controlState!=='normal'||matter.state==='recovery'||matter.run?.phase==='uncertain')?workerStatus(matter).label:undefined;
 const ownStatus=taskCardPresentation(task),status=matterNotice?taskCardPresentation(matter!):ownStatus;
 const ended=task.run?.phase==='ended'&&(ownStatus.state==='done'||ownStatus.state==='failed'||ownStatus.state==='cancelled');
 const output=ended&&progress?.output?.type==='tool'?undefined:progress?.output;
 const content=<>
  <p>下一步处理：{taskOwnerLabels[ownStatus.owner]}</p>
  {!!task.updates?.length&&<ul className="task-update-summary">{task.updates.map(u=><li key={u.operationKey}>版本 {u.version}：{taskUpdateLabels[u.stage]}</li>)}</ul>}
  {task.moreUpdates&&<p>另有调整记录，可在原事项详情核对。</p>}
  {matterNotice&&<p>事项：{matterNotice}</p>}
  {matter&&matter.id!==task.id&&<Pending task={matter} state={state} onVisit={onVisit}/>}
  <Pending task={task} state={state} onVisit={onVisit}/>
  {read?.loading&&!progress?<p role="status">正在读取公开进展…</p>:read?.error?<p role="status">{read.error}</p>:null}
  {!!progress?.plan?.length&&(linear!==null?<AgentPlan title="计划" steps={progress.plan.map((s,i)=>({id:String(i),label:s.step}))} activeIndex={linear}/>:<TodoList title="计划" items={progress.plan.map((s,i)=>({id:String(i),text:s.step,status:s.status==='completed'?'done':s.status==='inProgress'?'active':'pending'}))}/>)}
  {output&&<p className="status-output">{output.type==='tool'?'工具调用：':''}{output.text}</p>}
  {!progress?.plan?.length&&!output&&(task.run?.summary?<p className="status-output">已记录说明（非实时进展）：{task.run.summary}</p>:!ended&&!read?.loading&&!read?.error?<p>尚无可确认的公开进展。</p>:null)}
  {!!progress?.next?.length&&<TodoList title="后续待办" items={progress.next.map(item=>({...item,status:'pending'}))}/>}
 </>;
 return <div data-worker-id={task.id} data-merged={title?'true':undefined} className="flex flex-col gap-3">
  <TaskStatusRow task={task} {...(matter?{role:'group','aria-label':title??taskName(task).text,'data-item-row':'true'}:{})} label={title??taskName(task).text} status={status} onOpenChange={open=>onExpand(task,open)}>{content}</TaskStatusRow>
 </div>;
}
function MatterView({matter,...props}:{matter:StatusMatter}&Omit<ComponentProps<typeof WorkerView>,'node'|'title'|'matter'>){
 const task=matter.task,title=taskName(task).text,status=matterStatus(matter);
 if(matter.workers.length===1)return <WorkerView key={workerKey(matter.workers[0]!.task)} node={matter.workers[0]!} title={title} matter={task} {...props}/>;
 return <TaskStatusRow task={task} role="group" aria-label={title} data-item-row="true" label={title} status={status} onOpenChange={open=>props.onExpand(task,open)}>
  <Pending task={task} state={props.state} onVisit={props.onVisit}/>
  {matter.workers.length?<div className="flex flex-col gap-1" aria-label={title+'的 Worker'}>{matter.workers.map(node=><WorkerView key={workerKey(node.task)} node={node} {...props}/>)}</div>:task.run?.summary?<p className="status-output">已记录说明（非实时进展）：{task.run.summary}</p>:null}
 </TaskStatusRow>;
}
function workerKey(t:OverviewTask){return t.id+':'+t.headVersion+':'+(t.currentRunId??'none')+':'+(t.run?.epoch??'none')+':'+(t.run?.threadId??'none')+':'+(t.run?.turnId??'none');}
export function TaskStatusPopover({state,connected,onInteraction,asideContainer,onBeforeLayoutChange}:{state:WebState;connected:boolean;onInteraction:(id:string,after?:number)=>void|boolean|Promise<void|boolean>;asideContainer:HTMLElement|null;onBeforeLayoutChange:()=>void}){
 const [wide,setWide]=useState(false),[pinned,setPinned]=useState(true),[popupOpen,setPopupOpen]=useState(false);
 const open=wide?pinned:popupOpen;
 const setOpen=(value:boolean)=>{if(wide){onBeforeLayoutChange();setPinned(value);}else setPopupOpen(value);};
 const beforeLayout=useRef(onBeforeLayoutChange),wideRef=useRef(wide);beforeLayout.current=onBeforeLayoutChange;wideRef.current=wide;
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
 const [expanded,setExpanded]=useState(new Map<string,string>());
 const listPosition=useRef({node:null as HTMLDivElement|null,scrollTop:0,anchorId:'',offset:0,focus:null as HTMLElement|null,focusRootId:'',generation:0,capturedGeneration:0,pending:false});
 const restoreList=useCallback((node:HTMLDivElement|null)=>{listPosition.current.node=node;if(node)node.scrollTop=listPosition.current.scrollTop;},[]);
 const captureListAnchor=useCallback(()=>{
  const saved=listPosition.current,node=saved.node;if(!node)return;
  const top=node.getBoundingClientRect().top;
  const anchor=[...node.querySelectorAll<HTMLElement>('[data-todo-id]')].find(row=>row.getBoundingClientRect().bottom>top);
  const focus=document.activeElement instanceof HTMLElement&&node.contains(document.activeElement)?document.activeElement:null;
  Object.assign(saved,{scrollTop:node.scrollTop,anchorId:anchor?.dataset.todoId??'',offset:anchor?anchor.getBoundingClientRect().top-top:0,focus,focusRootId:focus?.closest<HTMLElement>('[data-todo-id]')?.dataset.todoId??'',capturedGeneration:saved.generation,pending:true});
 },[]);
 const [reads,setReads]=useState<ReadMap>({}),[navigationError,setNavigationError]=useState(''),[navigating,setNavigating]=useState(false),[visibleCount,setVisibleCount]=useState(20),[filter,setFilter]=useState<StatusFilter|null>(null);
 const {data,error,busy,stale,refresh}=useTaskStatusData(state,connected,captureListAnchor);
 // Build once per snapshot. Chat streaming and individual card toggles do not
 // repeatedly rebuild the hierarchy or rescan every task during sorting.
 const snapshot=useMemo(()=>{
  const tasks=data?.tasks??[],matters=statusTree(tasks);
  const members=new Map<string,string[]>(),children=new Map<string,string[]>();
  for(const t of tasks){
   const group=members.get(t.rootTaskId)??[];group.push(workerKey(t));members.set(t.rootTaskId,group);
   if(t.parentTaskId){const group=children.get(t.parentTaskId)??[];group.push(t.id);children.set(t.parentTaskId,group);}
  }
  const ranked=rankedStatusMatters(matters),contributions=statusCountSnapshot(tasks,matters);
  return {ranked,workingKnown:contributions.workingKnown,counts:data?contributions.counts:null,matches:contributions.matches,children,
   signatures:new Map([...members].map(([id,keys])=>[id,(data?.progressRevision??0)+':'+keys.join('|')]))};
 },[data]);
 const counts=snapshot.counts;
 const ranked=useMemo(()=>filter?snapshot.ranked.filter(r=>snapshot.matches[filter].has(r.key.id)):snapshot.ranked,[snapshot,filter]);
 // Retention can extend only the matching prefix, never reinsert a filtered root.
 const effectiveLimit=useMemo(()=>statusVisibleLimit(ranked,visibleCount,[listPosition.current.anchorId,listPosition.current.focusRootId]),[ranked,visibleCount,listPosition.current.anchorId,listPosition.current.focusRootId]);
 const matters=ranked.map(r=>r.matter);
 useLayoutEffect(()=>{
  const saved=listPosition.current,node=saved.node;if(!open||!node||!saved.pending)return;
  saved.pending=false;if(saved.capturedGeneration!==saved.generation)return;
  const roots=[...node.querySelectorAll<HTMLElement>('[data-todo-id]')];
  const anchor=roots.find(row=>row.dataset.todoId===saved.anchorId);
  if(anchor)node.scrollTop+=anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-saved.offset;
  else node.scrollTop=saved.scrollTop;
  saved.scrollTop=node.scrollTop;
  if(saved.focus&&(document.activeElement===saved.focus||!saved.focus.isConnected&&(!document.activeElement||document.activeElement===document.body))){
   const target=saved.focus.isConnected?saved.focus:roots.find(row=>row.dataset.todoId===(saved.focusRootId||saved.anchorId))?.querySelector<HTMLElement>('.status-row-trigger')??node;
   if(document.activeElement!==target)target.focus({preventScroll:true});
  }
 },[snapshot,open,effectiveLimit]);
 const changeFilter=(next:StatusFilter|null)=>{
  setFilter(next);setVisibleCount(20);
  const saved=listPosition.current;
  Object.assign(saved,{scrollTop:0,anchorId:'',offset:0,focus:null,focusRootId:'',pending:false,generation:saved.generation+1});
  if(saved.node)saved.node.scrollTop=0;
 };
 const readRef=useRef(reads),controllers=useRef(new Map<string,AbortController>()),openRef=useRef(open),navigation=useRef<AbortController|null>(null),returnTarget=useRef<string|null>(null),connectedRef=useRef(connected),snapshotRef=useRef(snapshot);
 readRef.current=reads;openRef.current=open;connectedRef.current=connected;snapshotRef.current=snapshot;
 const signature=useCallback((id:string)=>snapshotRef.current.signatures.get(id)??'',[]);
 const load=useCallback(async(id:string,force=false)=>{
  if(!openRef.current||!connectedRef.current)return;const sig=signature(id),prior=readRef.current[id];
  if(!force&&prior?.signature===sig&&(prior.workers||prior.loading||prior.error||prior.unavailable))return;
  controllers.current.get(id)?.abort();const controller=new AbortController();controllers.current.set(id,controller);
  const timeout=setTimeout(()=>controller.abort('task_status_timeout'),15000);
  // Keep confirmed facts while refreshing; progressMatches still excludes every
  // old execution identity before any cached plan/output can be displayed.
  setReads(old=>({...old,[id]:{workers:old[id]?.workers,signature:sig,loading:true}}));
  try{const response=await connectionFetch('/api/tasks/'+encodeURIComponent(id)+'/progress',{signal:controller.signal});
   if([404,501].includes(response.status)){if(!controller.signal.aborted)setReads(old=>({...old,[id]:{signature:sig,unavailable:true}}));return;}
   if(!response.ok)throw Error();const value:TaskProgress=await response.json();if(controller.signal.aborted||!openRef.current||signature(id)!==sig)return;
   if(value.taskId!==id)throw Error();setReads(old=>({...old,[id]:{signature:sig,workers:new Map(value.workers.map(p=>[p.taskId,p]))}}));
  }catch{if((!controller.signal.aborted||controller.signal.reason==='task_status_timeout')&&openRef.current&&controllers.current.get(id)===controller&&signature(id)===sig)setReads(old=>({...old,[id]:{...(old[id]?.signature===sig?old[id]:{}),signature:sig,loading:false,error:'公开进展读取失败，可收起后重新展开重试。'}}));}
  finally{clearTimeout(timeout);if(controllers.current.get(id)===controller)controllers.current.delete(id);}
 },[signature]);
 useEffect(()=>{
  if(!connected){
   for(const c of controllers.current.values())c.abort();controllers.current.clear();
   navigation.current?.abort();setNavigating(false);
   // An aborted request cannot retain a loading/cache hit across reconnect.
   setReads(old=>Object.fromEntries(Object.entries(old).map(([id,read])=>[id,{...read,signature:'',loading:false,error:undefined}])));
  }
 },[connected]);
 useEffect(()=>{if(!open)return;const visible=new Set(ranked.slice(0,effectiveLimit).map(r=>r.key.id));for(const id of new Set(data?.tasks.filter(t=>visible.has(t.rootTaskId)&&t.executorKind==='worker'&&expanded.get(t.id)===workerKey(t)).map(t=>t.rootTaskId)))void load(id);},[data,ranked,effectiveLimit,open,connected,load,expanded]);
 useEffect(()=>{if(!open){for(const c of controllers.current.values())c.abort();controllers.current.clear();setReads(old=>Object.fromEntries(Object.entries(old).map(([id,read])=>[id,read.loading?{...read,signature:'',loading:false}:read])));navigation.current?.abort();setNavigating(false);setNavigationError('');}else refresh(true);},[open,refresh]);
 useEffect(()=>()=>{for(const c of controllers.current.values())c.abort();navigation.current?.abort();},[]);
 useLayoutEffect(()=>{
  for(const c of controllers.current.values())c.abort();controllers.current.clear();navigation.current?.abort();
  setPopupOpen(false);setReads({});setNavigating(false);setNavigationError('');setVisibleCount(20);setFilter(null);setExpanded(new Map());Object.assign(listPosition.current,{scrollTop:0,anchorId:'',focus:null,focusRootId:'',pending:false,generation:0});
 },[state.threadId,state.history?.readEpoch]);
 const onExpand=useCallback((task:OverviewTask,value:boolean)=>{
  setExpanded(old=>{
   const next=new Map(old);
   if(!value||next.get(task.id)!==workerKey(task)){
    next.delete(task.id);
    for(const child of snapshotRef.current.children.get(task.id)??[])next.delete(child);
   }
   if(value)next.set(task.id,workerKey(task));
   return next;
  });
  if(value&&task.executorKind==='worker')void load(task.rootTaskId,true);
 },[load]);
 async function visit(task:OverviewTask,id:string,after:number){
  if(navigating||stale)return;const controller=new AbortController();navigation.current=controller;setNavigating(true);setNavigationError('');
  const timeout=setTimeout(()=>controller.abort('task_status_timeout'),15000);
  try{const response=await connectionFetch('/api/tasks',{signal:controller.signal});if(!response.ok)throw Error();const current=await response.json();
   if(controller.signal.aborted||!openRef.current||!connectedRef.current)return;
   const target=current.tasks.find((t:OverviewTask)=>t.id===task.id&&workerKey(t)===workerKey(task));if(!target||!validPendingUsers(target).some(q=>q.id===id&&q.after===after))throw Error();
   const result=await onInteraction(id,after);if(controller.signal.aborted||!openRef.current||!connectedRef.current)return;if(result===false)throw Error();returnTarget.current='task-interaction-'+id;setOpen(false);if(wide){returnTarget.current=null;requestAnimationFrame(()=>{const target=document.getElementById('task-interaction-'+id);target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});});}
  }catch{if(!controller.signal.aborted||controller.signal.reason==='task_status_timeout')setNavigationError('这项待答已变化或暂不可读，请收起后重新打开工作状态核对。');}finally{clearTimeout(timeout);if(navigation.current===controller){navigation.current=null;setNavigating(false);}}
 }
 const close=()=>{setOpen(false);if(wide)document.getElementById('task-status-trigger')?.focus({preventScroll:true});};
 // A stale snapshot stays readable in the panel, never masquerades as a live badge.
 const currentWorking=counts&&snapshot.workingKnown&&!stale&&connected&&!error?counts.working:null;
 const title=currentWorking!==null?(currentWorking===0?'工作状态，无工作中任务':`工作状态，${currentWorking} 个任务工作中`):'工作状态，'+(!connected?'连接未确认':error?'读取失败':data?'数量待核实'+(stale?'，显示上次记录':''):'正在读取');
 const content=(
   <ExecutionObservationContext.Provider value={{connected:connected&&!stale,enabled:state.features?.workerExecution===1,revision:data?.progressRevision??0,scope:state.threadId+':'+(state.history?.readEpoch??'legacy'),read:connectionFetch}}><Disclosures.Provider value={expanded}><PendingDisabled.Provider value={stale||navigating}><div className="status-content-body flex flex-col gap-3">
    <div className="flex items-center justify-between gap-3"><h2 className="text-[13.5px] font-medium">工作状态</h2><button type="button" className={ghostButton+' size-11 shrink-0'} aria-label="收起工作状态" onClick={close}><XIcon className="size-4"/></button></div>
    <div id="task-status-summary" role="group" aria-label="按工作状态筛选" className="status-counts">{counts?(['working','done','needsUser'] as const).map(key=><Toggle key={key} pressed={filter===key} onPressedChange={pressed=>changeFilter(pressed?key:null)} aria-controls="task-status-filtered-list" aria-label={key==='working'&&!snapshot.workingKnown?'工作中数量待核实':(key==='working'?'工作中，':key==='done'?'执行完成，':'待你处理，')+counts[key]+(key==='needsUser'?' 项请求':key==='done'?' 个 Worker':' 个任务')} className="status-count-filter">{key==='working'?'工作中':key==='done'?'执行完成':'待你处理'} <span data-count={key==='needsUser'?'needs-user':key}>{key==='working'&&!snapshot.workingKnown?'待核实':counts[key]}</span></Toggle>):<p className={cn(mono,'text-muted-foreground')}>正在核对任务记录</p>}</div>
    {!!counts?.queued&&<p className="text-xs text-muted-foreground">排队 <span data-count="queued">{counts.queued}</span> 个任务</p>}
    {(stale&&data||error||navigationError)&&<div className="flex items-center gap-2"><p role="status" className="text-xs text-muted-foreground">{navigationError||error||'连接尚未确认。'}{data?' 显示上次记录。':''}</p>{error&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs shrink-0'} disabled={busy||!connected} onClick={()=>refresh(true)}>重试</button>}</div>}
    <div id="task-status-filtered-list" role="region" aria-label="已安排的待办事项" tabIndex={0} className="status-list" ref={restoreList} onScroll={event=>{listPosition.current.scrollTop=event.currentTarget.scrollTop;listPosition.current.generation++;}}>
     {!data?<p role="status">{error?'任务记录读取失败，请重试。':'正在读取任务记录…'}</p>:!matters.length?(filter?<p role="status">暂无匹配的事项。<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>changeFilter(null)}>查看全部</button></p>:<p>暂无已安排的事项。</p>):<div className="flex flex-col gap-1">{matters.slice(0,effectiveLimit).map(m=><section key={m.task.id} data-todo-id={m.task.id} aria-label={taskName(m.task).text}><MatterView matter={m} reads={reads} state={state} onExpand={onExpand} onVisit={(...args)=>void visit(...args)}/></section>)}{matters.length>effectiveLimit&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>setVisibleCount(effectiveLimit+20)}>显示更多事项（还有 {matters.length-effectiveLimit} 项）</button>}</div>}
    </div>
   </div></PendingDisabled.Provider></Disclosures.Provider></ExecutionObservationContext.Provider>
 );
 return <><div className="homer-task-status"><Popover open={!wide&&popupOpen} onOpenChange={value=>{if(!wide)setPopupOpen(value);}}><PopoverTrigger asChild>
  <button id="task-status-trigger" type="button" className={ghostButton+' status-entry'} aria-label={title} title={title} aria-expanded={open} aria-controls="task-status-panel" aria-haspopup={wide?undefined:'dialog'} onClick={wide?()=>setOpen(!open):undefined}><ListTodoIcon aria-hidden="true" size={18}/><span className="status-count-slot" aria-hidden="true">{currentWorking!==null&&currentWorking>0&&<span className="status-entry-count" data-digits={currentWorking>9?'multiple':undefined} data-count="working">{currentWorking>99?'99+':currentWorking}</span>}</span></button>
  </PopoverTrigger>
  {!wide&&<PopoverContent id="task-status-panel" className="homer-task-status status-popover w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-3 shadow-none motion-reduce:animate-none" align="end" side="bottom" sideOffset={12} collisionPadding={12} aria-label="工作状态卡片" aria-describedby="task-status-summary" onEscapeKeyDown={event=>event.stopPropagation()} onCloseAutoFocus={event=>{if(wideRef.current){event.preventDefault();return;}const id=returnTarget.current;returnTarget.current=null;if(id){event.preventDefault();requestAnimationFrame(()=>{const target=document.getElementById(id);target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});});}}}>{content}</PopoverContent>}
 </Popover></div>
 {wide&&pinned&&asideContainer&&createPortal(<aside id="task-status-panel" className="homer-task-status status-aside" aria-label="工作状态卡片" aria-describedby="task-status-summary">{content}</aside>,asideContainer)}</>;
}
