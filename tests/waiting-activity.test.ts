import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {processActivityText} from '../ui/waiting-status.js';

// No constructor/start, account, database, subprocess or HTTP request is used.
const config={workspace:resolve('.codex/scratch/waiting-status-review/synthetic'),runtime:resolve('.codex/scratch/waiting-status-review/synthetic/runtime'),codexHome:resolve('.codex/scratch/waiting-status-review/synthetic/home'),codexBin:'/synthetic/never-executed',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:1};
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function peer(cwd=config.workspace){
  const engine=new CodexEngine(config,{cwd,readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));
  const sent:any[]=[];engine['send']=(m:any)=>{if(m.method==='config/read')void receive({id:m.id,result:{config:{},layers:[]}});else sent.push(m);};engine.threadId='native-thread';
  const receive=(m:any)=>engine['receive'](JSON.stringify(m));
  return {engine,sent,event:(method:string,params:any={})=>receive({method,params:{threadId:'native-thread',...params}}),ack:async()=>{await flush();return receive({id:sent[0].id,result:{turn:{id:'native-turn'}}});}};
}

test('native notifications keep exact identity, hold pre-ACK events, sanitize retry and observe terminal before background query',async()=>{
  const p=peer(),events:any[]=[];
  for(const name of ['contextCompaction','turnRetry','turnTerminal','turnUnavailable'])p.engine.on(name,value=>events.push({name,...value}));
  let release!:()=>void;p.engine['refreshBackground']=()=>new Promise<void>(r=>{release=r;});
  let settled=false;const work=p.engine.turn('synthetic').then(r=>{settled=true;return r;});
  await p.event('item/started',{turnId:'native-turn',item:{id:'compact',type:'contextCompaction'}});
  assert.equal(events.length,0);await p.ack();await flush();
  assert.deepEqual(events,[{name:'contextCompaction',state:'started',threadId:'native-thread',turnId:'native-turn',itemId:'compact'}]);
  await p.event('item/started',{threadId:'wrong',turnId:'native-turn',item:{id:'wrong',type:'contextCompaction'}});
  await p.event('item/started',{turnId:'retired',item:{id:'wrong',type:'contextCompaction'}});
  assert.equal(events.length,1);
  await p.event('error',{turnId:'native-turn',willRetry:false,error:{message:'SYNTHETIC_PRIVATE_BODY'}});
  await p.event('thread/compacted',{turnId:'native-turn'});assert.equal(events.length,1);
  await p.event('error',{turnId:'native-turn',willRetry:true,error:{message:'SYNTHETIC_PRIVATE_BODY',codexErrorInfo:{unknownPrivateCode:{detail:'SYNTHETIC_PRIVATE_DETAILS'}}}});
  assert.deepEqual(events.at(-1),{name:'turnRetry',threadId:'native-thread',turnId:'native-turn'});
  await p.event('error',{turnId:'native-turn',willRetry:true,error:{message:'SYNTHETIC_PRIVATE_BODY',additionalDetails:'SYNTHETIC_PRIVATE_DETAILS',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:503}}}});
  assert.deepEqual(events.at(-1),{name:'turnRetry',threadId:'native-thread',turnId:'native-turn',connectionIssue:true});
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
  const terminal=p.event('turn/completed',{turn:{id:'native-turn',status:'completed'}});await flush();
  assert.equal(events.at(-1)!.name,'turnTerminal');assert.equal(settled,false);
  const count=events.length;await p.event('error',{turnId:'native-turn',willRetry:true,error:{message:'late'}});
  await p.event('item/started',{turnId:'native-turn',item:{id:'late',type:'contextCompaction'}});
  assert.equal(events.length,count);release();await terminal;assert.equal((await work).status,'completed');assert.equal(p.sent.length,1);
});

