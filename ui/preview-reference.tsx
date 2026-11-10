import {createContext,type ReactNode} from 'react';
import {MessageCirclePlus,XIcon,FileTextIcon,ImageIcon,GlobeIcon} from 'lucide-react';
import {Button} from '@base-ui/react/button';
import {QuoteBlock} from './vendor/assistant-ui/quote';
import type {DraftImageReference,PreviewSource,ResourceReference,PreviewRequest,WindowAXNode} from '../src/preview-reference';
import {isDraftImageReference,referenceKey} from '../src/preview-reference';

export type WebPreviewSource=Extract<PreviewSource,{kind:'web'}>;
export type {PreviewRequest} from '../src/preview-reference';
export type PreviewImportGuard=()=>boolean;
export type PreviewComposer={add:(reference:PreviewRequest,file?:File,isCurrent?:PreviewImportGuard,htmlNotes?:import('./vendor/agentation-3.1.2/index.mjs').Annotation[])=>Promise<void>;canQuote:()=>boolean;openQuote:(snapshot:import('./message-source-selection').SourceQuoteSelection,trigger?:HTMLElement)=>void;appendQuote:(quote:import('../src/web-history').MessageQuote)=>void};
export const PreviewActionsContext=createContext<Pick<PreviewComposer,'canQuote'|'openQuote'|'appendQuote'>>({canQuote:()=>false,openQuote:()=>{},appendQuote:()=>{}});
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
   return <div className="annotation-chip" key={referenceKey(reference)+note.id}>
   <Button type="button" className="annotation-chip-open" onClick={()=>onOpen(reference,note.id)} title={detail} aria-label={`打开 ${title} 的批注 ${i+1}：${detail}${preparingKeys.includes(referenceKey(reference))?'；原图待确认':''}`}><SourceIcon size={15} aria-hidden="true"/><span className="compact-context-copy"><span className="compact-context-label">{summary}</span><span className="compact-context-source">{kindLabel} · {title}</span></span>{preparingKeys.includes(referenceKey(reference))&&<span className="annotation-chip-state">原图待确认</span>}</Button>
   <Button type="button" className="annotation-chip-remove" onClick={()=>onRemove(referenceKey(reference),note.id)} aria-label={`删除 ${title} 的批注 ${i+1}`}><XIcon size={14}/></Button>
  </div>;});
 })}</div>;
}
export function WindowAXExcerpt({ax,children}:{ax:WindowAXNode[];children?:ReactNode}){
 return <details className="text-sm">
  <summary className="cursor-pointer">窗口文字</summary>
  {children}
  <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{ax.map(({name,value})=>[name,value].filter(Boolean).join(' · ')).join('\n')}</p>
 </details>;
}
export function ResourceReferenceBlock({reference}:{reference:ResourceReference}){
 const coordinates=(r:{x:number;y:number;width:number;height:number})=>`${Math.round(r.x)}, ${Math.round(r.y)} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
 const excerpt=reference.kind==='text'?reference.annotations?reference.annotations.map((note,i)=>`${i+1}. ${note.text}\n批注：${note.comment}`).join('\n\n'):reference.text:reference.kind==='image'?reference.annotations?reference.annotations.map((note,i)=>`${i+1}. 区域：${coordinates(note.region)}\n批注：${note.comment}`).join('\n\n'):`区域：${coordinates(reference.region)}\n${reference.comment}`:reference.annotations.map(note=>`${note.element}：${note.comment}`).join('\n');
 const source=reference.source,title=source.kind==='draft-image'?'截图':source.title;
 return <div className="preview-reference" aria-label="预览引用">
  <span className="preview-reference-source" title={source.kind==='web'?source.url:title}>来源：{title}</span>
  {excerpt&&<QuoteBlock.Root><MessageCirclePlus data-slot="quote-block-icon" className="text-muted-foreground/60 mt-0.5 size-3 shrink-0" aria-hidden/><QuoteBlock.Text className={reference.kind!=='web'&&reference.annotations?'resource-annotations-text':undefined}>{excerpt}</QuoteBlock.Text></QuoteBlock.Root>}
  {isDraftImageReference(reference)&&reference.ax&&<WindowAXExcerpt ax={reference.ax}/>}
 </div>;
}
