import {LazyMarkdownImage} from './lazy-media';
import {MOBILE_DOWNLOAD_LIMIT_NOTICE,mobileDownloadNotice,saveBlob} from './file-download';
import {MOBILE_PACKET_BYTES} from '../src/mobile-channel';
import {useAnnotationDraft,type AnnotationDraft} from './annotation-draft';
import {referenceKey,referencesOf} from '../src/preview-reference';
import {Dialog} from '@base-ui/react/dialog';
import {Tabs} from '@base-ui/react/tabs';
import {PanelRight,XIcon} from 'lucide-react';
import {createPortal} from 'react-dom';
import type {Annotation} from './vendor/agentation-3.1.2/index.mjs';
import {useMediaQuery} from '@mantine/hooks';
import {previewAnnotations,type PreviewSource} from '../src/preview-reference';
import type {PreviewRequest,WebPreviewSource} from './preview-reference';
import {Component,lazy,Suspense,useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject,type ReactNode} from 'react';
import {connectionFetch,mobileView} from './web-connection-client';
import {htmlPreviewShell} from '../src/html-preview';
import ReactMarkdown,{defaultUrlTransform,type Components} from 'react-markdown';
import {isMessageFileLink} from '../src/message-links';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Highlight } from './markdown-code';
import './canvas-panel.css';
import {ImageRoot,ImagePreview} from './vendor/assistant-ui/image';
import {FileDownload,FileSize} from './vendor/assistant-ui/file';
import {CanvasSplitDocument,CanvasSplitBody} from './vendor/assistant-ui/canvas-split';
import {WebPreview} from './vendor/assistant-ui/web-preview';
import {remarkPreviewMath} from './preview-selection';
import {PreviewSelectionToolbar} from './preview-selection-toolbar';
import{BrowserPreview,AttachmentBrowserPreview}from'./browser-preview';
import{PreviewToolbar}from'./preview-toolbar';
import{AnnotationButton}from'./annotation-button';
import type{BrowserPage}from'../src/browser-preview';
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

export type CanvasArtifact = {id:string;title:string;messageId:string;assetId:string;revision:number;sha256:string;size?:number;resource?:string};
type MessageFileTab={kind:'message-file';id:string;title:string;messageId:string;destination:string;reload:number};
export type PreviewTab=CanvasArtifact|MessageFileTab|{kind:'schedules';id:'schedules';title:string}|{kind:'browser';id:string;title:string;page:BrowserPage};
type LocalFileInfo={kind:'local';filename:string;size:number;overLimit:boolean;reveal:boolean;platform:string};
const messageFileErrors:Record<string,string>={
  artifact_missing:'找不到本地文件。恢复原路径后可以重试。',
  artifact_path_denied:'本地文件访问受限。',
  file_type_or_size_denied:'只能预览不超过 50 MiB 的普通文件。',
  artifact_changed:'文件在读取时发生变化，请重试。',
  message_file_path_unsupported:'当前系统不支持此本地文件路径。',
  message_file_scope_denied:'此消息或链接已不可读。',
  media_scope_denied:'此文件的交付版本不可用。',
  media_file_missing:'此文件的交付版本不可用。',
  preview_reveal_unavailable:'系统定位暂不可用。',
  preview_unavailable:'桌面预览暂不可用。',
  web_desktop_auth_required:'此本地文件只能在荷马桌面中读取。',
};
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
 img:LazyMarkdownImage,
 a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
};
type CanvasPanelProps={annotationDraft:AnnotationDraft;annotationFocus?:{key:string;id:string;nonce:string;history?:PreviewRequest};artifact:CanvasArtifact|null;webSource?:WebPreviewSource;onClose:()=>void;onLocationApproval?:(id:string)=>void;returnFocusTo?:HTMLElement|null|(()=>HTMLElement|false|null);onReference:(reference:PreviewRequest,file?:File,isCurrent?:PreviewImportGuard,htmlNotes?:Annotation[])=>Promise<void>;referencesEnabled?:boolean;threadId?:string;tabs?:readonly PreviewTab[];activeId?:string|null;scheduleContent?:ReactNode;onSelectArtifact?:(id:string)=>void;onCloseArtifact?:(id:string)=>void;onOpenLink?:(source:PreviewSource,href:string)=>void;isCurrent?:PreviewImportGuard};

