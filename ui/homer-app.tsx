import {saveBlob} from './file-download';
import {isViewportAtBottom,observeContentResize} from '@assistant-ui/store/client';
import {messageSourceParts} from '../src/message-quote';
import {remarkPreviewMath} from './preview-selection';
import {captureSourceQuoteSelection,completeSourceQuote,locateSourceQuote,type SourceQuoteSelection} from './message-source-selection';
import {Popover} from '@base-ui/react/popover';
import {AnnotationCommentForm} from './annotation-comment-form';
import {createAnnotationDraft,useAnnotationDraft,annotationValidationReferences,type AnnotationDraft} from './annotation-draft';
import {useMediaQuery} from '@mantine/hooks';
import {previewIntentTooLong} from '../src/user-intent';
import {Group,Panel,Separator} from 'react-resizable-panels';
import {MessageCirclePlus,PanelRightIcon} from 'lucide-react';
import {isDraftImageReference,parseResourceReference,parseResourceReferences,referenceKey,referencesOf,type DraftImageReference,type PreviewImageAnnotation,type ResourceReference,type WindowAXNode} from '../src/preview-reference';
import {PreviewActionsContext,ResourceReferenceBlock,AnnotationChips,type PreviewComposer,type PreviewRequest} from './preview-reference';
import {TaskStatusPopover} from './task-status';
import {MobileSettings} from './mobile-settings';
import {ExecutionUsage} from './execution-usage';
import homerLogo64 from "../assets/branding/odysseus-20261030/homer-odysseus-64.png";
import homerLogo256 from "../assets/branding/odysseus-20261030/homer-odysseus-256.png";
import {ActiveReadPage} from './active-read-page';
import {HistoryWindow} from './history-window';
import {LazyMedia,LazyMarkdownImage} from './lazy-media';
import {ImageRoot,ImagePreview,ImageZoom} from './vendor/assistant-ui/image';
import {FileRoot,FileIconDisplay,FileName,FileSize,FileDownload} from './vendor/assistant-ui/file';
import {ApprovalCard} from './vendor/assistant-ui/approval-card';
import {processActivityText,serviceActivityNotice,liveMainActivity} from './waiting-status';
import {connectionFetch as fetch,ConnectionEvents,mobileView} from "./web-connection-client";
import {FileList} from './file-list';
import {CanvasPanel, type CanvasArtifact} from "./canvas-panel";
import { createRoot } from "react-dom/client";
import { createContext,useContext,useCallback,useLayoutEffect, useEffect, useRef, useState,useMemo, type FormEvent, type ReactNode } from "react";
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive,
  ThreadPrimitive, useAui, useAuiState, useExternalStoreRuntime, type AppendMessage,
  type ThreadComposerRuntime, type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { ComposerInputFocusContext, HomerComposerInput, useComposerInputFocus } from './homer-composer-input';
import { ComposerIcon } from './composer-icons';
import {HomerAttachmentByIndex} from './homer-attachments';
import ScreenshotDialog from './screenshot-dialog';
import {ContextOrder,contextKey} from './composer-context-order';
import {HomerMessageQueue} from './homer-message-queue';
import type {LegacyQueueEditSession} from './queue-draft-recovery';
import {useQueueOperations} from './queue-operations';
import {createHomerAttachmentAdapter,attachmentAsset,type HomerAttachment,type HomerAttachmentAdapter,type DraftContext} from './homer-attachment-adapter';
import { MessageDetails } from './message-details';
import { ProcessMessageContent,ProcessObservationContext,ProcessDetailsContext,InactiveInteractionNotes } from './process-nodes';
import type { ProcessNode } from '../src/main-process';
import {projectProcessMessage,useProcessParts} from './process-message';
import {useProcessDetails} from './process-details';
import {confirmedTerminal} from './process-presentation';
import {isVisibleConversationMessage} from './chat-date';
import {MessageTimestamps,MessageDaySeparator,MessageTimestamp} from './message-timestamps';
import ReactMarkdown from 'react-markdown';
import { Highlight } from "./markdown-code";
import {CodeHeader} from './vendor/assistant-ui/code-header';
import {QuoteBlock,SelectionToolbar} from './vendor/assistant-ui/quote';
import { CONVERSATION_VIEW,type QueueReceipts,type WebState,type WebInteraction,type WebArtifact } from "../src/web-contract";
import { QuestionFlow } from './vendor/assistant-ui/question-flow';
import { ElicitationForm } from './vendor/assistant-ui/elicitation-form';
import {questionReply} from '../src/question-schema';
import type { ConversationInput, MessageQuote, AnnotatedQuote } from "../src/web-history";
import { canAcceptInput, prepareMessage, prepareInteractionResponse, draftQuotes, canSubmitMessage, restoreComposerDraft,restoreRejectedSourceDraft,singleComposerDraft,unconfirmedInputs,quoteDrafts,protocolQuotes,type QuoteDraft,type UnconfirmedInput } from "./conversation-client";
import type {AttachmentRef,MediaView} from '../src/media-store';
import {DesktopSettings,DesktopAccount,ModelFailureNotice,type CaptureShortcutBridge} from './desktop-permissions';
import {DesktopFeatureTour} from './desktop-feature-tour';
import "highlight.js/styles/github.css";
import "./homer-styles.css";
import "./desktop-feature-tour.css";

type DesktopUpdateState={status:'idle'|'checking'|'downloading'|'ready'|'error';version?:string;noticeHidden:boolean;error?:string}|null;
type CaptureScope={threadId:string;requestId:string;epoch:number};
type CaptureResult={kind:'image';png:Uint8Array<ArrayBuffer>;width:number;height:number;ax?:WindowAXNode[];
  draft?:{id:string;action:'add'|'send';annotations:PreviewImageAnnotation[]}}|{kind:'too-large'|'unavailable'};
type ScreenshotEdit={scope:CaptureScope;file:File;width:number;height:number;ax?:WindowAXNode[];attachment?:HomerAttachment;reference?:DraftImageReference;focusAnnotation?:string;upload?:HomerAttachment;cancelled?:boolean;committing?:boolean;joining?:boolean;annotations?:PreviewImageAnnotation[];error?:string};
declare global{interface Window{homerDesktopUpdate?:{
  state():Promise<DesktopUpdateState>;dismiss():Promise<DesktopUpdateState>;restart():Promise<DesktopUpdateState>;
  onChange(callback:()=>void):()=>void;
};homerDesktopCapture?:{setReady(scope:CaptureScope|null,panel?:true):Promise<boolean>;acceptDraft?(id:string):Promise<boolean>;onResult(callback:(scope:CaptureScope,result:CaptureResult)=>void):()=>void}&Partial<CaptureShortcutBridge>;}}

