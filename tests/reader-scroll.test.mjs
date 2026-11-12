import {CONVERSATION_VIEW} from '../src/web-contract.ts';
// Component policy and real assistant-ui scroll hook with controlled geometry.
// No browser layout, Lexical DOM, SSE transport or production host is simulated.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {liveMainActivity} from '../ui/waiting-status.ts';
import {projectProcessItems,toolActivityText,toolStatusText} from '../ui/process-presentation.ts';
import {messageSourceParts} from '../src/message-quote.ts';
import {activityOutcomes} from '../src/activity-facts.ts';
const require=createRequire(resolve('package.json'));
function load(path,bindings,name){
 const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const source=name?ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast):ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 return Function('require','exports',...Object.keys(bindings),js+(name?`;return ${name};`:';return exports;'))(require,{},...Object.values(bindings));
}
function hooks(passive=false){
 const cells=[],pending=[];let cursor=0;
 const useRef=value=>cells[cursor++]??(cells[cursor-1]={current:value});
 const useState=value=>{const i=cursor++;cells[i]??={value:typeof value==='function'?value():value};return [cells[i].value,next=>{cells[i].value=typeof next==='function'?next(cells[i].value):next;}];};
 const useMemo=(fn,deps)=>{const i=cursor++,old=cells[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n])))cells[i]={deps,value:fn()};return cells[i].value;};
 const useLayoutEffect=(fn,deps)=>{const i=cursor++,old=cells[i];if(!old||!deps||deps.some((v,n)=>!Object.is(v,old.deps?.[n]))){cells[i]={deps,cleanup:old?.cleanup};pending.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}};
 return {useRef,useState,useMemo,useCallback:(fn,deps)=>useMemo(()=>fn,deps),useLayoutEffect,useIsomorphicLayoutEffect:useLayoutEffect,useEffect:passive?useLayoutEffect:()=>{},begin(){cursor=0;},commit(){while(pending.length)pending.shift()();},close(){for(const cell of cells)cell?.cleanup?.();}};
}
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
function fixture({deferPage=false,upstreamFirst=true,emptyInitial=false,gestureBeforeSnapshot=false,quoteRange=async()=>undefined,quoteSelection=null}={}){
 let releasePage,pendingLayout=0;const mutations=new Set();const pageReady=new Promise(resolve=>{releasePage=resolve;});
 const appHooks=hooks(true),scrollHooks=hooks(),frames=new Map(),events=new Map(),listeners=new Map(),observers=new Set();const writes=[];let seq=0,resizeContent,viewportProps,scrollRef;
 const frame=fn=>{frames.set(++seq,fn);return seq;},cancel=id=>frames.delete(id);
 const messages=Array.from({length:30},(_,i)=>({id:'row-'+i,role:i%2?'assistant':'user',text:'history',createdAt:1700000000000,status:'completed'}));
 let state={conversationView:CONVERSATION_VIEW,threadId:'reader',messages,isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'},queue:[],acceptedRequestIds:[]};
 const page={protocol:3,threadId:'reader',revision:1,messages,units:messages.map(m=>m.id),before:'older-page',after:null};
 state.history={protocol:3,readEpoch:'reader-epoch',page,moreQueue:null,moreInteractions:null};
 const {HistoryWindow}=load(resolve('ui/history-window.ts'),{}),history=new HistoryWindow();history.snapshot(state);
 const requests=[];let runtimeState,nextRuntimeState,deferRuntime=false;const subscribers=new Set();const runtime={thread:{getState:()=>({messages:runtimeState?.messages??[]}),subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);}}};let stateEvents;
 const view={screenTop:76,clientHeight:600,scrollHeight:3000,_top:0,get scrollTop(){return this._top;},set scrollTop(value){writes.push(value);this._top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));},scrollTo({top}){this.scrollTop=top;},contains:element=>rows.includes(element),getBoundingClientRect(){return {top:this.screenTop,bottom:this.screenTop+this.clientHeight};},querySelectorAll(){return rows;},querySelector(){return content;},addEventListener(name,fn){const set=listeners.get(name)??new Set();set.add(fn);listeners.set(name,set);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
 const rows=messages.map((message,i)=>({id:'message-'+message.id,dataset:{conversationMessage:message.id,messageId:message.id},y:i*100,height:100,scrollIntoView(){view.scrollTop=this.y-(view.clientHeight-100)/2;},focus(){},getBoundingClientRect(){return {top:view.screenTop+this.y-view.scrollTop,bottom:view.screenTop+this.height+this.y-view.scrollTop};}}));
 const content={};view.children=[content];view.querySelector=selector=>selector==='[data-message-id]'?rows[0]:content;
 class ResizeObserver{constructor(fn){this.fn=fn;this.observed=new Set();observers.add(this);}observe(el){this.observed.add(el);}disconnect(){observers.delete(this);}}
 const store={isAtBottom:false,turnAnchor:'bottom',element:{viewport:view,anchor:null}};
 const viewportStore={getState:()=>store,setState:value=>Object.assign(store,value)};
 class MutationObserver{constructor(fn){this.fn=fn;}observe(){mutations.add(this);}disconnect(){mutations.delete(this);}}
 const metrics=load(resolve('node_modules/@assistant-ui/store/dist/utils/viewport-scroll.js'),{ResizeObserver,MutationObserver});
 const useScroll=load(resolve('node_modules/@assistant-ui/react/dist/primitives/thread/useThreadViewportAutoScroll.js'),{
  ...scrollHooks,...metrics,useAui:()=>({thread:{getState:()=>({messages:runtimeState?.messages??messages})}}),useAuiState:fn=>fn({thread:runtimeState??state,threadListItem:{id:'reader'}}),useThreadViewportStore:()=>viewportStore,writableStore:s=>s,
  useOnResizeContent:fn=>{resizeContent=fn;return ()=>{};},useOnScrollToBottom:fn=>events.set('bottom',fn),useAuiEvent:(name,fn)=>events.set(name,fn),useManagedRef:fn=>fn,
  useComposedRefs:(...refs)=>el=>refs.forEach(ref=>typeof ref==='function'?ref(el):ref.current=el),requestAnimationFrame:frame,cancelAnimationFrame:cancel,KeyboardEvent:class KeyboardEvent{},
 }).useThreadViewportAutoScroll;
 const stubNames=['ProcessDetailsContext','ProcessMessagesContext','ProcessObservationContext','ArtifactsContext','PreviewActionsContext','ComposerInputFocusContext','QuoteNavigationContext'];
 const contexts=Object.fromEntries(stubNames.map(name=>[name,{Provider:name}]));
 if(emptyInitial){state={...state,messages:[]};history.reset('reader-epoch','reader');history.snapshot(state);view.scrollHeight=400;rows.length=0;}
 const empty=state;
 const projectProcessMessage=load(resolve('ui/process-message.tsx'),{projectProcessItems,toolActivityText,toolStatusText,activityOutcomes,messageSourceParts,recorded:value=>value?.state==='recorded'||value?.state==='truncated',valueNote:()=>''},'projectProcessMessage');
 const app=load(process.env.HOMER_READER_SOURCE??resolve('ui/homer-app.tsx'),{
  ...appHooks,...metrics,...contexts,empty,mobileView:false,CONVERSATION_VIEW,liveMainActivity,processActivityText:()=>'',readerContentSignature:load(resolve('ui/homer-app.tsx'),{messageSourceParts,isVisibleConversationMessage:()=>true},'readerContentSignature'),projectProcessMessage,createHomerAttachmentAdapter:()=>({}),createAnnotationDraft:()=>({}),useMediaQuery:()=>false,matchMedia:()=>({matches:false}),useProcessDetails:messages=>({messages,load(){}}),ActiveReadPage:class{items=[];version={};snapshot(version,items,more){this.version=version;this.items=items;this.more=more;}invalidate(){}},HistoryWindow:class{constructor(){return history;}},useQueueOperations:()=>({}),useExternalStoreRuntime:value=>{nextRuntimeState=value;if(!deferRuntime)runtimeState=value;return runtime;},canAcceptInput:()=>true,isVisibleConversationMessage:()=>true,
  homerLogo64:'',homerLogo256:'',Group:'group',Panel:'panel',PanelRightIcon:'preview-icon',AssistantRuntimeProvider:'runtime',TaskStatusPopover:'tasks',WechatConnection:'wechat',DesktopSettings:'settings',ThreadPrimitive:{Root:'thread',Viewport:'viewport',Empty:'empty',Messages:'messages',ScrollToBottom:'bottom'},MessageTimestamps:'timestamps',UserMessage:'user',AssistantMessage:'assistant',MainComposer:'composer',HomerMessageQueue:'queue',HomerSelectionToolbar:'selection',CanvasPanel:'canvas',InteractionCard:'interaction',
  ConnectionEvents:class{constructor(){stateEvents=this;}listeners=new Map();addEventListener(name,fn){this.listeners.set(name,fn);}close(){}},sessionStorage:{},localStorage:{length:0},storage:{read(){}},ResizeObserver,requestAnimationFrame:frame,cancelAnimationFrame:cancel,document:Object.assign(new EventTarget(),{getElementById:id=>rows.find(r=>r.id===id)}),Element:class Element{},window:{getSelection:()=>quoteSelection},
  locateSourceQuote:quoteRange,
  post:async(path,body)=>{requests.push({path,body});if(deferPage)await pageReady;if(!deferPage)pendingLayout+=200;return {...page,units:['earlier'],messages:[{...messages[0],id:'earlier'}],before:null};},
 },'HomerApp');
 function render(commit=true){appHooks.begin();const tree=app();viewportProps=nodes(tree).find(n=>n.type==='viewport').props;viewportProps.ref.current=view;if(pendingLayout){for(const row of rows)row.y+=pendingLayout;view.scrollHeight+=pendingLayout;pendingLayout=0;}scrollHooks.begin();const ref=useScroll(viewportProps);if(!scrollRef){scrollRef=ref;scrollRef(view);}scrollHooks.commit();if(commit)appHooks.commit();return tree;}
 function emitScroll(){for(const fn of listeners.get('scroll')??[])fn();viewportProps.onScroll?.({currentTarget:view});}
 function flush(){for(let n=0;n<6&&frames.size;n++){const fs=[...frames.values()];frames.clear();for(const fn of fs)fn();}emitScroll();render();}
 function resize(){const restore=()=>{for(const observer of [...observers])observer.fn([]);};if(upstreamFirst){resizeContent?.();restore();}else{restore();resizeContent?.();}emitScroll();render();flush();}
 function gesture(top,kind='onWheel',settle=true){viewportProps[kind]?.({type:kind==='onKeyDown'?'keydown':kind==='onTouchMove'?'touchmove':kind==='onTouchStart'?'touchstart':kind==='onPointerDown'?'pointerdown':'wheel',key:'PageDown',target:view,deltaY:top-view.scrollTop,currentTarget:view});view.scrollTop=top;emitScroll();if(settle){render();flush();}}
 render();if(gestureBeforeSnapshot)gesture(500);stateEvents.listeners.get('state')({data:JSON.stringify(state)});render();flush();resize();
 return {view,rows,state,writes,frameCount:()=>frames.size, deferRuntime(){deferRuntime=true;},commitRuntime(commit=true){deferRuntime=false;runtimeState=nextRuntimeState;for(const fn of subscribers)fn();if(commit){render();flush();}},claim(){return runtimeState.messages[0].metadata.custom.claimPosition();},cancelFromComposer(){nodes(render()).find(n=>n.type==='thread').props.onKeyDownCapture({type:'keydown',key:'a',target:{closest:()=>({})}});},peekCue(){return nodes(render(false)).find(n=>n.props?.className==='scroll-latest').props;},contentMutation(){for(const observer of mutations)observer.fn([{type:'characterData'}]);},cueHidden(){return nodes(render()).find(n=>n.props?.className==='scroll-latest').props.disabled;},cue(){return nodes(render()).find(n=>n.props?.className==='scroll-latest').props.children.flat(Infinity).join('');}, snapshot(next={},commit=true){state={...state,...next};stateEvents.listeners.get('state')({data:JSON.stringify(state)});if(commit){render();flush();}},disconnect(){stateEvents.listeners.get('unavailable')();render();},render,resize,flush,gesture,emitScroll,requests,history,startGesture(kind='onPointerDown'){viewportProps[kind]?.({type:'pointerdown',target:view,currentTarget:view});},startEarlier(){nodes(render()).find(n=>n.type==='button'&&n.props.children==='加载更早消息').props.onClick();},async releaseEarlier(beforeCommit=()=>{}){releasePage();await new Promise(resolve=>setImmediate(resolve));beforeCommit();render();resize();},locateQuote(quote){nodes(render()).find(n=>n.type==='QuoteNavigationContext').props.value(quote);render();},locate(id){viewportProps.onClick?.({target:{closest:()=>({hash:'#message-'+id})},preventDefault(){}});render();},offset:row=>row.getBoundingClientRect().top-view.getBoundingClientRect().top,run(){state={...state,isRunning:true};stateEvents.listeners.get('state')({data:JSON.stringify(state)});render();events.get('thread.runStart')();flush();},addRow(message){const y=rows.at(-1)?.y+100||0;rows.push({id:'message-'+message.id,dataset:{conversationMessage:message.id},y,height:100,scrollIntoView(){view.scrollTop=this.y;},focus(){},getBoundingClientRect(){return {top:view.screenTop+this.y-view.scrollTop,bottom:view.screenTop+this.y+this.height-view.scrollTop};}});},growBelow(amount){view.scrollHeight+=amount;resize();},growAbove(row,amount){const cutoff=row.y;for(const r of rows)if(r.y>=cutoff)r.y+=amount;view.scrollHeight+=amount;resize();},expand(){const summary={tagName:'SUMMARY',parentElement:{hasAttribute:()=>false}};const target={closest:s=>s==='[data-message-id]'||s==='[data-conversation-message]'?rows[29]:s==='[aria-expanded], summary'?summary:null};const event={target};viewportProps.onClickCapture?.(event);for(const fn of listeners.get('click')??[])fn(event);viewportProps.onClick?.(event);render();},latest(){const button=nodes(render()).find(n=>n.props?.className==='scroll-latest');button.props.onClick?.({});if(button.type==='bottom')events.get('bottom')({behavior:'instant'});emitScroll();render();flush();},async earlier(){nodes(render()).find(n=>n.type==='button'&&n.props.children==='加载更早消息').props.onClick();await new Promise(resolve=>setImmediate(resolve));render();resize();},close(){appHooks.close();scrollHooks.close();}};
}

