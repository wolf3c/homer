import {createContext,useContext,useEffect,useState} from 'react';
import {ComposerPrimitive,useAui,useAuiState} from '@assistant-ui/react';
import {attachmentAsset,type HomerAttachment} from './homer-attachment-adapter';
import {AttachmentUI} from './vendor/assistant-ui/attachment';
import {connectionFetch} from './web-connection-client';

const Controls=createContext({blocked:false,busy:false,removing:(_busy:boolean)=>{},removed:(_id:string)=>{},annotationCount:(_asset:{assetId:string;revision:number}):number=>0,edit:undefined as (()=>void)|undefined});
export async function readDraftAttachmentImage(attachment:HomerAttachment,signal:AbortSignal):Promise<Blob>{
 const {file,homer}=attachment;
 if(file.size)return file;
 const {threadId,requestId,asset}=homer;
 if(!asset)throw Error('preview_unavailable');
 const response=await connectionFetch('/api/uploads/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId,requestId,assetId:asset.assetId,revision:asset.revision}),signal});
 if(!response.ok)throw Error('preview_unavailable');
 return response.blob();
}
function DraftAttachment(){
 const aui=useAui(),attachment=useAuiState(s=>s.attachment) as HomerAttachment;
 const controls=useContext(Controls),[preview,setPreview]=useState('');
 const asset=attachmentAsset(attachment);
 useEffect(()=>{
  if(!attachment.file?.type.startsWith('image/'))return;
  const controller=new AbortController();let url='';
  setPreview('');
  const show=(blob:Blob)=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setPreview(url);};
  void readDraftAttachmentImage(attachment,controller.signal).then(show).catch(()=>{});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[attachment.id]);
 async function remove(){controls.removing(true);try{await aui.attachment().remove();controls.removed(asset?.assetId??attachment.id);}catch{/* Adapter reports the error; runtime retains the exact attachment. */}finally{controls.removing(false);}}
 // The installed Remove primitive drops its Promise; keep rejection handling
 // here so a failed discard retains the exact attachment and original identity.
 const description=asset?'已准备 · '+(asset.size/1024).toFixed(1)+' KB':attachment.status.type==='running'?'正在准备':'准备未确认';
 return <div className="context-attachment-item"><AttachmentUI src={preview||undefined} removeDisabled={controls.busy||controls.blocked} onRemove={remove}
  onPreview={controls.edit}
  removeLabel={asset&&controls.annotationCount(asset)?`移除原图及 ${controls.annotationCount(asset)} 条批注` :undefined}
  description={description}/><div className="context-attachment-copy"><span title={attachment.name}>{attachment.name}</span><span>{attachment.type==='image'?'图片附件':'文件附件'} · {description}</span></div></div>;
}
export function HomerAttachmentByIndex({index,blocked,busy,removing,removed,annotationCount,edit}:{index:number;annotationCount:(asset:{assetId:string;revision:number})=>number;blocked:boolean;busy:boolean;removing:(busy:boolean)=>void;removed:(id:string)=>void;edit?:()=>void}){
 return <Controls.Provider value={{blocked,busy,removing,removed,annotationCount,edit}}><ComposerPrimitive.AttachmentByIndex index={index} components={{Attachment:DraftAttachment}}/></Controls.Provider>;
}