export function CanvasPanel({tabs,activeId,scheduleContent,threadId='',onSelectArtifact,onCloseArtifact,returnFocusTo,...readerProps}:CanvasPanelProps) {
  const {artifact,webSource,onClose}=readerProps;
  const selected=activeId??artifact?.id??null;
  const host=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),collapseButton=useRef<HTMLButtonElement>(null),rail=useRef<HTMLDivElement>(null);
  const [actions,setActions]=useState<HTMLDivElement|null>(null);
  const imageControl=useRef<ImageAnnotationControl|null>(null),focusAfterClose=useRef(false),visibleTab=useRef<Element|null>(null),pointerFocus=useRef(false);
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
  },[selected,tabs,actions]);
  const hasTabs=!!tabs?.length&&!webSource;
  const title='预览：'+(webSource?.title??tabs?.find(tab=>tab.id===selected)?.title??artifact?.title??'从对话中选择成果');
  const collapse=<button type="button" ref={collapseButton} className="canvas-collapse" aria-controls="canvas-panel" aria-expanded={true} aria-label="收起预览" title="收起预览" onClick={onClose}><PanelRight size={18} aria-hidden/></button>;
  const browser=tabs?.find(tab=>tab.id===selected&&'kind'in tab&&tab.kind==='browser');
  const local=tabs?.find((tab):tab is MessageFileTab=>tab.id===selected&&'kind'in tab&&tab.kind==='message-file');
  const reader=selected==='schedules'?scheduleContent:browser&&'kind'in browser&&browser.kind==='browser'?<BrowserPreview onLocationApproval={readerProps.onLocationApproval} page={browser.page} annotationDraft={readerProps.annotationDraft} onReference={readerProps.onReference} enabled={!!readerProps.referencesEnabled} isCurrent={readerProps.isCurrent} focusId={readerProps.annotationFocus?.id} focusKey={readerProps.annotationFocus?.key} focusRequest={readerProps.annotationFocus?.nonce} historyNote={readerProps.annotationFocus?.history?.kind==='web'?readerProps.annotationFocus.history.annotations.find(note=>note.id===readerProps.annotationFocus?.id):undefined}/>:<CanvasReader {...readerProps} local={local} threadId={threadId} key={JSON.stringify([threadId,local?.id??artifact?.id??(webSource?[webSource.messageId,webSource.sourceId,webSource.url]:'empty')])} actions={actions} imageControl={imageControl}/>;
  const activeTitle=webSource?.title??tabs?.find(tab=>tab.id===selected)?.title??artifact?.title??'预览';
  const nativeBrowser=!!browser;
  const statusBar=!nativeBrowser&&<PreviewToolbar title={activeTitle} detail={webSource?new URL(webSource.url).host:undefined}><div ref={setActions} className="canvas-tab-actions"/></PreviewToolbar>;
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
    {hasTabs?<Tabs.Root className="canvas-tabs" value={selected} onValueChange={id=>{if(typeof id==='string')onSelectArtifact?.(id);}}>
      <div className="canvas-tab-bar">
      <Tabs.List className="canvas-tab-rail" ref={rail} aria-label="已打开的成果" activateOnFocus={false} loopFocus onPointerDownCapture={()=>{pointerFocus.current=true;}} onPointerUpCapture={()=>{pointerFocus.current=false;}} onPointerCancelCapture={()=>{pointerFocus.current=false;}} onFocusCapture={event=>{visibleTab.current=event.target;if(!pointerFocus.current)ensureVisible(event.target);}}>
        {tabs.map(tab=>{
          let label=tab.title;
          if(!('kind' in tab)){
            const sameName=tabs.filter((item):item is CanvasArtifact=>!('kind' in item)&&item.title===tab.title);
            const repeatedAsset=new Set(sameName.map(item=>item.assetId)).size!==sameName.length;
            const sourceKey=(item:CanvasArtifact)=>repeatedAsset?item.messageId.replace(/^message-/,'')+':'+item.revision+':'+item.assetId.slice(6):item.assetId.slice(6);
            const key=sourceKey(tab);
            let length=8;while(length<key.length&&sameName.some(item=>item.id!==tab.id&&sourceKey(item).slice(0,length)===key.slice(0,length)))length++;
            label=tab.title+(sameName.length>1?' · '+key.slice(0,length):'');
          }
          return <div key={tab.id} className="canvas-tab-item" role="presentation">
            <Tabs.Tab value={tab.id} className="canvas-tab" title={tab.title+' · '+tab.id} aria-label={label}><span>{label}</span></Tabs.Tab>
            <button type="button" className="canvas-tab-close" aria-label={('kind' in tab?'关闭':'关闭文件：')+label} title={('kind' in tab?'关闭':'关闭文件：')+label} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))event.stopPropagation();}} onClick={event=>{focusAfterClose.current=tab.id===selected||event.currentTarget===document.activeElement;onCloseArtifact?.(tab.id);}}><XIcon size={14} aria-hidden/></button>
          </div>;
        })}
      </Tabs.List>
      {collapse}</div>
      {tabs.map(tab=><Tabs.Panel className="canvas-tab-panel" key={tab.id} value={tab.id} keepMounted hidden={tab.id!==selected}>{tab.id===selected?<>{statusBar}{reader}</>:null}</Tabs.Panel>)}
    </Tabs.Root>:<><div className="canvas-tab-bar"><span className="canvas-preview-label" title={webSource?.title??artifact?.title??'预览'}>{webSource?.title??artifact?.title??'预览'}</span>{collapse}</div>{statusBar}{reader}</>}
    </Dialog.Popup>
  </Dialog.Portal></Dialog.Root></div>;
}

