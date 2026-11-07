import {createHash,randomUUID} from 'node:crypto';
import {constants,fstatSync,linkSync,openSync,closeSync,readSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {DatabaseSync} from 'node:sqlite';
import {type createMembershipTools,videoModel,videoTool} from './membership-web-tools.js';
import {detectMedia,MEDIA_POLICY} from './media-policy.js';
import {validateToolArguments} from './recursive-tools.js';

type Gateway=NonNullable<ReturnType<typeof createMembershipTools>>['video'];
type FileReceipt={path:string;filename:string;bytes:number;sha256:string;mime:'video/mp4'};
type ReceiptRow={id:string;state:string;taskId:string|null;responseJson:string|null};
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const receiptPattern=/^video-[a-f0-9-]{36}$/;

function* boxes(bytes:Buffer){
  for(let start=0;start<bytes.length;){
    if(start+8>bytes.length)throw Error('membership_video_invalid_file');
    const type=bytes.toString('ascii',start+4,start+8);
    let size=bytes.readUInt32BE(start),header=8;
    if(size===1){
      header=16;
      if(start+header>bytes.length)throw Error('membership_video_invalid_file');
      size=Number(bytes.readBigUInt64BE(start+8));
    }else if(size===0)size=bytes.length-start;
    if(size<header||start+size>bytes.length)throw Error('membership_video_invalid_file');
    yield {type,data:bytes.subarray(start+header,start+size)};
    start+=size;
  }
}

function validateMp4(bytes:Buffer){
  if(detectMedia(bytes)!=='video/mp4')throw Error('membership_video_invalid_file');
  let hasMedia=false;
  const tracks=new Set<string>();
  for(const {type,data} of boxes(bytes)){
    if(type==='mdat'&&data.length)hasMedia=true;
    if(type!=='moov')continue;
    for(const track of boxes(data)){
      if(track.type!=='trak')continue;
      for(const media of boxes(track.data)){
        if(media.type!=='mdia')continue;
        for(const handler of boxes(media.data)){
          if(handler.type==='hdlr'&&handler.data.length>=12)tracks.add(handler.data.toString('ascii',8,12));
        }
      }
    }
  }
  if(!hasMedia||!tracks.has('vide')||!tracks.has('soun'))throw Error('membership_video_invalid_file');
}

function readVerified(file:FileReceipt){
  try{
    if(realpathSync(file.path)!==file.path)return;
    const fd=openSync(file.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const stat=fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||stat.size!==file.bytes||stat.size>MEDIA_POLICY.fileBytes)return;
      const bytes=Buffer.allocUnsafe(stat.size+1);
      let offset=0;
      while(offset<bytes.length){
        const read=readSync(fd,bytes,offset,bytes.length-offset,null);
        if(!read)break;
        offset+=read;
      }
      const data=bytes.subarray(0,offset);
      if(offset===stat.size&&hash(data)===file.sha256)return data;
    }finally{closeSync(fd);}
  }catch{/* Recover through the original gateway task if the local file is unavailable. */}
}

function saveVideo(cwd:string,receipt:string,bytes:Buffer,expectedHash?:string):FileReceipt{
  validateMp4(bytes);
  const sha256=hash(bytes),filename=receipt+'-'+sha256.slice(0,12)+'.mp4',path=join(cwd,filename);
  if(expectedHash&&sha256!==expectedHash)throw Error('membership_video_result_changed');
  const file={path,filename,bytes:bytes.length,sha256,mime:'video/mp4' as const};
  if(readVerified(file))return file;
  const staging=join(cwd,'.'+filename+'-'+randomUUID()+'.part');
  const fd=openSync(staging,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    try{writeFileSync(fd,bytes);}finally{closeSync(fd);}
    try{linkSync(staging,path);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      // Preserve a changed file or a publication interrupted before staging cleanup.
      file.filename=receipt+'-'+randomUUID()+'.mp4';
      file.path=join(cwd,file.filename);
      linkSync(staging,file.path);
    }
  }finally{unlinkSync(staging);}
  return file;
}

