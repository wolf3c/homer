import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent} from 'react';
import {createRoot} from 'react-dom/client';
import ScreenshotDialog from './screenshot-dialog';
import {MEDIA_POLICY} from '../src/media-policy';
import type {PreviewImageAnnotation,WindowAXNode} from '../src/preview-reference';
import './homer-styles.css';
import './vendor/assistant-ui/attachment.css';
import './capture-panel.css';

type Region=[left:number,top:number,right:number,bottom:number];
type PanelImage={png:Uint8Array<ArrayBuffer>;ax?:WindowAXNode[];imageWidth:number;placement:{x:number;y:number;width:number;height:number}};
type WindowChoices={windows:{id:string;name:string}[]};
declare global{
 interface Window{
  homerCapturePanel:{
   read():Promise<PanelImage|WindowChoices>;
   present():Promise<void>;
   close():Promise<void>;
   chooseSource(id:string|null):Promise<void>;
   acceptImage(png:Uint8Array<ArrayBuffer>,region:Region|null):Promise<PanelImage>;
   finish(notes:PreviewImageAnnotation[],includeAX:boolean):Promise<void>;
  };
 }
}
const bridge=window.homerCapturePanel;
const root=createRoot(document.getElementById('homer-root')!);
const editor=import('./image-annotation').catch(()=>null);
const tooLarge='截图过大，请选择较小的区域或窗口。';
const present=()=>{void bridge.present().catch(()=>{});};
const close=()=>{void bridge.close().catch(()=>{});};

function renderImage({png,ax,imageWidth,placement}:PanelImage,ImageEditor:typeof import('./image-annotation').default){
 for(const [name,value] of Object.entries({...placement,'image-width':imageWidth}))document.documentElement.style.setProperty('--capture-'+name,value+'px');
 root.render(<ScreenshotDialog floating file={new File([png],'截图.png',{type:'image/png'})} ax={ax} imageEditor={ImageEditor}
  onImageLoad={present} onDone={(notes,excerpt)=>bridge.finish(notes,!!excerpt)} onCancel={()=>bridge.close()} focusInput={()=>{}}/>);
}

async function freezeFrame(){
 const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
 const video=document.createElement('video');
 video.muted=true;
 video.className='capture-frame-video';
 document.body.append(video);
 try{
  if(stream.getVideoTracks().length!==1||stream.getAudioTracks().length)throw Error('capture_tracks');
  video.srcObject=stream;
  const firstFrame=new Promise<void>(resolve=>video.requestVideoFrameCallback(()=>resolve()));
  await video.play();
  await firstFrame;
  const {videoWidth:width,videoHeight:height}=video;
  if(!width||!height)throw Error('capture_frame_empty');
  if(width*height>MEDIA_POLICY.maxPixels)throw Error(tooLarge);
  const frame=document.createElement('canvas');
  frame.width=width;frame.height=height;
  const context=frame.getContext('2d');
  if(!context)throw Error('capture_canvas');
  context.drawImage(video,0,0);
  return frame;
 }finally{
  for(const track of stream.getTracks())track.stop();
  video.srcObject=null;
  video.remove();
 }
}

async function annotate(frame:HTMLCanvasElement,region:Region|null){
 const component=await editor;
 if(!component)throw Error('capture_editor');
 let image=frame;
 if(region){
  const [left,top,right,bottom]=region;
  const x=Math.floor(left*frame.width),y=Math.floor(top*frame.height);
  const width=Math.ceil(right*frame.width)-x,height=Math.ceil(bottom*frame.height)-y;
  image=document.createElement('canvas');image.width=width;image.height=height;
  const context=image.getContext('2d');
  if(!context)throw Error('capture_canvas');
  context.drawImage(frame,x,y,width,height,0,0,width,height);
 }
 const png=await new Promise<Blob|null>(resolve=>image.toBlob(resolve,'image/png'));
 if(!png)throw Error('capture_png');
 if(png.size>8*1024*1024)throw Error(tooLarge);
 renderImage(await bridge.acceptImage(new Uint8Array(await png.arrayBuffer()),region),component.default);
}

