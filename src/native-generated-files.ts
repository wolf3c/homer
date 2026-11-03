import{createHash}from'node:crypto';
import{constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync,realpathSync,existsSync,unlinkSync}from'node:fs';
import{resolve,join}from'node:path';
import{MEDIA_POLICY,detectMedia,imageDimensions}from'./media-policy.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
// Consume the current native item, never an arbitrary savedPath or credentials.
// The native original remains untouched. No authority or publication is created.
export function materializeNativeImage(cwd:string,thread:string,item:string,encoded:string){
 if(!thread||!item||thread.length>200||item.length>200||typeof encoded!=='string'||encoded.length>Math.ceil(MEDIA_POLICY.imageBytes/3)*4||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('native_image_output_invalid');
 const bytes=Buffer.from(encoded,'base64'),dimensions=imageDimensions(bytes,detectMedia(bytes));
 if(bytes.toString('base64')!==encoded||!bytes.length||bytes.length>MEDIA_POLICY.imageBytes||detectMedia(bytes)!=='image/png'||!dimensions||dimensions.width<1||dimensions.height<1||dimensions.width*dimensions.height>MEDIA_POLICY.maxPixels)throw Error('native_image_output_invalid');
 if(resolve(cwd)==='/'||realpathSync(cwd)!==resolve(cwd))throw Error('native_image_workspace_invalid');
 const filename='native-image-'+hash(thread+'\0'+item).slice(0,24)+'.png',path=join(cwd,filename),sha256=hash(bytes);
 if(existsSync(path)){
  let fd:number|undefined;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size!==bytes.length||hash(readFileSync(fd))!==sha256)throw Error('native_image_output_conflict');}catch{throw Error('native_image_output_conflict');}finally{if(fd!==undefined)closeSync(fd);}
 }else{
  let fd:number|undefined,created=false;try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;writeFileSync(fd,bytes);}catch{if(created)unlinkSync(path);throw Error('native_image_output_unconfirmed');}finally{if(fd!==undefined)closeSync(fd);}
 }
 return{filename,sha256,bytes:bytes.length,mime:'image/png'};
}