test('native disconnect is uncertainty, never fabricated completion or a new native request',async()=>{
  const p=peer(),events:any[]=[];p.engine.on('turnUnavailable',e=>events.push(e));
  const work=p.engine.turn('synthetic');await p.ack();await flush();
  p.engine['fail'](Error('engine_disconnected'));await assert.rejects(work,/engine_disconnected/);
  assert.deepEqual(events,[{threadId:'native-thread',turnId:'native-turn'}]);assert.equal(p.sent.length,1);
});

test('readable summaries stream before and after ACK without exposing reasoning or stale sections',async()=>{
 const p=peer(),events:any[]=[];p.engine.on('reasoningSummary',e=>events.push(e));
 const work=p.engine.turn('synthetic');
 const item=(id:string,summary:string[])=>({id,type:'reasoning',summary,content:['PRIVATE_REASONING'],encryptedContent:'PRIVATE_CIPHER'});
 try{
  await p.event('item/reasoning/summaryTextDelta',{itemId:'unbound',summaryIndex:0,delta:'STALE'});
  await p.event('item/started',{turnId:'native-turn',item:item('r',[])});
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'r',summaryIndex:0,delta:'**准备'});
  assert.equal(events.length,0);await p.ack();await flush();
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'r',summaryIndex:0,delta:'只读诊断**\nPRIVATE_BODY'});
  assert.deepEqual(events.at(-1),{threadId:'native-thread',turnId:'native-turn',text:'准备只读诊断'});
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'r',summaryIndex:1,delta:'**核查结果**'});
  const count=events.length;
  for(const summaryIndex of [-1,0,1.5,Number.MAX_SAFE_INTEGER+1,null,'1'])await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'r',summaryIndex,delta:'STALE'});
  await p.event('item/reasoning/textDelta',{turnId:'native-turn',itemId:'r',contentIndex:0,delta:'PRIVATE_REASONING'});
  await p.event('item/reasoning/summaryTextDelta',{threadId:'wrong',turnId:'native-turn',itemId:'r',summaryIndex:2,delta:'STALE'});
  await p.event('item/reasoning/summaryTextDelta',{turnId:'old',itemId:'r',summaryIndex:2,delta:'STALE'});
  assert.equal(events.length,count);
  await p.event('item/completed',{turnId:'native-turn',item:item('r',['准备只读诊断','**已核对源码**'])});
  assert.equal(events.at(-1).text,'已核对源码');
  await p.event('item/started',{turnId:'native-turn',item:item('middle',['**开始快照**'])});
  assert.equal(events.at(-1).text,'开始快照');
  await p.event('item/started',{turnId:'native-turn',item:item('new',[])});
  assert.equal(events.at(-1).text,'开始快照');
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'new',summaryIndex:0,delta:'长'.repeat(5000)});
  assert.equal(events.at(-1).text,'长'.repeat(80)+'…');
  assert.equal(p.engine['active']?.reasoningSummary?.text.length,4096);
  const latest=events.length;
  await p.event('item/completed',{turnId:'native-turn',item:item('r',['STALE'])});
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'r',summaryIndex:4,delta:'STALE'});
  assert.equal(events.length,latest);
  await p.event('error',{turnId:'native-turn',willRetry:true,error:{message:'synthetic'}});
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'new',summaryIndex:0,delta:'REPLAYED'});
  assert.equal(events.length,latest);
  await p.event('item/completed',{turnId:'native-turn',item:item('new',['**快照校准**'])});
  assert.equal(events.at(-1).text,'快照校准');assert.doesNotMatch(JSON.stringify(events),/PRIVATE|STALE|REPLAYED/);
 }finally{
  if(!p.engine.turnId){await p.ack();await flush();}
  await p.event('turn/completed',{turn:{id:'native-turn',status:'completed'}});await work;
 }
 const count=events.length;await p.event('item/completed',{turnId:'native-turn',item:item('late',['LATE'])});assert.equal(events.length,count);
});

