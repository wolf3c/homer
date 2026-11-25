import {Maximize,Minus,Plus} from 'lucide-react';
import {useEffectEvent,useLayoutEffect,useRef,useState,type PointerEvent,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

type Point={x:number;y:number};
type Zoom='fit'|number|null;
type Anchor={fraction:Point;target:Point};
const point=(event:{clientX:number;clientY:number}):Point=>({x:event.clientX,y:event.clientY});
const midpoint=(a:Point,b:Point):Point=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const fractionAt=(point:Point,rect:DOMRect):Point=>({x:(point.x-rect.left)/rect.width,y:(point.y-rect.top)/rect.height});

export function PreviewImageViewport({actions,locked=false,action,children}:{actions:HTMLElement|null;locked?:boolean;action?:ReactNode;children:ReactNode}){
 const viewport=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null);
 const pointers=useRef(new Map<number,Point>());
 const anchor=useRef<Anchor|null>(null);
 const pinch=useRef<{distance:number;scale:number;fraction:Point}|null>(null);
 const [dragging,setDragging]=useState(false),[zoom,setZoom]=useState<Zoom>(null);
 const [size,setSize]=useState({width:0,height:0}),[box,setBox]=useState({width:0,height:0});
 const ready=size.width>0&&size.height>0&&box.width>0;
 const fitWidth=ready?Math.min(box.width,1200)/size.width:1;
 const fit=ready?Math.min(fitWidth,box.height/size.height):1;
 const scale=zoom==='fit'?fit:zoom??fitWidth;
 const min=Math.min(.1,fit),max=Math.max(4,fitWidth);

 const scroller=()=>viewport.current?.closest<HTMLElement>('.canvas-image-body');
 function load(image:HTMLImageElement){
  setSize({width:image.naturalWidth,height:image.naturalHeight});
 }
 useLayoutEffect(()=>{
  if(!actions)return;
  const node=viewport.current,body=scroller();
  if(!node||!body)return;
  const measure=()=>{
   // Include notices above the image and the body's bottom padding in fit.
   const top=node.getBoundingClientRect().top-body.getBoundingClientRect().top+body.scrollTop;
   const bottom=parseFloat(getComputedStyle(body).paddingBottom)+14;
   const width=node.clientWidth,height=Math.max(1,body.clientHeight-top-bottom);
   setBox(previous=>previous.width===width&&previous.height===height?previous:{width,height});
  };
  const image=node.querySelector('img');
  if(image?.naturalWidth)load(image);
  body.scrollTo(0,0);
  measure();
  const observer=new ResizeObserver(measure);
  observer.observe(node);
  observer.observe(body);
  return()=>observer.disconnect();
 },[actions]);

 function align(position:Anchor){
  const body=scroller(),rect=stage.current?.getBoundingClientRect();
  if(!body||!rect)return;
  body.scrollLeft+=rect.left+position.fraction.x*rect.width-position.target.x;
  body.scrollTop+=rect.top+position.fraction.y*rect.height-position.target.y;
 }
 useLayoutEffect(()=>{
  const position=anchor.current;
  anchor.current=null;
  if(position)align(position);
 },[zoom,scale]);

 function applyZoom(next:number,position:Anchor){
  const scaleNext=Math.max(min,Math.min(max,next));
  if(scaleNext===zoom){
   anchor.current=null;
   align(position);
  }else anchor.current=position;
  setZoom(scaleNext);
 }
 function zoomTo(next:number,from?:Point){
  const body=scroller(),rect=stage.current?.getBoundingClientRect();
  if(locked||!ready||!body||!rect)return;
  const bounds=body.getBoundingClientRect();
  const origin=from??{
   x:Math.max(rect.left,Math.min(bounds.left+body.clientWidth/2,rect.right)),
   y:Math.max(rect.top,Math.min(bounds.top+body.clientHeight/2,rect.bottom)),
  };
  applyZoom(next,{fraction:fractionAt(origin,rect),target:origin});
 }

 const onWheel=useEffectEvent((event:WheelEvent)=>{
  if(!event.ctrlKey)return;
  event.preventDefault();
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?box.height:1);
  zoomTo(scale*Math.exp(-delta*.01),point(event));
 });
 useLayoutEffect(()=>{
  const node=stage.current;
  const wheel=(event:WheelEvent)=>onWheel(event);
  node?.addEventListener('wheel',wheel,{passive:false});
  return()=>node?.removeEventListener('wheel',wheel);
 },[]);

 function start(event:PointerEvent<HTMLDivElement>){
  const active=pointers.current;
  if(locked||!ready||event.button!==0||active.size===2||active.size&&(event.pointerType!=='touch'||event.isPrimary))return;
  active.set(event.pointerId,point(event));
  if(active.size===2){
   const [a,b]=active.values(),span=distance(a,b);
   if(span>0)pinch.current={distance:span,scale,fraction:fractionAt(midpoint(a,b),event.currentTarget.getBoundingClientRect())};
  }
  event.currentTarget.setPointerCapture(event.pointerId);
  setDragging(true);
 }
 function move(event:PointerEvent<HTMLDivElement>){
  const active=pointers.current,previous=active.get(event.pointerId),body=scroller();
  if(locked||!previous||!body)return;
  const next=point(event);
  active.set(event.pointerId,next);
  if(active.size===2){
   const baseline=pinch.current,[a,b]=active.values();
   // One touch move can update both pointers before React commits a resize.
   if(baseline)applyZoom(baseline.scale*distance(a,b)/baseline.distance,{fraction:baseline.fraction,target:midpoint(a,b)});
  }else{
   body.scrollLeft+=previous.x-next.x;
   body.scrollTop+=previous.y-next.y;
  }
 }
 function end(event:PointerEvent<HTMLDivElement>){
  if(!pointers.current.delete(event.pointerId))return;
  pinch.current=null;
  if(!pointers.current.size)setDragging(false);
 }

 const disabled=locked||!ready;
 return <>
  {actions&&createPortal(<div className="canvas-image-controls" role="group" aria-label="图片缩放" tabIndex={-1} onFocus={event=>{
   if(!(event.target instanceof HTMLButtonElement))return;
   const group=event.currentTarget,clip=group.getBoundingClientRect(),button=event.target.getBoundingClientRect();
   if(button.left<clip.left)group.scrollLeft+=button.left-clip.left;
   else if(button.right>clip.right)group.scrollLeft+=button.right-clip.right;
  }}>
   <button className="aui-button-icon" type="button" aria-label="缩小图片" title="缩小图片" disabled={disabled||scale<=min} onClick={()=>zoomTo(scale/1.25)}><Minus aria-hidden/></button>
   <span className="canvas-image-scale" aria-label="当前缩放比例">{ready?`${Number((scale*100).toFixed(scale<.1?1:0))}%`:'—'}</span>
   <button className="aui-button-icon" type="button" aria-label="放大图片" title="放大图片" disabled={disabled||scale>=max} onClick={()=>zoomTo(scale*1.25)}><Plus aria-hidden/></button>
   <button className="aui-button-icon image-fit" type="button" aria-label="适应窗口" title="适应窗口" aria-pressed={zoom==='fit'} disabled={disabled} onClick={()=>{
    anchor.current=null;
    setZoom('fit');
    scroller()?.scrollTo(0,0);
   }}><Maximize aria-hidden/><span>适应窗口</span></button>
   <button className="aui-button-icon image-original-size" type="button" aria-label="100%" title="按原图像素显示" aria-pressed={zoom===1} disabled={disabled} onClick={()=>zoomTo(1)}>100%</button>
  </div>,actions)}
  {actions&&action&&createPortal(action,actions)}
  <div ref={viewport} className="canvas-image-viewport" onLoadCapture={event=>{
   if(event.target instanceof HTMLImageElement)load(event.target);
  }}>
   <div ref={stage} className="canvas-image-stage" data-pannable={!locked||undefined} data-dragging={!locked&&dragging||undefined}
    style={{width:ready?size.width*scale:undefined}} onPointerDown={start} onPointerMove={move}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    {children}
   </div>
  </div>
 </>;
}
