export const POWER_INTERVALS=[5,15,30,60] as const;
export type PowerPreferences={keepAwake:boolean;pollMessages:boolean;wakeScheduled:boolean;pollIntervalMinutes:number};
export const POWER_DEFAULTS:Readonly<PowerPreferences>=Object.freeze({keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15});
export function validatePowerPreferences(value:unknown):PowerPreferences{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('power_preferences_invalid');
 const item=value as Record<string,unknown>,keys=Object.keys(item);
 if(keys.length!==4||keys.some(key=>!Object.hasOwn(POWER_DEFAULTS,key))||
  !['keepAwake','pollMessages','wakeScheduled'].every(key=>typeof item[key]==='boolean')||
  !POWER_INTERVALS.some(minutes=>minutes===item.pollIntervalMinutes))throw Error('power_preferences_invalid');
 return {keepAwake:item.keepAwake as boolean,pollMessages:item.pollMessages as boolean,wakeScheduled:item.wakeScheduled as boolean,pollIntervalMinutes:item.pollIntervalMinutes as number};
}
export type WakeEvent={id:string;at:number};
export type WakeCapability={supported:boolean;authorization:'required'|'authorized'|'denied'|'unavailable';reason?:string};
export type WakeAdapter={status:()=>Promise<WakeCapability>;authorize:()=>Promise<WakeCapability>;list:()=>Promise<WakeEvent[]>;schedule:(event:WakeEvent)=>Promise<WakeEvent>;cancel:(event:WakeEvent)=>Promise<void>;close:()=>Promise<void>};
export type PowerFacts={runtimeAvailable:boolean;executing:boolean;displayRequired:boolean;nextScheduledAt:number|null;channels:string[]};
export type DesktopPowerState={supported:boolean;preferences:PowerPreferences;runtimeAvailable:boolean;protection:'none'|'system'|'display';protectionError?:string;channels:string[];wake:{supported:boolean;authorization:WakeCapability['authorization'];status:'idle'|'unavailable'|'authorization-required'|'scheduled'|'error';nextAt:number|null;error?:string}};
type Clock={now:()=>number;setTimeout:(fn:()=>void,delay:number)=>unknown;clearTimeout:(id:unknown)=>void};
type Blocker={start:(type:'prevent-app-suspension'|'prevent-display-sleep')=>number;stop:(id:number)=>void};
type Options={blocker:Blocker;wake:WakeAdapter;eventId:()=>string;check:(afterSleep:boolean)=>Promise<void>;preferences?:PowerPreferences;onChanged?:()=>void;clock?:Clock;leadMs?:number};
const sameEvent=(a:WakeEvent,b:WakeEvent)=>a.id===b.id&&a.at===b.at;
const validEvent=(event:WakeEvent)=>!!event&&/^[a-f0-9]{32}$/.test(event.id)&&Number.isSafeInteger(event.at)&&event.at>0;