export async function runMembershipVideo(db:DatabaseSync,gateway:Gateway,scope:{conversation:string;worker?:string},cwd:string,args:unknown,
  guard:()=>void,approve:(receipt:string,signal:AbortSignal)=>Promise<boolean>){
  validateToolArguments(args,videoTool.inputSchema);
  const {prompt:raw,receipt:requested}=args as {prompt?:string;receipt?:string};
  if((raw===undefined)===(requested===undefined))throw Error('invalid_tool_arguments');
  const prompt=raw?.trim();
  if(raw!==undefined){if(!prompt)throw Error('invalid_tool_arguments');gateway.validatePrompt(prompt);}
  if(requested!==undefined&&requested!=='latest'&&!receiptPattern.test(requested))throw Error('membership_video_receipt_denied');
  const owner=hash(JSON.stringify([scope.conversation,gateway.credential]));
  const scopeId=owner+':'+(scope.worker?hash(scope.worker):'main');
  // Main owns this chat's delegated work. Workers only receive their own grant.
  const visibleScope=scope.worker?scopeId:owner+':*';
  const row=(receipt:string)=>db.prepare(`SELECT id,state,json_extract(detailsJson,'$.gatewayTaskId') taskId,responseJson
    FROM operations WHERE actorAgentId='host' AND kind='membership_video' AND scopeId GLOB ?
    AND (?='latest' OR id=?) ORDER BY rowid DESC LIMIT 1`).get(visibleScope,receipt,receipt) as ReceiptRow|undefined;
  const live=new AbortController();
  const monitor=setInterval(()=>{try{guard();}catch{live.abort();}},200);
  monitor.unref();
  try{
    guard();
    const receipt=requested??'video-'+randomUUID();
    if(prompt){
      if(!await approve(receipt,live.signal))throw Error('membership_video_user_declined');
      guard();
      db.prepare(`INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson)
        VALUES(?,'host',?,?,'membership_video',?,'dispatching','{}')`).run(receipt,scopeId,receipt,hash(prompt));
      try{
        // After dispatch the short POST can still recover the ID if this turn stops.
        const id=await gateway.submit(prompt);
        db.prepare("UPDATE operations SET state='confirmed',detailsJson=json_object('gatewayTaskId',?) WHERE id=?").run(id,receipt);
      }catch(error){
        const code=error instanceof Error?error.message:'';
        if(['engine_quota_insufficient','engine_rate_limited','membership_video_request_rejected','engine_authentication_failed'].includes(code)){
          db.prepare("UPDATE operations SET state='failed' WHERE id=?").run(receipt);
          throw error;
        }
        db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(receipt);
      }
    }
    const saved=row(receipt);
    if(!saved)throw Error('membership_video_receipt_denied');
    const result={receipt:saved.id,model:videoModel};
    if(saved.state==='failed')return {...result,state:'failed',note:'本次生成未完成。'};
    if(!saved.taskId)return {...result,state:'submission_unconfirmed',note:'提交结果未确认，可能已扣费。请勿重新提交。'};
    const pending={...result,state:'pending',note:'可用原回执继续取回。请勿重新提交。'};
    const cached=saved.responseJson?JSON.parse(saved.responseJson) as FileReceipt:undefined;
    const poll=AbortSignal.any([live.signal,AbortSignal.timeout(240_000)]);
    try{
      guard();
      let bytes:Buffer|undefined=cached&&readVerified(cached);
      if(cached&&bytes&&cached.path===join(cwd,cached.filename))return {...result,state:'completed',...cached};
      if(!bytes){
        for(;;){
          guard();
          const status=await gateway.status(saved.taskId,poll);
          if(status==='completed')break;
          if(status==='failed')return {...result,state:'failed',note:'网关报告生成失败或任务已无法查询。'};
          if(!['queued','in_progress','pending'].includes(status))throw Error('membership_video_read_unavailable');
          await delay(15_000,undefined,{signal:poll});
        }
        guard();
        bytes=await gateway.download(saved.taskId,live.signal);
      }
      guard();
      const previousFile=row(saved.id)?.responseJson;
      const file=saveVideo(cwd,saved.id,bytes,previousFile?(JSON.parse(previousFile) as FileReceipt).sha256:undefined);
      db.prepare('UPDATE operations SET responseJson=? WHERE id=?').run(JSON.stringify(file),saved.id);
      return {...result,state:'completed',...file};
    }catch(error){
      if(poll.aborted)return pending;
      const code=error instanceof Error?error.message:'';
      return {...result,state:'retrieval_unavailable',note:code==='membership_video_access_unavailable'
        ?'网关暂不允许读取。若积分用尽或登录失效，请在原会员凭据恢复后用同一回执取回。'
        :'暂未取回可用的视频。请用原回执重试，勿重新提交。'};
    }
  }finally{clearInterval(monitor);}
}
