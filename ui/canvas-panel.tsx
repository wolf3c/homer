import {saveBlob} from './file-download';
import {useAnnotationDraft,type AnnotationDraft} from './annotation-draft';
import {referenceKey,referencesOf} from '../src/preview-reference';
import {Dialog} from '@base-ui/react/dialog';
import {Tabs} from '@base-ui/react/tabs';
import {MessageCirclePlus,PanelRight,XIcon} from 'lucide-react';
import {createPortal} from 'react-dom';
import {TooltipIconButton} from './vendor/assistant-ui/attachment-icon-button';
import type {Annotation} from './vendor/agentation-3.1.2/index.mjs';
import {useMediaQuery} from '@mantine/hooks';
import {previewAnnotations,type PreviewSource} from '../src/preview-reference';
import type {PreviewRequest,WebPreviewSource} from './preview-reference';
import {Component,lazy,Suspense,useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject,type ReactNode} from 'react';
import {connectionFetch,mobileView} from './web-connection-client';
import {htmlPreviewShell} from '../src/html-preview';
import ReactMarkdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Highlight } from './markdown-code';
import './canvas-panel.css';
import {ImageRoot,ImagePreview} from './vendor/assistant-ui/image';
import {CanvasSplitDocument,CanvasSplitBody} from './vendor/assistant-ui/canvas-split';
import {WebPreview} from './vendor/assistant-ui/web-preview';
import {remarkPreviewMath} from './preview-selection';
import {PreviewSelectionToolbar} from './preview-selection-toolbar';
import type {ImageAnnotationControl} from './image-annotation';
import type {PreviewImportGuard} from './preview-reference';
const ImageAnnotation=lazy(()=>import('./image-annotation'));
const MAX_PATCH_BYTES=256*1024,MAX_PATCH_LINES=2000,PATCH_PREFIX_BYTES=128*1024;
function isPatchFile(name:string,mime:string){
  return /^(text|application)\/x-(diff|patch)$/.test(mime)||
    (['','application/octet-stream','text/plain'].includes(mime)&&/\.(patch|diff)$/i.test(name));
}
const LazyDiffViewer=lazy(()=>import('./vendor/assistant-ui/diff-viewer').then(module=>({default:module.DiffViewer})));
class PatchPreviewBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

export type CanvasArtifact = {id:string;title:string};
export function canvasWebUrl(value:string):string {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('请输入不含账号密码的 http(s) 网页地址。');
  return url.href;
}
const markdownComponents:Components={
 pre:({children})=><div>{children}</div>,
 code:({className,children})=>{
  const code=String(children).replace(/\n$/,''),language=/language-(\S+)/.exec(className??'')?.[1];
  return language?<Highlight language={language} code={code}/>:String(children).includes('\n')?<pre><code>{children}</code></pre>:<code>{children}</code>;
 },
 img:({alt})=><span>{alt?'[图片：'+alt+']':'[图片]'}</span>,
 a:({href,children})=>{try{return href?<a href={canvasWebUrl(href)} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>;}catch{return <span>{children}</span>;}},
};
export function isolatedHtml(text:string, interactive=false):string {
  const template=document.createElement('template');template.innerHTML=text;
  template.content.querySelectorAll('iframe,object,embed,base,meta,link,form,template'+(interactive?'':',script')).forEach(el=>el.remove());
  template.content.querySelectorAll('script[src]').forEach(el=>el.remove());
  template.content.querySelectorAll('*').forEach(el=>{for(const attr of [...el.attributes])if((!interactive&&attr.name.startsWith('on'))||['href','src','srcset','action','formaction','ping','target','xlink:href'].includes(attr.name))el.removeAttribute(attr.name);});
  const policy="default-src 'none'; script-src "+(interactive?"'unsafe-inline'":"'none'")+"; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-src about: blob:; connect-src 'none';";
  const inner='<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+template.innerHTML;
  return inner;
}
type CanvasPanelProps={annotationDraft:AnnotationDraft;annotationFocus?:{key:string;id:string;nonce:string};artifact:CanvasArtifact|null;webSource?:WebPreviewSource;onClose:()=>void;returnFocusTo?:HTMLElement|null|(()=>HTMLElement|false|null);onReference:(reference:PreviewRequest,file?:File,isCurrent?:PreviewImportGuard,htmlNotes?:Annotation[])=>Promise<void>;referencesEnabled?:boolean;threadId?:string;tabs?:readonly CanvasArtifact[];onSelectArtifact?:(id:string)=>void;onCloseArtifact?:(id:string)=>void;isCurrent?:PreviewImportGuard};

