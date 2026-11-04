import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProcessNodeView,ProcessMessageContent,ProcessObservationContext} from './helpers/process-ui-loader.mjs';
import {withDom,React,visibleText} from './helpers/process-dom.mjs';
import {projectConversation} from '../src/conversation-projection.ts';
const h=React.createElement;
const node={id:'process-synthetic',threadId:'thread-synthetic',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'body',state:'working',status:'running',turnIds:['turn-1'],items:[{id:'initial-progress',seq:1,revision:1,kind:'commentary',text:'公开进展'}],startedAtMs:1000,timingSource:'hostObserved',timingState:'running'};
const observation={connected:true,threadId:node.threadId,serviceRunning:true,observedAtMs:6000,generationTurnId:'turn-1',mainActivity:{processId:node.id,source:'user',turnId:'turn-1',stage:'native'}};
const tool=(id,patch={})=>({id,seq:1,revision:1,kind:'tool',category:'readFiles',turnId:'turn-1',threadId:node.threadId,label:'读取文件',status:'running',invocationCount:1,...patch});
const commentary=(id,text='公开说明')=>({id,seq:1,revision:1,kind:'commentary',phase:'commentary',text});
const worker={id:'worker-synthetic',seq:5,revision:1,kind:'worker',taskId:'task-private',version:1,taskRevision:2,runId:'run-synthetic',runRevision:1,runStatus:'running',resultState:null,epoch:0,state:'working',controlState:'normal',outcome:null,phase:'executing',stopRequested:false,label:'后台研究'};
const view=(n=node,o=observation)=>h(ProcessNodeView,{key:JSON.stringify([n.threadId,n.id]),node:n,observation:o,renderText:text=>h('p',null,text)});
const button=d=>d.find(n=>n.tagName==='BUTTON');
const groups=d=>d.all().filter(n=>'data-tool-group' in n.attrs);
const rows=d=>d.all().filter(n=>'data-tool-id' in n.attrs);
const done=n=>({...n,state:'worked',status:'completed',timingState:'terminal',durationMs:32000,endedAtMs:33000});

test('official entries retain all original calls across categories, turns and commentary; independent Workers remain outside',async()=>withDom(async d=>{
 const items=[commentary('a','A'),tool('r1'),tool('r2'),commentary('b','B'),tool('r3'),worker,tool('r4'),tool('r5',{turnId:'turn-2'}),tool('r6',{turnId:'turn-2'}),tool('old1',{category:undefined}),tool('old2',{category:undefined}),tool('old3',{turnId:undefined}),tool('old4',{turnId:undefined}),tool('h1',{category:'host',label:'检查资料'}),tool('h2',{category:'host',label:'检查资料'}),tool('h3',{category:'host',label:'核对成果'})];
 await d.render(view({...node,items}));await d.click(button(d));
 assert.equal(groups(d).length,0);
 assert.deepEqual(rows(d).map(r=>r.attrs['data-tool-id']),items.filter(i=>i.kind==='tool').map(i=>i.id));
 const entries=d.find(n=>n.tagName==='OL').textContent;
 assert.ok(entries.indexOf('A')<entries.indexOf('读取文件'));assert.ok(entries.indexOf('B')>entries.indexOf('读取文件'));
 assert.equal(d.all().some(n=>n.attrs['aria-label']==='关联 Worker 状态'),false);
}));

test('completion duplicate updates first identity, never counts start/end twice; failures remain explicit',async()=>withDom(async d=>{
 const r1=tool('r1'),r2=tool('r2');await d.render(view({...node,items:[r1,r2]}));await d.click(button(d));const first=rows(d)[0];
 await d.render(view({...node,items:[r1,r2,{...r1,revision:2,status:'failed'},{...r2,revision:2,status:'completed'}]}));
 assert.equal(rows(d)[0],first);assert.equal(rows(d).length,2);assert.match(rows(d)[0].textContent,/调用失败/);assert.match(rows(d)[1].textContent,/调用已返回/);
 await d.render(view({...done(node),items:[r1,r2,{...r1,revision:2,status:'failed'},{...r2,revision:2,status:'completed'}]}));
 assert.doesNotMatch(visibleText(d.container),/\d+ 次调用失败/);assert.match(rows(d)[0].textContent,/调用失败/);assert.equal(button(d).attrs['aria-expanded'],'true');
}));