test('a completed readable summary works without a started item and malformed snapshots are ignored',async()=>{
 const p=peer(),events:any[]=[];p.engine.on('reasoningSummary',e=>events.push(e));
 const work=p.engine.turn('synthetic');await p.ack();await flush();
 try{
  await p.event('item/completed',{turnId:'native-turn',item:{id:'snapshot',type:'reasoning',summary:['','**只有完成快照**']}});
  assert.equal(events.at(-1)?.text,'只有完成快照');
  const completed=events.length;
  await p.event('item/started',{turnId:'native-turn',item:{id:'snapshot',type:'reasoning',summary:['STALE_START']}});
  await p.event('item/reasoning/summaryTextDelta',{turnId:'native-turn',itemId:'snapshot',summaryIndex:1,delta:'LATE'});
  await p.event('item/reasoning/summaryPartAdded',{turnId:'native-turn',itemId:'snapshot',summaryIndex:2});
  assert.equal(events.length,completed);
  const count=events.length;
  for(const summary of [null,{},[42],['']])await p.event('item/completed',{turnId:'native-turn',item:{id:'snapshot',type:'reasoning',summary}});
  assert.equal(events.length,count);
 }finally{await p.event('turn/completed',{turn:{id:'native-turn',status:'completed'}});await work;}
});

test('complete-only new items advance while previously observed items cannot reclaim the title',async()=>{
 const p=peer(),events:any[]=[];p.engine.on('reasoningSummary',e=>events.push(e));
 const work=p.engine.turn('synthetic');await p.ack();await flush();
 const item=(id:string,text:string)=>({id,type:'reasoning',summary:[text]});
 try{
  await p.event('item/completed',{turnId:'native-turn',item:item('a','摘要 A')});
  await p.event('item/completed',{turnId:'native-turn',item:item('b','摘要 B')});
  assert.equal(events.at(-1)?.text,'摘要 B');
  await p.event('item/started',{turnId:'native-turn',item:item('c','摘要 C')});
  const count=events.length;
  for(const method of ['item/started','item/completed'])await p.event(method,{turnId:'native-turn',item:item('a','STALE')});
  assert.equal(events.length,count);
  await p.event('item/started',{turnId:'native-turn',item:item('d','摘要 D')});
  await p.event('item/completed',{turnId:'native-turn',item:item('c','STALE')});
  assert.equal(events.at(-1)?.text,'摘要 D');
 }finally{await p.event('turn/completed',{turn:{id:'native-turn',status:'completed'}});await work;}
});

function host(){
  const hostConfig={...config,workspace:process.cwd()};
  const app=Object.create(Homer.prototype) as any;
  const engine=new EventEmitter() as any;engine.threadId='native-thread';engine.available=true;
  let finish!:(value:any)=>void;
  engine.turn=async(_text:string,options:any)=>{engine.turnId='native-turn';options.onStarted(engine.turnId);return new Promise(r=>{finish=r;});};
  Object.assign(app,{config:hostConfig,prompts:{main:'synthetic'},factory:()=>engine,stateObservers:new Set(),mainBroken:false,mainSuspended:[],workers:new Map(),closing:false,mcpOptions:()=>({}),recoverMain:async()=>{},refreshMainCapabilities:async()=>{},validateMainMemory:()=>{},mainActor:()=>({}),memory:{settings:()=>({epoch:0,enabled:true}),snapshot:()=>({entries:[],epoch:0})},tasks:{pending:{summary:()=>({totalOpen:0})}},store:{db:{exec:()=>{}},meta:(key:string)=>key==='mainThread'?'public-thread':undefined,setMeta:()=>{}},processes:{start:()=>true,list:()=>[],finish:()=>{}},history:{record:()=>{},list:()=>[]},inputs:{list:()=>[],started:()=>{}},mainApprovals:{end:()=>{}},finishMainProcess:()=>{},emitMain:()=>{}});
  app.main=app.createMain(hostConfig.workspace);
  app.store.transaction=(work:()=>unknown)=>work();
  app.history.acceptedRequestIds=()=>[];
  app.processes.uncertain=()=>{};
  app.processes.turnTiming=()=>{};
  return {app,engine,finish:(value:any)=>finish(value)};
}

