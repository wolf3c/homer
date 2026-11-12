import {randomUUID} from 'node:crypto';
import {Cron} from 'croner';
import type {CommittedDatabase} from './committed-database.js';
import type {Tool} from './engine.js';

export const SCHEDULE_SCHEMA=`
  CREATE TABLE IF NOT EXISTS schedules(
    id TEXT PRIMARY KEY,text TEXT NOT NULL,trigger TEXT NOT NULL,timeZone TEXT,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),nextFireAt INTEGER,errorCode TEXT,
    revision INTEGER NOT NULL,sourceRef TEXT NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS schedules_due ON schedules(nextFireAt,id) WHERE enabled=1 AND errorCode IS NULL;
`;

export type ScheduleTrigger={at:string}|{cron:string;timeZone:string};
export type Schedule={id:string;text:string;trigger:ScheduleTrigger;timeZone:string|null;enabled:boolean;nextFireAt:number|null;errorCode:string|null;revision:number;sourceRef:string;createdAt:number;updatedAt:number};
export type ScheduleDelivery={deliveryId:string;scheduleId:string;scheduledAt:number;text:string;sourceRef:string};
type Row=Omit<Schedule,'trigger'|'enabled'>&{trigger:string;enabled:number};
type ScheduleOptions={
  transaction:<T>(fn:()=>T)=>T;
  enqueue:(input:ScheduleDelivery)=>string;
  changed?:()=>void;
  now?:()=>number;
  clock?:{setTimeout:(fn:()=>void,delay:number)=>unknown;clearTimeout:(timer:unknown)=>void};
};

