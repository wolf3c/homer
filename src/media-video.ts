import {existsSync,mkdirSync,mkdtempSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {mediaProcess,ffmpegPath} from './media-decode.js';
import {MEDIA_POLICY,detectMedia,imageDimensions} from './media-policy.js';
import {transcribeAudio} from './media-audio.js';
import {MediaWorkQueue} from './media-work.js';
const videoWork=new MediaWorkQueue(1,MEDIA_POLICY.maxItems);
const videoInput=['-protocol_whitelist','file','-format_whitelist','mov','-f','mov'];
async function probeVideo(path:string,signal?:AbortSignal){
 const ffprobe=['/opt/homebrew/bin/ffprobe','/usr/local/bin/ffprobe'].find(existsSync);if(!ffprobe)throw Error('media_decoder_unavailable');
 const probe=JSON.parse((await mediaProcess(ffprobe,['-v','error','-max_alloc','134217728',...videoInput,'-show_entries','format=duration:stream=codec_type,width,height','-of','json',path],Buffer.alloc(0),64*1024,signal)).toString());
 const duration=Number(probe.format?.duration),video=probe.streams?.find((s:any)=>s.codec_type==='video');
 if(!video||!Number.isFinite(duration)||duration<=0||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||video.width<=0||video.height<=0||video.width*video.height>MEDIA_POLICY.maxPixels)throw Error('media_video_invalid');
 return {duration,hasAudio:probe.streams.some((s:any)=>s.codec_type==='audio')};
}
async function withVideoFile<T>(bytes:Buffer,signal:AbortSignal|undefined,work:(path:string)=>Promise<T>):Promise<T>{
 if(!bytes.length||bytes.length>MEDIA_POLICY.audiovisualBytes||detectMedia(bytes)!=='video/mp4')throw Error('media_video_invalid');
 if(!ffmpegPath)throw Error('media_decoder_unavailable');
 return videoWork.run(async()=>{
  const root=resolve('.codex/private/media-tools/jobs');mkdirSync(root,{recursive:true,mode:0o700});const dir=mkdtempSync(join(root,'video-'));chmodSync(dir,0o700);
  try{const path=join(dir,'input.mp4');writeFileSync(path,bytes,{mode:0o600});return await work(path);}
  finally{rmSync(dir,{recursive:true,force:true});}
 },signal);
}
export async function videoThumbnail(bytes:Buffer,signal?:AbortSignal){
 return withVideoFile(bytes,signal,async path=>{
  await probeVideo(path,signal);
  const data=await mediaProcess(ffmpegPath!,['-v','error','-nostdin','-threads','1','-max_alloc','134217728',...videoInput,'-i',path,'-vf',"scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease",'-frames:v','1','-map_metadata','-1','-f','image2pipe','-vcodec','png','pipe:1'],Buffer.alloc(0),512*1024,signal);
  const dims=imageDimensions(data,'image/png');if(!dims||dims.width<1||dims.height<1||dims.width>320||dims.height>320)throw Error('media_video_frame_failed');
  return {bytes:data,...dims};
 });
}
export async function analyzeVideo(bytes:Buffer,signal?:AbortSignal){
 return withVideoFile(bytes,signal,async path=>{
  const input=videoInput;
  const {duration,hasAudio}=await probeVideo(path,signal);
  const end=Math.min(duration,60),frames=[];
  for(let i=0;i<6;i++){
   const time=Math.min(end*i/5,Math.max(0,end-.1));
   const data=await mediaProcess(ffmpegPath!,['-v','error','-nostdin','-threads','1','-max_alloc','134217728','-ss',String(time),...input,'-i',path,'-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease",'-frames:v','1','-map_metadata','-1','-f','image2pipe','-vcodec','png','pipe:1'],Buffer.alloc(0),8*1024*1024,signal);
   const dims=imageDimensions(data,'image/png');if(!dims)throw Error('media_video_frame_failed');frames.push({bytes:data,mime:'image/png',transform:`video-frame-${Math.round(time*1000)}ms-v1`,timestampMs:Math.round(time*1000),...dims});
  }
  let audio:Buffer|undefined,transcription:unknown;
  if(hasAudio){
   try{audio=await mediaProcess(ffmpegPath!,['-v','error','-nostdin','-threads','1','-max_alloc','134217728',...input,'-i',path,'-t',String(end),'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],Buffer.alloc(0),1920000,signal);transcription={state:'ready',...await transcribeAudio(audio,signal)};}
   catch(error){if(signal?.aborted)throw Error('media_decode_cancelled');transcription={state:'unavailable',error:error instanceof Error?error.message:'media_asr_unavailable'};}
  }
  return {frames,audio,extraction:{state:'ready',durationSeconds:duration,coverage:`视觉仅抽取0–${end.toFixed(2)}秒内6帧，最终以实际传入帧时间为准`,frameTimesMs:frames.map(f=>f.timestampMs),audio:transcription??{state:'absent'},limitations:[...(duration>60?['超过60秒部分未分析']:[]),'抽帧不覆盖所有动作或瞬间；不得称已看过全部视频'],transform:'ffmpeg-six-frames-first60s-v1'}};
 });
}
