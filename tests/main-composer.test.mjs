import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as client from '../ui/conversation-client.ts';
import {CONVERSATION_VIEW} from '../src/web-contract.ts';
import {previewIntentTooLong} from '../src/user-intent.ts';
import {messageQuoteText,previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText} from '../src/message-quote.ts';
import {createAnnotationDraft} from '../ui/annotation-draft.ts';
import * as references from '../src/preview-reference.ts';
import {annotationValidationReferences} from '../ui/annotation-draft.ts';
import {ContextOrder,contextKey} from '../ui/composer-context-order.ts';
import {createHomerAttachmentAdapter,attachmentAsset} from '../ui/homer-attachment-adapter.ts';
import {historyFixture} from './web-history-loading-fixture.ts';
import {MainInputs} from '../src/recursive-main-inputs.ts';
import {WebHistoryPages} from '../src/web-history-pages.ts';
import {Homer} from '../src/service.ts';
import {homerWebBridge} from '../src/web-homer.ts';
import {recoveryFixture} from './main-history-recovery-fixture.ts';

// Execute the production component's handlers with deterministic hook storage.
// This deliberately does not simulate a browser, Lexical DOM, or a second composer.
const require=createRequire(import.meta.url);
function productionFunction(path,name,bindings){
  const source=ts.createSourceFile(String(path),readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.ok(declaration,`production ${name} exists`);
  const js=ts.transpileModule(declaration.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
  return Function('require','exports',...Object.keys(bindings),js+`;return ${name};`)(require,{},...Object.values(bindings));
}
const appPath=process.env.HOMER_READER_SOURCE??new URL('../ui/homer-app.tsx',import.meta.url);
function nodes(tree){return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({text='draft',draft,queueEditor,request,queueRead,collections=2,capture=false,acceptCapture=async()=>true,staleAttachmentSnapshot=false,connected=true,running=true,upgrade={phase:'running'},pending=[],completeQuote=async value=>value.quote}={}){
  const state={threadId:'synthetic-composer',conversationView:CONVERSATION_VIEW,messages:[],isRunning:running,activeMessageId:running?'active':null,generation:running?{messageId:'active',generationId:'generation'}:null,work:[],interactions:[],features:{draftUpload:true,previewReferenceCollections:collections},upgrade};
  const cache=new Map(),calls=[],sends=[],hooks=[],effects=[],revoked=[];let cursor=0,dirty=false,tree,stops=0,focuses=0,preview;
  if(draft)cache.set('homer-draft:'+state.threadId,draft);
  if(queueEditor)cache.set('homer-queue-editor:'+state.threadId,queueEditor);
  if(pending.length)cache.set('homer-unconfirmed:'+state.threadId,pending);
  let previousAttachments;
  const runtime={text,quote:undefined,attachments:[]};const composer={setText(value){runtime.text=value;dirty=true;},setQuote(value){runtime.quote=value;dirty=true;},getState:()=>previousAttachments?{...runtime,attachments:previousAttachments}:runtime};
  const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];};
  const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
  const useMemo=(factory,deps)=>{const i=cursor++,previous=hooks[i];if(!previous||deps.some((d,n)=>!Object.is(d,previous.deps[n])))hooks[i]={deps,value:factory()};return hooks[i].value;};
  const useEffect=(effect,deps)=>{const i=cursor++,previous=hooks[i];if(!previous||!deps||deps.some((d,n)=>!Object.is(d,previous.deps[n]))){hooks[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=effect();});}};
  const storage={read:key=>cache.get(key),write:(key,value)=>{if(value===undefined)cache.delete(key);else cache.set(key,structuredClone(value));return true;}};
  const fetch=async(path,options)=>{calls.push({path,...options});return request?request(path,options):{ok:true,json:async()=>({})};};
  const post=async(path,value)=>{const response=await fetch(path,{method:'POST',body:JSON.stringify(value)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
  let attachmentRead=()=>({threadId:state.threadId,requestId:'initial',enabled:true,attachments:runtime.attachments,notice:()=>{}});
  let captureScope,captureResult;
  const homerDesktopCapture=capture?{setReady:async scope=>{captureScope=scope;return true;},acceptDraft:acceptCapture,onResult:callback=>{captureResult=callback;return ()=>{captureResult=undefined;};}}:undefined;
  const attachmentOwner=createHomerAttachmentAdapter(()=>attachmentRead(),fetch);
  composer.addAttachment=async file=>{const before=[...runtime.attachments];if(!(file instanceof File)){runtime.attachments.push(file);dirty=true;return;}for await(const value of attachmentOwner.add({file})){const at=runtime.attachments.findIndex(a=>a.id===value.id);if(at<0)runtime.attachments.push(value);else runtime.attachments[at]=value;dirty=true;}if(staleAttachmentSnapshot)previousAttachments=before;};
  composer.attachment=({id})=>({remove:async()=>{await attachmentOwner.remove(runtime.attachments.find(a=>a.id===id));runtime.attachments=runtime.attachments.filter(a=>a.id!==id);dirty=true;}});
  composer.clearAttachments=async()=>{const previous=runtime.attachments;runtime.attachments=[];dirty=true;await Promise.all(previous.map(a=>attachmentOwner.remove(a)));};
  const annotationDraft=createAnnotationDraft();annotationDraft.subscribe(()=>{dirty=true;});
  const ArtifactsContext={};const ComposerInputFocusContext={},inputRef={current:()=>{focuses++;}},useContext=context=>{if(context===ArtifactsContext)return {open(){}};assert.equal(context,ComposerInputFocusContext);return inputRef;};
  const useComposerInputFocus=productionFunction(new URL('../ui/homer-composer-input.tsx',import.meta.url),'useComposerInputFocus',{useContext,ComposerInputFocusContext,useCallback:(callback,deps)=>useMemo(()=>callback,deps)});
  const MainComposer=productionFunction(appPath,'MainComposer',{...client,...references,CONVERSATION_VIEW,ScreenshotDialog:'screenshot-dialog',mobileView:false,ContextOrder,contextKey,previewIntentTooLong,annotationValidationReferences,Popover:{Root:'popover',Portal:'portal',Positioner:'positioner',Popup:'popup'},AnnotationCommentForm:'quote-form',QuoteBlock:{Root:'quote-block',Text:'quote-text'},completeSourceQuote:completeQuote,locateSourceQuote:async()=>undefined,AnnotationChips:'annotation-chips',MessageCirclePlus:'quote-icon',ExecutionUsage:'usage',QueueDraftRecovery:'legacy-panel',useAnnotationDraft:owner=>owner.read(),ArtifactsContext,useState,useRef,useEffect,useLayoutEffect:useEffect,useMemo,useCallback:(callback,deps)=>useMemo(()=>callback,deps),useContext,interactionDraft:key=>({text:storage.read(key+':draft')??'',answers:{}}),ComposerInputFocusContext,useComposerInputFocus,useAui:()=>({composer:()=>composer}),useAuiState:selector=>selector({composer:runtime}),attachmentAsset,HomerAttachmentByIndex:'attachment',ComposerPrimitive:{Root:'form'},ComposerQuotePreview:{Root:'quote-root',Icon:'quote-icon',Text:'quote-text',Dismiss:'quote-dismiss'},requestAnimationFrame:fn=>fn(),Node:class {static [Symbol.hasInstance](node){return !!node&&typeof node==='object';}},document:{querySelector:()=>null},CSS:{escape:value=>value},HomerComposerInput:'editor',ComposerIcon:()=>null,storage,fetch,post,window:{homerDesktopCapture,addEventListener(){},removeEventListener(){}},URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL:url=>revoked.push(url)}});
  const composerRuntime={...composer,getState:()=>runtime,getAttachmentByIndex:index=>composer.attachment({id:runtime.attachments[index].id})};
  const props={state,connected,annotationDraft,bindPreview(value){preview=value;},interactionsVerified:true,onAnswerTarget:item=>{props.answerTarget=item;dirty=true;},attachmentOwner,composerRuntime,bindAttachments:read=>{attachmentRead=read;},stopping:null,onSend:async(...args)=>{sends.push(args);},onStop:()=>{stops++;}};
  const queueEvents=new EventTarget();
  const queueModule={};
  if(queueRead){
   const js=ts.transpileModule(readFileSync(new URL('../ui/homer-message-queue.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
   const modules={'react':{useState,useRef,useEffect,useLayoutEffect:useEffect,useId:()=>useRef('queue-id').current},'lucide-react':{ChevronRightIcon:'chevron'},'@dnd-kit/react':{DragDropProvider:'queue-provider'},'@dnd-kit/react/sortable':{isSortable:()=>false},'@dnd-kit/abstract/modifiers':{RestrictToVerticalAxis:{}},'./vendor/assistant-ui/message-queue':{MessageQueue:'queue-rows'},'./queue-operations':{queuePost:queueRead},'./homer-message-queue.css':{}};
   Function('require','exports','window',js)(id=>id in modules?modules[id]:require(id),queueModule,queueEvents);
  }
  const Queue=queueModule.HomerMessageQueue;
  function render(){previousAttachments=undefined;let count=0;do{assert.ok(count++<15,'hook effects settle');dirty=false;cursor=0;tree=MainComposer(props);if(Queue)tree=[tree,Queue({state,connected:props.connected,operations:{locked:false,run:()=>assert.fail('display cannot write queue data')}})];while(effects.length)effects.shift()();}while(dirty);return tree;}
  const find=predicate=>{render();const result=nodes(tree).find(predicate);assert.ok(result,'expected production control');return result;};
  const button=label=>find(node=>node.type==='button'&&(node.props['aria-label']===label||node.props.children===label));
  const editor=()=>find(node=>node.type==='editor');
  const form=()=>find(node=>node.type==='form');
  render();return {state,props,runtime,cache,calls,sends,revoked,annotationDraft,capture(result){assert.ok(captureScope);captureResult(captureScope,result);render();},refreshQueue:()=>queueEvents.dispatchEvent(new Event('homer-queue-updated')),preview:()=>preview,remove:name=>composer.attachment({id:runtime.attachments.find(a=>a.name===name).id}).remove(),render,find,button,editor,form,get stops(){return stops;},get focuses(){return focuses;},close(){for(const hook of hooks)hook?.cleanup?.();}};
}
function submit(f){f.form().props.onSubmit({preventDefault(){}});f.render();}
const asset={assetId:'asset-synthetic',revision:1,filename:'image.png',size:24,state:'ready',kind:'image'};

const screenshotAsset={...asset,assetId:'asset-00000000-0000-4000-8000-000000000004',filename:'窗口截图.png',mime:'image/png'};
const screenshotResult={kind:'image',width:10,height:10,png:new Uint8Array([1,2,3])};
const screenshotNote={id:'area',region:{x:1,y:1,width:5,height:5},comment:'解释错误'};
const ok=value=>({ok:true,json:async()=>value});
const captureHandoff=(action='send')=>({...screenshotResult,draft:{id:'floating-capture',action,annotations:[screenshotNote]}});

for(const action of ['add','send'])test('screenshot handoff '+action+' prepares exactly one attachment in the current draft',async()=>{
 const ui=fixture({capture:true,text:'原草稿',staleAttachmentSnapshot:true,request:async path=>{assert.equal(path,'/api/uploads');return ok(screenshotAsset);}});
 try{
  ui.capture(captureHandoff(action));await tick();ui.render();
  const image={assetId:screenshotAsset.assetId,revision:1};
  assert.equal(ui.calls.length,1);
  assert.equal(ui.sends.length,action==='send'?1:0);
  if(action==='add'){
   assert.equal(ui.runtime.text,'原草稿');
   assert.equal(ui.runtime.attachments.length,1);
   assert.deepEqual(references.referencesOf(ui.annotationDraft.read())[0].annotations,[screenshotNote]);
  }else{
   const [[input]]=ui.sends;
   assert.equal(input.text,'原草稿');
   assert.deepEqual(input.attachments,[image]);
   assert.deepEqual(input.resourceReferences[0].annotations,[screenshotNote]);
   assert.deepEqual(ui.cache.get('homer-unconfirmed:'+ui.state.threadId)[0].input,input);
   assert.equal(ui.runtime.attachments.length,0);
  }
 }finally{ui.close();}
});

test('screenshot handoff keeps newer draft text for review when direct send is waiting on an upload',async()=>{
 const upload=deferred(),ui=fixture({capture:true,request:()=>upload.promise});
 try{
  ui.capture(captureHandoff());await tick();
  ui.runtime.text='新编辑';ui.render();
  upload.resolve(ok(screenshotAsset));await tick();ui.render();
  assert.equal(ui.sends.length,0);
  assert.equal(ui.runtime.text,'新编辑');
  assert.equal(ui.runtime.attachments.length,1);
  assert.deepEqual(references.referencesOf(ui.annotationDraft.read())[0].annotations,[screenshotNote]);
 }finally{ui.close();}
});

test('screenshot handoff cannot upload after the host rejects its ownership',async()=>{
 const ui=fixture({capture:true,acceptCapture:async()=>false});
 try{
  ui.capture(captureHandoff());await tick();ui.render();
  assert.equal(ui.calls.length,0);
  assert.equal(ui.sends.length,0);
  assert.equal(ui.runtime.attachments.length,0);
 }finally{ui.close();}
});

test('screenshot handoff preserves the notes and upload identity after an unconfirmed upload',async()=>{
 let attempts=0;
 const ui=fixture({capture:true,request:async()=>{if(++attempts===1)throw Error('synthetic_upload_lost');return ok(screenshotAsset);}});
 try{
  ui.capture(captureHandoff());await tick();ui.render();
  const dialog=ui.find(n=>n.type==='screenshot-dialog').props;
  assert.deepEqual(dialog.annotations,[screenshotNote]);
  assert.equal(ui.sends.length,0);
  await dialog.onDone(dialog.annotations);ui.render();
  assert.equal(ui.calls[0].headers['X-Homer-Upload'],ui.calls[1].headers['X-Homer-Upload']);
  assert.equal(ui.runtime.attachments.length,1);
  assert.equal(ui.sends.length,0);
 }finally{ui.close();}
});

test('captured image is added once with a lagging composer client and reopens from its attachment',async()=>{
 const ui=fixture({capture:true,staleAttachmentSnapshot:true,request:async path=>{assert.equal(path,'/api/uploads');return ok(screenshotAsset);}});
 try{
  ui.capture(screenshotResult);assert.equal(ui.runtime.attachments.length,0);assert.equal(ui.calls.length,0);
  const dialog=ui.find(n=>n.type==='screenshot-dialog').props;
  assert.equal('ocrText' in dialog,false);
  await dialog.onDone([screenshotNote]);ui.render();
  const [attachment]=ui.runtime.attachments;
  assert.equal(ui.runtime.attachments.length,1);assert.equal(ui.calls.length,1);
  const [ref]=references.referencesOf(ui.annotationDraft.read());
  assert.deepEqual(ref.image,{assetId:screenshotAsset.assetId,revision:1});
  assert.deepEqual(ref.annotations,[screenshotNote]);
  ui.find(n=>n.type==='attachment').props.edit();
  await ui.find(n=>n.type==='screenshot-dialog').props.onDone([]);ui.render();
  assert.deepEqual(ui.runtime.attachments,[attachment]);
  assert.deepEqual(references.referencesOf(ui.annotationDraft.read()),[]);
  assert.equal(ui.calls.length,1);
 }finally{ui.close();}
});

test('screenshot AX follows its attachment through edits and can be removed without another upload',async()=>{
 const ax=[{role:'AXStaticText',value:'Synthetic E101'}];
 const ui=fixture({capture:true,request:async path=>{assert.equal(path,'/api/uploads');return ok(screenshotAsset);}});
 try{
  ui.capture({...screenshotResult,ax});
  const dialog=()=>ui.find(n=>n.type==='screenshot-dialog').props;
  assert.deepEqual(dialog().ax,ax);
  await dialog().onDone([screenshotNote],ax);ui.render();
  const [ref]=references.referencesOf(ui.annotationDraft.read());
  assert.deepEqual(ref.ax,ax);
  ui.annotationDraft.remove(references.referenceKey(ref),screenshotNote.id);ui.render();
  assert.deepEqual(references.referencesOf(ui.annotationDraft.read()),[{...ref,annotations:[]}]);
  ui.find(n=>n.type==='attachment').props.edit();
  assert.deepEqual(dialog().ax,ax);
  await dialog().onDone([],undefined);ui.render();
  assert.deepEqual(references.referencesOf(ui.annotationDraft.read()),[]);
  assert.equal(ui.runtime.attachments.length,1);assert.equal(ui.calls.length,1);
 }finally{ui.close();}
});

test('cancelling a delayed screenshot only discards a confirmed upload and reuses the original identity after uncertainty',async()=>{
 const delayed=deferred();let uploads=0;
 const ui=fixture({capture:true,request:async path=>path==='/api/uploads'?++uploads===1?delayed.promise:ok(screenshotAsset):ok({state:'removed'})});
 try{
  ui.capture(screenshotResult);
  const dialog=ui.find(n=>n.type==='screenshot-dialog').props;
  const finishing=dialog.onDone([screenshotNote]);await tick();
  await dialog.onCancel();assert.equal(ui.runtime.attachments.length,0);
  assert.deepEqual(ui.calls.map(call=>call.path),['/api/uploads']);
  delayed.reject(Error('connection lost'));
  await assert.rejects(finishing,/暂存结果待确认/);
  assert.deepEqual(ui.calls.map(call=>call.path),['/api/uploads']);
  await dialog.onDone([]);ui.render();
  assert.equal(ui.calls[0].headers['X-Homer-Upload'],ui.calls[1].headers['X-Homer-Upload']);
  assert.equal(JSON.parse(ui.calls[2].body).assetId,screenshotAsset.assetId);
  assert.equal(ui.runtime.attachments.length,0);assert.deepEqual(references.referencesOf(ui.annotationDraft.read()),[]);
 }finally{ui.close();}
});

for(const edited of [false,true])test('late screenshot rejection with unchanged history '+(edited?'keeps newer draft':'restores original draft'),async()=>{
 let receipt='gateway_stored';
 const ui=fixture({capture:true,request:async(path,options)=>{
  if(path==='/api/uploads')return ok(screenshotAsset);
  const {requestIds}=JSON.parse(options.body);
  return ok({acceptedRequestIds:receipt==='accepted'?requestIds:[],statuses:requestIds.map(requestId=>({requestId,state:receipt,error:'preview_source_mismatch'}))});
 }});
 try{
  ui.state.history={page:{revision:1}};ui.render();
  ui.capture(screenshotResult);await ui.find(n=>n.type==='screenshot-dialog').props.onDone([screenshotNote]);ui.render();
  submit(ui);await tick();ui.render();
  assert.equal(ui.sends.length,1);assert.equal(ui.runtime.attachments.length,0);
  assert.deepEqual(ui.sends[0][0].attachments,[{assetId:screenshotAsset.assetId,revision:1}]);
  assert.deepEqual(ui.sends[0][0].resourceReferences[0].annotations,[screenshotNote]);
  if(edited){ui.runtime.text='new work';ui.render();}
  receipt='rejected';ui.props.state={...ui.state};ui.render();await tick();ui.render();await tick();
  assert.equal(ui.runtime.text,edited?'new work':'draft');
  assert.equal(ui.runtime.attachments.length,edited?0:1);
  assert.deepEqual(references.referencesOf(ui.annotationDraft.read())[0]?.annotations,edited?undefined:[screenshotNote]);
  assert.equal(ui.sends.length,1);
  const receiptReads=()=>ui.calls.filter(call=>call.path==='/api/history/receipts').length;
  const settledReads=receiptReads();
  for(let i=0;i<20;i++){ui.props.state={...ui.props.state};ui.render();await tick();}
  assert.equal(receiptReads(),settledReads,'state updates must not poll an already handled rejection');
  if(!edited){
   receipt='accepted';ui.runtime.text='reviewed screenshot';submit(ui);await tick();ui.render();
   assert.equal(ui.sends.length,2);
   assert.equal(ui.sends[1][0].requestId,ui.sends[0][0].requestId);
   assert.equal(ui.cache.has('homer-unconfirmed:'+ui.state.threadId),false);
  }
 }finally{ui.close();}
});

test('a lost screenshot send response checks the receipt without a new state event or another send',async()=>{
 const response=deferred(),sends=[];
 const ui=fixture({capture:true,request:async(path,options)=>path==='/api/uploads'?ok(screenshotAsset):
  ok({acceptedRequestIds:JSON.parse(options.body).requestIds,statuses:[]})});
 try{
  ui.state.history={page:{revision:1}};ui.render();
  ui.capture(screenshotResult);await ui.find(n=>n.type==='screenshot-dialog').props.onDone([screenshotNote]);ui.render();
  ui.props.onSend=input=>{sends.push(input);return response.promise;};
  submit(ui);await tick();
  assert.equal(ui.calls.filter(call=>call.path==='/api/history/receipts').length,0);
  response.reject(Error('connection lost'));await tick();ui.render();
  const receipt=ui.calls.filter(call=>call.path==='/api/history/receipts');
  assert.deepEqual(receipt.map(call=>JSON.parse(call.body).requestIds),[[sends[0].requestId]]);
  assert.equal(sends.length,1);
  assert.equal(ui.cache.has('homer-unconfirmed:'+ui.state.threadId),false);
 }finally{ui.close();}
});

for(const count of [0,1,81])for(const behavior of ['inspect','ignore'])test('composer sends one current request without replaying historical receipts: '+count+' '+behavior,async()=>{
 const f=await recoveryFixture(count);let ui;
 try{
  f.behavior=behavior;const bridge=homerWebBridge(f.app),ids=f.originals.map(item=>item.id);let reads=0;
  const receipts=()=>f.app.store.db.prepare('SELECT * FROM agent_receipts WHERE messageId IN (SELECT value FROM json_each(?)) ORDER BY messageId').all(JSON.stringify(ids));
  const original=receipts(),runs=f.app.store.db.prepare('SELECT * FROM runs ORDER BY id').all();
  const text=count&&behavior==='inspect'?'inspect '+ids[0]:'Handle my current request';
  ui=fixture({text,running:false,queueRead:async(path,input)=>{reads++;assert.equal(path,'/api/history/queue');return bridge.history.dispatchQueue(input);}});
  Object.assign(ui.state,await bridge.history.state());ui.render();await tick();ui.render();
  assert.equal(ui.editor().props.disabled,false,'old receipts cannot disable the new user input');
  assert.equal(ui.editor().props.placeholder,count?'发送消息，说明如何继续…':'说说你想办的事…');
  if(count){assert.equal(ui.find(n=>n.props?.className==='queue-toggle').props['aria-expanded'],false);assert.deepEqual(ui.find(n=>n.type==='queue-rows').props.messages.map(item=>item.id),ids.slice(0,80));}
  else assert.equal(nodes(ui.render()).some(n=>n.props?.className==='queue-toggle'),false);
  let sent;ui.props.onSend=async input=>{sent=input;f.app.submitMessage(input);};submit(ui);await tick();await f.app.idle();
  assert.ok(sent,'the production composer sends a real user input');assert.equal(f.turns.length,1);assert.equal(f.turns[0].requestId,sent.requestId);
  assert.deepEqual(f.calls.map(call=>call.tool),count&&behavior==='inspect'?['work_inspect','worker_read']:[]);
  assert.deepEqual(receipts(),original,'original unknown receipts are preserved, without a manual ACK');assert.deepEqual(f.app.store.db.prepare('SELECT * FROM runs ORDER BY id').all(),runs,'reading history launches no new execution');
  Object.assign(ui.state,await bridge.history.state());ui.refreshQueue();await tick();ui.render();await tick();
  assert.equal(ui.editor().props.disabled,false);assert.ok(ui.state.messages.some(message=>message.text.includes('Synthetic user requirement handled')));
  if(count)assert.equal(ui.find(n=>n.props?.className==='queue-toggle').props['aria-expanded'],false);
  assert.ok(reads<=6,'history size cannot create a read or model turn per receipt');
  await f.reopen();assert.equal(f.turns.length,1,'restart cannot replay the old receipts');
 }finally{ui?.close();await f.close();}
});

for(const scenario of ['paused','ready','unowned','active','recoverable'])test('real Worker receipt drives collapsed queue and continuation placeholder: '+scenario,async()=>{
 const f=historyFixture(0);let ui;
 try{
  f.inputs.accept({requestId:'source',text:'Synthetic authority'});
  const source=f.inputs.claim();f.inputs.finish(source.messageId,source.revision,'completed');
  const agentId=f.store.meta('mainAgentId');
  const actor={agentId,threadId:'synthetic-history',sourceRequestId:'source'};
  const task=f.tasks.createTask(actor,{operationId:'task',goal:'Synthetic work',authority:{sourceRequestId:'source',description:'Synthetic work only',materials:[],resultIds:[]}});
  const worker=f.tasks.workerOpen(actor,{operationId:'worker',taskId:task.taskId,text:'Synthetic work'});
  const run=f.tasks.claim(worker.runId);f.tasks.bind(run.id,run.epoch,'worker-thread','worker-turn');
  const notice=f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic report'},true);
  if(scenario==='unowned'||scenario==='active'||scenario==='recoverable'){
   const claimed=f.inputs.claim([],'all');assert.equal(claimed.messageId,notice.messageId);
   f.inputs.uncertain(claimed.messageId,claimed.revision);
   if(scenario!=='unowned'){
    f.processes.start({id:'old-process',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[notice.messageId],messageId:'old-process'},'old-turn');
    f.processes.finish('old-process','unknown',scenario==='recoverable'?'host:restart:engine_closed':undefined);
   }
  }
  const cutoff=Number(f.store.db.prepare('SELECT max(seq) n FROM agent_messages').get().n);
  const inputs=new MainInputs(f.tasks,f.history,undefined,undefined,{pausedThroughSeq:cutoff});
  if(scenario==='ready')inputs.resumeWorkerMessages(cutoff+1);
  const reader=new WebHistoryPages(f.history,f.processes,inputs),host=Object.create(Homer.prototype);
  Object.assign(host,{...f,inputs,webReadEpoch:'synthetic-epoch',registerWebSurface(){},webHistoryPages:()=>reader,onStateChange(){return()=>{};},media:{view(){throw Error('unexpected_media');}},conversationControlState:()=>({isRunning:false,activeMessageId:null})});
  const bridge=homerWebBridge(host),awaiting=scenario==='paused'||scenario==='recoverable';
  const receipts=()=>f.store.db.prepare('SELECT * FROM agent_receipts ORDER BY messageId').all();
  const originalReceipts=receipts(),originalCount=f.store.db.prepare('SELECT count(*) n FROM agent_messages').get().n;
  const open=async()=>{
   const next=fixture({text:'',running:false,queueRead:async(path,input)=>{assert.equal(path,'/api/history/queue');return bridge.history.dispatchQueue(input);}});
   Object.assign(next.state,await bridge.history.state());next.render();await tick();next.render();return next;
  };
  ui=await open();
  const toggle=()=>ui.find(n=>n.props?.className==='queue-toggle');
  assert.equal(ui.editor().props.disabled,false,'old Worker receipts cannot disable input');
  assert.equal(!!ui.state.queueDispatch.awaitingUser,awaiting);
  assert.equal(ui.editor().props.placeholder,awaiting?'发送消息，说明如何继续…':'说说你想办的事…');
  assert.equal(toggle().props['aria-expanded'],false);
  assert.equal(ui.find(n=>n.type==='div'&&n.props.id==='queue-id').props.hidden,true);
  const items=ui.find(n=>n.type==='queue-rows').props.messages;
  assert.deepEqual(items.map(item=>item.id),[notice.messageId]);
  toggle().props.onClick();assert.equal(toggle().props['aria-expanded'],true);
  Object.assign(ui.state,await bridge.history.state());ui.refreshQueue();await tick();ui.render();await tick();
  assert.equal(toggle().props['aria-expanded'],true,'background refresh preserves manual expansion');
  toggle().props.onClick();ui.refreshQueue();ui.render();await tick();
  assert.equal(toggle().props['aria-expanded'],false,'background refresh preserves manual collapse');
  toggle().props.onClick();
  ui.close();ui=await open();assert.equal(toggle().props['aria-expanded'],false,'reopening resets expansion');
  assert.deepEqual(receipts(),originalReceipts,'loading and rendering never changes a receipt');
  if(scenario==='recoverable'){
   ui.props.connected=false;assert.equal(ui.editor().props.placeholder,'连接恢复后继续发送，草稿会保留');
   ui.props.connected=true;ui.preview().appendQuote({messageId:'source',text:'Synthetic quotation'});
   assert.equal(ui.editor().props.placeholder,'说说你对这段原文的要求…');
   const question={id:'recovery-question',question:'Synthetic question?',kind:'question'};
   ui.state.interactions=[question];ui.props.answerTarget=question;
   assert.equal(ui.editor().props.placeholder,'回答上面的问题…');
   ui.props.connected=false;assert.equal(ui.editor().props.placeholder,'回答上面的问题…');
   ui.props.connected=true;ui.button('退出答复').props.onClick();ui.state.interactions=[];
   ui.button('删除引用 1').props.onClick();
   inputs.resumeWorkerMessages(cutoff+1);Object.assign(ui.state,await bridge.history.state());
   assert.equal(ui.editor().props.placeholder,'发送消息，说明如何继续…','resuming pending work does not hide unresolved history');
   assert.equal(inputs.runnableHead('all'),undefined,'uncertain history is never offered again');
   assert.deepEqual(receipts(),originalReceipts,'ordinary rendering cannot consume uncertain history');
  }
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM agent_messages').get().n,originalCount,'no messages are resent');
  assert.equal(ui.sends.length,0);assert.deepEqual(ui.calls,[]);
 }finally{ui?.close();f.close();}
});

test('ordinary whole-message quotes append to the main draft with stable IDs and delete only the chosen entry',()=>{
 const original={messageId:'source',text:'full source',annotation:''};
 const f=fixture({draft:{text:'keep text',quotes:[original],requestId:'quote-owner'}});
 f.preview().appendQuote({messageId:'replacement',text:'replacement source'});f.render();
 assert.deepEqual(draftQuotesOf(f).map(({draftId,...q})=>q),[original,{messageId:'replacement',text:'replacement source',annotation:''}]);
 f.button('删除引用 1').props.onClick();f.render();assert.equal(draftQuotesOf(f).length,1);
 f.button('删除引用 1').props.onClick();f.render();assert.deepEqual(draftQuotesOf(f),[]);
 assert.equal(f.runtime.text,'keep text');f.close();
});

test('retired queue editor restores ordinary original without exposing or rewriting the archive',()=>{
 const original={text:'ordinary original',quotes:[{messageId:'s',text:'original quote',annotation:''}]};
 const queueEditor={item:{input:{requestId:'queued',text:'old edit'}},text:'old edit',quotes:[],attachments:[],original};
 const f=fixture({queueEditor});
 assert.equal(f.runtime.text,original.text);assert.deepEqual(draftQuotesOf(f).map(({draftId,...q})=>q),original.quotes);
 assert.deepEqual(f.cache.get('homer-queue-editor:'+f.state.threadId),queueEditor);
 assert.equal(nodes(f.render()).some(n=>n.type==='legacy-panel'),false);assert.equal(f.sends.length,0);f.close();
});
test('ordinary draft takes priority and legacy multi quote original restores structurally without altering archive',()=>{
 const original={text:'old ordinary draft',quotes:[{messageId:'a',text:'old first',annotation:'old note'},{messageId:'b',text:'old second',annotation:''}]};
 const queueEditor={item:{input:{requestId:'queued-restored',text:'queued text'}},text:'queued text',quotes:[],attachments:[],original};
 const f=fixture({queueEditor});
 assert.equal(f.runtime.text,'old ordinary draft');assert.deepEqual(draftQuotesOf(f).map(({draftId,...q})=>q),original.quotes);
 assert.equal(f.runtime.quote,undefined);assert.deepEqual(f.cache.get('homer-queue-editor:'+f.state.threadId),queueEditor);f.close();
 const g=fixture({draft:{text:'new ordinary draft',quotes:[]},queueEditor});assert.equal(g.runtime.text,'new ordinary draft');assert.deepEqual(g.cache.get('homer-queue-editor:'+g.state.threadId),queueEditor);g.close();
});

test('production send retains exact pending snapshot with no manual entry and acceptance cannot erase newer draft',async()=>{
  const f=fixture({draft:{text:'full draft',quotes:[{messageId:'source',text:'original\nquote',annotation:''}],requestId:'original-request',attachments:[asset]}});
  await tick();f.render();submit(f);await tick();
  assert.equal(f.sends.length,1);assert.equal(f.sends[0][1],undefined);
  assert.deepEqual(f.sends[0][0],{requestId:'original-request',text:'full draft',quotes:[{messageId:'source',text:'original\nquote',annotation:''}],attachments:[{assetId:asset.assetId,revision:1}]});
  f.runtime.text='next draft';f.render();await tick();
  assert.equal(f.sends.length,1);assert.deepEqual(f.cache.get('homer-unconfirmed:'+f.state.threadId)[0].input,f.sends[0][0]);
  assert.equal(nodes(f.render()).some(n=>n.props?.children==='核对并重试'||n.props?.className==='unconfirmed-inputs'||n.props?.className==='composer-run-line'),false);
  f.state.acceptedRequestIds=['another-id'];f.render();assert.equal(f.cache.get('homer-unconfirmed:'+f.state.threadId).length,1);
  f.state.acceptedRequestIds=['original-request'];f.render();assert.equal(f.cache.has('homer-unconfirmed:'+f.state.threadId),false);assert.equal(f.runtime.text,'next draft');f.close();
});

test('consecutive queued sends clear long text, quote and attachments while retaining separate immutable requests',async()=>{
  const text='long draft\n'.repeat(30),quote={messageId:'source',text:'full original quote',annotation:''};
  const f=fixture({running:true,draft:{text,quotes:[quote],requestId:'first-queued',attachments:[asset]}});
  await tick();f.render();submit(f);await tick();
  f.runtime.text='second queued draft';submit(f);await tick();f.render();
  assert.equal(f.sends.length,2);
  assert.equal(f.sends[0][0].text,text);
  assert.deepEqual(f.sends[0][0].quotes,[{messageId:'source',text:'full original quote',annotation:''}]);
  assert.deepEqual(f.sends[0][0].attachments,[{assetId:asset.assetId,revision:1}]);
  assert.equal(f.sends[1][0].text,'second queued draft');
  assert.notEqual(f.sends[1][0].requestId,f.sends[0][0].requestId);
  assert.equal(f.sends[1][0].quote,undefined);assert.equal(f.sends[1][0].attachments,undefined);
  assert.equal(f.runtime.text,'');assert.deepEqual(f.runtime.attachments,[]);
  assert.deepEqual(f.cache.get('homer-unconfirmed:'+f.state.threadId).map(item=>item.input),f.sends.map(([input])=>input));
  assert.equal(f.focuses,2);f.close();
});

test('production stop is independent of draft, quote, attachments, queued and unconfirmed input',async()=>{
  const old={input:{requestId:'unconfirmed',text:'old'}};
  const f=fixture({draft:{text:'keep me',quotes:[{messageId:'source',text:'quote',annotation:''}],attachments:[asset]},pending:[old]});
  await tick();f.render();f.state.queue=[{input:{requestId:'queued',text:'queued'},state:'queued'}];
  const before=structuredClone([...f.cache]);f.button('停止回复').props.onClick();f.render();
  assert.equal(f.stops,1);assert.equal(f.sends.length,0);assert.equal(f.runtime.text,'keep me');assert.deepEqual([...f.cache],before);assert.equal(f.state.queue[0].state,'queued');
  f.props.stopping='active';assert.equal(f.button('停止回复').props.disabled,true);f.close();
});

test('production submit guards empty/quote only, upload busy, uncertain upload and acceptance fence',async()=>{
  const f=fixture({text:'   ',draft:{text:' ',quotes:[{messageId:'s',text:'source',annotation:''}]}});
  submit(f);assert.equal(f.sends.length,0);f.runtime.text='new';f.props.connected=false;submit(f);assert.equal(f.sends.length,0);f.close();
  const gate=deferred();const g=fixture({request:()=>gate.promise});
  const upload=g.editor().props.onFiles([new File(['x'],'note.txt')]);g.render();submit(g);assert.equal(g.sends.length,0);
  gate.reject(Error('uncertain'));await upload;await tick();g.render();submit(g);assert.equal(g.sends.length,0);g.close();
});

test('production sequential partial upload retries original upload ID, removes only after discard receipt and retains ownership until receipt',async()=>{
  const discard=deferred();let uploadCount=0;
  const f=fixture({text:'',request:(path,options)=>{
    if(path.endsWith('/discard'))return discard.promise;
    uploadCount++;if(uploadCount===2)throw Error('unknown receipt');
    return {ok:true,json:async()=>({...asset,assetId:uploadCount===1?'image':'note',filename:decodeURIComponent(options.headers['X-Homer-Filename'])})};
  }});
  f.editor().props.onFiles([new File(['image'],'image.png',{type:'image/png'}),new File(['note'],'note.txt')]);await tick();f.render();
  assert.equal(uploadCount,2);assert.equal(f.runtime.attachments.filter(attachmentAsset).length,1);const original=f.calls[1].headers['X-Homer-Upload'];
  f.button('重试上传').props.onClick();await tick();f.render();assert.equal(f.calls[2].headers['X-Homer-Upload'],original);
  assert.equal(f.calls[0].headers['X-Homer-Request'],f.calls[2].headers['X-Homer-Request']);
  const removing=f.remove('image.png');f.render();assert.equal(f.runtime.attachments.some(a=>a.name==='image.png'),true);
  discard.resolve({ok:true,json:async()=>({})});await removing;await tick();f.render();assert.equal(f.runtime.attachments.some(a=>a.name==='image.png'),false); // Object URL lifetime is covered by the real browser row test.
  submit(f);assert.deepEqual(f.sends[0][0].attachments,[{assetId:'note',revision:1}]);f.close();
});

test('production uncertain-upload discard keeps failed files until acknowledged and validates file limits',async()=>{
  let removing=false;const gate=deferred();const f=fixture({request:path=>{if(path.endsWith('/discard')){removing=true;return gate.promise;}throw Error('lost');}});
  f.editor().props.onFiles([new File(['x'],'note.txt')]);await tick();f.render();f.button('不添加这些附件').props.onClick();f.render();assert.equal(removing,true);assert.ok(f.button('重试上传'));
  gate.resolve({ok:true,json:async()=>({})});await tick();f.render();assert.equal(nodes(f.render()).some(n=>n.props?.children==='重试上传'),false);
  const count=f.calls.length;
  for(const files of [[new File([],'empty')],[new File(['x'],'../bad')],Array.from({length:11},()=>new File(['x'],'note')), [new File([new Uint8Array(8*1024*1024+1)],'large')]]){f.editor().props.onFiles(files);await tick();f.render();}
  assert.equal(f.calls.length,count);f.close();
});

test('production container drop consumes files once, respects editor consumption and exposes running send semantics',async()=>{
  const gate=deferred();const f=fixture({request:()=>gate.promise});
  assert.ok(f.form().props.onDrop,'container blank space accepts drop');
  const file=new File(['x'],'note.txt'),event={defaultPrevented:false,dataTransfer:{types:['Files'],files:[file]},preventDefault(){this.defaultPrevented=true;}};
  f.form().props.onDrop(event);assert.equal(event.defaultPrevented,true);await tick();assert.equal(f.calls.length,1);
  f.form().props.onDrop(event);assert.equal(f.calls.length,1);
  const consumed={...event,defaultPrevented:true};f.form().props.onDrop(consumed);assert.equal(f.calls.length,1);
  assert.equal(f.button('排队发送').props.disabled,true);
  gate.resolve({ok:true,json:async()=>asset});await tick();f.render();assert.equal(f.button('排队发送').props.disabled,false);f.close();
});

test('production acceptance during upgrade keeps text enabled but fences attachment entry',()=>{
  const f=fixture({upgrade:{phase:'preparing',accepting:true}});assert.equal(f.editor().props.disabled,false);
  assert.equal(f.button('添加附件').props.disabled,true);submit(f);assert.equal(f.sends.length,1);f.close();
});

test('production quote removal restores editor focus without changing text; successful send restores focus too',()=>{
  const f=fixture({draft:{text:'keep text',quotes:[{messageId:'s',text:'full source',annotation:''}]}});
  f.button('删除引用 1').props.onClick();
  f.render();assert.equal(f.focuses,1);assert.equal(f.runtime.text,'keep text');
  submit(f);assert.equal(f.focuses,2);assert.equal(f.sends.length,1);assert.equal(f.sends[0][0].quote,undefined);f.close();
});

test('Lexical focus registers only for the mounted editor, skips scrolling, respects disabled input and cleans up',()=>{
 const focus={current:null},calls=[];let cleanup,editable=true;
 const editor={isEditable:()=>editable,update(fn,options){calls.push(options);fn();},focus(){calls.push('focus');}};
 const plugin=productionFunction(new URL('../ui/homer-composer-input.tsx',import.meta.url),'HomerFocusPlugin',{
  useLexicalComposerContext:()=>[editor],useContext:()=>focus,ComposerInputFocusContext:{},useLayoutEffect:fn=>{cleanup=fn();},
  $addUpdateTag:tag=>calls.push(tag),SKIP_SCROLL_INTO_VIEW_TAG:'skip-scroll-into-view',
 });
 plugin();assert.deepEqual(calls,[],'mounting or restoring quote state never requests focus');
 focus.current();assert.deepEqual(calls,[{discrete:true},'skip-scroll-into-view','focus']);
 editable=false;focus.current();assert.equal(calls.length,3);
 cleanup();assert.equal(focus.current,null);
});

test('production Lexical commands preserve IME, modified Enter, mixed clipboard text and consumed drop',()=>{
  const commands=new Map();let submissions=0,files=0,inserted='',composing=false;
  const editor={setEditable(){},isComposing:()=>composing,getRootElement:()=>({closest:()=>({requestSubmit(){submissions++;}})}),registerCommand:(name,callback)=>{commands.set(name,callback);return ()=>{};}};
  const bindings={useLexicalComposerContext:()=>[editor],useAuiState:()=>false,useEffect:fn=>fn(),mergeRegister:()=>()=>{},KEY_DOWN_COMMAND:'key',PASTE_COMMAND:'paste',DROP_COMMAND:'drop',COMMAND_PRIORITY_CRITICAL:4,$getSelection:()=>({insertRawText:text=>{inserted=text;}}),ClipboardEvent:class ClipboardEvent{}};
  const plugin=productionFunction(new URL('../ui/homer-composer-input.tsx',import.meta.url),'HomerInputPlugin',bindings);
  plugin({onFiles(){files++;}});
  const key=extra=>({key:'Enter',shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,keyCode:13,isComposing:false,preventDefault(){this.defaultPrevented=true;},...extra});
  for(const flags of [{isComposing:true},{keyCode:229},{shiftKey:true},{ctrlKey:true},{metaKey:true},{altKey:true}])commands.get('key')(key(flags));
  composing=true;commands.get('key')(key());composing=false;assert.equal(submissions,0);
  commands.get('key')(key());assert.equal(submissions,1);
  const event=new bindings.ClipboardEvent();Object.assign(event,{clipboardData:{files:[new File(['x'],'note')],getData:()=> 'clipboard text'},preventDefault(){this.defaultPrevented=true;}});
  commands.get('paste')(event);assert.equal(inserted,'clipboard text');assert.equal(files,1);
  commands.get('drop')({defaultPrevented:true});assert.equal(files,1);
  plugin({disabled:true,onFiles(){files++;}});commands.get('paste')(event);commands.get('key')(key());assert.equal(files,1);assert.equal(submissions,1);
});

test('answer pending and invalid question remain blocked; exit restores ordinary draft with no upper status',async()=>{
 const f=fixture({draft:{text:'ordinary',quotes:[]}});await tick();f.render();
 const item={id:'question',question:'What next?',kind:'question'};f.state.interactions=[item];f.props.answerTarget=item;f.render();f.runtime.text='answer';f.render();
 f.cache.set('homer-interaction:'+f.state.threadId+':question:pending',{requestId:'answer-old',text:'answer'});
 assert.equal(f.button('提交答复').props.disabled,true);submit(f);assert.equal(f.sends.length,0);
 const tree=f.render(),form=nodes(tree).findIndex(n=>n.type==='form');
 assert.equal(nodes(tree).slice(0,form).some(n=>n.props?.role==='status'),false);
 f.cache.delete('homer-interaction:'+f.state.threadId+':question:pending');f.state.interactions=[];f.render();assert.equal(f.button('提交答复').props.disabled,true);submit(f);assert.equal(f.sends.length,0);
 f.button('退出答复').props.onClick();f.render();assert.equal(f.runtime.text,'ordinary');assert.equal(f.props.answerTarget,undefined);f.close();
});
test('automatic receipt lookup removes only exact accepted request and preserves later draft',async()=>{
 const old={input:{requestId:'old-request',text:'old immutable'}};let lookups=0;
 const f=fixture({pending:[old],draft:{text:'new draft',quotes:[]},request:async()=>({ok:true,json:async()=>({statuses:[{requestId:'old-request',state:'unconfirmed'}],acceptedRequestIds:++lookups===1?['unrelated']:['old-request']})})});
 f.state.history={page:{revision:1}};f.render();await tick();f.render();assert.deepEqual(f.cache.get('homer-unconfirmed:'+f.state.threadId),[old]);
 f.props.connected=false;f.render();f.props.connected=true;f.state.history.page.revision=2;f.render();await tick();f.render();assert.equal(f.sends.length,0);assert.equal(f.cache.has('homer-unconfirmed:'+f.state.threadId),false);
 assert.equal(f.runtime.text,'new draft');assert.ok(f.calls.some(c=>c.path==='/api/history/receipts'));f.close();
});

const textReference={kind:'text',source:{kind:'attachment',messageId:'message-notes',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:'a'.repeat(64),title:'notes.txt'},annotations:[{id:'n',text:'Source excerpt',comment:'My remark',anchor:{format:'preview-text-v1',representation:'plain',start:0,end:14,exact:'Source excerpt',prefix:'',suffix:''}}]};
const ordinaryQuote={messageId:'source-message',text:'Visible quote'};
test('production ordinary composer accepts both orders and selection entry; removing one owner keeps the other and body',async()=>{
 for(const first of ['resource','quote']){
  const f=fixture({text:'Body'});await tick();f.render();
  if(first==='quote')f.preview().appendQuote(ordinaryQuote);f.render();
  await f.preview().add(textReference);f.render();
  if(first==='resource'){
   const Toolbar=productionFunction(appPath,'HomerSelectionToolbar',{useComposerInputFocus:()=>()=>{},useContext:()=>f.preview(),PreviewActionsContext:{},captureSourceQuoteSelection:()=>({quote:ordinaryQuote}),document:{getElementById:()=>null},window:{getSelection:()=>({removeAllRanges(){}})},SelectionToolbar:{Root:'selection-root',Quote:'selection-quote'},MessageCirclePlus:'icon'});
   let blocked=false;Toolbar().props.onClickCapture({target:{closest:()=>true},preventDefault(){blocked=true;},stopPropagation(){blocked=true;}});
   assert.equal(blocked,true);await tick();f.render();f.find(n=>n.type==='quote-form').props.onCancel();f.render();f.preview().appendQuote(ordinaryQuote);f.render();
  }
  assert.deepEqual(f.annotationDraft.read().resourceReferences,[textReference]);assert.ok(draftQuotesOf(f).some(q=>q.messageId===ordinaryQuote.messageId));
  f.find(n=>n.type==='annotation-chips').props.onRemove(references.referenceKey(textReference),'n');f.render();
  assert.ok(draftQuotesOf(f).some(q=>q.messageId===ordinaryQuote.messageId));assert.equal(f.runtime.text,'Body');assert.equal(references.referencesOf(f.annotationDraft.read()).length,0);
  await f.preview().add(textReference);f.button('删除引用 1').props.onClick();f.render();
  assert.deepEqual(f.annotationDraft.read().resourceReferences,[textReference]);assert.equal(f.runtime.text,'Body');
  f.close();
 }
});
test('capability 1 keeps both old guards and refuses sending a restored mixed draft; capability 2 sends the same fields',async()=>{
 const f=fixture({collections:1});await tick();f.render();
 await f.preview().add(textReference);f.render();assert.equal(f.preview().canQuote(),false);
 f.annotationDraft.clear();f.preview().appendQuote(ordinaryQuote);f.render();f.render();
 await assert.rejects(f.preview().add(textReference));assert.ok(draftQuotesOf(f).some(q=>q.messageId===ordinaryQuote.messageId));f.close();
 for(const collections of [undefined,1,2]){
  const g=fixture({collections:collections??null,draft:{text:'Body',quotes:[{...ordinaryQuote,annotation:''}],resourceReferences:[textReference],requestId:'mixed'}});await tick();g.render();submit(g);
  assert.equal(g.sends.length,collections===2?1:0);
  if(collections===2){assert.deepEqual(g.sends[0][0].quotes,[{...ordinaryQuote,annotation:''}]);assert.deepEqual(g.sends[0][0].resourceReferences,[textReference]);}
  g.close();
 }
});
test('mixed pending keeps both contexts and metadata through refresh, failure, answer freeze and exact ACK',async()=>{
 const metadata={'note':{n:{selectedText:'Source excerpt'}}};
 const draft={text:'Body',quotes:[{...ordinaryQuote,annotation:''}],resourceReferences:[textReference],htmlMetadata:metadata,requestId:'mixed-owner',attachments:[asset]};
 const f=fixture({draft});await tick();f.render();
 assert.deepEqual(f.cache.get('homer-draft:'+f.state.threadId).htmlMetadata,metadata);
 const item={id:'answer-question',question:'Question?',kind:'question'};f.state.interactions=[item];f.props.answerTarget=item;f.render();
 assert.equal(f.preview().canQuote(),false);await assert.rejects(f.preview().add(textReference));
 assert.equal(f.annotationDraft.remove(references.referenceKey(textReference),'n'),false);
 f.runtime.text='Answer';f.button('退出答复').props.onClick();f.render();
 assert.equal(f.runtime.text,'Body');assert.ok(draftQuotesOf(f).some(q=>q.messageId===ordinaryQuote.messageId));assert.deepEqual(f.annotationDraft.read().resourceReferences,[textReference]);
 f.props.onSend=async(...args)=>{f.sends.push(args);throw Error('unknown ACK');};
 submit(f);await tick();f.render();const pending=f.cache.get('homer-unconfirmed:'+f.state.threadId);
 assert.equal(pending[0].input.requestId,'mixed-owner');assert.deepEqual(pending[0].input.quotes,[{...ordinaryQuote,annotation:''}]);assert.deepEqual(pending[0].input.resourceReferences,[textReference]);assert.equal(f.runtime.quote,undefined);assert.equal(references.referencesOf(f.annotationDraft.read()).length,0);
 f.runtime.text='newer';f.render();f.state.acceptedRequestIds=['unrelated'];f.render();assert.deepEqual(f.cache.get('homer-unconfirmed:'+f.state.threadId),pending);
 const refreshed=fixture({pending,draft:f.cache.get('homer-draft:'+f.state.threadId)});await tick();refreshed.render();assert.equal(refreshed.sends.length,0);assert.equal(refreshed.runtime.text,'newer');assert.deepEqual(refreshed.cache.get('homer-unconfirmed:'+refreshed.state.threadId),pending);
 const input=pending[0].input;assert.equal(client.prepareMessage(input.text,input.quotes,input,()=>assert.fail('same ID'),input.attachments,undefined,input.resourceReferences),input);
 f.state.acceptedRequestIds=['mixed-owner'];f.render();assert.equal(f.runtime.text,'newer');assert.equal(f.cache.has('homer-unconfirmed:'+f.state.threadId),false);f.close();refreshed.close();
});
test('reference save counts current quote in the full byte budget and submit checks the resulting snapshot again',async()=>{
 const f=fixture({text:'body'});await tick();f.render();
 // Under 48000 resource characters and 24000 authority; UTF-8 snapshot exceeds 96KiB only with quote.
 const large={...textReference,annotations:[{id:'big',text:'中'.repeat(16000),comment:'中'.repeat(10000)}]};
 await f.preview().add(large);f.render();f.annotationDraft.clear();f.preview().appendQuote({messageId:'q',text:'中'.repeat(8000)});f.render();
 await assert.rejects(f.preview().add(large),/96KiB/);assert.equal(references.referencesOf(f.annotationDraft.read()).length,0);
 f.annotationDraft.replace([large]);f.render();submit(f);assert.equal(f.sends.length,0);assert.ok(nodes(f.render()).some(n=>String(n.props?.children).includes('96KiB')));f.close();
});

test('image preparation reserves its original attachment in the full snapshot budget before upload',async()=>{
 const f=fixture({text:'x'.repeat(10000)});await tick();f.render();
 const large={...textReference,annotations:[{id:'big',text:'中'.repeat(16000),comment:'中'.repeat(10000)}]};
 await f.preview().add(large);f.render();
 const picture={kind:'image',source:{...textReference.source,messageId:'message-image',title:'Image.png'},width:20,height:10,annotations:[{id:'i',region:{x:1,y:1,width:2,height:2},comment:'image note'}]};
 const sentinel={...picture,image:{assetId:'asset-00000000-0000-4000-8000-000000000000',revision:1}};
 const requestId=f.cache.get('homer-draft:'+f.state.threadId).requestId;
 const empty=client.prepareMessage(f.runtime.text,{messageId:'q',text:''},undefined,()=>requestId,[],undefined,[large,sentinel]);
 const space=96*1024-Buffer.byteLength(JSON.stringify(empty))-1;
 assert.ok(space>0&&space<16000);f.runtime.quote={messageId:'q',text:'q'.repeat(space)};f.render();
 await assert.rejects(f.preview().add(picture,new File(['image'],'Image.png',{type:'image/png'})),/96KiB/);
 assert.equal(f.calls.length,0,'oversized image candidate rejected before upload');f.close();
});

test('restored message quote appends while keeping the draft and annotation owner intact',async()=>{
 const f=fixture({text:'Body'});await tick();f.render();await f.preview().add(textReference);f.render();
 const Actions=productionFunction(new URL('../ui/message-details.tsx',import.meta.url),'RuntimeMessageActions',{
  useContext:()=>f.preview(),PreviewActionsContext:{},useAuiState:fn=>fn({thread:{isDisabled:false}}),useComposerInputFocus:()=>()=>{},previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText,window:{getSelection:()=>null},useActionBarCopy:()=>({copy(){},isCopied:false}),MessageActions:'actions',MessageTimestamp:'timestamp',
 });
 const tree=Actions({message:{id:'action-source',text:'**Visible** source'},write:async()=>{},busy:false,notice:'',onNotice(){}});
 const actions=nodes(tree).find(n=>n.type==='actions');
 assert.equal(typeof actions.props.onCopy,'function');assert.equal(typeof actions.props.onQuote,'function');actions.props.onQuote();f.render();
 assert.deepEqual(draftQuotesOf(f).map(({draftId,...q})=>q),[{messageId:'action-source',text:'Visible source',annotation:''}]);assert.equal(f.runtime.text,'Body');assert.deepEqual(f.annotationDraft.read().resourceReferences,[textReference]);f.close();
});
test('late original upload cannot recreate mixed annotations after the draft epoch ends',async()=>{
 const gate=deferred(),f=fixture({request:()=>gate.promise});await tick();f.render();f.preview().appendQuote(ordinaryQuote);f.render();f.render();
 const picture={kind:'image',source:{...textReference.source,messageId:'message-late',title:'Image.png'},width:20,height:10,annotations:[{id:'i',region:{x:1,y:1,width:2,height:2},comment:'image note'}]};
 const saving=f.preview().add(picture,new File(['image'],'Image.png',{type:'image/png'}));
 f.render();assert.ok(f.annotationDraft.read().preparingImages);f.annotationDraft.clear();f.preview().appendQuote({messageId:'new',text:'new quote'});f.runtime.text='new body';f.render();
 gate.resolve({ok:true,json:async()=>({...asset,assetId:'asset-00000000-0000-4000-8000-000000000001'})});
 await assert.rejects(saving,/原草稿已经结束/);f.render();assert.equal(references.referencesOf(f.annotationDraft.read()).length,0);assert.ok(draftQuotesOf(f).some(q=>q.messageId==='new'));assert.equal(f.runtime.text,'new body');f.close();
});

test('original upload rechecks the live mixed budget before confirming Canvas-registered pending notes',async()=>{
 const gate=deferred(),f=fixture({text:'x'.repeat(10000),request:()=>gate.promise});await tick();f.render();
 const large={...textReference,annotations:[{id:'big',text:'中'.repeat(16000),comment:'中'.repeat(10000)}]};await f.preview().add(large);f.render();
 const picture={kind:'image',source:{...textReference.source,messageId:'message-race',title:'Image.png'},width:20,height:10,annotations:[{id:'i',region:{x:1,y:1,width:2,height:2},comment:'image note'}]};
 const file=new File(['image'],'Image.png',{type:'image/png'}),key=references.referenceKey(picture);f.annotationDraft.imageFile(key,file);
 const saving=f.preview().add(picture,file);f.render();
 f.runtime.text='中'.repeat(10000);f.render();
 gate.resolve({ok:true,json:async()=>({...asset,assetId:'asset-00000000-0000-4000-8000-000000000001'})});
 await assert.rejects(saving,/96KiB/);f.render();
 assert.deepEqual(f.annotationDraft.read().resourceReferences,[large]);assert.ok(f.annotationDraft.read().preparingImages[key]);assert.equal(f.runtime.text,'中'.repeat(10000));
 f.runtime.text='short';f.render();await f.preview().add(picture,file);f.render();
 assert.equal(f.annotationDraft.read().resourceReferences.length,2);assert.equal(f.calls.length,1,'confirmed original reused after budget correction');f.close();
});

const draftQuotesOf=f=>f.cache.get('homer-draft:'+f.state.threadId)?.quotes??[];
test('selection comments save without sending, duplicate positions stay independent and edits/cancel/delete preserve all other owners',async()=>{
 const f=fixture({draft:{text:'body',quotes:[],attachments:[asset],resourceReferences:[textReference]}});await tick();f.render();
 const snapshot={quote:ordinaryQuote};
 for(const comment of ['first','second']){
  f.preview().openQuote(snapshot);await tick();f.render();
  f.find(n=>n.type==='quote-form').props.onChange(comment);f.render();
  submit(f);assert.equal(f.sends.length,0,'unfinished editor blocks main submit');
  f.find(n=>n.type==='quote-form').props.onSave();f.render();
 }
 assert.equal(f.sends.length,0);assert.equal(f.runtime.text,'body');assert.equal(f.runtime.attachments.length,1);
 assert.deepEqual(f.annotationDraft.read().resourceReferences,[textReference]);
 let quotes=draftQuotesOf(f);assert.deepEqual(quotes.map(q=>q.annotation),['first','second']);assert.notEqual(quotes[0].draftId,quotes[1].draftId);
 f.button('编辑引用 1').props.onClick({currentTarget:{isConnected:false}});await tick();f.render();
 f.find(n=>n.type==='quote-form').props.onChange('cancelled');f.render();f.find(n=>n.type==='quote-form').props.onCancel();f.render();assert.equal(draftQuotesOf(f)[0].annotation,'first');
 f.button('编辑引用 1').props.onClick({currentTarget:{isConnected:false}});await tick();f.render();f.find(n=>n.type==='quote-form').props.onChange('edited');f.render();f.find(n=>n.type==='quote-form').props.onSave();f.render();
 assert.deepEqual(draftQuotesOf(f).map(q=>q.annotation),['edited','second']);
 f.button('删除引用 2').props.onClick();f.render();assert.deepEqual(draftQuotesOf(f).map(q=>q.annotation),['edited']);
 submit(f);await tick();assert.equal(f.sends.length,1);assert.equal(f.sends[0][0].quotes[0].annotation,'edited');assert.equal('draftId' in f.sends[0][0].quotes[0],false);f.close();
});
test('structured duplicate drafts reload and ordinary answer keeps them frozen until exit',async()=>{
 const draft={text:'body',quotes:[{...ordinaryQuote,annotation:'one',draftId:'a'},{...ordinaryQuote,annotation:'two',draftId:'b'}]};
 const f=fixture({draft});await tick();f.render();assert.equal(f.runtime.text,'body');assert.deepEqual(draftQuotesOf(f),draft.quotes);
 const question={id:'question',question:'Question?',kind:'question'};f.state.interactions=[question];f.props.answerTarget=question;f.render();
 assert.equal(f.preview().canQuote(),false);f.preview().openQuote({quote:ordinaryQuote});f.render();assert.equal(nodes(f.render()).some(n=>n.type==='quote-form'),false);
 f.runtime.text='answer';f.button('退出答复').props.onClick();f.render();assert.equal(f.runtime.text,'body');assert.deepEqual(draftQuotesOf(f),draft.quotes);f.close();
});

test('late quote hashing after cancel or unmount cannot append or replace a newer editor',async()=>{
 const gate=deferred();let calls=0;const f=fixture({completeQuote:value=>++calls===1?gate.promise:Promise.resolve(value.quote)});await tick();f.render();
 f.preview().openQuote({quote:ordinaryQuote});f.render();f.find(n=>n.type==='quote-form').props.onChange('old');f.render();f.find(n=>n.type==='quote-form').props.onCancel();f.render();
 f.preview().openQuote({quote:{messageId:'new',text:'new'}});f.render();
 gate.resolve({...ordinaryQuote,position:{sourceHash:'late'}});await tick();f.render();assert.equal(f.find(n=>n.type==='quote-form').props.excerpt,'new');assert.equal(draftQuotesOf(f).length,0);f.close();
 const late=deferred(),g=fixture({completeQuote:()=>late.promise});await tick();g.render();g.preview().openQuote({quote:ordinaryQuote});g.render();g.close();late.resolve(ordinaryQuote);await tick();assert.equal(draftQuotesOf(g).length,0);
});
test('quote source rejection restores all saved entries only into its own empty cleared draft',async()=>{
 const quotes=[{...ordinaryQuote,annotation:'first',draftId:'a'},{...ordinaryQuote,annotation:'second',draftId:'b'}];
 for(const newer of [false,true]){
  const gate=deferred(),f=fixture({draft:{text:'original',quotes}});await tick();f.render();f.props.onSend=()=>gate.promise;submit(f);
  if(newer){f.preview().appendQuote({messageId:'new',text:'new quote'});f.runtime.text='new body';f.render();}
  gate.reject(Error('quote_source_mismatch'));await tick();f.render();
  assert.equal(f.runtime.text,newer?'new body':'original');assert.deepEqual(draftQuotesOf(f).map(q=>q.annotation),newer?['']:['first','second']);f.close();
 }
});
test('quote count and UTF8 budget errors retain saved entries and the unsaved editor',async()=>{
 const quotes=Array.from({length:20},(_,i)=>({...ordinaryQuote,annotation:'comment '+i,draftId:'id-'+i}));
 const f=fixture({draft:{text:'body',quotes}});await tick();f.render();f.preview().openQuote({quote:ordinaryQuote});await tick();f.render();f.find(n=>n.type==='quote-form').props.onChange('twenty-first');f.render();f.find(n=>n.type==='quote-form').props.onSave();f.render();
 assert.match(f.find(n=>n.type==='quote-form').props.error,/20条/);assert.equal(draftQuotesOf(f).length,20);assert.equal(f.sends.length,0);f.close();
 const g=fixture({draft:{text:'中'.repeat(16000),quotes:[{...ordinaryQuote,text:'中'.repeat(16000),annotation:'one',draftId:'one'}]}});await tick();g.render();g.preview().openQuote({quote:ordinaryQuote});await tick();g.render();g.find(n=>n.type==='quote-form').props.onChange('中'.repeat(1000));g.render();g.find(n=>n.type==='quote-form').props.onSave();g.render();assert.match(g.find(n=>n.type==='quote-form').props.error,/96KiB/);assert.equal(draftQuotesOf(g).length,1);g.close();
});

test('quote comments share the existing combined intent budget with file annotations',async()=>{
 const f=fixture({draft:{text:'x'.repeat(10000),quotes:[{...ordinaryQuote,annotation:'q'.repeat(13000)}]}});await tick();f.render();
 const reference={...textReference,annotations:[{id:'n',text:'excerpt',comment:'r'.repeat(2000)}]};
 await assert.rejects(f.preview().add(reference),/整体要求/);assert.equal(references.referencesOf(f.annotationDraft.read()).length,0);assert.equal(draftQuotesOf(f)[0].annotation.length,13000);f.close();
});

test('Popover outside dismissal cannot discard an unsaved comment immediately before the main send click',async()=>{
 const f=fixture();await tick();f.render();f.preview().openQuote({quote:ordinaryQuote});await tick();f.render();f.find(n=>n.type==='quote-form').props.onChange('unsaved');f.render();
 f.find(n=>n.props?.className==='composer-area').props.ref.current={contains:node=>!!node?.composer,focus(){}};
 let cancelled=false;f.find(n=>n.type==='popover').props.onOpenChange(false,{reason:'outside-press',event:{target:{composer:true}},cancel(){cancelled=true;}});f.render();submit(f);
 assert.equal(f.sends.length,0);assert.equal(cancelled,true);assert.equal(f.find(n=>n.type==='quote-form').props.value,'unsaved');
 f.find(n=>n.type==='popover').props.onOpenChange(false,{reason:'focus-out',event:{target:{},relatedTarget:{composer:true}},cancel(){}});f.render();submit(f);assert.equal(f.sends.length,0);
 f.find(n=>n.type==='popover').props.onOpenChange(false,{reason:'escape-key',event:{},cancel(){}});f.render();assert.equal(nodes(f.render()).some(n=>n.type==='quote-form'),false);f.close();
});

test('late source rejection cannot replace a newer unsaved quote editor generation, during hashing or after readiness',async()=>{
 for(const hashing of [false,true]){
  const send=deferred(),hash=deferred(),f=fixture({draft:{text:'original',quotes:[{...ordinaryQuote,annotation:'original comment'}]},completeQuote:value=>hashing?hash.promise:Promise.resolve(value.quote)});await tick();f.render();f.props.onSend=()=>send.promise;submit(f);
  f.preview().openQuote({quote:{messageId:'new-source',text:'new excerpt'}});await tick();f.render();f.find(n=>n.type==='quote-form').props.onChange('new unsaved note');f.render();
  send.reject(Error('quote_source_mismatch'));await tick();f.render();assert.equal(f.runtime.text,'');assert.equal(draftQuotesOf(f).length,0);
  hash.resolve({messageId:'new-source',text:'new excerpt'});await tick();f.render();f.find(n=>n.type==='quote-form').props.onSave();f.render();assert.equal(draftQuotesOf(f)[0].annotation,'new unsaved note');assert.equal(draftQuotesOf(f)[0].messageId,'new-source');f.close();
 }
});

test('message quoting is refused while an unsaved quote comment owns the current selection',async()=>{
 const f=fixture({text:'keep text'});await tick();f.render();
 f.preview().openQuote({quote:ordinaryQuote,range:{startContainer:{parentElement:{isConnected:false}}}});await tick();f.render();
 assert.equal(f.preview().canQuote(),false);f.preview().appendQuote({messageId:'new-source',text:'new source'});f.render();
 assert.deepEqual(draftQuotesOf(f),[]);assert.equal(f.runtime.text,'keep text');assert.ok(f.find(n=>n.type==='quote-form'));f.close();
});

test('composer records cross-type insertion order and restores it after refresh',async()=>{
 const upload={...asset,assetId:'asset-mixed',filename:'note.txt',kind:'file'};
 const f=fixture({text:'Draft',request:async()=>({ok:true,json:async()=>upload})});await tick();f.render();
 await f.preview().add(textReference);f.render();
 f.editor().props.onFiles([new File(['example'],'note.txt',{type:'text/plain'})]);await tick();f.render();
 f.preview().appendQuote(ordinaryQuote);f.render();
 const draft=f.cache.get('homer-draft:'+f.state.threadId);
 const quote=draft.quotes[0];
 assert.deepEqual(draft.contextOrder,[contextKey('ref',references.referenceKey(textReference),'n'),contextKey('attachment','asset-mixed'),contextKey('quote',quote.draftId)]);
 const projected=nodes(f.render()).filter(node=>node.type==='annotation-chips'||node.type==='attachment'||node.props?.['aria-label']==='编辑引用 1');
 assert.deepEqual(projected.map(node=>node.type),['annotation-chips','attachment','button']);
 f.close();
 const recovered=fixture({draft});await tick();recovered.render();
 const after=nodes(recovered.render()).filter(node=>node.type==='annotation-chips'||node.type==='attachment'||node.props?.['aria-label']==='编辑引用 1');
 assert.deepEqual(after.map(node=>node.type),['annotation-chips','attachment','button']);
 assert.deepEqual(recovered.cache.get('homer-draft:'+recovered.state.threadId).contextOrder,draft.contextOrder);
 recovered.close();
});
