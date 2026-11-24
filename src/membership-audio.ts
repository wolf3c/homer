import {createHash,randomUUID} from 'node:crypto';
import {closeSync,openSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {audioModel,type createMembershipTools} from './membership-web-tools.js';

type Gateway=NonNullable<ReturnType<typeof createMembershipTools>>['audio'];
type Speech=Extract<ReturnType<Gateway['prepare']>,{input:string}>;
type AudioFile={receipt:string;model:string;state:'completed';path:string;filename:string;bytes:number;mime:string;sha256:string};
type AudioBytes={mime:string;bytes:Buffer};
const confirmedRejection=new Set(['engine_quota_insufficient','engine_rate_limited','membership_audio_request_rejected','engine_authentication_failed']);

function confirmedAudio(db:DatabaseSync,conversation:string,receipt:string,sourceRequestId?:string){
  const row=db.prepare(`SELECT responseJson FROM operations
    WHERE id=? AND actorAgentId='host' AND scopeId=? AND kind='membership_audio'
      AND state='confirmed' AND (? IS NULL OR operationId=?)`)
    .get(receipt,'membership_audio:'+conversation,sourceRequestId??null,sourceRequestId??null);
  return row?.responseJson?JSON.parse(String(row.responseJson)) as AudioFile:undefined;
}

function verifyOriginal(file:AudioFile,original:AudioBytes){
  if(original.mime!=='audio/mpeg'||original.bytes.length!==file.bytes||createHash('sha256').update(original.bytes).digest('hex')!==file.sha256)
    throw Error('membership_audio_receipt_unavailable');
}

export function verifyMembershipAudioAttachment(db:DatabaseSync,conversation:string,path:string,original:AudioBytes){
  const filename=basename(path);
  if(!/^audio-[a-f0-9-]{36}\.mp3$/.test(filename))return;
  const file=confirmedAudio(db,conversation,filename.slice(0,-4));
  if(file?.path===path)verifyOriginal(file,original);
}

export function readMembershipAudio(db:DatabaseSync,conversation:string,receipt:string,
  readFile:(path:string)=>AudioBytes,sourceRequestId?:string){
  try{
    const file=confirmedAudio(db,conversation,receipt,sourceRequestId);
    if(!file)throw Error('membership_audio_receipt_unavailable');
    verifyOriginal(file,readFile(file.path));
    return file;
  }catch{throw Error('membership_audio_receipt_unavailable');}
}

export async function runMembershipAudio(db:DatabaseSync,gateway:Gateway,conversation:string,operationScope:string,cwd:string,args:Speech,
  guard:()=>void,outputGuard:()=>void,approve:(receipt:string,signal:AbortSignal)=>Promise<boolean>){
  guard();
  const receipt='audio-'+randomUUID();
  const payloadHash=createHash('sha256').update(JSON.stringify(args)).digest('hex');
  const claimed=db.prepare(`INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson)
    VALUES(?,'host',?,?, 'membership_audio',?,'accepted','{}')
    ON CONFLICT(actorAgentId,scopeId,operationId) DO NOTHING`).run(receipt,'membership_audio:'+conversation,operationScope,payloadHash);
  if(claimed.changes===0)throw Error('membership_audio_already_requested');
  const setState=(state:string)=>db.prepare('UPDATE operations SET state=? WHERE id=?').run(state,receipt);
  const live=new AbortController();
  const monitor=setInterval(()=>{try{guard();}catch{live.abort();}},200);
  monitor.unref();
  try{
    try{
      if(!await approve(receipt,live.signal))throw Error('membership_audio_user_declined');
      outputGuard();
    }catch(error){setState('failed');throw error;}
    setState('dispatching');
    try{
      const bytes=await gateway.speak(args,live.signal);
      outputGuard();
      const filename=receipt+'.mp3',path=join(cwd,filename);
      const fd=openSync(path,'wx',0o600);
      try{try{writeFileSync(fd,bytes);}finally{closeSync(fd);}}
      catch(error){unlinkSync(path);throw error;}
      const file:AudioFile={receipt,model:audioModel,state:'completed',path,filename,bytes:bytes.length,mime:'audio/mpeg',sha256:createHash('sha256').update(bytes).digest('hex')};
      db.prepare("UPDATE operations SET state='confirmed',responseJson=? WHERE id=?").run(JSON.stringify(file),receipt);
      return file;
    }catch(error){
      if(error instanceof Error&&confirmedRejection.has(error.message)){setState('failed');throw error;}
      setState('uncertain');
      return {receipt,model:audioModel,state:'submission_unconfirmed',note:'生成结果未确认，可能已扣费。请提供核对编号，勿重新提交。'};
    }
  }finally{clearInterval(monitor);}
}
