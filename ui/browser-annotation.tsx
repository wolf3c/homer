import React,{useEffect,useLayoutEffect,useState}from'react';
import './annotation-marker.css';
import{createRoot}from'react-dom/client';
import{Popover}from'@base-ui/react/popover';
import{getElementAtPoint,getElementBounds,getElementSelector}from'react-grab/primitives';
import{AnnotationCommentForm}from'./annotation-comment-form';
import type{PreviewAnnotation}from'../src/preview-reference';
import type{BrowserAnnotationState,BrowserAnnotationReply,BrowserAnnotationChange,BrowserCaptureImage,BrowserAnnotationCapture}from'../src/browser-preview';
const bridge=(globalThis as typeof globalThis&{homerAnnotationBridge:{begin:()=>Promise<void>;read:()=>Promise<BrowserAnnotationState>;capture:(document:number)=>Promise<BrowserCaptureImage>;save:(change:Omit<BrowserAnnotationChange,'pageId'|'expiresAt'>)=>Promise<BrowserAnnotationReply>;subscribe:(listener:(state:BrowserAnnotationState)=>void)=>()=>void}}).homerAnnotationBridge;
const localDocument=location.protocol==='homer-preview:'&&location.pathname==='/local/index.html';
const elementText=(element:Element)=>(element.textContent?.trim()||element.tagName).slice(0,200);
const host=document.createElement('div');host.dataset.homerAnnotation='';document.body.append(host);
const modalOf=(element:Element|null|undefined)=>element?.isConnected&&element.ownerDocument===document
 ?element.closest<HTMLDialogElement>('dialog:modal'):null;
