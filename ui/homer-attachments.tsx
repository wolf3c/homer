import {createContext,useContext,useEffect,useState} from 'react';
import {ComposerPrimitive,useAui,useAuiState} from '@assistant-ui/react';
import {attachmentAsset,type HomerAttachment} from './homer-attachment-adapter';
import {AttachmentUI} from './vendor/assistant-ui/attachment';
import {connectionFetch} from './web-connection-client';

const Controls=createContext({blocked:false,busy:false,removing:(_busy:boolean)=>{},removed:(_id:string)=>{},annotationCount:(_asset:{assetId:string;revision:number}):number=>0});
function DraftAttachment(){
 const aui=useAui(),attachment=useAuiState(s=>s.attachment) as HomerAttachment;
 const controls=useContext(Controls),[preview,setPreview]=useState('');
 const asset=attachmentAsset(attachment);
 useEffect(()=>{
  const file=attachment.file,identity=attachment.homer;
  if(!file?.type.startsWith('image/'))return;
  const controller=new AbortController();let url='';
  setPreview('');
  const show=(blob:Blob)=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setPreview(url);};
  if(file.size)show(file);
  else if(identity?.asset)void connectionFetch('/api/uploads/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId:identity.threadId,requestId:identity.requestId,assetId:identity.asset.assetId,revision:identity.asset.revision}),signal:controller.signal})
   .then(response=>{if(!response.ok)throw Error('preview_unavailable');return response.blob();}).then(show).catch(()=>{});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[attachment.id]);
 async function remove(){controls.removing(true);try{await aui.attachment().remove();controls.removed(asset?.assetId??attachment.id);}catch{/* Adapter reports the error; runtime retains the exact attachment. */}finally{controls.removing(false);}}
 // The installed Remove primitive drops its Promise; keep rejection handling
 // here so a failed discard retains the exact attachment and original identity.
 const description=asset?'已准备 · '+(asset.size/1024).toFixed(1)+' KB':attachment.status.type==='running'?'正在准备':'准备未确认';
 return <div className="context-attachment-item"><AttachmentUI src={preview||undefined} removeDisabled={controls.busy||controls.blocked} onRemove={remove}
  removeLabel={asset&&controls.annotationCount(asset)?`移除原图及 ${controls.annotationCount(asset)} 条批注` :undefined}
  description={description}/><div className="context-attachment-copy"><span title={attachment.name}>{attachment.name}</span><span>{attachment.type==='image'?'图片附件':'文件附件'} · {description}</span></div></div>;
}
export function HomerAttachmentByIndex({index,blocked,busy,removing,removed,annotationCount}:{index:number;annotationCount:(asset:{assetId:string;revision:number})=>number;blocked:boolean;busy:boolean;removing:(busy:boolean)=>void;removed:(id:string)=>void}){
 return <Controls.Provider value={{blocked,busy,removing,removed,annotationCount}}><ComposerPrimitive.AttachmentByIndex index={index} components={{Attachment:DraftAttachment}}/></Controls.Provider>;
}