/** The host owns execution and messages; this owner holds only power resources. */
export class DesktopPowerCoordinator{
 private readonly clock:Clock;
 private readonly leadMs:number;
 private preferences:PowerPreferences;
 private facts:PowerFacts={runtimeAvailable:false,executing:false,displayRequired:false,nextScheduledAt:null,channels:[]};
 private capability:WakeCapability={supported:false,authorization:'unavailable'};
 private readCapability=true;
 private blockers=new Map<number,'system'|'display'>();
 private protectionError?:string;
 private wakeError?:string;
 private nextAt:number|null=null;
 private pollAt:number|null=null;
 private prepareUntil:number|null=null;
 private checking?:Promise<void>;
 private cancelCheck?:()=>void;
 private checkingAfterSleep=false;
 private pendingAfterSleep=false;
 private timer?:unknown;
 private retryAt=0;
 private checkedTarget?:number|null;
 private eventSources=new Map<string,{poll:boolean;scheduled:boolean}>();
 private dirty=false;
 private work?:Promise<void>;
 private closed=false;
 private closedResult?:Promise<boolean>;
 private authorization?:Promise<void>;
 private lastPublished?:string;
 constructor(private readonly options:Options){
  this.preferences=validatePowerPreferences(options.preferences??POWER_DEFAULTS);
  this.clock=options.clock??{now:Date.now,setTimeout:(fn,delay)=>{const timer=setTimeout(fn,delay);timer.unref();return timer;},clearTimeout:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};
  this.leadMs=options.leadMs??0;
  if(!Number.isSafeInteger(this.leadMs)||this.leadMs<0||this.leadMs>300_000)throw Error('power_prepare_interval_invalid');
 }
 state():DesktopPowerState{
  const protection=[...this.blockers.values()].includes('display')?'display':this.blockers.size?'system':'none';
  const needsWake=this.target()!==null;
  return {supported:true,preferences:{...this.preferences},runtimeAvailable:this.facts.runtimeAvailable&&!this.closed,protection,...(this.protectionError?{protectionError:this.protectionError}:{}),channels:[...this.facts.channels],wake:{supported:this.capability.supported,authorization:this.capability.authorization,status:this.wakeError?'error':needsWake&&!this.capability.supported?'unavailable':needsWake&&this.capability.authorization!=='authorized'?'authorization-required':this.nextAt!==null?'scheduled':'idle',nextAt:this.nextAt,...(this.wakeError?{error:this.wakeError}:{})}};
 }
 updateFacts(facts:PowerFacts){
  if(this.closed)return this.sync();
  if(!facts||typeof facts.runtimeAvailable!=='boolean'||typeof facts.executing!=='boolean'||typeof facts.displayRequired!=='boolean'||
   facts.nextScheduledAt!==null&&(!Number.isSafeInteger(facts.nextScheduledAt)||facts.nextScheduledAt<=0)||
   !Array.isArray(facts.channels)||facts.channels.length>16||facts.channels.some(channel=>typeof channel!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(channel)))throw Error('power_facts_invalid');
  this.facts={...facts,channels:[...new Set(facts.channels)]};
  this.updatePolling();
  this.pruneEventSources();
  if(this.prepareUntil!==this.facts.nextScheduledAt||!this.preferences.wakeScheduled||!facts.runtimeAvailable)this.prepareUntil=null;
  this.protect();return this.sync();
 }
 setPreferences(preferences:PowerPreferences){
  const next=validatePowerPreferences(preferences),intervalChanged=next.pollIntervalMinutes!==this.preferences.pollIntervalMinutes;
  if(next.pollMessages!==this.preferences.pollMessages||next.wakeScheduled!==this.preferences.wakeScheduled)this.readCapability=true;
  this.preferences=next;if(intervalChanged)this.pollAt=null;
  this.updatePolling();
  this.pruneEventSources();
  if(!next.wakeScheduled)this.prepareUntil=null;
  this.protect();return this.sync();
 }
 async refresh(){this.protect();this.readCapability=true;await this.sync();}
 authorize(){
  return this.authorization??=(async()=>{
   await this.sync();if(this.closed)return;
   try{this.capability=await this.options.wake.authorize();this.wakeError=undefined;}
   catch{this.wakeError='wake_authorization_unconfirmed';}
   this.checkedTarget=undefined;await this.sync();
  })().finally(()=>{this.authorization=undefined;});
 }
 async resume(afterSleep=true){
  if(this.closed||!this.facts.runtimeAvailable)return;
  const due=this.facts.nextScheduledAt,now=this.clock.now();
  if(this.preferences.wakeScheduled&&due!==null&&due>now&&due-now<=this.leadMs)this.prepareUntil=due;
  await this.check(afterSleep);this.readCapability=true;await this.sync();
 }
 sync():Promise<void>{
  this.dirty=true;
  if(!this.work){
   this.work=(async()=>{while(this.dirty){this.dirty=false;await this.reconcile();}})().finally(()=>{this.work=undefined;this.arm();this.changed();});
  }
  return this.work;
 }
 close():Promise<boolean>{
  return this.closedResult??=(async()=>{
   this.closed=true;this.prepareUntil=null;this.pollAt=null;this.pruneEventSources();this.protect();
   if(this.timer!==undefined){this.clock.clearTimeout(this.timer);this.timer=undefined;}
   this.cancelCheck?.();await this.checking;
   this.readCapability=true;await this.sync();
   try{await this.options.wake.close();}catch{this.wakeError='wake_cleanup_unconfirmed';}
   this.changed();return !this.wakeError&&!this.protectionError;
  })();
 }
 private updatePolling(){
  if(this.closed||!this.facts.runtimeAvailable||!this.preferences.pollMessages||!this.facts.channels.length)this.pollAt=null;
  else this.pollAt??=this.clock.now()+this.preferences.pollIntervalMinutes*60_000;
 }
 private wakeTimes():{scheduled:number|null;poll:number|null}{
  if(this.closed||!this.facts.runtimeAvailable)return {scheduled:null,poll:null};
  const now=this.clock.now(),due=this.preferences.wakeScheduled?this.facts.nextScheduledAt:null;
  const scheduled=due!==null&&due>now?(due-this.leadMs>now?due-this.leadMs:due):null;
  const poll=this.pollAt!==null&&this.pollAt>now?this.pollAt:null;
  return {scheduled:scheduled===null?null:Math.ceil(scheduled/1000)*1000,poll:poll===null?null:Math.ceil(poll/1000)*1000};
 }
 private target():number|null{
  const {scheduled,poll}=this.wakeTimes();
  return scheduled===null?poll:poll===null?scheduled:Math.min(scheduled,poll);
 }
 private rememberEvent(event:WakeEvent){
  const times=this.wakeTimes();this.eventSources.set(event.id,{poll:times.poll===event.at,scheduled:times.scheduled===event.at});
 }
 private pruneEventSources(){
  const poll=!this.closed&&this.pollAt!==null,scheduled=!this.closed&&this.facts.runtimeAvailable&&this.preferences.wakeScheduled&&this.facts.nextScheduledAt!==null;
  for(const source of this.eventSources.values()){
   if(source.poll&&!poll){source.poll=false;this.readCapability=true;}
   if(source.scheduled&&!scheduled){source.scheduled=false;this.readCapability=true;}
  }
 }
 private protect(){
  const alive=this.facts.runtimeAvailable&&!this.closed;
  const required=alive&&(this.facts.displayRequired?'display':this.facts.executing||this.preferences.keepAwake||!!this.checking||this.prepareUntil!==null?'system':undefined);
  this.protectionError=undefined;
  if(required&&![...this.blockers.values()].includes(required)){
   try{const id=this.options.blocker.start(required==='display'?'prevent-display-sleep':'prevent-app-suspension');if(!Number.isSafeInteger(id)||id<0)throw Error('invalid_blocker');this.blockers.set(id,required);}
   catch{this.protectionError='power_protection_unconfirmed';this.changed();return;}
  }
  for(const [id,type]of this.blockers)if(type!==required){
   try{this.options.blocker.stop(id);this.blockers.delete(id);}
   catch{this.protectionError='power_release_unconfirmed';}
  }
  this.changed();
 }
 private async readEvents(){
  const events=await this.options.wake.list();
  if(!Array.isArray(events)||events.length>128||events.some(event=>!validEvent(event)))throw Error('wake_events_invalid');
  return events;
 }
 private async reconcileEvents(){
  const events=await this.readEvents(),active:WakeEvent[]=[];
  for(const id of this.eventSources.keys())if(!events.some(event=>event.id===id))this.eventSources.delete(id);
  for(const event of events){
   if(event.at===this.target())this.rememberEvent(event);
   const source=this.eventSources.get(event.id);
   if(event.at>this.clock.now()&&source&&(source.poll||source.scheduled)){active.push(event);continue;}
   try{await this.options.wake.cancel(event);}catch{throw Error('wake_cleanup_unconfirmed');}
   this.eventSources.delete(event.id);
  }
  return active;
 }
 private async reconcile(){
  try{
   const target=this.target();
   const needsNative=target!==null||this.wakeError==='wake_cleanup_unconfirmed';
   if(!this.readCapability&&this.checkedTarget===target&&(!this.retryAt||this.retryAt>this.clock.now()))return;
   if(this.checkedTarget===target&&this.retryAt)this.readCapability=true;
   if(this.readCapability||needsNative&&this.capability.authorization==='unavailable'){this.readCapability=false;this.capability=await this.options.wake.status();}
   if(!this.capability.supported||this.capability.authorization!=='authorized'){
    if(this.nextAt!==null||target===null&&this.wakeError)this.wakeError=target===null?'wake_cleanup_unconfirmed':'wake_state_unconfirmed';
    this.checkedTarget=target;this.retryAt=target!==null||this.wakeError==='wake_cleanup_unconfirmed'?this.clock.now()+(this.capability.authorization==='unavailable'?30_000:60_000):0;
    return;
   }
   let events=await this.reconcileEvents(),chosen=target===null?undefined:events.find(event=>event.at===target);
   if(target!==null&&!chosen){
    // Keep one confirmed backup while retiring residue from an earlier replacement.
    if(events.length>1){
     const backup=events.find(event=>event.at===this.nextAt&&event.at>this.clock.now())??events.find(event=>event.at>this.clock.now())??events[0]!;
     for(const event of events)if(!sameEvent(event,backup))await this.options.wake.cancel(event);
     events=await this.reconcileEvents();
    }
    const candidate={id:this.options.eventId(),at:target};if(!validEvent(candidate))throw Error('wake_event_invalid');
    this.rememberEvent(candidate);
    try{await this.options.wake.schedule(candidate);}catch{/* Read back after an unknown result before attempting another create. */}
    events=await this.reconcileEvents();chosen=events.find(event=>sameEvent(event,candidate));
    if(!chosen){
     this.nextAt=events.filter(event=>event.at>this.clock.now()).sort((a,b)=>a.at-b.at)[0]?.at??null;
     this.wakeError='wake_schedule_unconfirmed';this.checkedTarget=target;this.retryAt=this.clock.now()+30_000;return;
    }
   }
   // A preference change or close can overtake native registration.
   if(this.target()!==target){this.dirty=true;return;}
   if(chosen)this.rememberEvent(chosen);
   let clean=true;
   for(const event of events)if(!chosen||!sameEvent(event,chosen))try{await this.options.wake.cancel(event);}catch{clean=false;}
   this.nextAt=chosen?.at??null;this.checkedTarget=target;
   this.retryAt=clean&&target===null?0:this.clock.now()+(clean?60_000:30_000);
   this.wakeError=clean?undefined:'wake_cleanup_unconfirmed';
  }catch(error){
   this.wakeError=this.target()===null||error instanceof Error&&error.message==='wake_cleanup_unconfirmed'?'wake_cleanup_unconfirmed':'wake_state_unconfirmed';
   this.checkedTarget=this.target();this.retryAt=this.clock.now()+30_000;
  }
 }
 private check(afterSleep=false):Promise<void>{
  if(this.checking){if(afterSleep&&!this.checkingAfterSleep)this.pendingAfterSleep=true;return this.checking;}
  if(this.closed||!this.facts.runtimeAvailable)return Promise.resolve();
  let timeout:unknown;
  this.checkingAfterSleep=afterSleep;
  this.checking=Promise.race([Promise.resolve().then(()=>this.options.check(afterSleep)),new Promise<void>(resolve=>{this.cancelCheck=resolve;timeout=this.clock.setTimeout(resolve,20_000);})]).catch(()=>{}).finally(async()=>{
   if(timeout!==undefined)this.clock.clearTimeout(timeout);
   this.cancelCheck=undefined;
   if(this.pollAt!==null)this.pollAt=this.clock.now()+this.preferences.pollIntervalMinutes*60_000;
   if(this.prepareUntil!==null&&this.prepareUntil<=this.clock.now())this.prepareUntil=null;
   await this.sync();
   this.checking=undefined;
   const repeat=this.pendingAfterSleep;this.pendingAfterSleep=false;
   if(repeat&&!this.closed)void this.check(true);
   this.protect();
  });
  this.protect();return this.checking;
 }
 private arm(){
  if(this.timer!==undefined){this.clock.clearTimeout(this.timer);this.timer=undefined;}
  if(this.closed||!this.facts.runtimeAvailable)return;
  const now=this.clock.now(),due=this.preferences.wakeScheduled?this.facts.nextScheduledAt:null;
  const candidates=[this.pollAt!==null&&(!this.checking||this.pollAt>now)?this.pollAt:null,this.prepareUntil!==null&&(!this.checking||this.prepareUntil>now)?this.prepareUntil:null,due!==null&&due>now?due:null,this.retryAt>now?this.retryAt:null].filter((at):at is number=>at!==null);
  if(!candidates.length)return;
  const delay=Math.max(1,Math.min(60_000,Math.min(...candidates)-now));
  this.timer=this.clock.setTimeout(()=>{
   this.timer=undefined;const time=this.clock.now();
   if(this.prepareUntil!==null&&this.prepareUntil<=time||this.pollAt!==null&&this.pollAt<=time)void this.check();
   void this.sync();
  },delay);
 }
 private changed(){
  const state=JSON.stringify(this.state());if(state===this.lastPublished)return;this.lastPublished=state;
  try{this.options.onChanged?.();}catch{/* Power status cannot block business execution. */}
 }
}
