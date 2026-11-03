// One bounded owner page. SSE updates control state; later pages are re-read at
// their original insertion cursor, never merged with an unbounded active list.
import type {ActiveReadVersion,ActiveReadResult} from '../src/web-contract.js';
export class ActiveReadPage<T>{
 version:ActiveReadVersion={threadId:'',readEpoch:'',revision:-1};
 items:T[]=[];cursor=0;more:number|null=null;checking=false;
 private desired=0;private generation=0;
 private flight?:{generation:number;after:number;threadId:string;readEpoch:string};
 invalidate(){this.generation++;this.flight=undefined;this.checking=true;}
 snapshot(version:ActiveReadVersion,items:T[],more:number|null){
  if(version.threadId!==this.version.threadId||version.readEpoch!==this.version.readEpoch){this.invalidate();this.cursor=this.desired=0;this.items=[];this.checking=false;}
  if(version.revision<this.version.revision&&version.readEpoch===this.version.readEpoch&&version.threadId===this.version.threadId)return;
  this.version=version;
  if(this.cursor===0){this.items=items;this.more=more;}else this.checking=true;
 }
 begin(after=this.desired){
  if(this.flight)return;
  this.desired=after;this.checking=true;
  return this.flight={generation:this.generation,after,threadId:this.version.threadId,readEpoch:this.version.readEpoch};
 }
 complete(token:NonNullable<ActiveReadPage<T>['flight']>,page:ActiveReadResult<T>){
  if(this.flight!==token||token.generation!==this.generation)return false;
  if(page.threadId!==this.version.threadId||page.readEpoch!==this.version.readEpoch||page.revision<this.version.revision)return false;
  this.version={...this.version,revision:page.revision};
  this.items=page.items;this.more=page.after;this.cursor=token.after;this.checking=false;return true;
 }
 finish(token:NonNullable<ActiveReadPage<T>['flight']>){if(this.flight===token)this.flight=undefined;}
 get needsRead(){return this.checking&&!this.flight;}
}
