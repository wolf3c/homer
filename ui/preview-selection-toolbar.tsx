import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {useTextSelection} from '@mantine/hooks';
import {Popover} from '@base-ui/react/popover';
import {Button} from '@base-ui/react/button';
import {MessageCirclePlus} from 'lucide-react';
import {previewTextAnnotations,type PreviewSource,type PreviewTextAnnotation} from '../src/preview-reference';
import type {PreviewRequest} from './preview-reference';
import {captureTextAnchor,restoreTextRange} from './preview-text-anchor';
import {AnnotationCommentForm} from './annotation-comment-form';
import './vendor/assistant-ui/quote.css';

type Props={body:RefObject<HTMLDivElement|null>;source:PreviewSource;annotations:PreviewTextAnnotation[];representation:'plain'|'markdown';onReference:(reference:PreviewRequest)=>Promise<void>;onRemove:(id:string)=>void;onNotice:(notice:string)=>void;focusAnnotation?:string;focusRequest?:string};
const sameRange=(a:Range,b:Range)=>a.startContainer===b.startContainer&&a.startOffset===b.startOffset&&a.endContainer===b.endContainer&&a.endOffset===b.endOffset;

// Only this leaf subscribes to selection. Saved notes belong to the composer;
// this component owns only the current uncommitted editor and DOM locations.
export function PreviewSelectionToolbar({body,source,annotations,representation,onReference,onRemove,onNotice,focusAnnotation,focusRequest}:Props){
 const [editor,setEditor]=useState<PreviewTextAnnotation>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[savedNotice,setSavedNotice]=useState('');
 const [positions,setPositions]=useState<{id:string;left:number;top:number}[]>([]);
 const selection=useTextSelection(),popup=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
 const mounted=useRef(true),busy=useRef(false),editorRange=useRef<Range|null>(null),existing=useRef(false),trigger=useRef<HTMLButtonElement|null>(null);
 const highlightName='homer-notes-'+useId().replace(/[^a-z0-9-]/gi,'');
 const [dismissed,setDismissed]=useState<Range|null>(null);
 const saved=useRef<{range:Range;nativeRange:Range}|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const textBody=body.current?.querySelector('[data-preview-text]');
 const valid=!!selection&&selection.rangeCount===1&&!selection.isCollapsed&&!!selection.toString().trim()&&!!textBody&&textBody.contains(selection.anchorNode)&&textBody.contains(selection.focusNode);
 if(valid&&!editor){const nativeRange=selection.getRangeAt(0);saved.current={range:nativeRange.cloneRange(),nativeRange};}
 const focused=!!popup.current?.contains(document.activeElement);
 const snapshot=valid||(focused&&selection?.isCollapsed)?saved.current:null;
 const range=snapshot?.range??null,nativeRange=snapshot?.nativeRange??null;
 useEffect(()=>{if(dismissed&&nativeRange!==dismissed)setDismissed(null);},[nativeRange,dismissed]);
 const bubble=!!range&&!!textBody?.contains(range.startContainer)&&!!textBody.contains(range.endContainer)&&nativeRange!==dismissed;
 const activeRange=editor?editorRange.current:range;
 const anchor=useMemo(()=>activeRange&&textBody?.contains(activeRange.startContainer)&&textBody.contains(activeRange.endContainer)?{contextElement:textBody,getBoundingClientRect:()=>activeRange.getBoundingClientRect(),getClientRects:()=>activeRange.getClientRects()}:body,[activeRange,textBody,body]);
 useLayoutEffect(()=>{if(editor)textarea.current?.focus({preventScroll:true});},[editor?.id]);
 function clearSelection(){const current=document.getSelection();if(current?.rangeCount&&textBody?.contains(current.anchorNode)&&textBody.contains(current.focusNode))current.removeAllRanges();}
 function dismiss(){
  if(popup.current?.contains(document.activeElement))(trigger.current?.isConnected?trigger.current:body.current)?.focus({preventScroll:true});
  setEditor(undefined);setError('');setDismissed(nativeRange);clearSelection();editorRange.current=null;existing.current=false;
 }
 useEffect(()=>{if(editor&&existing.current&&!annotations.some(n=>n.id===editor.id))dismiss();},[annotations]);
 function begin(){
  setSavedNotice('');
  if(!bubble||!snapshot||!textBody?.isConnected||busy.current)return;
  const live=document.getSelection();if(live&&!live.isCollapsed&&(live.rangeCount!==1||!sameRange(snapshot.range,live.getRangeAt(0))))return;
  const anchor=captureTextAnchor(textBody,snapshot.range,representation);
  if(!anchor)return;
  if(anchor.exact.length>16000){onNotice('选中文字超过16000字符，请缩小选区。');return;}
  editorRange.current=restoreTextRange(textBody,anchor,representation)??snapshot.range;
  existing.current=false;trigger.current=null;setEditor({id:crypto.randomUUID(),text:anchor.exact,comment:'',anchor});setDismissed(snapshot.nativeRange);setError('');clearSelection();onNotice('');
 }
 function edit(note:PreviewTextAnnotation,button?:HTMLButtonElement){
  setSavedNotice('');
  if(busy.current)return;
  const range=textBody?restoreTextRange(textBody,note.anchor,representation):undefined;
  editorRange.current=range??null;existing.current=true;trigger.current=button??body.current?.querySelector<HTMLButtonElement>('[data-annotation-id="'+CSS.escape(note.id)+'"]')??null;setEditor({...note});setError(range?'':'原文暂无法准确定位；摘录与批注已保留。');clearSelection();
  if(range){const target=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement;target?.scrollIntoView({block:'nearest'});}
 }
 useEffect(()=>{if(focusAnnotation){const note=annotations.find(n=>n.id===focusAnnotation);if(note)edit(note);}},[focusAnnotation,focusRequest,textBody]);
 async function save(){
  if(!mounted.current||!editor||busy.current)return;
  if(existing.current&&!annotations.some(n=>n.id===editor.id)){dismiss();return;}
  const notes=annotations.some(n=>n.id===editor.id)?annotations.map(n=>n.id===editor.id?editor:n):[...annotations,editor];
  try{previewTextAnnotations(notes);}catch{setError('摘录或备注超出限制：最多20条、每条16000字符、总计48000字符。');return;}
  busy.current=true;setPending(true);
  try{await onReference({kind:'text',source,annotations:notes});if(mounted.current){dismiss();onNotice('');setSavedNotice('已加入输入草稿。');}}
  catch(error){if(mounted.current)setError(error instanceof Error?error.message:'批注保存失败，请重试。');}
  finally{busy.current=false;if(mounted.current)setPending(false);}
 }
 useLayoutEffect(()=>{
  const root=body.current?.querySelector('[data-preview-text]'),container=body.current;if(!root||!container)return;
  const registry=CSS.highlights;let frame=0;
  const draw=()=>{
   const ranges:Range[]=[],next:typeof positions=[];const box=container.getBoundingClientRect();
   for(const n of annotations){const r=restoreTextRange(root,n.anchor,representation);if(!r)continue;ranges.push(r);const rect=r.getClientRects()[0];if(rect)next.push({id:n.id,left:4,top:rect.top-box.top+container.scrollTop});}
   // Overlapping excerpts retain separate keyboard targets.
   next.sort((a,b)=>a.top-b.top);next.forEach((p,i)=>{if(i>0)p.top=Math.max(p.top,next[i-1]!.top+24);});
   if(registry&&typeof Highlight!=='undefined')registry.set(highlightName,new Highlight(...ranges));
   setPositions(next);
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};draw();
  const observer=new ResizeObserver(schedule);observer.observe(root);observer.observe(container);
  const mutation=new MutationObserver(records=>{if(records.some(record=>!(record.target instanceof Element?record.target:record.target.parentElement)?.closest('.text-annotation-markers,.preview-selection-positioner')))schedule();});mutation.observe(container,{subtree:true,childList:true,characterData:true});
  container.addEventListener('scroll',schedule);window.addEventListener('resize',schedule);document.fonts.addEventListener('loadingdone',schedule);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();container.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);document.fonts.removeEventListener('loadingdone',schedule);registry?.delete(highlightName);};
 },[annotations,representation,body,textBody,highlightName]);
 return <>
  <span className="sr-only" role="status">{savedNotice}</span>
  <style>{`::highlight(${highlightName}){background-color:color-mix(in srgb,var(--focus) 25%,transparent);color:inherit}`}</style>
  <div className="text-annotation-markers" aria-label="原文批注">{positions.map(p=>{const i=annotations.findIndex(n=>n.id===p.id),note=annotations[i];if(!note)return null;return <button type="button" key={p.id} className="text-annotation-marker" data-annotation-id={p.id} style={{left:p.left,top:p.top}} aria-label={`批注 ${i+1}：${note.text}；${note.comment}`} onClick={event=>edit(note,event.currentTarget)}>{i+1}</button>;})}</div>
  <Popover.Root open={!!editor||bubble} onOpenChange={next=>{if(!next&&!busy.current)dismiss();}}>
   <Popover.Portal container={body}><Popover.Positioner anchor={anchor} positionMethod="fixed" side={editor?'bottom':'top'} sideOffset={8} collisionBoundary={body.current??undefined} collisionPadding={8} sticky collisionAvoidance={{side:'flip',align:'shift'}} className="preview-selection-positioner">
    <Popover.Popup ref={popup} initialFocus={false} finalFocus={false} aria-label={editor?'编辑文件批注':'选区批注'} data-slot={editor?undefined:'selection-toolbar'} className={editor?'text-annotation-editor':'bg-popover flex items-center gap-1 rounded-lg border px-1 py-1'} onMouseDown={event=>{if(!editor)event.preventDefault();}}>
     {editor?<AnnotationCommentForm key={editor.id} ref={textarea} title={'文件批注 · '+source.title} excerpt={editor.text} value={editor.comment} onChange={comment=>{setEditor({...editor,comment});setError('');}} onSave={()=>void save()} onCancel={dismiss} onDelete={existing.current?()=>{onRemove(editor.id);dismiss();}:undefined} error={error} busy={pending}/>:<Button data-slot="selection-toolbar-quote" className="text-popover-foreground hover:bg-accent flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors" onClick={begin}><MessageCirclePlus className="size-3.5 shrink-0" aria-hidden/>批注</Button>}
    </Popover.Popup>
   </Popover.Positioner></Popover.Portal>
  </Popover.Root>
 </>;
}
