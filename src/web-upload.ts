import {createHash} from 'node:crypto';
import {detectMedia,type MediaKind} from './media-policy.js';
export const WEB_UPLOAD_BYTES=8*1024*1024;
export type WebUpload={threadId:string;requestId:string;uploadId:string;filename:string;data:string};
export function webUpload(value:unknown){
 const v=value as WebUpload;
 if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['threadId','requestId','uploadId','filename','data'].includes(k))||
  ![v.threadId,v.requestId,v.uploadId].every(id=>typeof id==='string'&&/^[\w:-]{1,100}$/.test(id))||
  typeof v.filename!=='string'||!v.filename.trim()||v.filename.length>120||/[\x00-\x1f/\\]/.test(v.filename)||
  typeof v.data!=='string'||!v.data.length||v.data.length>Math.ceil(WEB_UPLOAD_BYTES/3)*4||v.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(v.data))throw Error('web_upload_invalid');
 const bytes=Buffer.from(v.data,'base64');if(!bytes.length||bytes.length>WEB_UPLOAD_BYTES||bytes.toString('base64')!==v.data)throw Error('web_upload_size_limit');
 const mime=detectMedia(bytes),kind:MediaKind=mime.startsWith('image/')?'image':mime.startsWith('audio/')?'voice':mime==='video/mp4'?'video':'file';
 return {...v,bytes,mime,kind,hash:createHash('sha256').update(bytes).digest('hex')};
}
