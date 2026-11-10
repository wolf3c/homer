import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {CheckIcon,XIcon} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle} from './vendor/assistant-ui/attachment-dialog';
import {readDraftAttachmentImage} from './homer-attachments';
import type {HomerAttachment} from './homer-attachment-adapter';
import type {ImageAnnotationControl} from './image-annotation';
import type {PreviewImageAnnotation,WindowAXNode} from '../src/preview-reference';
import {WindowAXExcerpt} from './preview-reference';

const ImageAnnotation=lazy(()=>import('./image-annotation'));
type ScreenshotAction=(notes:PreviewImageAnnotation[],ax?:WindowAXNode[])=>Promise<void>;

export default function ScreenshotDialog({file,attachment,annotations,ax,focusAnnotation,onDone,onCancel,focusInput,imageEditor,onImageLoad,initialError='',floating=false}:{
 file:File;attachment?:HomerAttachment;annotations?:PreviewImageAnnotation[];ax?:WindowAXNode[];focusAnnotation?:string;
 onDone:ScreenshotAction;onCancel:()=>Promise<void>;focusInput:()=>void;imageEditor?:typeof import('./image-annotation').default;
 onImageLoad?:()=>void;initialError?:string;floating?:boolean;
}){
 const ImageEditor=imageEditor??ImageAnnotation;
 const [notes,setNotes]=useState(annotations??[]);
 const [includeAX,setIncludeAX]=useState(true);
 const [url,setUrl]=useState(''),[error,setError]=useState(initialError),[busy,setBusy]=useState(false),[cancelling,setCancelling]=useState(false);
 const [actions,setActions]=useState<HTMLDivElement|null>(null);
 const control=useRef<ImageAnnotationControl|null>(null);
 const region=useRef<HTMLDivElement>(null),sendButton=useRef<HTMLButtonElement>(null),pointerDown=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();let url='';
  void (file.size?Promise.resolve(file):attachment?readDraftAttachmentImage(attachment,controller.signal):Promise.reject()).then(blob=>{
   if(!controller.signal.aborted){url=URL.createObjectURL(blob);setUrl(url);}
  }).catch(()=>{if(!controller.signal.aborted)setError('暂时无法读取这张截图。');});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[file,attachment]);
 useEffect(()=>{
  if(!floating)return;
  const listener=new AbortController();
  const track=(event:PointerEvent)=>{pointerDown.current=event.buttons!==0;};
  for(const type of ['pointerdown','pointerup','pointercancel'] as const)window.addEventListener(type,track,{capture:true,signal:listener.signal});
  window.addEventListener('blur',()=>{pointerDown.current=false;},{signal:listener.signal});
  return()=>listener.abort();
 },[floating]);
 async function cancel(){
  if(floating&&busy)return;
  setCancelling(true);
  if(busy){await onCancel();return;}
  setBusy(true);setError('');
  try{await onCancel();}
  catch(error){setError(error instanceof Error?error.message:'暂存截图未能撤销，请核对后重试。');}
  finally{setBusy(false);}
 }
 async function finish(){
  if(busy||!url||pointerDown.current)return;
  if(!cancelling&&control.current?.editing()){setError('请先保存或取消正在编辑的批注。');return;}
  setError('');setBusy(true);
  try{await onDone(notes,includeAX?ax:undefined);}
  catch(error){setError(error instanceof Error?error.message:floating?'截图未发送，请重试。':'截图未加入草稿，请重试。');}
  finally{setBusy(false);}
 }
 const windowText=ax&&<WindowAXExcerpt ax={ax}>
  <label className="flex items-center gap-2"><input type="checkbox" checked={includeAX} onChange={event=>setIncludeAX(event.target.checked)}/>随截图附上窗口文字</label>
 </WindowAXExcerpt>;
 return <Dialog open disablePointerDismissal onOpenChange={(open,details)=>{
  if(open)return;
  details.cancel();
  if(!floating&&!busy&&control.current?.escape())return;
  if(!cancelling)void cancel();
 }}>
  <DialogContent className={floating?'capture-dialog flex':'flex max-h-[calc(100dvh-2rem)]'}
   style={{flexDirection:'column',maxWidth:floating?'none':'min(80rem, calc(100% - 2rem))'}} showCloseButton={false}
   initialFocus={floating?region:undefined} finalFocus={()=>{focusInput();return false;}}
   onKeyDown={event=>{
    if(!floating||event.defaultPrevented||event.key!=='Enter')return;
    const target=event.target instanceof Element?event.target.closest('button,a[href],summary,input,textarea,select,[contenteditable]:not([contenteditable=false])'):null;
    const sendable=!!control.current&&!control.current.editing()&&!pointerDown.current&&!busy
     &&!event.repeat&&!event.nativeEvent.isComposing&&event.keyCode!==229&&!event.shiftKey&&!event.altKey&&!event.metaKey&&!event.ctrlKey;
    if(target){if(target===sendButton.current&&!sendable)event.preventDefault();return;}
    if(sendable){event.preventDefault();void finish();}
   }}>
   <div className={floating?'sr-only':'flex shrink-0 items-center justify-between gap-3'}><DialogTitle>截图批注</DialogTitle>{!floating&&<div ref={setActions} inert={busy||cancelling}/>}</div>
   <div ref={region} className="overflow-y-auto" role="region" aria-label="截图内容" tabIndex={0} inert={busy||cancelling} onLoad={onImageLoad}>
    {url&&(floating||actions)&&<Suspense fallback={<p role="status">加载图片批注器…</p>}>
     <ImageEditor url={url} title={file.name} actions={actions??undefined} control={control} notes={notes} focusAnnotation={focusAnnotation}
      onSave={async notes=>{setNotes(notes);setError('');}} onRemove={id=>setNotes(notes=>notes.filter(note=>note.id!==id))}/>
    </Suspense>}
    {!floating&&windowText}
   </div>
   {floating&&windowText&&<div className="capture-window-text" inert={busy||cancelling}>{windowText}</div>}
   {error&&<p className="shrink-0" role="alert">{error}</p>}
   {busy&&<p className="shrink-0" role="status">{cancelling?'正在核对并撤销暂存附件…':'正在准备截图…'}</p>}
   <div className={floating?'capture-toolbar':'flex shrink-0 items-center justify-end gap-2'}>
    <button type="button" className={floating?'capture-button':'rounded-md border px-3 py-2'} disabled={cancelling||floating&&busy}
     aria-label={floating?'取消':undefined} aria-keyshortcuts={floating?'Escape':undefined} title={floating?'取消（Esc）':undefined} onClick={()=>void cancel()}>{floating?<XIcon size={16} aria-hidden/>:'取消'}</button>
    <button type="button" ref={sendButton} className={floating?'capture-button capture-send':'rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50'} disabled={!url||busy}
     aria-label={floating?'发送':undefined} aria-keyshortcuts={floating?'Enter':undefined} title={floating?'发送截图及当前草稿（Enter）':undefined} onClick={()=>void finish()}>{floating?<CheckIcon size={17} aria-hidden/>:cancelling?'核对上传':'完成'}</button>
   </div>
  </DialogContent>
 </Dialog>;
}
