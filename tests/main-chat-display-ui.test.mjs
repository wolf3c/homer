import test from 'node:test';
import assert from 'node:assert/strict';
import {ProcessNodeView,ProcessMessageContent} from './helpers/process-ui-loader.mjs';
import {React,withDom} from './helpers/process-dom.mjs';
const h=React.createElement;
const node={id:'p',threadId:'thread',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'m',state:'working',status:'running',turnIds:['turn'],items:[{id:'progress',seq:0,revision:1,kind:'commentary',text:'公开说明'},{id:'call',seq:1,revision:1,kind:'tool',category:'command',threadId:'thread',turnId:'turn',label:'运行命令',status:'running',content:{input:{state:'recorded',value:{command:'pnpm test --token SECRET'}},output:{state:'pending'}}}],startedAtMs:1000,timingSource:'hostObserved',timingState:'running'};
const observation={connected:true,serviceRunning:true,threadId:'thread',observedAtMs:85000,generationTurnId:'turn',mainActivity:{processId:'p',turnId:'turn',source:'user',stage:'native'}};

// Bundle the actual private row for a component test; no test export in product.
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(new URL('../package.json',import.meta.url));
const built=buildSync({stdin:{contents:readFileSync('ui/task-status.tsx','utf8')+'\nexport {TaskStatusRow,Disclosures,ExecutionObservationContext};',resolveDir:resolve('ui'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'empty'}});
const mod={exports:{}};Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
const {TaskStatusRow,Disclosures,ExecutionObservationContext}=mod.exports;
const worker={id:'worker',taskId:'task',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run',taskId:'task',workerId:'worker',version:1,epoch:1,threadId:'worker-thread',turnId:'worker-turn',status:'running',phase:'executing',createdAt:1000,startedAt:2000,endedAt:null}};
const task={id:'task',headVersion:1,state:'open',controlState:'normal',historyState:'visible',workers:[worker],results:[],deliveries:[]};
test('task row keeps execution record at bottom, collapsed by default, with finite-history boundary',async()=>withDom(async d=>{
 const view=t=>h(Disclosures.Provider,{value:new Map([['task/worker/worker','worker:run:1:1:worker-thread:worker-turn']])},h(TaskStatusRow,{task:t,worker:t.workers[0],label:'任务',status:{state:'working',label:'执行中',icon:'Activity',attention:'none',owner:'worker'},onOpenChange:()=>{}},h('p',null,'原有结果与操作')));
 await d.render(view(task));const record=d.find(n=>n.attrs['data-task-execution-record']==='task');assert.ok(record,'record is in the existing expanded task');
 const body=record.parentNode;assert.equal(body.lastChild,record);assert.ok(body.textContent.indexOf('原有结果与操作')<body.textContent.indexOf('执行记录'));
 const toggle=d.all().find(n=>record.contains(n)&&n.attrs['data-slot']==='collapsible-trigger');assert.equal(toggle.attrs['aria-expanded'],'false');
 await d.click(toggle);assert.doesNotMatch(record.textContent,/工具步骤|参数与结果|内存记录/);assert.match(record.textContent,/等待结束确认/);assert.match(record.textContent,/已记录开始/);
 const previous=toggle;await d.render(view({...task,revision:2,workers:[{...worker,run:{...worker.run,status:'failed',phase:'ended',endedAt:3000}}]}));assert.equal(previous,d.all().find(n=>record.contains(n)&&n.attrs['data-slot']==='collapsible-trigger'));assert.equal(toggle.attrs['aria-expanded'],'true');assert.match(record.textContent,/执行失败/);assert.equal(d.all().filter(n=>n.tagName==='DIALOG').length,0);
}));

test('open Worker facts ignore unrelated history revisions but refresh on lifecycle changes',async()=>withDom(async d=>{
 let reads=0;
 const read=async()=>{reads++;return {ok:true,json:async()=>({taskId:'task',runs:[worker.run]})};};
 const render=(revision,current=task)=>d.render(h(ExecutionObservationContext.Provider,{value:{connected:true,scope:'test',revision,read}},h(Disclosures.Provider,{value:new Map([['task/worker/worker','worker:run:1:1:worker-thread:worker-turn']])},h(TaskStatusRow,{task:current,worker:current.workers[0],label:'任务',status:{state:'working',label:'执行中',icon:'Activity',owner:'worker'},onOpenChange:()=>{}},null))));
 await render(1);const record=d.find(n=>n.attrs['data-task-execution-record']==='task');await d.click(d.all().find(n=>record.contains(n)&&n.attrs['data-slot']==='collapsible-trigger'));assert.equal(reads,1);
 for(let revision=2;revision<=11;revision++)await render(revision);
 assert.equal(reads,1,'unrelated Main streaming must not reread Worker facts');
 await render(12,{...task,workers:[{...worker,run:{...worker.run,status:'failed',phase:'ended',endedAt:3000}}]});assert.equal(reads,2,'Run lifecycle update still refreshes facts');
}));
