import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as status from '../src/task-status.js';
import {workerStatus,matterStatus,statusCounts,statusCountSnapshot,statusTree,linearPlanIndex,matterSortKey,rankedStatusMatters,statusVisibleLimit} from '../src/task-status.js';
import type {OverviewTask} from '../src/task-overview.js';
const task=(extra:Partial<OverviewTask>={}):OverviewTask=>({id:'root',rootTaskId:'root',parentTaskId:null,goal:'合成目标',executorKind:'worker',executorAgentId:'same-worker',coordinatorAgentId:'main',sourceRequestId:null,headVersion:1,revision:0,state:'working',outcome:null,controlState:'normal',currentRunId:'run',run:{id:'run',status:'running',phase:'executing',contractVersion:1,epoch:0,summary:null,sourceRequestId:null},result:null,delivery:null,pendingUser:0,pendingMain:0,...extra});
test('work counts use user-root identities, not names, agents, expanded DOM, or historical runs',()=>{
 const a=task(),b=task({id:'peer',rootTaskId:'peer'}),main=task({id:'main',executorKind:'main'});
 assert.deepEqual(statusCounts([a,a,b,main]),{working:2,queued:0,done:0,needsUser:0});
 assert.equal(statusCounts([{...a,run:{...a.run!,contractVersion:0}}]).working,0);
});
test('execution success, review, delivery, stop and uncertainty stay distinct',()=>{
 const a=task();assert.equal(workerStatus(a).state,'working');assert.equal(workerStatus({...a,rework:true}).label,'返工中');
 const ended={...a,run:{...a.run!,status:'succeeded',phase:'ended'},result:{id:'r',state:'offered',outcome:'succeeded'}};
 assert.equal(workerStatus(ended).state,'done');assert.match(workerStatus(ended).label,/验收/);assert.equal(statusCounts([ended]).done,1);
 for(const controlState of ['stopping','held'])assert.equal(workerStatus({...a,controlState}).state,'waiting');
 assert.equal(workerStatus({...a,run:{...a.run!,phase:'uncertain'}}).state,'waiting');
 for(const status of ['failed','cancelled','interrupted'])assert.equal(statusCounts([{...a,run:{...a.run!,phase:'ended',status}}]).done,0);
});
test('all current facts use official states without making unknown or stop requests actionable',()=>{
 const a=task();
 for(const t of [{...a,controlState:'stopping'},{...a,state:'recovery'},{...a,run:null},{...a,run:{...a.run!,phase:'uncertain'}},{...a,run:{...a.run!,stopRequestedAt:1}}]){
  assert.equal(workerStatus(t).state,'waiting');assert.deepEqual(statusCounts([t]),{working:0,queued:0,done:0,needsUser:0});
 }
 const partial={...a,run:{...a.run!,phase:'ended',status:'awaiting_review'},result:{id:'partial',state:'offered',outcome:'partial'}};
 assert.deepEqual(workerStatus(partial),{state:'done',label:'执行已结束 · 待验收（部分成果）'});
 assert.equal(statusCounts([partial]).done,0,'a done display icon does not change the successful-execution count');
 const failed={...partial,result:{id:'failed-result',state:'offered',outcome:'failed'}};
 assert.deepEqual(workerStatus(failed),{state:'failed',label:'执行失败 · 待验收'});
 assert.equal(statusCounts([failed]).done,0,'a returned failure is not successful execution');
 assert.deepEqual(workerStatus({...a,run:{...a.run!,phase:'parked',status:'awaiting_review'}}),{state:'waiting',label:'等待验收'});
});
test('matter summary preserves root facts while showing peer work and valid questions',()=>{
 const root=task({executorKind:'main',currentRunId:null,run:null}),a=task({id:'a',parentTaskId:'root'}),b=task({id:'b',parentTaskId:'root',pendingUser:1,pendingUsers:[{id:'q',after:1}]}),tree=statusTree([root,a,b])[0]!;
 assert.deepEqual(matterStatus(tree),{state:'working',label:'1 待处理'});
 const ended=[root,a,b].map(t=>t.executorKind==='worker'?{...t,pendingUser:0,run:{...t.run!,phase:'ended',status:'succeeded'},result:{id:t.id,state:'offered',outcome:'succeeded'}}:t);
 assert.deepEqual(matterStatus(statusTree(ended)[0]!),{state:'waiting',label:'待协调者验收'});
 assert.deepEqual(matterStatus({...tree,task:{...root,controlState:'stopping'}}),{state:'waiting',label:'停止待确认'});
 assert.equal(statusCounts([root,a,b]).working,1,'root summary is not an additional worker');
 const failed=[root,a,b].map(t=>t.executorKind==='worker'?{...t,pendingUser:0,run:{...t.run!,phase:'ended',status:'failed'}}:t);
 assert.deepEqual(matterStatus(statusTree(failed)[0]!),{state:'waiting',label:'有 Worker 执行失败'});
});
test('pending counts are distinct valid interactions, never main review or stale callbacks',()=>{
 const a=task({pendingUser:2,pendingUsers:[{id:'q1',after:0},{id:'q2',after:1}],pendingMain:1});
 assert.deepEqual(statusCounts([a,a]),{working:0,queued:0,done:0,needsUser:2});
 assert.equal(statusCounts([{...a,controlState:'stopping'}]).needsUser,0);assert.equal(statusCounts([{...a,pendingUsers:undefined}]).needsUser,2);
 assert.equal(statusCounts([{...a,pendingUser:0,pendingUsers:[],pendingMain:2}]).needsUser,0);
});
test('tree keeps exact ownership, merges one worker, rejects orphans and cycles',()=>{
 const main=task({executorKind:'main'}),a=task({id:'a',parentTaskId:'root'}),b=task({id:'b',parentTaskId:'a'});
 const tree=statusTree([main,a,b,a,task({id:'orphan',parentTaskId:'missing'}),task({id:'cycle1',parentTaskId:'cycle2'}),task({id:'cycle2',parentTaskId:'cycle1'})]);
 assert.equal(tree.length,1);assert.equal(tree[0]!.workers.length,1);assert.equal(tree[0]!.workers[0]!.task.id,'a');assert.ok(!tree[0]!.workers.some(w=>w.task.id==='b'));assert.ok(!('children' in tree[0]!.workers[0]!));
});
test('AgentPlan is used only for accurate linear activity, never inferred parallel completion',()=>{
 assert.equal(linearPlanIndex([{step:'a',status:'completed'},{step:'b',status:'inProgress'},{step:'c',status:'pending'}]),1);
 assert.equal(linearPlanIndex([{step:'a',status:'pending'}]),null);
 assert.equal(linearPlanIndex([{step:'a',status:'inProgress'},{step:'b',status:'completed'}]),null);
 assert.equal(linearPlanIndex([{step:'a',status:'inProgress'},{step:'b',status:'inProgress'}]),null);
 assert.equal(linearPlanIndex([{step:'a',status:'completed'}]),1);
});
test('a retained stop-request timestamp does not hide confirmed cancellation',()=>{
 const a=task();const cancelled={...a,state:'settled',outcome:'cancelled',run:{...a.run!,status:'cancelled',phase:'ended',stopRequestedAt:1}};
 assert.equal(workerStatus(cancelled).state,'cancelled');assert.equal(statusCounts([cancelled]).done,0);
});

