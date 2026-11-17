import type {WebState} from '../src/web-contract.js';
import type {HistoryPage,HistoryPageRequest} from '../src/web-history-pages.js';
type Message=WebState['messages'][number];
type CachedPage={key:string;revision:number;units:string[];messages:Message[];before:string|null;after:string|null;artifacts?:WebState['artifacts'];inactiveInteractions?:WebState['inactiveInteractions'];inactiveMore?:boolean};
// Retain the loaded suffix through latest; only its older boundary is paged.
// Detached ranges are never flattened into a pretend continuous conversation.
export class HistoryWindow{
 epoch='';thread='';revision=-1;range=0;recent?:CachedPage;pages:CachedPage[]=[];archived=false;stale=false;
 reset(epoch:string,thread:string){this.range++;this.epoch=epoch;this.thread=thread;this.revision=-1;this.recent=undefined;this.pages=[];this.archived=false;this.stale=false;}
 private reuse(messages:Message[]){
  const old=new Map([...this.pages,this.recent].flatMap(p=>p?.messages??[]).map(m=>[m.id,m]));
  return messages.map(message=>{const previous=old.get(message.id);if(!previous)return message;
   if(previous.process&&message.process&&previous.process.revision>message.process.revision)return previous;
   return JSON.stringify(previous)===JSON.stringify(message)?previous:message;
  });
 }
 private merge(left:CachedPage,right:CachedPage):CachedPage{
  const ordered=right.units.indexOf(left.units[0]!)>0?[right,left]:[left,right];
  const units=[...new Set(ordered.flatMap(p=>p.units))];
  const versions=right.revision>=left.revision?[left,right]:[right,left];
  const fresh=new Map(versions.flatMap(p=>p.messages).map(m=>[m.id,m]));
  return {...left,key:'loaded',revision:Math.max(left.revision,right.revision),units,
   messages:[...new Set(ordered.flatMap(p=>p.messages.map(m=>m.id)))].map(id=>fresh.get(id)!),
   before:units[0]===right.units[0]?right.before:left.before,
   after:units.at(-1)===right.units.at(-1)?right.after:left.after,
   artifacts:[...new Map(versions.flatMap(p=>p.artifacts??[]).map(a=>[a.id,a])).values()],
   inactiveInteractions:[...new Map(versions.flatMap(p=>p.inactiveInteractions??[]).map(i=>[i.id,i])).values()],
   inactiveMore:left.inactiveMore||right.inactiveMore};
 }
 private connectRecent(terminal=false){
  const page=this.pages[0],recent=this.recent;
  if(page&&recent&&page.units.some(id=>recent.units.includes(id))){this.pages=[this.merge(page,recent)];this.archived=!terminal&&page.revision>recent.revision;}
 }
 snapshot(state:WebState,_pinned:ReadonlySet<string>=new Set()){
  const h=state.history;if(!h||h.protocol!==3)throw Error('history_protocol_required');
  if(this.epoch!==h.readEpoch||this.thread!==state.threadId)this.reset(h.readEpoch,state.threadId);
  if(h.page.revision<this.revision)return false;
  if(this.pages.length&&h.page.revision>this.revision)this.stale=true;
  // A bounded snapshot never removes loaded rows, even outside the viewport.
  if(!this.pages.length&&this.recent&&this.recent.units.some(id=>!h.page.units.includes(id)))this.pages=[this.recent];
  const p={...h.page,key:'recent',messages:this.reuse(state.messages),artifacts:state.artifacts,inactiveInteractions:state.inactiveInteractions};
  const fresh=new Map(p.messages.map(m=>[m.id,m]));
  for(const page of this.pages)page.messages=page.messages.map(m=>fresh.get(m.id)??m);
  this.revision=h.page.revision;this.recent=p;
  if(this.pages.length){this.archived=true;this.connectRecent();}
  return true;
 }
 add(page:HistoryPage,epoch:string,direction:'before'|'after'|'around',_pinned:ReadonlySet<string>=new Set()){
  if(epoch!==this.epoch||page.threadId!==this.thread||page.revision<this.revision)return false;
  const next:CachedPage={...page,key:'loaded',messages:this.reuse(page.messages)};
  this.revision=page.revision;
  if(!page.units.length){
   if(direction==='after'&&!page.after){if(this.pages[0])this.pages[0].after=null;this.connectRecent(true);}
   return true;
  }
  if(direction==='around'){this.range++;this.pages=[next];this.archived=true;this.stale=false;}
  else{
   const current=this.pages[0]??this.recent;
   this.pages=[current?direction==='before'?this.merge(next,current):this.merge(current,next):next];
  }
  this.connectRecent(direction==='after'&&!page.after);return true;
 }
 async fillTail(read:(request:HistoryPageRequest)=>Promise<HistoryPage>,current:()=>boolean,publish:()=>void){
  const epoch=this.epoch,range=this.range;
  const valid=()=>current()&&this.epoch===epoch&&this.range===range;
  while(valid()&&this.archived){
   const after=this.after,tail=this.tail;
   if(!tail)throw Error('history_message_not_found');
   const page=await read(after?{after,limit:80}:{around:tail,limit:1});
   if(!valid())return false;
   if(!(after?this.add(page,epoch,'after'):this.updateExisting(page,epoch)))return false;
   // Only overlap with the known latest snapshot proves continuity. Empty or
   // terminal responses outside that range cannot silently declare completion.
   if(this.archived&&(after?(!page.after||this.tail===tail||this.after===after):!this.after))throw Error('history_cursor_invalid');
   publish();
  }
  return valid()&&!this.archived;
 }
 updateExisting(page:HistoryPage,epoch:string){
  if(epoch!==this.epoch||page.threadId!==this.thread||page.revision<this.revision)return false;
  const fresh=new Map(this.reuse(page.messages).map(m=>[m.id,m]));
  for(const p of [...this.pages,this.recent])if(p){p.messages=p.messages.map(m=>fresh.get(m.id)??m);
   if(page.units[0]===p.units[0])p.before=page.before;
   if(page.units.at(-1)===p.units.at(-1))p.after=page.after;
   if(page.inactiveMore)p.inactiveMore=true;
   p.artifacts=[...(p.artifacts??[]).filter(a=>!page.units.includes(a.messageId)),...(page.artifacts??[])];
   p.inactiveInteractions=[...(p.inactiveInteractions??[]).filter(i=>!(page.inactiveInteractions??[]).some(n=>n.id===i.id)),...(page.inactiveInteractions??[])];
  }return true;
 }
 get artifacts(){return [...new Map([...this.pages,this.recent].flatMap(p=>p?.artifacts??[]).map(a=>[a.id,a])).values()];}
 get inactiveInteractions(){return [...new Map([...this.pages,this.recent].flatMap(p=>p?.inactiveInteractions??[]).map(i=>[i.id,i])).values()];}
 get inactiveMore(){return [...this.pages,this.recent].some(page=>page?.inactiveMore);}
 latest(){this.range++;this.pages=[];this.archived=false;this.stale=false;}
 get messages(){return [...new Map(((this.pages[0]??this.recent)?.messages??[]).map(m=>[m.id,m])).values()];}
 get tail(){return this.pages[0]?.units.at(-1);}
 get before(){return (this.pages[0]??this.recent)?.before??null;}
 get after(){return this.archived?this.pages.at(-1)?.after??null:null;}
}
