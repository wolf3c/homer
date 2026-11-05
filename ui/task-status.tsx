import {type ComponentProps,type ReactNode,createContext,useContext,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ListTodoIcon,ChevronRightIcon,XIcon} from 'lucide-react';
import {Collapsible} from '@base-ui/react/collapsible';
import {Toggle} from '@base-ui/react/toggle';
import type {WebState} from '../src/web-contract';
import type {OverviewTask,OverviewWorker} from '../src/task-overview';
import {taskName,validPendingUsers,pendingUserCount} from '../src/task-presentation';
import {taskCardPresentation,taskOwnerLabels,statusTree,statusCountSnapshot,rankedStatusMatters,statusVisibleLimit,matterStatus,progressMatches,linearPlanIndex,type StatusFilter,type StatusMatter,type StatusWorker,type WorkerProgress,type TaskProgress} from '../src/task-status';
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
function Pending({worker,state,onVisit}:{worker:OverviewWorker;state:WebState;onVisit:(worker:OverviewWorker,id:string,after:number)=>void}){
 const disabled=useContext(PendingDisabled);
 return <>{pendingUserCount(worker)>validPendingUsers(worker).length&&<p>有待处理请求，但当前记录未提供完整定位信息，请在主对话核对。</p>}{validPendingUsers(worker).map(q=><div key={q.id} className="status-pending"><p>{state.interactions.find(i=>i.id===q.id&&i.runId===worker.run.id)?.question??'有一项请求需要你处理，请在原待答卡核对。'}</p><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={disabled} onClick={()=>onVisit(worker,q.id,q.after)}>前往原待答卡</button></div>)}</>;
}
function rowId(task:OverviewTask,worker?:OverviewWorker){return worker?task.id+'/worker/'+worker.id:task.id;}
function workerKey(worker:OverviewWorker){const r=worker.run;return [worker.id,r.id,r.version,r.epoch,r.threadId,r.turnId].join(':');}
function rowKey(task:OverviewTask,worker?:OverviewWorker){return worker?workerKey(worker):task.id+':'+task.headVersion;}
function TaskStatusRow({task,worker,label,status,onOpenChange,children,...props}:Omit<ComponentProps<'div'>,'children'> & {task:OverviewTask;worker?:OverviewWorker;label:string;status:ReturnType<typeof taskCardPresentation>;onOpenChange:(open:boolean)=>void;children:ReactNode}){
 const open=useContext(Disclosures).get(rowId(task,worker))===rowKey(task,worker),presentation=status;
 return <Collapsible.Root open={open} onOpenChange={onOpenChange} data-slot="task-status-row" data-state={status.state} data-attention={presentation.attention} {...props}>
  <Collapsible.Trigger className="status-row-trigger flex w-full items-center gap-2.5 rounded-xl px-1.5 py-2 text-start transition-colors hover:bg-foreground/[0.04]" title={label+' · '+status.label}>
   <span className="flex size-3.5 shrink-0 items-center justify-center"><SemanticTaskIcon icon={presentation.icon}/></span>
   <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-[13px]">{label}</span><span className={cn(mono,'truncate text-muted-foreground')}>{status.label}</span></span>
   <ChevronRightIcon aria-hidden="true" className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',open&&'rotate-90')}/>
  </Collapsible.Trigger>
  <Collapsible.Panel>{open&&<div className="status-row-body"><div className="status-row-heading"><p>{label}</p><p className="text-muted-foreground">{status.label}</p></div>{children}{worker&&<TaskExecutionRecord task={task} worker={worker}/>}</div>}</Collapsible.Panel>
 </Collapsible.Root>;
}
function MatterFacts({task}:{task:OverviewTask}){
 return <>{task.goal&&<p className="status-output">目标：{task.goal}</p>}{task.notes&&<p className="status-output">工作笔记：{task.notes}</p>}{task.results.length>0&&<p>已采纳 {task.results.length} 份正式成果</p>}{task.deliveries.map(d=><p key={d.id}>版本 {d.version} 交付记录：{d.state==='recorded'?'渠道已确认':d.state==='prepared'?'已准备，待发送':d.state==='submitting'?'正在发送':'发送结果待核实'}</p>)}</>;
}
function WorkerView({node,title,reads,state,onExpand,onVisit}:{node:StatusWorker;title?:string;reads:ReadMap;state:WebState;onExpand:(task:OverviewTask,open:boolean,worker?:OverviewWorker)=>void;onVisit:(worker:OverviewWorker,id:string,after:number)=>void}){
 const {task,worker}=node,read=reads[task.id],candidate=read?.workers?.get(worker.run.id),progress=candidate&&progressMatches(worker,candidate)?candidate:undefined;
 const linear=progress?.plan?linearPlanIndex(progress.plan):null;
 const ownStatus=taskCardPresentation(task,worker),status=title?taskCardPresentation(task):ownStatus;
 const ended=worker.run.phase==='ended';
 const output=ended&&progress?.output?.type==='tool'?undefined:progress?.output;
 const label=title??(worker.title?.trim()||'Worker');
 return <div data-worker-id={worker.id} data-merged={title?'true':undefined} className="flex flex-col gap-3">
  <TaskStatusRow task={task} worker={worker} {...(title?{role:'group','aria-label':title,'data-item-row':'true'}:{})} label={label} status={status} onOpenChange={open=>onExpand(task,open,worker)}>
   {title&&<MatterFacts task={task}/>}<p>下一步处理：{taskOwnerLabels[status.owner]}</p>
   {title&&<p>Worker 本轮：{ownStatus.label}</p>}
   <Pending worker={worker} state={state} onVisit={onVisit}/>
   {read?.loading&&!progress?<p role="status">正在读取公开进展…</p>:read?.error?<p role="status">{read.error}</p>:null}
   {!!progress?.plan?.length&&(linear!==null?<AgentPlan title="计划" steps={progress.plan.map((s,i)=>({id:String(i),label:s.step}))} activeIndex={linear}/>:<TodoList title="计划" items={progress.plan.map((s,i)=>({id:String(i),text:s.step,status:s.status==='completed'?'done':s.status==='inProgress'?'active':'pending'}))}/>)}
   {output&&<p className="status-output">{output.type==='tool'?'工具调用：':''}{output.text}</p>}
   {!progress?.plan?.length&&!output&&!ended&&!read?.loading&&!read?.error&&<p>尚无可确认的公开进展。</p>}
   {!!progress?.next?.length&&<TodoList title="后续待办" items={progress.next.map(item=>({...item,status:'pending'}))}/>}
  </TaskStatusRow>
 </div>;
}
function MatterView({matter,...props}:{matter:StatusMatter}&Omit<ComponentProps<typeof WorkerView>,'node'|'title'>){
 const task=matter.task,title=taskName(task).text,status=matterStatus(matter);
 if(matter.workers.length===1)return <WorkerView key={matter.workers[0]!.worker.id} node={matter.workers[0]!} title={title} {...props}/>;
 return <TaskStatusRow task={task} role="group" aria-label={title} data-item-row="true" label={title} status={status} onOpenChange={open=>props.onExpand(task,open)}>
  <MatterFacts task={task}/>
  {!!matter.workers.length&&<div className="flex flex-col gap-1" aria-label={title+'的 Worker'}>{matter.workers.map(node=><WorkerView key={node.worker.id} node={node} {...props}/>)}</div>}
 </TaskStatusRow>;
}
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
   members.set(t.id,t.workers.map(workerKey));
   children.set(t.id,t.workers.map(w=>rowId(t,w)));
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
   if(value.taskId!==id)throw Error();setReads(old=>({...old,[id]:{signature:sig,workers:new Map(value.workers.map(p=>[p.runId,p]))}}));
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
 useEffect(()=>{if(!open)return;const visible=new Set(ranked.slice(0,effectiveLimit).map(r=>r.key.id));for(const task of data?.tasks??[])if(visible.has(task.id)&&task.workers.some(w=>expanded.get(rowId(task,w))===workerKey(w)))void load(task.id);},[data,ranked,effectiveLimit,open,connected,load,expanded]);
 useEffect(()=>{if(!open){for(const c of controllers.current.values())c.abort();controllers.current.clear();setReads(old=>Object.fromEntries(Object.entries(old).map(([id,read])=>[id,read.loading?{...read,signature:'',loading:false}:read])));navigation.current?.abort();setNavigating(false);setNavigationError('');}else refresh(true);},[open,refresh]);
 useEffect(()=>()=>{for(const c of controllers.current.values())c.abort();navigation.current?.abort();},[]);
 useLayoutEffect(()=>{
  for(const c of controllers.current.values())c.abort();controllers.current.clear();navigation.current?.abort();
  setPopupOpen(false);setReads({});setNavigating(false);setNavigationError('');setVisibleCount(20);setFilter(null);setExpanded(new Map());Object.assign(listPosition.current,{scrollTop:0,anchorId:'',focus:null,focusRootId:'',pending:false,generation:0});
 },[state.threadId,state.history?.readEpoch]);
 const onExpand=useCallback((task:OverviewTask,value:boolean,worker?:OverviewWorker)=>{
  const id=rowId(task,worker),key=rowKey(task,worker);
  setExpanded(old=>{
   const next=new Map(old);
   if(!value||next.get(id)!==key){
    next.delete(id);
    if(!worker)for(const child of snapshotRef.current.children.get(task.id)??[])next.delete(child);
   }
   if(value)next.set(id,key);
   return next;
  });
  if(value&&worker)void load(task.id,true);
 },[load]);
 async function visit(worker:OverviewWorker,id:string,after:number){
  if(navigating||stale)return;const controller=new AbortController();navigation.current=controller;setNavigating(true);setNavigationError('');
  const timeout=setTimeout(()=>controller.abort('task_status_timeout'),15000);
  try{const response=await connectionFetch('/api/tasks',{signal:controller.signal});if(!response.ok)throw Error();const current=await response.json();
   if(controller.signal.aborted||!openRef.current||!connectedRef.current)return;
   const task=current.tasks.find((t:OverviewTask)=>t.id===worker.taskId);const target=task?.workers.find((w:OverviewWorker)=>w.id===worker.id&&workerKey(w)===workerKey(worker));if(!target||!validPendingUsers(target).some(q=>q.id===id&&q.after===after))throw Error();
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
