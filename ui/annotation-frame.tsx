import {createRoot} from 'react-dom/client';
import {Agentation,saveAnnotations,getElementPath,type Annotation,type AgentationProps} from './vendor/agentation-3.1.2/index.mjs';

// This runtime stays in the opaque network-disabled document. No endpoint,
// webhook, onSubmit, model request or application storage is configured.
try{void localStorage.length;}catch{
 const values=new Map<string,string>();
 Object.defineProperty(window,'localStorage',{value:{get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(String(key),String(value));},removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear()}});
}
type Controller=Parameters<NonNullable<AgentationProps['onDraftController']>>[0];
let token='',sourceKey='',mounted=false,notes:Annotation[]=[],active:boolean|undefined,revision=0,epoch=0,controller:Controller=null;
let pending:{id:string;timer:ReturnType<typeof setTimeout>}|undefined;
const send=(type:string,fields:object={})=>{if(token)parent.postMessage({type,token,sourceKey,...fields},'*');};
function changed(candidate:Annotation[]){
 if(!token||pending)return;
 const id=crypto.randomUUID();
 const timer=setTimeout(()=>{
  if(pending?.id!==id)return;pending=undefined;
  controller?.replaceAnnotations(notes,{settled:true,error:'草稿保存尚未确认，输入已保留，请重试。'});
 },10000);
 pending={id,timer};send('homer-preview-notes',{notes:candidate,baseRevision:revision,epoch,changeId:id});
}
function activeChanged(value:boolean){active=value;send('homer-preview-active',{active});}
const bindController:NonNullable<AgentationProps['onDraftController']>=value=>{controller=value;controller?.replaceAnnotations(notes);};
function mount(){
 if(mounted)return;mounted=true;saveAnnotations(location.pathname,notes);
 {
  const fit=()=>{const root=document.querySelector('agentation-toolbar')?.shadowRoot;if(!root)return false;const style=document.createElement('style');style.textContent='@media(max-width:359px){[data-agentation-toolbar]{scale:.82;transform-origin:bottom right}}';root.appendChild(style);return true;};
  const observer=new MutationObserver(()=>{if(fit()){observer.disconnect();clearTimeout(timeout);}}),timeout=setTimeout(()=>observer.disconnect(),10000);
  observer.observe(document.body,{childList:true});addEventListener('pagehide',()=>{observer.disconnect();clearTimeout(timeout);},{once:true});
 }
 const host=document.createElement('div');host.setAttribute('data-homer-annotation','');document.body.appendChild(host);
 createRoot(host).render(<Agentation defaultActive onActiveChange={activeChanged} onDraftController={bindController} copyToClipboard={false}
  onAnnotationAdd={a=>changed([...notes,a])}
  onAnnotationUpdate={a=>changed(notes.map(n=>n.id===a.id?a:n))}
  onAnnotationDelete={a=>changed(notes.filter(n=>n.id!==a.id))}
  onAnnotationsClear={batch=>changed(notes.filter(n=>!batch.some(a=>a.id===n.id)))}/>);
}
addEventListener('message',event=>{
 if(event.source!==parent)return;
 const data=event.data;
 if(data?.type==='homer-preview-connect'&&typeof data.token==='string'){
  if(token&&token!==data.token)return;
  if(!token){token=data.token;sourceKey=data.sourceKey;notes=Array.isArray(data.notes)?data.notes:[];revision=data.revision;epoch=data.epoch;}
  send('homer-preview-connected',{url:location.href});if(active!==undefined)send('homer-preview-active',{active});mount();return;
 }
 if(!token||data?.token!==token||data.sourceKey!==sourceKey||data.type!=='homer-preview-replace'||!Array.isArray(data.notes)||!Number.isSafeInteger(data.revision)||data.revision<revision)return;
 if(data.changeId&&pending?.id!==data.changeId)return;
 const newEpoch=data.epoch!==epoch;
 if(newEpoch){controller?.cancelPending();if(pending){clearTimeout(pending.timer);pending=undefined;}}
 const settled=!!data.changeId&&!!pending;
 if(settled){clearTimeout(pending!.timer);pending=undefined;}
 revision=data.revision;epoch=data.epoch;notes=data.notes;
 controller?.replaceAnnotations(notes,{settled,error:data.error});
 if(data.focusId){
  const note=notes.find(n=>n.id===data.focusId);
  const targets=note?[...document.querySelectorAll<HTMLElement>('body *')].filter(el=>!el.closest('[data-agentation-portal],[data-homer-annotation]')&&getElementPath(el)===note.elementPath):[];
  if(targets.length===1)targets[0]!.scrollIntoView({block:'center'});
  else send('homer-preview-location-missing',{id:data.focusId});
 }
});
addEventListener('error',()=>send('homer-preview-runtime-error'));
addEventListener('pagehide',()=>{if(pending)clearTimeout(pending.timer);pending=undefined;controller?.cancelPending();controller=null;token='';},{once:true});
function ready(){parent.postMessage({type:'homer-preview-ready',url:location.href},'*');}
if(document.readyState==='loading')addEventListener('DOMContentLoaded',ready,{once:true});else ready();
