import {useEffect,useRef,useState,type ReactNode} from 'react';
import {connectionFetch} from './web-connection-client';
let active=0;
const waiting=new Set<()=>void>();
function drain(){for(const run of waiting){if(active>=2)return;waiting.delete(run);run();}}
// A shared two-request budget covers both attachment and Markdown previews.
export function LazyMedia({path,body,children,kind='image',onError,fallback}:{path:string;body?:string;kind?:'image'|'video'|'voice';onError?:()=>void;fallback?:ReactNode;children:(url:string)=>ReactNode}){
 const element=useRef<HTMLSpanElement>(null),[near,setNear]=useState(false),[url,setUrl]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{const node=element.current;if(!node)return;let visible=false,disposed=false;
  const refresh=()=>{if(disposed)return;
   const playing=Array.from(node.querySelectorAll<HTMLMediaElement>('audio,video')).some(media=>!media.paused&&!media.ended);
   setNear(visible||playing||!!node.querySelector('[aria-expanded="true"]')||node.contains(document.activeElement));
  };
  const changed=()=>queueMicrotask(refresh);
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);refresh();},{root:node.closest('.thread-viewport'),rootMargin:'400px 0px'});
  const expanded=typeof MutationObserver==='undefined'?undefined:new MutationObserver(refresh);
  expanded?.observe(node,{subtree:true,attributes:true,attributeFilter:['aria-expanded']});
  for(const event of ['play','pause','ended','focusin','focusout'])node.addEventListener(event,changed,true);
  observer.observe(node);return()=>{disposed=true;observer.disconnect();expanded?.disconnect();for(const event of ['play','pause','ended','focusin','focusout'])node.removeEventListener(event,changed,true);};
 },[path,body]);
 useEffect(()=>{if(!near)return;const controller=new AbortController();let objectUrl='';setFailed(false);
  const run=()=>{if(controller.signal.aborted)return;active++;
   const signal=controller.signal;
   const request=body?{signal,method:'POST',headers:{'Content-Type':'application/json'},body}:{signal};
   void connectionFetch(path,request).then(async response=>{if(!response.ok)throw Error('media_preview_unavailable');const blob=await response.blob();if(signal.aborted)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(()=>{if(!signal.aborted){setFailed(true);onError?.();}}).finally(()=>{active--;drain();});
  };
  waiting.add(run);drain();return()=>{waiting.delete(run);controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);setUrl('');};
 },[near,path,body,onError]);
 return <span ref={element} className={"lazy-media lazy-media-"+kind}>{url?children(url):failed?fallback??<span role="status">附件预览暂不可用</span>:<span className="media-preview-placeholder" aria-label="附件预览按需加载"/>}</span>;
}
export function LazyMarkdownImage({src,alt,body}:{src?:string;alt?:string;body?:string}){
 const [failedUrl,setFailedUrl]=useState('');
 const fallback=<span role="status">{alt?alt+' · ':''}图片不可用</span>;
 let local=!!body;try{const target=new URL(src??'',location.href);local||=target.origin===location.origin&&/^\/api\/(media|files)\//.test(target.pathname);}catch{}
 return local?<LazyMedia key={body??src} path={src!} body={body} fallback={fallback}>{url=>url===failedUrl?fallback:<img src={url} alt={alt??''} onError={()=>setFailedUrl(url)}/>}</LazyMedia>:<img src={src} alt={alt??''} loading="lazy"/>;
}
