import {useEffect,useRef,useState,type ReactNode} from 'react';
import {connectionFetch} from './web-connection-client';
let active=0;
const waiting=new Set<()=>void>();
function drain(){for(const run of waiting){if(active>=2)return;waiting.delete(run);run();}}
// A shared two-request budget covers both attachment and Markdown previews.
export function LazyMedia({path,children,kind='image',onUrlChange}:{path:string;kind?:'image'|'video'|'voice';children:(url:string)=>ReactNode;onUrlChange?:(url:string)=>void}){
 const element=useRef<HTMLSpanElement>(null),[near,setNear]=useState(false),[url,setUrl]=useState('');
 useEffect(()=>{onUrlChange?.(url);return()=>onUrlChange?.('');},[url,onUrlChange]);
 useEffect(()=>{const node=element.current;if(!node)return;
  const observer=new IntersectionObserver(entries=>setNear(entries.some(entry=>entry.isIntersecting)),{root:node.closest('.thread-viewport'),rootMargin:'400px 0px'});observer.observe(node);return()=>observer.disconnect();
 },[path]);
 useEffect(()=>{if(!near)return;const controller=new AbortController();let objectUrl='';
  const run=()=>{if(controller.signal.aborted)return;active++;
   void connectionFetch(path,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('media_preview_unavailable');const blob=await response.blob();if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(()=>{}).finally(()=>{active--;drain();});
  };
  waiting.add(run);drain();return()=>{waiting.delete(run);controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);setUrl('');};
 },[near,path]);
 return <span ref={element} className={"lazy-media lazy-media-"+kind}>{url?children(url):<span className="media-preview-placeholder" aria-label="附件预览按需加载"/>}</span>;
}
export function LazyMarkdownImage({src,alt}:{src?:string;alt?:string}){
 let safe=false;try{const target=new URL(src??'',location.href);safe=target.origin===location.origin&&/^\/api\/(media|files)\//.test(target.pathname)&&!target.search;}catch{}
 return safe?<LazyMedia path={src!}>{url=><img src={url} alt={alt??''}/>}</LazyMedia>:<span>{alt?'[图片：'+alt+']':'[图片]'}</span>;
}
