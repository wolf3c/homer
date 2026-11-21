import {isUtf8} from 'node:buffer';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {relative,sep} from 'node:path';
import type {Store} from './store.js';

export type NativeThreadBinding={logicalId:string;nativeId:string;provider:'openai'|'homer';parentNativeId:string|null};
export type NativeThreadTurn={logicalId:string;nativeId:string;turnId:string};
type WorkerEffectOwner=Pick<NativeThreadTurn,'nativeId'|'turnId'>;
export type WorkerEffect=NativeThreadTurn&{itemId:string;status:string;ownerNativeId?:string;ownerTurnId?:string};
const headKey=(id:string)=>'nativeThreadHead:v1:'+id;
const recordKey=(id:string)=>'nativeThreadBinding:v1:'+id;
const turnKey=(id:string,turn:string)=>'nativeThreadTurn:v1:'+JSON.stringify([id,turn]);
const effectPrefix=(id:string)=>'nativeWorkerEffect:v1:'+JSON.stringify(id)+':';
const effectKey=(id:string,native:string,turn:string,item:string)=>effectPrefix(id)+JSON.stringify([native,turn,item]);
const effectTerminals=new Set(['completed','failed','declined','interrupted']);
const validId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=256&&!/[\s\x00-\x1f\x7f]/u.test(id);
const invalid=():never=>{throw Error('native_thread_binding_invalid');};
const invalidEffect=():never=>{throw Error('native_worker_effect_invalid');};
function assertOwner(isCurrent:()=>boolean){if(!isCurrent())throw Error('native_thread_owner_changed');}
function binding(value:unknown):NativeThreadBinding{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const record=value as NativeThreadBinding;
 if(Object.keys(record).length!==4||!validId(record.logicalId)||!validId(record.nativeId)||!['openai','homer'].includes(record.provider)||
  record.parentNativeId!==null&&!validId(record.parentNativeId))return invalid();
 return record;
}
function parse(value:string):unknown{try{return JSON.parse(value);}catch{return invalid();}}