// Missing runStart opt-out causes the real upstream hook to jump to 2700.
test('a new run after reading history preserves the visible row through later streamed content',()=>{
 const f=fixture();f.gesture(1000);const row=f.rows[10],before=f.offset(row);f.run();assert.equal(f.offset(row),before);f.growBelow(300);assert.equal(f.offset(row),before);f.close();
});
// Without a reader anchor a settled image above the reader moves the row 180px.
test('late media above the reader preserves the same visual row without loading a history page',()=>{
 const f=fixture();f.gesture(1000);const row=f.rows[10],before=f.offset(row);f.growAbove(row,180);assert.equal(f.offset(row),before);f.close();
});
test('composer and queue resize cannot move the reading anchor or silently resume follow',()=>{
 const f=fixture();f.gesture(1000);const row=f.rows[10],before=f.offset(row);
 f.view.clientHeight=800;f.view.scrollTop=900;f.resize();assert.equal(f.offset(row),before);
 f.view.clientHeight=400;f.resize();f.growBelow(100);assert.equal(f.offset(row),before);f.close();
});
test('initial positioning and latest each jump once then preserve the reading position',()=>{
 const f=fixture();const initial=f.view.scrollTop;f.growBelow(300);assert.equal(f.view.scrollTop,initial);f.gesture(1000);f.latest();assert.equal(f.view.scrollTop,2700);f.growBelow(200);assert.equal(f.view.scrollTop,2700);f.close();
});
test('deliberately scrolling to the bottom never restores follow',()=>{
 const f=fixture();f.gesture(1000);f.gesture(2400);f.growBelow(150);assert.equal(f.view.scrollTop,2400);f.close();
});
test('content fitting after a large composer collapse does not grant new follow intent',()=>{
 const f=fixture();f.gesture(2400-20);const row=f.rows[24],before=f.offset(row);f.view.clientHeight=640;f.view.scrollTop=2360;f.resize();f.growBelow(300);assert.equal(f.offset(row),before);f.close();
});
test('a new run does not resume follow while inspecting an expanded message',()=>{
 const f=fixture();f.expand();f.growBelow(200);const before=f.view.scrollTop;f.run();f.growBelow(200);assert.equal(f.view.scrollTop,before);f.close();
});
test('scrolling during a stream chooses a new reading row instead of restoring the previous one',()=>{
 const f=fixture();f.gesture(1000);f.view.scrollHeight+=100;f.gesture(1200);f.resize();assert.equal(f.view.scrollTop,1200);f.growBelow(100);assert.equal(f.view.scrollTop,1200);f.close();
});
test('loading earlier messages preserves the row and keeps the original history request and cache semantics',async()=>{
 const f=fixture();f.gesture(1000);const row=f.rows[10],before=f.offset(row);await f.earlier();assert.equal(f.offset(row),before);assert.deepEqual(f.requests,[{path:'/api/history/page',body:{readEpoch:'reader-epoch',request:{before:'older-page'}}}]);assert.equal(f.history.messages[0].id,'earlier');f.growBelow(150);assert.equal(f.offset(row),before);f.close();
});
for(const kind of ['onTouchMove','onPointerDown','onKeyDown'])test(kind+' selects a new anchor and explicit bottom still stays manual',()=>{
 const f=fixture();f.gesture(1000,kind);f.run();f.growBelow(100);assert.equal(f.view.scrollTop,1000);f.gesture(2500,kind);f.growBelow(100);assert.equal(f.view.scrollTop,2500);f.close();
});
test('a send status banner resizing the thread preserves the row on screen',()=>{
 const f=fixture();f.gesture(1000);const row=f.rows[10],before=f.offset(row);f.view.screenTop=150;f.view.clientHeight=526;f.resize();assert.equal(f.offset(row),before);f.close();
});

