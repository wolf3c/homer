import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {Collapsible} from '@base-ui/react/collapsible';
import type {OverviewTask,OverviewWorker,OverviewRun,TaskDetail,WorkerConversation} from '../src/task-overview';
import type {WorkerCallSummary,WorkerCallDetail,WorkerExecutionPage} from '../src/worker-execution';
import {nativeLabels} from '../src/main-process';
import {RunActivity,type RunActivityStatus} from './vendor/assistant-ui/run-activity';
import {ToolCallBody} from './process-message';
import {ToolFallback} from './vendor/assistant-ui/tool-fallback.aui';
import {connectionFetch} from './web-connection-client';
import {ghostButton} from './vendor/task-status/surfaces';
export const ExecutionObservationContext=createContext({connected:true,enabled:false,revision:0,scope:'',read:connectionFetch});
const stamp=(n:number|null|undefined)=>n!=null&&Number.isFinite(n)?new Date(n).toLocaleString():undefined;
const seconds=(n:number)=>`${Math.floor(n/1000)} 秒`;
const states={running:'调用中',completed:'调用已返回',failed:'调用失败',declined:'调用被拒绝',interrupted:'调用已中断',unknown:'结束状态待核实'};
const runStates:Record<string,string>={queued:'等待执行',running:'运行中',returned:'执行已返回',succeeded:'执行成功',failed:'执行失败',cancelled:'执行已取消',interrupted:'执行已中断'};
const runPhases:Record<string,string>={ready:'等待启动',starting:'启动中',executing:'执行中',yielding:'交接中',held:'已暂缓',uncertain:'状态待核实',ended:'执行已结束'};
const status=(r:OverviewRun|undefined|null,connected:boolean):RunActivityStatus=>!r||!connected||r.phase==='uncertain'?'incomplete':r.phase!=='ended'?(r.status==='running'?'running':'incomplete'):r.status==='failed'?'error':r.status==='cancelled'?'cancelled':['returned','succeeded'].includes(r.status)?'complete':'incomplete';
const sameSelector=(p:WorkerExecutionPage|WorkerCallDetail,task:OverviewTask,runId:string)=>p.selector.taskId===task.id&&p.selector.runId===runId;
async function json<T>(read:typeof fetch,path:string,signal:AbortSignal):Promise<T>{
 const response=await read(path,{signal});if(!response.ok){const value=await response.json().catch(()=>null);throw Error(typeof value?.error==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(value.error)?value.error:[404,501].includes(response.status)?'task_execution_unavailable':'execution_read_failed');}return response.json();
}
function RunFacts({run,current}:{run:OverviewRun;current:boolean}){
 const active='activeMs'in run&&typeof run.activeMs==='number'?run.activeMs:undefined;
 return <div><p>版本 {run.version} · {current?'本次执行':'历史执行'} · {runStates[run.status]??run.status} · {runPhases[run.phase]??run.phase}</p>
  <p>{stamp(run.createdAt)&&<>创建：{stamp(run.createdAt)} · </>}已记录开始：{stamp(run.startedAt)??'时间未提供'} · {run.endedAt==null?(run.phase==='ended'?'结束时间未提供':'等待结束确认'):`结束：${stamp(run.endedAt)}`}</p>
  {run.startedAt!=null&&run.endedAt!=null&&run.endedAt>=run.startedAt&&<p>墙钟跨度 {seconds(run.endedAt-run.startedAt)}</p>}
  {active!==undefined&&<p>已记录活跃时长 {seconds(active)}（读取快照）</p>}
  {run.errorCode&&<p>执行错误：{run.errorCode}</p>}{run.stopRequestedAt!=null&&<p>停止请求：{stamp(run.stopRequestedAt)}{run.phase!=='ended'?' · 停止待确认':''}</p>}
  {run.replacesRunId&&<p>替换自执行 {run.replacesRunId}</p>}
 </div>;
}
function CallRow({summary,task,runId,current,generation}:{summary:WorkerCallSummary;task:OverviewTask;runId:string;current:boolean;generation:string}){
 const observation=useContext(ExecutionObservationContext),[open,setOpen]=useState(false),[detail,setDetail]=useState<WorkerCallDetail|null>(null),[error,setError]=useState('');
 const permissionDenied=useRef(false);
 useEffect(()=>{if(!open||!observation.connected||permissionDenied.current)return;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort('timeout'),15000);
  void json<WorkerCallDetail>(observation.read,`/api/tasks/${task.id}/execution/${runId}/calls/${summary.callKey}`,controller.signal).then(value=>{if(controller.signal.aborted)return;if(!sameSelector(value,task,runId)||value.callKey!==summary.callKey||value.revision<summary.revision)throw Error('execution_scope_denied');setDetail(value);setError('');}).catch(e=>{if(!controller.signal.aborted||controller.signal.reason==='timeout'){if(/denied|identity|stale|scope/.test(e.message))permissionDenied.current=true;setError('调用详情读取失败：'+e.message);}}).finally(()=>clearTimeout(timeout));
  return()=>{controller.abort();clearTimeout(timeout);};
 },[open,observation.connected,observation.scope,observation.read,summary.callKey,summary.revision,generation,runId,task.id]);
 const live=current&&observation.connected,st=summary.status==='running'&&!live?'上次调用中，结束未确认':states[summary.status];
 const name=summary.toolName??nativeLabels[summary.category as keyof typeof nativeLabels]??'工具名称未保留';
 const hasBody=summary.contentState==='available';
 return <ToolFallback.Root open={open} onOpenChange={value=>{if(value)permissionDenied.current=false;setOpen(value);}}>
  <p>{stamp(summary.startedAtMs??summary.firstObservedAtMs)} · {summary.startedAtMs===undefined?'首次观察 · ':''}{name} · {st}{summary.durationMs!==undefined?` · 原生耗时 ${seconds(summary.durationMs)}`:''}{summary.exitCode!==undefined?` · 退出码 ${summary.exitCode}`:''}</p>
  {summary.inputSummary&&<p>参数摘要：{summary.inputSummary}</p>}{summary.outputSummary&&<p>返回摘要：{summary.outputSummary}</p>}{summary.errorSummary&&<p>错误：{summary.errorSummary}</p>}{summary.conflict&&<p>收到相互冲突的结束状态，需核对。</p>}
  {hasBody?<><Collapsible.Trigger data-execution-call={summary.callKey} className={ghostButton+' min-h-11 px-2 text-xs'}>参数与结果</Collapsible.Trigger><Collapsible.Panel>{open&&(error?<p role="status">{error}</p>:detail?<ToolCallBody content={detail.content} status={summary.status}/>:<p role="status">正在读取调用详情…</p>)}</Collapsible.Panel></>:<p>{summary.contentState==='evicted'?'正文已超出本次保留范围':'当时未保存可展示详情'}</p>}
 </ToolFallback.Root>;
}
function WorkerConversationRecord({task,worker}:{task:OverviewTask;worker:OverviewWorker}){
 const observation=useContext(ExecutionObservationContext),[open,setOpen]=useState(false),[page,setPage]=useState<WorkerConversation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),base=`/api/tasks/${task.id}/workers/${worker.id}`;
 useEffect(()=>()=>controller.current?.abort(),[observation.connected,observation.scope]);
 async function load(path=base,message?:WorkerConversation['messages'][number]){
  if(busy||!observation.connected)return;
  const active=new AbortController();controller.current?.abort();controller.current=active;setBusy(true);setError('');
  const timeout=setTimeout(()=>active.abort('timeout'),15000);
  try{
   const value=await json<TaskDetail>(observation.read,path,active.signal),conversation=value.conversation;
   if(active.signal.aborted)return;
   if(value.taskId!==task.id||!conversation||conversation.taskId!==task.id||conversation.workerId!==worker.id||conversation.messages.some(m=>!['worker_input','worker_reply'].includes(m.kind)||typeof m.text!=='string'||m.text.length>24000))throw Error('conversation_scope_denied');
   if(message){const chunk=conversation.messages[0];if(conversation.messages.length!==1||chunk?.id!==message.id||chunk.seq!==message.seq||chunk.offset!==message.nextOffset)throw Error('conversation_scope_denied');setPage(old=>old?{...old,messages:old.messages.map(m=>m.id===message.id?{...m,text:m.text+chunk.text,nextOffset:chunk.nextOffset}:m)}:old);}
   else setPage(old=>path===base||!old?conversation:{...conversation,messages:[...old.messages,...conversation.messages.filter(m=>!old.messages.some(prior=>prior.id===m.id))]});
  }catch(e){if(!active.signal.aborted||active.signal.reason==='timeout')setError('会话原文读取失败：'+(e as Error).message);}
  finally{clearTimeout(timeout);if(controller.current===active)setBusy(false);}
 }
 return <Collapsible.Root open={open} onOpenChange={value=>{setOpen(value);if(value&&!page)void load();if(!value){controller.current?.abort();setBusy(false);}}}>
  <Collapsible.Trigger className={ghostButton+' min-h-11 px-2 text-xs'}>会话原文</Collapsible.Trigger>
  <Collapsible.Panel>{open&&<>{!observation.connected&&<p>显示上次读取的原文；连接恢复后可刷新。</p>}{page?.messages.map(m=><div key={m.id}><p>{m.kind==='worker_input'?'主 Agent':'Worker'} · 版本 {m.version}</p><p className="status-output">{m.text||'本条没有公开正文。'}</p>{m.nextOffset!==null&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void load(base+'/messages/'+m.id+'/'+m.nextOffset,m)}>继续读取这条原文</button>}</div>)}{page&&!page.messages.length&&<p>当前会话尚无已保存消息。</p>}{busy&&<p role="status">正在读取会话原文…</p>}{error&&<p role="status">{error}</p>}{page?.nextCursor!==null&&page&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void load(base+'/after/'+page.nextCursor)}>加载后续消息</button>}<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void load()}>刷新会话</button></>}</Collapsible.Panel>
 </Collapsible.Root>;
}
export function TaskExecutionRecord({task,worker}:{task:OverviewTask;worker:OverviewWorker}){
 const observation=useContext(ExecutionObservationContext);
 return <ExecutionRecord key={JSON.stringify([observation.scope,task.id,worker.id,worker.run.id])} task={task} worker={worker}/>;
}
function ExecutionRecord({task,worker}:{task:OverviewTask;worker:OverviewWorker}){
 const observation=useContext(ExecutionObservationContext),[open,setOpen]=useState(false),[detail,setDetail]=useState<TaskDetail|null>(null),[selected,setSelected]=useState<string|null>(null),[pages,setPages]=useState<WorkerExecutionPage[]>([]),[error,setError]=useState(''),[historyOpen,setHistoryOpen]=useState(false),[detailError,setDetailError]=useState(''),[busy,setBusy]=useState(false),[unsupported,setUnsupported]=useState(false);
 const blocked=useRef(false),detailDenied=useRef(false),pageController=useRef<AbortController|null>(null),identity=observation.scope+':'+task.id+':'+(selected??worker.run.id),pageRef=useRef(pages);pageRef.current=pages;
 const runId=selected??worker.run.id,current=!selected||selected===worker.run.id;
 const run=detail?.runs.find(r=>r.id===runId&&r.taskId===task.id&&r.workerId===worker.id)??(current?worker.run:null);
 useEffect(()=>{setPages([]);setError('');setUnsupported(false);setBusy(false);blocked.current=false;},[identity]);
 // Includes load-more requests, which outlive the initial-page effect.
 useEffect(()=>()=>pageController.current?.abort(),[identity,open,observation.connected,observation.revision]);
 useEffect(()=>{if(!open||!observation.connected||!observation.scope||detailDenied.current)return;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort('timeout'),15000);
  void json<TaskDetail>(observation.read,'/api/tasks/'+task.id,controller.signal).then(value=>{if(controller.signal.aborted)return;if(value.taskId!==task.id)throw Error('execution_scope_denied');setDetail(value);setDetailError('');}).catch(e=>{if(!controller.signal.aborted||controller.signal.reason==='timeout'){if(/denied|identity|stale|scope/.test(e.message))detailDenied.current=true;setDetailError('执行资料读取失败：'+e.message);}}).finally(()=>clearTimeout(timeout));
  return()=>{controller.abort();clearTimeout(timeout);};
 },[open,observation.connected,observation.scope,observation.revision,observation.read,task.id]);
 useEffect(()=>{if(!open||!observation.connected||!observation.enabled||!observation.scope||!runId||blocked.current)return;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort('timeout'),15000);pageController.current=controller;setBusy(true);
  const base=`/api/tasks/${task.id}/execution/${runId}`;
  // Re-read only pages the reader already opened. Cursors bind store generation.
  void(async()=>{const first=await json<WorkerExecutionPage>(observation.read,base,controller.signal);const result=[first];
   if(!sameSelector(first,task,runId)||(run&&first.version!==run.version))throw Error('execution_scope_denied');
   for(let i=1;i<pageRef.current.length&&result.at(-1)?.hasMore;i++){const p=await json<WorkerExecutionPage>(observation.read,base+'/before/'+result.at(-1)!.before,controller.signal);if(!sameSelector(p,task,runId)||p.storeGeneration!==first.storeGeneration)throw Error('execution_cursor_expired');result.push(p);}
   if(!controller.signal.aborted){setPages(result);setError('');setUnsupported(false);}
  })().catch(e=>{if(!controller.signal.aborted||controller.signal.reason==='timeout'){if(e.message==='task_execution_unavailable')setUnsupported(true);else{if(/denied|identity|stale|scope/.test(e.message))blocked.current=true;setError('工具步骤读取失败：'+e.message);}}}).finally(()=>{clearTimeout(timeout);if(!controller.signal.aborted||controller.signal.reason==='timeout')setBusy(false);});
  return()=>{controller.abort();clearTimeout(timeout);};
 },[identity,open,observation.connected,observation.enabled,observation.revision,observation.read,runId,run?.version,task.id]);
 useEffect(()=>()=>pageController.current?.abort(),[]);
 async function earlier(){const last=pages.at(-1);if(busy||!last?.before||!runId||!observation.connected)return;const controller=new AbortController();pageController.current?.abort();pageController.current=controller;setBusy(true);const timeout=setTimeout(()=>controller.abort('timeout'),15000);
  try{const p=await json<WorkerExecutionPage>(observation.read,`/api/tasks/${task.id}/execution/${runId}/before/${last.before}`,controller.signal);if(controller.signal.aborted)return;if(!sameSelector(p,task,runId)||p.storeGeneration!==pages[0]?.storeGeneration)throw Error('execution_cursor_expired');setPages(old=>[...old,p]);}catch(e){if(!controller.signal.aborted||controller.signal.reason==='timeout')setError('更早记录读取失败：'+(e as Error).message);}finally{clearTimeout(timeout);if(pageController.current===controller)setBusy(false);}
 }
 const latest=pages[0],byKey=new Map<string,WorkerCallSummary>();for(const p of pages)for(const c of [...p.items,...p.active]){const old=byKey.get(c.callKey);if(!old||c.revision>=old.revision)byKey.set(c.callKey,c);}const calls=[...byKey.values()].sort((a,b)=>Number(a.terminalObserved)-Number(b.terminalObserved)||a.seq-b.seq);
 const oldRuns=detail?.runs.filter(r=>r.taskId===task.id&&r.workerId===worker.id&&r.id!==worker.run.id)??[];
 const entries=[{id:'facts',kind:'commentary' as const,label:'',content:<>{run?<RunFacts run={run} current={current}/>:<p>当前版本没有可核对的独立执行记录。</p>}</>},
 {id:'conversation',kind:'commentary' as const,label:'',content:<WorkerConversationRecord task={task} worker={worker}/>},
 {id:'steps',kind:'commentary' as const,label:'',content:<>{!observation.connected&&<p>显示上次记录；当前状态待更新。</p>}{error&&<p role="status">{error}</p>}{busy&&!latest&&<p role="status">正在读取执行步骤…</p>}{!observation.enabled||unsupported?<p>当前步骤仅含当前版本快照，不代表完整调用历史；工具步骤尚未接入。</p>:latest?<><p>近期内存记录 · 历史可能不完整 · 观察于 {stamp(latest.observedAtMs)}</p>{latest.availability==='unavailable'?<p>当前读取源不可提供，历史留存情况未知。</p>:!calls.length?<p>尚未收到可展示的调用事实。</p>:calls.map(c=><CallRow key={c.callKey} summary={c} task={task} runId={runId!} current={current&&run?.phase==='executing'} generation={latest.storeGeneration}/>)}{latest.omitted&&<p>部分记录已超出本次内存保留范围。</p>}{pages.at(-1)?.hasMore&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void earlier()}>加载更早记录</button>}</>:null}</>},
 {id:'history',kind:'commentary' as const,label:'',content:<Collapsible.Root open={historyOpen} onOpenChange={setHistoryOpen}><Collapsible.Trigger className={ghostButton+' min-h-11 px-2 text-xs'}>其他版本与执行</Collapsible.Trigger><Collapsible.Panel>{historyOpen&&<>{detailError&&<p role="status">{detailError}</p>}{!detail&&!detailError&&<p role="status">正在读取执行资料…</p>}{selected&&<button type="button" onClick={()=>setSelected(null)}>返回本次执行</button>}{oldRuns.map(r=><div key={r.id}><RunFacts run={r} current={false}/><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>setSelected(r.id)}>查看版本 {r.version} 的步骤</button></div>)}{detail&&!detailError&&!oldRuns.length&&<p>当前读取范围没有其他执行资料。</p>}{detail?.moreHistory&&<p>另有历史资料未展示（当前读取上限 80 条）。</p>}</>}</Collapsible.Panel></Collapsible.Root>}];
 return <div data-task-execution-record={task.id}><RunActivity status={status(run,observation.connected)} statusLabel="执行记录" entries={entries} open={open} onOpenChange={value=>{blocked.current=false;detailDenied.current=false;setOpen(value);if(!value){pageController.current?.abort();setBusy(false);}}}/></div>;
}