function mountIn(modal:HTMLDialogElement|null){
 const parent=modal??document.body;
 if(host.parentElement===parent)return;
 if(host.matches(':popover-open'))host.hidePopover();
 host.removeAttribute('popover');host.removeAttribute('style');
 if(modal&&typeof host.showPopover==='function'){
  modal.append(host);
  host.popover='manual';
  host.style.cssText='position:fixed;inset:0 auto auto 0;margin:0;padding:0;border:0;background:transparent;width:0;height:0;overflow:visible;pointer-events:none';
  try{host.showPopover();return;}catch{host.removeAttribute('popover');host.removeAttribute('style');}
 }
 document.body.append(host);
}
const shadow=host.attachShadow({mode:'open'}),sheet=new CSSStyleSheet();
sheet.replaceSync((globalThis as typeof globalThis&{homerAnnotationCss:string}).homerAnnotationCss+`:host{all:initial;font:14px system-ui} .marker{position:fixed;z-index:2147483645;cursor:pointer} .outline{position:fixed;z-index:2147483644} .editor{z-index:2147483646} :host([popover]) :is(.editor,.marker){pointer-events:auto}`);shadow.adoptedStyleSheets=[sheet];
const mount=document.createElement('div');shadow.append(mount);
let notes:PreviewAnnotation[]=[],active=false,editor:PreviewAnnotation|undefined,version=0,revision=0,epoch=0,focusedRequest:string|undefined;const editorElements=new WeakMap<PreviewAnnotation,Element>();const targets=new Map<string,{element:Element;modal?:HTMLDialogElement}>();let notify=()=>{};let dispose=()=>{};
let historyNote:PreviewAnnotation|undefined;
let hovered:Element|null=null,hoverFrame=0;
function clearHover(){cancelAnimationFrame(hoverFrame);hoverFrame=0;if(hovered){hovered=null;notify();}}
function move(event:PointerEvent){
 if(!active||editor||event.composedPath().includes(host)){clearHover();return;}
 cancelAnimationFrame(hoverFrame);const x=event.clientX,y=event.clientY;
 hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(!active||editor)return;const el=getElementAtPoint(x,y),next=el&&el!==document.body&&el!==document.documentElement&&el!==host?el:null;if(hovered!==next){hovered=next;notify();}});
}
function leave(event:PointerEvent){if(!event.relatedTarget)clearHover();}
function sync(s:BrowserAnnotationState){if(!s.active||s.document!==version||s.epoch!==epoch)clearHover();if(s.document!==version||s.epoch!==epoch){editor=undefined;targets.clear();}if(active&&!s.active)editor=undefined;version=s.document;revision=s.revision;epoch=s.epoch;notes=s.notes;active=s.active;historyNote=s.historyNote;if(s.focusId&&s.focusRequest!==focusedRequest){focusedRequest=s.focusRequest;const n=historyNote??notes.find(n=>n.id===s.focusId);if(n)target(n)?.scrollIntoView({block:'center'});}notify();}
async function refresh(){const s=await bridge.read();sync(s);return s;}
function target(note:PreviewAnnotation){
 const binding=targets.get(note.id),element=binding?.element;
 if(binding?.modal)return modalOf(binding.element)===binding.modal&&binding.element.getClientRects().length
  &&(!localDocument||elementText(binding.element)===note.element)?binding.element:null;
 if(element?.isConnected&&(!localDocument||elementText(element)===note.element))return element;
 try{const matches=document.querySelectorAll(note.elementPath);if(matches.length===1&&(!localDocument||elementText(matches[0]!)===note.element)){const match=matches[0]!;targets.set(note.id,{element:match});return match;}}catch{}return null;
}
async function edit(note:PreviewAnnotation,element:Element){
 const modal=modalOf(element),editVersion=version,editEpoch=epoch,wasActive=active;
 clearHover();
 try{
  await bridge.begin();await refresh();
  if(wasActive&&!active||editVersion!==version||editEpoch!==epoch)return;
  editor={...note};editorElements.set(editor,element);targets.set(note.id,{element,modal:modal??undefined});notify();
 }catch{editor=undefined;notify();}
}
function click(event:MouseEvent){
 if(!active||event.composedPath().includes(host)||localDocument&&!event.isTrusted)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(editor&&targets.get(editor.id)?.modal)return;
 const el=getElementAtPoint(event.clientX,event.clientY);if(!el||el===document.body||el===host)return;
 const rect=getElementBounds(el);void edit({id:crypto.randomUUID(),element:elementText(el),elementPath:getElementSelector(el),comment:'',x:Math.max(0,rect.x),y:Math.max(0,rect.y),boundingBox:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},el);
}
function suppress(event:Event){if(active&&!event.composedPath().includes(host)){event.preventDefault();event.stopImmediatePropagation();}}
for(const type of ['pointerdown','mousedown','mouseup'])document.addEventListener(type,suppress,true);
document.addEventListener('click',click,true);
document.addEventListener('pointermove',move,{capture:true,passive:true});
document.addEventListener('pointerout',leave,true);
const root=createRoot(mount);
function App(){
 const [,tick]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');notify=()=>tick(x=>x+1);
 const editorBinding=editor&&targets.get(editor.id);
 const historyTarget=historyNote&&target(historyNote);
 const modal=editor?modalOf(editorBinding?.modal)
  :active&&hovered?.isConnected?modalOf(hovered):modalOf(historyTarget)??(active||notes.length?modalOf(host.parentElement):null);
 const inScope=(element:Element|null|undefined)=>!modal||modalOf(element)===modal;
 useLayoutEffect(()=>mountIn(modal),[modal]);
 useEffect(()=>{
  let frame=0;const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>notify());};
  const ro=new ResizeObserver(schedule);ro.observe(document.body);
  const mo=new MutationObserver(records=>{if(records.some(r=>r.target!==host&&!host.contains(r.target)))schedule();});mo.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open']});
  addEventListener('scroll',schedule,true);addEventListener('resize',schedule);
  return()=>{cancelAnimationFrame(frame);ro.disconnect();mo.disconnect();removeEventListener('scroll',schedule,true);removeEventListener('resize',schedule);};
 },[]);
 async function captureNote(note:PreviewAnnotation):Promise<{note:PreviewAnnotation;capture?:BrowserAnnotationCapture}>{
  const element=editorElements.get(note);
  const current=()=>element?.isConnected&&element.ownerDocument===document&&editor===note;
  const geometry=()=>{
   const rect=element!.getBoundingClientRect();
   return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollX,scrollY};
  };
  if(!current())return {note};
  const before=geometry(),{x,y,width,height,viewportWidth,viewportHeight}=before;
  const updated={...note,x:Math.max(0,x),y:Math.max(0,y),boundingBox:{x,y,width,height}};
  const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(viewportWidth,x+width),bottom=Math.min(viewportHeight,y+height);
  if(right<=left||bottom<=top)return {note:width>0&&height>0?updated:note};
  const documentAtCapture=version;
  let timer:ReturnType<typeof setTimeout>|undefined,finished=false;
  try{
   mount.style.visibility='hidden';
   const image=await Promise.race([
    new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))).then(()=>{if(finished||!current())throw Error('preview_capture_cancelled');return bridge.capture(documentAtCapture);}),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('preview_capture_timeout')),2000);}),
   ]);
   if(!current()||JSON.stringify(before)!==JSON.stringify(geometry()))return {note:updated};
   const sx=image.width/viewportWidth,sy=image.height/viewportHeight;
   const px=Math.floor(left*sx),py=Math.floor(top*sy);
   return {note:updated,capture:{...image,noteId:note.id,region:{x:px,y:py,width:Math.min(image.width,Math.ceil(right*sx))-px,height:Math.min(image.height,Math.ceil(bottom*sy))-py}}};
  }catch{return {note:updated};}
  finally{finished=true;clearTimeout(timer);mount.style.visibility='';}
 }
 async function save(remove=false){
  if(!editor||busy)return;setBusy(true);setError('');
  const selected=editor,documentAtSave=version,epochAtSave=epoch,revisionAtSave=revision,previous=notes.find(n=>n.id===selected.id);
  try{
   const captureRequested=!remove&&!previous;
   const {note,capture}=captureRequested?await captureNote(selected):{note:{...selected,...(previous?.screenshot?{screenshot:previous.screenshot}:{})},capture:undefined};
   if(!editor||version!==documentAtSave||epoch!==epochAtSave||revision!==revisionAtSave)throw Error('页面或草稿已变化，输入已保留，请重新保存。');
   const candidate=remove?notes.filter(n=>n.id!==note.id):previous?notes.map(n=>n.id===note.id?note:n):[...notes,note];
   const changeId=crypto.randomUUID(),ack=await bridge.save({document:version,baseRevision:revision,epoch,changeId,notes:candidate,...(capture?{capture}:captureRequested?{captureFailed:true}:{})});if(ack.error)throw Error(ack.error);if(ack.changeId!==changeId)throw Error('confirmation_mismatch');notes=ack.notes;revision=ack.revision;epoch=ack.epoch;editor=undefined;notify();}catch(e){setError(e instanceof Error?e.message:'批注保存尚未确认，输入已保留。');}finally{setBusy(false);}
 }
 const editorTarget=editor&&target(editor);
 const rect=editorTarget?.getBoundingClientRect();
 const anchor=(modal&&editorTarget)||{getBoundingClientRect:()=>rect??new DOMRect(40,40,1,1)};
 const hoverRect=active&&!editor&&hovered?.isConnected?hovered.getBoundingClientRect():null;
 const historyRect=historyTarget?.getBoundingClientRect();
 return <>{historyRect&&inScope(historyTarget)&&<span className="outline annotation-outline" style={{left:historyRect.left,top:historyRect.top,width:historyRect.width,height:historyRect.height}}/>}{historyNote&&!historyTarget&&<p role="status" style={{position:'fixed',top:8,left:8,background:'white',color:'black',zIndex:2147483646}}>当前页面无法定位此批注，原备注已保留。</p>}{hoverRect&&<span className="outline annotation-outline annotation-hover-outline" style={{left:hoverRect.left,top:hoverRect.top,width:hoverRect.width,height:hoverRect.height,borderStyle:'dashed'}}/>}{notes.map((n,i)=>{const el=target(n);if(!el||!inScope(el))return null;const r=el.getBoundingClientRect();return <React.Fragment key={n.id}><span className="outline annotation-outline" style={{left:r.left,top:r.top,width:r.width,height:r.height}}/><button className="marker annotation-marker" aria-label={'批注 '+(i+1)} style={{left:Math.max(0,r.left-14),top:r.top-14}} onClick={()=>void edit(n,el)}>{i+1}</button></React.Fragment>;})}<Popover.Root open={!!editor} onOpenChange={(open,details)=>{if(open||busy)return;if(editorBinding?.modal&&(details.reason!=='escape-key'||!shadow.activeElement)){details.cancel();details.allowPropagation();return;}editor=undefined;notify();}}><Popover.Portal container={mount}><Popover.Positioner className="editor" anchor={anchor} positionMethod="fixed" side="bottom" sideOffset={8} collisionPadding={12} collisionBoundary={modal?[]:undefined} collisionAvoidance={{side:'shift',align:'shift'}} sticky><Popover.Popup initialFocus={false} finalFocus={false}>{editor&&<AnnotationCommentForm trustedInput title="网页元素批注" excerpt={editor.element} value={editor.comment} busy={busy} error={error} onChange={v=>{if(editor){const original=editorElements.get(editor);editor={...editor,comment:v};if(original)editorElements.set(editor,original);}notify();}} onSave={()=>void save()} onCancel={()=>{editor=undefined;notify();}} onDelete={notes.some(n=>n.id===editor?.id)?()=>void save(true):undefined}/>}</Popover.Popup></Popover.Positioner></Popover.Portal></Popover.Root></>;
}
const unsubscribe=bridge.subscribe(sync);
dispose=()=>{cancelAnimationFrame(hoverFrame);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerout',leave,true);unsubscribe();root.unmount();host.remove();document.removeEventListener('click',click,true);for(const t of ['pointerdown','mousedown','mouseup'])document.removeEventListener(t,suppress,true);};
addEventListener('pagehide',()=>dispose(),{once:true});
void refresh().then(()=>root.render(<App/>)).catch(()=>dispose());
