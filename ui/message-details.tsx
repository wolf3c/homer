import { createContext,useContext,useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {PreviewActionsContext} from './preview-reference';
import {useAuiState} from '@assistant-ui/react';
import {useComposerInputFocus} from './homer-composer-input';
import type { ConversationMessage } from '../src/web-history';
import './message-details.css';
import {MessageSquareReply} from 'lucide-react';
import {useActionBarCopy} from '@assistant-ui/core/react';
import {previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText} from '../src/message-quote';
import {MessageActions} from './vendor/assistant-ui/message-actions';
import {MessageTimestamp} from './message-timestamps';
import {webSourceUrl} from '../src/preview-reference';
import {Sources} from './vendor/assistant-ui/sources';
import './vendor/assistant-ui/run-activity.css';

export const TaskMessageOriginContext=createContext<{open:(id:string)=>void;pendingId?:string}|undefined>(undefined);

let titleWidths: ResizeObserver | undefined;

export function MessageBubble({side,messageId,fitTitle,children}:{
  side:'user'|'assistant';messageId:string;fitTitle?:boolean;children:ReactNode;
}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!fitTitle||typeof ResizeObserver==='undefined')return;
    const bubble=ref.current;
    const message=bubble?.closest<HTMLElement>('.message');
    if(!bubble||!message)return;
    // One observer for titled bubbles. The title stays in its existing flow position.
    titleWidths??=new ResizeObserver(entries=>{
      for(const {target,borderBoxSize} of entries){
        target.closest<HTMLElement>('.message')?.style.setProperty('--message-bubble-width',`${borderBoxSize[0].inlineSize}px`);
      }
    });
    const observer=titleWidths;
    observer.observe(bubble,{box:'border-box'});
    return ()=>{
      observer.unobserve(bubble);
      message.style.removeProperty('--message-bubble-width');
    };
  },[fitTitle]);
  return <div ref={ref} className={side+'-message-bubble'}>{children}<MessageTimestamp messageId={messageId}/></div>;
}

const desktopActions='(hover:hover) and (pointer:fine) and (not (any-pointer:coarse))';

