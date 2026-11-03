import type {Attachment,AttachmentAdapter,CompleteAttachment,PendingAttachment} from '@assistant-ui/react';
import type {MediaView} from '../src/media-store.js';
import {connectionFetch} from './web-connection-client.js';

type Identity={threadId:string;requestId:string;uploadId:string;asset?:MediaView;attempted?:boolean};
export type HomerAttachment=PendingAttachment & {homer:Identity};
export type DraftContext={threadId:string;requestId:string;enabled:boolean;attachments:readonly Attachment[];notice:(text:string)=>void;removed?:(identity:Identity,file:File)=>void};
export const attachmentAsset=(value:Attachment)=>(value as HomerAttachment).homer?.asset;

/** The composer owns the only draft collection. This adapter owns upload identity,
 * not a second queue. Its WeakMaps disappear with the draft's File objects. */
export function createHomerAttachmentAdapter(context:()=>DraftContext,request:typeof connectionFetch=connectionFetch){
 const identities=new WeakMap<File,Identity>(),deferred=new WeakSet<File>(),submitted=new Set<string>();
 const identityKey=(identity:Identity)=>JSON.stringify([identity.threadId,identity.requestId,identity.uploadId]);
 function identityFor(file:File):Identity{
  const c=context();let identity=identities.get(file);if(!identity||identity.threadId!==c.threadId||identity.requestId!==c.requestId){identity={threadId:c.threadId,requestId:c.requestId,uploadId:crypto.randomUUID()};identities.set(file,identity);}return identity;
 }
 const owner={
  accept:'*',
  uploadId(file:File){return identityFor(file).uploadId;},
  confirmed(file:File){return !!identities.get(file)?.asset;},
  asset(file:File){return identityFor(file).asset;},
  retryFile(attachment:HomerAttachment){identities.set(attachment.file,attachment.homer);return attachment.file;},
  restore(asset:MediaView){
   const file=new File([],asset.filename,{type:asset.mime??''}),c=context();
   identities.set(file,{threadId:c.threadId,requestId:c.requestId,uploadId:asset.assetId,asset});
   return file;
  },
  defer(file:File){deferred.add(file);},
  markSubmitted(attachments:readonly Attachment[]){for(const attachment of attachments)submitted.add(identityKey((attachment as HomerAttachment).homer));},
  async *add({file}:{file:File}):AsyncGenerator<HomerAttachment,void>{
   const c=context();let identity=identityFor(file);
   const pending=(status:PendingAttachment['status']):HomerAttachment=>({id:identity.uploadId,type:file.type.startsWith('image/')?'image':'file',name:file.name,contentType:file.type,file,status,homer:identity});
   if(identity.asset){yield pending({type:'requires-action',reason:'composer-send'});return;}
   if(!file.size||file.size>8*1024*1024||file.name.length>120||/[\x00-\x1f/\\]/.test(file.name)){c.notice('文件须为1字节至8MiB，名称不超过120字符。');throw Error('upload_invalid_file');}
   if(c.attachments.filter(a=>a.id!==identity.uploadId).length>=10){c.notice('每条消息最多10个附件。');throw Error('upload_limit');}
   if(deferred.delete(file)){yield pending({type:'incomplete',reason:'upload-paused'});return;}
   if(!c.enabled){c.notice('暂时无法添加附件，请等待连接恢复后重试。');throw Error('upload_unavailable');}
   yield pending({type:'running',reason:'uploading',progress:0});
   c.notice('正在准备附件：'+file.name);identity.attempted=true;
   try{
    const response=await request('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Homer-Thread':identity.threadId,'X-Homer-Request':identity.requestId,'X-Homer-Upload':identity.uploadId,'X-Homer-Filename':encodeURIComponent(file.name)},body:file});
    const result=await response.json();if(!response.ok)throw Error(result.error??'web_upload_failed');
    identity={...identity,asset:result as MediaView};identities.set(file,identity);
    yield pending({type:'requires-action',reason:'composer-send'});
    c.notice('');
   }catch(error){
    const message=error instanceof Error?error.message:'web_upload_failed';
    yield pending({type:'incomplete',reason:'error',message});
    c.notice('附件准备未确认，已确认附件保留。可用原上传身份重试；刷新后需重新选择文件：'+message);
   }
  },
  async remove(attachment:Attachment){
   const {homer:identity,file}=attachment as HomerAttachment;
   if(!identity)throw Error('attachment_identity_missing');
   // Runtime clients may return a decorated copy. Consume the handoff marker
   // by original upload identity, never by the current object reference.
   if(submitted.delete(identityKey(identity)))return;
   if(!identity.asset&&!identity.attempted)return;
   try{
    const response=await request('/api/uploads/discard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:identity.threadId,requestId:identity.requestId,...(identity.asset?{assetId:identity.asset.assetId,revision:identity.asset.revision}:{uploadId:identity.uploadId})})});
    const result=await response.json();if(!response.ok)throw Error(result.error??'web_upload_failed');
    if(identities.get(file)?.uploadId===identity.uploadId)identities.delete(file);
    context().removed?.(identity,file);
   }catch(error){context().notice('附件移除未确认，暂时保留在草稿中，请核对后重试：'+(error instanceof Error?error.message:'web_upload_failed'));throw error;}
  },
  async send(attachment:PendingAttachment):Promise<CompleteAttachment>{
   if(!attachmentAsset(attachment))throw Error('attachment_upload_unconfirmed');
   // The original prepareMessage path sends only confirmed asset/revision refs.
   return {...attachment,status:{type:'complete'},content:[]};
  },
 } satisfies AttachmentAdapter & Record<string,unknown>;
 return owner;
}
export type HomerAttachmentAdapter=ReturnType<typeof createHomerAttachmentAdapter>;
