import {ReferenceCard} from './reference-card';
import {createContext,useContext,type ReactNode} from 'react';
import {MessageCirclePlus,FileTextIcon,ImageIcon,GlobeIcon} from 'lucide-react';
import {Button} from '@base-ui/react/button';
import {QuoteBlock} from './vendor/assistant-ui/quote';
import './image-reference.css';
import {BrowserPreviewContext} from './browser-preview';
import type {DraftImageReference,PreviewSource,ResourceReference,PreviewRequest,WindowAXNode,PreviewImageAnnotation} from '../src/preview-reference';
import {isDraftImageReference,referenceKey,webSourceUrl} from '../src/preview-reference';

export type WebPreviewSource=Extract<PreviewSource,{kind:'web'}>;
export type {PreviewRequest} from '../src/preview-reference';
export type PreviewImportGuard=()=>boolean;
export type PreviewComposer={selectTask:(value:import('../src/web-history').TaskReference)=>boolean;selectSchedule:(value:import('./conversation-client').ScheduleContext)=>boolean;insertScheduleExample:(text:string,revealInput?:()=>void)=>string|undefined;add:(reference:PreviewRequest,file?:File,isCurrent?:PreviewImportGuard,htmlNotes?:import('./vendor/agentation-3.1.2/index.mjs').Annotation[])=>Promise<void>;canQuote:()=>boolean;openQuote:(snapshot:import('./message-source-selection').SourceQuoteSelection,trigger?:HTMLElement)=>boolean;quoteNotice:(message:string)=>void;appendQuote:(quote:import('../src/web-history').MessageQuote)=>void};
export const PreviewActionsContext=createContext<Pick<PreviewComposer,'canQuote'|'openQuote'|'appendQuote'|'quoteNotice'>>({canQuote:()=>false,openQuote:()=>false,quoteNotice:()=>{},appendQuote:()=>{}});
export function AnnotationChips({references,onOpen,onRemove,preparingKeys=[],noteId}:{references:(PreviewRequest|DraftImageReference)[];preparingKeys?:string[];noteId?:string;onOpen:(reference:PreviewRequest|DraftImageReference,id:string)=>void;onRemove:(key:string,id:string)=>void}){
 return <div className="annotation-chips" aria-label="已保存批注">{references.flatMap(reference=>{
  const notes=reference.annotations??[{id:'legacy',comment:reference.kind==='text'?reference.text:reference.kind==='image'?reference.comment:''}];
  const title=reference.source.kind==='draft-image'?'截图':reference.source.title;
  const SourceIcon=reference.kind==='image'?ImageIcon:reference.kind==='web'?GlobeIcon:FileTextIcon;
  return notes.filter(note=>!noteId||note.id===noteId).map(note=>{
   const i=notes.findIndex(item=>item.id===note.id);
   const object='text' in note&&typeof note.text==='string'?note.text:'element' in note&&typeof note.element==='string'?note.element:reference.kind==='image'?'图片区域':'';
   const summary=note.comment?.trim()||object.trim()||'未填写批注';
   const kindLabel=reference.kind==='text'&&!reference.annotations?'文本引用':reference.kind==='text'?'文本批注':reference.kind==='image'?'图片批注':reference.source.kind==='web'?'网页批注':'页面批注';
   const detail=[title,object&&`对象：${object}`,note.comment&&`批注：${note.comment}`].filter(Boolean).join(' · ');
   const key=referenceKey(reference),preparing=preparingKeys.includes(key);
   return <ReferenceCard key={key+note.id} summary={{
    icon:<SourceIcon size={15} aria-hidden/>,title:summary,subtitle:kindLabel+' · '+title,status:preparing?'原图待确认':undefined,
    open:{onClick:()=>onOpen(reference,note.id),title:detail,'aria-label':`打开 ${title} 的批注 ${i+1}：${detail}${preparing?'；原图待确认':''}`},
    remove:{onClick:()=>onRemove(key,note.id),'aria-label':`删除 ${title} 的批注 ${i+1}`},
   }}/>;});
 })}</div>;
}
export function WindowAXExcerpt({ax,children}:{ax:WindowAXNode[];children?:ReactNode}){
 return <details className="text-sm">
  <summary className="cursor-pointer">窗口文字</summary>
  {children}
  <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{ax.map(({name,value})=>[name,value].filter(Boolean).join(' · ')).join('\n')}</p>
 </details>;
}
function imageNotes(reference:Extract<ResourceReference,{kind:'image'}>):PreviewImageAnnotation[]{
 if(reference.annotations)return reference.annotations;
 return [{id:'legacy',region:reference.region,comment:reference.comment}];
}
export function ImageReferenceRegions({reference}:{reference:Extract<ResourceReference,{kind:'image'}>}){
 return <div className="image-reference-regions" aria-hidden="true">{imageNotes(reference).map((note,i)=><div key={note.id} className="image-reference-region" style={{left:note.region.x/reference.width*100+'%',top:note.region.y/reference.height*100+'%',width:note.region.width/reference.width*100+'%',height:note.region.height/reference.height*100+'%'}}><span>{i+1}</span></div>)}</div>;
}
export function ResourceReferenceBlock({reference,children,hideScreenshotDetails,webAnnotationsReadOnly}:{reference:ResourceReference;children?:ReactNode;hideScreenshotDetails?:boolean;webAnnotationsReadOnly?:boolean}){
 const browser=useContext(BrowserPreviewContext);
 const coordinates=(r:{x:number;y:number;width:number;height:number})=>`${Math.round(r.x)}, ${Math.round(r.y)} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
 const source=reference.source,title=source.kind==='draft-image'?'截图':source.title;
 if(webAnnotationsReadOnly&&reference.kind==='web'){
  const {page,annotations}=reference;
  const pageTitle=page?.title??title;
  const host=(page?webSourceUrl(page.url)?.host:undefined)??('url' in source?webSourceUrl(source.url)?.host:undefined);
  const multiple=annotations.length>1;
  return <ReferenceCard as="section" className="preview-reference web-annotation-reference" aria-label={'网页批注 · '+pageTitle}>
   <header className="web-annotation-source">
    <GlobeIcon size={15} aria-hidden="true"/>
    <div><div className="web-annotation-title">{pageTitle}</div>
     {host&&host!==pageTitle&&<div className="web-annotation-host">{host}</div>}
    </div>
    {multiple&&<span className="web-annotation-count">{annotations.length} 条批注</span>}
   </header>
   <ol role="list">
    {annotations.map(({id,element,comment},index)=><li key={id+':'+index}>
     {multiple&&<span className="web-annotation-index" aria-hidden="true">{index+1}</span>}
     <div><div className="web-annotation-element">{element}</div>
      <p className="web-annotation-comment">{comment}</p>
     </div>
    </li>)}
   </ol>
  </ReferenceCard>;
 }
 if(reference.kind==='image'&&imageNotes(reference).length){
  const notes=imageNotes(reference);
  const screenshot=isDraftImageReference(reference);
  return <ReferenceCard className="preview-reference image-reference" aria-label="图片批注">
   <div className={'image-reference-layout'+(children?' has-image':'')}>
    {children&&<div className="image-reference-image" style={{maxWidth:Math.min(reference.height>reference.width?220:320,360*reference.width/reference.height)}}>{children}<ImageReferenceRegions reference={reference}/></div>}
    <ol className="image-reference-notes" aria-label="图片区域批注">{notes.map(note=><li key={note.id}>{note.comment.length>240||note.comment.split('\n').length>4?<details className="image-reference-long-comment"><summary>{note.comment.slice(0,60).trimEnd()}… <span>全文</span></summary><p className="image-reference-comment">{note.comment}</p></details>:<p className="image-reference-comment">{note.comment}</p>}</li>)}</ol>
   </div>
   {!isDraftImageReference(reference)&&source.kind==='message-file'&&window.homerBrowserPreview&&notes.map((note,i)=><Button key={note.id} type="button" className="annotation-chip-open" onClick={()=>browser.openReference(reference,note.id,true)}>打开批注 {i+1}</Button>)}
   {!(hideScreenshotDetails&&screenshot)&&<><details className="image-reference-details"><summary>{screenshot?'截图来源与区域':'图片来源与区域'}</summary>
    <QuoteBlock.Root><QuoteBlock.Icon/><QuoteBlock.Text className="image-reference-source">{'来源：'+title+'\n图片尺寸：'+reference.width+' × '+reference.height}</QuoteBlock.Text></QuoteBlock.Root>
    <ol>{notes.map((note,i)=><li key={note.id}>区域 {i+1}：{coordinates(note.region)}</li>)}</ol>
   </details>
   {screenshot&&reference.ax&&<WindowAXExcerpt ax={reference.ax}/>}</>}
  </ReferenceCard>;
 }
 const excerpt=reference.kind==='text'?reference.annotations?reference.annotations.map((note,i)=>`${i+1}. ${note.text}\n批注：${note.comment}`).join('\n\n'):reference.text:reference.kind==='image'?reference.annotations?reference.annotations.map((note,i)=>`${i+1}. 区域：${coordinates(note.region)}\n批注：${note.comment}`).join('\n\n'):`区域：${coordinates(reference.region)}\n${reference.comment}`:reference.annotations.map(note=>`${note.element}：${note.comment}`).join('\n');
 return <ReferenceCard className="preview-reference" aria-label="预览引用">
  <span className="preview-reference-source" title={source.kind==='web'?source.url:title}>来源：{title}</span>
  {excerpt&&<QuoteBlock.Root><MessageCirclePlus data-slot="quote-block-icon" className="text-muted-foreground/60 mt-0.5 size-3 shrink-0" aria-hidden/><QuoteBlock.Text className={reference.kind!=='web'&&reference.annotations?'resource-annotations-text':undefined}>{excerpt}</QuoteBlock.Text></QuoteBlock.Root>}
  {source.kind==='message-file'&&reference.kind!=='image'&&(window.homerBrowserPreview
   ?reference.annotations?.map((note,index)=><Button key={note.id} type="button" className="annotation-chip-open" onClick={()=>browser.openReference(reference,note.id,true)}>打开批注 {index+1}</Button>)
   :<span className="preview-reference-source">原文件可在桌面打开。</span>)}
  {isDraftImageReference(reference)&&reference.ax&&<WindowAXExcerpt ax={reference.ax}/>}
 </ReferenceCard>;
}
