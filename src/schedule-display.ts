import type {DatabaseSync} from 'node:sqlite';
import type {Schedules,Schedule,ScheduleTrigger} from './schedules.js';

export type ScheduleReadRequest={readEpoch:string;view:'list';offset?:number;limit?:number}|{readEpoch:string;view:'detail';scheduleId:string};
export type ScheduleSummary={scheduleId:string;revision:number;title:string;trigger:ScheduleTrigger;enabled:boolean;nextFireAt:number|null;status:string;timeLabel:string;timeText:string;cadence:string;note:string};
export type ScheduleReadResult={threadId:string;readEpoch:string;displayTimeZone:string;items:ScheduleSummary[];nextOffset:number|null}|{threadId:string;readEpoch:string;displayTimeZone:string;item:ScheduleSummary&{text:string}};
export const scheduleTitle=(text:string)=>text.split(/[。！？\n]/)[0]!.slice(0,100).trim()||'定时任务';
export const isScheduleId=(id:unknown):id is string=>typeof id==='string'&&/^schedule-[a-f0-9-]{36}$/.test(id);
const denied=new Set(['schedule_scope_denied','task_authority_source_denied','channel_binding_denied']);

// This is a user-interface read, never a model tool call or scheduler operation.
export function readScheduleDisplay(db:Pick<DatabaseSync,'prepare'>,schedules:Pick<Schedules,'get'>,input:ScheduleReadRequest,scope:{threadId:string;readEpoch:string;validateSource:(ref:string)=>void},now=Date.now()):ScheduleReadResult {
  if(!input||typeof input!=='object'||Array.isArray(input)||input.readEpoch!==scope.readEpoch)throw Error('history_epoch_changed');
  const detail=input.view==='detail',list=input.view==='list';
  if(!detail&&!list||Object.keys(input).some(key=>!(detail?['view','readEpoch','scheduleId']:['view','readEpoch','offset','limit']).includes(key)))throw Error('schedule_query_invalid');
  const offset=list?input.offset??0:0,limit=list?input.limit??20:1;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100||detail&&!isScheduleId(input.scheduleId))throw Error('schedule_query_invalid');
  const rows=db.prepare('SELECT id,sourceRef FROM schedules'+(detail?' WHERE id=?':'')+' ORDER BY enabled DESC,createdAt DESC,id').iterate(...(detail?[input.scheduleId]:[]));
  const selected:Schedule[]=[];let seen=0,more=false;
  for(const row of rows){
    try{scope.validateSource(String(row.sourceRef));}catch(error){if(error instanceof SyntaxError||error instanceof Error&&denied.has(error.message))continue;throw error;}
    if(seen++<offset)continue;
    if(selected.length===limit){more=true;break;}
    selected.push(schedules.get(String(row.id)));
  }
  if(detail&&!selected.length)throw Error('schedule_unavailable');
  const ids=selected.map(row=>row.id),cancelled=new Map<string,number>(),deliveries=new Map<string,number>();
  if(ids.length){
    const marks=ids.map(()=>'?').join(',');
    for(const row of db.prepare(`SELECT json_extract(responseJson,'$.scheduleId') id,json_extract(responseJson,'$.revision') revision FROM operations WHERE scopeId='schedules' AND kind='schedule_cancel' AND state='confirmed' AND json_extract(responseJson,'$.scheduleId') IN (${marks}) ORDER BY rowid`).all(...ids))cancelled.set(String(row.id),Number(row.revision));
    for(const row of db.prepare(`SELECT json_extract(m.payloadJson,'$.scheduleId') id,max(json_extract(m.payloadJson,'$.scheduledAt')) scheduledAt FROM agent_messages m JOIN operations o ON o.id=m.operationKey AND json_extract(o.responseJson,'$.messageId')=m.id WHERE o.actorAgentId='host' AND o.scopeId='scheduled-deliveries' AND o.kind='schedule_delivery' AND o.state='confirmed' AND m.senderAgentId='host' AND m.kind='scheduled_message' AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND json_extract(m.payloadJson,'$.threadId')=? AND json_extract(m.payloadJson,'$.scheduleId') IN (${marks}) GROUP BY json_extract(m.payloadJson,'$.scheduleId')`).all(scope.threadId,...ids))deliveries.set(String(row.id),Number(row.scheduledAt));
  }
  const displayTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date=(at:number,zone=displayTimeZone)=>new Intl.DateTimeFormat('zh-CN',{timeZone:zone,year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
  const items=selected.map(row=>{
    const zone='cron' in row.trigger?row.trigger.timeZone:displayTimeZone;
    let cadence='仅一次';
    if('cron' in row.trigger){const parts=row.trigger.cron.split(' ');cadence=parts.length===5&&/^\d+$/.test(parts[0]!)&&/^\d+$/.test(parts[1]!)&&parts.slice(2).join(' ')==='* * *'?`每天 ${parts[1]!.padStart(2,'0')}:${parts[0]!.padStart(2,'0')}`:row.trigger.cron;}
    cadence+=' · '+zone;
    let status='已启用',timeLabel='下次投递',timeText=row.nextFireAt===null?'未确认':date(row.nextFireAt,row.errorCode?displayTimeZone:zone),note='';
    if(!row.enabled){status=cancelled.get(row.id)===row.revision?'已取消后续投递':'已停用';timeLabel='后续投递';timeText='不再投递';note=status==='已取消后续投递'?'已入箱消息不会被撤回。':'记录只表明已停用，不能据此判断是取消还是已投递。';}
    else if(row.errorCode){status='规则异常';timeText='无法计算';}
    else if(row.nextFireAt===null)status='状态待核对';
    else if(row.nextFireAt<=now){status='到期待投递';timeLabel='原定投递';note='原定时间已到，尚未确认入箱，原因未确认。';}
    if(row.errorCode)note+=(note?' ':'')+'时间规则异常，请在对话中让荷马核对。';
    const delivered=deliveries.get(row.id);if(delivered!==undefined)note+=(note?' ':'')+`原定 ${date(delivered,row.errorCode?displayTimeZone:zone)} 的消息已进入 Homer 收件箱；工作结果另行核对。`;
    return {scheduleId:row.id,revision:row.revision,title:scheduleTitle(row.text),trigger:row.trigger,enabled:row.enabled,nextFireAt:row.nextFireAt,status,timeLabel,timeText,cadence,note,...(detail?{text:row.text}:{})};
  });
  const common={threadId:scope.threadId,readEpoch:scope.readEpoch,displayTimeZone};
  return detail?{...common,item:items[0] as ScheduleSummary&{text:string}}:{...common,items,nextOffset:more?offset+limit:null};
}
