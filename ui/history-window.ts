import type {WebState} from '../src/web-contract.js';
import type {HistoryPage} from '../src/web-history-pages.js';
type Message=WebState['messages'][number];
type CachedPage={key:string;revision:number;units:string[];messages:Message[];before:string|null;after:string|null;artifacts?:WebState['artifacts'];inactiveInteractions?:WebState['inactiveInteractions'];inactiveMore?:boolean};
// Five pages at most: one recent page and four navigable history pages.
// Detached ranges are never flattened into a pretend continuous conversation.
export class HistoryWindow{
 epoch='';thread='';revision=-1;recent?:CachedPage;pages:CachedPage[]=[];archived=false;stale=false;
 reset(epoch:string,thread:string){this.epoch=epoch;this.thread=thread;this.revision=-1;this.recent=undefined;this.pages=[];this.archived=false;this.stale=false;}
 private reuse(messages:Message[]){
  const old=new Map([...this.pages,this.recent].flatMap(p=>p?.messages??[]).map(m=>[m.id,m]));
  return messages.map(message=>{const previous=old.get(message.id);if(!previous)return message;
   if(previous.process&&message.process&&previous.process.revision>message.process.revision)return previous;
   return JSON.stringify(previous)===JSON.stringify(message)?previous:message;
  });
 }
 snapshot(state:WebState,pinned:ReadonlySet<string>=new Set()){
  const h=state.history;if(!h||h.protocol!==3)throw Error('history_protocol_required');
  if(this.epoch!==h.readEpoch||this.thread!==state.threadId)this.reset(h.readEpoch,state.threadId);
  if(h.page.revision<this.revision)return false;
  if(this.pages.length&&h.page.revision>this.revision)this.stale=true;
  // A bounded recent snapshot is not a deletion of the rows being read.
  if(!this.archived&&this.recent&&this.recent.messages.some(m=>pinned.has(m.id)&&!state.messages.some(n=>n.id===m.id)&&!this.pages.some(p=>p.messages.some(n=>n.id===m.id)))){
   const pages=[...this.pages,this.recent];
   if(pages.length>4){const victim=pages.findIndex(p=>!p.messages.some(m=>pinned.has(m.id)));if(victim<0)return false;pages.splice(victim,1);}
   this.pages=pages;this.archived=true;
  }
  if(this.pages.length&&this.recent&&!h.page.units.some(id=>this.recent!.units.includes(id)))this.archived=true;
  const p={...h.page,key:'recent',messages:this.reuse(state.messages),artifacts:state.artifacts,inactiveInteractions:state.inactiveInteractions};
  const fresh=new Map(p.messages.map(m=>[m.id,m]));
  for(const page of this.pages)page.messages=page.messages.map(m=>fresh.get(m.id)??m);
  this.revision=h.page.revision;this.recent=p;return true;
 }
 add(page:HistoryPage,epoch:string,direction:'before'|'after'|'around',pinned:ReadonlySet<string>=new Set()){
  if(epoch!==this.epoch||page.threadId!==this.thread||page.revision<this.revision)return false;
  const next:CachedPage={...page,key:page.units.join('|'),messages:this.reuse(page.messages)};
  if(!page.units.length)return true;
  if(direction==='around'){this.pages=[next];this.archived=true;this.stale=false;return true;}
  if(this.pages.some(p=>p.key===next.key))return true;
  let pages=direction==='before'?[next,...this.pages]:[...this.pages,next];
  // Before the first prepend, retain the old recent page as a history page.
  if(!this.archived&&!this.pages.length&&this.recent)pages=direction==='before'?[next,this.recent]:[this.recent,next];
  if(pages.length>4){
   const victim=direction==='before'?pages.at(-1)!:pages[0]!;
   if(victim.messages.some(message=>pinned.has(message.id)))throw Error('history_cache_pinned');
   pages=direction==='before'?pages.slice(0,4):pages.slice(-4);this.archived=true;
  }
  this.pages=pages;return true;
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
 latest(){this.pages=[];this.archived=false;this.stale=false;}
 get messages(){
  const pages=this.archived?this.pages:[...this.pages,this.recent].filter((p):p is CachedPage=>!!p);
  const result=new Map<string,Message>();for(const page of pages)for(const m of page.messages)result.set(m.id,m);return [...result.values()];
 }
 get before(){return (this.pages[0]??this.recent)?.before??null;}
 get after(){return this.archived?this.pages.at(-1)?.after??null:null;}
}