test('main summaries are transient, deduplicated and fenced by current context',async()=>{
 const h=host();
 assert.equal(h.app.conversationControlState().mainActivity,null);
 let changes=0;h.app.onStateChange(()=>changes++);
 const work=h.app.mainTurn('synthetic',{event:true,allowEmptyReply:true,inspected:new Set()});await flush();
 const fact={threadId:'native-thread',turnId:'native-turn'},state=()=>h.app.conversationControlState();
 try{
  h.engine.emit('reasoningSummary',{...fact,text:'准备只读诊断'});assert.equal(state().mainActivity.summary,'准备只读诊断');
  assert.equal(JSON.parse(JSON.stringify(state())).mainActivity.summary,'准备只读诊断');
  const count=changes;
  for(const patch of [{},{text:''},{turnId:'old'},{threadId:'other'}])h.engine.emit('reasoningSummary',{...fact,text:'准备只读诊断',...patch});
  const current=h.app.main;h.app.main=new EventEmitter();h.engine.emit('reasoningSummary',{...fact,text:'STALE'});h.app.main=current;
  const context=h.app.mainContext;h.app.mainContext={nativeActivity:{turnId:'new-turn'}};h.engine.emit('reasoningSummary',{...fact,text:'STALE'});h.app.mainContext=context;
  assert.equal(changes,count);
  h.engine.emit('contextCompaction',{...fact,itemId:'compact',state:'started'});assert.equal(state().mainActivity.summary,undefined);
  h.engine.emit('contextCompaction',{...fact,itemId:'compact',state:'completed'});assert.equal(state().mainActivity.summary,'准备只读诊断');
  h.engine.emit('turnRetry',fact);assert.equal(state().mainActivity.summary,undefined);
  h.engine.emit('reasoningSummary',{...fact,text:'新的快照'});assert.equal(state().mainActivity.summary,'新的快照');
  h.engine.emit('turnRetry',fact);assert.equal(state().mainActivity.summary,undefined);
  h.engine.emit('turnTerminal',fact);h.engine.emit('reasoningSummary',{...fact,text:'LATE'});assert.equal(state().mainActivity.summary,undefined);
 }finally{h.finish({status:'completed',text:''});await work;}
 assert.equal(state().mainActivity,null);
 const next=h.app.mainTurn('synthetic',{event:true,allowEmptyReply:true,inspected:new Set()});await flush();
 assert.equal(state().mainActivity.summary,undefined);
 h.engine.emit('reasoningSummary',{...fact,text:'新轮'});h.engine.emit('turnUnavailable',fact);assert.equal(state().mainActivity.summary,undefined);
 h.engine.emit('reasoningSummary',{...fact,text:'LATE'});assert.equal(state().mainActivity.summary,undefined);
 h.finish({status:'completed',text:''});await next;
});

test('native summary events survive a fresh client snapshot without becoming process history',async()=>{
 const p=peer(process.cwd()),h=host();h.app.factory=()=>p.engine;h.app.main=h.app.createMain(process.cwd());
 const context:any={event:true,allowEmptyReply:true,inspected:new Set()};
 const work=h.app.mainTurn('synthetic',context);await flush();await p.ack();await flush();
 try{
  await p.event('item/completed',{turnId:'native-turn',item:{id:'r',type:'reasoning',summary:['**准备只读诊断**']}});
  const snapshot=JSON.parse(JSON.stringify(h.app.conversationControlState()));
  const node:any={id:context.processId,threadId:'native-thread',sourceKind:'worker',state:'working',status:'running',turnIds:['native-turn'],items:[]};
  const state:any={...snapshot,threadId:'native-thread',processNodes:[node],upgrade:{phase:'running'},interactions:[]};
  assert.equal(processActivityText(state,true,node),'准备只读诊断');assert.deepEqual(h.app.processes.list(),[]);
  assert.equal(host().app.conversationControlState().mainActivity,null);
 }finally{await p.event('turn/completed',{turn:{id:'native-turn',status:'completed'}});await work;}
});