test('all seven tool statuses stay distinct, file counts are per call and not cross-call unique files',async()=>withDom(async d=>{
 const states=['running','completed','failed','declined','interrupted','unknown','blocked'];
 await d.render(view({...node,items:states.map((status,i)=>tool('s'+i,{status,category:'fileChange',label:'修改文件',fileCount:2}))}));await d.click(button(d));
 const rendered=rows(d).map(r=>r.textContent).join('');for(const label of ['调用中','调用已返回','调用失败','调用被拒绝','调用已中断','结束状态待核实','调用受阻，待核实'])assert.ok(rendered.includes(label),label);
 assert.equal(rows(d).length,7);assert.equal(rendered.match(/本次涉及 2 个文件/g).length,7);assert.doesNotMatch(rendered,/14 个文件|已完成 7/);
 await d.render(view({...node,items:[tool('single',{category:'fileChange',label:'修改文件',status:'declined',fileCount:2})]}));assert.match(rows(d)[0].textContent,/调用被拒绝.*本次涉及 2 个文件/);
}));

test('original disclosure starts closed and preserves user choice across completion and updates',async()=>withDom(async d=>{
 await d.render(view({...node,items:[commentary('p','progress')]}));const toggle=button(d);assert.equal(toggle.attrs['aria-expanded'],'false');assert.equal(toggle.attrs.type,'button');
 await d.click(toggle);await d.render(view(done(node)));assert.equal(toggle.attrs['aria-expanded'],'true');
 await d.render(view({...done(node),revision:5,items:[...node.items,worker]},{...observation,connected:false}));assert.equal(toggle.attrs['aria-expanded'],'true');
 await d.click(toggle);await d.render(view({...done(node),revision:6}));assert.equal(toggle.attrs['aria-expanded'],'false');
}));

// Real focus removal is checked in run-activity-focus.browser.mjs. This
// synthetic DOM does not move activeElement when React removes its subtree.
test('new node and thread start with the original closed disclosure using the production key',async()=>withDom(async d=>{
 await d.render(view(node));assert.equal(button(d).attrs['aria-expanded'],'false');await d.click(button(d));
 await d.render(view({...node,id:'new-node'}));assert.equal(button(d).attrs['aria-expanded'],'false');await d.click(button(d));
 await d.render(view({...node,threadId:'new-thread'}));assert.equal(button(d).attrs['aria-expanded'],'false');
}));

test('authoritative snapshot calibrates elapsed time; terminal duration freezes despite newer observations and Worker updates',async()=>withDom(async d=>{
 await d.render(view());assert.match(button(d).textContent,/当前对话 · [^·]*\s*·\s*5s/);assert.doesNotMatch(button(d).textContent,/0s/);
 await d.render(view(node,{...observation,observedAtMs:9000}));assert.match(button(d).textContent,/· 8s/);
 await d.render(view({...done(node),timingSource:'native'},{...observation,observedAtMs:999999}));assert.match(button(d).textContent,/已结束\s*·\s*32s/);
 await d.render(view({...done(node),timingSource:'native',items:[...node.items,worker]}, {...observation,observedAtMs:1999999,connected:false}));assert.match(button(d).textContent,/· 32s/);assert.doesNotMatch(button(d).textContent,/上次快照|宿主观测/);
}));

test('disconnect/unknown freeze last eligible snapshot; reconnect resumes; mismatched stage/turn/source never advances',async()=>withDom(async d=>{
 await d.render(view());await d.render(view(node,{...observation,connected:false,observedAtMs:99000}));assert.match(button(d).textContent,/· 5s.*上次快照/);
 await d.render(view({...node,status:'unknown',timingState:'unknown'},{...observation,observedAtMs:199000}));assert.match(button(d).textContent,/状态待确认\s*·\s*5s/);assert.doesNotMatch(button(d).textContent,/已结束/);
 await d.render(view(node,{...observation,observedAtMs:10000}));assert.match(button(d).textContent,/· 9s/);
 for(const mainActivity of [{...observation.mainActivity,stage:'preparing'},{...observation.mainActivity,stage:'unknown'},{...observation.mainActivity,turnId:'wrong'},{...observation.mainActivity,source:'internal'}]){await d.render(view(node,{...observation,mainActivity,observedAtMs:100000}));assert.match(button(d).textContent,/· 9s.*上次快照/);}
 await d.render(view(node,{...observation,mainActivity:{...observation.mainActivity,stage:'compacting'},observedAtMs:12000}));assert.match(button(d).textContent,/· 11s/);
}));