const rank=(tasks:OverviewTask[])=>rankedStatusMatters(statusTree(tasks));
const key=(t:OverviewTask)=>matterSortKey({task:t,workers:[]});
const timed=(id:string,at:number,extra:Partial<OverviewTask>={})=>{const t=task({id,rootTaskId:id,creationOrder:1,...extra});return {...t,run:t.run?{...t.run,startedAt:at}:null};};
test('ordering five categories use their own facts and immutable same-Run start',()=>{
 const a=timed('a',100,{creationOrder:10}),b=timed('b',100,{creationOrder:11}),c=timed('c',200),d=timed('d',0,{pendingUser:1,pendingUserCreatedAt:1});
 assert.deepEqual(rank([a,b,c,d]).map(x=>x.key.id),['d','c','b','a']);
 const review=timed('review',999,{pendingMain:1,pendingMainCreatedAt:300}),wait=timed('wait',999,{controlState:'held',waitingEnteredAt:400}),ended=timed('end',999,{state:'settled',run:{...a.run!,phase:'ended',status:'succeeded',endedAt:500}});
 assert.deepEqual(rank([ended,wait,review,a,d]).map(x=>[x.key.id,x.key.priority,x.key.enteredAtMs]),[['d',0,1],['a',1,100],['review',2,300],['wait',3,400],['end',4,500]]);
 assert.equal(key({...a,pendingMain:1,pendingMainCreatedAt:900}).enteredAtMs,900);
 assert.equal(key({...a,run:{...a.run!,phase:'rpc_wait'},waitingEnteredAt:800}).enteredAtMs,800);
 assert.equal(key({...a,revision:999,run:{...a.run!,summary:'heartbeat'}}).enteredAtMs,100);
 assert.equal(key({...a,currentRunId:'new',run:{...a.run!,id:'new',startedAt:700}}).enteredAtMs,700);
 const heartbeat={...a,updatedAt:999999,activeMs:999999,revision:999,run:{...a.run!,summary:'ordinary log'}};assert.deepEqual(key(heartbeat),key(a));
 const pairs:OverviewTask[]=[];
 for(const at of [10,20]){
  pairs.push(timed('p0-'+at,999,{pendingUser:1,pendingUserCreatedAt:at}),timed('p1-'+at,at),timed('p2-'+at,999,{pendingMain:1,pendingMainCreatedAt:at}),timed('p3-'+at,999,{controlState:'held',waitingEnteredAt:at}),timed('p4-'+at,999,{state:'settled',run:{...a.run!,status:'succeeded',phase:'ended',endedAt:at}}));
 }
 assert.deepEqual(rank(pairs.reverse()).map(x=>x.key.id),['p0-20','p0-10','p1-20','p1-10','p2-20','p2-10','p3-20','p3-10','p4-20','p4-10']);
 assert.equal(key({...a,pendingUser:1,pendingUserCreatedAt:300,pendingMain:0}).enteredAtMs,key({...a,pendingMain:1,pendingMainCreatedAt:300}).enteredAtMs);

 for(const extra of [{controlState:'stopping'},{state:'recovery'},{run:{...a.run!,contractVersion:0}},{run:{...a.run!,id:'old'}},{run:{...a.run!,phase:'uncertain'}}])assert.equal(key({...d,...extra}).priority,3);
});
test('ordering uses only deciding current members, preserves roots, hierarchy and counts',()=>{
 const root=task({executorKind:'main',run:null,currentRunId:null,waitingEnteredAt:1}),a=timed('a',100,{rootTaskId:'root',parentTaskId:'root'}),ended=timed('ended',1,{rootTaskId:'root',parentTaskId:'root',state:'settled',run:{...a.run!,status:'succeeded',phase:'ended',endedAt:9999},result:{id:'accepted',state:'accepted',outcome:'succeeded'}});
 const tasks=[root,a,ended,a,timed('orphan',99999,{rootTaskId:'root',parentTaskId:'missing'}),timed('deep',99999,{rootTaskId:'root',parentTaskId:'a'})];
 const before=statusCounts(tasks);assert.deepEqual(rank(tasks).map(x=>[x.key.id,x.key.priority,x.key.enteredAtMs]),[['root',1,100]]);assert.deepEqual(statusCounts(tasks),before);
 const ready={...a,state:'settled',run:{...a.run!,status:'succeeded',phase:'ended',endedAt:800},result:{id:'r',state:'accepted',outcome:'partial'}};
 assert.deepEqual(rank([root,ready,ended]).map(x=>[x.key.priority,x.key.enteredAtMs]),[[2,9999]]);
 assert.equal(rank([{...root,state:'settled',settledAt:99999},a])[0]!.key.priority,1);
 assert.equal(rank([{...root,waitingEnteredAt:80},{...a,controlState:'held',waitingEnteredAt:40},ended])[0]!.key.enteredAtMs,80,'a current waiting root participates alongside waiting children; ended children do not');
 assert.equal(rank([a,{...a,parentTaskId:null,rootTaskId:'a'}]).length,1);
});
test('ordering review and delivery do not borrow stale result identity or end facts',()=>{
 const a=timed('a',100),closed={...a,state:'settled',run:{...a.run!,status:'succeeded',phase:'ended',endedAt:500},result:{id:'r',state:'accepted',outcome:'succeeded'},reviewEnteredAt:300};
 for(const state of ['prepared','submitting','uncertain'])assert.deepEqual([key({...closed,delivery:{state,resultId:'r',outcome:'succeeded'}}).priority,key({...closed,delivery:{state,resultId:'r',outcome:'succeeded'}}).enteredAtMs],[2,300]);
 assert.equal(key({...closed,delivery:{state:'recorded',resultId:'r',outcome:'succeeded'}}).priority,4);
 assert.equal(key({...a,delivery:{state:'prepared',resultId:'stale',outcome:'succeeded'}}).priority,1);
 assert.equal(key({...closed,parentTaskId:'parent'}).priority,4);
 for(const outcome of ['failed','partial'])assert.equal(key({...closed,result:{id:'r',state:'offered',outcome}}).priority,2);
 assert.equal(key({...closed,reviewEnteredAt:null}).enteredAtMs,500);
 assert.equal(key(task({executorKind:'main',currentRunId:null,run:null,state:'settled',settledAt:600})).enteredAtMs,600);
});
test('ordering time validation and millisecond ties are deterministic across input permutations',()=>{
 const times:[unknown,number][]=[[0,0],['123',123],['2026-10-25T00:00:00.000Z',1792886400000],['2026-10-25T08:00:00+08:00',1792886400000],[null,-Infinity],[undefined,-Infinity],[NaN,-Infinity],[Infinity,-Infinity],[-1,-Infinity],['2026-02-30T00:00:00Z',-Infinity],['2026-10-25T00:00:00',-Infinity],['1.5',-Infinity],['',-Infinity]];
 for(const [value,want] of times){const t=timed('t',0);assert.equal(key({...t,run:{...t.run!,startedAt:value as number}}).enteredAtMs,want,String(value));}
 const a=timed('a',1),b=timed('b',1),c=timed('c',1,{creationOrder:2});
 for(const list of [[b,c,a],[a,b,c],[c,a,b]])assert.deepEqual(rank(list).map(x=>x.key.id),['c','a','b']);
 const unknown=timed('unknown',NaN,{creationOrder:NaN});assert.equal(key(unknown).creationOrder,-Infinity);
 const queued=task({run:{...a.run!,status:'queued',phase:'ready',createdAt:99}});assert.equal(key(queued).enteredAtMs,99);
 assert.equal(key({...queued,run:{...queued.run!,status:'running',phase:'parked'}}).enteredAtMs,-Infinity);
});
test('ordering full snapshot precedes prefix, every follow-up and retained reader stays visible',()=>{
 const active=Array.from({length:25},(_,i)=>timed('active-'+i,i)),history=Array.from({length:30},(_,i)=>{const t=timed('history-'+i,0);return {...t,state:'settled',run:{...t.run!,status:'succeeded',phase:'ended',endedAt:i}};});
 const ranked=rank([...history,...active]);assert.equal(statusVisibleLimit(ranked,20),25);assert.equal(statusVisibleLimit(rank([...active,timed('new',999),...history]),20),26);
 assert.equal(statusVisibleLimit(rank([...active.slice(0,18),...history]),20),20);
 assert.equal(statusVisibleLimit(ranked,20,[ranked[40]!.key.id]),41);
 assert.equal(statusVisibleLimit(ranked,45),45);assert.equal(statusVisibleLimit(ranked,999),55);
 assert.equal(ranked[0]!.key.id,'active-24');
});
test('ordering actual layout callbacks preserve anchors and respect newer focus or scroll (DOM model)',()=>{
 // Executes product callbacks; this model does not verify browser layout or React scheduling.
 const source=readFileSync(new URL('../ui/task-status.tsx',import.meta.url),'utf8');
 const extract=(start:string,end:string,includeStart=false)=>{const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return ts.transpile(`(()=>{${source.slice(from+(includeStart?0:start.length),to)}})`,{target:ts.ScriptTarget.ES2022});};
 class Element{
  isConnected=true;dataset={todoId:'root'};top=0;
  getBoundingClientRect(){return {top:this.top,bottom:this.top+100};}
  closest(){return row;}
  focus(){document.activeElement=this;}
  querySelector(){return trigger;}
 }
 const a=new Element(),b=new Element(),body=new Element(),row=new Element(),trigger=new Element();
 const document:{activeElement:Element|null;body:Element}={activeElement:a,body};
 const node=Object.assign(new Element(),{scrollTop:10,contains:(e:Element)=>e===a||e===b,querySelectorAll:()=>roots});
 let roots=[row];
 const saved={node,scrollTop:0,anchorId:'',offset:0,focus:null as Element|null,focusRootId:'',generation:0,capturedGeneration:0,pending:false};
 const context={document,HTMLElement:Element,listPosition:{current:saved},open:true};
 const capture=runInNewContext(extract(' const captureListAnchor=useCallback(()=>{','\n },[]);'),context) as ()=>void;
 const restore=runInNewContext(extract('  const saved=listPosition.current,node=saved.node;if(!open','\n },[snapshot,open,effectiveLimit]);',true),context) as ()=>void;
 capture();row.top=40;document.activeElement=b;restore();
 assert.equal(node.scrollTop,50,'same root retains its visual offset');assert.equal(document.activeElement,b,'new user focus wins over a captured focus');
 document.activeElement=a;capture();a.isConnected=false;document.activeElement=body;restore();
 assert.equal(document.activeElement,trigger,'removed focused content returns to the stable root trigger');
 capture();node.scrollTop=90;saved.generation++;row.top=80;restore();
 assert.equal(node.scrollTop,90,'new user scroll wins over the saved anchor');
 document.activeElement=a;capture();roots=[];document.activeElement=body;restore();assert.equal(document.activeElement,node,'a focused root leaving the filter returns focus to the list without reinsertion');
});

