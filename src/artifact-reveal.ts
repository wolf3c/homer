import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {promisify} from 'node:util';
import type {MediaAsset} from './media-store.js';

const execute=promisify(execFile);
const finder=async(command:string,args:string[])=>{await execute(command,args,{timeout:10000,maxBuffer:4096});};
type RevealTarget = {path:string;target:'source'|'snapshot'};

export function attachmentRevealTarget(
 db:DatabaseSync, snapshot:{asset:MediaAsset;path:string}, readSource:(path:string)=>{bytes:Buffer},
):RevealTarget{
 const {asset,path}=snapshot;
 const fallback:RevealTarget={path,target:'snapshot'};
 if(!asset.originOperationKey)return fallback;
 const operation=db.prepare(`SELECT detailsJson,responseJson FROM operations
  WHERE id=? AND kind='attachment_stage' AND state='confirmed'`).get(asset.originOperationKey);
 if(!operation)return fallback;
 try{
  const refs=JSON.parse(String(operation.responseJson));
  const {inputs}=JSON.parse(String(operation.detailsJson));
  if(!Array.isArray(refs)||!Array.isArray(inputs)||refs.length!==inputs.length)return fallback;
  const index=refs.findIndex(ref=>ref?.assetId===asset.id&&ref?.revision===asset.revision);
  const original=inputs[index]?.path;
  if(typeof original!=='string'||original===path)return fallback;
  const {bytes}=readSource(original);
  if(bytes.length===asset.size&&createHash('sha256').update(bytes).digest('hex')===asset.hash)
   return {path:original,target:'source'};
 }catch{/* Stale or unreadable originals must not block the verified snapshot. */}
 return fallback;
}

// This is a local user action, never an agent tool or a path/command API.
export async function revealAttachmentFile({path,target}:RevealTarget,{platform=process.platform,launch=finder}:{platform?:string;launch?:(command:string,args:string[])=>Promise<void>}={}){
 if(platform!=='darwin')throw Error('artifact_reveal_unsupported');
 try{await launch('/usr/bin/open',['-R',path]);}
 catch{throw Error('artifact_reveal_failed');}
 // open's exit code acknowledges dispatch, not a visible Finder window.
 return {target,device:'homer-host' as const};
}
