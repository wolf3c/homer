// Extracted from assistant-ui markdown-text.tsx at
// 1f41f91643fdb56e5d8dbd14db65f742740738a1 (MIT); see README.md.
"use client";

import type {CodeHeaderProps} from '@assistant-ui/react-markdown';
import {useLayoutEffect,useRef,useState} from 'react';
import {CheckIcon,CopyIcon} from 'lucide-react';
import {TooltipIconButton} from './attachment-icon-button';
import './attachment.css';
import './code-header.css';

export function CodeHeader({language,code}:CodeHeaderProps){
 const [isCopied,setIsCopied]=useState(false),[copying,setCopying]=useState(false),[error,setError]=useState('');
 const copiedTimerRef=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const scopeGenerationRef=useRef(0),pending=useRef(false);
 // A streamed block can change while the old clipboard Promise is pending.
 // Scope copied feedback to its exact source, and release timers on unmount.
 useLayoutEffect(()=>{
  setIsCopied(false);setCopying(false);setError('');pending.current=false;
  return()=>{scopeGenerationRef.current++;if(copiedTimerRef.current!==undefined){clearTimeout(copiedTimerRef.current);copiedTimerRef.current=undefined;}};
 },[code]);
 async function onCopy(){
  if(!code||isCopied||pending.current)return;
  if(typeof navigator==='undefined'||typeof navigator.clipboard?.writeText!=='function'){
   setError('当前环境不支持剪贴板，请手动选择代码。');return;
  }
  const scopeGeneration=scopeGenerationRef.current;
  pending.current=true;setCopying(true);setError('');
  try{
   // Start synchronously in the user's gesture, as in the official copy hook.
   await navigator.clipboard.writeText(code);
   if(scopeGeneration!==scopeGenerationRef.current)return;
   setIsCopied(true);
   copiedTimerRef.current=setTimeout(()=>{copiedTimerRef.current=undefined;setIsCopied(false);},3000);
  }catch{
   if(scopeGeneration===scopeGenerationRef.current)setError('复制失败，请重试或手动选择代码。');
  }finally{
   if(scopeGeneration===scopeGenerationRef.current){pending.current=false;setCopying(false);}
  }
 }
 return <div data-slot="code-header" className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
  <span className="aui-code-header-language text-muted-foreground font-medium lowercase" title={language||'纯文本'}>{language||'纯文本'}</span>
  <TooltipIconButton className="aui-code-header-copy" aria-label="复制代码" tooltip={isCopied?'已复制':'复制代码'} disabled={!code||copying} aria-busy={copying} onClick={()=>void onCopy()}>
   {!isCopied&&<CopyIcon aria-hidden="true" className="aui-code-header-copy-icon animate-in zoom-in-75 fade-in duration-150"/>}
   {isCopied&&<CheckIcon aria-hidden="true" className="aui-code-header-check-icon animate-in zoom-in-50 fade-in duration-200 ease-out"/>}
  </TooltipIconButton>
  <span className="aui-code-header-status" role="status">{copying?'正在复制代码…':isCopied?'已复制':''}</span>
  {error&&<span className="aui-code-header-notice" role="alert">{error}</span>}
 </div>;
}