function CanvasReader({annotationDraft,annotationFocus,artifact,local,webSource,threadId='',onClose,onReference:saveReference,onOpenLink,referencesEnabled:referenceCapability=false,isCurrent=()=>true,actions,imageControl}:CanvasPanelProps&{local?:MessageFileTab;actions:HTMLElement|null;imageControl:RefObject<ImageAnnotationControl|null>}) {
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
  const [file,setFile]=useState<{url:string;mime:string;text:string;name:string;blob:Blob;sha256:string|null}|null>(null),[loading,setLoading]=useState(false);
  const [mediaError,setMediaError]=useState('');
  const [localInfo,setLocalInfo]=useState<LocalFileInfo>();
  const [locating,setLocating]=useState(false);
  const downloadNotice=mobileDownloadNotice(file?.blob.size);
  const mobileTransferLimit='此交付版本超过手机传输上限，请在电脑端下载。';
  function requestLocal(action:''|'/info'|'/reveal',signal?:AbortSignal){
    return connectionFetch('/api/preview/message-file'+action,{signal,method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({threadId,messageId:local!.messageId,destination:local!.destination})});
  }
  async function locate(){
    if(!local||locating)return;
    const epoch=generation.current;
    setLocating(true);
    try{
      const response=await requestLocal('/reveal');
      if(!response.ok){
        const error=await response.json().then(result=>result?.error,()=>undefined);
        throw Error(Object.hasOwn(messageFileErrors,error)?messageFileErrors[error]:'系统定位未确认。');
      }
      if(readerCurrent()&&epoch===generation.current)setNotice('已请求在系统中显示文件。');
    }catch(error){
      if(readerCurrent()&&epoch===generation.current)setNotice(error instanceof Error?error.message:'系统定位未确认。');
    }finally{if(readerCurrent())setLocating(false);}
  }

  const mediaElement=useRef<HTMLMediaElement|null>(null);
  const [runtime,setRuntime]=useState(''),[ready,setReady]=useState(false),[frameRevision,setFrameRevision]=useState(0),[selection,setSelection]=useState<'idle'|'connecting'|'active'|'error'>('idle');
  const interactive=!!runtime,annotationLoading=selection==='connecting';
  const annotationLabel=annotationLoading?'取消批注加载，返回预览':interactive?'退出批注，返回预览':'启用批注';
  const token=useMemo(()=>crypto.randomUUID(),[artifact?.id,local?.reload,webSource?.url,retry,interactive,runtime,frameRevision]);
  const attachmentPath=artifact?'/api/media/'+[artifact.messageId,artifact.assetId,artifact.revision].map(encodeURIComponent).join('/') : '';
  const source=useMemo<PreviewSource|undefined>(()=>webSource??(local&&file?{kind:'message-file',messageId:local.messageId,destination:local.destination,title:file.name,...(file.sha256?{sha256:file.sha256}:{})}:artifact&&file?.sha256?{kind:'attachment',messageId:artifact.messageId,assetId:artifact.assetId,revision:artifact.revision,sha256:file.sha256,title:file.name}:undefined),[webSource,artifact?.id,file,local]);
  const openLink=useRef(onOpenLink);openLink.current=onOpenLink;
  const canOpenLinks=!!onOpenLink&&!!window.homerBrowserPreview;
  const previewMarkdownComponents=useMemo<Components>(()=>({...markdownComponents,
    ...(attachmentPath?{img:({src,alt})=><LazyMarkdownImage src={src&&!/^(?:[a-z][a-z\d+.-]*:|[\\/]|[?#])/i.test(src)?attachmentPath+'/resource/'+encodeURIComponent(src):src} alt={alt}/>} : {}),
    ...(source&&canOpenLinks?{a:({href,children,node})=>{
      const raw=node?.properties.href;
      if(href?.startsWith('#'))return <a href={href}>{children}</a>;
      if(typeof raw!=='string'||(!isMessageFileLink(raw)&&/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(raw)))return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      return <a href={isMessageFileLink(raw)?'#':href||'#'} onClick={event=>{event.preventDefault();if(event.isTrusted)openLink.current?.(source,raw);}}>{children}</a>;
    }} : {}),
  }),[attachmentPath,source,canOpenLinks]);
  const imageFile=useMemo(()=>file&&source&&(source.kind==='attachment'||source.kind==='message-file'&&source.sha256)?new File([file.blob],file.name,{type:file.mime}):undefined,[file,source]);
  useLayoutEffect(()=>{
    generation.current++;setFile(null);setLocalInfo(undefined);setReadError('');setMediaError('');setNotice('');setRuntime('');setReady(false);setSelection('idle');
    if(!artifact&&!local||webSource){setLoading(false);return;}
    const controller=new AbortController();let objectUrl='';setLoading(true);
    void (async()=>{try{
      const loadInfo=async()=>{
        const response=await requestLocal('/info',controller.signal);
        if(!response.ok){
          const {error}=await response.json().catch(()=>({error:undefined}));
          throw Error(Object.hasOwn(messageFileErrors,error)?messageFileErrors[error]:'文件信息暂不可用。');
        }
        const info=await response.json() as LocalFileInfo|{kind:'attachment'};
        if(info.kind==='local'&&!controller.signal.aborted&&readerCurrent())setLocalInfo(info);
        return info.kind==='local';
      };
      if(mobileView&&artifact?.size!==undefined&&Math.ceil(artifact.size/3)*4>=MOBILE_PACKET_BYTES)
        throw Error(mobileTransferLimit);
      const response=local?await requestLocal('',controller.signal):await connectionFetch(attachmentPath+(artifact?.resource?'/resource/'+encodeURIComponent(artifact.resource):''),{signal:controller.signal});
      if(!response.ok){
        const error=await response.json().then(result=>result?.error,()=>undefined);
        if(local&&(error==='file_type_or_size_denied'||error==='file_preview_unsupported')&&await loadInfo())return;
        if(local)throw Error(Object.hasOwn(messageFileErrors,error)?messageFileErrors[error]:'本地文件读取失败，请重试。');
        if(mobileView&&error==='mobile_packet_size_limit')throw Error(mobileTransferLimit);
        throw Error('成果读取失败（'+response.status+'），'+(error==='file_type_or_size_denied'?'文件类型或大小不符合当前读取限制（文件上限 50 MiB），请使用原文件。':'请重新连接后重试。'));
      }
      let sha256=response.headers.get('X-Homer-Artifact-Hash');
      if(artifact&&!artifact.resource&&sha256!==artifact.sha256)throw Error('成果读取失败：附件版本已变化，请重新打开。');
      if(artifact?.resource)sha256=null;
      const blob=await response.blob(),mime=(response.headers.get('Content-Type')??blob.type).split(';')[0]!.trim().toLowerCase();
      if(local&&['image/png','image/jpeg','image/webp','image/gif'].includes(mime)&&blob.size<=8*1024*1024){
        const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
        sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      }
      let name=local?.title??artifact!.title;try{const encoded=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];if(encoded)name=decodeURIComponent(encoded);}catch{}
      const text=isPatchFile(name,mime)?await blob.slice(0,blob.size>MAX_PATCH_BYTES?PATCH_PREFIX_BYTES:blob.size).text():!/^(audio|video)\//.test(mime)&&(mime.startsWith('text/')||/^(application\/(json|javascript))/.test(mime)||!local&&/\.(txt|md|json|[cm]?[jt]sx?|css|py|sh)$/i.test(name))?await blob.text():'';
      if(controller.signal.aborted||!readerCurrent())return;
      objectUrl=URL.createObjectURL(blob);setFile({url:objectUrl,mime,text,name,blob,sha256});
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
  },[artifact?.id,local?.id,local?.reload,webSource?.url,retry,threadId]);
  const noteKey=source?referenceKey({kind:'image',source}):'';
  const htmlKey=source?referenceKey({kind:'web',source}):'';
  const textReference=referencesOf(draft).find(r=>r.kind==='text'&&source&&referenceKey(r)===referenceKey({kind:'text',source}));
  const imageReference=Object.values(draft.preparingImages??{}).find(r=>source&&referenceKey(r)===referenceKey({kind:'image',source}))??referencesOf(draft).find(r=>r.kind==='image'&&source&&referenceKey(r)===referenceKey({kind:'image',source}));
  const historicImage=annotationFocus?.history?.kind==='image'&&annotationFocus.key===noteKey?annotationFocus.history:undefined;
  const savedCount=referencesOf(draft).find(r=>r.kind==='web'&&referenceKey(r)===htmlKey)?.annotations?.length??0;
  const focusId=annotationFocus&&source&&annotationFocus.key===referenceKey({kind:isImageSource()?'image':file?.mime==='text/html'?'web':'text',source})?annotationFocus.id:undefined;
  useEffect(()=>{if(annotationFocus&&source&&!focusId&&!(file?.mime==='text/html'&&window.homerBrowserPreview))setNotice('当前预览无法准确定位这条批注，原摘录与备注已保留。');},[annotationFocus?.nonce,source]);
  function isImageSource(){return !!file&&file.mime.startsWith('image/');}
  useEffect(()=>{if(focusId&&file?.mime==='text/html'&&!runtime)setNotice('已打开来源；点击“批注”后定位这条网页批注。');},[focusId,annotationFocus?.nonce,runtime]);
  function stopHtmlAnnotation(error=false){
    generation.current++;setRuntime('');setReady(false);setSelection(error?'error':'idle');
    if(error)setNotice('批注加载失败，已返回预览；请点击批注重试。');
  }
  useEffect(()=>{
    if(selection!=='connecting')return;
    const timer=setTimeout(()=>stopHtmlAnnotation(true),10000);
    return()=>clearTimeout(timer);
  },[selection]);
  useEffect(()=>{if(!referencesEnabled)stopHtmlAnnotation();},[referencesEnabled]);
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
      if(data.type==='homer-preview-runtime-error'){stopHtmlAnnotation(true);return;}
      if(data.type==='homer-preview-location-missing'){setNotice('网页中无法唯一定位这条批注，已保留原备注与位置记录。');return;}
      if(data.type==='homer-preview-active'&&typeof data.active==='boolean'){
        active=data.active;if(active)setSelection('active');else stopHtmlAnnotation();return;
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
    }catch{if(readerCurrent()&&current===generation.current)stopHtmlAnnotation(true);}
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
  const patchRaw=file&&<>{!downloadNotice&&<a href={file.url} download={file.name} onClick={event=>{event.preventDefault();void saveBlob(file.blob,file.name).then(()=>{if(readerCurrent())setNotice('');},()=>{if(readerCurrent())setNotice('下载未完成，请重新连接后重试。');});}}>下载原文件</a>}<pre>{file.text}</pre></>;
  const mediaKind=file?.mime.startsWith('audio/')?'audio':file?.mime.startsWith('video/')?'video':null;
  const unknownMedia=!!file&&(!file.mime||file.mime==='application/octet-stream')&&/\.(mp3|wav|m4a|ogg|flac|mp4|webm|mov|mkv)$/i.test(file.name);
  const isHtml=file?.mime==='text/html',isText=!!file&&!mediaKind&&(file.mime.startsWith('text/')||!!file.text);
  const hasFrame=!!webSource||file?.mime==='application/pdf';
  const isImage=!!file&&['image/png','image/jpeg','image/webp','image/gif'].includes(file.mime);
  return <CanvasSplitDocument>
    {actions&&file&&!downloadNotice&&createPortal(<FileDownload data={file.url} mimeType={file.mime} filename={file.name} onClick={event=>{
      event.preventDefault();
      void saveBlob(file.blob,file.name).then(()=>{if(readerCurrent())setNotice('');},error=>{
        if(readerCurrent())setNotice(error instanceof Error&&error.message==='mobile_file_size_limit'
          ?MOBILE_DOWNLOAD_LIMIT_NOTICE:'下载未完成，请重新连接后重试。');
      });
    }}/>,actions)}
    {actions&&createPortal(isHtml&&!window.homerBrowserPreview&&referencesEnabled&&source?<div ref={setHtmlActions} className="html-preview-actions aui-attachment-surface">
      <AnnotationButton active={selection==='active'} className="html-annotation-toggle" tooltipContainer={htmlActions} aria-pressed={selection==='active'} aria-busy={annotationLoading} aria-label={annotationLabel} tooltip={annotationLabel} onClick={()=>{if(interactive||annotationLoading)stopHtmlAnnotation();else void enableWebAnnotation();}}/>
    </div>:isImage&&referencesEnabled&&source?<span ref={setImageActions} className="image-preview-actions aui-attachment-surface"/>:null,actions)}
    <CanvasSplitBody ref={body} tabIndex={-1} className={isHtml?'html-preview-body':isPatch?'patch-preview-body':undefined}>
    {(notice||downloadNotice)&&<p role="status" className="canvas-note">{notice||downloadNotice}</p>}
    {webSource&&<p className="canvas-note canvas-web-narrow-note">网页元素批注暂限桌面使用。</p>}
    {local&&isImage&&file&&file.blob.size>8*1024*1024&&<p role="status" className="canvas-note">图片超过草稿附件的 8 MiB 上限，可预览。</p>}
    {referencesEnabled&&source&&!webSource&&isText&&!isHtml&&!isPatch&&<PreviewSelectionToolbar key={JSON.stringify([artifact?.id,file?.sha256])} body={body} source={source} annotations={textReference?.kind==='text'?textReference.annotations??[]:[]} representation={file?.mime==='text/markdown'||/\.md$/i.test(file?.name??'')?'markdown':'plain'} onReference={onReference} onRemove={id=>annotationDraft.remove(referenceKey({kind:'text',source}),id)} onNotice={setNotice} focusAnnotation={focusId} focusRequest={annotationFocus?.nonce} historyNote={annotationFocus?.history?.kind==='text'?annotationFocus.history.annotations?.find(note=>note.id===focusId):undefined}/>}
    {webSource?<><p className="canvas-note">{ready?'网页已接入批注器，可使用页面内工具栏选择元素。':'网站可能禁止嵌入；未接入批注器的网页只能预览。'}</p><WebPreview origin={webSource.url} loading={false} onReload={()=>{setReady(false);if(webFrame.current)webFrame.current.src=webSource.url;}} onOpenExternal={()=>window.open(webSource.url,'_blank','noopener,noreferrer')}><iframe ref={webFrame} key={webSource.url} title="网页预览" onLoad={()=>setFrameRevision(value=>value+1)} src={webSource.url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"/></WebPreview></>:
    loading?<p role="status">{local?'正在读取本地文件…':'正在读取成果…'}</p>:readError?<div className="canvas-read-error"><p role="alert">{readError}</p><button type="button" onClick={event=>{if(local&&!event.isTrusted)return;stopHtmlAnnotation();setFile(null);setRetry(value=>value+1);}}>重试读取</button></div>:localInfo&&!file?<div className="canvas-read-error">
      <p>{localInfo.filename} · {localInfo.size<1048576?<FileSize bytes={localInfo.size}/>:((localInfo.size/1048576).toFixed(1)+' MiB')}</p>
      <p>{localInfo.overLimit?'文件超过预览上限（50 MiB）。':'此格式暂不支持内置预览。'}</p>
      {localInfo.reveal&&<button type="button" disabled={locating} onClick={event=>{if(event.isTrusted)void locate();}}>{localInfo.platform==='win32'?'在文件资源管理器中显示':'在 Finder 中显示'}</button>}
    </div>:file?<>
      {isPatch?patchFallback?<><p role="status" className="canvas-note">{patchFallback}</p>{patchRaw}</>:
      <PatchPreviewBoundary key={JSON.stringify([artifact?.id,file.sha256,retry])} fallback={<><p role="status" className="canvas-note">差异预览失败，显示原文。</p>{patchRaw}</>}>
        <details><summary>原始补丁文本</summary>{patchRaw}</details>
        <Suspense fallback={<p role="status">加载差异预览…</p>}><LazyDiffViewer patch={file.text} maxCollapsedLines={200}/></Suspense>
      </PatchPreviewBoundary>:isHtml?window.homerBrowserPreview&&source?<AttachmentBrowserPreview threadId={threadId} source={source} annotationDraft={annotationDraft} onReference={onReference} enabled={referencesEnabled} isCurrent={readerCurrent} focusId={annotationFocus?.id} focusKey={annotationFocus?.key} focusRequest={annotationFocus?.nonce}/>:<><iframe ref={webFrame} key={token} title="隔离 HTML 成果" sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" {...(mobileView?{srcDoc:htmlPreviewShell}:{src:'/preview/interactive'})} onLoad={event=>event.currentTarget.contentWindow?.postMessage({type:'homer-html-preview',html:file.text,runtime},'*')}/>
      {savedCount>0&&!interactive&&<p className="canvas-note html-notes-status">已保存 {savedCount} 条网页批注到输入草稿</p>}</>:
      mediaKind?<div className="canvas-media">
        <p className="canvas-note">{file.name}</p>
        {mediaKind==='audio'?<audio ref={node=>{if(node)mediaElement.current=node;}} controls preload="none" src={file.url} aria-label={'音频预览：'+file.name} onError={event=>{
          if(readerCurrent()&&mediaElement.current===event.currentTarget&&event.currentTarget.getAttribute('src')===file.url)setMediaError('此文件无法在当前浏览器播放，可下载后打开。');
        }}/>:<video ref={node=>{if(node)mediaElement.current=node;}} controls playsInline preload="none" src={file.url} aria-label={'视频预览：'+file.name} onError={event=>{
          if(readerCurrent()&&mediaElement.current===event.currentTarget&&event.currentTarget.getAttribute('src')===file.url)setMediaError('此文件无法在当前浏览器播放，可下载后打开。');
        }}/>}
        {mediaError&&<p role="alert">{mediaError}</p>}
        {!downloadNotice&&<a href={file.url} download={file.name} onClick={event=>{event.preventDefault();void saveBlob(file.blob,file.name).catch(()=>setMediaError('下载未完成，请重新连接后重试。'));}}>下载文件</a>}
      </div>:
      (file.mime==='text/markdown'||(!local||isText)&&/\.md$/i.test(file.name))?<div data-preview-text className="markdown canvas-markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,remarkPreviewMath]} rehypePlugins={[rehypeKatex]} urlTransform={(url,key)=>key==='href'&&source&&canOpenLinks&&isMessageFileLink(url)?url:defaultUrlTransform(url)} components={previewMarkdownComponents}>{file.text}</ReactMarkdown></div>:
      isText?<pre data-preview-text>{file.text}</pre>:
      file.mime.startsWith('image/')?isImage&&referencesEnabled&&source&&imageFile&&imageActions?<Suspense fallback={<p role="status">加载图片批注器…</p>}><ImageAnnotation initialEnabled={false} readOnly={!!historicImage} key={noteKey} url={file.url} title={source.title} actions={historicImage?undefined:imageActions} control={imageControl}
        notes={historicImage?.annotations??(imageReference?.kind==='image'?imageReference.annotations??[{id:'legacy-image-region',region:imageReference.region,comment:imageReference.comment}]:[])}
        onSave={(annotations,size,isCurrent)=>onReference({kind:'image',source,...size,annotations},annotationDraft.imageFile(noteKey,imageFile),isCurrent)}
        onRemove={id=>{
          if(source.kind==='message-file'&&imageReference?.kind==='image'&&(imageReference.annotations?.length??1)===1){
            return onReference({kind:'image',source,width:imageReference.width,height:imageReference.height,annotations:[]});
          }
          annotationDraft.remove(noteKey,id);
        }} focusAnnotation={historicImage?undefined:focusId} focusRequest={annotationFocus?.nonce}/></Suspense>:<ImageRoot className="canvas-image-root"><ImagePreview src={file.url} alt={local?file.name:artifact?.title??'成果图片'}/></ImageRoot>:
      file.mime==='application/pdf'?<iframe title="PDF 成果" src={file.url}/>:unknownMedia?<div className="canvas-media"><p className="canvas-note">{file.name}</p><p>{downloadNotice?'未识别为可播放的媒体类型。':'未识别为可播放的媒体类型，可下载后打开。'}</p>{!downloadNotice&&<a href={file.url} download={file.name} onClick={event=>{event.preventDefault();void saveBlob(file.blob,file.name).catch(()=>setMediaError('下载未完成，请重新连接后重试。'));}}>下载文件</a>}</div>:<p>此格式暂不支持在线预览。</p>}
    </>:<p className="canvas-note">从对话中选择网页或成果进行预览。</p>}
    {hasFrame&&<div className="canvas-frame-exit"><p className="canvas-note">预览内部的快捷键由网页处理，可用 Tab 移到“收起预览”按钮。</p><button type="button" onClick={onClose}>收起预览</button></div>}
    </CanvasSplitBody></CanvasSplitDocument>;
}
