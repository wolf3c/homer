import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {historyFixture} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import type {Homer} from '../src/service.js';
import {isVisibleConversationMessage} from '../ui/chat-date.js';

test('queueMoveBefore uses the final source index and a same-segment global successor',async()=>{
 const {queueMoveBefore}=await import('../ui/queue-operations.js');
 const row=(messageId:string,nextMessageId:string|null|undefined,movable=true,state='queued')=>({messageId,nextMessageId,movable,state}) as Parameters<typeof queueMoveBefore>[0][number];
 const items=[row('A','B'),row('B','C'),row('C','locked'),row('locked','D',false),row('D','E'),row('E','unloaded')];
 assert.equal(queueMoveBefore(items,'C',2,0),'A');
 assert.equal(queueMoveBefore(items,'A',0,1),'C');
 assert.equal(queueMoveBefore(items,'A',0,2),'locked');
 assert.equal(queueMoveBefore(items,'D',0,1),'unloaded','page end uses the global pending successor');
 assert.equal(queueMoveBefore([row('A','B'),row('B',null)],'A',0,1),null);
 for(const [id,from,to] of [['A',0,0],['A',1,2],['A',0,3],['A',-1,1],['A',0,0.5],['A',0,Infinity],['locked',0,1],['missing',0,1],['D',4,5]] as const)assert.equal(queueMoveBefore(items,id,from,to),undefined,`${id} ${from}->${to}`);
 assert.equal(queueMoveBefore([row('A','B'),row('B',undefined)],'A',0,1),undefined,'missing successor fails closed');
 assert.equal(queueMoveBefore([row('A','B'),row('busy','B',true,'processing'),row('B',null)],'A',0,1),undefined,'nonqueued display rows are barriers');
});

