import {createElement,useEffect,useRef,useState} from 'react';
import '@github/relative-time-element';
import type {RelativeTimeElement} from '@github/relative-time-element';
import {Clock3,MessageCircle,X} from 'lucide-react';
import {connectionFetch} from './web-connection-client';
import type {ScheduleSummary,ScheduleReadRequest,ScheduleReadResult} from '../src/schedule-display';
import type {ScheduleContext} from './conversation-client';
import {ScheduleCard} from './vendor/assistant-ui/schedule-card';
import {SpecSheet} from './vendor/assistant-ui/spec-sheet';
import {Dialog,DialogContent,DialogTitle} from './vendor/assistant-ui/attachment-dialog';
import './vendor/assistant-ui/schedules.css';
import './scheduled-messages.css';

export function ScheduleChip({value,onRemove}:{value:ScheduleContext;onRemove:()=>void}){
 return <div className="schedule-chip"><Clock3 size={14} aria-hidden/><span>{value.label}</span><button type="button" aria-label="移除定时任务引用" title="移除定时任务引用" onClick={onRemove}><X size={14} aria-hidden/></button></div>;
}
async function read(input:ScheduleReadRequest,threadId:string,signal:AbortSignal){
 const response=await connectionFetch('/api/schedules/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal});
 if(!response.ok)throw Error('schedule_read_failed');const result=await response.json() as ScheduleReadResult;
 if(result.threadId!==threadId||result.readEpoch!==input.readEpoch)throw Error('history_epoch_changed');return result;
}
function coalesceReads(run:(signal:AbortSignal,more:boolean)=>Promise<void>){
 const controller=new AbortController();
 let busy=false,again=false,loadingMore=false,moreQueued=false;
 let recoveryInFlight:number|undefined;
 const load=async(more=false,recovery?:number)=>{
  if(controller.signal.aborted)return;
  if(busy){
   if(more&&loadingMore)return;
   moreQueued||=more;
   // A recovery read in flight or already queued covers further recovery events.
   if(recovery===undefined||recovery!==recoveryInFlight)again=true;
   recoveryInFlight=recovery??recoveryInFlight;
   return;
  }
  busy=true;recoveryInFlight=recovery;loadingMore=more;
  try{await run(controller.signal,more);}
  finally{
   busy=false;
   if(again){
    const more=moreQueued;
    again=false;moreQueued=false;
    void load(more,recoveryInFlight);
   }
  }
 };
 return {load,close:()=>controller.abort()};
}
const scheduleExample='每周五下午 5 点，提醒我写周报。';
const pageSize=20;
const maxTimerDelay=2_147_483_647;
const upcomingAt=(row:ScheduleSummary)=>row.enabled&&row.status==='已启用'?row.nextFireAt:null;

export function ScheduledMessages({threadId,readEpoch,refreshKey,onReference,onExample,onDetails}:{threadId:string;readEpoch:string;refreshKey:unknown;onReference:(value:ScheduleContext)=>void;onExample:(text:string)=>string|undefined;onDetails:(id:string,trigger:HTMLElement)=>void}){
 const [{items,next,displayTimeZone},setList]=useState<{items:ScheduleSummary[];next:number|null;displayTimeZone?:string}>({items:[],next:null});
 const [busy,setBusy]=useState(true),[error,setError]=useState('');
 const [exampleError,setExampleError]=useState<string>();
 const listBody=useRef<HTMLDivElement>(null);
 const listRead=useRef<(more?:boolean)=>void>(()=>{});
 const refresh=()=>listRead.current();
 useEffect(()=>{
  let loaded:ScheduleSummary[]=[];
  let loadedLimit=pageSize;
  let recoveryGeneration=0;
  let timer:number|undefined;
  const armDeadline=(startedAt:number)=>{
   let deadline=Infinity;
   for(const row of loaded){
    const at=upcomingAt(row);
    // The current read already covered deadlines reached before it started.
    if(at!==null&&at>startedAt)deadline=Math.min(deadline,at);
   }
   if(!Number.isFinite(deadline))return;
   const check=()=>{
    const remaining=deadline-Date.now();
    if(remaining>0)timer=window.setTimeout(check,Math.min(remaining,maxTimerDelay));
    else if(document.visibilityState==='visible')void loader.load(false,recoveryGeneration);
   };
   timer=window.setTimeout(check,Math.min(Math.max(0,deadline-Date.now()),maxTimerDelay));
  };
  const loader=coalesceReads(async(signal,more)=>{
   const startedAt=Date.now();
   window.clearTimeout(timer);
   setBusy(true);setError('');
   try{
    // Status changes can reorder rows. Rebuild the loaded range from the first page.
    const limit=loadedLimit+(more?pageSize:0);
    const rows=new Map<string,ScheduleSummary>();
    let displayTimeZone:string|undefined;
    let cursor:number|null=0;
    while(cursor!==null&&cursor<limit){
     const result=await read({readEpoch,view:'list',offset:cursor,limit:Math.min(100,limit-cursor)},threadId,signal);
     if(signal.aborted)return;
     if(!('items' in result)||result.nextOffset!==null&&
      (!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=cursor||result.nextOffset!==cursor+result.items.length))throw Error('schedule_read_failed');
     displayTimeZone??=result.displayTimeZone;
     for(const item of result.items)rows.set(item.scheduleId,item);
     cursor=result.nextOffset;
    }
    loaded=[...rows.values()];
    loadedLimit=limit;
    setList({items:loaded,next:cursor,displayTimeZone});
   }catch{if(!signal.aborted)setError('定时任务未能读取，当前内容尚未确认。');}
   finally{if(!signal.aborted){setBusy(false);armDeadline(startedAt);}}
  });
  listRead.current=loader.load;
  const foreground=(event:Event)=>{
   if(document.visibilityState!=='visible'){
    if(event.type==='visibilitychange')recoveryGeneration++;
    return;
   }
   for(const time of listBody.current?.querySelectorAll<RelativeTimeElement>('relative-time')??[])time.update();
   void loader.load(false,recoveryGeneration);
  };
  document.addEventListener('visibilitychange',foreground);window.addEventListener('pageshow',foreground);
  return()=>{loader.close();window.clearTimeout(timer);document.removeEventListener('visibilitychange',foreground);window.removeEventListener('pageshow',foreground);};
 },[threadId,readEpoch]);
 useEffect(()=>{refresh();},[refreshKey,threadId,readEpoch]);
 const card=(row:ScheduleSummary)=>{
  const at=upcomingAt(row);
  const nextRun=at===null?row.timeText:createElement('relative-time',{
   datetime:new Date(at).toISOString(),format:'relative',tense:'future',title:row.timeText,
   'time-zone':'cron' in row.trigger?row.trigger.timeZone:displayTimeZone,
  },row.timeText);
  return <ScheduleCard key={row.scheduleId} name={row.title} cadence={row.cadence} statusLabel={row.status} nextRun={nextRun} timeLabel={row.timeLabel} className={row.enabled?'homer-schedule-card':'homer-schedule-card schedule-inactive'} note={row.note} detailLabel={'查看定时任务详情：'+row.title} onDetails={event=>onDetails(row.scheduleId,event.currentTarget)} endAction={<button type="button" className="schedule-talk" aria-label={'在对话中说：'+row.title} title={'在对话中说：'+row.title} onClick={event=>{event.stopPropagation();onReference({scheduleId:row.scheduleId,label:row.title});}}><MessageCircle size={16} aria-hidden/></button>}/>;
 };
 const enabled=items.filter(row=>row.enabled),disabled=items.filter(row=>!row.enabled);
 const empty=!items.length&&!error&&!busy&&next===null;
 return <div className="homer-schedules">
  <div className="schedule-list-body" ref={listBody}>
   {error&&<p role="status" className="schedule-note">{error} <button type="button" disabled={busy} onClick={refresh}>重试</button></p>}
   {!items.length&&busy&&<p role="status" className="schedule-note">正在读取…</p>}
   {enabled.map(card)}{disabled.map(card)}
   {next!==null&&<button type="button" className="schedule-more" disabled={busy} onClick={()=>listRead.current(true)}>加载更多</button>}
   {empty&&<section className="schedule-empty" aria-labelledby="schedule-empty-title">
    <span className="schedule-empty-icon"><Clock3 size={24} aria-hidden/></span>
    <h2 id="schedule-empty-title">还没有定时任务</h2>
    <p>在对话中告诉荷马何时做什么，可以安排一次，也可以定期重复。</p>
    <p className="schedule-example">例如「{scheduleExample}」</p>
    <button type="button" className="schedule-example-button" onClick={()=>setExampleError(onExample(scheduleExample))}><MessageCircle size={16} aria-hidden/>用示例开始</button>
    {exampleError&&<p role="status">{exampleError}</p>}
   </section>}
  </div>
  {!empty&&<p className="schedule-footer">创建、修改与取消，继续在对话中告诉荷马。</p>}
 </div>;
}

export function ScheduleDetail({threadId,readEpoch,refreshKey,scheduleId,onClose,finalFocus}:{threadId:string;readEpoch:string;scheduleId?:string;refreshKey:unknown;onClose:()=>void;finalFocus:()=>HTMLElement|null}){
 const [state,setState]=useState<{id:string;epoch:string;result?:Extract<ScheduleReadResult,{item:unknown}>}|null>(null);
 const detailRead=useRef<()=>void>(()=>{});
 useEffect(()=>{
  setState(null);if(!scheduleId)return;
  const loader=coalesceReads(async signal=>{
   try{
    const result=await read({readEpoch,view:'detail',scheduleId},threadId,signal);
    if(signal.aborted)return;
    if(!('item' in result)||result.item.scheduleId!==scheduleId)throw Error('schedule_read_failed');
    setState({id:scheduleId,epoch:readEpoch,result});
   }catch{if(!signal.aborted)setState({id:scheduleId,epoch:readEpoch});}
  });
  detailRead.current=loader.load;void loader.load();
  const foreground=()=>{if(document.visibilityState==='visible')void loader.load();};
  document.addEventListener('visibilitychange',foreground);window.addEventListener('pageshow',foreground);
  return()=>{loader.close();document.removeEventListener('visibilitychange',foreground);window.removeEventListener('pageshow',foreground);};
 },[scheduleId,threadId,readEpoch]);
 useEffect(()=>{detailRead.current();},[refreshKey]);
 const current=state?.id===scheduleId&&state?.epoch===readEpoch?state:null;
 const detail=current?.result?.item;
 return <Dialog open={!!scheduleId} onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="homer-schedule-detail" finalFocus={finalFocus}><DialogTitle><Clock3 size={20} aria-hidden/><span>{detail?.title??'定时任务'}</span></DialogTitle>
   {!detail?<p role="status">{current?'该定时任务暂不可用或未能读取。':'正在读取…'}</p>:<SpecSheet title="" className="schedule-detail-sheet" visibleCount={99} rows={[
    {label:'时间规则',value:detail.cadence},{label:'显示时区',value:'cron' in detail.trigger?detail.trigger.timeZone:current?.result?.displayTimeZone??''},{label:'当前状态',value:detail.status},{label:detail.timeLabel,value:detail.timeText},...(detail.note?[{label:'说明',value:detail.note}]:[]),{label:'任务内容',value:detail.text}
   ]}/>}
 </DialogContent></Dialog>;
}
