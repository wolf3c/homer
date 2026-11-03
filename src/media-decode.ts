import {spawn} from 'node:child_process';
import {existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {verifiedDesktopResources,type DesktopResourceIdentity} from './desktop-resources.js';
import {MEDIA_POLICY,imageDimensions} from './media-policy.js';
import {TOOL_IMAGE_BYTES} from './interaction-limits.js';
// Fixed executable and argument vectors only. No shell, inherited environment or remote URLs.
export const ffmpegPath=['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg'].find(existsSync);
let desktopIdentity:DesktopResourceIdentity|undefined;
export function configureDesktopImageDecoder(identity:DesktopResourceIdentity){
 verifiedDesktopResources(identity);
 if(desktopIdentity&&JSON.stringify(desktopIdentity)!==JSON.stringify(identity))throw Error('desktop_resource_identity_conflict');
 desktopIdentity={...identity};
}
export async function mediaProcess(bin:string,args:string[],input:Buffer,maxBytes:number,signal?:AbortSignal,timeoutMs=20000,allowEmpty=false):Promise<Buffer>{
 if(desktopIdentity){
  const trusted=verifiedDesktopResources(desktopIdentity),resources=join(trusted.bundleRoot,'Contents/Resources');
  // Optional Homebrew/Python/ASR installations never become implicit desktop
  // dependencies. Keep only the verified ImageIO helper and bundled SILK codec.
  const image=bin===trusted.imageDecoder&&args.length===1&&['0','320'].includes(args[0]!);
  const silk=bin===process.execPath&&realpathSync(bin)===join(trusted.bundleRoot,'Contents/MacOS/node')&&args.length===2&&args[0]===join(resources,'homer/dist/media-silk.js')&&['decode','encode'].includes(args[1]!);
  if(!image&&!silk)throw Error('media_decoder_unavailable');
 }
 if(signal?.aborted)throw Error('media_decode_cancelled');
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,args,{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
  const chunks:Buffer[]=[];let size=0,settled=false,failure:string|undefined;
  // Wait for close even on cancellation: the caller may release a decoder slot
  // or remove its private input only after the child has actually exited.
  const fail=(code:string)=>{if(settled||failure)return;failure=code;child.kill('SIGKILL');};
  const timer=setTimeout(()=>fail('media_decode_timeout'),timeoutMs),cancel=()=>fail('media_decode_cancelled');signal?.addEventListener('abort',cancel,{once:true});
  child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>fail('media_decoder_unavailable'));
  child.stdout.on('data',chunk=>{if(failure)return;size+=chunk.length;if(size>maxBytes)fail('media_decode_size_limit');else chunks.push(Buffer.from(chunk));});
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(settled)return;settled=true;if(failure){reject(Error(failure));return;}code===0&&(size||allowEmpty)?resolve(Buffer.concat(chunks)):reject(Error('media_decode_failed'));});
  child.stdin.end(input);
 });
}
export async function modelImage(bytes:Buffer,mime:string,signal?:AbortSignal){
 return normalizeImage(bytes,mime,undefined,signal);
}
export async function imageThumbnail(bytes:Buffer,mime:string,signal?:AbortSignal){
 return normalizeImage(bytes,mime,320,signal);
}
// Only MCP tool views are bounded here. Stored originals and full-size model
// inputs keep their existing policy. Reuse the desktop's trusted thumbnail mode
// once, and avoid any decoder work for an image already within the envelope.
export async function toolImage(image:{bytes:Buffer;mime:string},signal?:AbortSignal){
 if(signal?.aborted)throw Error('media_decode_cancelled');
 const source=imageDimensions(image.bytes,image.mime);
 if(!source||!source.width||!source.height||source.width*source.height>MEDIA_POLICY.maxPixels)throw Error('media_pixel_limit');
 const resized=image.bytes.length>TOOL_IMAGE_BYTES;
 const view=resized?await imageThumbnail(image.bytes,image.mime,signal):{...image,...source};
 return {bytes:view.bytes,mime:view.mime,modelView:{source,width:view.width,height:view.height,resized,...(resized?{notice:'Downsampled tool view; fine detail may be lost. The original file is unchanged.'}:{})}};
}
async function normalizeImage(bytes:Buffer,mime:string,edge:number|undefined,signal?:AbortSignal){
 const imageIO=desktopIdentity?verifiedDesktopResources(desktopIdentity).imageDecoder:undefined;
 if(!imageIO&&!ffmpegPath)throw Error('media_decoder_unavailable');
 if(signal?.aborted)throw Error('media_decode_cancelled');
 const dims=imageDimensions(bytes,mime);if(dims&&(!dims.width||!dims.height||dims.width*dims.height>MEDIA_POLICY.maxPixels))throw Error('media_pixel_limit');
 // Intake and result readers retain their distinct source byte budgets.
 // Decode one frame and strip metadata. Only thumbnails constrain the long edge.
 // Lossless PNG can exceed the compressed source budget. Bound it by the pixel
 // budget instead: up to 16-bit RGBA plus scanline and compression overhead.
 const maxBytes=edge?512*1024:Math.max(MEDIA_POLICY.imageBytes,(dims?dims.width*dims.height:MEDIA_POLICY.maxPixels)*9+1024*1024);
 const normalized=imageIO?await mediaProcess(imageIO,[String(edge??0)],bytes,maxBytes,signal):await mediaProcess(ffmpegPath!,['-v','error','-nostdin','-threads','1','-filter_threads','1','-max_alloc','134217728','-max_pixels',String(MEDIA_POLICY.maxPixels),'-probesize','5000000','-protocol_whitelist','pipe','-i','pipe:0',...(edge?['-vf',`scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`]:[]),'-frames:v','1','-map_metadata','-1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],bytes,maxBytes,signal);
 const output=imageDimensions(normalized,'image/png');if(!output||!output.width||!output.height||output.width*output.height>MEDIA_POLICY.maxPixels||edge&&(output.width>edge||output.height>edge))throw Error('media_pixel_limit');
 return {bytes:normalized,mime:'image/png',transform:imageIO?(edge?`imageio-first-frame-fit${edge}-strip-metadata-v1`:'imageio-first-frame-source-size-strip-metadata-v1'):edge?`ffmpeg-first-frame-fit${edge}-strip-metadata-v1`:'ffmpeg-first-frame-source-size-strip-metadata-v1',...output};
}
