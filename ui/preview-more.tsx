import{Menu}from'@base-ui/react/menu';
import{Ellipsis}from'lucide-react';
import{useEffect,useRef,useState}from'react';
import{previewFileCanOpen,previewFileCanReveal,type PreviewMoreAction}from'../src/browser-preview';
import{saveBlob}from'./file-download';

export type PreviewMoreItem={label:string;input:PreviewMoreAction};
type LocalInput=Extract<PreviewMoreAction,{file:unknown}>;
type AttachmentInput=Extract<PreviewMoreAction,{attachment:unknown}>;

export function localMoreItems(input:Omit<LocalInput,'action'>,filename:string,platform?:string,reveal=previewFileCanReveal(platform)):PreviewMoreItem[]{
 const items:PreviewMoreItem[]=[];
 if(reveal)items.push({
  label:platform==='darwin'?'在 Finder 中显示':platform==='win32'?'在文件资源管理器中显示':'在文件夹中显示',input:{...input,action:'reveal'},
 });
 if(previewFileCanOpen(filename))items.push({label:'用默认应用打开',input:{...input,action:'open'}});
 return items;
}
export function attachmentMoreItems(input:Omit<AttachmentInput,'action'>):PreviewMoreItem[]{
 const items:PreviewMoreItem[]=[{label:'下载',input:{...input,action:'download'}}];
 if(previewFileCanOpen(input.attachment.title))items.push({label:'用默认应用打开',input:{...input,action:'open'}});
 return items;
}

const actionErrors:Record<string,string>={
 artifact_missing:'找不到本地原件。',
 file_type_or_size_denied:'本地路径已无法打开为普通文件。',
 artifact_path_denied:'本地文件访问受限。',
 message_file_scope_denied:'此消息或链接已不可读。',
 media_file_missing:'此文件的交付版本不可用。',
 media_scope_denied:'此文件的交付版本不可用。',
 preview_source_mismatch:'此文件的交付版本不可用，请重新打开。',
 preview_page_unavailable:'网页已关闭。',
 preview_document_changed:'预览内容已切换，请从当前页面重试。',
 preview_file_open_unsupported:'此文件类型暂不支持用默认应用打开。',
 preview_system_open_failed:'系统未能打开目标，请核对默认应用或浏览器设置。',
};
export async function runPreviewMore(input:PreviewMoreAction,isCurrent:()=>boolean,onNotice:(text:string,error?:string)=>void){
 const bridge=window.homerBrowserPreview;
 if(!isCurrent()||!bridge?.more)return;
 try{
  const result=await bridge.more(input);
  if(!isCurrent())return;
  if('download'in result){
   const {bytes,mime,filename}=result.download;
   await saveBlob(new Blob([bytes],{type:mime}),filename);
  }
  if(isCurrent())onNotice(input.action==='reveal'?'已请求在系统中显示文件。':input.action==='download'?'已请求下载当前版本。':'已向系统发送打开请求。');
 }catch(error){
  if(!isCurrent())return;
  const message=error instanceof Error?error.message:'';
  const code=Object.keys(actionErrors).find(key=>message.endsWith(key));
  onNotice(code?actionErrors[code]!:input.action==='download'?'下载未完成，请重新打开附件后重试。':'系统操作未确认，请核对后重试。',code);
 }
}

export function PreviewMoreMenu({items,onAction,nativePageId,onPopup}:{items:PreviewMoreItem[];onAction:(input:PreviewMoreAction)=>void;nativePageId?:string;onPopup?:(element:HTMLDivElement|null)=>void}){
 const [open,setOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open||!nativePageId)return;
  return window.homerBrowserPreview?.onNativePointer?.(id=>{if(id===nativePageId)setOpen(false);});
 },[open,nativePageId]);
 if(!items.length)return null;
 return <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
  <Menu.Trigger ref={trigger} className="aui-button-icon" aria-label="更多" title="更多"><Ellipsis size={16} aria-hidden/></Menu.Trigger>
  <Menu.Portal><Menu.Positioner side="bottom" align="end" sideOffset={4} collisionAvoidance={{side:'none',align:'shift'}} className="preview-more-positioner">
   <Menu.Popup ref={onPopup} data-preview-native-more={nativePageId} className="preview-more-menu" aria-label="更多操作">
    {items.map(({label,input})=><Menu.Item key={input.action} nativeButton render={<button type="button"/>} className="preview-more-item"
     onKeyDown={event=>{
      if(event.key!==' '||!event.isTrusted||event.repeat)return;
      // Base UI synthesizes Space clicks even for native menu buttons.
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      onAction(input);
     }}
     onClick={event=>{if(event.isTrusted)onAction(input);}}>{label}</Menu.Item>)}
   </Menu.Popup>
  </Menu.Positioner></Menu.Portal>
 </Menu.Root>;
}