// Regression: a root's primary label cannot represent all contributing Workers.
test('filter membership shares root work and unchanged execution/request contributions',()=>{
 assert.equal(typeof status.statusCountSnapshot,'function');
 const root=task({executorKind:'main',currentRunId:null,run:null});
 const child=(id:string,extra:Partial<OverviewTask>={})=>task({id,parentTaskId:'root',...extra});
 const a=child('a'),b=child('b'),done=child('done',{run:{...a.run!,phase:'ended',status:'succeeded'}});
 const question=child('question',{pendingUser:2,pendingUsers:[{id:'q',after:0},{id:'approval',after:1,kind:'authorization'}]});
 const deep=child('deep',{parentTaskId:'a',pendingUser:1,pendingUsers:[{id:'q',after:0}]});
 const other=task({id:'other',rootTaskId:'other',pendingMain:1});
 const tasks=[root,a,b,done,question,deep,other,a];
 const value=status.statusCountSnapshot(tasks);
 assert.deepEqual(value.counts,{working:1,queued:0,done:1,needsUser:2});
 for(const key of ['working','done','needsUser'] as const)assert.deepEqual([...value.matches[key]],['root']);
 assert.deepEqual(statusCounts(tasks),value.counts);
 const deepOnly=status.statusCountSnapshot([root,a,deep]);
 assert.equal(deepOnly.counts.needsUser,1);assert.deepEqual([...deepOnly.matches.needsUser],['root'],'deep requests still map to their root');
 const unavailable=status.statusCountSnapshot([task({pendingUser:2,pendingUsers:undefined})]);
 assert.equal(unavailable.counts.needsUser,2);assert.deepEqual([...unavailable.matches.needsUser],['root'],'missing locators retain confirmed pending counts');
});
test('filters preserve successful-execution semantics and reject stale requests and main-only follow-up',()=>{
 const a=task(),ended={...a.run!,phase:'ended',status:'awaiting_review'};
 const cases:[Partial<OverviewTask>,number,number,number][]=[
  [{pendingMain:1},0,0,0],
  [{run:ended,result:{id:'r',state:'offered',outcome:'partial'}},0,0,0],
  [{run:{...ended,status:'succeeded'},result:{id:'r',state:'accepted',outcome:'partial'}},0,1,0],
  [{run:ended,result:{id:'r',state:'offered',outcome:'succeeded'}},0,1,0],
  [{run:{...ended,status:'failed'}},0,0,0],
  [{pendingUser:1,pendingUsers:[{id:'q',after:1,kind:'authorization'}]},0,0,1],
  ...[{controlState:'stopping'},{controlState:'held'},{currentRunId:'new'},{run:{...a.run!,contractVersion:0}},{run:{...a.run!,phase:'uncertain'}},{run:ended}].map(extra=>[{pendingUser:1,...extra},0,0,0] as [Partial<OverviewTask>,number,number,number]),
 ];
 for(const [extra,working,done,needsUser] of cases){
  const value=status.statusCountSnapshot([{...a,...extra}]);
  assert.deepEqual(value.counts,{working,queued:0,done,needsUser});
  assert.deepEqual(['working','done','needsUser'].map(key=>value.matches[key as 'working'|'done'|'needsUser'].has('root')),[!!working,!!done,!!needsUser]);
 }
});
test('product filtering precedes visible limits and never retains a nonmatching reader root (DOM model)',()=>{
 const source=readFileSync(new URL('../ui/task-status.tsx',import.meta.url),'utf8');
 const from=source.indexOf(' const ranked=useMemo('),to=source.indexOf('\n useLayoutEffect(()=>{',from);
 assert.ok(from>=0&&to>from,'product has a filtered ranked collection before its visible limit');
 const derive=ts.transpile(`(()=>{${source.slice(from,to)};return {matters,effectiveLimit};})`,{target:ts.ScriptTarget.ES2022});
 const old=Array.from({length:25},(_,i)=>{const t=task({id:'old-'+i,rootTaskId:'old-'+i});return {...t,state:'settled',run:{...t.run!,phase:'ended',status:'failed',endedAt:i},result:{id:'r',state:'accepted',outcome:'failed'},delivery:{state:'recorded',resultId:'r',outcome:'failed'}};});
 const special=task({id:'outside',rootTaskId:'outside',state:'settled',run:{...task().run!,phase:'ended',status:'succeeded',endedAt:0},result:{id:'r',state:'accepted',outcome:'partial'},delivery:{state:'recorded',resultId:'r',outcome:'partial'}});
 const tasks=[...old,special],snapshot={ranked:rank(tasks),...status.statusCountSnapshot(tasks)};
 assert.equal(snapshot.ranked[25]!.key.id,'outside','the only match starts beyond the old prefix');
 assert.deepEqual(snapshot.counts,{working:0,queued:0,done:1,needsUser:0});
 const saved={anchorId:'old-24',focusRootId:'old-0'};
 const context={snapshot,filter:'done' as string|null,visibleCount:20,listPosition:{current:saved},statusVisibleLimit,useMemo:(fn:()=>unknown)=>fn()};
 const read=()=>runInNewContext(derive,context)() as {matters:{task:OverviewTask}[];effectiveLimit:number};
 const filtered=read();assert.deepEqual(Array.from(filtered.matters,m=>m.task.id),['outside']);assert.equal(filtered.effectiveLimit,1);
 context.filter=null;assert.equal(read().matters.length,26);
 context.filter='needsUser';assert.equal(read().matters.length,0);
 context.filter='done';const changed=tasks.map(t=>t.id==='outside'?{...t,run:{...t.run!,status:'failed'}}:t);context.snapshot={ranked:rank(changed),...status.statusCountSnapshot(changed)};assert.equal(read().matters.length,0,'snapshot updates change membership without resetting selection');assert.equal(context.filter,'done');
 context.snapshot=snapshot;assert.equal(read().matters.length,1,'new matching status can re-enter the selected filter');assert.deepEqual(snapshot.counts,{working:0,queued:0,done:1,needsUser:0},'filtering never rewrites full counters');
});
test('explicit filter changes reset only the visible prefix and reader anchor (DOM model)',()=>{
 const source=readFileSync(new URL('../ui/task-status.tsx',import.meta.url),'utf8');
 const from=source.indexOf(' const changeFilter='),to=source.indexOf('\n const readRef=',from);
 assert.ok(from>=0&&to>from);
 const saved={node:{scrollTop:90},scrollTop:90,anchorId:'old',focusRootId:'old',focus:{},pending:true,generation:3};
 let filter:string|null='working',visibleCount=60;
 const context={listPosition:{current:saved},setFilter:(v:string|null)=>{filter=v;},setVisibleCount:(v:number)=>{visibleCount=v;}};
 const change=runInNewContext(ts.transpile(`(()=>{${source.slice(from,to)};return changeFilter;})`,{target:ts.ScriptTarget.ES2022}),context)();
 const callback=source.match(/onPressedChange=\{(pressed=>[^}]+)\}/)?.[1];assert.ok(callback);
 const onPressedChange=runInNewContext(ts.transpile(`(${callback})`,{target:ts.ScriptTarget.ES2022}),{changeFilter:change,key:'working'});
 onPressedChange(false);assert.equal(filter,null);assert.equal(visibleCount,20);assert.equal(saved.node.scrollTop,0);assert.equal(saved.anchorId,'');assert.equal(saved.focus,null);assert.equal(saved.pending,false);
 onPressedChange(true);assert.equal(filter,'working');change('done');assert.equal(filter,'done');
});

