import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';

export type NativeMemoryMode='enabled'|'disabled';
export function readNativeMemoryMode(codexHome:string,nativeId:string):NativeMemoryMode{
 if(typeof codexHome!=='string'||!isAbsolute(codexHome))throw Error('native_memory_home_invalid');
 try{if(realpathSync(codexHome)!==resolve(codexHome)||!lstatSync(codexHome).isDirectory())throw Error();}
 catch{throw Error('native_memory_home_invalid');}
 if(typeof nativeId!=='string'||!nativeId||nativeId.length>256||/[\s\x00-\x1f\x7f]/u.test(nativeId))throw Error('native_memory_thread_invalid');
 const path=join(codexHome,'state_5.sqlite');let db:DatabaseSync|undefined,value:unknown,count=0;
 try{
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error();
  db=new DatabaseSync(path,{readOnly:true});
  const rows=db.prepare('SELECT memory_mode FROM threads WHERE id=? LIMIT 2').all(nativeId);count=rows.length;value=rows[0]?.memory_mode;
 }catch{throw Error('native_memory_mode_unavailable');}finally{db?.close();}
 if(count>1)throw Error('native_memory_mode_invalid');
 if(value===undefined)throw Error('native_memory_mode_missing');
 if(value!=='enabled'&&value!=='disabled')throw Error('native_memory_mode_invalid');
 return value;
}
export async function confirmNativeMemoryMode(codexHome:string,nativeId:string,expected:NativeMemoryMode,isCurrent:()=>boolean):Promise<void>{
 if(expected!=='enabled'&&expected!=='disabled')throw Error('native_memory_mode_invalid');
 for(let attempt=0;attempt<50;attempt++){
  if(!isCurrent())throw Error('native_thread_owner_changed');
  const mode=readNativeMemoryMode(codexHome,nativeId);
  if(!isCurrent())throw Error('native_thread_owner_changed');
  if(mode===expected)return;
  if(attempt<49)await delay(20);
 }
 throw Error('native_memory_mode_mismatch');
}
