import {useCallback,useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {createPortal} from 'react-dom';
import {Annotorious,ImageAnnotator,ImageAnnotationPopup,useAnnotator,useAnnotations,type PopupProps} from '@annotorious/react';
import {ShapeType,UserSelectAction,type Rectangle,type ImageAnnotator as Annotator,type ImageAnnotation as NativeAnnotation} from '@annotorious/annotorious';
import {MessageCirclePlus} from 'lucide-react';
import {TooltipIconButton} from './vendor/assistant-ui/attachment-icon-button';
import {AnnotationCommentForm} from './annotation-comment-form';
import {previewImageAnnotations,type PreviewImageAnnotation} from '../src/preview-reference';
import '@annotorious/react/annotorious-react.css';
import './image-annotation.css';

// The composer owns saved notes and File identity; the native store is only
// the current projection plus temporary drawing/handle edits.
export type ImageAnnotationControl={escape:()=>boolean;cancel:()=>void;editing:()=>boolean};
type Pending={cancel:()=>void};
const note=(a:NativeAnnotation)=>String(a.bodies.find(b=>b.purpose==='commenting')?.value??'');
const saved=(items:NativeAnnotation[])=>items.filter(a=>note(a).trim()&&a.properties?.homerOrder).sort((a,b)=>a.properties!.homerOrder-b.properties!.homerOrder);
// 3.9.5's rectangle editor can publish the previous bounds with fresh x/y/w/h.
// Serialize the native rectangle itself, not its lagging derived bounding box.
const coordinates=(a:NativeAnnotation)=>{
 const g=(a.target.selector as Rectangle).geometry;
 if(!g.rot)return {x:g.x,y:g.y,width:g.w,height:g.h};
 const c=Math.abs(Math.cos(g.rot)),s=Math.abs(Math.sin(g.rot)),width=g.w*c+g.h*s,height=g.w*s+g.h*c;
 return {x:g.x+(g.w-width)/2,y:g.y+(g.h-height)/2,width,height};
};
function withCurrentBounds(a:NativeAnnotation):NativeAnnotation{
 const r=coordinates(a);return {...a,target:{...a.target,selector:{...a.target.selector,geometry:{...a.target.selector.geometry,bounds:{minX:r.x,minY:r.y,maxX:r.x+r.width,maxY:r.y+r.height}}}}};
}
function fromNotes(notes:readonly PreviewImageAnnotation[]):NativeAnnotation[]{
 return notes.map((n,i)=>({id:n.id,bodies:[{id:'homer-comment:'+n.id,annotation:n.id,purpose:'commenting',value:n.comment}],properties:{homerOrder:i+1},target:{annotation:n.id,selector:{type:ShapeType.RECTANGLE,geometry:{x:n.region.x,y:n.region.y,w:n.region.width,h:n.region.height,bounds:{minX:n.region.x,minY:n.region.y,maxX:n.region.x+n.region.width,maxY:n.region.y+n.region.height}}}}}));
}
function RegionComment({popup,anno,pending,onDone,title,image,onSave,onRemove,canonical}:{popup:PopupProps;anno:Annotator;pending:MutableRefObject<Pending|null>;onDone:()=>void;title:string;image:HTMLImageElement|null;onSave:(items:import('../src/preview-reference').PreviewImageAnnotation[])=>Promise<void>;onRemove:(id:string)=>void;canonical:(id:string)=>NativeAnnotation|undefined}){
 const id=popup.annotation.id,ended=useRef(false),textarea=useRef<HTMLTextAreaElement>(null);
 const existing=!!canonical(id);
 const [comment,setComment]=useState(()=>note(popup.annotation)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const cancel=useCallback(()=>{if(ended.current)return;ended.current=true;const original=canonical(id);if(original)anno.updateAnnotation(withCurrentBounds(original));else anno.removeAnnotation(id);},[anno,canonical,id]);
 useLayoutEffect(()=>{const transaction={cancel};pending.current=transaction;return()=>{cancel();if(pending.current===transaction)pending.current=null;};},[pending,cancel]);
 useLayoutEffect(()=>{textarea.current?.focus({preventScroll:true});},[]);
 const finish=()=>{anno.cancelSelected();onDone();};
 const save=async()=>{
  if(!image||!comment.trim()||ended.current)return;
  const current=anno.getAnnotationById(popup.annotation.id);if(!current)return;
  const candidate={id:current.id,region:coordinates(current),comment};
  const previous=saved(anno.getAnnotations()).map(a=>({id:a.id,region:coordinates(a),comment:note(a)}));
  const notes=previous.some(n=>n.id===current.id)?previous.map(n=>n.id===current.id?candidate:n):[...previous,candidate];
  try{previewImageAnnotations(notes,image.naturalWidth,image.naturalHeight);}
  catch{setError('区域或备注超出限制，请调整后保存。最多20处，每处16000字，总计48000字。');return;}
  setBusy(true);
  try{
   await onSave(notes);
   if(ended.current)return;
   // The canonical draft projects bodies and final bounds through the native
   // public store. Do not write a second saved snapshot through popup callbacks.
   ended.current=true;finish();
  }catch(error){if(!ended.current)setError(error instanceof Error?error.message:'批注保存失败，请重试。');}
  finally{setBusy(false);}

 };
 return <AnnotationCommentForm ref={textarea} title={'图片区域 · '+title} value={comment} busy={busy} error={error}
  onChange={value=>{setComment(value);setError('');}} onSave={()=>void save()} onCancel={()=>{cancel();finish();}}
  onDelete={existing?()=>{if(ended.current)return;ended.current=true;onRemove(popup.annotation.id);anno.removeAnnotation(popup.annotation.id);finish();}:undefined}/>;
}
type Props={url:string;title:string;actions?:HTMLElement;control:MutableRefObject<ImageAnnotationControl|null>;notes:readonly PreviewImageAnnotation[];onSave:(notes:PreviewImageAnnotation[],size:{width:number;height:number},isCurrent:()=>boolean)=>Promise<void>;onRemove:(id:string)=>void;focusAnnotation?:string;focusRequest?:string};
function Regions({url,title,actions,control,notes,onSave,onRemove,focusAnnotation,focusRequest}:Props){
 const anno=useAnnotator<Annotator>(),annotations=useAnnotations<NativeAnnotation>(),regions=saved(annotations);
 const image=useRef<HTMLImageElement>(null),stage=useRef<HTMLDivElement>(null),toggle=useRef<HTMLButtonElement>(null),pending=useRef<Pending|null>(null),mounted=useRef(true);
 const [drawingEnabled,setEnabled]=useState(true),[dimensions,setDimensions]=useState({width:0,height:0});
 const enabled=!actions||drawingEnabled;
 const previous=useRef<NativeAnnotation[]>([]),notesRef=useRef(notes);notesRef.current=notes;
 const canonical=useCallback((id:string)=>fromNotes(notesRef.current).find(note=>note.id===id),[]);
 const cancelPending=useCallback(()=>{pending.current?.cancel();anno?.cancelDrawing();anno?.cancelSelected();},[anno]);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{if(!anno)return;if(image.current)setDimensions({width:image.current.naturalWidth,height:image.current.naturalHeight});return()=>{cancelPending();anno.destroy();};},[anno,cancelPending]);
 useLayoutEffect(()=>{
  if(!anno)return;
  const next=fromNotes(notes);
  const deleted=previous.current.filter(old=>!next.some(n=>n.id===old.id));
  for(const old of deleted){if(anno.getSelected().some(n=>n.id===old.id))cancelPending();anno.removeAnnotation(old.id);}
  for(const item of next){
   const old=previous.current.find(n=>n.id===item.id),actual=anno.getAnnotationById(item.id);
   if(!actual)anno.addAnnotation(withCurrentBounds(item));
   else if(!old||JSON.stringify([coordinates(old),note(old)])!==JSON.stringify([coordinates(item),note(item)]))anno.updateAnnotation(withCurrentBounds(item));
   else if(old.properties?.homerOrder!==item.properties?.homerOrder)anno.updateAnnotation(withCurrentBounds({...actual,properties:{...actual.properties,homerOrder:item.properties?.homerOrder}}));
  }
  previous.current=next;
 },[anno,notes,cancelPending]);
 useLayoutEffect(()=>{if(anno&&focusAnnotation&&anno.getAnnotationById(focusAnnotation)){setEnabled(true);anno.setSelected(focusAnnotation,true);}},[anno,focusAnnotation,focusRequest]);
 useLayoutEffect(()=>{
  const value={cancel:cancelPending,editing:()=>!!pending.current||!!anno?.getSelected().length,escape:()=>{
   if(pending.current||anno?.getSelected().length){cancelPending();toggle.current?.focus({preventScroll:true});return true;}
   if(actions&&enabled){cancelPending();setEnabled(false);toggle.current?.focus({preventScroll:true});return true;}
   return false;
  }};control.current=value;return()=>{if(control.current===value)control.current=null;};
 },[anno,actions,enabled,cancelPending,control]);
 const done=useCallback(()=>{stage.current?.querySelector<SVGElement>('.a9s-annotationlayer')?.focus({preventScroll:true});},[]);
 const save=useCallback(async(annotations:PreviewImageAnnotation[])=>{
  if(!image.current)throw Error('原图尚未读取完成，请重试。');
  await onSave(annotations,{width:image.current.naturalWidth,height:image.current.naturalHeight},()=>mounted.current);
 },[onSave]);
 const popup=useCallback((props:PopupProps)=><RegionComment key={props.annotation.id} popup={props} anno={anno} pending={pending} onDone={done} title={title} image={image.current} onSave={save} onRemove={onRemove} canonical={canonical}/>,[anno,done,title,save,onRemove,canonical]);
 return <>{actions&&createPortal(<TooltipIconButton ref={toggle} className="image-annotation-toggle" tooltipContainer={actions} aria-label="批注" aria-pressed={enabled} tooltip={enabled?'退出图片批注':'开始图片批注'} onClick={()=>{cancelPending();setEnabled(value=>!value);}}><MessageCirclePlus size={14} aria-hidden/><span>批注</span></TooltipIconButton>,actions)}
 <div ref={stage} className={'image-annotation'+(enabled?' is-annotating':'')}>
  <ImageAnnotator containerClassName="annotation-image" tool="rectangle" drawingEnabled={enabled} drawingMode="drag" userSelectAction={enabled?UserSelectAction.EDIT:UserSelectAction.NONE} theme="auto" disableUndoRedoKeys><img ref={image} onLoad={()=>setDimensions({width:image.current!.naturalWidth,height:image.current!.naturalHeight})} src={url} alt={title} draggable={false}/></ImageAnnotator>
  <div className="image-region-labels" aria-label={`${regions.length} 个已保存区域`}>{dimensions.width>0&&regions.map((a,i)=>{const r=coordinates(a);return <span key={a.id} data-annotation-id={a.id} className="image-region-number" style={{left:`clamp(0px, ${r.x/dimensions.width*100}%, calc(100% - 23px))`,top:`clamp(0px, ${r.y/dimensions.height*100}%, calc(100% - 23px))`}} title={`区域 ${i+1} · ${note(a)}`}>{i+1}</span>;})}</div>
  {enabled&&<ImageAnnotationPopup popup={popup}/>}
 </div></>;
}
export default function ImageAnnotation(props:Props){return <Annotorious><Regions {...props}/></Annotorious>;}
