import {useEffect,useRef,useState} from 'react';
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
export function ScheduledMessages({threadId,readEpoch,refreshKey,onReference}:{threadId:string;readEpoch:string;refreshKey:unknown;onReference:(value:ScheduleContext)=>void}){
 const [items,setItems]=useState<ScheduleSummary[]>([]),[next,setNext]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<(ScheduleSummary&{text:string})|null>(null),[zone,setZone]=useState(''),[detailError,setDetailError]=useState('');
 const origin=useRef<HTMLElement|null>(null),reload=useRef<(offset?:number)=>void>(()=>{});
 useEffect(()=>{
  const owner={alive:true,busy:false,again:false,controller:new AbortController()};
  const load=async(offset=0)=>{
   if(owner.busy){owner.again=true;return;}owner.busy=true;setBusy(true);setError('');
   try{const result=await read({readEpoch,view:'list',offset},threadId,owner.controller.signal);if(!owner.alive)return;if(!('items' in result))throw Error('schedule_read_failed');setItems(old=>offset?[...new Map([...old,...result.items].map(item=>[item.scheduleId,item])).values()]:result.items);setNext(result.nextOffset);}
   catch{if(owner.alive)setError('定时任务未能读取，当前内容尚未确认。');}
   finally{owner.busy=false;if(owner.alive){setBusy(false);if(owner.again){owner.again=false;void load();}}}
  };
  reload.current=offset=>{void load(offset);};
  setItems([]);setNext(null);setSelected(null);
  const foreground=()=>{if(document.visibilityState==='visible')void load();};
  document.addEventListener('visibilitychange',foreground);window.addEventListener('pageshow',foreground);
  return()=>{owner.alive=false;owner.controller.abort();document.removeEventListener('visibilitychange',foreground);window.removeEventListener('pageshow',foreground);};
 },[threadId,readEpoch]);
 useEffect(()=>{reload.current();},[refreshKey,threadId,readEpoch]);
 useEffect(()=>{
  setDetail(null);setDetailError('');if(!selected)return;
  const controller=new AbortController();
  void read({readEpoch,view:'detail',scheduleId:selected},threadId,controller.signal).then(result=>{if(!controller.signal.aborted&&'item' in result){setDetail(result.item);setZone(result.displayTimeZone);}}).catch(()=>{if(!controller.signal.aborted)setDetailError('该定时任务暂不可用或未能读取。');});
  return()=>controller.abort();
 },[selected,threadId,readEpoch]);
 const card=(row:ScheduleSummary)=><div className="schedule-record" key={row.scheduleId}><ScheduleCard name={row.title} cadence={row.cadence} statusLabel={row.status} nextRun={row.timeText} timeLabel={row.timeLabel} className="homer-schedule-card" detailLabel={'查看定时任务详情：'+row.title} onDetails={()=>{origin.current=document.activeElement as HTMLElement;setSelected(row.scheduleId);}} endAction={<button type="button" className="schedule-talk" aria-label={'在对话中说：'+row.title} title={'在对话中说：'+row.title} onClick={event=>{event.stopPropagation();onReference({scheduleId:row.scheduleId,label:row.title});}}><MessageCircle size={16} aria-hidden/></button>}/>{row.note&&<p className="schedule-note">{row.note}</p>}</div>;
 const enabled=items.filter(row=>row.enabled),disabled=items.filter(row=>!row.enabled);
 return <div className="homer-schedules">
  <div className="schedule-list-body"><p className="schedule-note">当前定时安排</p>{error&&<p role="status" className="schedule-note">{error} <button type="button" disabled={busy} onClick={()=>reload.current()}>重试</button></p>}
  {!items.length&&!error&&<p role="status" className="schedule-note">{busy?'正在读取…':'暂无定时任务'}</p>}
  {!!enabled.length&&<><h2 className="schedule-section">定时安排 · 已加载 {enabled.length}</h2>{enabled.map(card)}</>}
  {!!disabled.length&&<details className="schedule-stopped"><summary>已停用 · 已加载 {disabled.length}</summary>{disabled.map(card)}</details>}
  {next!==null&&<button type="button" className="schedule-more" disabled={busy} onClick={()=>reload.current(next)}>加载更多</button>}</div>
  <p className="schedule-footer">创建、修改与取消，继续在对话中告诉荷马。</p>
  <Dialog open={selected!==null} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="homer-schedule-detail" finalFocus={()=>origin.current?.isConnected?origin.current:document.querySelector<HTMLElement>('.canvas-tab[aria-selected=true]')}><DialogTitle><Clock3 size={20} aria-hidden/><span>{detail?.title??'定时任务'}</span></DialogTitle>
   {detailError?<p role="status">{detailError}</p>:!detail?<p role="status">正在读取…</p>:<SpecSheet title="" className="schedule-detail-sheet" visibleCount={99} rows={[
    {label:'时间规则',value:detail.cadence},{label:'显示时区',value:'cron' in detail.trigger?detail.trigger.timeZone:zone},{label:'当前状态',value:detail.status},{label:detail.timeLabel,value:detail.timeText},...(detail.note?[{label:'说明',value:detail.note}]:[]),{label:'任务内容',value:detail.text}
   ]}/>}
  </DialogContent></Dialog>
 </div>;
}