test('old/missing/invalid clocks do not invent zero/endpoints; finishing uses fixed native endpoint without completing node',async()=>withDom(async d=>{
 for(const patch of [{timingState:undefined},{timingSource:undefined},{startedAtMs:undefined},{startedAtMs:999999}]){await d.render(view({...node,id:JSON.stringify(patch),...patch}));assert.doesNotMatch(button(d).textContent,/· \d/);}
 await d.render(view({...done(node),startedAtMs:undefined,endedAtMs:undefined,durationMs:undefined}));assert.match(button(d).textContent,/已结束/);assert.doesNotMatch(button(d).textContent,/· 0s/);await d.click(button(d));assert.doesNotMatch(visibleText(d.container),/· 0s/);
 await d.render(view({...node,timingState:'terminal',durationMs:2000}, {...observation,mainActivity:{...observation.mainActivity,stage:'finishing'},observedAtMs:999999}));assert.match(button(d).textContent,/当前对话 · [^·]*\s*·\s*2s/);assert.doesNotMatch(button(d).textContent,/已结束/);
}));


// Fake only the clocks; exercise the actual React tree and Mantine interval.
async function withClock(t,run){
 t.mock.timers.enable({apis:['setInterval']});
 let now=0,starts=0;const active=new Map(),schedule=globalThis.setInterval,cancel=globalThis.clearInterval;
 t.mock.method(performance,'now',()=>now);
 t.mock.method(globalThis,'setInterval',(fn,ms,...args)=>{const id=schedule(fn,ms,...args);active.set(id,()=>fn(...args));starts++;return id;});
 t.mock.method(globalThis,'clearInterval',id=>{active.delete(id);return cancel(id);});
 const clock={active, get starts(){return starts;},advance:async ms=>{now+=ms;await React.act(async()=>t.mock.timers.tick(ms));},late:async ms=>{now+=ms;await React.act(async()=>{for(const fn of [...active.values()])fn();});}};
 try{await withDom(d=>run(d,clock));assert.equal(active.size,0,'unmount releases the interval');}finally{t.mock.timers.reset();}
}

test('local seconds refresh only duration; late ticks use elapsed time and duplicate evidence never resets the anchor',async t=>withClock(t,async(d,clock)=>{
 let renders=0;const renderText=text=>{renders++;return h('p',null,text);};
 const tree=(n=node,o=observation)=>h(ProcessNodeView,{node:n,observation:o,renderText});
 await d.render(tree());assert.match(button(d).textContent,/· 5s/);const initialRenders=renders,initialStarts=clock.starts;
 await clock.advance(1000);assert.match(button(d).textContent,/· 6s/);assert.equal(renders,initialRenders);
 await clock.late(5000);assert.match(button(d).textContent,/· 11s/);assert.equal(renders,initialRenders);
 await d.render(tree({...node,revision:2},{...observation,mainActivity:{...observation.mainActivity}}));
 assert.match(button(d).textContent,/· 11s/);assert.equal(clock.starts,initialStarts,'same snapshot does not restart interval');
 await clock.advance(1000);assert.match(button(d).textContent,/· 12s/);
 await d.render(tree(node,{...observation,observedAtMs:5000}));assert.match(button(d).textContent,/· 4s/,'new evidence can calibrate downward');
 await clock.advance(1000);assert.match(button(d).textContent,/· 5s/);
 await d.render(tree({...node,startedAtMs:2000},{...observation,observedAtMs:6000}));
 assert.match(button(d).textContent,/· 4s/,'changed endpoints calibrate even with the same snapshot duration');
}));