export class NativeThreadBindings{
 constructor(private readonly store:Store){}
 segment(nativeId:string):NativeThreadBinding|undefined{
  if(!validId(nativeId))return invalid();
  const raw=this.store.meta(recordKey(nativeId));if(raw===undefined)return undefined;
  const first=binding(parse(raw)),seen=new Set<string>();let item=first;
  if(first.nativeId!==nativeId)return invalid();
  for(;;){
   if(item.logicalId!==first.logicalId||seen.has(item.nativeId))return invalid();
   seen.add(item.nativeId);
   if(item.parentNativeId===null){if(item.nativeId!==item.logicalId)return invalid();break;}
   if(item.nativeId===item.logicalId)return invalid();
   const parent=this.store.meta(recordKey(item.parentNativeId));if(parent===undefined)return invalid();
   const next=binding(parse(parent));if(next.nativeId!==item.parentNativeId)return invalid();item=next;
  }
  return first;
 }
 current(logicalId:string):NativeThreadBinding|undefined{
  if(!validId(logicalId))return invalid();
  const head=this.store.meta(headKey(logicalId));
  if(head===undefined){if(this.store.meta(recordKey(logicalId))!==undefined)return invalid();return undefined;}
  const current=this.segment(head);if(!current||current.logicalId!==logicalId)return invalid();return current;
 }
 publish(logicalId:string,expectedNativeId:string,next:Omit<NativeThreadBinding,'logicalId'>,isCurrent:()=>boolean):void{
  if(!validId(logicalId)||!validId(expectedNativeId)||!next||typeof next!=='object'||Object.keys(next).length!==3)return invalid();
  const proposed=binding({logicalId,...next});
  this.store.transaction(()=>{
   assertOwner(isCurrent);
   const current=this.current(logicalId);
   if((current?.nativeId??logicalId)!==expectedNativeId)throw Error('native_thread_binding_conflict');
   const existing=this.segment(proposed.nativeId);
   if(existing&&(existing.logicalId!==logicalId||existing.provider!==proposed.provider||existing.parentNativeId!==proposed.parentNativeId))throw Error('native_thread_binding_conflict');
   if(current?.nativeId!==proposed.nativeId){
    if(!current){if(proposed.nativeId!==logicalId||proposed.parentNativeId!==null)return invalid();}
    else if(proposed.nativeId===logicalId||proposed.parentNativeId!==expectedNativeId)return invalid();
    if(existing)throw Error('native_thread_binding_conflict');
    this.store.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(recordKey(proposed.nativeId),JSON.stringify(proposed));
    this.store.setMeta(headKey(logicalId),proposed.nativeId);
   }
   assertOwner(isCurrent);
  });
 }
 turn(logicalId:string,turnId:string):NativeThreadTurn|undefined{
  if(!validId(logicalId)||!validId(turnId))throw Error('native_thread_turn_invalid');
  const raw=this.store.meta(turnKey(logicalId,turnId));if(raw===undefined)return undefined;
  this.current(logicalId);
  let value:NativeThreadTurn;
  try{value=JSON.parse(raw);}catch{throw Error('native_thread_turn_invalid');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||value.logicalId!==logicalId||value.turnId!==turnId||!validId(value.nativeId))throw Error('native_thread_turn_invalid');
  const owner=this.segment(value.nativeId);
  if(owner?owner.logicalId!==logicalId:value.nativeId!==logicalId)throw Error('native_thread_turn_invalid');
  return value;
 }
 bindTurn(logicalId:string,nativeId:string,turnId:string,isCurrent:()=>boolean):void{
  if(!validId(logicalId)||!validId(nativeId)||!validId(turnId))throw Error('native_thread_turn_invalid');
  const bind=()=>{
   assertOwner(isCurrent);
   if((this.current(logicalId)?.nativeId??logicalId)!==nativeId)throw Error('native_thread_binding_conflict');
   const prior=this.turn(logicalId,turnId);
   if(prior&&prior.nativeId!==nativeId)throw Error('native_thread_turn_conflict');
   if(!prior)this.store.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(turnKey(logicalId,turnId),JSON.stringify({logicalId,nativeId,turnId}));
   assertOwner(isCurrent);
  };
  if(this.store.db.isTransaction)bind();else this.store.transaction(bind);
 }
 private workerEffectOwner(logicalId:string,nativeId:string,turnId:string,owner?:WorkerEffectOwner):boolean{
  if(owner===undefined)return this.turn(logicalId,turnId)?.nativeId===nativeId;
  return !!owner&&typeof owner==='object'&&!Array.isArray(owner)&&Object.keys(owner).length===2&&validId(owner.nativeId)&&validId(owner.turnId)&&
   nativeId!==owner.nativeId&&this.segment(nativeId)===undefined&&this.turn(logicalId,owner.turnId)?.nativeId===owner.nativeId;
 }
 private workerEffect(logicalId:string,key:string,raw:string):WorkerEffect{
  let value:WorkerEffect;try{value=JSON.parse(raw);}catch{return invalidEffect();}
  if(!value||typeof value!=='object'||Array.isArray(value)||value.logicalId!==logicalId||
   !validId(value.nativeId)||!validId(value.turnId)||!validId(value.itemId)||typeof value.status!=='string'||value.status!=='pending'&&!effectTerminals.has(value.status)||
   key!==effectKey(logicalId,value.nativeId,value.turnId,value.itemId))return invalidEffect();
  const owner=Object.hasOwn(value,'ownerNativeId')||Object.hasOwn(value,'ownerTurnId')?{nativeId:value.ownerNativeId!,turnId:value.ownerTurnId!}:undefined;
  if(Object.keys(value).length!==(owner?7:5)||!this.workerEffectOwner(logicalId,value.nativeId,value.turnId,owner))return invalidEffect();
  return value;
 }
 recordWorkerEffect(logicalId:string,nativeId:string,turnId:string,itemId:string,status:string,completed:boolean,isCurrent:()=>boolean,allowCreate=true,owner?:WorkerEffectOwner):void{
  if(!validId(logicalId)||!validId(nativeId)||!validId(turnId)||!validId(itemId)||typeof status!=='string'||typeof completed!=='boolean'||typeof allowCreate!=='boolean')return invalidEffect();
  const record=()=>{
   assertOwner(isCurrent);
   if(!this.workerEffectOwner(logicalId,nativeId,turnId,owner))throw Error('native_worker_effect_turn_mismatch');
   const key=effectKey(logicalId,nativeId,turnId,itemId),raw=this.store.meta(key),prior=raw===undefined?undefined:this.workerEffect(logicalId,key,raw);
   if(prior&&(prior.ownerNativeId!==owner?.nativeId||prior.ownerTurnId!==owner?.turnId))throw Error('native_worker_effect_turn_mismatch');
   const next=completed&&effectTerminals.has(status)?status:'pending';
   // The first proven terminal stays immutable across reordered starts and conflicting terminals.
   if(!prior&&allowCreate||prior?.status==='pending'&&next!=='pending')this.store.setMeta(key,JSON.stringify({logicalId,nativeId,turnId,itemId,status:next,...(owner?{ownerNativeId:owner.nativeId,ownerTurnId:owner.turnId}:{})}));
   assertOwner(isCurrent);
  };
  if(this.store.db.isTransaction){
   this.store.db.exec('SAVEPOINT native_worker_effect');
   try{record();this.store.db.exec('RELEASE native_worker_effect');}
   catch(error){this.store.db.exec('ROLLBACK TO native_worker_effect; RELEASE native_worker_effect');throw error;}
  }else this.store.transaction(record);
 }
 pendingWorkerEffects(logicalId:string):WorkerEffect[]{
  if(!validId(logicalId))return invalidEffect();
  this.current(logicalId);
  const rows=this.store.db.prepare('SELECT key,value FROM meta WHERE instr(key,?)=1 ORDER BY key').all(effectPrefix(logicalId)) as {key:string;value:string}[];
  return rows.map(row=>this.workerEffect(logicalId,row.key,row.value)).filter(value=>value.status==='pending');
 }
 hasUnconfirmedWorkerEffects(logicalId:string):boolean{return this.pendingWorkerEffects(logicalId).length>0;}
}

