// Homer limits, not provider protocol limits. Shared by intake, transport and UI.
export const MEDIA_POLICY=Object.freeze({imageBytes:20*1024*1024,fileBytes:50*1024*1024,audiovisualBytes:100*1024*1024,messageBytes:150*1024*1024,maxItems:10,maxPixels:40_000_000,diskBytes:1024*1024*1024,concurrency:2,attempts:3,retentionMs:30*86400_000,downloadTimeoutMs:30000});
export type MediaKind='image'|'file'|'voice'|'video';
export function mediaLimit(kind:MediaKind){return kind==='image'?MEDIA_POLICY.imageBytes:kind==='file'?MEDIA_POLICY.fileBytes:MEDIA_POLICY.audiovisualBytes;}
export function detectMedia(bytes:Buffer):string {
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))return 'image/gif';
 if(bytes.subarray(0,4).toString()==='RIFF')return bytes.subarray(8,12).toString()==='WEBP'?'image/webp':bytes.subarray(8,12).toString()==='WAVE'?'audio/wav':'application/octet-stream';
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(bytes.subarray(4,8).toString()==='ftyp')return 'video/mp4';
 if(bytes.subarray(0,4).toString()==='OggS')return 'audio/ogg';
 if(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&((bytes[1]??0)&224)===224)return 'audio/mpeg';
 if(bytes.subarray(0,16).includes(Buffer.from('#!SILK_V3')))return 'audio/silk';
 if(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4)return 'application/zip';
 return 'application/octet-stream';
}
export function imageDimensions(bytes:Buffer,mime:string):{width:number;height:number}|undefined{
 if(mime==='image/png'&&bytes.length>=24)return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 if(mime==='image/jpeg'){
  let i=2;while(i+9<bytes.length){if(bytes[i]!==255)break;const marker=bytes[i+1]!;i+=2;if(marker===216||marker===217)continue;const len=bytes.readUInt16BE(i);if(len<2||i+len>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {height:bytes.readUInt16BE(i+3),width:bytes.readUInt16BE(i+5)};i+=len;}
 }
 return;
}