function WindowSelection({windows}:WindowChoices){
 const [frame,setFrame]=useState<HTMLCanvasElement>();
 const [phase,setPhase]=useState<'ready'|'capturing'|'failed'>('ready');
 const [notice,setNotice]=useState(''),[box,setBox]=useState<Region>();
 const pixels=useRef<HTMLDivElement>(null),busy=useRef(false);
 const anchor=useRef<{id:number;x:number;y:number}|null>(null);
 const failed=phase==='failed';
 useLayoutEffect(()=>{
  if(frame)pixels.current?.append(frame);
  present();
  return ()=>frame?.remove();
 },[frame,failed]);
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};
  window.addEventListener('keydown',escape);
  return ()=>window.removeEventListener('keydown',escape);
 },[]);
 async function choose(id:string|null){
  if(busy.current||failed)return;
  busy.current=true;setPhase('capturing');setNotice('');
  try{
   await bridge.chooseSource(id);
   const image=await freezeFrame();
   if(id===null){setFrame(image);setPhase('ready');}
   else await annotate(image,null);
  }catch(error){
   setNotice(error instanceof Error&&error.message===tooLarge?tooLarge:'未能取得画面，请关闭后重试。');
   setPhase('failed');
  }finally{busy.current=false;}
 }
 function point(event:PointerEvent<HTMLElement>){
  const {x,y,width,height}=event.currentTarget.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(event.clientX-x)/width)),y:Math.max(0,Math.min(1,(event.clientY-y)/height))};
 }
 function bounds(event:PointerEvent<HTMLElement>):Region|undefined{
  const start=anchor.current;
  if(start?.id!==event.pointerId)return;
  const {x,y}=point(event);
  return [Math.min(x,start.x),Math.min(y,start.y),Math.max(x,start.x),Math.max(y,start.y)];
 }
 function clear(event:PointerEvent<HTMLElement>){
  if(anchor.current?.id!==event.pointerId)return;
  anchor.current=null;setBox(undefined);
 }
 async function select(event:PointerEvent<HTMLElement>){
  const region=bounds(event);
  clear(event);
  if(!region||!frame||busy.current)return;
  const {width,height}=event.currentTarget.getBoundingClientRect();
  if((region[2]-region[0])*width<3||(region[3]-region[1])*height<3)return;
  busy.current=true;setPhase('capturing');setNotice('');
  try{await annotate(frame,region);}
  catch(error){
   setNotice(error instanceof Error&&error.message===tooLarge?tooLarge:'未能完成截图，请重新拖选。');
   setPhase('ready');
  }finally{busy.current=false;}
 }
 if(frame)return <div className="capture-region" role="dialog" aria-label="框选截图区域" aria-modal="true">
  <div className="capture-region-surface" onPointerDown={event=>{
   if(event.button!==0||!event.isPrimary||busy.current)return;
   anchor.current={id:event.pointerId,...point(event)};
   event.currentTarget.setPointerCapture(event.pointerId);
   setBox(bounds(event));
  }} onPointerMove={event=>{if(anchor.current?.id===event.pointerId)setBox(bounds(event));}}
   onPointerUp={event=>void select(event)} onPointerCancel={clear} onLostPointerCapture={clear}>
   <div className="capture-region-pixels" ref={pixels} aria-hidden/>
   {box&&<div className="capture-region-outline" style={{left:box[0]*100+'%',top:box[1]*100+'%',
    width:(box[2]-box[0])*100+'%',height:(box[3]-box[1])*100+'%'}}/>}
  </div>
  <p className="capture-region-hint" role={notice?'alert':'status'}>{notice||(phase==='capturing'?'正在准备截图…':'拖选要截图的区域')}</p>
  <button className="capture-region-cancel" type="button" aria-keyshortcuts="Escape" onClick={close}>取消</button>
 </div>;
 return <div className="capture-choices">
  <section className="capture-choices-card" role="dialog" aria-label="选取窗口或区域" aria-modal="true">
   <h1>选取窗口或区域</h1>
   {windows.length>0?<ul aria-label="可截图的窗口">
    {windows.map(({id,name})=><li key={id}><button type="button" disabled={phase!=='ready'}
     title={name} onClick={()=>void choose(id)}>{name}</button></li>)}
   </ul>:<p>没有可选窗口。</p>}
   {notice?<p role="alert">{notice}</p>:phase==='capturing'&&<p role="status">正在截取画面…</p>}
   <div className="capture-choices-actions">
    <button type="button" aria-keyshortcuts="Escape" onClick={close}>取消</button>
    <button type="button" disabled={phase!=='ready'} onClick={()=>void choose(null)}>框选区域</button>
   </div>
  </section>
 </div>;
}

void bridge.read().then(async result=>{
 if('windows' in result){root.render(<WindowSelection {...result}/>);return;}
 const component=await editor;
 if(!component)throw Error('capture_editor');
 renderImage(result,component.default);
}).catch(()=>root.render(<p role="alert">暂时无法读取截图，请关闭后重试。</p>));