// A second gesture can arrive before React commits the paused render.
// The saved anchor must stay valid while its state update is pending.
test('a gesture before the paused render commits retains the current anchor during media resize',()=>{
 const f=fixture();f.gesture(1000,'onWheel',false);const row=f.rows[10],before=f.offset(row);f.startGesture();f.growAbove(row,180);assert.equal(f.offset(row),before);f.close();
});
test('prepend with streamed output and late media preserves one row without double compensation',async()=>{
 const f=fixture();f.gesture(1000);const row=f.rows[10],before=f.offset(row);await f.earlier();f.growBelow(150);f.growAbove(row,180);assert.equal(f.offset(row),before);f.resize();assert.equal(f.offset(row),before);f.close();
});
test('a pending earlier page preserves the newer user position instead of its request anchor',async()=>{
 const f=fixture({deferPage:true});f.gesture(1000);f.startEarlier();f.gesture(1200);const row=f.rows[12],before=f.offset(row);await f.releaseEarlier();assert.equal(f.offset(row),before);assert.equal(f.view.scrollTop,1200);f.growBelow(150);assert.equal(f.offset(row),before);f.close();
});

test('a gesture after message navigation rebuilds a cleared paused anchor before media resize',()=>{
 const f=fixture();f.gesture(950);const row=f.rows[12],before=f.offset(row);f.locate(row.dataset.conversationMessage);f.startGesture();f.growAbove(f.rows[9],180);assert.equal(f.offset(row),before);f.close();
});
// Both real-library/app resize orders must settle to the saved offset.
for(const upstreamFirst of [false,true])test('one prepend commit with stream and media growth preserves its row, upstream first='+upstreamFirst,async()=>{
 const f=fixture({deferPage:true,upstreamFirst});f.gesture(1000);const row=f.rows[10],before=f.offset(row);f.startEarlier();
 await f.releaseEarlier(()=>{const cutoff=row.y;for(const r of f.rows){r.y+=200;if(r.y>=cutoff+200)r.y+=180;}f.view.scrollHeight+=530;});
 assert.equal(f.offset(row),before);assert.equal(f.view.scrollTop,1380);f.resize();assert.equal(f.offset(row),before);f.close();
});