test('current main context owns monotone compaction evidence, not Worker state or stale engine/turns',async()=>{
  const h=host(),context:any={event:true,allowEmptyReply:true,inspected:new Set()};let changes=0;h.app.onStateChange(()=>changes++);
  const work=h.app.mainTurn('synthetic',context);await flush();
  const state=()=>h.app.conversationControlState();
  assert.equal(state().isRunning,false);assert.equal(state().activeMessageId,null);
  assert.equal(state().mainActivity.source,'internal');assert.equal(state().mainActivity.stage,'native');
  const fact={threadId:'native-thread',turnId:'native-turn',itemId:'compact'};
  h.engine.emit('contextCompaction',{...fact,state:'started'});assert.equal(state().mainActivity.stage,'compacting');
  const first=changes;h.engine.emit('contextCompaction',{...fact,state:'started'});assert.equal(changes,first);
  h.engine.emit('contextCompaction',{...fact,turnId:'retired',state:'completed'});assert.equal(state().mainActivity.stage,'compacting');
  h.engine.emit('contextCompaction',{...fact,state:'completed'});h.engine.emit('contextCompaction',{...fact,state:'started'});assert.equal(state().mainActivity.stage,'native');
  h.engine.emit('contextCompaction',{...fact,itemId:'end-first',state:'completed'});h.engine.emit('contextCompaction',{...fact,itemId:'end-first',state:'started'});assert.equal(state().mainActivity.stage,'native');
  h.engine.emit('turnRetry',{...fact,connectionIssue:true,message:'PRIVATE'});assert.equal(state().mainActivity.retryObserved,true);assert.ok(!JSON.stringify(state().mainActivity).includes('PRIVATE'));
  h.engine.emit('turnTerminal',fact);assert.equal(state().mainActivity.stage,'finishing');assert.equal(context.terminalConfirmed,false);assert.equal(state().mainActivity.retryObserved,undefined);
  h.engine.emit('turnUnavailable',fact);assert.equal(state().mainActivity.stage,'finishing');
  h.engine.emit('contextCompaction',{...fact,itemId:'late',state:'started'});assert.equal(state().mainActivity.stage,'finishing');
  const current=h.app.main;h.app.main=new EventEmitter();h.engine.emit('turnUnavailable',fact);h.app.main=current;assert.equal(state().mainActivity.stage,'finishing');
  h.finish({status:'completed',text:''});await work;assert.equal(state().mainActivity,null);
  // Worker changes cannot invent a reception context after the native main turn.
  h.app.workers.set('synthetic-worker',{});assert.equal(state().mainActivity,null);assert.equal(state().isRunning,false);
});

test('main uncertainty clears live detail, and a fresh context does not resurrect old compaction or retries',async()=>{
  const h=host(),context:any={event:true,allowEmptyReply:true,inspected:new Set()};const work=h.app.mainTurn('synthetic',context);await flush();
  const fact={threadId:'native-thread',turnId:'native-turn'};
  h.engine.emit('contextCompaction',{...fact,itemId:'compact',state:'started'});h.engine.emit('turnUnavailable',fact);
  assert.equal(h.app.conversationControlState().mainActivity.stage,'unknown');
  h.engine.emit('contextCompaction',{...fact,itemId:'compact',state:'started'});assert.equal(h.app.conversationControlState().mainActivity.stage,'unknown');
  h.finish({status:'completed',text:''});await work;
  const next=h.app.mainTurn('synthetic',{event:true,allowEmptyReply:true,inspected:new Set()});await flush();
  assert.equal(h.app.conversationControlState().mainActivity.stage,'native');assert.equal(h.app.conversationControlState().mainActivity.retryObserved,undefined);
  h.finish({status:'completed',text:''});await next;
});
