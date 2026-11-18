import React,{useEffect,useState}from'react';
import './annotation-marker.css';
import{createRoot}from'react-dom/client';
import{Popover}from'@base-ui/react/popover';
import{getElementAtPoint,getElementBounds,getElementSelector}from'react-grab/primitives';
import{AnnotationCommentForm}from'./annotation-comment-form';
import type{PreviewAnnotation}from'../src/preview-reference';
import type{BrowserAnnotationState,BrowserAnnotationReply,BrowserAnnotationChange}from'../src/browser-preview';
const bridge=(globalThis as typeof globalThis&{homerAnnotationBridge:{begin:()=>Promise<void>;read:()=>Promise<BrowserAnnotationState>;save:(change:Omit<BrowserAnnotationChange,'pageId'>)=>Promise<BrowserAnnotationReply>;subscribe:(listener:(state:BrowserAnnotationState)=>void)=>()=>void}}).homerAnnotationBridge;
const host=document.createElement('div');host.dataset.homerAnnotation='';document.body.append(host);
const shadow=host.attachShadow({mode:'open'}),sheet=new CSSStyleSheet();
sheet.replaceSync((globalThis as typeof globalThis&{homerAnnotationCss:string}).homerAnnotationCss+`:host{all:initial;font:14px system-ui} .marker{position:fixed;z-index:2147483645;cursor:pointer} .outline{position:fixed;z-index:2147483644} .editor{z-index:2147483646}`);shadow.adoptedStyleSheets=[sheet];
const mount=document.createElement('div');shadow.append(mount);
let notes:PreviewAnnotation[]=[],active=false,editor:PreviewAnnotation|undefined,version=0,revision=0,epoch=0,focusedRequest:string|undefined;const targets=new Map<string,Element>();let notify=()=>{};let dispose=()=>{};
let hovered:Element|null=null,hoverFrame=0;
function clearHover(){cancelAnimationFrame(hoverFrame);hoverFrame=0;if(hovered){hovered=null;notify();}}
function move(event:PointerEvent){
 if(!active||editor||event.composedPath().includes(host)){clearHover();return;}
 cancelAnimationFrame(hoverFrame);const x=event.clientX,y=event.clientY;
 hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(!active||editor)return;const el=getElementAtPoint(x,y),next=el&&el!==document.body&&el!==document.documentElement&&el!==host?el:null;if(hovered!==next){hovered=next;notify();}});
}
function leave(event:PointerEvent){if(!event.relatedTarget)clearHover();}
function sync(s:BrowserAnnotationState){if(!s.active||s.document!==version||s.epoch!==epoch)clearHover();if(s.document!==version||s.epoch!==epoch){editor=undefined;targets.clear();}if(active&&!s.active)editor=undefined;version=s.document;revision=s.revision;epoch=s.epoch;notes=s.notes;active=s.active;if(s.focusId&&s.focusRequest!==focusedRequest){focusedRequest=s.focusRequest;const n=notes.find(n=>n.id===s.focusId);if(n)target(n)?.scrollIntoView({block:'center'});}notify();}
async function refresh(){const s=await bridge.read();sync(s);return s;}
function target(note:PreviewAnnotation){let e=targets.get(note.id);if(e?.isConnected)return e;try{const matches=document.querySelectorAll(note.elementPath);if(matches.length===1){e=matches[0];targets.set(note.id,e);return e;}}catch{}return null;}
async function edit(note:PreviewAnnotation,element?:Element){clearHover();try{await bridge.begin();await refresh();editor={...note};if(element)targets.set(note.id,element);notify();}catch{editor=undefined;notify();}}
function click(event:MouseEvent){
 if(!active||event.composedPath().includes(host))return;
 event.preventDefault();event.stopImmediatePropagation();
 const el=getElementAtPoint(event.clientX,event.clientY);if(!el||el===document.body||el===host)return;
 const rect=getElementBounds(el);void edit({id:crypto.randomUUID(),element:(el.textContent?.trim()||el.tagName).slice(0,200),elementPath:getElementSelector(el),comment:'',x:Math.max(0,rect.x),y:Math.max(0,rect.y),boundingBox:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},el);
}
function suppress(event:Event){if(active&&!event.composedPath().includes(host)){event.preventDefault();event.stopImmediatePropagation();}}
for(const type of ['pointerdown','mousedown','mouseup'])document.addEventListener(type,suppress,true);
document.addEventListener('click',click,true);
document.addEventListener('pointermove',move,{capture:true,passive:true});
document.addEventListener('pointerout',leave,true);
const root=createRoot(mount);
function App(){
 const [,tick]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');notify=()=>tick(x=>x+1);
 useEffect(()=>{
  let frame=0;const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>notify());};
  const ro=new ResizeObserver(schedule);ro.observe(document.body);
  const mo=new MutationObserver(records=>{if(records.some(r=>r.target!==host&&!host.contains(r.target)))schedule();});mo.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open']});
  addEventListener('scroll',schedule,true);addEventListener('resize',schedule);
  return()=>{cancelAnimationFrame(frame);ro.disconnect();mo.disconnect();removeEventListener('scroll',schedule,true);removeEventListener('resize',schedule);};
 },[]);
 async function save(remove=false){
  if(!editor||busy)return;setBusy(true);setError('');
  const current=editor;const candidate=remove?notes.filter(n=>n.id!==current.id):notes.some(n=>n.id===current.id)?notes.map(n=>n.id===current.id?current:n):[...notes,current];
  try{const changeId=crypto.randomUUID(),ack=await bridge.save({document:version,baseRevision:revision,epoch,changeId,notes:candidate});if(ack.error)throw Error(ack.error);if(ack.changeId!==changeId)throw Error('confirmation_mismatch');notes=ack.notes;revision=ack.revision;epoch=ack.epoch;editor=undefined;notify();}catch(e){setError(e instanceof Error?e.message:'批注保存尚未确认，输入已保留。');}finally{setBusy(false);}
 }
 const rect=editor&&target(editor)?.getBoundingClientRect();
 const anchor={getBoundingClientRect:()=>rect??new DOMRect(40,40,1,1)};
 const hoverRect=active&&!editor&&hovered?.isConnected?hovered.getBoundingClientRect():null;
 return <>{hoverRect&&<span className="outline annotation-outline annotation-hover-outline" style={{left:hoverRect.left,top:hoverRect.top,width:hoverRect.width,height:hoverRect.height,borderStyle:'dashed'}}/>}{notes.map((n,i)=>{const el=target(n);if(!el)return null;const r=el.getBoundingClientRect();return <React.Fragment key={n.id}><span className="outline annotation-outline" style={{left:r.left,top:r.top,width:r.width,height:r.height}}/><button className="marker annotation-marker" aria-label={'批注 '+(i+1)} style={{left:Math.max(0,r.left-14),top:r.top-14}} onClick={()=>void edit(n,el)}>{i+1}</button></React.Fragment>;})}<Popover.Root open={!!editor} onOpenChange={open=>{if(!open&&!busy){editor=undefined;notify();}}}><Popover.Portal container={mount}><Popover.Positioner className="editor" anchor={anchor} positionMethod="fixed" side="bottom" sideOffset={8} collisionPadding={12} collisionAvoidance={{side:'flip',align:'shift'}}><Popover.Popup initialFocus={false} finalFocus={false}>{editor&&<AnnotationCommentForm title="网页元素批注" excerpt={editor.element} value={editor.comment} busy={busy} error={error} onChange={v=>{editor=editor?{...editor,comment:v}:undefined;notify();}} onSave={()=>void save()} onCancel={()=>{editor=undefined;notify();}} onDelete={notes.some(n=>n.id===editor?.id)?()=>void save(true):undefined}/>}</Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root></>;
}
const unsubscribe=bridge.subscribe(sync);
dispose=()=>{cancelAnimationFrame(hoverFrame);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerout',leave,true);unsubscribe();root.unmount();host.remove();document.removeEventListener('click',click,true);for(const t of ['pointerdown','mousedown','mouseup'])document.removeEventListener(t,suppress,true);};
addEventListener('pagehide',()=>dispose(),{once:true});
void refresh().then(()=>root.render(<App/>)).catch(()=>dispose());