test('the next gesture after latest keeps a manual reading anchor',()=>{
 const f=fixture();f.gesture(1000);f.latest();f.startGesture();f.growBelow(200);assert.equal(f.view.scrollTop,2400);f.close();
});

test('late around response cannot move or focus after a user gesture',async()=>{const f=fixture({deferPage:true});f.locate('missing');f.gesture(1200);await f.releaseEarlier();assert.equal(f.view.scrollTop,1200);f.close();});

// These tests run the actual app functions and installed scroll hook, with
// controlled runtime commit timing and geometry (not a browser acceptance).
test('latest waits for the runtime body commit, and a gesture cancels that pending write',()=>{
 const f=fixture();f.gesture(1000);f.deferRuntime();f.snapshot({messages:f.state.messages.map(m=>({...m,text:'changed'}))});f.latest();assert.equal(f.view.scrollTop,1000);f.gesture(1200);f.commitRuntime();assert.equal(f.view.scrollTop,1200);f.close();
});
test('latest waits for a same-ID body commit then jumps just once',()=>{
 const f=fixture();f.gesture(1000);f.deferRuntime();f.snapshot({messages:f.state.messages.map(m=>({...m,text:'changed'}))});f.latest();assert.equal(f.view.scrollTop,1000);f.commitRuntime();assert.equal(f.view.scrollTop,2400);f.growBelow(200);assert.equal(f.view.scrollTop,2400);f.close();
});
test('typing in the composer cancels a delayed latest without authorizing follow',()=>{
 const f=fixture();f.gesture(1000);f.deferRuntime();f.snapshot({messages:f.state.messages.map(m=>({...m,text:'changed'}))});f.latest();f.cancelFromComposer();f.commitRuntime();assert.equal(f.view.scrollTop,1000);f.growBelow(300);assert.equal(f.view.scrollTop,1000);f.close();
});
test('disconnected latest keeps the old page then completes on the valid snapshot once',async()=>{
 const f=fixture();f.gesture(1000);await f.earlier();f.disconnect();f.latest();assert.ok(f.history.pages.length);const before=f.view.scrollTop;assert.equal(f.view.scrollTop,before);f.snapshot();assert.equal(f.history.pages.length,0);assert.equal(f.view.scrollTop,2600);f.growBelow(100);assert.equal(f.view.scrollTop,2600);f.close();
});
test('incoming same-ID public body changes light the cue and latest confirms only its boundary',()=>{
 const f=fixture();f.gesture(1000);assert.ok(!f.cue().includes('有新内容'));const next=f.state.messages.map(m=>m.id==='row-29'?{...m,text:'historY'}:m);f.snapshot({messages:next});assert.ok(f.cue().includes('有新内容'));f.latest();assert.ok(!f.cue().includes('有新内容'));f.gesture(1000);f.snapshot({messages:next.map(m=>m.id==='row-29'?{...m,text:'historY more'}:m)});assert.ok(f.cue().includes('有新内容'));f.close();
});
test('ACK and tool/worker-only changes do not light the content cue',()=>{
 const f=fixture(),base=f.state.messages;f.snapshot({observedAtMs:123,acceptedRequestIds:['ack'],messages:[...base,{...base[1],id:'input-outcome:ack',text:'received'},{...base[1],id:'internal',text:'worker progress',process:{sourceKind:'worker',items:[]}},{...base[1],id:'process',text:'host status',process:{sourceKind:'user',items:[{id:'tool',kind:'tool',status:'running'}]}}]});assert.ok(!f.cue().includes('有新内容'));f.close();
});
test('scheduled tools keep live status only for the exact current internal process and turn',()=>{
 const f=fixture();try{
  const process={id:'scheduled-process',threadId:'reader',sourceKind:'scheduled',state:'working',status:'running',turnIds:['scheduled-turn'],items:[{id:'scheduled-tool',kind:'tool',seq:1,revision:1,category:'host',threadId:'reader',turnId:'scheduled-turn',toolName:'schedule_list',label:'查看安排',status:'running',startedAtMs:1000}]};
  const activity={processId:process.id,source:'internal',turnId:'scheduled-turn',stage:'native'},message={...f.state.messages[1],id:process.id,text:'',status:'running',process};
  const current=()=>nodes(f.render()).find(node=>node.type==='runtime').props.runtime.thread.getState().messages.find(row=>row.id===message.id);
  f.snapshot({messages:[...f.state.messages,message],processNodes:[process],mainActivity:activity});
  let entry=current().metadata.custom.activityPresentation.entries['tool-call:scheduled-tool'];
  assert.equal(entry.live,true);assert.equal(entry.statusLabel,'调用中');assert.equal(current().content.find(part=>part.toolCallId==='scheduled-tool').timing.startedAt,1000);
  for(const changed of [{...activity,source:'user'},{...activity,turnId:'other-turn'},{...activity,processId:'other-process'}]){
   f.snapshot({mainActivity:changed});entry=current().metadata.custom.activityPresentation.entries['tool-call:scheduled-tool'];
   assert.equal(entry.live,false);assert.equal(entry.statusLabel,'上次调用中，结束未确认');
  }
 }finally{f.close();}
});
test('scheduled coordination does not light the reader cue, while its separate public delivery does',()=>{
 const f=fixture();try{
  f.gesture(1000);const base=f.state.messages,scheduled={...base[1],id:'scheduled-process',text:'定时内部处理记录',process:{id:'scheduled-process',sourceKind:'scheduled',state:'worked',status:'completed',items:[],final:{id:'scheduled-process',text:'定时内部处理记录'}}};
  f.snapshot({messages:[...base,scheduled]});assert.ok(!f.cue().includes('有新内容'));
  f.snapshot({messages:[...base,scheduled,{...base[1],id:'scheduled-public-delivery',text:'定时工作的公开交付'}]});assert.ok(f.cue().includes('有新内容'));
 }finally{f.close();}
});
test('a quote owner is invalidated by newer navigation, gestures and readEpoch',()=>{
 const f=fixture();let writes=0;const old=f.claim();f.latest();assert.equal(old(()=>writes++),false);const next=f.claim();f.gesture(1000);assert.equal(next(()=>writes++),false);const epoch=f.claim();f.snapshot({history:{...f.state.history,readEpoch:'replacement'}});assert.equal(epoch(()=>writes++),false);assert.equal(writes,0);f.close();
});
for(const gap of [0,1,20])test('original bottom gap '+gap+' stays fixed while a long same-ID reply grows',()=>{
 const f=fixture();f.gesture(2400-gap);const row=f.rows[24],before=f.offset(row);for(let i=0;i<8;i++)f.growBelow(800);assert.equal(f.offset(row),before);f.close();
});