export function CanvasPanel({tabs,threadId='',onSelectArtifact,onCloseArtifact,returnFocusTo,...readerProps}:CanvasPanelProps) {
  const {artifact,webSource,onClose}=readerProps;
  const host=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),collapseButton=useRef<HTMLButtonElement>(null),rail=useRef<HTMLDivElement>(null);
  const [actions,setActions]=useState<HTMLDivElement|null>(null);
  const imageControl=useRef<ImageAnnotationControl|null>(null),focusAfterClose=useRef(false),visibleTab=useRef<Element|null>(null);
  const narrow=useMediaQuery('(max-width:800px)',matchMedia('(max-width:800px)').matches,{getInitialValueInEffect:false});
  function ensureVisible(target:Element|null){
    const list=rail.current,item=target?.closest('.canvas-tab-item');if(!list||!item||!list.contains(item))return;
    const r=list.getBoundingClientRect(),t=item.getBoundingClientRect();
    if(t.left<r.left)list.scrollLeft+=t.left-r.left;else if(t.right>r.right)list.scrollLeft+=t.right-r.right;
  }
  useLayoutEffect(()=>{
    const list=rail.current;if(!list)return;
    const active=list.querySelector<HTMLElement>('[role=tab][aria-selected=true]');
    if(focusAfterClose.current){focusAfterClose.current=false;active?.focus({preventScroll:true});}
    visibleTab.current=active;
    ensureVisible(active);
    const observer=new ResizeObserver(()=>ensureVisible(visibleTab.current?.isConnected?visibleTab.current:list.querySelector('[role=tab][aria-selected=true]')));
    observer.observe(list);return()=>observer.disconnect();
  },[artifact?.id,tabs]);
  const hasTabs=!!tabs?.length&&!webSource;
  const title='预览：'+(webSource?.title??artifact?.title??'从对话中选择成果');
  const tools=<><div ref={setActions} className="canvas-tab-actions"/>{(narrow||!hasTabs)&&<TooltipIconButton ref={collapseButton} className="canvas-collapse" tooltipContainer={actions} aria-label="收起预览" tooltip="收起预览" onClick={onClose}><PanelRight size={14} aria-hidden/></TooltipIconButton>}</>;
  const reader=<CanvasReader {...readerProps} key={JSON.stringify([threadId,artifact?.id??(webSource?[webSource.messageId,webSource.sourceId,webSource.url]:'empty')])} actions={actions} imageControl={imageControl}/>;
  return <div ref={host} className="canvas-host"><Dialog.Root open modal={narrow} disablePointerDismissal onOpenChange={(open,details)=>{
    if(details.reason==='escape-key'&&imageControl.current?.escape()){details.cancel();return;}
    if(details.reason==='escape-key'&&panel.current?.querySelector('.preview-selection-positioner')){details.cancel();details.allowPropagation();return;}
    if(!open)onClose();
  }}><Dialog.Portal container={host}>
    {narrow&&<Dialog.Backdrop className="canvas-backdrop"/>}
    <Dialog.Popup ref={panel} id="canvas-panel" className="canvas-panel" role={narrow?'dialog':'complementary'} aria-modal={narrow||undefined} aria-label={title} initialFocus={()=>rail.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')??collapseButton.current??panel.current} finalFocus={()=>{
      const target=typeof returnFocusTo==='function'?returnFocusTo():returnFocusTo;
      return target===false?false:target?.isConnected?target:document.querySelector<HTMLElement>('.conversation-header [aria-controls="canvas-panel"]');
    }}>
    <Dialog.Title className="sr-only">{title}</Dialog.Title>
    {hasTabs?<Tabs.Root className="canvas-tabs" value={artifact?.id??null} onValueChange={id=>{if(typeof id==='string')onSelectArtifact?.(id);}}>
      <div className="canvas-tab-bar">
      <Tabs.List className="canvas-tab-rail" ref={rail} aria-label="已打开的成果" activateOnFocus={false} loopFocus onFocusCapture={event=>{visibleTab.current=event.target;ensureVisible(event.target);}}>
        {tabs.map(tab=>{
          const sameName=tabs.filter(item=>item.title===tab.title);
          let length=8;while(length<tab.id.length&&sameName.some(item=>item.id!==tab.id&&item.id.slice(0,length)===tab.id.slice(0,length)))length++;
          const label=tab.title+(sameName.length>1?' · '+tab.id.slice(0,length):'');
          return <div key={tab.id} className="canvas-tab-item" role="presentation">
            <Tabs.Tab value={tab.id} className="canvas-tab" title={tab.title+' · '+tab.id} aria-label={label}><span>{label}</span></Tabs.Tab>
            <button type="button" className="canvas-tab-close" aria-label={'关闭文件：'+label} title={'关闭文件：'+label} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))event.stopPropagation();}} onClick={event=>{focusAfterClose.current=tab.id===artifact?.id||event.currentTarget===document.activeElement;onCloseArtifact?.(tab.id);}}><XIcon size={14} aria-hidden/></button>
          </div>;
        })}
      </Tabs.List>
      {tools}</div>
      {tabs.map(tab=><Tabs.Panel className="canvas-tab-panel" key={tab.id} value={tab.id} keepMounted hidden={tab.id!==artifact?.id}>{tab.id===artifact?.id?reader:null}</Tabs.Panel>)}
    </Tabs.Root>:<><div className="canvas-tab-bar"><span className="canvas-preview-label" title={webSource?.title??artifact?.title??'预览'}>{webSource?.title??artifact?.title??'预览'}</span>{tools}</div>{reader}</>}
    </Dialog.Popup>
  </Dialog.Portal></Dialog.Root></div>;
}