test('filtered-out expanded roots do not request progress until visible again (effect model)',()=>{
 const source=readFileSync(new URL('../ui/task-status.tsx',import.meta.url),'utf8');
 const from=source.indexOf(' useEffect(()=>{if(!open)return;'),to=source.indexOf('\n useEffect(()=>{if(!open){',from);assert.ok(from>=0&&to>from);
 const keyFrom=source.indexOf('function workerKey('),keyTo=source.indexOf('export function TaskStatusPopover',keyFrom);
 const hidden=task({id:'hidden',rootTaskId:'hidden'}),visible=task({id:'visible',rootTaskId:'visible'}),loads:string[]=[];
 const workerKey=runInNewContext(ts.transpile(`(()=>{${source.slice(keyFrom,keyTo)};return workerKey;})`,{target:ts.ScriptTarget.ES2022}))();
 const context={open:true,data:{tasks:[hidden,visible]},ranked:rank([visible]),effectiveLimit:1,connected:true,expanded:new Map([hidden,visible].map(t=>[t.id,workerKey(t)])),workerKey,load:(id:string)=>loads.push(id),useEffect:(fn:()=>void)=>fn()};
 const effect=ts.transpile(`(()=>{${source.slice(from,to)}})`,{target:ts.ScriptTarget.ES2022});
 runInNewContext(effect,context)();assert.deepEqual(loads,['visible']);
 loads.length=0;context.ranked=rank([hidden]);runInNewContext(effect,context)();assert.deepEqual(loads,['hidden'],'preserved expansion resumes on re-entry');
});

