import { useContext,useLayoutEffect, useRef, useState } from 'react';
import {PreviewActionsContext} from './preview-reference';
import {useAuiState} from '@assistant-ui/react';
import {useComposerInputFocus} from './homer-composer-input';
import type { ConversationMessage } from '../src/web-history';
import './message-details.css';
import {useActionBarCopy} from '@assistant-ui/core/react';
import {previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText} from '../src/message-quote';
import {MessageActions} from './vendor/assistant-ui/message-actions';
import {MessageTimestamp} from './message-timestamps';
import {Sources} from './vendor/assistant-ui/sources';
import {RunActivity} from './vendor/assistant-ui/run-activity';
import {toolActivityText} from './process-presentation';
import './vendor/assistant-ui/run-activity.css';

export function MessageDetails({ message, runtime = false }: { message: import('../src/conversation-projection').DisplayMessage; runtime?: boolean }) {
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const copying = useRef(false), current=useRef(message.id);
  useLayoutEffect(()=>{current.current=message.id;copying.current=false;setBusy(false);setNotice('');},[message.id]);
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
  return <>
    {!!message.toolActivities?.length && <LegacyToolActivities key={JSON.stringify([message.threadId,message.id])} tools={message.toolActivities}/>}
    {!!message.sources?.length && <MessageSources key={JSON.stringify([message.threadId,message.id])} sources={message.sources}/>}
    {!!message.text && (runtime?<RuntimeMessageActions message={message} write={copy} busy={busy} notice={notice} onNotice={setNotice}/>:<><MessageActions className="message-actions" aria-label="消息操作" copied={notice==='已复制'} copying={busy} onCopy={()=>void copy(message.text).catch(()=>{})}><MessageTimestamp messageId={message.id}/></MessageActions>{notice&&<p className={'message-action-notice'+(notice==='已复制'?' sr-only':'')} role="status">{notice}</p>}</>)}
  </>;
}
function LegacyToolActivities({tools}:{tools:NonNullable<ConversationMessage['toolActivities']>}){
  const [open,setOpen]=useState(false);
  // These records have no reliable run lifecycle or clock. A returned tool is
  // not evidence that the main turn succeeded or that its result was accepted.
  return <RunActivity className="message-legacy-activity" status="incomplete" statusLabel={'处理过程 · '+tools.length+' 项'} open={open} onOpenChange={setOpen}
    entries={tools.map(tool=>{const text=tool.status==='blocked'?(tool.label||'工具名称未保留')+' · 已中断，待核对':toolActivityText(tool);return {id:tool.id,kind:'tool',label:text,content:<p data-tool-id={tool.id}>{text}</p>};})}/>;
}
function MessageSources({sources}:{sources:NonNullable<ConversationMessage['sources']>}){
  const [open,setOpen]=useState(false);
  // Sources' official helper also permits relative/mailto links and credentials.
  // Keep Homer's stricter reply-link boundary, without reordering or deduping.
  const safe=sources.filter(source=>{
    try{const url=new URL(source.url);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
  });
  if(!safe.length)return null;
  return <div className="message-link-sources"><Sources sources={safe} open={open} onOpenChange={setOpen} layout="list" locale="zh-CN"/>{open&&<p className="message-source-note">来自本条回复中的链接，未经独立核验。</p>}</div>;
}
function RuntimeMessageActions({message,write,busy,notice,onNotice}:{message:import('../src/conversation-projection').DisplayMessage;write:(text:string)=>Promise<void>;busy:boolean;notice:string;onNotice:(text:string)=>void}){
  const {canQuote,appendQuote}=useContext(PreviewActionsContext);
  const disabled=useAuiState(s=>s.thread.isDisabled),focusInput=useComposerInputFocus();
  const {copy,isCopied}=useActionBarCopy({copyToClipboard:()=>write(sourceMessageText(message))});
  function quote(){
    if(disabled)return;
    const parts=messageSourceParts(message),selected=parts?sourceQuote(parts):{text:previewQuoteText(message.text).slice(0,16000)},text=selected.text.trim();
    if(!text){onNotice('本条消息没有可引用的正文。');return;}
    if(!canQuote())return;
    appendQuote({messageId:message.id,text,...('itemIds' in selected&&selected.itemIds.length?{itemIds:selected.itemIds}:{})});
    onNotice(text.length>=16000||!!parts&&'itemIds' in selected&&parts.length>selected.itemIds.length?'正文较长，已引用可核验的前段。':'');
    window.getSelection()?.removeAllRanges();focusInput();
  }
  const feedback=notice||(!busy&&isCopied?'已复制':'');
  // Keep the writer synchronous in the user gesture and allow streaming copy.
  return <><MessageActions className="message-actions" aria-label="消息操作" copied={!busy&&isCopied} copying={busy} onCopy={copy} onQuote={quote} quoteDisabled={disabled}><MessageTimestamp messageId={message.id}/></MessageActions>{feedback&&<p className={'message-action-notice'+(feedback==='已复制'?' sr-only':'')} role="status">{feedback}</p>}</>;
}