test('an empty first snapshot consumes initialization before the first send appears',()=>{
 const f=fixture({emptyInitial:true});assert.equal(f.view.scrollTop,0);const m={id:'first',role:'user',text:'send',createdAt:1,status:'completed'};f.addRow(m);f.view.scrollHeight=1200;f.snapshot({messages:[m]});assert.equal(f.view.scrollTop,0);f.run();f.growBelow(500);assert.equal(f.view.scrollTop,0);f.close();
});
test('a gesture before the first verified snapshot prevents initialization',()=>{
 const f=fixture({gestureBeforeSnapshot:true});assert.equal(f.view.scrollTop,500);f.growBelow(300);assert.equal(f.view.scrollTop,500);f.close();
});
test('a same-ID reply crossing the viewport top keeps its negative root offset',()=>{
 const f=fixture();f.rows[29].height=3000;f.view.scrollHeight=5900;f.gesture(3100);const before=f.offset(f.rows[29]);assert.equal(before,-200);for(let i=0;i<6;i++){f.rows[29].height+=500;f.growBelow(500);}assert.equal(f.offset(f.rows[29]),-200);f.close();
});
test('a hidden process-only anchor keeps the viewport and reanchors to a visible reply',()=>{
 const f=fixture();f.gesture(1250);
 const offset=f.offset(f.rows[13]);
 f.rows[12].getBoundingClientRect=()=>({top:0,bottom:0});
 for(const row of f.rows.slice(13))row.y-=100;
 f.view.scrollHeight-=100;f.resize();
 assert.equal(f.offset(f.rows[13]),offset);
 f.growAbove(f.rows[13],150);assert.equal(f.offset(f.rows[13]),offset);
 f.close();
});
test('a new message does not move the original bottom and lights the content cue',()=>{
 const f=fixture(),before=f.view.scrollTop,m={...f.state.messages.at(-1),id:'new',text:'new answer'};f.addRow(m);f.view.scrollHeight+=100;f.snapshot({messages:[...f.state.messages,m]});assert.equal(f.view.scrollTop,before);assert.ok(f.cue().includes('有新内容'));f.latest();assert.equal(f.view.scrollTop,2500);f.growBelow(400);assert.equal(f.view.scrollTop,2500);f.close();
});
test('latest is cancelled by a later quote navigation and late quote writes cannot override latest',()=>{
 const f=fixture();f.gesture(1000);f.deferRuntime();f.snapshot({messages:f.state.messages.map(m=>({...m,text:'next body'}))});f.latest();let focus=0;const quote=f.claim();quote(()=>{f.view.scrollTop=700;focus++;});f.commitRuntime();assert.equal(f.view.scrollTop,700);const late=f.claim();f.latest();assert.equal(late(()=>{f.view.scrollTop=400;focus++;}),false);assert.equal(focus,1);assert.equal(f.view.scrollTop,2400);f.close();
});
test('a delayed quote selection discards its range after a newer gesture',async()=>{
 let release,writes=0,calls=0,selectionWrites=0;const promise=new Promise(resolve=>{release=resolve;}),f=fixture({quoteRange:()=>{calls++;return promise;},quoteSelection:{removeAllRanges(){selectionWrites++;},addRange(){selectionWrites++;}}});
 f.locateQuote({messageId:'row-1',text:'x'});assert.equal(calls,1);f.gesture(1000);release({getBoundingClientRect(){writes++;return {top:0,bottom:1};}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,0);assert.equal(selectionWrites,0);assert.equal(f.view.scrollTop,1000);f.close();
});

test('a current quote selection resolves and brings its exact range into view',async()=>{
 let measured=0,cleared=0,selected;const range={getBoundingClientRect(){measured++;return {top:0,bottom:1};}},f=fixture({quoteRange:async()=>range,quoteSelection:{removeAllRanges(){cleared++;},addRange(value){selected=value;}}});
 f.locateQuote({messageId:'row-10',text:'x'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cleared,1);assert.equal(selected,range);assert.equal(measured,1);assert.equal(f.view.scrollTop,474);f.close();
});

test('around navigation survives a same-ID incoming update before its runtime commit',async()=>{
 const f=fixture();f.gesture(1000);f.deferRuntime();f.locate('earlier');await new Promise(resolve=>setImmediate(resolve));
 f.addRow({id:'earlier'});const row=f.rows.at(-1);row.y=100;let focused=0;row.scrollIntoView=()=>{f.view.scrollTop=100;};row.focus=()=>{focused++;};
 f.render();assert.equal(focused,0);
 f.snapshot({messages:[...f.state.messages,{...f.state.messages[0],id:'earlier',text:'same ID updated'}],history:{...f.state.history,page:{...f.state.history.page,revision:2}}});
 f.commitRuntime();assert.equal(focused,1);assert.equal(f.view.scrollTop,100);f.growBelow(200);assert.equal(f.view.scrollTop,100);f.close();
});

test('layout compensation settles in both observer orders with bounded position writes',async()=>{
 for(const upstreamFirst of [true,false]){const f=fixture({upstreamFirst});f.gesture(1000);await f.earlier();const row=f.rows[10],offset=f.offset(row),before=f.writes.length;f.growAbove(row,180);assert.equal(f.offset(row),offset);assert.ok(f.writes.length-before<=3);const settled=f.writes.length;for(let i=0;i<8;i++)f.resize();assert.equal(f.writes.length,settled);assert.equal(f.frameCount(),0);f.close();}
});
test('new formal answer items light the cue while commentary and tool progress do not',()=>{
 const f=fixture();f.gesture(1000);const base=f.state.messages.filter(m=>m.id!=='row-29'),m=f.state.messages.at(-1),process={sourceKind:'user',items:[],revision:1};
 f.snapshot({messages:[...base,{...m,text:'',process}]});assert.ok(!f.cue().includes('有新内容'));
 const answer={id:'answer-item',kind:'commentary',phase:'final_answer',text:'public answer',revision:1,turnId:'turn',itemId:'item'};
 f.snapshot({messages:[...base,{...m,text:'public answer',process:{...process,revision:2,items:[answer]}}]});assert.ok(f.cue().includes('有新内容'));f.latest();assert.ok(!f.cue().includes('有新内容'));
 f.snapshot({messages:[...base,{...m,text:'public answer',process:{...process,revision:3,items:[answer,{id:'commentary',kind:'commentary',phase:'commentary',text:'internal progress',revision:1},{id:'tool',kind:'tool',status:'running'}]}}]});assert.ok(!f.cue().includes('有新内容'));f.close();
});

// Regressions: clearing only during latest leaves this visual cue latched.
// Geometry is controlled; these are component/hook tests, not browser input tests.
for(const kind of ['onWheel','onTouchMove','onPointerDown','onKeyDown'])test(kind+' reaching the latest page bottom clears the cue without clicking or following',()=>{
 const f=fixture();f.gesture(1000,kind);f.view.scrollHeight=3100;
 f.snapshot({messages:f.state.messages.map(m=>m.id==='row-29'?{...m,text:'new answer'}:m)});
 assert.equal(f.view.scrollTop,1000);assert.equal(f.cueHidden(),false);assert.ok(f.cue().includes('有新内容'));
 f.gesture(2500,kind);assert.equal(f.cueHidden(),true);assert.ok(!f.cue().includes('有新内容'));
 f.gesture(1200,kind);assert.ok(!f.cue().includes('有新内容'));
 f.view.scrollHeight=3200;f.snapshot({messages:f.state.messages.map(m=>m.id==='row-29'?{...m,text:'second answer'}:m)});
 assert.equal(f.view.scrollTop,1200);assert.equal(f.cueHidden(),false);assert.ok(f.cue().includes('有新内容'));
 f.latest();assert.equal(f.view.scrollTop,2600);assert.equal(f.cueHidden(),true);
 f.growBelow(100);assert.equal(f.view.scrollTop,2600);f.close();
});
test('new visible content fitting in the viewport never leaves a stale cue',()=>{
 const f=fixture({emptyInitial:true}),m={id:'first',role:'assistant',text:'visible answer',createdAt:1,status:'completed'};
 f.addRow(m);f.view.scrollHeight=500;f.snapshot({messages:[m]});
 assert.equal(f.view.scrollTop,0);assert.equal(f.cueHidden(),true);assert.ok(!f.cue().includes('有新内容'));f.close();
});
test('stream growth preserves position and clears the cue only once its bottom is reached',()=>{
 const f=fixture();f.gesture(1000);
 for(let i=1;i<=3;i++){f.view.scrollHeight=3000+i*100;f.snapshot({messages:f.state.messages.map(m=>m.id==='row-29'?{...m,text:'stream '+i}:m)});assert.equal(f.view.scrollTop,1000);assert.ok(f.cue().includes('有新内容'));}
 f.gesture(2700);assert.equal(f.cueHidden(),true);f.growBelow(180);assert.equal(f.view.scrollTop,2700);assert.equal(f.cueHidden(),false);f.gesture(2880);assert.equal(f.cueHidden(),true);f.close();
});
test('composer and queue resize remeasure the cue without a scroll event',()=>{
 const f=fixture();f.gesture(1000);f.snapshot({messages:f.state.messages.map(m=>({...m,text:'new'}))});
 f.gesture(2300);assert.ok(f.cue().includes('有新内容'));f.view.clientHeight=700;f.resize();assert.equal(f.view.scrollTop,2300);assert.equal(f.cueHidden(),true);assert.ok(!f.cue().includes('有新内容'));
 f.view.clientHeight=500;f.resize();assert.equal(f.view.scrollTop,2300);assert.equal(f.cueHidden(),false);f.gesture(2500);assert.equal(f.cueHidden(),true);f.close();
});
test('late attachment height and one-pixel rounding use the actual viewport bottom',()=>{
 const f=fixture();f.gesture(1000);f.snapshot({messages:f.state.messages.map(m=>({...m,text:'new'}))});f.growBelow(180);
 f.gesture(2578);assert.equal(f.cueHidden(),false);assert.ok(f.cue().includes('有新内容'));
 f.gesture(2579.25);assert.equal(f.cueHidden(),true);assert.ok(!f.cue().includes('有新内容'));f.close();
});
test('the bottom of an archived page cannot clear a cue for newer messages outside that page',()=>{
 const f=fixture();f.gesture(1000);f.history.add({...f.state.history.page,units:['row-10'],messages:[f.state.messages[10]]},'reader-epoch','around');assert.equal(f.history.archived,true);
 f.snapshot({messages:f.state.messages.map(m=>({...m,text:'new latest content'}))});f.gesture(f.view.scrollHeight-f.view.clientHeight);
 assert.equal(f.cueHidden(),false);assert.ok(f.cue().includes('有新内容'));f.latest();assert.equal(f.history.archived,false);assert.equal(f.cueHidden(),true);f.close();
});

test('incoming content cannot be acknowledged against the previous runtime body at bottom',()=>{
 const f=fixture();f.deferRuntime();f.snapshot({messages:f.state.messages.map(m=>({...m,text:'body waiting for commit'}))});
 f.view.scrollHeight=3300;f.commitRuntime();f.resize();assert.equal(f.view.scrollTop,2400);assert.ok(f.cue().includes('有新内容'));assert.equal(f.cueHidden(),false);
 f.gesture(2700);assert.equal(f.cueHidden(),true);f.close();
});

test('a same-height runtime DOM commit clears the visible cue via content observation',()=>{
 const f=fixture();f.deferRuntime();f.snapshot({messages:f.state.messages.map(m=>({...m,text:'same-height update'}))});
 assert.equal(f.peekCue().disabled,false);f.commitRuntime(false);f.contentMutation();assert.equal(f.peekCue().disabled,true);f.close();
});
