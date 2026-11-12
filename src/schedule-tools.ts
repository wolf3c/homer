import {randomUUID} from 'node:crypto';
import type {Store} from './store.js';
import {Schedules,type Schedule,type ScheduleTrigger} from './schedules.js';
import {recursiveHash,type Actor,type Authority} from './recursive-tasks.js';
import {toolOperationId} from './recursive-tools.js';

export type ScheduleSource={instanceId:string;threadId:string;creatorAgentId:string;authority:Authority};
type Caller={actor:Actor;source:ScheduleSource;allSources:boolean};
const sources=(source:ScheduleSource)=>[source.authority.sourceRequestId,...(source.authority.sourceRequestIds??[])];
const publicSchedule=({id,text,trigger,timeZone,enabled,nextFireAt,errorCode,revision,createdAt,updatedAt}:Schedule)=>({scheduleId:id,text,trigger,timeZone,enabled,nextFireAt,errorCode,revision,createdAt,updatedAt});

// Host-side authorization and original tool receipts; the scheduler never interprets a source.
export class ScheduleTools{
  constructor(private store:Store,private schedules:Schedules,private validateSource:(source:ScheduleSource)=>void){}
  private allowed(caller:Caller,ref:string){
    try{
      const source=JSON.parse(ref) as ScheduleSource;this.validateSource(source);
      if(caller.allSources)return true;
      if(caller.actor.runId&&source.creatorAgentId!==caller.actor.agentId)return false;
      return sources(source).every(id=>sources(caller.source).includes(id));
    }catch{return false;}
  }
  handle(caller:Caller,name:string,args:Record<string,unknown>,callId:string):unknown{
    this.validateSource(caller.source);
    if(name==='schedule_list'){
      if(args.receipts===true&&(args.scheduleId!==undefined||args.enabled!==undefined))throw Error('schedule_query_invalid');
      const offset=Number(args.offset??0),limit=Number(args.limit??20);
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('schedule_query_invalid');
      const items:unknown[]=[];let seen=0,more=false;
      const rows=args.receipts===true
        ?this.store.db.prepare("SELECT id,kind,detailsJson,responseJson FROM operations WHERE kind IN ('schedule_create','schedule_update','schedule_cancel') AND state='confirmed' ORDER BY rowid DESC").iterate()
        :this.store.db.prepare('SELECT id,sourceRef FROM schedules'+(args.scheduleId!==undefined?' WHERE id=?':'')+' ORDER BY createdAt DESC,rowid DESC').iterate(...(args.scheduleId!==undefined?[String(args.scheduleId)]:[]));
      for(const row of rows){
        const details=args.receipts===true?JSON.parse(String(row.detailsJson)):undefined;
        const ref=details?.sourceRef??row.sourceRef;
        if(typeof ref!=='string'||!this.allowed(caller,ref))continue;
        const schedule=args.receipts===true?undefined:this.schedules.get(String(row.id));
        if(schedule&&args.enabled!==undefined&&schedule.enabled!==args.enabled)continue;
        if(seen++<offset)continue;
        if(items.length===limit){more=true;break;}
        items.push(details?{operationKey:row.id,tool:row.kind,threadId:details.threadId,turnId:details.turnId,callId:details.callId,response:JSON.parse(String(row.responseJson))}:publicSchedule(schedule!));
      }
      return {items,nextOffset:more?offset+limit:null};
    }
    const operationId=toolOperationId(caller.actor,callId),hash=recursiveHash([name,args]);
    return this.store.transaction(()=>{
      const prior=this.store.db.prepare("SELECT * FROM operations WHERE actorAgentId=? AND scopeId='schedules' AND operationId=?").get(caller.actor.agentId,operationId);
      if(prior){
        if(prior.kind!==name||prior.payloadHash!==hash)throw Error('operation_payload_conflict');
        if(!this.allowed(caller,JSON.parse(String(prior.detailsJson)).sourceRef))throw Error('schedule_scope_denied');
        if(!prior.responseJson)throw Error('operation_uncertain');
        return JSON.parse(String(prior.responseJson));
      }
      let schedule:Schedule;
      if(name==='schedule_create')schedule=this.schedules.create({text:String(args.text),trigger:args.trigger as ScheduleTrigger,sourceRef:JSON.stringify(caller.source)});
      else{
        const previous=this.schedules.get(String(args.scheduleId));
        if(!this.allowed(caller,previous.sourceRef))throw Error('schedule_scope_denied');
        const change={scheduleId:previous.id,expectedRevision:Number(args.expectedRevision)};
        if(name==='schedule_cancel')schedule=this.schedules.cancel(change);
        else if(name==='schedule_update')schedule=this.schedules.update({...change,...(args.text!==undefined?{text:String(args.text)}:{}),...(args.trigger!==undefined?{trigger:args.trigger as ScheduleTrigger}:{}),...(args.enabled!==undefined?{enabled:args.enabled as boolean}:{}),...(args.text!==undefined&&caller.allSources?{sourceRef:JSON.stringify(caller.source)}:{})});
        else throw Error('schedule_tool_denied');
      }
      const operationKey='op-'+randomUUID(),response={...publicSchedule(schedule),operationKey};
      const details={sourceRef:schedule.sourceRef,inputMessageId:caller.actor.inputMessageId??null,threadId:caller.actor.threadId,turnId:caller.actor.turnId,callId};
      this.store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson,responseJson) VALUES(?,?,'schedules',?,?,?,'confirmed',?,?)").run(operationKey,caller.actor.agentId,operationId,name,hash,JSON.stringify(details),JSON.stringify(response));
      return response;
    });
  }
}