// Codex 0.171.0-alpha.7 paginated rollouts may contain terminal items not yet in its index.
export async function readWorkerTerminals(home:string,path:string,nativeId:string,pending:WorkerEffect[]){
 const root=await realpath(home);
 const relativePath=relative(root,path);
 if(!['sessions','archived_sessions'].includes(relativePath.split(sep)[0]!)||await realpath(path)!==path)return [];
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||before.size>8*1024*1024)return [];
  const data=Buffer.alloc(before.size+1);
  let offset=0;
  while(offset<data.length){
   const {bytesRead}=await file.read(data,offset,data.length-offset,offset);
   if(!bytesRead)break;
   offset+=bytesRead;
  }
  const after=await lstat(path);
  if(offset!==before.size||data[offset-1]!==10||after.dev!==before.dev||after.ino!==before.ino||
     after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||await realpath(path)!==path)return [];
  const content=data.subarray(0,offset-1);
  if(!isUtf8(content))return [];
  const lines=content.toString('utf8').split('\n');
  const header=JSON.parse(lines[0]!);
  if(header.ordinal!==0||header.type!=='session_meta'||header.payload?.id!==nativeId||header.payload.history_mode!=='paginated')return [];
  const candidates=new Map(pending.map(item=>[JSON.stringify([item.turnId,item.itemId]),item]));
  const found=new Map<string,WorkerEffect>();
  for(let ordinal=1;ordinal<lines.length;ordinal++){
   const row=JSON.parse(lines[ordinal]!);
   if(row.ordinal!==ordinal)return [];
   const event=row.payload,item=event?.item;
   if(row.type!=='event_msg'||event?.type!=='item_completed'||event.thread_id!==nativeId||item?.type!=='CommandExecution')continue;
   const key=JSON.stringify([event.turn_id,item.id]),candidate=candidates.get(key);
   if(!candidate||!effectTerminals.has(item.status))continue;
   if(found.has(key))return [];
   const status=item.status==='completed'&&typeof item.exit_code==='number'&&item.exit_code!==0?'failed':item.status;
   found.set(key,{...candidate,status});
  }
  return [...found.values()];
 }finally{await file.close();}
}
