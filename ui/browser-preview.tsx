import{createContext,useEffect,useLayoutEffect,useRef,useState}from'react';
import type{BrowserPage,BrowserPreviewBridge,BrowserAnnotationState,BrowserAnnotationChange}from'../src/browser-preview';
import{referenceKey,referencesOf,type PreviewSource,type PreviewRequest}from'../src/preview-reference';
import{useAnnotationDraft,type AnnotationDraft}from'./annotation-draft';
import{connectionFetch}from'./web-connection-client';
import './browser-preview.css';
import{ArrowLeft,ArrowRight,RotateCw,Hand,Play}from'lucide-react';
import{TooltipIconButton}from'./vendor/assistant-ui/attachment-icon-button';
import{PreviewToolbar}from'./preview-toolbar';
import{AnnotationButton}from'./annotation-button';
declare global{interface Window{homerBrowserPreview?:BrowserPreviewBridge;}}
export const BrowserPreviewContext=createContext<{openLink:(url:string,trigger:HTMLAnchorElement)=>boolean;openReference:(reference:PreviewRequest,id:string)=>void}>({openLink:()=>false,openReference:()=>{}});
export async function openBrowserPreview(threadId:string,source:PreviewSource,url?:string):Promise<BrowserPage>{
 const response=await connectionFetch('/api/preview/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({threadId,source,...(url?{url}:{})})});
 const result=await response.json();if(!response.ok)throw Error(result.error??'网页打开未确认，请重试。');return result;
}
export function useBrowserPages(threadId:string){
 const [pages,setPages]=useState<BrowserPage[]>([]),[error,setError]=useState('');
 useEffect(()=>{
  const bridge=window.homerBrowserPreview;setPages([]);if(!bridge||!threadId)return;let current=true,reading=false,again=false;
  const read=async()=>{if(reading){again=true;return;}reading=true;do{again=false;try{const next=await bridge.list(threadId);if(current){setPages(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setError('');}}catch{if(current)setError('网页列表读取失败，请重新打开预览。');}}while(again&&current);reading=false;};
  void read();const off=bridge.onChanged(()=>void read());return()=>{current=false;off();};
 },[threadId]);return{pages,error};
}
type Props={page:BrowserPage;annotationDraft:AnnotationDraft;onReference:(reference:PreviewRequest,file?:File,isCurrent?:()=>boolean)=>Promise<void>;enabled:boolean;focusId?:string;focusKey?:string;focusRequest?:string;suspended?:boolean;isCurrent?:()=>boolean};
export function BrowserPreview({page,annotationDraft,onReference,enabled,focusId:requestedFocus,focusKey,focusRequest,suspended=false,isCurrent=()=>true}:Props){
 const draft=useAnnotationDraft(annotationDraft),viewport=useRef<HTMLDivElement>(null),latest=useRef({page,onReference,enabled,isCurrent});latest.current={page,onReference,enabled,isCurrent};
 const [active,setActive]=useState(false),[syncing,setSyncing]=useState(false),[notice,setNotice]=useState('');
 const key=referenceKey({kind:'web',source:page.source,page:{id:page.id,url:page.url,title:page.title}});
 const focusId=focusKey===key?requestedFocus:undefined;
 const reference=referencesOf(draft).find(r=>r.kind==='web'&&referenceKey(r)===key);
 const notes=reference?.kind==='web'?reference.annotations:[];
 const state:BrowserAnnotationState={document:page.document,active:active&&enabled&&!page.loading&&page.control==='user',revision:draft.revision,epoch:draft.epoch,notes,...(focusId?{focusId,focusRequest}:{})};
 const currentState=useRef(state);currentState.current=state;
 useEffect(()=>{if(page.control==='agent')setActive(false);},[page.control]);
 useEffect(()=>{if(focusId&&enabled)setActive(true);},[focusId,focusRequest,enabled]);
 useEffect(()=>{
  const bridge=window.homerBrowserPreview;if(!bridge)return;
  let current=true;setSyncing(state.active);
  void bridge.annotations({pageId:page.id,threadId:page.threadId,state}).catch(()=>{if(current)setNotice('批注同步未确认，已保存备注仍在草稿中。');}).finally(()=>{if(current)setSyncing(false);});return()=>{current=false;};
 },[page.id,page.document,page.control,page.loading,draft.revision,active,enabled,focusId,focusRequest]);
 useEffect(()=>{
  const bridge=window.homerBrowserPreview;if(!bridge)return;
  const off=bridge.onAnnotation((change:BrowserAnnotationChange)=>{
   if(change.pageId!==page.id)return;
   void(async()=>{
    const current=latest.current,before=annotationDraft.read();let error:string|undefined;
    try{
     if(!current.enabled||!current.isCurrent()||change.document!==current.page.document||change.baseRevision!==before.revision||change.epoch!==before.epoch)throw Error('页面或草稿已变化，输入已保留，请重新保存。');
     const p=current.page;
     await current.onReference({kind:'web',source:p.source,page:{id:p.id,url:p.url,title:p.title},annotations:change.notes},undefined,()=>latest.current.isCurrent()&&latest.current.page.document===change.document&&annotationDraft.read().epoch===before.epoch);
    }catch(e){error=e instanceof Error?e.message:'草稿保存尚未确认，输入已保留。';setNotice(error);}
    const after=annotationDraft.read(),p=latest.current.page;
    const saved=referencesOf(after).find(r=>r.kind==='web'&&referenceKey(r)===key);
    await bridge.reply({pageId:page.id,changeId:change.changeId,state:{document:p.document,active:currentState.current.active,revision:after.revision,epoch:after.epoch,notes:saved?.kind==='web'?saved.annotations:[],...(error?{error}:{})}}).catch(()=>setNotice('草稿确认未送达，请重新核对保存结果。'));
   })();
  });return off;
 },[page.id,key,annotationDraft]);
 useLayoutEffect(()=>{
  const bridge=window.homerBrowserPreview,node=viewport.current;if(!bridge||!node)return;
  let frame=0,disposed=false;
  const draw=()=>{if(disposed)return;const r=node.getBoundingClientRect(),covered=[...document.querySelectorAll<HTMLElement>('[role="dialog"]:not(#canvas-panel,[data-preview-local-quote]),[role="alertdialog"],[role="menu"]')].some(el=>el.getClientRects().length>0);void bridge.present({pageId:page.id,threadId:page.threadId,bounds:suspended||covered||!r.width||!r.height?null:{x:r.x,y:r.y,width:r.width,height:r.height}}).catch(()=>setNotice('网页显示未确认，请重新打开。'));};
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};draw();
  const observer=new ResizeObserver(schedule);observer.observe(node);const portals=new MutationObserver(schedule);portals.observe(document.body,{childList:true});window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();portals.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);void bridge.present({pageId:page.id,threadId:page.threadId,bounds:null}).catch(()=>{});};
 },[page.id,page.threadId,suspended]);
 async function control(action:'takeover'|'resume'|'back'|'forward'|'reload'){
  try{await window.homerBrowserPreview?.control({pageId:page.id,threadId:page.threadId,action});setNotice('');if(action==='resume')setActive(false);return true;}catch(e){setNotice(e instanceof Error?e.message:'网页操作未确认。');return false;}
 }
 const domain=page.url.startsWith('homer-preview:')?'HTML 附件':new URL(page.url||'about:blank').host;
 return <div className="browser-preview"><PreviewToolbar title={page.title} detail={page.loading?domain+' · 加载中':domain} leading={<>{([{action:'back',label:'后退',Icon:ArrowLeft},{action:'forward',label:'前进',Icon:ArrowRight},{action:'reload',label:'重新加载',Icon:RotateCw}]as const).map(({action,label,Icon})=><TooltipIconButton side="top" key={action} aria-label={label} tooltip={label} onClick={()=>void control(action)}><Icon size={16} aria-hidden/></TooltipIconButton>)}</>}>
  <AnnotationButton disabled={!enabled||page.loading||syncing} aria-busy={syncing} active={active} aria-label="批注" tooltip={active?'退出网页批注':'选择网页元素批注'} onClick={()=>void control('takeover').then(ok=>{if(ok)setActive(value=>!value);})}/>
  {page.agentAssigned&&<TooltipIconButton side="top" aria-label={page.control==='agent'?'用户接手':'交还 AI'} tooltip={page.control==='agent'?'暂停 AI 写入，由你操作':'结束用户接手，允许原任务继续操作此页'} onClick={()=>void control(page.control==='agent'?'takeover':'resume')}>{page.control==='agent'?<Hand size={16} aria-hidden/>:<Play size={16} aria-hidden/>}</TooltipIconButton>}
 </PreviewToolbar>{(notice||page.error)&&<p role="status" className="canvas-note">{notice||page.error}</p>}
 <div className="browser-preview-viewport" ref={viewport} aria-label="内置网页内容">{suspended&&<p>关闭对话框后继续查看网页。</p>}</div></div>;
}
export function AttachmentBrowserPreview(props:Omit<Props,'page'>&{threadId:string;source:PreviewSource}){
 const [page,setPage]=useState<BrowserPage>(),[error,setError]=useState('');const{pages}=useBrowserPages(props.threadId);
 useEffect(()=>{let alive=true;void(async()=>{try{const existing=(await window.homerBrowserPreview!.list(props.threadId)).find(p=>referenceKey({kind:'web',source:p.source})===referenceKey({kind:'web',source:props.source}));const next=existing??await openBrowserPreview(props.threadId,props.source);if(alive)setPage(next);}catch(e){if(alive)setError(e instanceof Error?e.message:'HTML 打开未确认。');}})();return()=>{alive=false;};},[props.threadId,referenceKey({kind:'web',source:props.source})]);
 const actual=pages.find(p=>p.id===page?.id)??page;
 return error?<p role="alert">{error}</p>:actual?<BrowserPreview {...props} page={actual}/>:<p role="status">正在打开 HTML…</p>;
}