test('terminal evidence including zero freezes completed, failed, interrupted and still-finishing durations',async t=>withClock(t,async(d,clock)=>{
 for(const patch of [{state:'worked',status:'completed'},{state:'worked',status:'failed'},{state:'worked',status:'interrupted'},{state:'working',status:'running'}]){
  await d.remount();await d.render(view());await clock.advance(2000);assert.match(button(d).textContent,/· 7s/);
  await d.render(view({...node,...patch,timingState:'terminal',durationMs:0},{...observation,mainActivity:{...observation.mainActivity,stage:'finishing'}}));
  assert.match(button(d).textContent,/· 0s/);assert.equal(clock.active.size,0);
  await clock.advance(9000);assert.match(button(d).textContent,/· 0s/);assert.doesNotMatch(button(d).textContent,/上次快照/);
 }
}));

test('disconnect freezes the displayed value; only new evidence resumes after reconnect',async t=>withClock(t,async(d,clock)=>{
 await d.render(view());await clock.advance(2000);
 await d.render(view(node,{...observation,connected:false}));assert.match(button(d).textContent,/· 7s.*上次快照/);assert.equal(clock.active.size,0);
 await clock.advance(10000);assert.match(button(d).textContent,/· 7s/);
 await d.render(view());assert.match(button(d).textContent,/· 7s.*上次快照/);assert.equal(clock.active.size,0);
 await d.render(view(node,{...observation,observedAtMs:15000}));assert.match(button(d).textContent,/· 14s/);assert.equal(clock.active.size,1);
 await clock.advance(1000);assert.match(button(d).textContent,/· 15s/);assert.doesNotMatch(button(d).textContent,/上次快照/);
}));

test('ineligible states freeze while compacting and native approval waits retain continuous elapsed semantics',async t=>withClock(t,async(d,clock)=>{
 for(const [n,o] of [
  [{...node,status:'unknown',timingState:'unknown'},observation],
  [node,{...observation,serviceRunning:false}],
  [node,{...observation,mainActivity:{...observation.mainActivity,stage:'preparing'}}],
  [node,{...observation,mainActivity:{...observation.mainActivity,stage:'unknown'}}],
  [node,{...observation,generationTurnId:'wrong'}],
  [node,{...observation,mainActivity:{...observation.mainActivity,turnId:'wrong'}}],
  [node,{...observation,mainActivity:{...observation.mainActivity,source:'internal'}}],
 ]){
  await d.remount();await d.render(view());await clock.advance(1000);
  await d.render(view(n,o));assert.equal(clock.active.size,0);await clock.advance(3000);assert.match(button(d).textContent,/· 6s.*上次快照/);
 }
 await d.remount();await d.render(h(ProcessNodeView,{node,observation,renderText:text=>h('p',null,text),activityText:'等待审批'}));
 await clock.advance(1000);assert.match(button(d).textContent,/等待审批.*· 6s/);
 await d.render(view(node,{...observation,observedAtMs:10000,mainActivity:{...observation.mainActivity,stage:'compacting'}}));
 await clock.advance(1000);assert.match(button(d).textContent,/· 10s/);
}));

test('thread and process changes discard duration; a new turn on the same process retains its interval',async t=>withClock(t,async(d,clock)=>{
 const tree=(n,o=observation)=>h(ProcessNodeView,{node:n,observation:o,renderText:text=>h('p',null,text)});
 for(const patch of [{threadId:'new-thread'},{id:'new-process'}]){
  await d.remount();await d.render(tree(node));await clock.advance(3000);assert.match(button(d).textContent,/· 8s/);
  const next={...node,...patch};await d.render(tree(next));assert.doesNotMatch(button(d).textContent,/· \d/);assert.equal(clock.active.size,0);
  const o={...observation,threadId:next.threadId,generationTurnId:next.turnIds.at(-1),observedAtMs:3000,mainActivity:{...observation.mainActivity,processId:next.id,turnId:next.turnIds.at(-1)}};
  await d.render(tree(next,o));assert.match(button(d).textContent,/· 2s/);await clock.advance(1000);assert.match(button(d).textContent,/· 3s/);
 }
 await d.remount();await d.render(tree(node));await clock.advance(3000);
 const next={...node,turnIds:['turn-1','turn-2']};await d.render(tree(next));assert.match(button(d).textContent,/· 8s.*上次快照/);assert.equal(clock.active.size,0);
 await d.render(tree(next,{...observation,observedAtMs:12000,generationTurnId:'turn-2',mainActivity:{...observation.mainActivity,turnId:'turn-2'}}));assert.match(button(d).textContent,/· 11s/);
 await d.remount();assert.equal(clock.active.size,0);await clock.advance(5000);assert.equal(d.container.textContent,'');
}));