const empty: WebState = { threadId: "", messages: [], isRunning: false, activeMessageId: null, work: [], interactions: [], upgrade: { phase: "starting" } };
const storage = {
  read<T,>(key: string): T | undefined { try { return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? undefined; } catch { return; } },
  write(key: string, value: unknown) { try { if (value === undefined) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch {return false;} },
};
function interactionDraft(key:string){
  const draft=storage.read<string|{text?:string;answers?:Record<string,string>}>(key+':draft');
  let legacy:Record<string,string>={};
  try{const value:unknown=JSON.parse(localStorage.getItem(key+':questions')??'{}');if(value&&typeof value==='object'&&!Array.isArray(value))legacy=Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==='string'));}catch{}
  const values=typeof draft==='object'?draft?.answers:undefined;
  const answers=values&&typeof values==='object'&&!Array.isArray(values)?Object.fromEntries(Object.entries(values).filter(([,value])=>typeof value==='string')):legacy;
  return {text:typeof draft==='string'?draft:typeof draft?.text==='string'?draft.text:'',answers,legacy};
}
async function post(path: string, value: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "web_request_failed");
  return data;
}
function Markdown() {
  return <MarkdownTextPrimitive className="markdown" remarkPlugins={[remarkGfm, remarkMath,remarkPreviewMath]} rehypePlugins={[[rehypeKatex, {throwOnError:false,trust:false,strict:'ignore',maxSize:20,maxExpand:1000}]]} components={{ img:LazyMarkdownImage,CodeHeader,SyntaxHighlighter: Highlight, a: ({ children, href }) => {
    const safe = href?.startsWith("https://") || href?.startsWith("http://") || href?.startsWith("#");
    return safe ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>;
  } }} />;
}
function ResourceDownload({path,filename,mimeType}:{path:string;filename:string;mimeType:string}){
 const [error,setError]=useState('');
 async function download(){try{const response=await fetch(path);if(!response.ok)throw Error();await saveBlob(await response.blob(),filename);setError('');
 }catch{setError('下载未完成，请重新连接后重试。');}}
 return <><FileDownload data={new URL(path,location.href).href} sourceType="url" filename={filename} mimeType={mimeType} onClick={event=>{event.preventDefault();void download();}}/>{error&&<span role="status">{error}</span>}</>;
}
function MediaAttachment({asset,messageId,index}:{asset:MediaView;messageId:string;index:number}){
 const [previewUrl,setPreviewUrl]=useState(''),[loadedImageUrl,setLoadedImageUrl]=useState('');
 const labels:Record<string,string>={received:'等待下载',downloading:'准备中',retryable_failed:'等待重试',failed:'准备失败',expired:'已过期',deleted:'已清理',revoked:'已撤回'};
 const path='/api/media/'+messageId+'/'+asset.assetId+'/'+asset.revision;
 const previewPath=asset.kind==='voice'?path+'?preview=voice':path;
 const previewable=asset.state==='ready'&&(asset.kind==='image'||asset.kind==='video'||(asset.kind==='voice'&&(!!asset.previewMime||asset.mime!=='audio/silk')));
 const imagePreviewReady=previewable&&asset.kind==='image'&&!!previewUrl&&loadedImageUrl===previewUrl;
 return <figure className="message-attachment">
  {previewable&&<LazyMedia key={previewPath} path={previewPath} kind={asset.kind as 'image'|'video'|'voice'} onUrlChange={asset.kind==='image'?setPreviewUrl:undefined}>{preview=>asset.kind==='image'?<ImageRoot><ImageZoom src={preview} alt={asset.filename}><ImagePreview src={preview} alt={asset.filename} ratio="4:3" onLoad={()=>setLoadedImageUrl(preview)} onError={()=>setLoadedImageUrl('')}/></ImageZoom></ImageRoot>:asset.kind==='voice'?<audio controls preload="none" src={preview} aria-label={'语音附件 '+(index+1)}/>:<video controls preload="metadata" src={preview} aria-label={'视频附件 '+(index+1)}/>}</LazyMedia>}
  {!imagePreviewReady&&<figcaption><FileRoot className="homer-media-file"><FileIconDisplay mimeType={asset.mime??undefined}/><FileName title={asset.filename}>{asset.filename}</FileName>{asset.size>0&&<FileSize bytes={asset.size}/>}
   {asset.state==='ready'&&<ResourceDownload key={path} path={path} filename={asset.filename} mimeType={asset.mime??'application/octet-stream'}/>}</FileRoot>
   {asset.state!=='ready'&&<span role="status"> · {labels[asset.state]??'暂不可用'}{asset.error?'（'+asset.error+'）':''}</span>}</figcaption>}
 </figure>;
}
function MediaAttachments({media,messageId}:{media:MediaView[];messageId:string}){
 return <div className="message-attachments">{media.map((asset,index)=><MediaAttachment key={asset.assetId} asset={asset} index={index} messageId={messageId}/>)}</div>;
}
const ArtifactsContext=createContext<{files:WebArtifact[];selectedId?:string;open:(file:CanvasArtifact,trigger?:HTMLElement,annotation?:{key:string;id:string})=>void}>({files:[],open:()=>{}});
function ArtifactFiles({files}:{files:WebArtifact[]}){
  const {open,selectedId}=useContext(ArtifactsContext);
  return <FileList files={files} label="本条答复的成果文件" selectedId={selectedId} controlsId="canvas-panel" onOpen={(file,trigger)=>open(file,trigger)}/>;
}
type PositionClaim=()=>((write:()=>void)=>boolean);
const QuoteNavigationContext=createContext<(quote:MessageQuote)=>void>(()=>{});
function QuoteSource({quote,index,expanded=false}:{quote:MessageQuote;index:number;expanded?:boolean}){
 const locate=useContext(QuoteNavigationContext);
 return <a className="message-quote-source" href={'#message-'+encodeURIComponent(quote.messageId)} aria-label={'查看引用 '+(index+1)+' 的原消息'} onClick={event=>{
  event.preventDefault();event.stopPropagation();
  const selection=window.getSelection();if(selection&&!selection.isCollapsed&&selection.containsNode(event.currentTarget,true))return;
  locate(quote);
 }}><QuoteBlock.Root><MessageCirclePlus data-slot="quote-block-icon" className="text-muted-foreground/60 mt-0.5 size-3 shrink-0" aria-hidden/><QuoteBlock.Text className={expanded?'line-clamp-none whitespace-pre-wrap':undefined}>{quote.text}</QuoteBlock.Text></QuoteBlock.Root></a>;
}
function UserMessage() {
  const metadata = useAuiState(s => s.message.metadata.custom);
  const original=metadata.original as WebState['messages'][number]|undefined;
  const channelSource=original?.channelSource;
  const channelName=channelSource?.source==='wechat'?'微信':channelSource?.source==='telegram'?'Telegram':channelSource?.source==='dingtalk'?'钉钉':channelSource?.source;
  const hasText = useAuiState(s => s.message.content.some(part => part.type === 'text' && part.text.trim().length > 0));
  const quotes = draftQuotes(metadata as { quote?: MessageQuote; quotes?: AnnotatedQuote[] });
  return <><MessageDaySeparator messageId={String(metadata.messageId)}/><MessagePrimitive.Root id={'message-'+String(metadata.messageId)} data-conversation-message={String(metadata.messageId)} tabIndex={-1} className="message user-message" aria-label="你的消息">
    <div className="user-message-bubble">
    {channelSource&&<p className="message-source-label">{channelName+'@'+channelSource.entryLabel}</p>}
    {quotes.length > 0 && <div className="message-quotes">{quotes.map((quote, index) => <div className="message-quote" key={index}>
      <QuoteSource quote={quote} index={index} expanded={quotes.length>1||!!quote.annotation}/>
      {quote.annotation && <p className="quote-annotation"><span>批注 {index + 1}</span>{quote.annotation}</p>}
    </div>)}</div>}
    {referencesOf(metadata as {resourceReference?:ResourceReference;resourceReferences?:ResourceReference[]}).map(reference=><ResourceReferenceBlock key={referenceKey(reference)} reference={reference}/>)}
    <MediaAttachments media={(metadata.media as MediaView[])??[]} messageId={String(metadata.messageId)}/>
    {hasText&&<div data-aui-quote-selectable><MessagePrimitive.Parts components={{ Text: Markdown }} /></div>}
    {metadata.inputState==='uncertain'&&<p className="message-state">接收或结束结果待核实，未自动重跑</p>}
    </div>
    <InactiveInteractionNotes items={metadata.inactiveInteractions as WebState['inactiveInteractions']}/>
    {original&&<MessageDetails runtime message={original} />}
    {!original?.text&&<MessageTimestamp messageId={String(metadata.messageId)}/>}
  </MessagePrimitive.Root></>;
}
const ProcessMessagesContext=createContext<ReadonlyMap<string,WebState['messages'][number]>>(new Map());
function renderProcessText(text:string){return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:({alt})=><span>{alt?'[图片：'+alt+']':'[图片]'}</span>,a:({href,children})=>href&&(href.startsWith('https://')||href.startsWith('http://')||href.startsWith('#'))?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>}}>{text}</ReactMarkdown></div>;}
function AssistantMessage() {
  const status = useAuiState(s => s.message.status);
  const content = useAuiState(s => s.message.content);
  const metadata=useAuiState(s=>s.message.metadata.custom);
  const {files}=useContext(ArtifactsContext);
  // The external runtime may synthesize an empty reply after the last queued
  // user bubble. Only persisted messages own a display position.
  const original=useContext(ProcessMessagesContext).get(String(metadata.messageId));
  const parts=useProcessParts(renderProcessText);
  if(!isVisibleConversationMessage(original))return null;
  const process=original?.process;
  const internal=process?.sourceKind==='worker';
  const hasBody=parts.hasBody;
  const messageFiles=files.filter(file=>file.messageId===metadata.messageId);
  const hasBubble=hasBody||!!original?.source||messageFiles.length>0;
  const completed=!!process&&confirmedTerminal(process)&&process.status==='completed';
  const compact=internal&&completed&&!hasBody&&!messageFiles.length&&!(metadata.inactiveInteractions as unknown[]|undefined)?.length;
  let taskTitle='';
  if(hasBubble&&original?.taskSources?.length){
    const titles=new Map<string,string>();
    for(const {title,target} of original.taskSources){
      if(title&&!titles.has(target.taskId))titles.set(target.taskId,title);
    }
    taskTitle=[...titles.values()].join('、');
  }
  return <><MessageDaySeparator messageId={String(metadata.messageId)}/><MessagePrimitive.Root id={'message-'+String(metadata.messageId)} data-conversation-message={String(metadata.messageId)} data-process-completed={completed||undefined} data-message-source={process?.sourceKind==='user'&&(!original||messageSourceParts(original)!==undefined)?'model':'host'} data-aui-quote-selectable="false" tabIndex={-1} className={'message assistant-message'+(compact?' is-process-record':'')} aria-label="荷马的回复">
    {!!metadata.sourceLabel&&!internal&&<p className="message-source-label">{metadata.sourceMessageId?<a href={'#message-'+String(metadata.sourceMessageId)}>{String(metadata.sourceLabel)}</a>:String(metadata.sourceLabel)}</p>}
    <ProcessMessageContent taskSources={original?.taskSources} taskSourceUnresolved={original?.taskSourceUnresolved} node={process} activityText={metadata.activityText as string} renderText={renderProcessText} parts={parts}>
    {hasBubble&&<>
    {taskTitle&&<p className="message-task-title">{taskTitle}</p>}
    <div className="assistant-message-bubble">
    {hasBody&&<div data-aui-quote-selectable>{parts.renderAnswers(Markdown)}</div>}
    {!!original?.source&&<details><summary>查看原请求</summary>{draftQuotes(original.source).map((quote,i)=><blockquote key={i}><QuoteSource quote={quote} index={i} expanded/>{quote.annotation&&<p>{quote.annotation}</p>}</blockquote>)}{referencesOf(original.source).map(reference=><ResourceReferenceBlock key={referenceKey(reference)} reference={reference}/>)}<MediaAttachments messageId={original.source.id} media={original.source.media??[]}/><p style={{whiteSpace:'pre-wrap'}}>{original.source.text}</p></details>}
    <ArtifactFiles files={messageFiles}/>
    </div></>}
    {!!original&&!process&&status?.type === "running" && !content.some(part => part.type === "text" && part.text) && <p className="thinking" role="status">处理阶段待确认</p>}
    {status?.type === "incomplete" && <span className="message-state">{process?.status==='unknown'?"这条回复结束状态待核实，未自动重跑":status.reason === "cancelled" ? "这条回复已停止" : "这条回复未完成"}</span>}
    </ProcessMessageContent>
    <InactiveInteractionNotes items={metadata.inactiveInteractions as WebState['inactiveInteractions']}/>
    {!!original && <MessageDetails runtime message={original} />}
    {!original?.text&&<MessageTimestamp messageId={String(metadata.messageId)}/>}
  </MessagePrimitive.Root></>;
}
function HomerSelectionToolbar() {
  const {canQuote,openQuote}=useContext(PreviewActionsContext);
  return <SelectionToolbar.Root onMouseDownCapture={event=>{if((event.target as Element).closest('[data-slot="selection-toolbar-quote"]'))event.preventDefault();}} onClickCapture={event=>{
    if(!(event.target as Element).closest('[data-slot="selection-toolbar-quote"]'))return;
    event.preventDefault();event.stopPropagation();
    if(!canQuote())return;
    const snapshot=captureSourceQuoteSelection(window.getSelection());if(!snapshot)return;
    const source=document.getElementById('message-'+snapshot.quote.messageId)??undefined;
    openQuote(snapshot,source);window.getSelection()?.removeAllRanges();
  }}><SelectionToolbar.Quote><MessageCirclePlus className="size-3.5" aria-hidden/>引用</SelectionToolbar.Quote></SelectionToolbar.Root>;
}
function MainComposer({ bindPreview,annotationDraft,state, connected, stopping, onSend,onStop,editDraft,attachmentOwner,composerRuntime,bindAttachments,queueContent,onQueueBusy,answerTarget,onAnswerTarget,interactionsVerified,onAccount,settingsOpen }: {
  annotationDraft:AnnotationDraft;bindPreview:(value:PreviewComposer|null)=>void;state: WebState; connected: boolean; stopping: string | null;
  editDraft?: {text:string;id:string;source?:'welcome'};
  answerTarget?:WebInteraction;onAnswerTarget:(item:WebInteraction|undefined)=>void;interactionsVerified:boolean;
  attachmentOwner:HomerAttachmentAdapter;composerRuntime:ThreadComposerRuntime;bindAttachments:(read:()=>DraftContext)=>void;
  onSend: (input: ConversationInput,target?:UnconfirmedInput['target']) => Promise<void>;onStop:()=>void;
  queueContent?:ReactNode;onQueueBusy?:(busy:boolean)=>void;onAccount?:()=>void;settingsOpen?:boolean;
}) {
  const aui = useAui();
  const text = useAuiState(s => s.composer.text), selected = useAuiState(s => s.composer.quote);
  const resourceState=useAnnotationDraft(annotationDraft);
  const {resourceReference,resourceReferences}=resourceState;
  const preparingKeys=Object.keys(resourceState.preparingImages??{});
  const savedReferences=referencesOf(resourceState).filter(r=>!preparingKeys.includes(referenceKey(r)));
  const chipReferences=[...savedReferences,...Object.values(resourceState.preparingImages??{})];
  const {open:openReferenceArtifact}=useContext(ArtifactsContext);
  const contextOrder=useRef(new ContextOrder());
  const composerMounted=useRef(true);
  useLayoutEffect(()=>{composerMounted.current=true;return()=>{composerMounted.current=false;};},[]);
  const [pending,setPending]=useState<UnconfirmedInput[]>([]),[draftNotice,setDraftNotice]=useState('');
  const draftAttachments=useAuiState(s=>s.composer.attachments) as readonly HomerAttachment[];
  const attachments=draftAttachments.flatMap(value=>{const asset=attachmentAsset(value);return asset?[asset]:[];});
  const retryAttachments=draftAttachments.filter(value=>!attachmentAsset(value)&&value.status.type!=='running');
  const [uploading,setUploading]=useState(false),[restoring,setRestoring]=useState(true);
  const uploadingRef=useRef(false);
  const draftRequest=useRef<string>(crypto.randomUUID()),fileInput=useRef<HTMLInputElement>(null);
  const [screenshot,setScreenshotState]=useState<ScreenshotEdit|null>(null),screenshotRef=useRef<ScreenshotEdit|null>(null);
  function setScreenshot(value:ScreenshotEdit|null){screenshotRef.current=value;setScreenshotState(value);}
  const screenshotScope=()=>({threadId:state.threadId,requestId:draftRequest.current,epoch:annotationDraft.read().epoch});
  const screenshotCurrent=(scope:CaptureScope)=>composerMounted.current&&scope.threadId===state.threadId&&scope.requestId===draftRequest.current&&scope.epoch===annotationDraft.read().epoch&&!answerRef.current;
  function pickerBusy(busy:boolean){if(mobileView)window.ReactNativeWebView?.postMessage(JSON.stringify({type:'update-busy',busy,nonce:window.__homerMobileNonce}));}
  const focusInput=useComposerInputFocus();
  const [answerEditing,setAnswerEditing]=useState<{item:WebInteraction;original:{text:string;quotes:AnnotatedQuote[];requestId:string}}|null>(null);
  const answerRef=useRef(answerEditing);answerRef.current=answerEditing;
  useLayoutEffect(()=>{annotationDraft.freeze(!!answerEditing);},[annotationDraft,!!answerEditing]);
  useEffect(()=>()=>{answerRef.current=null;},[]);
  const [savedQuotes,setSavedQuotes]=useState<QuoteDraft[]>([]);
  const quotesRef=useRef(savedQuotes);quotesRef.current=savedQuotes;
  function replaceQuotes(value:readonly AnnotatedQuote[]){const next=quoteDrafts(value,()=>crypto.randomUUID());contextOrder.current.reconcile('quote',next.map(q=>contextKey('quote',q.draftId)));quotesRef.current=next;setSavedQuotes(next);}
  const quotes=answerEditing?[]:savedQuotes;
  type QuoteEditor={draftId:string;quote:MessageQuote;annotation:string;existing:boolean;range?:Range;trigger?:HTMLElement;requestId:string;ready:boolean;error:string};
  const [quoteEditor,setQuoteEditor]=useState<QuoteEditor|null>(null);
  const quoteEditorRef=useRef(quoteEditor);quoteEditorRef.current=quoteEditor;
  const quoteTextarea=useRef<HTMLTextAreaElement>(null),composerBody=useRef<HTMLDivElement>(null);
  const focusQuoteTextarea=useCallback((node:HTMLTextAreaElement|null)=>{quoteTextarea.current=node;node?.focus({preventScroll:true});},[]);
  const [rangeVisible,setRangeVisible]=useState(false);
  useLayoutEffect(()=>{
    const range=quoteEditor?.range;
    function update(){
      const element=range?.startContainer.parentElement;
      if(!range||!element?.isConnected){setRangeVisible(false);return;}
      const rect=range.getBoundingClientRect(),viewport=element.closest('.thread-viewport')?.getBoundingClientRect();
      setRangeVisible(rect.bottom>Math.max(0,viewport?.top??0)&&rect.top<Math.min(window.innerHeight,viewport?.bottom??window.innerHeight)&&rect.right>0&&rect.left<window.innerWidth);
    }
    update();window.addEventListener('scroll',update,true);window.addEventListener('resize',update);
    return()=>{window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);};
  },[quoteEditor?.range]);
  function dismissQuote(returnToInput=false){
    const trigger=quoteEditorRef.current?.trigger;quoteEditorRef.current=null;setQuoteEditor(null);
    if(!returnToInput&&trigger?.isConnected)trigger.focus({preventScroll:true});
    else focusInput();
  }
  function appendQuote(quote:MessageQuote){if(!canQuoteMessage())return;const next=[...quotesRef.current,{...quote,annotation:''}];try{checkQuotes(next);replaceQuotes(next);}catch(error){setDraftNotice((error as Error).message);}}
  function openQuote(snapshot:SourceQuoteSelection,trigger?:HTMLElement){
    if(!canQuoteMessage())return;
    const editor:QuoteEditor={draftId:crypto.randomUUID(),quote:snapshot.quote,annotation:'',existing:false,range:snapshot.range,trigger,requestId:draftRequest.current,ready:false,error:''};
    quoteEditorRef.current=editor;setQuoteEditor(editor);
    void completeSourceQuote(snapshot).then(quote=>{
      if(!composerMounted.current||quoteEditorRef.current?.draftId!==editor.draftId||draftRequest.current!==editor.requestId||answerRef.current)return;
      const next={...quoteEditorRef.current,quote,ready:true};quoteEditorRef.current=next;setQuoteEditor(next);
    }).catch(()=>{if(composerMounted.current&&quoteEditorRef.current?.draftId===editor.draftId){const next={...quoteEditorRef.current,ready:true,error:'精确位置暂不可用；将保留来源与摘录快照。'};quoteEditorRef.current=next;setQuoteEditor(next);}});
  }
  function editQuote(quote:QuoteDraft,trigger:HTMLElement){
    if(!canQuoteMessage())return;
    const editor:QuoteEditor={draftId:quote.draftId,quote,annotation:quote.annotation,existing:true,trigger,requestId:draftRequest.current,ready:true,error:''};
    quoteEditorRef.current=editor;setQuoteEditor(editor);
    void locateSourceQuote(quote).then(range=>{if(!composerMounted.current||quoteEditorRef.current?.draftId!==quote.draftId||draftRequest.current!==editor.requestId)return;
      const next={...quoteEditorRef.current,range,error:range?'':'原文暂无法准确定位；摘录与批注已保留。'};quoteEditorRef.current=next;setQuoteEditor(next);
    }).catch(()=>{});
  }
  function saveQuote(){
    const editor=quoteEditorRef.current;if(editor&&!editor.ready){setDraftNotice('正在保存引用位置，请稍后保存。');return;}if(!editor||!editor.annotation.trim()||!composerMounted.current||answerRef.current||draftRequest.current!==editor.requestId)return;
    if(editor.existing&&!quotesRef.current.some(q=>q.draftId===editor.draftId)){dismissQuote();return;}
    const value={...editor.quote,annotation:editor.annotation,draftId:editor.draftId};
    const next=editor.existing?quotesRef.current.map(q=>q.draftId===editor.draftId?value:q):[...quotesRef.current,value];
    try{checkQuotes(next);replaceQuotes(next);dismissQuote(true);setDraftNotice('');}catch(error){const next={...editor,error:(error as Error).message};quoteEditorRef.current=next;setQuoteEditor(next);}
  }
  const restored = useRef(false), submitting = useRef(false),pendingRef=useRef<UnconfirmedInput[]>([]);
  const sending=useRef(new Set<UnconfirmedInput>()),reconciled=useRef(new WeakSet<UnconfirmedInput>());
  const clearing=useRef<{requestId:string;wait:Promise<void>}|null>(null);
  const receiptReader=useRef<{controller:AbortController;again:boolean}|null>(null);
  const key = "homer-draft:" + state.threadId, pendingKey = "homer-unconfirmed:" + state.threadId;
  const editorKey='homer-queue-editor:'+state.threadId;
  function savePending(items:UnconfirmedInput[]){pendingRef.current=items;setPending(items);const saved=storage.write(pendingKey,items.length?items:undefined);if(!saved)setDraftNotice('未确认请求仅本次页面保留，请在当前页面核对或重试。');return saved;}
  useEffect(()=>{
    const sync=()=>{const data=annotationDraft.read(),pending=data.preparingImages??{};
      const refs=[...referencesOf(data).filter(r=>!pending[referenceKey(r)]),...Object.values(pending)];
      contextOrder.current.reconcile('ref',refs.flatMap(ref=>(ref.annotations??[{id:'legacy'}]).map(note=>contextKey('ref',referenceKey(ref),note.id))));};
    const unsubscribe=annotationDraft.subscribe(sync);sync();return unsubscribe;
  },[annotationDraft]);
  useEffect(() => {
    if (!state.threadId || restored.current) return;
    const legacyKey='homer-pending:'+state.threadId,legacy=storage.read<ConversationInput>(legacyKey);
    const cached=storage.read<UnconfirmedInput[]>(pendingKey)??(legacy?[{input:legacy}]:[]);
    savePending(unconfirmedInputs(cached,state.acceptedRequestIds??[]));storage.write(legacyKey,undefined);
    const draft=storage.read<{text:string;quote?:MessageQuote;quotes?:AnnotatedQuote[];resourceReference?:ResourceReference;resourceReferences?:ResourceReference[];htmlMetadata?:import('./annotation-draft').AnnotationDraftState['htmlMetadata'];imageAssets?:import('./annotation-draft').AnnotationDraftState['imageAssets'];preparingImages?:import('./annotation-draft').AnnotationDraftState['preparingImages'];requestId?:string;attachments?:MediaView[];unconfirmedUploads?:boolean;answerItem?:WebInteraction;contextOrder?:string[]}>(key);
    const editing=storage.read<LegacyQueueEditSession>(editorKey);
    const restore=restoreComposerDraft(draft??editing?.original,legacy,!!legacy&&!!state.acceptedRequestIds?.includes(legacy.requestId));
    if(restore){contextOrder.current=new ContextOrder(draft?.contextOrder);const single=singleComposerDraft(restore);annotationDraft.restore({...single,htmlMetadata:draft?.htmlMetadata,imageAssets:draft?.imageAssets,preparingImages:draft?.preparingImages});aui.composer().setText(single.text);replaceQuotes(single.quotes);aui.composer().setQuote(undefined);if(single.requestId)draftRequest.current=single.requestId;setDraftNotice(single.notice??'');void (async()=>{for(const asset of single.attachments??[])await aui.composer().addAttachment(attachmentOwner.restore(asset));setRestoring(false);})();}else{setRestoring(false);}
    if(draft?.answerItem)onAnswerTarget(draft.answerItem);
    if(draft?.unconfirmedUploads)setDraftNotice('上次未确认的附件需重新选择；已确认附件仍保留。');
    restored.current=true;
  }, [state.threadId, aui, key, pendingKey, state.acceptedRequestIds]);
  useEffect(()=>{if(restored.current){const next=unconfirmedInputs(pendingRef.current,state.acceptedRequestIds??[]);if(next.length!==pendingRef.current.length)savePending(next);}},[state.acceptedRequestIds]);
  useEffect(() => {if(!selected)return;if(answerRef.current)setDraftNotice('当前编辑不能添加新引用；原普通草稿已保留。');else appendQuote(selected as MessageQuote);aui.composer().setQuote(undefined);},[selected,aui]);
  async function recoverRejectedSource(item:UnconfirmedInput,error:string){
    const {input,draft}=item;
    const screenshotInput=referencesOf(input).some(isDraftImageReference);
    if(restoring||!draft||reconciled.current.has(item)||!pendingRef.current.includes(item)
      ||error!=='quote_source_mismatch'&&(!screenshotInput||!['preview_source_mismatch','preview_image_missing','invalid_resource_reference','invalid_attachments','media_scope_denied','media_asset_not_found','media_not_ready','media_derivative_missing'].includes(error)))return;
    reconciled.current.add(item);
    if(clearing.current?.requestId===input.requestId)await clearing.current.wait;
    if(!composerMounted.current||!pendingRef.current.includes(item))return;
    const composer=aui.composer().getState(),resources=annotationDraft.read();
    const restore=!answerRef.current&&!quoteEditorRef.current&&!screenshotRef.current&&!Object.keys(resources.preparingImages??{}).length&&
      restoreRejectedSourceDraft({text:composer.text,quotes:quotesRef.current,requestId:draftRequest.current,attachments:composer.attachments,uploading:uploadingRef.current,...resources},input,draft.clearedRequestId);
    if(!restore){setDraftNotice('原请求未获接收，已保留原请求内容及当前草稿。');return;}
    setRestoring(true);try{
      draftRequest.current=restore.requestId;contextOrder.current=new ContextOrder(draft.contextOrder);
      annotationDraft.restore({...draft.resources,...restore});aui.composer().setText(restore.text);replaceQuotes(draft.quotes);
      const restoredResources=annotationDraft.read();
      for(const [index,asset] of draft.attachments.entries()){
        const current=aui.composer().getState();
        if(!composerMounted.current||uploadingRef.current||draftRequest.current!==input.requestId||current.text!==input.text||annotationDraft.read()!==restoredResources||current.attachments.length!==index||JSON.stringify(protocolQuotes(quotesRef.current))!==JSON.stringify(protocolQuotes(restore.quotes)))break;
        await aui.composer().addAttachment(attachmentOwner.restore(asset));
      }
      setDraftNotice('引用来源未通过校验，原草稿和请求标识已保留，请重新核对引用。');
    }finally{if(composerMounted.current)setRestoring(false);}
  }
  function checkReceipts(){
    const needsReceipt=(item:UnconfirmedInput)=>!sending.current.has(item)&&!reconciled.current.has(item);
    if(!connected||!state.history||!composerMounted.current||!pendingRef.current.some(needsReceipt))return;
    if(receiptReader.current){receiptReader.current.again=true;return;}
    const reader={controller:new AbortController(),again:false};
    receiptReader.current=reader;
    const {signal}=reader.controller;
    const read=async()=>{do{
      reader.again=false;
      const snapshot=pendingRef.current.filter(needsReceipt);
      for(let offset=0;offset<snapshot.length&&!signal.aborted;offset+=80){
        const batch=snapshot.slice(offset,offset+80);
        const response=await fetch('/api/history/receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestIds:batch.map(item=>item.input.requestId)}),signal});
        if(!response.ok)return;
        const receipt=await response.json() as QueueReceipts;if(signal.aborted)return;
        if(Array.isArray(receipt.acceptedRequestIds)){
          const next=unconfirmedInputs(pendingRef.current,receipt.acceptedRequestIds);
          if(next.length!==pendingRef.current.length)savePending(next);
        }
        for(const status of receipt.statuses??[]){
          const item=batch.find(item=>item.input.requestId===status.requestId);
          if(item&&status.state==='rejected'&&typeof status.error==='string')await recoverRejectedSource(item,status.error);
        }
      }
    }while(reader.again&&!signal.aborted);};
    void read().catch(()=>{}).finally(()=>{if(receiptReader.current===reader)receiptReader.current=null;});
  }
  useEffect(()=>()=>{receiptReader.current?.controller.abort();receiptReader.current=null;},[connected,state.threadId]);
  // A transport rejection can publish fresh state without changing the history page.
  useEffect(checkReceipts,[connected,state,state.history?.page.revision,restoring,pending.map(item=>item.input.requestId).join('|')]);
  useEffect(()=>{
    for(const attachment of draftAttachments){const asset=attachmentAsset(attachment);if(asset)contextOrder.current.rename(contextKey('attachment',attachment.id),contextKey('attachment',asset.assetId));}
    for(const attachment of draftAttachments)contextOrder.current.record(contextKey('attachment',attachmentAsset(attachment)?.assetId??attachment.id));
  },[draftAttachments,restoring,uploading]);
  useEffect(()=>{if(state.threadId&&restored.current&&!restoring&&!screenshotRef.current?.committing){if(answerEditing)storage.write('homer-interaction:'+state.threadId+':'+answerEditing.item.id+':draft',text);else if(!storage.write(key,{text,quotes,resourceReference,resourceReferences,htmlMetadata:resourceState.htmlMetadata,imageAssets:resourceState.imageAssets,preparingImages:resourceState.preparingImages,requestId:draftRequest.current,attachments,contextOrder:contextOrder.current.snapshot(),unconfirmedUploads:uploading||retryAttachments.length>0}))setDraftNotice('草稿保存失败，已保存批注仅本次页面保留。');}},[state.threadId,key,text,quotes,resourceState,draftAttachments,uploading,restoring,answerEditing]);
  useEffect(()=>{
    if(!answerTarget||restoring||uploading)return;
    if(screenshotRef.current){setDraftNotice('请先完成或取消截图。');onAnswerTarget(undefined);return;}
    if(quoteEditorRef.current){setDraftNotice('请先保存或取消引用批注。');onAnswerTarget(undefined);return;}
    if(answerRef.current){if(answerRef.current.item.id!==answerTarget.id){setDraftNotice('请先退出当前答复，再回答另一问题。');onAnswerTarget(answerRef.current.item);}return;}
    const original={text:aui.composer().getState().text,quotes,resourceReference,resourceReferences,htmlMetadata:resourceState.htmlMetadata,imageAssets:resourceState.imageAssets,preparingImages:resourceState.preparingImages,requestId:draftRequest.current,contextOrder:contextOrder.current.snapshot()};
    storage.write(key,{...original,attachments,unconfirmedUploads:retryAttachments.length>0,answerItem:answerTarget});
    const draft=interactionDraft('homer-interaction:'+state.threadId+':'+answerTarget.id);
    const saved=draft.text||Object.entries(draft.answers).map(([id,value])=>{const q=answerTarget.questions?.find(q=>q.id===id);return answerTarget.questions?.length===1?value:(q?.question??'旧版答复')+'：'+value;}).join('\n\n');
    setAnswerEditing({item:answerTarget,original});aui.composer().setText(saved);aui.composer().setQuote(undefined);setDraftNotice('');focusInput();
  },[answerTarget?.id,restoring,uploading]);
  function closeAnswer(){
    const session=answerRef.current;if(!session)return;
    storage.write('homer-interaction:'+state.threadId+':'+session.item.id+':draft',aui.composer().getState().text);
    storage.write(key,{...session.original,attachments,unconfirmedUploads:retryAttachments.length>0});
    aui.composer().setText(session.original.text);replaceQuotes(session.original.quotes);aui.composer().setQuote(undefined);draftRequest.current=session.original.requestId;
    setAnswerEditing(null);onAnswerTarget(undefined);setDraftNotice('');focusInput();
  }
  const answerItem=answerEditing?state.interactions.find(item=>item.id===answerEditing.item.id):undefined;
  const answerKey=answerEditing?'homer-interaction:'+state.threadId+':'+answerEditing.item.id:undefined;
  const answerPending=answerKey?storage.read<ConversationInput>(answerKey+':pending'):undefined;
  const answerBlocked=!!answerEditing&&(!connected||!interactionsVerified||state.upgrade.phase!=='running'||!answerItem||!!answerPending);

  const blocked=restoring||!canAcceptInput(connected,state.upgrade);
  const latestSubmitDraft=useRef(submitDraft);
  latestSubmitDraft.current=submitDraft;
  const captureReady=!!window.homerDesktopCapture&&!!state.threadId&&state.conversationView===CONVERSATION_VIEW&&!!state.features?.draftUpload&&state.upgrade.phase==='running'&&!blocked&&!uploading&&!answerEditing&&!quoteEditor&&!screenshot&&!settingsOpen;
  useLayoutEffect(()=>{
    const bridge=window.homerDesktopCapture;
    if(!bridge||!captureReady)return;
    const scope=screenshotScope();let active=true;
    const unsubscribe=bridge.onResult((target,result)=>{
      if(!active||screenshotRef.current||uploadingRef.current||quoteEditorRef.current||!screenshotCurrent(target)
        ||target.requestId!==scope.requestId||target.epoch!==scope.epoch)return;
      if(result.kind!=='image'){setDraftNotice(result.kind==='too-large'?'截图超过图片限制，请选较小的窗口或区域。':'没有取得截图，请重试。');return;}
      const file=new File([result.png],'截图.png',{type:'image/png'});
      const editor:ScreenshotEdit={scope,file,width:result.width,height:result.height,ax:result.ax};
      const draft=result.draft;
      if(!draft){setScreenshot(editor);return;}
      if(!bridge.acceptDraft)return;
      const approved=draft.action==='send'?readCaptureDraft():undefined;
      screenshotRef.current=editor;
      void bridge.acceptDraft(draft.id).catch(()=>false).then(async accepted=>{
        if(screenshotRef.current!==editor)return;
        if(!accepted||!active||!screenshotCurrent(scope)){screenshotRef.current=null;return;}
        editor.joining=true;
        editor.annotations=draft.annotations;
        setScreenshot(editor);
        try{await finishScreenshot(editor,draft.annotations,result.ax,approved);}
        catch(error){
          if(screenshotRef.current!==editor)return;
          setScreenshot(screenshotCurrent(scope)?{...editor,joining:false,error:error instanceof Error?error.message:'截图未加入草稿，请重试。'}:null);
        }
      });
    });
    const notice=bridge.getShortcut&&bridge.setShortcut?'截图快捷键不可用，可在设置 → 截图批注中更换。':'截图快捷键不可用，可用系统截图后粘贴。';
    const ready=bridge.acceptDraft?bridge.setReady(scope,true):bridge.setReady(scope);
    void ready.then(registered=>{if(active)setDraftNotice(current=>registered?current===notice?'':current:current||notice);}).catch(()=>{});
    return()=>{active=false;unsubscribe();void bridge.setReady(null).catch(()=>{});};
  },[captureReady,state.threadId,draftRequest.current,resourceState.epoch]);
  bindAttachments(()=>({threadId:state.threadId,requestId:draftRequest.current,enabled:!blocked&&!answerEditing&&!!state.features?.draftUpload&&state.upgrade.phase==='running',attachments:aui.composer().getState().attachments,notice:setDraftNotice,removed:(identity,file)=>{if(identity.threadId!==state.threadId||identity.requestId!==draftRequest.current)return;annotationDraft.forgetImage(identity.asset,annotationDraft.imageKeys(file));}}));
  useEffect(()=>{onQueueBusy?.(uploading||restoring||!!answerEditing);},[uploading,restoring,!!answerEditing]);
  useEffect(()=>{if(editDraft){if(answerRef.current){setDraftNotice(editDraft.source==='welcome'?'请先退出当前答复，再选择示例。':'请先退出当前编辑，再把历史文字加入新草稿。');return;}const current=aui.composer().getState().text;aui.composer().setText(current.trim()?current+'\n\n'+editDraft.text:editDraft.text);setDraftNotice(editDraft.source==='welcome'?'示例已加入输入框，确认后发送。':'已复制原消息到草稿，编辑后将作为新消息发送；历史记录保留。');}},[editDraft?.id,aui]);
  function uploadIssue(files:File[]){
    const existingIds=new Set(aui.composer().getState().attachments.map(attachment=>attachment.id));
    const newIds=new Set(files.map(file=>attachmentOwner.uploadId(file)).filter(id=>!existingIds.has(id)));
    if(newIds.size+existingIds.size>10)return '每条消息最多10个附件。';
    if(files.some(f=>!f.size||f.size>8*1024*1024||f.name.length>120||/[\x00-\x1f/\\]/.test(f.name)))return '文件须为1字节至8MiB，名称不超过120字符。';
  }
  function checkQuotes(value:readonly AnnotatedQuote[]){
    if(value.length>20||value.some(q=>!q.text.trim()||q.text.length>16000||q.annotation.length>16000)||value.reduce((n,q)=>n+q.text.length+q.annotation.length,0)>48000)throw Error('引用最多20条；单条摘录与评论各16000字符，合计48000字符。');
    const composer=aui.composer().getState(),assets=composer.attachments.flatMap(v=>{const asset=attachmentAsset(v as HomerAttachment);return asset?[asset]:[];});
    const resources=annotationValidationReferences(annotationDraft.read());
    const originals=resources.flatMap(r=>r.kind==='image'&&!assets.some(a=>a.assetId===r.image.assetId&&a.revision===r.image.revision)?[r.image]:[]);
    if(previewIntentTooLong({text:composer.text,quotes:protocolQuotes(value),resourceReferences:resources}))throw Error('整体要求与批注合计过长，请缩短后保存。');
    const input=prepareMessage(composer.text,protocolQuotes(value),undefined,()=>draftRequest.current,[...assets,...originals],undefined,resources);
    if(new TextEncoder().encode(JSON.stringify(input)).length>96*1024)throw Error('整条消息超过96KiB，请缩短摘录或批注后保存。');
  }
  function checkCandidate(refs:ResourceReference[],additional:AttachmentRef[]=[]){
    try{if(refs.length)parseResourceReferences(refs);}catch{throw Error('整条消息最多20条批注，摘录、窗口文字和备注合计最多48000字符。');}
    const composer=aui.composer().getState(),text=composer.text;
    if(previewIntentTooLong({text,quotes:protocolQuotes(quotesRef.current),resourceReferences:refs}))throw Error('整体要求与批注合计过长，请缩短后保存。');
    const assets=composer.attachments.flatMap(value=>{const asset=attachmentAsset(value as HomerAttachment);return asset?[asset]:[];});
    // Reserve originals still being prepared; this budget snapshot is never sent.
    const originals:AttachmentRef[]=[];
    for(const image of [...additional,...refs.flatMap(r=>r.kind==='image'?[r.image]:[])])
      if(![...assets,...originals].some(a=>a.assetId===image.assetId&&a.revision===image.revision))originals.push(image);
    const input=prepareMessage(text,protocolQuotes(quotesRef.current),undefined,()=>draftRequest.current,[...assets,...originals],undefined,refs);
    if(new TextEncoder().encode(JSON.stringify(input)).length>96*1024)throw Error('整条消息超过96KiB，请缩短摘录或批注后保存。');
  }
  function openScreenshot(reference:DraftImageReference,focusAnnotation?:string){
    if(blocked||uploadingRef.current||answerRef.current||screenshotRef.current||quoteEditorRef.current)return;
    const attachment=(aui.composer().getState().attachments as readonly HomerAttachment[]).find(item=>{
      const asset=attachmentAsset(item);return asset?.assetId===reference.image.assetId&&asset.revision===reference.image.revision;
    });
    if(!attachment){setDraftNotice('找不到这张截图的草稿附件。');return;}
    setScreenshot({scope:screenshotScope(),file:attachment.file,width:reference.width,height:reference.height,ax:reference.ax,reference,attachment,focusAnnotation});
  }
  function readCaptureDraft(){
    const composer=composerRuntime.getState();
    return {text:composer.text,ids:composer.attachments.map(item=>item.id),quotes:quotesRef.current,resources:annotationDraft.read()};
  }
  async function finishScreenshot(editor:ScreenshotEdit,annotations:PreviewImageAnnotation[],ax?:WindowAXNode[],approved?:ReturnType<typeof readCaptureDraft>){
    const current=()=>screenshotRef.current===editor&&screenshotCurrent(editor.scope);
    if(!current()||blocked||uploadingRef.current)throw Error('当前草稿不可用，请核对后重试。');
    const close=()=>{if(screenshotRef.current===editor){setScreenshot(null);focusInput();}};
    const updatedReferences=(image:AttachmentRef)=>{
      const {width,height}=editor;
      const next=annotations.length||ax?parseResourceReference({kind:'image',source:{kind:'draft-image'},image,width,height,annotations,ax}):undefined;
      const key=next?referenceKey(next):editor.reference&&referenceKey(editor.reference);
      const replace=(refs:ResourceReference[])=>{
        const at=refs.findIndex(ref=>referenceKey(ref)===key);
        return at<0?(next?[...refs,next]:refs):next?refs.map((ref,index)=>index===at?next:ref):refs.filter((_,index)=>index!==at);
      };
      checkCandidate(replace(annotationValidationReferences(annotationDraft.read())),[image]);
      return replace(referencesOf(annotationDraft.read()));
    };
    if(editor.reference){
      annotationDraft.replace(updatedReferences(editor.reference.image));close();return;
    }
    if(!editor.cancelled){
      const issue=uploadIssue([editor.file]);if(issue)throw Error(issue);
      const prepared=editor.upload&&attachmentAsset(editor.upload);
      updatedReferences(prepared??{assetId:'asset-00000000-0000-4000-8000-000000000000',revision:1});
    }
    uploadingRef.current=true;setUploading(true);
    try{
      if(!editor.upload||!attachmentAsset(editor.upload)){
        // The adapter prepares the original with its normal uploadId. Do not put a running entry in the composer.
        for await(const attachment of attachmentOwner.add({file:editor.file}))editor.upload=attachment;
      }
      const staged=editor.upload,asset=staged&&attachmentAsset(staged);
      if(!staged||!asset)throw Error(editor.cancelled?'已取消加入，暂存结果待确认。请核对原上传。':'截图准备未确认，可用原上传身份重试。');
      const image={assetId:asset.assetId,revision:asset.revision};
      const attachmentIndex=()=>composerRuntime.getState().attachments.findIndex(item=>item.id===staged.id&&attachmentAsset(item)?.assetId===asset.assetId);
      if(current()&&!editor.cancelled){
        updatedReferences(image);
        editor.committing=true;
        // The confirmed file keeps the adapter's original upload identity.
        if(attachmentIndex()<0)await composerRuntime.addAttachment(editor.file);
      }
      const index=attachmentIndex();
      if(!current()||editor.cancelled){
        if(index>=0)await composerRuntime.getAttachmentByIndex(index).remove();else await attachmentOwner.remove(staged);
        close();return;
      }
      if(index<0)throw Error('截图尚未写入草稿，请重试。');
      const before=approved?readCaptureDraft():undefined;
      const refs=updatedReferences(image);
      contextOrder.current.record(contextKey('attachment',asset.assetId));
      annotationDraft.replace(refs);
      setDraftNotice('');
      if(approved&&before){
        const otherIds=before.ids.filter(id=>id!==staged.id);
        if(approved.text===before.text&&approved.quotes===before.quotes&&approved.resources===before.resources
          &&approved.ids.length===otherIds.length&&approved.ids.every((id,i)=>id===otherIds[i]))latestSubmitDraft.current(editor);
        else setDraftNotice('截图已加入草稿。草稿有新编辑，请核对后发送。');
      }
      close();
    }finally{editor.committing=false;uploadingRef.current=false;if(composerMounted.current)setUploading(false);}
  }
  async function cancelScreenshot(editor:ScreenshotEdit){
    editor.cancelled=true;
    if(uploadingRef.current)return;
    if(editor.upload?.homer.attempted){await finishScreenshot(editor,[]);return;}
    if(screenshotRef.current===editor){setScreenshot(null);focusInput();}
  }
  async function uploadFiles(files:File[]){
    if(screenshotRef.current){setDraftNotice('请先完成或取消截图。');return;}
    if(answerRef.current){setDraftNotice('当前编辑不能添加附件；原普通草稿的附件已保留。');return;}
    if(uploadingRef.current||restoring||!state.features?.draftUpload||(blocked&&!mobileView)||state.upgrade.phase!=='running'){setDraftNotice('暂时无法添加附件，请等待当前上传或连接恢复后重试。');return;}
    files=files.map(file=>file.name?file:new File([file],'screenshot-'+Date.now()+'.'+(file.type==='image/jpeg'?'jpg':'png'),{type:file.type}));
    const issue=uploadIssue(files);if(issue){setDraftNotice(issue);return;}
    const uploadRequest=draftRequest.current,uploadEpoch=annotationDraft.read().epoch;
    // A native picker can return before RTC reconnects. Keep only the local
    // draft file and reuse explicit upload retry; never send while blocked.
    uploadingRef.current=true;setUploading(true);let paused=blocked;
    if(paused)setDraftNotice('所选附件已保留，连接恢复后请点击“重试上传”。');
    try{for(const file of files){
      if(paused)attachmentOwner.defer(file);
      const uploadId=attachmentOwner.uploadId(file);contextOrder.current.record(contextKey('attachment',uploadId));
      await aui.composer().addAttachment(file);
      const confirmedAsset=attachmentOwner.asset(file);if(confirmedAsset)contextOrder.current.rename(contextKey('attachment',uploadId),contextKey('attachment',confirmedAsset.assetId));
      if(!attachmentOwner.confirmed(file))paused=true;
      else if(composerMounted.current&&draftRequest.current===uploadRequest&&annotationDraft.read().epoch===uploadEpoch){
        const asset=attachmentOwner.asset(file)!;
        for(const imageKey of annotationDraft.imageKeys(file)){
          if(annotationDraft.read().preparingImages?.[imageKey])checkCandidate(annotationValidationReferences(annotationDraft.read()).map(r=>r.kind==='image'&&referenceKey(r)===imageKey?{...r,image:{assetId:asset.assetId,revision:asset.revision}}:r));
          annotationDraft.confirmImage(imageKey,{assetId:asset.assetId,revision:asset.revision});
        }
      }
    }}catch(error){setDraftNotice('附件准备未确认，请核对后重试：'+(error instanceof Error?error.message:'web_upload_failed'));}
    finally{uploadingRef.current=false;setUploading(false);if(fileInput.current)fileInput.current.value='';}
  }
  async function discardUnconfirmed(){
    if(uploading||blocked)return;setUploading(true);
    try{for(const attachment of draftAttachments)if(!attachmentAsset(attachment))await aui.composer().attachment({id:attachment.id}).remove();setDraftNotice('未确认附件已从这条草稿中移除。');focusInput();}
    catch{/* Adapter retains exact identity and reports failure. */}
    finally{setUploading(false);}
  }
  function submit(){
    if(screenshotRef.current)return;
    if(quoteEditorRef.current){setDraftNotice('请先保存或取消引用批注，再发送。');return;}
    if(answerEditing){
      if(submitting.current||answerBlocked||!text.trim()||text.length>16000)return;
      const session=answerEditing,current=answerItem!;
      let response:{text:string;questionAnswers?:Record<string,string[]>};
      try{response=current.questions?.length===1?questionReply(current.questions,{[current.questions[0]!.id]:text},!!state.features?.nativeQuestionAnswers):{text};}catch{setDraftNotice('答复不符合当前问题，请核对后发送。');return;}
      const input=prepareInteractionResponse(response.text,current.id,undefined,()=>crypto.randomUUID(),response.questionAnswers);
      submitting.current=true;storage.write(answerKey!+':pending',input);savePending([...pendingRef.current,{input}]);
      void onSend(input).then(()=>{
        savePending(pendingRef.current.filter(item=>item.input.requestId!==input.requestId));
        if(answerRef.current===session){
          if(aui.composer().getState().text===text){closeAnswer();storage.write(answerKey!+':draft',undefined);}
          else setDraftNotice('原答复已接收，较新的文字尚未提交；可退出后继续聊天。');
        }
      }).catch(error=>{if(answerRef.current===session)setDraftNotice('答复尚未确认，输入已保留；请核对或重试原答复。');if(['interaction_answer_scope','invalid_message','interaction_response_kind'].includes(error.message))storage.write(answerKey!+':pending',undefined);}).finally(()=>{submitting.current=false;});return;
    }
    submitDraft();
  }
  function submitDraft(capture?:ScreenshotEdit){
    const composer=composerRuntime.getState(),text=composer.text;
    const draftAttachments=composer.attachments;
    const attachments=draftAttachments.flatMap(item=>{const asset=attachmentAsset(item);return asset?[asset]:[];});
    const quotes=quotesRef.current,resourceState=annotationDraft.read();
    const {resourceReference,resourceReferences}=resourceState;
    if(submitting.current||blocked||answerRef.current||quoteEditorRef.current
      ||(capture?screenshotRef.current!==capture||!screenshotCurrent(capture.scope)||settingsOpen||state.upgrade.phase!=='running'
        :screenshotRef.current||uploading||uploadingRef.current)
      ||Object.keys(resourceState.preparingImages??{}).length||draftAttachments.length!==attachments.length
      ||!canSubmitMessage(text,quotes,attachments,resourceReference,resourceReferences)){
      if(capture)setDraftNotice('截图已加入草稿。请核对后发送。');
      return;
    }
    if(quotes.length&&referencesOf(resourceState).length&&state.features?.previewReferenceCollections!==2){setDraftNotice('当前连接不支持批注与消息引用共存，请刷新后重试。');return;}
    const input=prepareMessage(text,protocolQuotes(quotes),undefined,()=>draftRequest.current,attachments,resourceReference,resourceReferences);
    if(new TextEncoder().encode(JSON.stringify(input)).length>96*1024){setDraftNotice('整条消息超过96KiB，请缩短摘录或批注后发送。');return;}
    try{checkQuotes(quotes);}catch(error){setDraftNotice((error as Error).message);return;}
    submitting.current=true;
    const clearedRequestId=crypto.randomUUID();
    const item:UnconfirmedInput={input,draft:{clearedRequestId,attachments:[...attachments],quotes:[...quotesRef.current],contextOrder:contextOrder.current.snapshot(),resources:{htmlMetadata:resourceState.htmlMetadata,imageAssets:resourceState.imageAssets}}};
    sending.current.add(item);
    const pendingSaved=savePending([...pendingRef.current.filter(entry=>entry.input.requestId!==input.requestId),item]);
    attachmentOwner.markSubmitted(draftAttachments);
    clearing.current={requestId:input.requestId,wait:aui.composer().clearAttachments()};
    aui.composer().setText('');aui.composer().setQuote(undefined);replaceQuotes([]);annotationDraft.clear();contextOrder.current=new ContextOrder();draftRequest.current=clearedRequestId;setDraftNotice(pendingSaved?'':'未确认请求仅本次页面保留，请在当前页面核对或重试。');storage.write(key,undefined);
    void onSend(input).catch(error=>recoverRejectedSource(item,error instanceof Error?error.message:''))
      .finally(()=>{sending.current.delete(item);checkReceipts();})
      .catch(()=>{});focusInput();queueMicrotask(()=>{submitting.current=false;});
  }
  function canQuoteMessage(){
    if(restoring||answerRef.current)return false;
    if(quoteEditorRef.current){setDraftNotice('请先保存或取消引用批注。');return false;}
    if(state.features?.previewReferenceCollections!==2&&annotationValidationReferences(annotationDraft.read()).length){setDraftNotice('请先移除输入草稿中的成果批注，再引用消息。');return false;}
    return true;
  }
  async function addReference(reference:PreviewRequest,file?:File,isCurrent:()=>boolean=()=>true,htmlNotes?:import('./vendor/agentation-3.1.2/index.mjs').Annotation[]){
    if(restoring||answerRef.current||!state.features?.previewReferenceCollections)throw Error('请先返回普通输入，或刷新支持批注集合的界面。');
    if(state.features?.previewReferenceCollections!==2&&quotesRef.current.length)throw Error('请先移除当前消息引用，再保存成果批注。');
    const requestId=draftRequest.current,epoch=annotationDraft.read().epoch;
    const current=()=>composerMounted.current&&isCurrent()&&requestId===draftRequest.current&&epoch===annotationDraft.read().epoch&&!answerRef.current;
    if(!current())throw Error('来源或草稿已变化，请重新保存。');
    const key=referenceKey(reference);
    function merged(next:ResourceReference|undefined,validation=false){return [...(validation?annotationValidationReferences(annotationDraft.read()):referencesOf(annotationDraft.read())).filter(r=>referenceKey(r)!==key),...(next?[next]:[])].sort((a,b)=>{
      const order=referencesOf(annotationDraft.read()).map(referenceKey);const ai=order.indexOf(referenceKey(a)),bi=order.indexOf(referenceKey(b));return (ai<0?order.length:ai)-(bi<0?order.length:bi);
    });}
    let next:ResourceReference|undefined;
    if(reference.annotations?.length===0){
      if(!current())throw Error('草稿已经变化，请重新编辑。');
      const metadata={...annotationDraft.read().htmlMetadata};delete metadata[key];annotationDraft.replace(merged(undefined),metadata);return;
    }
    if(reference.kind==='image'){
      if(!file)throw Error('图片来源已失效，请重新打开成果。');
      const previous=referencesOf(annotationDraft.read()).find(r=>referenceKey(r)===key);
      const asset=previous?.kind==='image'?previous.image:annotationDraft.read().imageAssets?.[key]??attachmentOwner.asset(file);
      // Validate the full candidate before preparing its original image. This
      // temporary identity never enters the draft, wire or attachment adapter.
      const candidate=parseResourceReference({...reference,image:asset??{assetId:'asset-00000000-0000-4000-8000-000000000000',revision:1}});
      const candidates=merged(candidate,true);
      checkCandidate(candidates);
      if(!asset){if(uploadingRef.current)throw Error('原图正在准备，请稍后重试保存。');const issue=uploadIssue([file]);if(issue)throw Error(issue);annotationDraft.prepareImage(reference);await uploadFiles([file]);
        if(!composerMounted.current||requestId!==draftRequest.current||epoch!==annotationDraft.read().epoch)throw Error('原草稿已经结束，未写回旧批注。');
        if(!annotationDraft.read().preparingImages?.[key])return;
      }
      if(!current())throw Error('草稿或批注已变化，未写回旧编辑，请重新保存。');
      const confirmed=asset??attachmentOwner.asset(file);
      if(!confirmed)throw Error('原图上传尚未确认，请重试上传后保存。');
      next={...reference,image:{assetId:confirmed.assetId,revision:confirmed.revision}};
    }else next=reference;
    next=parseResourceReference(next);
    if(!current())throw Error('草稿或来源已变化，请重新保存。');
    checkCandidate(merged(next,true));
    const refs=merged(next).map(parseResourceReference);
    const metadata={...annotationDraft.read().htmlMetadata};if(htmlNotes)metadata[key]=Object.fromEntries(htmlNotes.map(({id,isFixed,selectedText,isMultiSelect,elementBoundingBoxes})=>[id,{isFixed,selectedText,isMultiSelect,elementBoundingBoxes}]));
    annotationDraft.replace(refs,metadata);setDraftNotice('');
  }
  useLayoutEffect(()=>{bindPreview({add:addReference,canQuote:canQuoteMessage,appendQuote,openQuote});return()=>bindPreview(null);});
  const intentReference=answerEditing?undefined:resourceReference;
  const accountRequired=!mobileView&&!!window.homerDesktopAccount&&state.upgrade.phase==='management'&&state.upgrade.code==='desktop_account_required';
  const notice=blocked?(accountRequired?'请先连接账号，重启并应用后即可开始。':connected?'当前暂不接收输入，草稿会保留。':'连接恢复后继续发送，草稿会保留。'):previewIntentTooLong({text,quotes,resourceReference:intentReference,resourceReferences:answerEditing?undefined:resourceReferences})?'整体要求与批注合计过长，请缩短后再发送。':draftNotice;
  const range=quoteEditor?.range;
  const rangeBody=range?.startContainer.parentElement;
  const quoteAnchor=range&&rangeVisible&&rangeBody?.isConnected?{contextElement:rangeBody,getBoundingClientRect:()=>range.getBoundingClientRect(),getClientRects:()=>range.getClientRects()}:quoteEditor?.existing&&quoteEditor.trigger?.isConnected?quoteEditor.trigger:composerBody;
  return <div className="composer-area" ref={composerBody}>
    {screenshot&&!screenshot.joining&&<ScreenshotDialog file={screenshot.file} attachment={screenshot.attachment} annotations={screenshot.reference?.annotations??screenshot.annotations} ax={screenshot.ax} focusAnnotation={screenshot.focusAnnotation} initialError={screenshot.error}
      onDone={(notes,ax)=>finishScreenshot(screenshot,notes,ax)} onCancel={()=>cancelScreenshot(screenshot)} focusInput={focusInput}/>}
    {(connected&&window.homerDesktopAccount||state.modelFailure)&&<ModelFailureNotice key={state.threadId} failure={state.modelFailure} onAccount={onAccount} onDismiss={focusInput}/>}
    <Popover.Root open={!!quoteEditor} onOpenChange={(open,details)=>{
      if(open||!quoteEditorRef.current)return;
      const event=details.event as Event&{relatedTarget?:EventTarget|null};
      const target=event.relatedTarget??event.target;
      if((details.reason==='outside-press'||details.reason==='focus-out')&&target instanceof Node&&composerBody.current?.contains(target)){
        details.cancel();setDraftNotice('请先保存或取消引用批注，再操作输入草稿。');return;
      }
      dismissQuote();
    }}>
     <Popover.Portal><Popover.Positioner anchor={quoteAnchor} positionMethod="fixed" side="bottom" sideOffset={8} collisionPadding={8} sticky collisionAvoidance={{side:'flip',align:'shift'}} className="preview-selection-positioner">
      <Popover.Popup initialFocus={false} finalFocus={false} aria-label="引用评论" className="text-annotation-editor message-quote-editor">
       {quoteEditor&&<AnnotationCommentForm key={quoteEditor.draftId} ref={focusQuoteTextarea} title={'引用 · '+quoteEditor.quote.messageId} excerpt={quoteEditor.quote.text} value={quoteEditor.annotation} onChange={annotation=>{const next={...quoteEditor,annotation,error:''};quoteEditorRef.current=next;setQuoteEditor(next);}} onSave={saveQuote} onCancel={dismissQuote} onDelete={quoteEditor.existing?()=>{replaceQuotes(quotesRef.current.filter(q=>q.draftId!==quoteEditor.draftId));dismissQuote(true);}:undefined} busy={false} error={quoteEditor.error}/>}
      </Popover.Popup>
     </Popover.Positioner></Popover.Portal>
    </Popover.Root>
    {queueContent}
    {answerEditing&&<div className="composer-answer-target"><span>回答：{answerEditing.item.questions?.[0]?.question??answerEditing.item.question}</span><button type="button" onClick={closeAnswer}>退出答复</button></div>}
    <ComposerPrimitive.Root className={'composer'+(blocked?' is-blocked':'')} onSubmit={event=>{event.preventDefault();submit();}}
      onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=blocked||uploading||!state.features?.draftUpload||state.upgrade.phase!=='running'?'none':'copy';}}}
      onDrop={event=>{if(event.defaultPrevented)return;const files=Array.from(event.dataTransfer.files);if(files.length){event.preventDefault();void uploadFiles(files);}}}>
    {!answerEditing&&(quotes[0]||chipReferences.length>0||attachments.length>0||retryAttachments.length>0||uploading)&&<div className="composer-context">
    <div className="composer-reference-strip" role="region" aria-label="引用、批注与附件，横向滚动查看更多" tabIndex={0}>
    {(()=>{
      const items=new Map<string,ReactNode>();
      for(const reference of chipReferences)for(const note of reference.annotations??[{id:'legacy'}]){
        const key=contextKey('ref',referenceKey(reference),note.id);
        items.set(key,<AnnotationChips key={key} references={[reference]} noteId={note.id} preparingKeys={preparingKeys} onOpen={(ref,id)=>{if(isDraftImageReference(ref)){openScreenshot(ref,id);return;}const source=ref.source;if(source.kind==='attachment')openReferenceArtifact({...source,id:JSON.stringify([source.messageId,source.assetId,source.revision])},undefined,{key:referenceKey(ref),id});}} onRemove={(refKey,id)=>{annotationDraft.remove(refKey,id);focusInput();}}/>);
      }
      quotes.forEach((quote,i)=>{const key=contextKey('quote',quote.draftId);items.set(key,<div className="annotation-chip" key={key}>
        <button type="button" className="annotation-chip-open" aria-label={'编辑引用 '+(i+1)} onClick={event=>editQuote(quote,event.currentTarget)} title={quote.text+'\n'+quote.annotation}><MessageCirclePlus size={15} aria-hidden="true"/><span className="compact-context-copy"><span className="compact-context-label">{quote.annotation?.trim()||quote.text}</span><span className="compact-context-source">{quote.annotation?.trim()?'消息批注':'消息引用'}</span></span></button>
        <button type="button" className="annotation-chip-remove" aria-label={'删除引用 '+(i+1)} onClick={()=>{if(quoteEditorRef.current){setDraftNotice('请先保存或取消引用批注。');return;}replaceQuotes(quotesRef.current.filter(q=>q.draftId!==quote.draftId));focusInput();}}>×</button>
      </div>);});
      draftAttachments.forEach((attachment,index)=>{
        const asset=attachmentAsset(attachment),key=contextKey('attachment',asset?.assetId??attachment.id);
        const reference=savedReferences.filter(isDraftImageReference).find(ref=>ref.image.assetId===asset?.assetId&&ref.image.revision===asset.revision);
        items.set(key,<HomerAttachmentByIndex key={key} index={index} edit={reference?()=>openScreenshot(reference):undefined}
          annotationCount={asset=>savedReferences.filter(r=>r.kind==='image'&&r.image.assetId===asset.assetId&&r.image.revision===asset.revision).reduce((count,r)=>count+(r.annotations?.length??1),0)} blocked={blocked} busy={uploading} removing={setUploading} removed={id=>{contextOrder.current.remove(contextKey('attachment',id));focusInput();}}/>);
      });
      const ordered=contextOrder.current.snapshot().flatMap(key=>{const item=items.get(key);if(!item)return [];items.delete(key);return [item];});
      return [...ordered,...items.values()];
    })()}
    </div>
    {uploading&&<div className="composer-upload-status" role="status">正在处理附件…</div>}
    </div>}
    {!answerEditing&&retryAttachments.length>0&&<div className="composer-upload-actions"><button type="button" disabled={uploading||blocked||state.upgrade.phase!=='running'} onClick={()=>void uploadFiles(retryAttachments.map(attachment=>attachmentOwner.retryFile(attachment)))}>重试上传</button><button type="button" disabled={uploading||blocked} onClick={()=>void discardUnconfirmed()}>不添加这些附件</button></div>}
    <HomerComposerInput className="composer-input" aria-label="给荷马发消息" placeholder={answerEditing?'回答上面的问题…':accountRequired?'请先连接账号':connected ? quotes.length ? "说说你对这段原文的要求…" : state.queueDispatch?.awaitingUser ? "发送消息，说明如何继续…" : "说说你想办的事…" : "连接恢复后继续发送，草稿会保留"} autoFocus disabled={blocked} onFiles={files=>void uploadFiles(files)} onPaste={answerEditing?event=>{if(event.clipboardData?.files.length){event.preventDefault();setDraftNotice('答复时不能添加附件，原普通草稿已保留。');}}:undefined}/>
    <div className="composer-toolbar">
      {!answerEditing&&state.features?.draftUpload&&<><input ref={node=>{fileInput.current=node;if(node)node.oncancel=()=>pickerBusy(false);}} type="file" multiple hidden aria-label="选择附件" onChange={event=>{pickerBusy(false);void uploadFiles(Array.from(event.target.files??[]));}}/><button type="button" className="attach-button" aria-label="添加附件" title="添加附件" aria-busy={uploading} disabled={blocked||uploading||state.upgrade.phase!=='running'} onClick={()=>{pickerBusy(true);fileInput.current?.click();}}><ComposerIcon name="paperclip"/></button></>}
      <div className="composer-actions">
      {state.activeMessageId&&<button type="button" className="stop-button" aria-label="停止回复" title="停止回复" aria-busy={!!stopping} disabled={!!stopping||!connected} onClick={onStop}><ComposerIcon name="square"/><span>{stopping?'停止中':'停止'}</span></button>}
      <button type="submit" className="send-button" aria-label={answerEditing?'提交答复':state.isRunning?'排队发送':'发送消息'} title={answerEditing?'提交答复':state.isRunning?'排队发送':'发送消息'} disabled={!!screenshot||(answerEditing?answerBlocked||!text.trim()||text.length>16000:blocked||uploading||preparingKeys.length>0||retryAttachments.length>0||!canSubmitMessage(text,quotes,attachments,resourceReference,resourceReferences))}><ComposerIcon name="arrow"/></button>
    </div></div>
  </ComposerPrimitive.Root>
  <ExecutionUsage usage={state.usage?.execution} stale={!connected}/>
  {notice&&<p className="draft-notice" role="status">{notice}</p>}
  </div>;
}
function InteractionCard({ item, threadId, messages, acceptedRequestIds, onError,onNotLive,verified,onAnswer,onReveal,structuredAnswers=true }: { verified:boolean; item: WebInteraction; threadId: string; messages: WebState["messages"]; acceptedRequestIds:string[]; onError: (message: string) => void;onNotLive:(item:WebInteraction)=>void;onAnswer?:(item:WebInteraction)=>void;onReveal?:(card:Element)=>void;structuredAnswers?:boolean }) {
  const key = "homer-interaction:" + threadId + ":" + item.id;
  const [answers,setAnswers]=useState(()=>interactionDraft(key).answers);
  const [sending,setSending]=useState(false),[received,setReceived]=useState(false);
  const responseOwner=useRef({live:false,submitting:false,verified,acceptedRequestIds});
  useLayoutEffect(()=>{const owner={live:true,submitting:false,verified,acceptedRequestIds};responseOwner.current=owner;return()=>{owner.live=false;};},[key]);
  useLayoutEffect(()=>{responseOwner.current.verified=verified;responseOwner.current.acceptedRequestIds=acceptedRequestIds;},[verified,acceptedRequestIds]);
  const pending=storage.read<ConversationInput>(key+':pending');
  const accepted=received||!!pending&&acceptedRequestIds.includes(pending.requestId),busy=sending||accepted;
  useEffect(()=>{
    if(accepted){if(item.kind==='authorization'||item.questions&&!(item.questions.length===1&&item.questions[0]!.allowOther))storage.write(key+':draft',undefined);try{const old=interactionDraft(key).legacy;if(Object.keys(old).every(id=>item.questions?.some(q=>q.id===id)))localStorage.removeItem(key+':questions');}catch{};return;}
    if(item.questions&&item.questions.length>1&&item.questions.some(q=>q.allowOther))storage.write(key+':draft',{answers});
  },[key,answers,accepted]);
  useEffect(()=>{
    if(!pending||accepted||!verified)return;
    const controller=new AbortController();
    void fetch('/api/history/receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestIds:[pending.requestId],threadId}),signal:controller.signal}).then(async response=>{
      if(!response.ok)return;const receipt=await response.json();if(!controller.signal.aborted&&receipt.acceptedRequestIds?.includes(pending.requestId))setReceived(true);
    }).catch(()=>{});return()=>controller.abort();
  },[pending?.requestId,accepted,verified,threadId,acceptedRequestIds]);
  async function respond(event?:FormEvent,decision="",questionAnswers?:ConversationInput['questionAnswers'],retry=false):Promise<void>{
    event?.preventDefault();const owner=responseOwner.current;
    if(!decision.trim()||accepted||!owner.verified||!owner.live||owner.submitting)throw Error('当前问题暂不可提交，请核对连接和原请求。');
    const previous=storage.read<ConversationInput>(key+':pending');
    const input=retry&&previous?previous:prepareInteractionResponse(decision,item.id,previous,()=>crypto.randomUUID(),questionAnswers);
    if(item.kind==='question'&&previous&&previous.requestId!==input.requestId)throw Error('上次答复尚未确认，请先核对或重试原答复。');
    owner.submitting=true;storage.write(key+':pending',input);setSending(true);onError('');
    try{await post('/api/interactions/'+item.id,{requestId:input.requestId,text:input.text,...(input.questionAnswers?{questionAnswers:input.questionAnswers}:{})});if(owner.live){setReceived(true);setSending(false);}}
    catch(error){
      if(owner.acceptedRequestIds.includes(input.requestId)){if(owner.live){setReceived(true);setSending(false);}return;}
      if(owner.live){owner.submitting=false;setSending(false);
        const code=error instanceof Error?error.message:'web_request_failed';
        if(code==='interaction_not_live'&&owner.verified)onNotLive(item);
        if(['interaction_answer_scope','invalid_message','interaction_response_kind'].includes(code))storage.write(key+':pending',undefined);
        if(owner.verified&&code!=='interaction_not_live')onError('答复尚未确认，输入已保留；可核对并重试原答复：'+code);
      }
      throw Error('答复尚未确认，输入已保留。请核对或重试原答复。');
    }
  }
  const source=item.sourceRequestId?messages.find(message=>message.role==='user'&&message.requestId===item.sourceRequestId):undefined;
  if(item.kind==='authorization'){
    const approval:NonNullable<WebInteraction['approval']>=item.approval??{title:'需要你确认',scope:item.reason??'',details:item.question};
    const sourceId=source?.id??item.sourceMessageId;
    return <><ApprovalCard
      id={'task-interaction-'+item.id} tabIndex={-1} state="request" title={approval.title}
      subtitle={approval.context&&<span className="approval-copy">{approval.context}</span>}
      description={<>
        {approval.explanation&&<span className="approval-copy"><strong>申请说明</strong> {approval.explanation}</span>}
        {approval.scope&&<span className="approval-copy"><strong>授权范围</strong> {approval.scope}</span>}
      </>}
      reviewDetails={<div className="approval-review">
        {approval.details&&<details onToggle={event=>{
          const card=event.currentTarget.closest('[data-slot="approval-card"]');
          if(event.currentTarget.open&&card)onReveal?.(card);
        }}>
          <summary>{approval.detailLabel??'查看操作详情'}</summary>
          <pre className="approval-review-text" tabIndex={0} aria-label="完整操作详情">{approval.details}</pre>
        </details>}
        {sourceId&&<a href={'#message-'+sourceId}>查看原请求</a>}
      </div>}
      disabled={busy||!verified} aria-busy={busy}
      statusLabel={!verified?'正在核对当前请求，暂不能提交。':accepted?'决定已送达，等待处理；尚未确认执行结果。':sending?'决定已提交，等待确认。':pending?'上次决定尚未确认；重试相同决定会沿用原请求标识。':undefined}
      allowOnceLabel="允许本次操作" denyLabel="拒绝本次操作"
      onAllowOnce={approval.canApprove===false?undefined:()=>{void respond(undefined,'允许本次操作').catch(()=>{});}}
      onDeny={()=>{void respond(undefined,'拒绝本次操作').catch(()=>{});}}/>
      {item.canCancel&&<button type="button" disabled={busy||!verified} onClick={()=>{void respond(undefined,'取消本次请求').catch(()=>{});}}>取消本次请求</button>}</>;
  }
  const sourceLabel=<>工作：{item.workTitle??'来源未关联'}{source?<><br/><a href={'#message-'+source.id}>原请求：{source.text.slice(0,80)||'附件请求'}</a></>:item.sourceMessageId?<><br/><a href={'#message-'+item.sourceMessageId}>原请求尚未加载 · 查看原文</a></>:<> · 原请求未关联</>}</>;
  const questions=item.questions,closed=!!questions?.length&&questions.every(q=>q.options.length&&!q.allowOther);
  const free=!questions?.length||questions.length===1&&questions[0]!.allowOther;
  let receiptAnswers=accepted?pending?.questionAnswers:undefined;
  if(accepted&&closed&&pending&&!receiptAnswers)try{
    // Older services accept exact native JSON in text. Decode only that schema,
    // never the old prose summary or an unrelated conversation message.
    const value=JSON.parse(pending.text);
    if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===questions!.length&&questions!.every(q=>Array.isArray(value[q.id])&&value[q.id].length&&value[q.id].every((label:unknown)=>q.options.some(o=>o.label===label))))receiptAnswers=value;
  }catch{}
  const complete=(values:Record<string,string>)=>{let input;try{input=questionReply(questions!,values,structuredAnswers);}catch{throw Error('请完整填写当前问题，答复合计不能超过 16000 字符。');}return respond(undefined,input.text,input.questionAnswers);};
  const legacy=interactionDraft(key).legacy,unmapped=Object.entries(legacy).filter(([id])=>!questions?.some(q=>q.id===id));
  return <section className="interaction-question" id={'task-interaction-'+item.id} tabIndex={-1} aria-busy={sending}>
    <p className="secondary">{sourceLabel}</p>
    {free&&<p>{questions?.[0]?.question??item.question}</p>}
    {free&&!!questions?.[0]?.options.length&&<ul>{questions[0].options.map(option=><li key={option.label}>{option.label}{option.description?'：'+option.description:''}</li>)}</ul>}
    {item.reason&&<p className="secondary">{item.reason}</p>}
    {unmapped.length>0&&<details><summary>旧版未提交内容已保留</summary>{unmapped.map(([id,value])=><p key={id}>{value}</p>)}</details>}
    {free?<>{accepted?<p role="status">答复已接收，待荷马处理。</p>:<button type="button" disabled={!verified||sending} onClick={()=>onAnswer?.(item)}>回答此问题</button>}</>:<fieldset className="interaction-controls" disabled={closed&&!verified||sending||!!pending&&!accepted}>
      {closed?<QuestionFlow steps={questions!.map(q=>({id:q.id,question:q.question,options:q.options.map(o=>({...o,id:o.label}))}))}
        defaultValue={Object.fromEntries(Object.entries(answers).map(([id,value])=>[id,[value]]))}
        choice={receiptAnswers}
        onComplete={accepted?undefined:values=>complete(Object.fromEntries(Object.entries(values).map(([id,list])=>[id,list[0]??''])))}/>
      :<ElicitationForm server="荷马" message={'请补充本轮所需的信息。'+questions!.flatMap(q=>q.options.filter(o=>o.description||q.allowOther).map(o=>'\n'+q.question+'：'+o.label+(o.description?'，'+o.description:''))).join('')}
        fields={questions!.map(q=>({name:q.id,label:q.question,value:answers[q.id]??'',kind:q.allowOther?'text':'choice',options:q.options.map(o=>o.label),required:true}))}
        state={accepted?'accepted':'request'} submitDisabled={!verified} onFieldChange={(id,value)=>setAnswers(old=>({...old,[id]:value}))}
        onAccept={()=>{void complete(answers).catch(error=>onError(error.message));}}/>}
    </fieldset>}
    {!verified&&<p role="status">正在核对原问题，暂不能提交。</p>}
    {sending&&<p role="status">正在提交答复，等待确认。</p>}
    {!free&&accepted&&<p role="status">本轮输入已接收，荷马继续处理。</p>}
    {pending&&!accepted&&!sending&&<p role="status">上次答复尚未确认。<button type="button" disabled={!verified} onClick={()=>{void respond(undefined,pending.text,pending.questionAnswers,true).catch(()=>{});}}>核对并重试原答复</button></p>}
  </section>;
}
function readerContentSignature(message:WebState['messages'][number]){
  if(message.id.startsWith('input-outcome:')||message.process?.sourceKind==='worker'||!isVisibleConversationMessage(message))return '';
  let hash=2166136261,length=0;const add=(text:string)=>{length+=text.length;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);hash=Math.imul(hash^0,16777619);};
  const parts=message.role==='assistant'?messageSourceParts(message):undefined;
  if(parts)for(const part of parts){if(part.text.trim()){add(part.id);add(part.text);}}else if(message.role==='user'||!message.process||message.process.final?.id===message.id)add(message.text);
  for(const asset of message.media??[])add(asset.assetId+':'+asset.revision);
  return length?length+':'+(hash>>>0):'';
}
function HomerApp() {
  const overlay=(navigator as Navigator&{windowControlsOverlay?:EventTarget&{visible:boolean}}).windowControlsOverlay;
  const [nativeTitlebar,setNativeTitlebar]=useState(()=>overlay?.visible===true);
  useEffect(()=>{
    if(!overlay||nativeTitlebar)return;
    // Detect a late first geometry, then latch capability through fullscreen.
    const detect=()=>{if(overlay.visible){overlay.removeEventListener('geometrychange',detect);setNativeTitlebar(true);}};
    overlay.addEventListener('geometrychange',detect);detect();
    return()=>overlay.removeEventListener('geometrychange',detect);
  },[overlay,nativeTitlebar]);
  const attachmentContext=useRef<()=>DraftContext>(()=>({threadId:'',requestId:'',enabled:false,attachments:[],notice:()=>{}}));
  const attachmentOwner=useMemo(()=>createHomerAttachmentAdapter(()=>attachmentContext.current()),[]);
  const [editDraft,setEditDraft]=useState<{text:string;id:string;source?:'welcome'}>();
  const [answerTarget,setAnswerTarget]=useState<WebInteraction&{historyThreadId:string}>();
  const [composerBusy,setComposerBusy]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const accountSettings=useRef<{openAccount:()=>void}>(null);
  const [canvasOpen,setCanvasOpen]=useState(false);
  const [statusContainer,setStatusContainer]=useState<HTMLDivElement|null>(null);
  const canvasTrigger=useRef<HTMLElement|null>(null);
  const previewComposer=useRef<PreviewComposer|null>(null);
  const narrowPreview=useMediaQuery('(max-width:800px)',matchMedia('(max-width:800px)').matches,{getInitialValueInEffect:false});
  const [state, setState] = useState<WebState>(empty);
  const [previewTabs,setPreviewTabs]=useState<{threadId:string;tabs:Array<CanvasArtifact&{trigger?:HTMLElement}>;activeId:string|null}>({threadId:state.threadId,tabs:[],activeId:null});
  if(previewTabs.threadId!==state.threadId){
    setPreviewTabs({threadId:state.threadId,tabs:[],activeId:null});setCanvasOpen(false);canvasTrigger.current=null;
  }
  const canvasArtifact=previewTabs.threadId===state.threadId?previewTabs.tabs.find(tab=>tab.id===previewTabs.activeId)??null:null;
  const annotationDraft=useMemo(()=>createAnnotationDraft(),[state.threadId]);
  const [annotationFocus,setAnnotationFocus]=useState<{key:string;id:string;nonce:string}>();
  const focusEditor=useMemo<{current:(()=>void)|null}>(()=>({current:null}),[state.threadId]);
  const previewScope=useRef({key:'',generation:0});
  function updatePreviewScope(open:boolean,id:string|null){
    const key=JSON.stringify([state.threadId,open,id]);
    if(previewScope.current.key!==key)previewScope.current={key,generation:previewScope.current.generation+1};
  }
  updatePreviewScope(canvasOpen,canvasArtifact?.id??null);
  const previewGeneration=previewScope.current.generation;
  const isCurrentPreview=()=>previewGeneration===previewScope.current.generation;
  const addPreviewReference=useCallback(async(reference:PreviewRequest,file?:File,isCurrent:()=>boolean=()=>true,htmlNotes?:import('./vendor/agentation-3.1.2/index.mjs').Annotation[])=>{
    if(!previewComposer.current)throw Error('输入框尚未就绪，请重试。');
    const generation=previewScope.current.generation;
    const current=()=>generation===previewScope.current.generation&&isCurrent();
    await previewComposer.current.add(reference,file,current,htmlNotes);
  },[]);
  const activePages=useRef({queue:new ActiveReadPage<NonNullable<WebState['queue']>[number]>(),interactions:new ActiveReadPage<WebInteraction>()});
  const activeReads=useRef<{disposed:boolean;timers:Set<ReturnType<typeof setTimeout>>;controllers:Set<AbortController>}>({disposed:false,timers:new Set(),controllers:new Set()});
  useEffect(()=>()=>{activeReads.current.disposed=true;for(const timer of activeReads.current.timers)clearTimeout(timer);for(const controller of activeReads.current.controllers)controller.abort();},[]);
  const history=useRef(new HistoryWindow()),viewport=useRef<HTMLDivElement>(null),userScroll=useRef(0);
  const [pageBusy,setPageBusy]=useState(false),[pageNotice,setPageNotice]=useState('');
  const pageRead=useRef(0);
  const anchor=useRef<{id:string;top:number;version:number;next?:{id:string;top:number}}|null>(null);
  const [isAtBottom,setIsAtBottom]=useState(false),[hasNewContent,setHasNewContent]=useState(false);
  const reader=useRef<{gesture:boolean;top:number;height:number;viewHeight:number;frame?:number;initializedThread?:string;connected:boolean;
    pending?:{kind:'latest'|'initialize'|'around';scope:string;navigation:number;user:number;recent?:HistoryWindow['recent'];id?:string;quote?:MessageQuote};
    summary:Map<string,{source:object;signature:string}>;
  }>({gesture:false,top:0,height:0,viewHeight:0,connected:false,summary:new Map()});
  const navigation=useRef(0);
  const positionScope=()=>JSON.stringify([history.current.thread,history.current.epoch]);
  const visibleIds=()=>new Set(Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-conversation-message]')??[]).filter(element=>{const box=element.getBoundingClientRect(),view=viewport.current!.getBoundingClientRect();return box.bottom>view.top&&box.top<view.bottom;}).map(element=>element.dataset.conversationMessage!));
  function readingPins(){
    const pins=visibleIds(),saved=anchor.current;if(saved){pins.add(saved.id);if(saved.next)pins.add(saved.next.id);}
    const selected=window.getSelection();for(const node of [selected?.anchorNode,selected?.focusNode,document.activeElement]){const e=node instanceof Element?node:node?.parentElement;const message=e?.closest<HTMLElement>('[data-conversation-message]');if(message)pins.add(message.dataset.conversationMessage!);}return pins;
  }
  function measureReader(){const view=viewport.current;if(!view||view.clientHeight<=0)return;
    Object.assign(reader.current,{top:view.scrollTop,height:view.scrollHeight,viewHeight:view.clientHeight});
    const atBottom=isViewportAtBottom(view);setIsAtBottom(atBottom);
    // A snapshot may precede the external runtime's body commit. Do not
    // clear its cue against the previous body, even if that body fits.
    const actual=runtime.thread.getState().messages,expected=history.current.messages;
    const committed=expected.length===actual.length&&expected.every((message,i)=>{const projected=messageCache.current.get(message.id)?.value;return projected&&actual[i]?.id===message.id&&actual[i].metadata.custom===projected.metadata?.custom;});
    // This is a local visual cue, not a read receipt or permission to follow.
    if(atBottom&&!history.current.archived&&committed)setHasNewContent(false);
  }
  function captureAnchor(){const view=viewport.current;if(!view||view.clientHeight<=0)return;
    const box=view.getBoundingClientRect(),positions:{id:string;top:number}[]=[];
    for(const element of view.querySelectorAll<HTMLElement>('[data-conversation-message]')){
      const row=element.getBoundingClientRect();
      if(row.bottom<=row.top||row.bottom<=box.top||row.top>=box.bottom)continue;
      positions.push({id:element.dataset.conversationMessage!,top:row.top-box.top});
      if(positions.length===2)break;
    }
    const [first,next]=positions;
    anchor.current=first?{...first,next,version:userScroll.current}:null;measureReader();
  }
  function invalidatePosition(){navigation.current++;reader.current.pending=undefined;if(reader.current.frame!==undefined)cancelAnimationFrame(reader.current.frame);reader.current.frame=undefined;}
  // Stable metadata callback: all asynchronous quote/page/latest writes share this owner.
  const claimPosition=useCallback(()=>{
    invalidatePosition();captureAnchor();const scope=positionScope(),nav=navigation.current,user=userScroll.current;
    return (write:()=>void)=>{if(scope!==positionScope()||nav!==navigation.current||user!==userScroll.current)return false;write();captureAnchor();return true;};
  },[]);
  function noteReaderGesture(event:{type?:string;key?:string;target?:EventTarget|null;currentTarget?:EventTarget|null}){
    invalidatePosition();userScroll.current++;captureAnchor();
    const input=(event.target as Element|null)?.closest?.('input,textarea,[contenteditable="true"],[role="textbox"]');
    reader.current.gesture=event.type==='wheel'||event.type==='touchmove'||event.type==='pointerdown'&&event.target===event.currentTarget||event.type==='keydown'&&!input&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key??'');
  }
  function noteOutsideReaderGesture(event:{target:EventTarget|null;type:string;key?:string}){if(!viewport.current?.contains(event.target as Node))noteReaderGesture(event);}
  function recordReaderScroll(){
    const view=viewport.current;if(!view||view.clientHeight<=0)return;const previous=reader.current;
    if(Math.abs(view.scrollTop-previous.top)>=1&&previous.gesture&&previous.frame===undefined&&view.scrollHeight===previous.height&&view.clientHeight===previous.viewHeight){captureAnchor();}
    measureReader();
  }
  function restoreAnchor(){
    const view=viewport.current;if(!view||view.clientHeight<=0)return;const saved=anchor.current;
    if(saved&&saved.version===userScroll.current){
      const readRow=(id:string)=>{const element=document.getElementById('message-'+id);return element&&view.contains(element)?element.getBoundingClientRect():null;};
      let row=readRow(saved.id),top=saved.top;
      if(row&&row.bottom===row.top&&saved.next){
        const next=readRow(saved.next.id);
        if(next&&next.bottom>next.top){row=next;top=saved.next.top;anchor.current={...saved.next,version:saved.version};}
      }
      if(row&&row.bottom>row.top){const delta=row.top-view.getBoundingClientRect().top-top;if(Math.abs(delta)>=1)view.scrollTop+=delta;}
      else{view.scrollTop=reader.current.top;anchor.current=null;captureAnchor();if(!row)setPageNotice('原阅读位置已变化，可查看最新消息');}
    }else if(!saved){view.scrollTop=reader.current.top;captureAnchor();}
    measureReader();
  }
  useLayoutEffect(()=>{
    const view=viewport.current;if(!view)return;
    const restore=()=>{restoreAnchor();
      // The library's prepend observer may run after ours. Recheck once, using
      // the same saved message offset, after both observers have measured.
      if(reader.current.frame!==undefined)return;
      const scope=positionScope(),nav=navigation.current,user=userScroll.current;
      reader.current.frame=requestAnimationFrame(()=>{reader.current.frame=undefined;if(scope===positionScope()&&nav===navigation.current&&user===userScroll.current)restoreAnchor();});
    };
    // Reuse the viewport's content observer, including same-height DOM commits.
    const disconnect=observeContentResize(view,restore);
    return()=>{disconnect();invalidatePosition();};
  },[]);
  function publishHistory(){const cache=history.current;setState(old=>({...old,messages:cache.messages,artifacts:cache.artifacts,inactiveInteractions:cache.inactiveInteractions}));}
  function prepareLatest(){const pending=reader.current.pending;
    if(!pending||pending.kind==='around'||!reader.current.connected||!history.current.recent)return;
    pending.recent=history.current.recent;history.current.latest();publishHistory();
  }
  function observeContent(next:WebState,baseline:boolean){
    const previous=reader.current.summary,summary=new Map<string,{source:object;signature:string}>();let changed=false;
    for(const message of history.current.recent?.messages??[]){
      const old=previous.get(message.id),signature=old?.source===message?old.signature:readerContentSignature(message);
      summary.set(message.id,{source:message,signature});if(signature&&old?.signature!==signature)changed=true;
    }
    for(const file of next.artifacts??[]){const key='artifact:'+file.id,signature=file.sha256;summary.set(key,{source:file,signature});if(!previous.has(key)||previous.get(key)!.signature!==signature)changed=true;}
    reader.current.summary=summary;if(baseline)setHasNewContent(false);else if(changed)setHasNewContent(true);
  }
  const loadProcess=useCallback(async(id:string,signal:AbortSignal)=>{
    const epoch=history.current.epoch,response=await fetch('/api/history/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readEpoch:epoch,id}),signal});const value=await response.json();if(!response.ok)throw Error(value.error??'history_process_unavailable');if(epoch!==history.current.epoch)throw Error('history_epoch_changed');return value as ProcessNode;
  },[state.history?.readEpoch]);
  async function loadPage(direction:'before'|'after'|'around',id?:string,quote?:MessageQuote,positionCommit?:ReturnType<PositionClaim>){
    if(pageBusy&&direction!=='around')return;const cache=history.current,epoch=cache.epoch,position=direction==='around'?id:direction==='before'?cache.before:cache.after;if(!position)return;
    const commit=positionCommit??claimPosition(),viewNavigation=navigation.current,read=++pageRead.current;setPageBusy(true);setPageNotice('');
    try{
      const page=await post('/api/history/page',{readEpoch:epoch,request:{[direction]:position}});
      if(viewNavigation!==navigation.current)return;
      const pins=readingPins();
      if(direction==='around'&&!page.messages.some((message:WebState['messages'][number])=>message.id===id))throw Error('history_message_not_found');
      if(!cache.add(page,epoch,direction,pins)){setPageNotice('读取期间记录已更新，请重新加载这一页。');return;}
      commit(()=>{if(direction==='around')reader.current.pending={kind:'around',scope:positionScope(),navigation:navigation.current,user:userScroll.current,id,quote};publishHistory();});
    }catch(e){if(viewNavigation!==navigation.current)return;const code=e instanceof Error?e.message:'';setPageNotice(code==='history_cache_pinned'?'当前选择或焦点需要保留，请取消选择后继续加载。':code==='history_message_not_found'?'原消息不存在于当前对话，成果原答复可从授权入口只读打开。':code==='history_epoch_changed'||code==='history_cursor_expired'?'读取位置已过期，草稿已保留，请回到最新后重试。':'这一页未能读取，已有消息和草稿已保留。');}
    finally{if(read===pageRead.current)setPageBusy(false);}
  }
  function returnLatest(){claimPosition();reader.current.pending={kind:'latest',scope:positionScope(),navigation:navigation.current,user:userScroll.current};
    if(!reader.current.connected)setPageNotice('正在等待有效的最新消息；当前阅读位置已保留。');else setPageNotice('');prepareLatest();}

  async function readActivePage(kind:'queue'|'interactions',after?:number){
    const selected=activePages.current[kind],token=selected.begin(after);if(!token||activeReads.current.disposed)return;
    const controller=new AbortController();activeReads.current.controllers.add(controller);
    setState(old=>({...old}));let retry=false;
    try{const response=await fetch('/api/history/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({after:token.after,readEpoch:token.readEpoch}),signal:controller.signal});
      const page=await response.json();if(controller.signal.aborted||activeReads.current.disposed)return;if(!response.ok)throw Error(page.error??'history_read_failed');
      if(!selected.complete(token,page)){retry=true;return;}
      setState(old=>!old.history||old.threadId!==page.threadId||old.history.readEpoch!==page.readEpoch?old:{...old,[kind]:selected.items,history:{...old.history,[kind==='queue'?'moreQueue':'moreInteractions']:selected.more}});
    }catch{if(!controller.signal.aborted)setError(kind==='queue'?'待发送记录未能核对，草稿已保留；暂不能提交修改。':'待答事项未能核对，草稿已保留；暂不能提交答复。');}
    finally{selected.finish(token);activeReads.current.controllers.delete(controller);if(!activeReads.current.disposed)setState(old=>({...old}));
      if(retry&&selected.needsRead&&!activeReads.current.disposed){const timer=setTimeout(()=>{activeReads.current.timers.delete(timer);void readActivePage(kind);},150);activeReads.current.timers.add(timer);}
    }
  }
  function loadMore(kind:'queue'|'interactions'){const after=activePages.current[kind].more;if(after!==null)void readActivePage(kind,after);}
  async function locateTaskInteraction(id:string,after?:number){
    const page=activePages.current.interactions;
    if(after!==undefined)await readActivePage('interactions',after);
    if(page.checking||!page.items.some(item=>item.id===id))return false;
    return true;
  }
  async function selectQuote(quote:MessageQuote,commit:ReturnType<PositionClaim>){
    try{
      const range=await locateSourceQuote(quote);
      commit(()=>{
        if(!range){setPageNotice('原消息已定位；原文暂无法准确定位，摘录与批注已保留。');return;}
        const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
        const view=viewport.current;if(view){const box=view.getBoundingClientRect(),rect=range.getBoundingClientRect();if(rect.top<box.top||rect.bottom>box.bottom)view.scrollTop+=rect.top-box.top-view.clientHeight/3;}
        setPageNotice('');
      });
    }catch{commit(()=>setPageNotice('原消息已定位；原文暂无法准确定位，摘录与批注已保留。'));}
  }
  function locateMessage(id:string,quote?:MessageQuote){
    const commit=claimPosition(),element=document.getElementById('message-'+id);
    if(element){commit(()=>{element.scrollIntoView({block:'center'});element.focus({preventScroll:true});setPageNotice('');});if(quote)void selectQuote(quote,commit);}
    else void loadPage('around',id,quote,commit);
  }

  const [connected, setConnected] = useState(false);
  const queueOperations=useQueueOperations(state,connected);
  const [stateRefresh,setStateRefresh]=useState(0);
  const [connectionError, setConnectionError] = useState("");
  const [uiUpdate, setUiUpdate] = useState(false);
  const [desktopUpdate,setDesktopUpdate]=useState<DesktopUpdateState>(null);
  useLayoutEffect(()=>{
    const bridge=window.homerDesktopUpdate;if(mobileView||!bridge)return;
    let disposed=false,revision=0;
    const receive=()=>{const current=++revision;void bridge.state().then(value=>{
      if(disposed||current!==revision)return;
      captureAnchor();setDesktopUpdate(value);
    }).catch(()=>{});};
    const unsubscribe=bridge.onChange(receive);receive();
    return()=>{disposed=true;unsubscribe();};
  },[]);
  useLayoutEffect(()=>{restoreAnchor();},[desktopUpdate]);
  function desktopUpdateIntent(action:'dismiss'|'restart',returnFocus=false){
    const bridge=window.homerDesktopUpdate;if(!bridge)return;
    // Main emits the authoritative snapshot; action responses must not overwrite newer events.
    void bridge[action]().then(value=>{if(returnFocus&&value?.noticeHidden)focusEditor.current?.();}).catch(()=>{captureAnchor();setDesktopUpdate(value=>value?{...value,error:'update_action_unconfirmed'}:value);});
  }
  const [mobileUpdate,setMobileUpdate]=useState<{version:string;openError:boolean}|null>(null);
  useLayoutEffect(()=>{
    if(!mobileView||!window.ReactNativeWebView)return;
    const receive=()=>{const value=window.__homerMobileUpdate;captureAnchor();setMobileUpdate(value&&typeof value.version==='string'&&/^\d+(?:\.\d+)*$/.test(value.version)&&typeof value.openError==='boolean'?{version:value.version,openError:value.openError}:null);};
    window.addEventListener('homer-mobile-update',receive);receive();
    return()=>window.removeEventListener('homer-mobile-update',receive);
  },[]);
  useLayoutEffect(()=>{restoreAnchor();},[mobileUpdate]);
  function updateIntent(type:'update-open'|'update-dismiss'){window.ReactNativeWebView?.postMessage(JSON.stringify({type,nonce:window.__homerMobileNonce}));}
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState<string | null>(null);
  useEffect(() => { if (stopping && state.activeMessageId !== stopping) setStopping(null); }, [state.activeMessageId, stopping]);
  const visibleRead=useRef<{timer?:ReturnType<typeof setTimeout>;controller?:AbortController;pending?:boolean;disposed?:boolean}>({});
  useEffect(()=>{
    if(!connected){clearTimeout(visibleRead.current.timer);visibleRead.current.timer=undefined;visibleRead.current.pending=false;visibleRead.current.controller?.abort();return;}
    if(!history.current.pages.length)return;
    visibleRead.current.pending=true;
    const schedule=()=>{if(visibleRead.current.disposed||visibleRead.current.timer||visibleRead.current.controller)return;
    visibleRead.current.timer=setTimeout(()=>{
      visibleRead.current.pending=false;
      visibleRead.current.timer=undefined;const ids=[...visibleIds()];if(!ids.length)return;
      const epoch=history.current.epoch,nav=navigation.current,user=userScroll.current,controller=new AbortController();visibleRead.current.controller=controller;
      void fetch('/api/history/page',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readEpoch:epoch,request:{around:ids.at(-1),limit:Math.min(80,ids.length+2)}}),signal:controller.signal}).then(async response=>{if(!response.ok)return;const page=await response.json();if(controller.signal.aborted||nav!==navigation.current||user!==userScroll.current)return;
        captureAnchor();if(history.current.updateExisting(page,epoch))setState(old=>({...old,messages:history.current.messages,artifacts:history.current.artifacts,inactiveInteractions:history.current.inactiveInteractions}));
      }).catch(()=>{}).finally(()=>{if(visibleRead.current.controller===controller)visibleRead.current.controller=undefined;if(visibleRead.current.pending)schedule();});
    },500);
    };schedule();
  },[connected,state.history?.page.revision]);
  useEffect(()=>()=>{visibleRead.current.disposed=true;clearTimeout(visibleRead.current.timer);visibleRead.current.controller?.abort();},[]);
  const verifiedThread = useRef("");
  const loadedVersion = useRef("");
  const sendChain=useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let disposed = false, retryMs = 500;
    let activeEvents: ConnectionEvents | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
    if (disposed) return;
    const events = new ConnectionEvents("/api/history/events"); activeEvents = events;
    events.addEventListener("state", event => {
      if (disposed || activeEvents !== events) return;
      const next = JSON.parse((event as MessageEvent<string>).data) as WebState;
      if (!next.threadId || next.upgrade.phase==='management') {
        if(next.upgrade.phase==='management')setState(next);
        reader.current.connected=false;setConnected(false);setConnectionError(next.upgrade.code==='desktop_account_required'?'荷马尚未连接账号，请完成账号连接后重新打开。':next.upgrade.code?'荷马启动未完成，请核对后重新打开。':'服务尚未就绪，正在等待主对话。');return;
      }
      if (verifiedThread.current && next.threadId !== verifiedThread.current) {
        for(const controller of activeReads.current.controllers)controller.abort();for(const timer of activeReads.current.timers)clearTimeout(timer);activeReads.current.timers.clear();
        activePages.current.queue.invalidate();activePages.current.interactions.invalidate();
        invalidatePosition();anchor.current=null;setError("主对话标识发生变化，已暂停发送。请检查服务配置。"); reader.current.connected=false;setConnected(false); disposed = true; events.close(); return;
      }
      if(next.history?.protocol!==3||next.conversationView!==CONVERSATION_VIEW){reader.current.connected=false;setConnected(false);setConnectionError('对话显示合同已更新，请保存草稿后使用“刷新界面”。');setUiUpdate(true);return;}
      retryMs = 500;
      const uiVersion = next.upgrade.uiVersion ?? next.upgrade.version;
      if (uiVersion) {
        if (loadedVersion.current && loadedVersion.current !== uiVersion) setUiUpdate(true);
        loadedVersion.current = uiVersion;
      }
      verifiedThread.current = next.threadId;
      const newScope=history.current.thread!==next.threadId||history.current.epoch!==next.history.readEpoch;
      const firstThread=reader.current.initializedThread!==next.threadId;
      if(newScope){if(reader.current.initializedThread===next.threadId&&anchor.current&&!next.messages.some(m=>m.id===anchor.current!.id))setPageNotice('原阅读位置已变化，可查看最新消息');invalidatePosition();anchor.current=null;}
      if(!history.current.snapshot(next,readingPins())){setPageNotice('当前阅读位置需要保留，最新页尚未替换。');return;}
      reader.current.connected=true;observeContent(next,newScope);
      if(firstThread){const allow=!!reader.current.initializedThread||navigation.current===(newScope?1:0)&&userScroll.current===0;reader.current.initializedThread=next.threadId;
        if(allow&&next.messages.length)reader.current.pending={kind:'initialize',scope:positionScope(),navigation:navigation.current,user:userScroll.current};
      }
      prepareLatest();
      const version={threadId:next.threadId,readEpoch:next.history.readEpoch,revision:next.history.page.revision};
      if(activePages.current.queue.version.readEpoch!==version.readEpoch||activePages.current.queue.version.threadId!==version.threadId){for(const controller of activeReads.current.controllers)controller.abort();for(const timer of activeReads.current.timers)clearTimeout(timer);activeReads.current.timers.clear();}
      activePages.current.queue.snapshot(version,next.queue??[],next.history.moreQueue);
      activePages.current.interactions.snapshot(version,next.interactions,next.history.moreInteractions);
      setState({...next,queue:activePages.current.queue.items,interactions:activePages.current.interactions.items,messages:history.current.messages,artifacts:history.current.artifacts,inactiveInteractions:history.current.inactiveInteractions,history:{...next.history,moreQueue:activePages.current.queue.more,moreInteractions:activePages.current.interactions.more}});
      for(const kind of ['queue','interactions'] as const)if((kind!=='queue'||!next.features?.queueDispatch)&&activePages.current[kind].needsRead)void readActivePage(kind);
      setConnected(true); setConnectionError("");
      // Neither an inactive callback nor absence from a bounded page erases
      // user drafts or immutable unconfirmed requests. Recovery is explicit.

    });
    events.addEventListener("unavailable", () => { if(disposed||activeEvents!==events)return; reader.current.connected=false;setConnected(false); setConnectionError("服务暂不可用，正在等待恢复；已有消息和草稿会保留。"); });
    events.onerror = code => {
      if (disposed || activeEvents !== events) return;
      if(code==='history_protocol_required'||code==='route_not_found'){setUiUpdate(true);setConnectionError('网页读取版本不匹配，请保存草稿后刷新界面。');reader.current.connected=false;setConnected(false);events.close();return;}
      if(code==='mobile_device_denied'){reader.current.connected=false;setConnected(false);setConnectionError('此设备未获授权或已停用。请在主端核对，或在 App 中重新扫码。草稿已保留。');events.close();activeEvents=undefined;retryTimer=setTimeout(connect,10000);return;}
      reader.current.connected=false;setConnected(false); setConnectionError(code==="service_not_ready"?"服务尚未就绪，正在等待主对话。":"暂未连接到荷马，正在自动重连。已有消息和草稿会保留。"); events.close(); activeEvents = undefined;
      retryTimer = setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 10000);
    };
    };
    const foreground=()=>{if(!mobileView||document.visibilityState!=='visible'||disposed)return;clearTimeout(retryTimer);activeEvents?.close();activeEvents=undefined;connect();};
    document.addEventListener('visibilitychange',foreground);
    connect();
    return () => { disposed = true;document.removeEventListener('visibilitychange',foreground);clearTimeout(retryTimer); activeEvents?.close(); };
  }, [stateRefresh]);
  function interactionNotLive(item:WebInteraction){
    // This exact server refusal invalidates only this callback. An unknown
    // transport error keeps the original pending request and draft instead.
    setState(previous=>{
      const source=previous.messages.find(message=>message.role==='user'&&message.requestId===item.sourceRequestId);
      const inactive=previous.inactiveInteractions??[];
      return {...previous,interactions:previous.interactions.filter(i=>i.id!==item.id),inactiveInteractions:source?[...inactive.filter(i=>i.id!==item.id),{id:item.id,kind:item.kind,state:'expired',sourceRequestId:item.sourceRequestId!,messageId:source.id}]:inactive};
    });
    setStateRefresh(n=>n+1);
  }
  const sendInput=useCallback((input:ConversationInput,target?:UnconfirmedInput['target'])=>{
    if(!connected||!verifiedThread.current)return Promise.reject(new Error('service_not_ready'));
    const ownerThread=verifiedThread.current;
    setError('');
    const send=async()=>{
      try{await post(input.interactionId?'/api/interactions/'+input.interactionId:target?'/api/messages/interrupt':'/api/messages',target?{input,target}:input);if(input.interactionId&&verifiedThread.current===ownerThread)setState(old=>old.threadId===ownerThread?({...old,acceptedRequestIds:[...new Set([...(old.acceptedRequestIds??[]),input.requestId])]}):old);}
      catch(error){if(verifiedThread.current===ownerThread)setError('发送未确认，消息和引用已逐条保留；可核对并重试：'+(error instanceof Error?error.message:'web_request_failed'));throw error;}
    };const task=input.interactionId?send():sendChain.current.catch(()=>{}).then(send);if(!input.interactionId)sendChain.current=task;return task;
  },[connected]);
  const onNew = useCallback(async (message: AppendMessage) => {
    const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    const custom = message.metadata?.custom as { quote?: MessageQuote; quotes?: AnnotatedQuote[] } | undefined;
    const input = prepareMessage(text, custom?.quotes ?? custom?.quote, undefined, () => crypto.randomUUID());
    await sendInput(input);
  }, [sendInput]);
  const processDetails=useProcessDetails(state.messages,state.threadId,state.history?.readEpoch,loadProcess);
  const processMessages=useMemo(()=>new Map(processDetails.messages.map(message=>[message.id,message])),[processDetails.messages]);
  const nativeActivity=liveMainActivity(state,connected);
  const messageCache=useRef(new Map<string,{source:WebState['messages'][number];key:string;value:ThreadMessageLike}>());
  const alive=new Set(state.messages.map(message=>message.id));for(const id of messageCache.current.keys())if(!alive.has(id))messageCache.current.delete(id);
  const messages:ThreadMessageLike[]=processDetails.messages.map(message=>{
    const stale=!nativeActivity||nativeActivity.processId!==message.process?.id||message.process?.threadId!==state.threadId||nativeActivity.source!==(message.process?.sourceKind==='worker'?'internal':'user')||!['native','compacting'].includes(nativeActivity.stage);
    const activity=message.process?processActivityText(state,connected,message.process):'',notes=state.inactiveInteractions?.filter(i=>i.processId?i.processId===message.process?.id:i.messageId===message.id),key=activity+JSON.stringify(notes)+String(stale)+nativeActivity?.turnId;
    const cached=messageCache.current.get(message.id);if(cached?.source===message&&cached.key===key)return cached.value;
    const projected=projectProcessMessage(message,stale,nativeActivity?.turnId);
    const value:ThreadMessageLike=({
    id: message.id, role: message.role, content: projected.content, createdAt: new Date(message.createdAt),
    metadata: { custom: { ...(message.role==='user'?{original:message}:{}),claimPosition,activityPresentation:projected.presentation,inactiveInteractions:notes,activityText:activity,sourceLabel:message.sourceLabel,sourceMessageId:message.sourceMessageId,quote: message.quote, quotes: message.quotes,resourceReference:message.resourceReference,resourceReferences:message.resourceReferences,media:message.media,messageId:message.id,inputState:message.inputState,queued:!isVisibleConversationMessage(message) } },
    ...(message.role === "assistant" ? { status: message.status === "running" ? { type: "running" as const } : message.status === "completed" ? { type: "complete" as const, reason: "stop" as const } : { type: "incomplete" as const, reason: message.process?.status === "unknown" ? "other" as const : message.status === "interrupted" ? "cancelled" as const : "error" as const } } : {}),
  });messageCache.current.set(message.id,{source:message,key,value});return value;});
  const stopCurrent=async()=>{if(!state.activeMessageId)return;setStopping(state.activeMessageId);try{await post("/api/stop",{messageId:state.activeMessageId});}catch(e){setStopping(null);setError("停止未确认："+(e instanceof Error?e.message:"web_request_failed"));}};
  const runtime = useExternalStoreRuntime({ messages, convertMessage: (message: ThreadMessageLike) => message, isRunning: state.isRunning, isSendDisabled: !canAcceptInput(connected,state.upgrade),
    adapters:{attachments:attachmentOwner},
    onNew, onCancel: async () => {
      setStopping(state.activeMessageId);
      try { await post("/api/stop", { messageId: state.activeMessageId }); }
      catch (error) { setStopping(null); setError("停止未确认：" + (error instanceof Error ? error.message : "web_request_failed")); }
    },
  });
  useLayoutEffect(()=>{let previous=runtime.thread.getState().messages;
    return runtime.thread.subscribe(()=>{const actual=runtime.thread.getState().messages;
      const changed=actual.length!==previous.length||actual.some((m,i)=>m.metadata.custom!==previous[i]?.metadata.custom);previous=actual;
      if(changed&&reader.current.pending)setState(old=>({...old}));
    });
  },[runtime]);
  useLayoutEffect(()=>{
    const pending=reader.current.pending,view=viewport.current;
    if(!view||view.clientHeight<=0)return;
    if(pending){
      if(pending.scope!==positionScope()||pending.navigation!==navigation.current||pending.user!==userScroll.current){reader.current.pending=undefined;return;}
      const target=pending.kind==='around'?history.current.messages:pending.recent?.messages;
      const actual=runtime.thread.getState().messages;
      // The external runtime updates in a passive effect. IDs alone do not
      // prove a same-ID streamed body has reached the runtime and DOM.
      const roots=new Set(Array.from(view.querySelectorAll<HTMLElement>('[data-conversation-message]')).map(element=>element.dataset.conversationMessage));
      const committed=target&&state.messages.length===target.length&&state.messages.every((m,i)=>m===target[i])&&messages.every(m=>actual.some(a=>a.id===m.id&&a.metadata.custom===m.metadata?.custom))&&state.messages.filter(isVisibleConversationMessage).every(m=>roots.has(m.id));
      if(!committed||pending.kind!=='around'&&(!reader.current.connected||history.current.archived||pending.recent!==history.current.recent))return;
      reader.current.pending=undefined; // Consume before any DOM write.
      reader.current.gesture=false;anchor.current=null;
      if(pending.kind==='around'){const element=document.getElementById('message-'+pending.id);element?.scrollIntoView({block:'center'});element?.focus({preventScroll:true});if(pending.quote)void selectQuote(pending.quote,claimPosition());}
      else{view.scrollTop=view.scrollHeight;setHasNewContent(false);setPageNotice('');}
      captureAnchor();
    }else restoreAnchor();
  });
  const artifacts=state.artifacts??[];
  const closeCanvas=()=>{
    updatePreviewScope(false,canvasArtifact?.id??null);setAnnotationFocus(undefined);captureAnchor();setCanvasOpen(false);
  };
  const selectArtifact=(id:string)=>{
    const tab=previewTabs.tabs.find(tab=>tab.id===id);if(!tab||id===canvasArtifact?.id)return;
    updatePreviewScope(true,id);canvasTrigger.current=tab.trigger??null;setAnnotationFocus(undefined);
    setPreviewTabs(old=>({...old,activeId:id}));
  };
  const closeArtifact=(id:string)=>{
    const remove=(old:typeof previewTabs)=>{
      const at=old.tabs.findIndex(tab=>tab.id===id);if(at<0)return old;
      const tabs=old.tabs.filter(tab=>tab.id!==id);
      return {...old,tabs,activeId:id===old.activeId?tabs[Math.min(at,tabs.length-1)]?.id??null:old.activeId};
    };
    const {tabs,activeId}=remove(previewTabs);if(tabs===previewTabs.tabs)return;
    if(id===previewTabs.activeId){
      updatePreviewScope(tabs.length>0,activeId);setAnnotationFocus(undefined);
      if(activeId)canvasTrigger.current=tabs.find(tab=>tab.id===activeId)?.trigger??null;
      else{captureAnchor();setCanvasOpen(false);}
    }
    setPreviewTabs(remove);
  };
  const openArtifact=(file:CanvasArtifact,trigger?:HTMLElement,annotation?:{key:string;id:string})=>{
    const active=trigger??document.activeElement;
    const origin=active instanceof HTMLElement&&!active.closest('#canvas-panel')?active:undefined;
    if(origin)canvasTrigger.current=origin;
    if(annotation)setAnnotationFocus({...annotation,nonce:crypto.randomUUID()});
    if(canvasOpen&&canvasArtifact?.id===file.id)return;
    if(!annotation)setAnnotationFocus(undefined);
    if(!canvasOpen)captureAnchor();
    updatePreviewScope(true,file.id);
    setPreviewTabs(old=>{
      const existing=old.tabs.some(tab=>tab.id===file.id);
      return {...old,tabs:existing?old.tabs.map(tab=>tab.id===file.id&&origin?{...tab,trigger:origin}:tab):[...old.tabs,{...file,trigger:origin}],activeId:file.id};
    });setCanvasOpen(true);
  };
  const queueDrafts=(()=>{try{return Object.keys(sessionStorage).filter(key=>key.startsWith('homer-queue-edit:')).flatMap(key=>{const draft=storage.read<Pick<ConversationInput,'text'|'quote'|'quotes'|'resourceReference'|'resourceReferences'|'attachments'>>(key);return draft?[{key,...draft}]:[];});}catch{return [];}})();
  const questionDrafts=(state.inactiveInteractions??[]).filter(item=>item.kind==='question').flatMap(item=>{
    const key='homer-interaction:'+state.threadId+':'+item.id,draft=interactionDraft(key),pending=storage.read<ConversationInput>(key+':pending');
    const text=[...new Set([draft.text,...Object.values(draft.answers),pending?.text??''].filter(value=>value.trim()))].join('\n\n');
    return text?[{id:item.id,text,expired:true}]:[];
  });
  try{
    const prefix='homer-interaction:'+state.threadId+':';
    for(let n=0;n<localStorage.length;n++){
      const key=localStorage.key(n);if(!key?.startsWith(prefix)||!key.endsWith(':questions'))continue;
      const id=key.slice(prefix.length,-':questions'.length);
      if(state.interactions.some(item=>item.id===id)||questionDrafts.some(item=>item.id===id))continue;
      const text=Object.values(interactionDraft(prefix+id).legacy).join('\n\n');
      if(text.trim())questionDrafts.push({id,text,expired:false});
    }
  }catch{/* Old local drafts remain optional and never cause submission. */}

  const accountRequired=!mobileView&&!!window.homerDesktopAccount&&!connected&&state.upgrade.phase==='management'&&state.upgrade.code==='desktop_account_required';
  const featureTour = mobileView ? undefined : window.homerDesktopFeatureTour;
  const feedback = error || (!accountRequired&&!connected ? connectionError || (state.threadId ? "与荷马的连接暂时中断，正在自动重连。草稿已保留。" : "正在恢复主对话…") : "");
  return <QuoteNavigationContext.Provider value={quote=>locateMessage(quote.messageId,quote)}><ProcessDetailsContext.Provider value={processDetails.load}><ProcessMessagesContext.Provider value={processMessages}><ProcessObservationContext.Provider value={{connected,threadId:state.threadId,readEpoch:state.history?.readEpoch,serviceRunning:state.upgrade.phase==='running',observedAtMs:state.observedAtMs,mainActivity:state.mainActivity,generationTurnId:state.generation?.turnId}}><ArtifactsContext.Provider value={{files:artifacts,selectedId:canvasOpen?canvasArtifact?.id:undefined,open:openArtifact}}><AssistantRuntimeProvider runtime={runtime}><PreviewActionsContext.Provider value={{canQuote:()=>previewComposer.current?.canQuote()??false,openQuote:(snapshot,trigger)=>previewComposer.current?.openQuote(snapshot,trigger),appendQuote:quote=>previewComposer.current?.appendQuote(quote)}}>
    <div className={canvasOpen?"app-shell canvas-open":"app-shell"} data-native-titlebar={nativeTitlebar||undefined}>
      {featureTour && <DesktopFeatureTour bridge={featureTour}
        ready={accountRequired || (connected && !!state.threadId && state.upgrade.phase === 'running')}
        settingsActive={settingsOpen}
        returnFocus={() => (accountRequired
          ? viewport.current?.querySelector<HTMLButtonElement>('.desktop-account-onboarding .primary-button:enabled')
          : viewport.current?.closest('main')?.querySelector<HTMLElement>('.composer-input [contenteditable="true"]')) ?? viewport.current} />}
      <Group className="preview-layout" orientation="horizontal" disabled={narrowPreview} defaultLayout={{conversation:50,preview:50}}><Panel id="conversation" className="preview-main-panel" minSize={nativeTitlebar?'240px':'25%'}><div className="conversation-panel">
        <header className="conversation-header">
          <span className="header-name"><img src={homerLogo64} srcSet={`${homerLogo64} 64w, ${homerLogo256} 256w`} sizes="24px" alt="荷马" width={24} height={24} style={{borderRadius:0,objectFit:"contain"}} /><span className="header-brand-label" aria-hidden>荷马</span></span>
          <div className="header-actions">{mobileView?<MobileSettings/>:<DesktopSettings key={state.threadId} ref={accountSettings} onVisibilityChange={setSettingsOpen}/>}{state.features?.taskOverview&&<TaskStatusPopover state={state} connected={connected} onInteraction={locateTaskInteraction} asideContainer={statusContainer} onBeforeLayoutChange={captureAnchor}/>}<button type="button" aria-expanded={canvasOpen} aria-controls="canvas-panel" onClick={event=>{if(canvasOpen){closeCanvas();return;}canvasTrigger.current=event.currentTarget;updatePreviewScope(true,canvasArtifact?.id??null);captureAnchor();setCanvasOpen(true);}} aria-label="预览" title="预览"><PanelRightIcon size={18}/></button></div>
        </header>
      {desktopUpdate?.status==='ready'&&!desktopUpdate.noticeHidden&&typeof desktopUpdate.version==='string'&&/^\d+\.\d+\.\d+$/.test(desktopUpdate.version)&&<aside className="mobile-update-notice" aria-label="桌面版本更新"><div className="mobile-update-row"><span role="status">新版本 {desktopUpdate.version} 已准备好</span><button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>desktopUpdateIntent('restart')}>重启并更新</button><button type="button" aria-label="关闭更新提示" onMouseDown={event=>event.preventDefault()} onClick={event=>desktopUpdateIntent('dismiss',event.currentTarget.parentNode?.contains(document.activeElement)===true)}>×</button></div>{desktopUpdate.error&&<p role="status">{desktopUpdate.error==='update_busy'?'当前工作尚未结束，请稍后重试。':desktopUpdate.error==='update_unsaved'?'请先保存未提交的编辑，再重试。':['update_service_stopped','update_install_unconfirmed'].includes(desktopUpdate.error)?'服务已停止，更新尚未确认。请重新打开荷马后核对。':desktopUpdate.error==='update_metadata_unconfirmed'?'更新版本信息未确认，请核对安装包。':'未能确认重启更新，请重试。'}</p>}</aside>}
      {mobileUpdate&&<aside className="mobile-update-notice" aria-label="版本更新"><div className="mobile-update-row"><span role="status">有新版本 {mobileUpdate.version}</span><button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>updateIntent('update-open')}>前往更新</button><button type="button" aria-label="关闭更新提示" onMouseDown={event=>event.preventDefault()} onClick={()=>updateIntent('update-dismiss')}>×</button></div>{mobileUpdate.openError&&<p role="status">未能打开下载页，请重试。</p>}</aside>}
      <div className="conversation-workspace"><main className="conversation">
        {state.orderWarning&&<div className="upgrade-banner" role="status">{state.orderWarning}</div>}
        {state.upgrade.reviewRequired && <div className="upgrade-banner" role="status">更新涉及用户身份或私有运行数据，当前版本继续可用。<a href="/settings/update">审阅更新</a></div>}
        {uiUpdate && <div className="upgrade-banner" role="status">界面更新已就绪，当前工作继续。<button type="button" onClick={()=>window.location.reload()}>刷新界面</button></div>}
        {feedback && <div className="error-banner" role="alert"><span>{feedback}</span>{error && <button onClick={() => setError("")} aria-label="关闭错误提示">×</button>}</div>}
        {state.threadId && state.upgrade.phase !== "running" && <div className="upgrade-banner" role="status">{serviceActivityNotice(state.upgrade)}</div>}
        <ComposerInputFocusContext.Provider value={focusEditor}><ThreadPrimitive.Root className="thread" onPointerDownCapture={noteOutsideReaderGesture} onKeyDownCapture={noteOutsideReaderGesture}>
          <ThreadPrimitive.Viewport ref={viewport} className="thread-viewport" tabIndex={-1} style={{overflowAnchor:'none'}} autoScroll={false} scrollToBottomOnRunStart={false} scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} onScroll={recordReaderScroll} onWheel={noteReaderGesture} onTouchStart={noteReaderGesture} onTouchMove={noteReaderGesture} onPointerDown={noteReaderGesture} onKeyDown={noteReaderGesture}
            onClickCapture={event=>{const target=event.target as Element,control=target.closest('[aria-expanded], summary');if(target.closest('[data-conversation-message]')&&control&&(control.tagName==='SUMMARY'?!control.parentElement?.hasAttribute('open'):control.getAttribute('aria-expanded')==='false'&&(control.getAttribute('aria-haspopup')??'false')==='false'&&control.getAttribute('role')!=='combobox'))captureAnchor();}}
            onClick={event=>{const link=(event.target as Element).closest<HTMLAnchorElement>('a[href^="#message-"]');if(link){event.preventDefault();locateMessage(decodeURIComponent(link.hash.slice(9)));}}}>
            {state.history&&<nav className="history-navigation" aria-label="对话记录分页">{history.current.before&&<button type="button" disabled={pageBusy} onClick={()=>void loadPage('before')}>{pageBusy?'正在读取…':'加载更早消息'}</button>}{history.current.archived&&<button type="button" onClick={returnLatest}>回到最新消息</button>}{history.current.stale&&<span role="status">较早记录可能已有更新，展开过程时会重新核对。</span>}{history.current.inactiveMore&&<span role="status">本页还有失效交互记录未加载；旧提问和授权回调均不可继续提交，请从原事项核对。</span>}{pageNotice&&<p role="status">{pageNotice}</p>}</nav>}

            {accountRequired&&<DesktopAccount onboarding/>}
            {connected && state.threadId && <ThreadPrimitive.Empty><div className="welcome"><img src={homerLogo256} srcSet={`${homerLogo64} 64w, ${homerLogo256} 256w`} sizes="(max-width: 480px) 58px, 70px" alt="" width={70} height={70} style={{borderRadius:0,objectFit:"contain"}} />
              <h1 className="welcome-title">一语成真。</h1>
              <p className="welcome-description">把想法告诉我，一起把它变成现实。</p>
              <div className="welcome-examples" aria-label="试试这样开始">
                {['帮我整理一份资料','和我一起规划一件事','帮我核对一份结果'].map(example => <button key={example} type="button" onClick={() => {setEditDraft({text:example,id:crypto.randomUUID(),source:'welcome'});focusEditor.current?.();}}>{example}</button>)}
              </div>
            </div></ThreadPrimitive.Empty>}
            <div className="messages"><MessageTimestamps messages={state.messages}><ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} /></MessageTimestamps></div>
            {history.current.after&&<nav className="history-navigation"><button type="button" disabled={pageBusy} onClick={()=>void loadPage('after')}>加载后续消息</button><button type="button" onClick={returnLatest}>有新消息 · 回到最新</button></nav>}
            {(['queue','interactions'] as const).map(kind=>(kind!=='queue'||!state.features?.queueDispatch)&&activePages.current[kind].checking&&<p key={kind} role="status">{kind==='queue'?'待发送页':'待答页'}正在核对；编辑草稿保留，提交暂不可用。<button type="button" disabled={!activePages.current[kind].needsRead} onClick={()=>void readActivePage(kind)}>重新核对</button></p>)}
            {!state.features?.queueDispatch&&activePages.current.queue.cursor>0&&<button type="button" disabled={activePages.current.queue.checking} onClick={()=>void readActivePage('queue',0)}>返回待发送首页</button>}
            {activePages.current.interactions.cursor>0&&<button type="button" disabled={activePages.current.interactions.checking} onClick={()=>void readActivePage('interactions',0)}>返回待答首页</button>}
            {!state.features?.queueDispatch&&state.history?.moreQueue&&<button type="button" disabled={activePages.current.queue.checking} onClick={()=>loadMore('queue')}>还有待发送记录，查看下一页</button>}
            {state.history?.moreInteractions&&<button type="button" disabled={activePages.current.interactions.checking} onClick={()=>loadMore('interactions')}>还有待答事项，查看下一页</button>}
            {queueDrafts.map(draft=><details className="queue-draft-recovery" key={draft.key}><summary>未提交的排队编辑草稿</summary><p style={{whiteSpace:'pre-wrap'}}>{draft.text}</p>{draftQuotes(draft).map((quote,i)=><blockquote key={i}><QuoteSource quote={quote} index={i} expanded/>{quote.annotation&&<p>{quote.annotation}</p>}</blockquote>)}{referencesOf(draft).map(reference=><ResourceReferenceBlock key={referenceKey(reference)} reference={reference}/>)} {!!draft.attachments?.length&&<p>已保留 {draft.attachments.length} 个原附件引用；如另发消息，请重新添加文件。</p>}<button type="button" onClick={()=>setEditDraft({text:[draft.text,...draftQuotes(draft).map(quote=>quote.text+(quote.annotation?'\n批注：'+quote.annotation:''))].filter(Boolean).join('\n\n'),id:crypto.randomUUID()})}>{referencesOf(draft).length?'复制正文到输入草稿':'复制文字与引用到输入草稿'}</button></details>)}
            {questionDrafts.map(draft=><details className="queue-draft-recovery" key={draft.id}><summary>已保留的答复内容</summary><p>{draft.expired?'原问题已失效':'旧版问题状态需要核对'}；内容不会自动发送，接收情况以原请求回执为准。</p><p style={{whiteSpace:'pre-wrap'}}>{draft.text}</p><button type="button" onClick={()=>setEditDraft({text:draft.text,id:crypto.randomUUID()})}>复制到普通消息草稿</button></details>)}
            <div className="interaction-list">{state.interactions.map(item => <InteractionCard key={state.threadId+':'+item.id} verified={connected&&!activePages.current.interactions.checking} item={item} threadId={state.threadId} messages={state.messages} acceptedRequestIds={state.acceptedRequestIds??[]} onError={setError} onNotLive={interactionNotLive} onAnswer={item=>setAnswerTarget({...item,historyThreadId:state.threadId})} onReveal={card=>claimPosition()(()=>card.scrollIntoView({block:'nearest',behavior:'instant'}))} structuredAnswers={!!state.features?.nativeQuestionAnswers} />)}</div>
            {!accountRequired&&<button type="button" className="scroll-latest" disabled={!history.current.archived&&isAtBottom&&!hasNewContent} onClick={returnLatest}>↓ {hasNewContent?'有新内容 · 最新消息':'最新消息'}</button>}
          </ThreadPrimitive.Viewport>
          <MainComposer settingsOpen={settingsOpen} onAccount={!mobileView&&window.homerDesktopAccount?()=>accountSettings.current?.openAccount():undefined} annotationDraft={annotationDraft} bindPreview={value=>{previewComposer.current=value;}} key={state.threadId} answerTarget={answerTarget?.historyThreadId===state.threadId?answerTarget:undefined} onAnswerTarget={item=>setAnswerTarget(item?{...item,historyThreadId:state.threadId}:undefined)} interactionsVerified={connected&&!activePages.current.interactions.checking} attachmentOwner={attachmentOwner} composerRuntime={runtime.thread.composer} bindAttachments={read=>{attachmentContext.current=read;}} state={state} connected={connected} stopping={stopping} onSend={sendInput} onStop={()=>void stopCurrent()} editDraft={editDraft} onQueueBusy={setComposerBusy} queueContent={<HomerMessageQueue state={state} connected={connected} operations={queueOperations} editorBusy={composerBusy||(!state.features?.queueDispatch&&activePages.current.queue.checking)}/>}/>
          <HomerSelectionToolbar />
        </ThreadPrimitive.Root></ComposerInputFocusContext.Provider>
      </main><div className="status-aside-slot" ref={setStatusContainer}/></div></div></Panel>{canvasOpen&&<><Separator className="preview-separator"/><Panel id="preview" className="preview-side-panel" minSize="25%" maxSize={nativeTitlebar?'75%':undefined}><CanvasPanel annotationDraft={annotationDraft} key={state.threadId} threadId={state.threadId} tabs={previewTabs.tabs} artifact={canvasArtifact} onSelectArtifact={selectArtifact} onCloseArtifact={closeArtifact} isCurrent={isCurrentPreview} annotationFocus={annotationFocus} onClose={closeCanvas} returnFocusTo={()=>canvasTrigger.current??false} onReference={addPreviewReference} referencesEnabled={!!state.features?.previewReferenceCollections}/></Panel></>}</Group>
    </div>
  </PreviewActionsContext.Provider></AssistantRuntimeProvider></ArtifactsContext.Provider></ProcessObservationContext.Provider></ProcessMessagesContext.Provider></ProcessDetailsContext.Provider></QuoteNavigationContext.Provider>;
}
createRoot(document.getElementById("homer-root")!).render(<HomerApp />);
