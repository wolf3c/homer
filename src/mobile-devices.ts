import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const deviceName=(value:unknown)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=60&&!/[\p{Cc}\p{Cf}]/u.test(value)?value.trim():'未知设备';
const expiredRetention=24*60*60*1000,maxExpired=128;
type Device={id:string;name:string;enabled:number};

// The stable gateway owns authorization; the Agent never receives credentials.
export class MobileDevices {
 private db:DatabaseSync;
 private invitation?:{hash:string;expiresAt:number;candidate?:{id:string;hash:string;name:string}};
 private expired=new Map<string,number>();
 private revoked=new Set<(id:string)=>void>();
 constructor(path:string,private now=Date.now){
  this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS mobile_devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,credentialHash TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL)');
 }
 private pending(){
  const now=this.now();for(const [key,until] of this.expired)if(until<=now)this.expired.delete(key);
  if(this.invitation&&this.invitation.expiresAt<=now){
   const {candidate,expiresAt}=this.invitation;
   if(candidate&&expiresAt+expiredRetention>now){this.expired.set(candidate.hash,expiresAt+expiredRetention);if(this.expired.size>maxExpired)this.expired.delete(this.expired.keys().next().value!);}
   this.invitation=undefined;
  }
  return this.invitation;
 }
 state(){
  const pending=this.pending()?.candidate;
  const devices=(this.db.prepare('SELECT id,name,enabled FROM mobile_devices ORDER BY rowid').all() as Device[]).map(row=>({...row,enabled:!!row.enabled}));
  return {configured:true as const,devices,pending:pending?{id:pending.id,name:pending.name}:null,expiresAt:this.pending()?.expiresAt??null};
 }
 invite(origin:string){
  this.pending();
  const token=secret(),expiresAt=this.now()+5*60*1000;
  this.invitation={hash:hash(token),expiresAt};
  return {url:origin+'#'+token,expiresAt};
 }
 pair(token:unknown,credential?:string,name?:unknown){
  if(credential&&this.authorize(credential))return {credential,status:'active' as const};
  const invitation=this.pending();
  if(!invitation||typeof token!=='string'||token.length>100||hash(token)!==invitation.hash)throw Error('mobile_invitation_expired');
  if(invitation.candidate){
   if(credential&&hash(credential)===invitation.candidate.hash)return {credential,status:'pending' as const};
   throw Error('mobile_pairing_busy');
  }
  const value=secret();invitation.candidate={id:randomUUID(),hash:hash(value),name:deviceName(name)};
  return {credential:value,status:'pending' as const};
 }
 authorize(credential?:string){
  if(!credential||! /^[A-Za-z0-9_-]{43}$/.test(credential))return;
  return (this.db.prepare('SELECT id FROM mobile_devices WHERE credentialHash=? AND enabled=1').get(hash(credential)) as {id:string}|undefined)?.id;
 }
 status(credential?:string):'active'|'pending'|'expired'|'denied'{
  if(this.authorize(credential))return 'active';
  const pending=this.pending(),value=credential&&hash(credential);
  if(value&&pending?.candidate?.hash===value)return 'pending';
  return value&&this.expired.has(value)?'expired':'denied';
 }
 cancelPairing(credential:string):'cancelled'|'approved'|'absent'{
  const pending=this.pending(),value=hash(credential);
  if(pending?.candidate?.hash===value){this.invitation=undefined;return 'cancelled';}
  if(this.db.prepare('SELECT id FROM mobile_devices WHERE credentialHash=?').get(value))return 'approved';
  return 'absent';
 }
 approve(id:unknown,name:unknown='移动设备'){
  const candidate=this.pending()?.candidate;
  if(!candidate||id!==candidate.id)throw Error('mobile_candidate_missing');
  if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw Error('mobile_name_invalid');
  this.db.prepare('INSERT INTO mobile_devices(id,name,credentialHash,enabled) VALUES(?,?,?,1)').run(candidate.id,name.trim(),candidate.hash);
  this.invitation=undefined;
 }
 reject(id:unknown){if(!this.pending()?.candidate||id!==this.pending()!.candidate!.id)throw Error('mobile_candidate_missing');this.invitation=undefined;}
 update(id:unknown,input:{name?:unknown;enabled?:unknown}){
  if(typeof id!=='string'||!this.db.prepare('SELECT id FROM mobile_devices WHERE id=?').get(id))throw Error('mobile_device_missing');
  if(input.name!==undefined&&(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>60))throw Error('mobile_name_invalid');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw Error('mobile_enabled_invalid');
  if(typeof input.name==='string'){
   this.db.prepare('UPDATE mobile_devices SET name=? WHERE id=?').run(input.name.trim(),id);
  }
  if(input.enabled!==undefined){
   this.db.prepare('UPDATE mobile_devices SET enabled=? WHERE id=?').run(Number(input.enabled),id);
   if(!input.enabled)for(const listener of this.revoked)listener(id);
  }
 }
 remove(id:unknown){
  if(typeof id!=='string')throw Error('mobile_device_missing');
  if(!this.db.prepare('DELETE FROM mobile_devices WHERE id=?').run(id).changes)throw Error('mobile_device_missing');
  for(const listener of this.revoked)listener(id);
 }
 onRevoke(listener:(id:string)=>void){this.revoked.add(listener);return()=>{this.revoked.delete(listener);};}
 close(){this.revoked.clear();this.expired.clear();this.db.close();}
}