test('a readEpoch change discards a previous snapshot even on the same process',async t=>withClock(t,async(d,clock)=>{
 await d.render(view(node,{...observation,readEpoch:'old'}));await clock.advance(3000);
 await d.render(view(node,{...observation,readEpoch:'new',connected:false}));assert.match(button(d).textContent,/耗时未提供/);assert.doesNotMatch(button(d).textContent,/· 8s/);assert.equal(clock.active.size,0);
}));

test('unknown or missing start never schedules growth; StrictMode releases intervals',async t=>withClock(t,async(d,clock)=>{
 for(const patch of [{startedAtMs:undefined},{timingSource:undefined},{timingState:'unknown'}]){
  await d.remount();await d.render(view({...node,...patch}));await clock.advance(3000);assert.doesNotMatch(button(d).textContent,/· \d/);assert.equal(clock.active.size,0);
 }
 await d.remount();await d.render(h(React.StrictMode,null,view()));assert.equal(clock.active.size,1);await clock.advance(1000);assert.match(button(d).textContent,/· 6s/);
 await d.remount();assert.equal(clock.active.size,0);
}));

function conversation(history,nodes){return projectConversation(history,nodes,[]).messages;}
const historyMessage=(id,text='')=>({id,threadId:node.threadId,requestId:null,role:'assistant',text,status:'completed',createdAt:1});
function body(messages,o=observation){return h(ProcessObservationContext.Provider,{value:o},messages.map(message=>h('article',{key:message.id,'data-message-id':message.id},h(ProcessMessageContent,{node:message.process,renderText:text=>h('p',null,text),work:[],children:h('div',{'data-final-body':message.id},message.text)}))));}

test('real backend display projection -> production shell: multi final once, streaming ID correction, no raw final copy',async()=>withDom(async d=>{
 const raw={...node,final:{id:'f2',text:'SECOND FINAL'},items:[commentary('c','公开进度'),{...commentary('f1','FIRST FINAL'),phase:'final_answer',completed:true},{...commentary('f2','SECOND DRAFT'),phase:'final_answer',completed:false}]};
 const messages=conversation([historyMessage('body','OLD CONCATENATION')],[raw]);await d.render(body(messages));const article=d.find(n=>n.attrs['data-message-id']==='body');
 assert.equal(d.container.textContent.match(/FIRST FINAL/g).length,1);assert.equal(d.container.textContent.match(/SECOND DRAFT/g).length,1);assert.doesNotMatch(d.container.textContent,/OLD CONCATENATION|SECOND FINAL/);
 const corrected={...done(raw),items:raw.items.map(item=>item.id==='f2'?{...item,text:'SECOND FINAL',completed:true,revision:2}:item)};await d.render(body(conversation([historyMessage('body')],[corrected])));assert.equal(d.find(n=>n.attrs['data-message-id']==='body'),article);
 assert.equal(visibleText(d.container).match(/FIRST FINAL/g).length,1);assert.equal(visibleText(d.container).match(/SECOND FINAL/g).length,1);assert.doesNotMatch(d.container.textContent,/SECOND DRAFT/);
 await d.click(button(d));assert.equal(d.container.textContent.match(/SECOND FINAL/g).length,1);
}));