export function MessageDetails({ message, runtime = false, children }: { message: import('../src/conversation-projection').DisplayMessage; runtime?: boolean; children?: ReactNode }) {
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const copying = useRef(false), current=useRef(message.id);
  const rowRef=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{current.current=message.id;copying.current=false;setBusy(false);setNotice('');},[message.id]);
  useLayoutEffect(()=>{
    if(typeof ResizeObserver==='undefined')return;
    const row=rowRef.current, list=row?.closest('.messages');
    if(!row||!list)return;
    const bubble=row.firstElementChild;
    const body=bubble&&[...bubble.children].filter(child=>!child.matches('time, .message-attachments:empty'));
    const markdown=body?.length===1&&body[0].matches('[data-aui-quote-selectable]')&&body[0].querySelectorAll('.markdown');
    const paragraph=markdown&&markdown.length===1&&markdown[0].children.length===1&&markdown[0].firstElementChild;
    if(!message.text||!paragraph||!paragraph.matches('p')){
      row.removeAttribute('data-single-line');
      return;
    }

    const desktop=window.matchMedia(desktopActions);
    const measure=()=>{
      row.toggleAttribute('data-single-line',desktop.matches);
      // Measure with the horizontal rail in place so it cannot force a new wrap.
      if(desktop.matches&&paragraph.getBoundingClientRect().height>parseFloat(getComputedStyle(paragraph).lineHeight)+1)
        row.removeAttribute('data-single-line');
    };
    let width=list.getBoundingClientRect().width;
    const observer=new ResizeObserver(([entry])=>{
      const next=entry.contentRect.width;
      if(next===width)return;
      width=next;
      measure();
    });
    observer.observe(list);
    desktop.addEventListener('change',measure);
    measure();
    return ()=>{observer.disconnect();desktop.removeEventListener('change',measure);};
  },[children,message.text]);
  async function copy(text:string) {
    if (copying.current) throw Error('copy_pending');
    const id=message.id;
    copying.current = true; setBusy(true); setNotice('');
    try {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') throw new Error('当前环境不支持剪贴板，请手动选择文本复制');
      await navigator.clipboard.writeText(text);
      if(current.current===id&&!runtime)setNotice('已复制');
    } catch (e) {
      if(current.current===id)setNotice('复制失败：' + (e instanceof Error ? e.message : '请重试或手动选择文本复制'));
      throw e;
    } finally {
      if(current.current===id){copying.current = false; setBusy(false);}
    }
  }
  const openOrigin=useContext(TaskMessageOriginContext);
  const sources = !!message.sources?.length && <MessageSources key={JSON.stringify([message.threadId,message.id])} sources={message.sources}/>;
  const actions = runtime
    ? (message.text||openOrigin)&&<RuntimeMessageActions message={message} write={copy} busy={busy} notice={notice} onNotice={setNotice} showTimestamp={!children}/>
    : !!message.text&&<><MessageActions className="message-actions" aria-label="消息操作" copied={notice==='已复制'} copying={busy} onCopy={()=>void copy(message.text).catch(()=>{})}><MessageTimestamp messageId={message.id}/></MessageActions>{notice&&<p className={'message-action-notice'+(notice==='已复制'?' sr-only':'')} role="status">{notice}</p>}</>;
  return children ? <><div ref={rowRef} className="message-bubble-row">{children}{actions}</div>{sources}</> : <>{sources}{actions}</>;
}
function MessageSources({sources}:{sources:NonNullable<ConversationMessage['sources']>}){
  const [open,setOpen]=useState(false);
  const visible=sources.filter(source=>webSourceUrl(source.url));
  if(!visible.length)return null;
  return <div className="message-link-sources"><Sources sources={visible} open={open} onOpenChange={setOpen} layout="list" locale="zh-CN"/>{open&&<p className="message-source-note">来自本条回复中的链接，未经独立核验。</p>}</div>;
}
function RuntimeMessageActions({message,write,busy,notice,onNotice,showTimestamp=true}:{message:import('../src/conversation-projection').DisplayMessage;write:(text:string)=>Promise<void>;busy:boolean;notice:string;onNotice:(text:string)=>void;showTimestamp?:boolean}){
  const {canQuote,appendQuote}=useContext(PreviewActionsContext);
  const openOrigin=useContext(TaskMessageOriginContext);
  const originLabel='在主对话查看';
  const disabled=useAuiState(s=>s.thread.isDisabled),focusInput=useComposerInputFocus();
  const {copy,isCopied}=useActionBarCopy({copyToClipboard:()=>write(sourceMessageText(message))});
  function quote(){
    if(disabled)return;
    const parts=messageSourceParts(message),selected=parts?sourceQuote(parts):{text:previewQuoteText(message.text)},text=selected.text.trim();
    if(!text){onNotice('本条消息没有可引用的正文。');return;}
    if(!canQuote())return;
    appendQuote({messageId:message.id,text,...('itemIds' in selected&&selected.itemIds.length?{itemIds:selected.itemIds}:{})});
    onNotice(!!parts&&'itemIds' in selected&&parts.length>selected.itemIds.length?'正文较长，已引用可核验的前段。':'');
    window.getSelection()?.removeAllRanges();focusInput();
  }
  const feedback=notice||(!busy&&isCopied?'已复制':'');
  // Keep the writer synchronous in the user gesture and allow streaming copy.
  return <><MessageActions className="message-actions" aria-label="消息操作" copied={!busy&&isCopied} copying={busy} onCopy={message.text?copy:undefined} onQuote={message.text?quote:undefined} quoteDisabled={disabled}>
    {openOrigin&&<button type="button" className="aui-message-action task-message-origin-action" aria-label={originLabel} title={originLabel}
      aria-busy={openOrigin.pendingId===message.id||undefined} onClick={()=>openOrigin.open(message.id)}><MessageSquareReply aria-hidden="true"/></button>}
    {showTimestamp&&message.text&&<MessageTimestamp messageId={message.id}/>}</MessageActions>{feedback&&<p className={'message-action-notice'+(feedback==='已复制'?' sr-only':'')} role="status">{feedback}</p>}</>;
}
