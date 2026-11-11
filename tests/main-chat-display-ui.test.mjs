import test from 'node:test';
import assert from 'node:assert/strict';
import {ProcessNodeView,ProcessMessageContent,ProcessObservationContext} from './helpers/process-ui-loader.mjs';
import {React,withDom} from './helpers/process-dom.mjs';
const h=React.createElement;
const node={id:'p',threadId:'thread',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'m',state:'working',status:'running',turnIds:['turn'],items:[{id:'progress',seq:0,revision:1,kind:'commentary',text:'公开说明'},{id:'call',seq:1,revision:1,kind:'tool',category:'command',threadId:'thread',turnId:'turn',label:'运行命令',status:'running',content:{input:{state:'recorded',value:{command:'pnpm test --token SECRET'}},output:{state:'pending'}}}],startedAtMs:1000,timingSource:'hostObserved',timingState:'running'};
const observation={connected:true,serviceRunning:true,threadId:'thread',observedAtMs:85000,generationTurnId:'turn',mainActivity:{processId:'p',turnId:'turn',source:'user',stage:'native'}};
test('one in-place summary has unique source title, safe live action and continuous process duration',async()=>withDom(async d=>{
 const render=(n=node,sources=[{key:'source',icon:'Send',title:'消息队列调整',target:{taskId:'task',version:1},phaseLabel:'原请求'}])=>d.render(h(ProcessObservationContext.Provider,{value:observation},h(ProcessMessageContent,{node:n,taskSources:sources,renderText:t=>t},'结果保留')));
 await render();const toggle=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');assert.match(toggle.textContent,/消息队列调整 · 运行 pnpm test.*1m 24s/);assert.doesNotMatch(toggle.textContent,/主端本轮|SECRET/);
 await render({...node,items:node.items.map(i=>({...i,revision:2,status:'completed'}))});assert.equal(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'),toggle);assert.match(toggle.textContent,/处理中.*1m 24s/);assert.doesNotMatch(toggle.textContent,/已结束/,'a returned tool cannot end the active Main process');
 await render(node,[{key:'a',icon:'Send',title:'甲',target:{taskId:'a',version:1}},{key:'b',icon:'Send',title:'乙',target:{taskId:'b',version:1}}]);assert.match(toggle.textContent,/当前对话/);
}));
test('missing timing is explicit and an old turn cannot retain a live command',async()=>withDom(async d=>{
 await d.render(h(ProcessNodeView,{node:{...node,startedAtMs:undefined},observation:{...observation,generationTurnId:'old'},renderText:t=>t}));assert.match(d.container.textContent,/状态待确认.*耗时未提供/);assert.doesNotMatch(d.container.textContent,/pnpm|SECRET/);
}));
test('Worker process summary leaves its task name to the surrounding message title',async()=>withDom(async d=>{
 const worker={...node,sourceKind:'worker',sourceMessageIds:['notice']};
 await d.render(h(ProcessMessageContent,{node:worker,taskSources:[{title:'关于荷马显示版本号'}],activityText:'当前处理阶段待确认',renderText:t=>t},null));
 const toggle=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');
 assert.match(toggle.textContent,/^处理过程 · 当前处理阶段待确认/);
 assert.doesNotMatch(toggle.textContent,/关于荷马显示版本号/);
}));

// Bundle the actual private row for a component test; no test export in product.
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(new URL('../package.json',import.meta.url));
const built=buildSync({stdin:{contents:readFileSync('ui/task-status.tsx','utf8')+'\nexport {TaskStatusRow,Disclosures};',resolveDir:resolve('ui'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'empty'}});
const mod={exports:{}};Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
const {TaskStatusRow,Disclosures}=mod.exports;
const worker={id:'worker',taskId:'task',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run',taskId:'task',workerId:'worker',version:1,epoch:1,threadId:'worker-thread',turnId:'worker-turn',status:'running',phase:'executing',createdAt:1000,startedAt:2000,endedAt:null}};
const task={id:'task',headVersion:1,state:'open',controlState:'normal',historyState:'visible',workers:[worker],results:[],deliveries:[]};
test('task row keeps execution record at bottom, collapsed by default, with finite-history boundary',async()=>withDom(async d=>{
 const view=t=>h(Disclosures.Provider,{value:new Map([['task/worker/worker','worker:run:1:1:worker-thread:worker-turn']])},h(TaskStatusRow,{task:t,worker:t.workers[0],label:'任务',status:{state:'working',label:'执行中',icon:'Activity',attention:'none',owner:'worker'},onOpenChange:()=>{}},h('p',null,'原有结果与操作')));
 await d.render(view(task));const record=d.find(n=>n.attrs['data-task-execution-record']==='task');assert.ok(record,'record is in the existing expanded task');
 const body=record.parentNode;assert.equal(body.lastChild,record);assert.ok(body.textContent.indexOf('原有结果与操作')<body.textContent.indexOf('执行记录'));
 const toggle=d.all().find(n=>record.contains(n)&&n.attrs['data-slot']==='collapsible-trigger');assert.equal(toggle.attrs['aria-expanded'],'false');
 await d.click(toggle);assert.match(record.textContent,/仅含当前版本.*完整.*历史/);assert.match(record.textContent,/等待结束确认/);assert.match(record.textContent,/已记录开始/);
 const previous=toggle;await d.render(view({...task,revision:2,workers:[{...worker,run:{...worker.run,status:'failed',phase:'ended',endedAt:3000}}]}));assert.equal(previous,d.all().find(n=>record.contains(n)&&n.attrs['data-slot']==='collapsible-trigger'));assert.equal(toggle.attrs['aria-expanded'],'true');assert.match(record.textContent,/执行失败/);assert.equal(d.all().filter(n=>n.tagName==='DIALOG').length,0);
}));

// Catches accidental preview leakage or a streaming duration in the live region.
// Uses only the tracked DOM/loader helpers; no untracked accessibility preimage.
test('compact disclosure announces status without preview secrets or running seconds',async()=>withDom(async d=>{
 const render=n=>d.render(h(ProcessNodeView,{node:n,observation,renderText:t=>t}));
 await render(node);
 const statuses=d.all().filter(n=>n.attrs.role==='status');assert.equal(statuses.length,1);
 assert.match(statuses[0].textContent,/当前对话 · 运行 pnpm test/);
 assert.doesNotMatch(statuses[0].textContent,/SECRET|1m 24s|84s/);
 const toggle=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');assert.equal(toggle.attrs['aria-expanded'],'false');
 assert.doesNotMatch(d.container.textContent,/SECRET/);
 await d.click(toggle);assert.equal(toggle.attrs['aria-expanded'],'true');assert.match(d.container.textContent,/公开说明/);
 await render({...node,state:'worked',status:'completed',timingState:'terminal',durationMs:84000});
 assert.match(d.all().find(n=>n.attrs.role==='status').textContent,/已结束.*1m 24s/);
}));
