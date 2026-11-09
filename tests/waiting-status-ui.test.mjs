import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {HistoryWindow} from '../ui/history-window.js';
import {ActiveReadPage} from '../ui/active-read-page.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const file=new URL('../ui/waiting-status.ts',import.meta.url);
const bundle=buildSync({entryPoints:[fileURLToPath(file)],bundle:true,write:false,format:'cjs',platform:'node'});
const module={exports:{}};Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,require);const waiting=module.exports;
const node={id:'process',threadId:'thread',sourceKind:'user',state:'working',status:'running',turnIds:['turn'],items:[]};
const state={threadId:'thread',messages:[],isRunning:true,activeMessageId:'reply',generation:{generationId:'generation',turnId:'turn'},queue:[],work:[],interactions:[],upgrade:{phase:'running',accepting:true},processNodes:[node],mainActivity:{processId:'process',source:'user',turnId:'turn',stage:'compacting',retryObserved:true,connectionIssue:true}};

test('stage text is factual, retry is past evidence and only the exact current user approval overrides native activity',()=>{
 assert.equal(typeof waiting.processActivityText,'function');
 const text=waiting.processActivityText(state,true,node);assert.match(text,/压缩上下文/);assert.match(text,/报告过重试/);assert.doesNotMatch(text,/正在重连|\d+%|思考|turn|process/);
 assert.match(waiting.processActivityText({...state,interactions:[{runId:'worker',kind:'authorization'}]},true,node),/压缩/);
 assert.match(waiting.processActivityText({...state,interactions:[{runId:'main-native:generation',kind:'authorization'}]},true,node),/等待你确认/);
 assert.match(waiting.processActivityText({...state,mainActivity:{...state.mainActivity,stage:'finishing'}},true,node),/原生轮已结束.*宿主/);
});

test('stale turn, finished node, unknown, disconnect and restart never resurrect a live main stage',()=>{
 assert.equal(typeof waiting.liveMainActivity,'function');
 assert.equal(waiting.liveMainActivity(state,false),null);
 assert.equal(waiting.liveMainActivity({...state,processNodes:[{...node,state:'worked'}]},true),null);
 assert.equal(waiting.liveMainActivity({...state,generation:{...state.generation,turnId:'new-turn'}},true),null);
 assert.equal(waiting.liveMainActivity({...state,mainActivity:null},true),null);
 assert.match(waiting.processActivityText(state,false,node),/上次状态|未确认/);
 assert.match(waiting.processActivityText({...state,mainActivity:null},true,{...node,status:'unknown'}),/待核实/);
});

test('one current title follows terminal, uncertainty, waiting, stage, tool and readable progress priority',()=>{
 const native={...state,mainActivity:{...state.mainActivity,stage:'native',retryObserved:undefined,connectionIssue:undefined,summary:'准备只读诊断'}};
 const read={id:'read',seq:2,revision:1,kind:'tool',category:'readFiles',threadId:'thread',turnId:'turn',status:'running',label:'读取文件'};
 const text=(s=native,n=node,connected=true)=>waiting.processActivityText(s,connected,n);
 assert.equal(text(),'准备只读诊断');
 assert.equal(text(native,{...node,items:[read]}),'读取文件');
 assert.equal(text(native,{...node,items:[{...read,status:'completed'}]}),'准备只读诊断');
 assert.equal(text({...native,mainActivity:{...native.mainActivity,summary:undefined}}),'处理中');
 assert.equal(text({...native,mainActivity:{...native.mainActivity,summary:undefined}},{...node,items:[{id:'c',kind:'commentary',seq:3,revision:1,turnId:'turn',itemId:'c',phase:'commentary',text:'我会核查源码。'}]}),'我会核查源码。');
 for(const kind of ['authorization','question'])assert.match(text({...native,interactions:[{runId:'main-native:generation',kind}]},{...node,items:[read]}),/等待你/);
 for(const [stage,expected]of [['preparing',/准备本轮/],['compacting',/压缩上下文/],['finishing',/原生轮已结束/],['unknown',/待确认/]])assert.match(text({...native,mainActivity:{...native.mainActivity,stage}},{...node,items:[read]}),expected);
 for(const [status,expected]of [['completed','已结束'],['failed','处理失败'],['interrupted','已中断']])assert.equal(text(native,{...node,state:'worked',status},false),expected);
 assert.doesNotMatch(text(native,node,false),/准备只读诊断/);
 assert.doesNotMatch(text({...native,generation:{...native.generation,turnId:'other'}}),/准备只读诊断/);
 assert.doesNotMatch(text({...native,mainActivity:{...native.mainActivity,source:'internal'}}),/准备只读诊断/);
 assert.doesNotMatch(text({...native,threadId:'other'}),/准备只读诊断/);
 assert.doesNotMatch(text({...native,mainActivity:null}),/准备只读诊断/);
 assert.match(text({...native,mainActivity:{...native.mainActivity,retryObserved:true,connectionIssue:true}}),/准备只读诊断.*发生连接异常并报告过重试/);
});

test('upper composer mapping is removed and service recovery notice stays independent',()=>{
 assert.equal(waiting.composerActivityText,undefined);
 assert.match(waiting.serviceActivityNotice({...state.upgrade,phase:'recovery_required'}),/待恢复/);
 assert.doesNotMatch(waiting.serviceActivityNotice({...state.upgrade,phase:'recovery_required'}),/已退出|已停止/);
 assert.match(waiting.serviceActivityNotice({...state.upgrade,phase:'recovery_required',code:'dev_child_exit_unconfirmed'}),/进程已退出.*暂存/);
 assert.doesNotMatch(waiting.serviceActivityNotice({...state.upgrade,phase:'recovery_required',code:'dev_child_exit_unconfirmed',accepting:false}),/可暂存/);
});