// A badge counts user roots once, regardless of execution identities or page size.
test('work counts deduplicate roots, include current main and nested work, and reject broken ancestry',()=>{
 const root=task({executorKind:'main',currentRunId:null,run:null});
 const a=task({id:'a',parentTaskId:'root'}),b=task({id:'b',parentTaskId:'root'});
 const nested=task({id:'nested',parentTaskId:'a'});
 assert.equal(statusCounts([root,a,b,nested,a]).working,1);
 assert.equal(statusCounts([task({executorKind:'main'})]).working,1,'a root with a current main Run is user work');
 const waiting={...a,run:{...a.run!,phase:'rpc_wait'}};
 assert.equal(statusCounts([root,waiting,nested]).working,1,'current nested work still belongs to its user root');
 for(const extra of [{parentTaskId:'missing'},{parentTaskId:'nested'},{rootTaskId:'missing'}])
  assert.equal(statusCounts([root,waiting,{...nested,...extra}]).working,0);
 const cycle=task({id:'cycle',parentTaskId:'nested'});
 assert.equal(statusCounts([root,{...nested,parentTaskId:'cycle'},cycle]).working,0);
});
test('0, 1, 12 and counts beyond the visible prefix use the entire root snapshot',()=>{
 assert.equal(statusCounts([]).working,0);
 for(const n of [1,12,35]){
  const roots=Array.from({length:n},(_,i)=>task({id:'r'+i,rootTaskId:'r'+i}));
  assert.equal(statusCounts(roots).working,n);
  assert.equal(statusCountSnapshot(roots).matches.working.size,n);
 }
});
test('queued and waiting members remain separate while live siblings count the root only once',()=>{
 const root=task({executorKind:'main',currentRunId:null,run:null});
 const running=task({id:'active',parentTaskId:'root'});
 const queued=task({id:'queue',parentTaskId:'root',run:{...running.run!,status:'queued',phase:'ready'}});
 const question=task({id:'question',parentTaskId:'root',pendingUser:1,pendingUsers:[{id:'question-id',after:1}]});
 assert.deepEqual(statusCounts([root,queued,question]),{working:0,queued:1,done:0,needsUser:1});
 assert.deepEqual(statusCounts([root,running,queued,question]),{working:1,queued:1,done:0,needsUser:1});
 const value=statusCountSnapshot([root,queued,question]);assert.deepEqual([...value.matches.queued],['root']);
});
test('current Run, retry and adopted version changes replace a root contribution instead of adding one',()=>{
 const a=task();
 const retry={...a,currentRunId:'retry',revision:2,run:{...a.run!,id:'retry',epoch:2,replacesRunId:'run'}};
 assert.equal(statusCounts([a,retry]).working,1);
 const mismatch={...retry,headVersion:2};assert.equal(statusCounts([mismatch]).working,0);
 const adopted={...mismatch,run:{...retry.run,contractVersion:2}};
 assert.equal(statusCounts([adopted]).working,1);
 for(const extra of [{pendingUser:1},{pendingMain:1},{controlState:'held'},{controlState:'stopping'},{state:'recovery'},{run:{...adopted.run,phase:'uncertain'}},{run:{...adopted.run,phase:'ended',status:'succeeded'}}])
  assert.equal(statusCounts([{...adopted,...extra}]).working,0);
 assert.equal(statusCounts([adopted]).working,1);
});

test('uncertain or missing current execution facts keep aggregate working quantity unknown',()=>{
 assert.equal(statusCountSnapshot([]).workingKnown,true);
 const a=task();
 for(const extra of [{run:null},{headVersion:2},{state:'recovery'},{run:{...a.run!,phase:'uncertain'}},{run:{...a.run!,id:'old'}}])
  assert.equal(statusCountSnapshot([{...a,...extra}]).workingKnown,false);
 for(const extra of [{controlState:'held'},{pendingMain:1},{pendingUser:1},{run:{...a.run!,status:'queued',phase:'ready'}},{run:{...a.run!,phase:'ended',status:'succeeded'}}])
  assert.equal(statusCountSnapshot([{...a,...extra}]).workingKnown,true);
 const root=task({executorKind:'main',run:null,currentRunId:null}),child={...task({id:'child',parentTaskId:'root'}),run:null};
 assert.equal(statusCountSnapshot([root,child]).workingKnown,false);
});