test('formal publications retain original IDs even after internal batch, same text different IDs survives, no-final creates no answer',async()=>withDom(async d=>{
 const internal={...done(node),sourceKind:'worker',deliveryMessageIds:['pub-1','pub-2'],final:undefined,items:[worker]};
 const messages=conversation([historyMessage('body'),historyMessage('pub-1','正式发布摘要'),historyMessage('pub-2','正式发布摘要')],[internal]);await d.render(body(messages));
 assert.deepEqual(d.all().filter(n=>'data-message-id' in n.attrs).map(n=>n.attrs['data-message-id']),['body','pub-1','pub-2']);assert.equal(visibleText(d.container).match(/正式发布摘要/g).length,2);
 assert.equal(d.find(n=>n.attrs['data-final-body']==='body').textContent,'');assert.doesNotMatch(d.container.textContent,/处理完毕|已读/);
}));

test('approved immutable Worker card remains visible once across original disclosure and live transport',async()=>withDom(async d=>{
 const event={id:'event',seq:1,revision:1,kind:'workerEvent',eventKey:'result:one',event:{eventKind:'result_received',title:'后台研究',body:'保留一个待确认事项。'}};
 const messages=conversation([historyMessage('body')],[{...done(node),items:[...node.items,event]}]);await d.render(body(messages));
 assert.equal(button(d).attrs['aria-expanded'],'false');assert.doesNotMatch(visibleText(d.container),/保留一个待确认事项/);
 const originalCard=d.find(n=>n.attrs['data-worker-event']==='result:one');
 await d.click(button(d));
 const card=d.find(n=>n.attrs['data-worker-event']==='result:one'),cardButton=card.childNodes.find(n=>n.tagName==='BUTTON');
 assert.equal(card,originalCard);assert.ok(!d.find(n=>n.attrs['data-slot']==='run-activity').contains(card));
 assert.equal(cardButton.attrs['aria-expanded'],'false');await d.click(cardButton);assert.equal(d.container.textContent.match(/保留一个待确认事项。/g).length,1);
 assert.equal(d.all().filter(n=>n.attrs['data-worker-event']).length,1);await d.render(body(messages,{...observation,connected:false}));assert.match(visibleText(d.container),/保留一个待确认事项。/);assert.equal(card.attrs['data-state'],'waiting');assert.match(card.textContent,/收到成果待核对/);assert.doesNotMatch(visibleText(d.container),/部分完成|上次状态/);
 assert.equal(d.all().filter(n=>n.tagName==='DIALOG').length,0);
}));

test('service/thread/generation mismatches never start snapshot growth; paired endpoint fallback and genuine zero remain valid',async()=>withDom(async d=>{
 for(const patch of [{serviceRunning:false},{threadId:'other-thread'},{generationTurnId:'other-turn'},{observedAtMs:undefined}]){
  await d.render(view({...node,id:JSON.stringify(patch)},{...observation,...patch}));assert.doesNotMatch(button(d).textContent,/· \d/);
 }
 await d.render(view({...done(node),id:'endpoints',durationMs:undefined,startedAtMs:1000,endedAtMs:6500}));assert.match(button(d).textContent,/· 5s/);
 await d.render(view({...done(node),id:'zero',durationMs:0}));assert.match(button(d).textContent,/· 0s/);
}));

test('Worker missing-version title remains unknown; failure/interrupt/unknown keep final body and honest process status',async()=>withDom(async d=>{
 for(const status of ['failed','interrupted','unknown']){
  const raw={...done(node),status,state:status==='unknown'?'working':'worked',items:[{...commentary('f','保留真实 final'),phase:'final_answer',completed:true},{...worker,label:undefined}],final:{id:'f',text:'保留真实 final'}};
  const messages=conversation([historyMessage('body')],[raw]);await d.render(body(messages,{...observation,workerTitles:new Map([['run-synthetic','历史后台工作']])}));
  assert.equal(d.container.textContent.match(/保留真实 final/g).length,1);assert.equal(button(d),undefined,'empty official activity stays a status row');assert.match(visibleText(d.container),/旧后台工作记录（当时的事件内容未保留）/);assert.doesNotMatch(visibleText(d.container),/历史后台工作/);
  assert.equal(messages[0].status,status==='unknown'?'interrupted':status);
  assert.match(visibleText(d.container),status==='failed'?/处理失败/:status==='interrupted'?/已中断/:/状态待确认/);
 }
}));