function CanvasReader({annotationDraft,annotationFocus,artifact,webSource,onClose,onReference:saveReference,referencesEnabled:referenceCapability=false,isCurrent=()=>true,actions,imageControl}:CanvasPanelProps&{actions:HTMLElement|null;imageControl:RefObject<ImageAnnotationControl|null>}) {
  const draft=useAnnotationDraft(annotationDraft);
  const referencesEnabled=referenceCapability&&!draft.frozen;
  const generation=useRef(0),alive=useRef(true),owner=useRef(isCurrent);owner.current=isCurrent;
  const readerCurrent=()=>alive.current&&owner.current();
  useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  async function onReference(reference:PreviewRequest,file?:File,extra:PreviewImportGuard=()=>true,htmlNotes?:Annotation[]){
    const epoch=generation.current;
    const current=()=>readerCurrent()&&generation.current===epoch&&extra();
    if(!current()||!source||referenceKey(reference)!==referenceKey({...reference,source}))throw Error('草稿或来源已变化，请重新保存。');
    await saveReference(reference,file,current,htmlNotes);
  }
  const [imageActions,setImageActions]=useState<HTMLSpanElement|null>(null);
  const [htmlActions,setHtmlActions]=useState<HTMLDivElement|null>(null);
  const body=useRef<HTMLDivElement>(null),webFrame=useRef<HTMLIFrameElement>(null);
  const bridge=useRef({onReference});bridge.current={onReference};
  const [readError,setReadError]=useState(''),[retry,setRetry]=useState(0),[notice,setNotice]=useState('');
  const [file,setFile]=useState<{url:string;mime:string;text:string;name:string;blob:Blob;sha256:string}|null>(null),[loading,setLoading]=useState(false);
  const [mediaError,setMediaError]=useState('');
  const mediaElement=useRef<HTMLMediaElement|null>(null);
  const [imageAnnotation,setImageAnnotation]=useState(false),[runtime,setRuntime]=useState(''),[ready,setReady]=useState(false),[frameRevision,setFrameRevision]=useState(0),[selection,setSelection]=useState<'idle'|'connecting'|'active'|'error'>('idle');
  const interactive=!!runtime,annotationLoading=selection==='connecting';
  const annotationLabel=annotationLoading?'取消批注加载，返回静态预览':interactive?'退出批注，返回静态预览':'启用批注（将运行当前网页脚本）';
  const token=useMemo(()=>crypto.randomUUID(),[artifact?.id,webSource?.url,retry,interactive,runtime,frameRevision]);
  const source=useMemo<PreviewSource|undefined>(()=>webSource??(artifact&&file?.sha256?{kind:'artifact',id:artifact.id,sha256:file.sha256,title:file.name}:undefined),[webSource,artifact?.id,file]);
  const imageFile=useMemo(()=>file&&source?annotationDraft.imageFile(referenceKey({kind:'image',source}),new File([file.blob],file.name,{type:file.mime})):undefined,[file,source,annotationDraft]);
  useLayoutEffect(()=>{
    generation.current++;setFile(null);setReadError('');setMediaError('');setNotice('');setImageAnnotation(false);setRuntime('');setReady(false);setSelection('idle');
    if(!artifact||webSource){setLoading(false);return;}
    const controller=new AbortController();let objectUrl='';setLoading(true);
    void (async()=>{try{
      const response=await connectionFetch('/api/files/'+encodeURIComponent(artifact.id),{signal:controller.signal});
      if(!response.ok){
        let denied=false;try{denied=(await response.json()).error==='file_type_or_size_denied';}catch{}
        throw Error('成果读取失败（'+response.status+'），'+(denied?'文件类型或大小不符合当前读取限制（文件上限 50 MiB），请使用原文件。':'请重新连接后重试。'));
      }
      const blob=await response.blob(),mime=(response.headers.get('Content-Type')??blob.type).split(';')[0]!.trim().toLowerCase();
      let name=artifact.title;try{const encoded=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];if(encoded)name=decodeURIComponent(encoded);}catch{}
      const text=isPatchFile(name,mime)?await blob.slice(0,blob.size>MAX_PATCH_BYTES?PATCH_PREFIX_BYTES:blob.size).text():!/^(audio|video)\//.test(mime)&&(mime.startsWith('text/')||/^(application\/(json|javascript))/.test(mime)||/\.(txt|md|json|[cm]?[jt]sx?|css|py|sh)$/i.test(name))?await blob.text():'';
      if(controller.signal.aborted||!readerCurrent())return;
      objectUrl=URL.createObjectURL(blob);setFile({url:objectUrl,mime,text,name,blob,sha256:response.headers.get('X-Homer-Artifact-Hash')??''});
    }catch(error){if(!controller.signal.aborted&&readerCurrent())setReadError(error instanceof Error?error.message:'成果读取失败。');}
    finally{if(!controller.signal.aborted&&readerCurrent())setLoading(false);}})();
    return()=>{
      controller.abort();
      // React may detach the ref before this cleanup. Keep the last non-null
      // node so pause/resource release still precedes revoking this read's URL.
      const media=mediaElement.current;mediaElement.current=null;
      if(media){media.pause();media.removeAttribute('src');media.load();}
      if(objectUrl)URL.revokeObjectURL(objectUrl);
    };
  },[artifact?.id,webSource?.url,retry]);
  const noteKey=source?.kind==='artifact'?JSON.stringify([source.id,source.sha256]):'';
  const htmlKey=source?referenceKey({kind:'web',source}):'';
  const textReference=referencesOf(draft).find(r=>r.kind==='text'&&source&&referenceKey(r)===referenceKey({kind:'text',source}));
  const imageReference=Object.values(draft.preparingImages??{}).find(r=>source&&referenceKey(r)===referenceKey({kind:'image',source}))??referencesOf(draft).find(r=>r.kind==='image'&&source&&referenceKey(r)===referenceKey({kind:'image',source}));
  const savedCount=referencesOf(draft).find(r=>r.kind==='web'&&referenceKey(r)===htmlKey)?.annotations?.length??0;
  const focusId=annotationFocus&&source&&annotationFocus.key===referenceKey({kind:isImageSource()?'image':file?.mime==='text/html'?'web':'text',source})?annotationFocus.id:undefined;
  useEffect(()=>{if(annotationFocus&&source&&!focusId)setNotice('当前预览无法准确定位这条批注，原摘录与备注已保留。');},[annotationFocus?.nonce,source]);
  function isImageSource(){return !!file&&file.mime.startsWith('image/');}
  useEffect(()=>{if(focusId&&isImageSource())setImageAnnotation(true);else if(focusId&&file?.mime==='text/html'&&!runtime)setNotice('已打开来源；点击“批注”后定位这条网页批注。');},[focusId,annotationFocus?.nonce,runtime]);
  function staticPreview(error=false){
    generation.current++;setRuntime('');setReady(false);setSelection(error?'error':'idle');
    if(error)setNotice('批注加载失败，已返回静态预览；请点击批注重试。');
  }
  useEffect(()=>{
    if(selection!=='connecting')return;
    const timer=setTimeout(()=>staticPreview(true),10000);
    return()=>clearTimeout(timer);
  },[selection]);
  useEffect(()=>{if(!referencesEnabled)staticPreview();},[referencesEnabled]);
  function nativeNotes():Annotation[]{
    const state=annotationDraft.read();
    const reference=referencesOf(state).find(r=>r.kind==='web'&&referenceKey(r)===htmlKey);
    return reference?.kind==='web'?reference.annotations.map(note=>({...state.htmlMetadata[htmlKey]?.[note.id],...note,timestamp:0})):[];
  }
  useEffect(()=>{
    if(!runtime||!ready)return;
    const state=annotationDraft.read();
    webFrame.current?.contentWindow?.postMessage({type:'homer-preview-replace',token,sourceKey:htmlKey,notes:nativeNotes(),revision:state.revision,epoch:state.epoch,focusId},'*');
  },[draft.revision,runtime,ready,token,htmlKey,focusId,annotationFocus?.nonce]);
  useEffect(()=>{
    setReady(false);let connected=false,active=false,disposed=false;
    const receive=(event:MessageEvent)=>{
      const child=webFrame.current?.contentWindow;
      if(disposed||!readerCurrent()||!child||event.source!==child||webSource||!runtime||!source)return;
      const data=event.data;
      if(data?.type==='homer-preview-ready'){
        const state=annotationDraft.read();
        child.postMessage({type:'homer-preview-connect',token,sourceKey:htmlKey,notes:nativeNotes(),revision:state.revision,epoch:state.epoch},'*');return;
      }
      if(data?.token!==token||data.sourceKey!==htmlKey)return;
      if(data.type==='homer-preview-connected'){connected=true;setReady(true);return;}
      if(!connected)return;
      if(data.type==='homer-preview-runtime-error'){staticPreview(true);return;}
      if(data.type==='homer-preview-location-missing'){setNotice('网页中无法唯一定位这条批注，已保留原备注与位置记录。');return;}
      if(data.type==='homer-preview-active'&&typeof data.active==='boolean'){
        active=data.active;if(active)setSelection('active');else staticPreview();return;
      }
      if(!active||data.type!=='homer-preview-notes'||!Array.isArray(data.notes)||typeof data.changeId!=='string')return;
      const result=(error?:string)=>{
        if(disposed||!readerCurrent())return;const state=annotationDraft.read();
        child.postMessage({type:'homer-preview-replace',token,sourceKey:htmlKey,notes:nativeNotes(),revision:state.revision,epoch:state.epoch,changeId:data.changeId,...(error?{error}:{})},'*');
      };
      const before=annotationDraft.read();
      if(data.epoch!==before.epoch||data.baseRevision!==before.revision){result('草稿已变化，当前输入已保留，请重新保存。');return;}
      try{
        if(!referencesEnabled)throw Error('当前界面不支持保存批注，请刷新后重试。');
        const annotations=data.notes.length?previewAnnotations(data.notes):[];
        // Retain only metadata used by the native renderer. Full paths, styles,
        // surrounding content and library diagnostics are never draft data.
        const notes:Annotation[]=annotations.map(note=>{
          const native=data.notes.find((item:Annotation)=>item.id===note.id);
          return {...note,timestamp:0,...(typeof native?.isFixed==='boolean'?{isFixed:native.isFixed}:{}),...(typeof native?.selectedText==='string'&&native.selectedText.length<=16000?{selectedText:native.selectedText}:{}),...(native?.isMultiSelect?{isMultiSelect:true}:{}),...(Array.isArray(native?.elementBoundingBoxes)&&native.elementBoundingBoxes.length<=20?{elementBoundingBoxes:native.elementBoundingBoxes.map((box:{x:number;y:number;width:number;height:number})=>({x:box.x,y:box.y,width:box.width,height:box.height}))}:{})};
        });
        void bridge.current.onReference({kind:'web',source,annotations},undefined,()=>!disposed&&readerCurrent()&&annotationDraft.read().epoch===before.epoch,notes).then(()=>result()).catch(error=>{if(readerCurrent()){setNotice(error.message);result(error.message);}});
      }catch(error){const message=error instanceof Error&&error.message!=='invalid_resource_reference'?error.message:'批注内容无效或超出限制：最多20条，每条16000字符，合计48000字符。';setNotice(message);result(message);}
    };
    addEventListener('message',receive);return()=>{disposed=true;removeEventListener('message',receive);};
  },[token,source,referencesEnabled,runtime,webSource,htmlKey,annotationDraft]);
  useEffect(()=>{if(webSource)webFrame.current?.contentWindow?.postMessage({type:'homer-preview-connect',token},'*');},[token,webSource]);
  async function enableWebAnnotation(){
    if(annotationLoading||!referencesEnabled||!source||webSource)return;
    const current=++generation.current;
    setNotice('');setSelection('connecting');
    try{
      const bundle=await import('../dist/preview-annotation/runtime.js?raw');
      if(readerCurrent()&&current===generation.current)setRuntime(bundle.default);
    }catch{if(readerCurrent()&&current===generation.current)staticPreview(true);}
  }
  const isPatch=!!file&&isPatchFile(file.name,file.mime);
  const patchFallback=useMemo(()=>{
    if(!file||!isPatchFile(file.name,file.mime))return '';
    if(file.blob.size>MAX_PATCH_BYTES)return '补丁较大，仅显示开头 128 KiB 的解码文本；下载查看完整原文件。';
    if(!file.text.trim())return '补丁为空或仅含空白。';
    if(/[\0\uFFFD]/.test(file.text))return '内容可能不是 UTF-8 文本，显示解码结果；可下载原文件。';
    if(/^(GIT binary patch|Binary files .+ differ)\r?$/m.test(file.text))return '包含二进制差异，显示原文。';
    if(/^diff --(cc|combined) |^@@@/m.test(file.text))return '暂不支持 combined 差异，显示原文。';
    let lines=1;
    for(let i=0;i<file.text.length;i++)if(file.text.charCodeAt(i)===10&&++lines>MAX_PATCH_LINES)return '补丁行数较多，显示原文。';
    if(!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(file.text))return '未发现支持的 unified hunk，显示原文。';
    return '';
  },[file]);
  const patchRaw=file&&<><a href={file.url} download={file.name} onClick={event=>{event.preventDefault();void saveBlob(file.blob,file.name).then(()=>{if(readerCurrent())setNotice('');},()=>{if(readerCurrent())setNotice('下载未完成，请重新连接后重试。');});}}>下载原文件</a><pre>{file.text}</pre></>;
  const mediaKind=file?.mime.startsWith('audio/')?'audio':file?.mime.startsWith('video/')?'video':null;
  const unknownMedia=!!file&&(!file.mime||file.mime==='application/octet-stream')&&/\.(mp3|wav|m4a|ogg|flac|mp4|webm|mov|mkv)$/i.test(file.name);
  const isHtml=file?.mime==='text/html',isText=!!file&&!mediaKind&&(file.mime.startsWith('text/')||!!file.text);
  const hasFrame=!!webSource||file?.mime==='application/pdf';
  const isImage=!!file&&['image/png','image/jpeg','image/webp','image/gif'].includes(file.mime);
  return <CanvasSplitDocument>
    {actions&&createPortal(isHtml&&referencesEnabled&&source?<div ref={setHtmlActions} className="html-preview-actions aui-attachment-surface">
      <TooltipIconButton className="html-annotation-toggle" tooltipContainer={htmlActions} aria-pressed={selection==='active'} aria-busy={annotationLoading} aria-label={annotationLabel} tooltip={annotationLabel} onClick={()=>{if(interactive||annotationLoading)staticPreview();else void enableWebAnnotation();}}><MessageCirclePlus size={14} aria-hidden/><span>批注</span></TooltipIconButton>
    </div>:isImage&&referencesEnabled&&source?<span ref={setImageActions} className="image-preview-actions aui-attachment-surface">{!imageAnnotation&&<TooltipIconButton className="image-annotation-toggle" tooltipContainer={imageActions} aria-label="批注" aria-pressed={false} tooltip="开始图片批注" onClick={()=>setImageAnnotation(true)}><MessageCirclePlus size={14} aria-hidden/><span>批注</span></TooltipIconButton>}</span>:null,actions)}
    <CanvasSplitBody ref={body} tabIndex={-1} className={isHtml?'html-preview-body':isPatch?'patch-preview-body':undefined}>
    {notice&&<p role="status" className="canvas-note">{notice}</p>}
    {webSource&&<p className="canvas-note canvas-web-narrow-note">网页元素批注暂限桌面使用。</p>}
    {referencesEnabled&&source&&!webSource&&isText&&!isHtml&&!isPatch&&<PreviewSelectionToolbar key={JSON.stringify([artifact?.id,file?.sha256])} body={body} source={source} annotations={textReference?.kind==='text'?textReference.annotations??[]:[]} representation={file?.mime==='text/markdown'||/\.md$/i.test(file?.name??'')?'markdown':'plain'} onReference={onReference} onRemove={id=>annotationDraft.remove(referenceKey({kind:'text',source}),id)} onNotice={setNotice} focusAnnotation={focusId} focusRequest={annotationFocus?.nonce}/>}
    {webSource?<><p className="canvas-note">{ready?'网页已接入批注器，可使用页面内工具栏选择元素。':'网站可能禁止嵌入；未接入批注器的网页只能预览。'}</p><WebPreview origin={webSource.url} loading={false} onReload={()=>{setReady(false);if(webFrame.current)webFrame.current.src=webSource.url;}} onOpenExternal={()=>window.open(webSource.url,'_blank','noopener,noreferrer')}><iframe ref={webFrame} key={webSource.url} title="网页预览" onLoad={()=>setFrameRevision(value=>value+1)} src={webSource.url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"/></WebPreview></>:
    loading?<p role="status">正在读取成果…</p>:readError?<div className="canvas-read-error"><p role="alert">{readError}</p><button type="button" onClick={()=>{staticPreview();setFile(null);setRetry(value=>value+1);}}>重试读取</button></div>:file?<>
      {isPatch?patchFallback?<><p role="status" className="canvas-note">{patchFallback}</p>{patchRaw}</>:
      <PatchPreviewBoundary key={JSON.stringify([artifact?.id,file.sha256,retry])} fallback={<><p role="status" className="canvas-note">差异预览失败，显示原文。</p>{patchRaw}</>}>
        <details><summary>原始补丁文本</summary>{patchRaw}</details>
        <Suspense fallback={<p role="status">加载差异预览…</p>}><LazyDiffViewer patch={file.text} maxCollapsedLines={200}/></Suspense>
      </PatchPreviewBoundary>:isHtml?<><iframe ref={webFrame} key={token} title="隔离 HTML 成果" sandbox={interactive?'allow-scripts':''} referrerPolicy="no-referrer" {...(interactive?{...(mobileView?{srcDoc:htmlPreviewShell}:{src:'/preview/interactive'}),onLoad:(event)=>event.currentTarget.contentWindow?.postMessage({type:'homer-html-preview',html:isolatedHtml(file.text,true),runtime},'*')}:{srcDoc:isolatedHtml(file.text)})}/>
      {savedCount>0&&!interactive&&<p className="canvas-note html-notes-status">已保存 {savedCount} 条网页批注到输入草稿</p>}</>:
      mediaKind?<div className="canvas-media">
        <p className="canvas-note">{file.name}</p>
        {mediaKind==='audio'?<audio ref={node=>{if(node)mediaElement.current=node;}} controls preload="none" src={file.url} aria-label={'音频预览：'+file.name} onError={event=>{
          if(readerCurrent()&&mediaElement.current===event.currentTarget&&event.currentTarget.getAttribute('src')===file.url)setMediaError('此文件无法在当前浏览器播放，可下载后打开。');
        }}/>:<video ref={node=>{if(node)mediaElement.current=node;}} controls playsInline preload="none" src={file.url} aria-label={'视频预览：'+file.name} onError={event=>{
          if(readerCurrent()&&mediaElement.current===event.currentTarget&&event.currentTarget.getAttribute('src')===file.url)setMediaError('此文件无法在当前浏览器播放，可下载后打开。');
        }}/>}
        {mediaError&&<p role="alert">{mediaError}</p>}
        <a href={file.url} download={file.name} onClick={event=>{event.preventDefault();void saveBlob(file.blob,file.name).catch(()=>setMediaError('下载未完成，请重新连接后重试。'));}}>下载文件</a>
      </div>:
      (file.mime==='text/markdown'||/\.md$/i.test(file.name))?<div data-preview-text className="markdown canvas-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,remarkPreviewMath]} rehypePlugins={[[rehypeKatex,{trust:false,throwOnError:false}]]} components={markdownComponents}>{file.text}</ReactMarkdown></div>:
      isText?<pre data-preview-text>{file.text}</pre>:
      file.mime.startsWith('image/')?isImage&&imageAnnotation&&referencesEnabled&&source&&imageFile&&imageActions?<Suspense fallback={<p role="status">加载图片批注器…</p>}><ImageAnnotation key={noteKey} url={file.url} source={source} file={imageFile} actions={imageActions} control={imageControl} reference={imageReference?.kind==='image'?imageReference:undefined} onAdd={onReference} onRemove={id=>annotationDraft.remove(referenceKey({kind:'image',source}),id)} focusAnnotation={focusId} focusRequest={annotationFocus?.nonce}/></Suspense>:<ImageRoot><ImagePreview src={file.url} alt={artifact?.title??'成果图片'}/></ImageRoot>:
      file.mime==='application/pdf'?<iframe title="PDF 成果" src={file.url}/>:unknownMedia?<div className="canvas-media"><p className="canvas-note">{file.name}</p><p>未识别为可播放的媒体类型，可下载后打开。</p><a href={file.url} download={file.name} onClick={event=>{event.preventDefault();void saveBlob(file.blob,file.name).catch(()=>setMediaError('下载未完成，请重新连接后重试。'));}}>下载文件</a></div>:<p>此格式暂不支持在线预览。</p>}
    </>:<p className="canvas-note">从对话中选择网页或成果进行预览。</p>}
    {hasFrame&&<div className="canvas-frame-exit"><p className="canvas-note">预览内部的快捷键由网页处理，可用 Tab 移到“收起预览”按钮。</p><button type="button" onClick={onClose}>收起预览</button></div>}
    </CanvasSplitBody></CanvasSplitDocument>;
}