// Unit lifecycle harness for the production owners/handlers. No DOM or browser claims.
// Only React lifecycle and the transport are controlled; queuePost/storage/owner run unchanged.
function hookHost(file:string,modules:Record<string,unknown>={}){
 const slots:any[]=[];let cursor=0,effects:(()=>void)[]=[],dirty=false,value:any;
 const react={
  useState(initial:unknown){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];},
  useRef(initial:unknown){const i=cursor++;return slots[i]??=( {current:initial});},
  useId(){const i=cursor++;return slots[i]??=`test-id-${i}`;},
  useEffect(fn:()=>void|(()=>void),deps:unknown[]=[]){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
  useLayoutEffect(fn:()=>void|(()=>void),deps:unknown[]=[]){react.useEffect(fn,deps);},
 };
 const exports:any={},js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',js)((id:string)=>id==='react'?react:id==='./chat-date'?{isVisibleConversationMessage}:modules[id]??(()=>{throw Error('unexpected unit import '+id);})(),exports);
 return {exports,render(fn:()=>unknown){let count=0;do{cursor=0;effects=[];dirty=false;value=fn();for(const effect of effects)effect();assert.ok(++count<20,'unit lifecycle settles');}while(dirty);return value;},unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
function ownerUnit(t:any,transport:(path:string,input:any,signal?:AbortSignal)=>Promise<Response>){
 const storage=new Map<string,string>(),events=new EventTarget();
 for(const [key,value] of Object.entries({sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},window:events})){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete (globalThis as any)[key]);
 }
 const host=hookHost('ui/queue-operations.ts',{'./web-connection-client.js':{connectionFetch:(path:string,init:RequestInit)=>transport(path,JSON.parse(init.body as string),init.signal??undefined)}});
 let state:any={threadId:'T1',history:{readEpoch:'E1'},queueDispatch:{orderVersion:'V1'}};
 const render=()=>host.render(()=>host.exports.useQueueOperations(state,true));render();
 t.after(()=>host.unmount());return {storage,host,render,scope:(threadId:string)=>{state={...state,threadId};return render();}};
}
const settle=()=>new Promise<void>(done=>setImmediate(done));
test('move owner times out only move, keeps exact unknown identity, then automatically reads its receipt once',async t=>{
 const deadlines:{ms:number;controller:AbortController}[]=[],writes:any[]=[],reads:any[]=[];let committed=false;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{const controller=new AbortController();deadlines.push({ms,controller});return controller.signal;});
 const unit=ownerUnit(t,async(path,input,signal)=>{
  if(path.endsWith('/move')){writes.push(input);return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
  reads.push(input);return Response.json({operations:[{messageId:'M',operationId:'original',committed,result:committed?{changed:true}:undefined}]});
 });
 const payload={messageId:'M',operationId:'original',expectedRevision:7,expectedOrderVersion:'V1',beforeMessageId:'unloaded',threadId:'T1',readEpoch:'E1'};
 const flight=unit.render().run('move',payload);unit.render();await settle();
 assert.ok(unit.render().busy);assert.ok(unit.render().locked);assert.equal(deadlines[0]?.ms,15000,'move POST has a bounded wait');
 assert.equal(reads.length,1,'the initial automatic read can precede the write commit');
 committed=true;deadlines[0]!.controller.abort(new DOMException('Synthetic timeout','TimeoutError'));await flight;await settle();
 assert.equal(writes.length,1,'unknown never replays a write');assert.equal(reads.length,2,'unknown move settlement reads the original receipt again');
 assert.deepEqual(reads[1].operations,[{messageId:'M',operationId:'original'}]);assert.deepEqual(writes[0],payload);
 assert.equal(unit.render().locked,false);assert.equal(unit.render().busy,false);assert.equal(unit.storage.size,0);
 assert.ok(deadlines.every(item=>item.ms===15000));
});
test('unknown move retains its exact payload and lock; edit/cancel gain no deadline; old scope cannot clear new pending',async t=>{
 const deadlines:AbortController[]=[],writes:{path:string;input:any;signal?:AbortSignal}[]=[];let release:((value:Response)=>void)|undefined;
 t.mock.method(AbortSignal,'timeout',()=>{const controller=new AbortController();deadlines.push(controller);return controller.signal;});
 const unit=ownerUnit(t,async(path,input,signal)=>{
  if(path.endsWith('/receipts'))return Response.json({operations:[{messageId:input.operations[0].messageId,operationId:input.operations[0].operationId,committed:false}]});
  writes.push({path,input,signal});return new Promise((resolve,reject)=>{release=resolve;signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 });
 const payload={messageId:'M',operationId:'unknown',expectedRevision:1,threadId:'T1',readEpoch:'E1',expectedOrderVersion:'V1',beforeMessageId:null};
 const flight=unit.render().run('move',payload);unit.render();await settle();assert.ok(deadlines.length);
 deadlines[0]!.abort();await flight;await settle();assert.equal(unit.render().busy,false);assert.equal(unit.render().locked,true);
 assert.deepEqual(JSON.parse(unit.storage.get('homer-queue-operation:T1')!),{action:'move',payload});
 await unit.render().run('move',{...payload,operationId:'forbidden'});assert.equal(writes.length,1);
 unit.scope('T2');const cancel={requestId:'C',operationId:'cancel-T2'};
 const other=unit.render().run('cancel',cancel);unit.render();assert.equal(writes.at(-1)!.signal,undefined);release!(Response.json({changed:true}));await other;await settle();assert.equal(unit.render().locked,false);
 const edit=unit.render().run('edit',{requestId:'D',operationId:'edit-T2'});unit.render();assert.equal(writes.at(-1)!.signal,undefined);
 unit.storage.set('homer-queue-operation:T3',JSON.stringify({action:'cancel',payload:{requestId:'C3',operationId:'third'}}));unit.scope('T3');release!(Response.json({changed:true}));await edit;await settle();
 assert.equal(unit.render().pending.payload.operationId,'third','old response cannot finish a different scope pending');
 assert.ok(unit.storage.has('homer-queue-operation:T1'));assert.equal(writes.length,3);
});
test('queue drag handlers write once using source final index; cancellation, barriers and stale scopes write zero',async t=>{
 const {queueMoveBefore}=await import('../ui/queue-operations.js');
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldFrame=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});Object.defineProperty(globalThis,'requestAnimationFrame',{value:()=>0,configurable:true});
 t.after(()=>{for(const [name,descriptor] of [['window',oldWindow],['requestAnimationFrame',oldFrame]] as const)descriptor?Object.defineProperty(globalThis,name,descriptor):delete (globalThis as any)[name];});
 const item=(messageId:string,nextMessageId:string|null)=>({messageId,nextMessageId,state:'queued',movable:true,editable:true,revision:3,position:1,origin:'worker',text:'Same summary'});
 for(const scenario of ['valid','observed-at','cancel','same','no-target','cross-group','new-message','claim','delete','thread','epoch','capability','locked','disconnect','editor','unmount']){
  const writes:any[]=[],items=[item('A','B'),item('B','C'),item('C','unloaded')];
  let state:any={threadId:'T',messages:[],features:{queueSources:1},history:{readEpoch:'E'},queueDispatch:{orderVersion:'V',totalWaiting:3}},connected=true,editorBusy=false;
  const page={items,threadId:'T',readEpoch:'E',orderVersion:'V',nextCursor:null,totalWaiting:3};
  const jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
  const host=hookHost('ui/homer-message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronRightIcon:'chevron'},'@dnd-kit/react':{DragDropProvider:'provider'},'@dnd-kit/react/sortable':{isSortable:(source:any)=>source?.initialIndex!==undefined},'@dnd-kit/abstract/modifiers':{RestrictToVerticalAxis:{}},'./vendor/assistant-ui/message-queue':{MessageQueue:'queue'},'./queue-operations':{queueMoveBefore,queuePost:async()=>page},'./homer-message-queue.css':{}});
  const operations={locked:false,run:async(action:string,payload:unknown)=>{writes.push({action,payload});}},render=()=>host.render(()=>host.exports.HomerMessageQueue({state,connected,editorBusy,operations}));
  render();await settle();const tree=render();
  const find=(node:any):any=>node?.type==='provider'?node:Array.isArray(node)?node.map(find).find(Boolean):node?.props?find(node.props.children):undefined;
  const provider=find(tree);assert.ok(provider,scenario+' has a drag provider');
  const source={id:'A',initialIndex:0,index:2,initialGroup:'A',group:'A'};
  provider.props.onDragStart({operation:{source}});render();
  if(scenario==='same')source.index=0;if(scenario==='cross-group')source.group='other';
  if(['new-message','claim','delete'].includes(scenario))state={...state,queueDispatch:{...state.queueDispatch,orderVersion:'V2'}};
  if(scenario==='thread')state={...state,threadId:'other'};if(scenario==='disconnect')connected=false;if(scenario==='editor')editorBusy=true;
  if(scenario==='epoch')state={...state,history:{readEpoch:'new-epoch'}};if(scenario==='capability')state={...state,features:{}};if(scenario==='locked')operations.locked=true;if(scenario==='observed-at')state={...state,observedAtMs:999};
  if(scenario==='unmount')host.unmount();else render();
  provider.props.onDragEnd({canceled:scenario==='cancel',operation:{source,target:scenario==='no-target'?null:{id:'A'}}});
  provider.props.onDragEnd({operation:{source,target:{id:'A'}}});
  assert.equal(writes.length,['valid','observed-at'].includes(scenario)?1:0,scenario);
  if(['valid','observed-at'].includes(scenario)){
   assert.equal(writes[0].action,'move');assert.deepEqual({...writes[0].payload,operationId:'generated'},{messageId:'A',expectedRevision:3,threadId:'T',readEpoch:'E',expectedOrderVersion:'V',beforeMessageId:'unloaded',operationId:'generated'});
  }
  host.unmount();
 }
});
test('queue header counts every loaded row across states and pages without replaying messages',async t=>{
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 const jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
 const find=(node:any,predicate:(node:any)=>boolean):any=>predicate(node)?node:Array.isArray(node)?node.map(child=>find(child,predicate)).find(Boolean):node?.props?find(node.props.children,predicate):undefined;
 const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
 const items=Array.from({length:4},(_,index)=>({messageId:'M'+index,origin:index===2?'user':'worker',state:'queued',movable:true,editable:true,revision:0,position:index+1,text:'Worker report '+index,input:{requestId:'U'+index,text:'User input '+index}}));
 let page:any,state:any;const reads:string[]=[],writes:unknown[]=[];
 const host=hookHost('ui/homer-message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronRightIcon:'chevron'},'@dnd-kit/react':{DragDropProvider:'provider'},'@dnd-kit/react/sortable':{isSortable:()=>true},'@dnd-kit/abstract/modifiers':{RestrictToVerticalAxis:{}},'./vendor/assistant-ui/message-queue':{MessageQueue:'queue'},'./queue-operations':{queuePost:async(path:string)=>{reads.push(path);return page;},queueMoveBefore:()=>undefined},'./homer-message-queue.css':{}});
 const rows=hookHost('ui/vendor/assistant-ui/message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{BotIcon:'bot',UserRoundIcon:'user',XIcon:'cancel'},'@dnd-kit/react/sortable':{useSortable:()=>({})},'./message-queue.css':{}});
 t.after(()=>{host.unmount();rows.unmount();oldWindow?Object.defineProperty(globalThis,'window',oldWindow):delete (globalThis as any).window;});
 const render=()=>host.render(()=>host.exports.HomerMessageQueue({state,connected:true,operations:{locked:false,run:async(...args:unknown[])=>{writes.push(args);}}}));
 for(const [index,scenario] of [{first:'queued',total:4},{first:'processing',total:3},{first:'uncertain',total:3},{first:'uncertain',total:0,onlyFirst:true},{first:'uncertain',total:103},{first:'uncertain',total:3,awaitingUser:true}].entries()){
  const source=(scenario.onlyFirst?items.slice(0,1):items).map((item,i)=>({...item,state:i===0?scenario.first:item.state}));
  page={threadId:'T',readEpoch:'E',orderVersion:'V'+index,items:source,totalWaiting:scenario.total,nextCursor:scenario.total===103?'next':null};
  state={threadId:'T',messages:[],features:{queueSources:1},history:{readEpoch:'E'},queueDispatch:{orderVersion:page.orderVersion,totalWaiting:scenario.total,...(scenario.awaitingUser?{awaitingUser:true}:{})}};
  const before=JSON.stringify(page);render();await settle();const tree=render();
  const toggle=find(tree,node=>node?.type==='button'&&node.props.className==='queue-toggle');
  assert.equal(text(toggle),'消息队列 · 已加载 '+source.length+' 条','header and rendered rows use the same snapshot, including processing/unknown rows and partial pages');
  state={...state,queueDispatch:{...state.queueDispatch,totalWaiting:999}};
  assert.equal(text(find(render(),node=>node?.props?.className==='queue-toggle')),text(toggle),'a summary update cannot relabel the still-rendered page');
  assert.equal(toggle.props['aria-expanded'],false,'every queue defaults to collapsed, independently of dispatch state');
  if(scenario.awaitingUser){
   toggle.props.onClick();let updated=render();
   assert.equal(find(updated,node=>node?.props?.className==='queue-toggle').props['aria-expanded'],true);
   window.dispatchEvent(new Event('homer-queue-updated'));render();await settle();updated=render();
   assert.equal(find(updated,node=>node?.props?.className==='queue-toggle').props['aria-expanded'],true,'refresh preserves manual expansion');
   find(updated,node=>node?.props?.className==='queue-toggle').props.onClick();render();
   state={...state,queueDispatch:{...state.queueDispatch,awaitingUser:undefined}};
   assert.equal(find(render(),node=>node?.props?.className==='queue-toggle').props['aria-expanded'],false,'manual collapse survives resume');
  }
  assert.equal(text(tree).includes('发送消息，说明如何继续'),false,'resume hint belongs in the composer placeholder, not a queue row');
  const queue=find(tree,node=>node?.type==='queue');
  assert.deepEqual(queue.props.messages.map((item:any)=>[item.id,item.state]),source.map(item=>[item.messageId,item.state]),'original identity, state and barrier order survive projection');
  assert.equal(queue.props.messages[0].text,source[0]!.text,'the Worker icon identifies the source without adding a text prefix');
  const list=rows.exports.MessageQueue(queue.props).props.children.props.children;
  const first=list[0].type(list[0].props);
  assert.equal(first.props['data-queue-state'],scenario.first);
  if(scenario.first!=='queued'){
   assert.equal(find(first,node=>node?.props?.className==='aui-queue-state'),undefined,'no extra state label');
   assert.equal(find(first,node=>node?.type==='button'),undefined,'claimed/unknown rows have no send, move or cancel action');
  }
  assert.equal(JSON.stringify(page),before,'display never changes a receipt or page');
 }
 assert.deepEqual(writes,[]);assert.ok(reads.length>0&&reads.every(path=>path==='/api/history/queue'),'only read-only history requests');
});
test('queue rows bind segment-local sortable type/accept and disable both barrier and singleton drag/drop',()=>{
 const bindings:any[]=[],jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
 const host=hookHost('ui/vendor/assistant-ui/message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{BotIcon:'bot',UserRoundIcon:'user',XIcon:'cancel'},'@dnd-kit/react/sortable':{useSortable:(input:unknown)=>{bindings.push(input);return {ref:()=>{},handleRef:()=>{},isDragging:false};}},'./message-queue.css':{}});
 const messages=[['A',true],['B',true],['barrier',false],['C',true],['D',true],['processing',true],['solo',true]].map(([id,movable],index)=>({id,origin:index===1?'worker':'user',state:id==='processing'?'processing':'queued',text:'Same summary',position:index+81,movable,cancellable:id==='processing'}));
 const tree=host.exports.MessageQueue({messages,dragDisabled:false,onCancel:()=>assert.fail('no cancellation for a claimed row')}),rows=tree.props.children.props.children;
 const rendered=rows.map((node:any)=>typeof node.type==='function'?node.type(node.props):node);
 assert.deepEqual(bindings.map(({id,index,group,type,accept,disabled})=>({id,index,group,type,accept,disabled})),[
  {id:'A',index:0,group:'A',type:'A',accept:'A',disabled:false},{id:'B',index:1,group:'A',type:'A',accept:'A',disabled:false},
  {id:'barrier',index:0,group:'barrier',type:'barrier',accept:'barrier',disabled:true},
  {id:'C',index:0,group:'C',type:'C',accept:'C',disabled:false},{id:'D',index:1,group:'C',type:'C',accept:'C',disabled:false},
  {id:'processing',index:0,group:'processing',type:'processing',accept:'processing',disabled:true},{id:'solo',index:0,group:'solo',type:'solo',accept:'solo',disabled:true},
 ]);
 assert.match(rendered[0].props.children[0].props['aria-label'],/用户消息，第 81 条/);
 assert.match(rendered[1].props.children[0].props['aria-label'],/Worker消息，第 82 条/);
 assert.equal(rendered[2].props.children[0].type,'span','barrier has no drag handle');
 assert.equal(rendered[5].props.children[0].type,'span','claimed state blocks dragging despite movable metadata');
 assert.equal(rendered[5].props.children.at(-1),false,'claimed state blocks cancellation despite cancellable metadata');
 assert.equal(rendered[6].props.ref,undefined,'a singleton has no disabled draggable ancestor that mislabels its cancel action');
});
test('only an exact started Worker source hides a processing row without changing receipts',async t=>{
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 const jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
 const find=(node:any,predicate:(node:any)=>boolean):any=>predicate(node)?node:Array.isArray(node)?node.map(child=>find(child,predicate)).find(Boolean):node?.props?find(node.props.children,predicate):undefined;
 const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
 const worker=(messageId:string,state='processing')=>({origin:'worker',messageId,state,movable:false,revision:1,text:'同名事项'});
 const items=[worker('notice'),worker('other'),worker('uncertain','uncertain'),{origin:'user',messageId:'user',state:'queued',movable:true,editable:true,revision:0,input:{requestId:'user',text:'用户待发送'}}];
 const page={items,threadId:'T',readEpoch:'E',orderVersion:'V',totalWaiting:1,nextCursor:null},before=JSON.stringify(page);
 const process={id:'process',threadId:'T',sourceKind:'worker',sourceMessageIds:['notice','uncertain'],turnIds:['turn'],state:'working',status:'running'};
 const message={id:'process',threadId:'T',role:'assistant',status:'running',text:'',process};
 let state:any={threadId:'T',messages:[],features:{queueSources:1},history:{readEpoch:'E'},queueDispatch:{orderVersion:'V',totalWaiting:1}};
 const host=hookHost('ui/homer-message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronRightIcon:'chevron'},'@dnd-kit/react':{DragDropProvider:'provider'},'@dnd-kit/react/sortable':{isSortable:()=>false},'@dnd-kit/abstract/modifiers':{RestrictToVerticalAxis:{}},'./vendor/assistant-ui/message-queue':{MessageQueue:'queue'},'./queue-operations':{queuePost:async()=>page},'./homer-message-queue.css':{}});
 t.after(()=>{host.unmount();oldWindow?Object.defineProperty(globalThis,'window',oldWindow):delete (globalThis as any).window;});
 const render=()=>host.render(()=>host.exports.HomerMessageQueue({state,connected:true,operations:{locked:false,run:()=>assert.fail('display never writes')}}));
 render();await settle();
 for(const [name,value,hidden] of [
  ['not loaded',undefined,false],['unstarted',{...message,process:{...process,turnIds:[]}},false],
  ['other message thread',{...message,threadId:'other'},false],['other process thread',{...message,process:{...process,threadId:'other'}},false],
  ['user process',{...message,process:{...process,sourceKind:'user'}},false],['placeholder',{...message,status:'queued'},false],
  ['started',message,true],['finished before queue refresh',{...message,process:{...process,state:'worked',status:'completed'}},true],
 ] as const){
  state={...state,messages:value?[value]:[]};const tree=render(),queue=find(tree,node=>node?.type==='queue');
  assert.deepEqual(queue.props.messages.map((item:any)=>!!item.hidden),[hidden,false,false,false],name);
  assert.equal(text(find(tree,node=>node?.props?.className==='queue-toggle')),'消息队列 · 已加载 '+(hidden?3:4)+' 条',name);
 }
 state={...state,history:{readEpoch:'new-epoch'}};
 assert.equal(find(render(),node=>node?.type==='queue').props.messages[0].hidden,false,'stale queue pages cannot hide rows');
 assert.equal(JSON.stringify(page),before);
});
test('hidden Worker barriers keep the two visible movable segments separate',()=>{
 const bindings:any[]=[],jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
 const host=hookHost('ui/vendor/assistant-ui/message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{BotIcon:'bot',UserRoundIcon:'user',XIcon:'cancel'},'@dnd-kit/react/sortable':{useSortable:(input:unknown)=>{bindings.push(input);return {}; }},'./message-queue.css':{}});
 const messages=['A','B','processing','C','D'].map(id=>({id,origin:'worker',state:id==='processing'?'processing':'queued',movable:true,hidden:id==='processing',text:id}));
 const rows=host.exports.MessageQueue({messages,dragDisabled:false}).props.children.props.children;
 for(const row of rows)if(row)row.type(row.props);
 assert.deepEqual(bindings.map(({id,index,group})=>({id,index,group})),[{id:'A',index:0,group:'A'},{id:'B',index:1,group:'A'},{id:'C',index:0,group:'C'},{id:'D',index:1,group:'C'}]);
 host.unmount();
});
test('an entirely represented queue page keeps both next and home navigation',async t=>{
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
 const jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key});
 const find=(node:any,predicate:(node:any)=>boolean):any=>predicate(node)?node:Array.isArray(node)?node.map(child=>find(child,predicate)).find(Boolean):node?.props?find(node.props.children,predicate):undefined;
 const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
 const state={threadId:'T',messages:[{id:'process',threadId:'T',role:'assistant',text:'',status:'running',process:{threadId:'T',sourceKind:'worker',turnIds:['turn'],sourceMessageIds:['first','last']}}],features:{queueSources:1},history:{readEpoch:'E'},queueDispatch:{orderVersion:'V',totalWaiting:0}};
 const host=hookHost('ui/homer-message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronRightIcon:'chevron'},'@dnd-kit/react':{DragDropProvider:'provider'},'@dnd-kit/react/sortable':{isSortable:()=>false},'@dnd-kit/abstract/modifiers':{RestrictToVerticalAxis:{}},'./vendor/assistant-ui/message-queue':{MessageQueue:'queue'},'./queue-operations':{queuePost:async(_path:string,input:any)=>({threadId:'T',readEpoch:'E',orderVersion:'V',totalWaiting:0,nextCursor:input.cursor?null:'next',items:[{origin:'worker',messageId:input.cursor?'last':'first',state:'processing',text:'事项'}]})},'./homer-message-queue.css':{}});
 t.after(()=>{host.unmount();oldWindow?Object.defineProperty(globalThis,'window',oldWindow):delete (globalThis as any).window;});
 const render=()=>host.render(()=>host.exports.HomerMessageQueue({state,connected:true,operations:{locked:false}}));
 render();await settle();let tree=render();assert.equal(text(find(tree,node=>node?.props?.className==='queue-toggle')),'消息队列 · 已加载 0 条');
 find(tree,node=>node?.type==='button'&&node.props.children==='查看下一页').props.onClick();render();await settle();tree=render();
 assert.ok(find(tree,node=>node?.type==='button'&&node.props.children==='返回待发送首页'));
 assert.equal(text(find(tree,node=>node?.props?.className==='queue-toggle')),'消息队列 · 已加载 0 条');
});
test('queued focus restoration cannot scroll or focus a different page after navigation',async t=>{
 const frames:FrameRequestCallback[]=[],lookups:string[]=[];
 for(const [name,value] of Object.entries({window:new EventTarget(),CSS:{escape:(value:string)=>value},requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.push(fn);return frames.length;},document:{querySelector:(selector:string)=>{lookups.push(selector);return null;}}})){
  const old=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true});t.after(()=>old?Object.defineProperty(globalThis,name,old):delete (globalThis as any)[name]);
 }
 const jsx=(type:unknown,props:unknown,key?:string)=>({type,props,key}),state={threadId:'T',messages:[],features:{queueSources:1},history:{readEpoch:'E'},queueDispatch:{orderVersion:'V',totalWaiting:3}};
 const items=['A','B','C'].map((id,index)=>({messageId:id,state:'queued',origin:'worker',movable:true,revision:0,position:index+1,text:id,nextMessageId:['B','C','unloaded'][index]}));
 const host=hookHost('ui/homer-message-queue.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ChevronRightIcon:'chevron'},'@dnd-kit/react':{DragDropProvider:'provider'},'@dnd-kit/react/sortable':{isSortable:()=>true},'@dnd-kit/abstract/modifiers':{RestrictToVerticalAxis:{}},'./vendor/assistant-ui/message-queue':{MessageQueue:'queue'},'./queue-operations':{queuePost:async()=>({items,threadId:'T',readEpoch:'E',orderVersion:'V',nextCursor:'next'}),queueMoveBefore:()=>undefined},'./homer-message-queue.css':{}});
 const render=()=>host.render(()=>host.exports.HomerMessageQueue({state,connected:true,operations:{locked:false,run:()=>{throw Error('unexpected move');}}}));
 const find=(node:any,predicate:(node:any)=>boolean):any=>predicate(node)?node:Array.isArray(node)?node.map(child=>find(child,predicate)).find(Boolean):node?.props?find(node.props.children,predicate):undefined;
 render();await settle();let tree=render();find(tree,node=>node?.props?.className==='queue-toggle').props.onClick();tree=render();const provider=find(tree,node=>node?.type==='provider'),source={id:'A',initialIndex:0,index:1,initialGroup:'A',group:'A',element:{closest:()=>({scrollTop:66})}};
 provider.props.onDragStart({operation:{source}});render();provider.props.onDragEnd({canceled:true,operation:{source,target:{}}});tree=render();assert.equal(frames.length,1);
 find(tree,node=>node?.type==='button'&&node.props.children==='查看下一页').props.onClick();render();await settle();render();
 frames[0]!(0);assert.equal(lookups.length,0,'stale scheduled restoration must not touch the new page');host.unmount();
});
test('move receipt deadlines, mismatched identities and unmount never clear unknown pending',async t=>{
 const deadlines:AbortController[]=[];let mode='hang',writes=0;
 t.mock.method(AbortSignal,'timeout',()=>{const controller=new AbortController();deadlines.push(controller);return controller.signal;});
 const unit=ownerUnit(t,async(path,input,signal)=>{
  if(!path.endsWith('/receipts')){writes++;throw Error('Synthetic lost response');}
  if(mode==='hang')return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  return Response.json({operations:[{messageId:'wrong-message',operationId:input.operations[0].operationId,committed:true,result:{changed:true}}]});
 });
 const payload={messageId:'original-message',operationId:'original-operation'};
 await unit.render().run('move',payload);unit.render();await settle();
 assert.equal(unit.render().busy,false);assert.equal(unit.render().locked,true);
 for(const deadline of deadlines)deadline.abort();await settle();assert.equal(unit.render().locked,true,'receipt timeout does not clear pending');
 mode='mismatch';unit.scope('other');unit.scope('T1');await settle();assert.equal(unit.render().locked,true,'a committed receipt for another message cannot finish this operation');
 unit.host.unmount();assert.deepEqual(JSON.parse(unit.storage.get('homer-queue-operation:T1')!),{action:'move',payload});assert.equal(writes,1);
});

function host(){
 const f=historyFixture(0),reader=new WebHistoryPages(f.history,f.processes,f.inputs);
 for(const requestId of ['B','C','D'])f.inputs.accept({requestId,text:'合成 '+requestId});
 return {...f,webReadEpoch:'queue-epoch',registerWebSurface(){},webHistoryPages:()=>reader,onStateChange(){return()=>{};},media:{view(){throw Error('no-media');}},conversationControlState:()=>({isRunning:false,activeMessageId:null}),editQueued:f.inputs.edit.bind(f.inputs),cancelQueued:f.inputs.cancel.bind(f.inputs),moveQueued:f.inputs.move.bind(f.inputs)};
}
test('unified messageId HTTP move confirms exact receipt after claim and preserves normal edit/cancel',async()=>{
 const app=host(),server=await createWebServer({bridge:homerWebBridge(app as unknown as Homer),port:0});
 const post=async(path:string,input:unknown)=>{const response=await fetch(server.url+path,{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,value:await response.json()};};
 try{
  const page=(await post('/api/history/queue',{view:'dispatch-v1',sources:'all',readEpoch:app.webReadEpoch})).value,source=page.items[2];
  const operation={messageId:source.messageId,operationId:'unified-http',expectedRevision:source.revision,expectedOrderVersion:page.orderVersion,beforeMessageId:page.items[0].messageId,threadId:'synthetic-history',readEpoch:app.webReadEpoch};
  const hashes=app.store.db.prepare('SELECT requestId,hash FROM conversation_inputs ORDER BY requestId').all(),moved=await post('/api/messages/move',operation);assert.equal(moved.status,200);
  assert.equal(app.inputs.claim([],'all')!.messageId,source.messageId);
  const receipts=(await post('/api/history/receipts',{requestIds:[],operations:[{messageId:source.messageId,operationId:operation.operationId}],threadId:'synthetic-history',readEpoch:app.webReadEpoch})).value;
  assert.equal(receipts.operations[0].messageId,source.messageId);assert.equal(receipts.operations[0].committed,true);assert.deepEqual(receipts.operations[0].result,moved.value);
  assert.deepEqual(app.store.db.prepare('SELECT requestId,hash FROM conversation_inputs ORDER BY requestId').all(),hashes);
  const current=app.inputs.dispatchPage(undefined,app.webReadEpoch,'all'),row=current.items.find(item=>item.origin==='user'&&item.input.requestId==='C')!;
  assert.equal((await post('/api/messages/edit',{requestId:'C',operationId:'normal-edit',expectedRevision:row.revision,threadId:'synthetic-history',readEpoch:app.webReadEpoch,input:{requestId:'C',text:'Edited queued content'}})).status,200);
  const edited=app.inputs.byRequestIds(['C'])[0]!;assert.equal(edited.input.text,'Edited queued content');
  assert.equal((await post('/api/messages/cancel',{requestId:'C',operationId:'normal-cancel',expectedRevision:edited.revision,threadId:'synthetic-history',readEpoch:app.webReadEpoch})).status,200);
  assert.equal(app.inputs.byRequestIds(['C'])[0]!.state,'cancelled');
 }finally{await server.close();app.close();}
});
test('dispatch HTTP: scope, move, exact operation receipt, current state and legacy numeric page coexist',async()=>{
 const app=host(),bridge=homerWebBridge(app as unknown as Homer),server=await createWebServer({bridge,port:0});
 const post=async(path:string,value:unknown,origin=server.url)=>{const r=await fetch(server.url+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,value:await r.json()};};
 try{
  const page=(await post('/api/history/queue',{view:'dispatch-v1',readEpoch:app.webReadEpoch})).value;
  assert.equal(page.totalWaiting,3);assert.equal(page.items[0].user.text,'合成 B');assert.equal(page.items[2].segmentStartRequestId,'B');
  const operation={threadId:'synthetic-history',readEpoch:app.webReadEpoch,requestId:'D',operationId:'move',expectedRevision:0,expectedOrderVersion:page.orderVersion,beforeRequestId:'B'};
  assert.equal((await post('/api/messages/move',operation,'https://untrusted.invalid')).status,403);
  assert.equal((await post('/api/messages/move',{...operation,threadId:'wrong'})).value.error,'queue_thread_conflict');
  const moved=await post('/api/messages/move',operation);assert.equal(moved.status,200);
  const legacy=(await post('/api/history/queue',{after:0,readEpoch:app.webReadEpoch})).value;assert.deepEqual(legacy.items.map((i:{input:{requestId:string}})=>i.input.requestId),['B','C','D']);
  assert.deepEqual((await post('/api/history/queue',{view:'dispatch-v1',readEpoch:app.webReadEpoch})).value.items.map((i:{input:{requestId:string}})=>i.input.requestId),['D','B','C']);
  const claimed=app.inputs.claim()!;
  const receipt=(await post('/api/history/receipts',{requestIds:['D'],operations:[{requestId:'D',operationId:'move'},{requestId:'D',operationId:'not-committed'}]})).value;
  assert.equal(receipt.statuses[0].state,'processing');assert.equal(receipt.statuses[0].editable,false);assert.equal(receipt.operations[0].committed,true);assert.deepEqual(receipt.operations[0].result,moved.value);assert.equal(receipt.operations[1].committed,false);
  assert.deepEqual((await post('/api/messages/move',operation)).value,moved.value);
  assert.equal((await post('/api/messages/edit',{requestId:'D',operationId:'edit-late',expectedRevision:claimed.revision,input:{requestId:'D',text:'不能改写'}})).value.error,'queue_input_processing');
  assert.equal((await post('/api/history/queue',{view:'dispatch-v1',readEpoch:'stale'})).value.error,'history_epoch_changed');
 }finally{await server.close();app.close();}
});
function productionNode(file:string,predicate:(node:ts.Node)=>boolean){
 const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let found:ts.Node|undefined;
 const visit=(node:ts.Node)=>{if(predicate(node))found=node;else ts.forEachChild(node,visit);};visit(source);assert.ok(found);return found.getText(source);
}
test('actual gateway and business IPC forward dispatch cursor, mutation scope and operation receipts without loss',async()=>{
 const app=host();try{
  const literal=productionNode('scripts/dev.mjs',n=>ts.isPropertyAssignment(n)&&n.name.getText()==='bridge'&&ts.isObjectLiteralExpression(n.initializer)).replace(/^bridge\s*:/,'');
  const receive=productionNode('src/dev-host.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='receive');
  const js=ts.transpileModule(receive,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let response:{error?:string;value:unknown};
  const dispatch=new Function('app','frozen','stopping','homerWebBridge','send','engineError','webUploadProtocol','wechat','telegramManagement','desktop',`${js};return receive;`)(app,false,false,homerWebBridge,(m:typeof response)=>{response=m;},(e:Error)=>e.message,false,undefined,undefined,false);
  const invokeWeb=async(method:string,input:unknown)=>{await dispatch({kind:'web',id:'queue-test',method,input});if(response.error)throw Error(response.error);return response.value;};
  const gateway=new Function('invokeWeb','state','historyState','journal',`return (${literal});`)(invokeWeb,()=>({}),()=>({}),{receipts:()=>[]});
  const page=await gateway.history.dispatchQueue({readEpoch:app.webReadEpoch});
  const operation={threadId:'synthetic-history',readEpoch:app.webReadEpoch,requestId:'D',operationId:'ipc-move',expectedRevision:0,expectedOrderVersion:page.orderVersion,beforeRequestId:'B'};
  const result=await gateway.queue.move(operation);assert.equal(app.inputs.runnableHead()!.input.requestId,'D');
  const receipt=await gateway.history.receipts({requestIds:['D'],operations:[{requestId:'D',operationId:'ipc-move'}]});assert.deepEqual(receipt.operations[0].result,result);
  await assert.rejects(gateway.history.dispatchQueue({readEpoch:'wrong'}),/history_epoch_changed/);
  assert.deepEqual(await gateway.queue.move(operation),result);
  const all=await gateway.history.dispatchQueue({sources:'all',readEpoch:app.webReadEpoch});
  const user=all.items.find((item:{origin:string;input:{requestId:string}})=>item.origin==='user'&&item.input.requestId==='C');
  const shared={messageId:user.messageId,operationId:'ipc-all-sources',expectedRevision:user.revision,threadId:'synthetic-history',readEpoch:app.webReadEpoch,expectedOrderVersion:all.orderVersion,beforeMessageId:null};
  const sharedResult=await gateway.queue.move(shared);
  const sharedReceipt=await gateway.history.receipts({requestIds:[],operations:[{messageId:user.messageId,operationId:shared.operationId}]});
  assert.deepEqual(sharedReceipt.operations[0].result,sharedResult,'sources and message identity survive actual gateway/IPC forwarding');
 }finally{app.close();}
});
