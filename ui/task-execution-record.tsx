import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {Collapsible} from '@base-ui/react/collapsible';
import type {OverviewTask,OverviewWorker,OverviewRun,TaskDetail,WorkerConversation} from '../src/task-overview';
import {RunActivity,type RunActivityStatus} from './vendor/assistant-ui/run-activity';
import {connectionFetch} from './web-connection-client';
import {ghostButton} from './vendor/task-status/surfaces';
export const ExecutionObservationContext=createContext({connected:true,scope:'',read:connectionFetch});
const stamp=(n:number|null|undefined)=>n!=null&&Number.isFinite(n)?new Date(n).toLocaleString():undefined;
const seconds=(n:number)=>`${Math.floor(n/1000)} 秒`;
const receiptStates:Record<string,string>={pending:'待接收',offered:'已送交',received:'已接收',processed:'已处理',uncertain:'接收待核实',rejected:'已拒收'};
const runStates:Record<string,string>={queued:'等待执行',running:'运行中',returned:'执行已返回',succeeded:'执行成功',failed:'执行失败',cancelled:'执行已取消',interrupted:'执行已中断'};
const runPhases:Record<string,string>={ready:'等待启动',starting:'启动中',executing:'执行中',yielding:'交接中',held:'已暂缓',uncertain:'状态待核实',ended:'执行已结束'};
const status=(r:OverviewRun|undefined|null,connected:boolean):RunActivityStatus=>!r||!connected||r.phase==='uncertain'?'incomplete':r.phase!=='ended'?(r.status==='running'?'running':'incomplete'):r.status==='failed'?'error':r.status==='cancelled'?'cancelled':['returned','succeeded'].includes(r.status)?'complete':'incomplete';
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
  <Collapsible.Panel>{open&&<>{!observation.connected&&<p>显示上次读取的原文；连接恢复后可刷新。</p>}{page?.messages.map(m=><div key={m.id}><p>{m.kind==='worker_input'?'Homer':'Worker'} · 版本 {m.version}{m.receipt&&' · '+(receiptStates[m.receipt]??'接收状态待核实')}</p><p className="status-output">{m.text||'本条没有公开正文。'}</p>{m.nextOffset!==null&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void load(base+'/messages/'+m.id+'/'+m.nextOffset,m)}>继续读取这条原文</button>}</div>)}{page&&!page.messages.length&&<p>当前会话尚无已保存消息。</p>}{busy&&<p role="status">正在读取会话原文…</p>}{error&&<p role="status">{error}</p>}{page?.nextCursor!==null&&page&&<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void load(base+'/after/'+page.nextCursor)}>加载后续消息</button>}<button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} disabled={busy||!observation.connected} onClick={()=>void load()}>刷新会话</button></>}</Collapsible.Panel>
 </Collapsible.Root>;
}
export function TaskExecutionRecord({task,worker}:{task:OverviewTask;worker:OverviewWorker}){
 const observation=useContext(ExecutionObservationContext);
 return <ExecutionRecord key={JSON.stringify([observation.scope,task.id,worker.id,worker.run.id])} task={task} worker={worker}/>;
}
function ExecutionRecord({task,worker}:{task:OverviewTask;worker:OverviewWorker}){
 const observation=useContext(ExecutionObservationContext),[open,setOpen]=useState(false),[detail,setDetail]=useState<TaskDetail|null>(null),[selected,setSelected]=useState<string|null>(null),[historyOpen,setHistoryOpen]=useState(false),[detailError,setDetailError]=useState('');
 const detailDenied=useRef(false);
 const runId=selected??worker.run.id,current=!selected||selected===worker.run.id;
 const run=detail?.runs.find(r=>r.id===runId&&r.taskId===task.id&&r.workerId===worker.id)??(current?worker.run:null);
 useEffect(()=>{if(!open||!observation.connected||!observation.scope||detailDenied.current)return;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort('timeout'),15000);
  void json<TaskDetail>(observation.read,'/api/tasks/'+task.id,controller.signal).then(value=>{if(controller.signal.aborted)return;if(value.taskId!==task.id)throw Error('execution_scope_denied');setDetail(value);setDetailError('');}).catch(e=>{if(!controller.signal.aborted||controller.signal.reason==='timeout'){if(/denied|identity|stale|scope/.test(e.message))detailDenied.current=true;setDetailError('执行资料读取失败：'+e.message);}}).finally(()=>clearTimeout(timeout));
  return()=>{controller.abort();clearTimeout(timeout);};
 },[open,observation.connected,observation.scope,observation.read,task.id,task.revision,worker.run.id,worker.run.version,worker.run.epoch,worker.run.status,worker.run.phase,worker.run.startedAt,worker.run.endedAt,worker.run.errorCode,worker.run.stopRequestedAt]);
 const oldRuns=detail?.runs.filter(r=>r.taskId===task.id&&r.workerId===worker.id&&r.id!==worker.run.id)??[];
 const entries=[{id:'facts',kind:'commentary' as const,label:'',content:<>{run?<RunFacts run={run} current={current}/>:<p>当前版本没有可核对的独立执行记录。</p>}</>},
 {id:'conversation',kind:'commentary' as const,label:'',content:<WorkerConversationRecord task={task} worker={worker}/>},
 {id:'history',kind:'commentary' as const,label:'',content:<Collapsible.Root open={historyOpen} onOpenChange={setHistoryOpen}><Collapsible.Trigger className={ghostButton+' min-h-11 px-2 text-xs'}>其他版本与执行</Collapsible.Trigger><Collapsible.Panel>{historyOpen&&<>{detailError&&<p role="status">{detailError}</p>}{!detail&&!detailError&&<p role="status">正在读取执行资料…</p>}{selected&&<button type="button" onClick={()=>setSelected(null)}>返回本次执行</button>}{oldRuns.map(r=><div key={r.id}><RunFacts run={r} current={false}/><button type="button" className={ghostButton+' min-h-11 px-2 text-xs'} onClick={()=>setSelected(r.id)}>查看版本 {r.version} 的记录</button></div>)}{detail&&!detailError&&!oldRuns.length&&<p>当前读取范围没有其他执行资料。</p>}{detail?.moreHistory&&<p>另有历史资料未展示（当前读取上限 80 条）。</p>}</>}</Collapsible.Panel></Collapsible.Root>}];
 return <div data-task-execution-record={task.id}><RunActivity status={status(run,observation.connected)} statusLabel="执行记录" entries={entries} open={open} onOpenChange={value=>{detailDenied.current=false;setOpen(value);}}/></div>;
}