// Compile the actual gateway closure, without importing or starting runDev.
const source=readFileSync(new URL('../scripts/dev.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('dev.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function find(node,predicate){if(predicate(node))return node;return ts.forEachChild(node,child=>find(child,predicate));}
const startWeb=find(ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='startWeb');
const declaration=find(startWeb,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='historyState');
const expression=declaration.initializer.getText(ast);
const recovery=find(ast,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='recoveryRequired').initializer.getText(ast);
const ready=find(ast,n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='m.kind === "ready"').thenStatement.getText(ast);
function gateway(){return Function(`let desktop,desktopChatError;let phase='running',child={},cachedHistoryState,recoveryCode,current={version:'synthetic'},uiCurrent={},journal={pending:()=>[],rejected:()=>[]},review,stopped=false;
 let web,readyTimer,webPort,webHistoryProtocol,expectedThread,build={version:'synthetic',config:{}},candidate,initial=true,acceptedSnapshot,rollback=false,m={thread:'synthetic'};const uiBuilds=new Map(),pruneBuilds=()=>{},startWeb=async()=>{},publish=()=>{},notice=async()=>{},flush=()=>{};journal.bindThread=()=>{};
 let fail=false;const invokeWeb=async method=>{if(method!=='history.state')throw Error('unexpected_gateway_method');if(fail)throw Error('web_receipt_unconfirmed');return {threadId:'synthetic',mainActivity:{stage:'compacting'}};};
 return {state:${expression},fail:()=>{fail=true;},recover:${recovery},ready:async()=>${ready}};`)();}
test('gateway read failure propagates unavailable instead of publishing the cached business activity as current',async()=>{
 const g=gateway();assert.equal((await g.state()).threadId,'synthetic');g.fail();await assert.rejects(g.state(),/web_receipt_unconfirmed/);
});
test('gateway reuses the current recovery code in its existing upgrade contract',async()=>{
 const g=gateway();await g.state();await g.recover('dev_child_exit_unconfirmed');assert.equal((await g.state()).upgrade.code,'dev_child_exit_unconfirmed');
});

test('gateway only exports a current allowlisted reason and ready clears the old recovery cause',async()=>{
 const g=gateway();await g.state();await g.recover('SYNTHETIC_PRIVATE_REASON');assert.equal((await g.state()).upgrade.code,undefined);
 await g.recover('dev_child_exit_unconfirmed');assert.equal((await g.state()).upgrade.code,'dev_child_exit_unconfirmed');
 await g.ready();const current=await g.state();assert.equal(current.upgrade.phase,'running');assert.equal(current.upgrade.code,undefined);
});

test('superseded browser stream cannot mark a newer valid state unavailable',()=>{
 const app=readFileSync(new URL('../ui/homer-app.tsx',import.meta.url),'utf8'),tree=ts.createSourceFile('homer-app.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const effect=find(tree,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.arguments[0]?.getText(tree).includes('let disposed = false'));
 assert.ok(effect,'production connection effect exists');
 const js=ts.transpileModule('const effect='+effect.arguments[0].getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const streams=[],timers=[];let connected=false,changes=0;
 class Events extends EventTarget{constructor(){super();streams.push(this);}close(){}}
 const noop=()=>{},verifiedThread={current:undefined},loadedVersion={current:undefined};
 const reader={current:{connected:false}},history={current:new HistoryWindow()},activePages={current:{queue:new ActiveReadPage(),interactions:new ActiveReadPage()}};
 const context={ConnectionEvents:Events,setConnected:value=>{connected=value;changes++;},setConnectionError:noop,setState:noop,verifiedThread,loadedVersion,setUiUpdate:noop,setError:noop,
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:noop,document:new EventTarget(),mobileView:false,reader,history,activePages,
  activeReads:{current:{controllers:new Set(),timers:new Set()}},anchor:{current:null},navigation:{current:0},userScroll:{current:0},
  invalidatePosition:noop,setPageNotice:noop,readingPins:()=>new Set(),observeContent:noop,prepareLatest:noop,
  positionScope:()=>{throw Error('unexpected_empty_page_navigation');},readActivePage:()=>{throw Error('unexpected_active_page_read');}};
 const run=Function(...Object.keys(context),js+';return effect;')(...Object.values(context));
 const close=run(),data=JSON.stringify({...state,conversationView:3,history:{protocol:3,readEpoch:'synthetic-epoch',page:{revision:1,units:[],before:null,after:null},moreQueue:null,moreInteractions:null}});const send=stream=>stream.dispatchEvent(new MessageEvent('state',{data}));
 send(streams[0]);assert.equal(connected,true);assert.equal(reader.current.connected,true);streams[0].onerror('synthetic_disconnect');assert.equal(connected,false);timers.shift()();send(streams[1]);assert.equal(connected,true);
 const count=changes;streams[0].dispatchEvent(new MessageEvent('unavailable',{data:'{}'}));assert.equal(connected,true);assert.equal(changes,count);
 streams[1].dispatchEvent(new MessageEvent('unavailable',{data:'{}'}));assert.equal(connected,false);close();
});