const str={type:'string',minLength:1},text={...str,maxLength:16000};
const trigger={type:'object',properties:{at:str,cron:str,timeZone:str},additionalProperties:false};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]):Tool=>({type:'function',name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
export const SCHEDULE_TOOLS:Tool[]=[
  tool('schedule_create','Schedule a message to Homer once at an offset ISO time, or with five-field cron and an explicit IANA timeZone. Recurring messages require ongoing authorization. Accepted means scheduled, not completed.',{text,trigger},['text','trigger']),
  tool('schedule_list','List authorized schedules. Set receipts=true to recover original create/update/cancel receipts after a lost response; do not combine receipts with scheduleId or enabled. A missing receipt does not prove the earlier call failed.',{scheduleId:str,enabled:{type:'boolean'},receipts:{type:'boolean'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},[]),
  tool('schedule_update','Change an authorized schedule with its current revision and at least one of text, trigger or enabled. Re-enabling or updating starts future delivery from now. Changing text requires authority for the new message.',{scheduleId:str,expectedRevision:{type:'integer',minimum:1},text,trigger,enabled:{type:'boolean'}},['scheduleId','expectedRevision']),
  tool('schedule_cancel','Disable future delivery at the expected revision. Messages already accepted by Homer remain in its inbox.',{scheduleId:str,expectedRevision:{type:'integer',minimum:1}},['scheduleId','expectedRevision']),
];

class RuleError extends Error {}
function invalid(code:string):never{throw new RuleError(code);}
function validText(value:string){if(typeof value!=='string'||!value.trim()||value.length>16000)invalid('schedule_text_invalid');return value;}
function normalizeTrigger(input:ScheduleTrigger):{trigger:ScheduleTrigger;value:string;timeZone:string|null} {
  if(!input||typeof input!=='object'||Array.isArray(input))invalid('schedule_trigger_invalid');
  if('at' in input&&Object.keys(input).length===1){
    const value=input.at;
    const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    if(!match||Number(match[2])>23||Number(match[3])>59||Number(match[4])>59)invalid('schedule_time_invalid');
    const day=new Date(match[1]+'T00:00:00Z'),time=Date.parse(value);
    if(!Number.isFinite(time)||!Number.isFinite(day.getTime())||!day.toISOString().startsWith(match[1]!))invalid('schedule_time_invalid');
    const normalized=new Date(time).toISOString();return {trigger:{at:normalized},value:normalized,timeZone:null};
  }
  if(!('cron' in input)||!('timeZone' in input)||Object.keys(input).length!==2||typeof input.cron!=='string'||typeof input.timeZone!=='string')invalid('schedule_trigger_invalid');
  const value=input.cron.trim().replace(/\s+/g,' '),timeZone=input.timeZone;
  if(value.split(' ').length!==5)invalid('schedule_cron_invalid');
  try{if(!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone))invalid('schedule_timezone_invalid');new Intl.DateTimeFormat('en',{timeZone});}catch{invalid('schedule_timezone_invalid');}
  try{new Cron(value,{timezone:timeZone,mode:'5-part'});}catch{invalid('schedule_cron_invalid');}
  return {trigger:{cron:value,timeZone},value,timeZone};
}
function nextTime(rule:ReturnType<typeof normalizeTrigger>,base:number):number {
  if('at' in rule.trigger)return Date.parse(rule.trigger.at);
  const next=new Cron(rule.value,{timezone:rule.timeZone!,mode:'5-part'}).nextRun(new Date(base));
  if(!next)invalid('schedule_no_next_time');return next.getTime();
}
function view(row:Row):Schedule{return {...row,enabled:row.enabled===1,trigger:row.timeZone===null?{at:row.trigger}:{cron:row.trigger,timeZone:row.timeZone}};}

export class Schedules {
  private readonly now:()=>number;
  private readonly clock:NonNullable<ScheduleOptions['clock']>;
  private readonly unobserve:()=>void;
  private timer:unknown;
  private started=false;
  private closed=false;
  private checking=false;
  private afterId='';
  constructor(readonly db:Pick<CommittedDatabase,'prepare'|'onChange'>,private options:ScheduleOptions){
    this.now=options.now??Date.now;
    this.clock=options.clock??{setTimeout:(fn,delay)=>{const timer=setTimeout(fn,delay);timer.unref();return timer;},clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
    this.unobserve=db.onChange(tables=>{if(tables.has('schedules'))this.publish();});
  }
  private row(id:string):Row {const row=this.db.prepare('SELECT * FROM schedules WHERE id=?').get(id) as Row|undefined;if(!row)throw Error('schedule_not_found');return row;}
  get(id:string):Schedule{return view(this.row(id));}
  list(input:{scheduleId?:string;enabled?:boolean;offset?:number;limit?:number}={}):Schedule[]{
    const {scheduleId,enabled,offset=0,limit=100}=input;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('schedule_pagination_invalid');
    return (this.db.prepare('SELECT * FROM schedules WHERE (? IS NULL OR id=?) AND (? IS NULL OR enabled=?) ORDER BY createdAt,id LIMIT ? OFFSET ?').all(scheduleId??null,scheduleId??null,enabled===undefined?null:Number(enabled),enabled===undefined?null:Number(enabled),limit,offset) as Row[]).map(view);
  }
  create(input:{text:string;trigger:ScheduleTrigger;sourceRef:string}):Schedule {
    if(this.closed)throw Error('schedules_closed');
    const now=this.now(),rule=normalizeTrigger(input.trigger),nextFireAt=nextTime(rule,now);
    if(nextFireAt<=now)invalid('schedule_time_past');
    const id='schedule-'+randomUUID();
    this.db.prepare('INSERT INTO schedules VALUES(?,?,?,?,1,?,NULL,1,?,?,?)').run(id,validText(input.text),rule.value,rule.timeZone,nextFireAt,input.sourceRef,now,now);
    return this.get(id);
  }
  update(input:{scheduleId:string;expectedRevision:number;text?:string;trigger?:ScheduleTrigger;enabled?:boolean;sourceRef?:string}):Schedule {
    if(this.closed)throw Error('schedules_closed');
    if(input.text===undefined&&input.trigger===undefined&&input.enabled===undefined)throw Error('schedule_empty_update');
    const row=this.row(input.scheduleId);if(row.revision!==input.expectedRevision)throw Error('schedule_revision_conflict');
    const now=this.now(),rule=normalizeTrigger(input.trigger??view(row).trigger),enabled=input.enabled??(row.enabled===1);
    const calculated=nextTime(rule,now),nextFireAt=enabled?calculated:null;if(nextFireAt!==null&&nextFireAt<=now)invalid('schedule_time_past');
    const result=this.db.prepare('UPDATE schedules SET text=?,trigger=?,timeZone=?,enabled=?,nextFireAt=?,errorCode=NULL,revision=revision+1,sourceRef=?,updatedAt=? WHERE id=? AND revision=?').run(validText(input.text??row.text),rule.value,rule.timeZone,Number(enabled),nextFireAt,input.sourceRef??row.sourceRef,now,row.id,input.expectedRevision);
    if(!result.changes)throw Error('schedule_revision_conflict');return this.get(row.id);
  }
  cancel(input:{scheduleId:string;expectedRevision:number}):Schedule{
    if(this.closed)throw Error('schedules_closed');
    this.row(input.scheduleId);
    const result=this.db.prepare('UPDATE schedules SET enabled=0,nextFireAt=NULL,revision=revision+1,updatedAt=? WHERE id=? AND revision=?').run(this.now(),input.scheduleId,input.expectedRevision);
    if(!result.changes)throw Error('schedule_revision_conflict');return this.get(input.scheduleId);
  }
  nearestFireAt():number|null {return (this.db.prepare('SELECT MIN(nextFireAt) AS at FROM schedules WHERE enabled=1 AND errorCode IS NULL').get() as {at:number|null}).at;}
  nearestFutureFireAt():number|null {
    const now=this.now();let nearest:number|null=null;
    for(const row of this.db.prepare('SELECT * FROM schedules WHERE enabled=1 AND errorCode IS NULL').all() as Row[])try{
      const next=nextTime(this.rule(row),Math.max(now,row.updatedAt));
      if(next>now&&(nearest===null||next<nearest))nearest=next;
    }catch(error){if(!(error instanceof RuleError))throw error;}
    return nearest;
  }
  private publish(){
    if(this.closed)return;
    try{this.options.changed?.();}catch{/* Invalidation cannot undo committed work. */}
    if(this.started)this.arm();
  }
  private arm(){
    if(this.timer!==undefined)this.clock.clearTimeout(this.timer);this.timer=undefined;
    if(!this.started||this.closed)return;
    let delay=1000;
    try{const next=this.nearestFireAt();if(next===null)return;delay=next<=this.now()?1000:Math.min(60000,next-this.now());}catch{/* Storage outages retain cursors and retry at a bounded interval. */}
    this.timer=this.clock.setTimeout(()=>{this.timer=undefined;this.check();},delay);
  }
  private quarantine(row:Row,error:RuleError){this.db.prepare('UPDATE schedules SET errorCode=?,nextFireAt=NULL,revision=revision+1,updatedAt=? WHERE id=? AND revision=?').run(error.message,this.now(),row.id,row.revision);}
  private rule(row:Row){validText(row.text);return normalizeTrigger(view(row).trigger);}
  start(){
    if(this.closed)throw Error('schedules_closed');
    if(this.started)return;
    this.started=true;
    try{
      const rows=this.db.prepare('SELECT * FROM schedules WHERE enabled=1 AND errorCode IS NULL ORDER BY id').all() as Row[];
      for(const candidate of rows)try{this.options.transaction(()=>{
        const row=this.row(candidate.id);if(!row.enabled||row.errorCode||row.revision!==candidate.revision)return;
        try{
          const next=nextTime(this.rule(row),row.updatedAt);
          if(next!==row.nextFireAt)this.db.prepare('UPDATE schedules SET nextFireAt=?,revision=revision+1 WHERE id=? AND revision=?').run(next,row.id,row.revision);
        }catch(error){if(error instanceof RuleError)this.quarantine(row,error);else throw error;}
      });}catch{/* A shared storage failure is not a permanent rule failure. */}
    }catch{/* Startup can recover after the shared database becomes writable. */}
    this.check();this.publish();
  }
  check(){
    if(this.closed||this.checking)return;
    this.checking=true;
    try{
      const now=this.now(),select=()=>this.db.prepare('SELECT * FROM schedules WHERE enabled=1 AND errorCode IS NULL AND nextFireAt<=? AND id>? ORDER BY id LIMIT 32').all(now,this.afterId) as Row[];
      let rows=select();if(!rows.length&&this.afterId){this.afterId='';rows=select();}
      for(const candidate of rows){
        if(this.closed)break;
        this.afterId=candidate.id;
        try{this.options.transaction(()=>{
        const row=this.row(candidate.id);if(!row.enabled||row.errorCode||row.revision!==candidate.revision||row.nextFireAt===null||row.nextFireAt>now)return;
        let scheduledAt=row.nextFireAt,nextFireAt:number|null=null;
        try{
          const rule=this.rule(row);
          if(rule.timeZone!==null){
            // previousRuns excludes its second-granular reference; include the current minute.
            const cron=new Cron(rule.value,{timezone:rule.timeZone,mode:'5-part'}),latest=cron.previousRuns(1,new Date(Math.floor(now/60000)*60000+1000))[0];
            if(!latest||latest.getTime()<row.nextFireAt)invalid('schedule_cursor_invalid');
            scheduledAt=latest.getTime();nextFireAt=nextTime(rule,now);
          }else if(nextTime(rule,now)!==row.nextFireAt)invalid('schedule_cursor_invalid');
        }catch(error){if(error instanceof RuleError){this.quarantine(row,error);return;}throw error;}
        const messageId=this.options.enqueue({deliveryId:`schedule:${row.id}:${row.revision}:${scheduledAt}`,scheduleId:row.id,scheduledAt,text:row.text,sourceRef:row.sourceRef});
        if(typeof messageId!=='string'||!messageId)throw Error('schedule_enqueue_failed');
        const updated=this.db.prepare('UPDATE schedules SET enabled=?,nextFireAt=?,revision=revision+1,updatedAt=? WHERE id=? AND revision=?').run(Number(nextFireAt!==null),nextFireAt,now,row.id,row.revision);
        if(!updated.changes)throw Error('schedule_revision_conflict');
        });}catch{/* Refused inputs roll back and do not block other rules in this batch. */}
      }
    }catch{/* Preserve every cursor when the shared database is unavailable. */}
    finally{this.checking=false;this.arm();}
  }
  close(){this.closed=true;this.unobserve();if(this.timer!==undefined)this.clock.clearTimeout(this.timer);this.timer=undefined;}
}
