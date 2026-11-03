import {existsSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mediaProcess,ffmpegPath} from './media-decode.js';
export const whisperPath=['/opt/homebrew/bin/whisper-cli','/usr/local/bin/whisper-cli'].find(existsSync);
export const whisperModel=resolve('.codex/private/media-tools/models/ggml-base.bin');
const codec=()=>{const ts=import.meta.url.endsWith('.ts');return [...(ts?['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url))]:[]),fileURLToPath(new URL(ts?'./media-silk.ts':'./media-silk.js',import.meta.url))];};
const scratch=resolve('.codex/private/media-tools/jobs');
export async function audioPcm(bytes:Buffer,mime:string,signal?:AbortSignal,raw?:{encodeType?:number;sampleRate?:number;bitsPerSample?:number}){
 if(mime==='audio/silk')return mediaProcess(process.execPath,[...codec(),'decode'],bytes,1920000,signal,20000);
 if(!ffmpegPath)throw Error('media_decoder_unavailable');
 const args=['-v','error','-nostdin','-threads','1','-max_alloc','134217728'];
 if(mime==='application/octet-stream'){
  if(raw?.encodeType!==1||raw.bitsPerSample!==16||![8000,12000,16000,24000,32000,44100,48000].includes(raw.sampleRate??0))throw Error('media_audio_encoding_unsupported');
  args.push('-f','s16le','-ar',String(raw.sampleRate),'-ac','1');
 }else{
  const format=({'audio/wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg'} as Record<string,string>)[mime];
  if(!format)throw Error('media_audio_encoding_unsupported');
  args.push('-format_whitelist',format,'-f',format);
 }
 args.push('-protocol_whitelist','pipe');
 return mediaProcess(ffmpegPath,[...args,'-i','pipe:0','-t','60','-ac','1','-ar','16000','-f','s16le','pipe:1'],bytes,1920000,signal);
}
export function pcmWav(pcm:Buffer,sampleRate=16000){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(sampleRate,24);h.writeUInt32LE(sampleRate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
export async function transcribeAudio(pcm:Buffer,signal?:AbortSignal){
 if(!whisperPath||!existsSync(whisperModel))throw Error('media_asr_unavailable');
 if(!pcm.length||pcm.length>1920000)throw Error('media_audio_duration_limit');
 mkdirSync(scratch,{recursive:true,mode:0o700});const dir=mkdtempSync(join(scratch,'asr-'));chmodSync(dir,0o700);
 try{const path=join(dir,'input.wav');writeFileSync(path,pcmWav(pcm),{mode:0o600});const raw=await mediaProcess(whisperPath,['-m',whisperModel,'-f',path,'-l','auto','-t','4','-np','-nt','-ng'],Buffer.alloc(0),256*1024,signal,90000);
  const text=raw.toString().trim();if(!text)throw Error('media_asr_empty');return {text,coverage:`0–${(pcm.length/32000).toFixed(2)}秒`,transform:'whisper-cpp-ggml-base-v1',limitations:['自动识别可能有误；不是用户键入文字，未验证每个词'],modelSha256:'60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
export async function synthesizeVoice(text:string,signal?:AbortSignal){
 if(!existsSync('/usr/bin/say')||!ffmpegPath)throw Error('media_tts_unavailable');
 if(!text.trim()||text.length>800)throw Error('media_tts_text_limit');
 mkdirSync(scratch,{recursive:true,mode:0o700});const dir=mkdtempSync(join(scratch,'tts-'));chmodSync(dir,0o700);
 try{const path=join(dir,'spoken.aiff');await mediaProcess('/usr/bin/say',['-v',/[\u3400-\u9fff]/u.test(text)?'Tingting':'Samantha','-o',path,'-f','-'],Buffer.from(text),1,signal,20000,true);
  const pcm=await mediaProcess(ffmpegPath,['-v','error','-nostdin','-i','pipe:0','-t','60','-ac','1','-ar','24000','-f','s16le','pipe:1'],readFileSync(path),2880000,signal);
  const silk=await mediaProcess(process.execPath,[...codec(),'encode'],pcm,4*1024*1024,signal);
  return {bytes:silk,mime:'audio/silk',duration:Math.round(pcm.length/48),sampleRate:24000,sha256:createHash('sha256').update(silk).digest('hex'),transform:'macos-say-silk24k-v1'};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
