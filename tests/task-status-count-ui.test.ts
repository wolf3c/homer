import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {WebState} from '../src/web-contract.js';
import type {TaskOverview,OverviewTask} from '../src/task-overview.js';

// Real component + React SSR; only the async data-hook boundary is controlled.
// This checks rendered semantics, not layout, focus, browser or hook scheduling.
const output=await build({entryPoints:['ui/task-status.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'snapshot-boundary',setup(b){b.onLoad({filter:/task-status-data\.ts$/},()=>({contents:'export function useTaskStatusData(){return globalThis.snapshot;}',loader:'ts'}));}}]});
const context={module:{exports:{}},require:createRequire(new URL('../ui/task-status.tsx',import.meta.url)),EventTarget,snapshot:{} as Record<string,unknown>};
runInNewContext(output.outputFiles[0]!.text,context);
const Component=(context.module.exports as {TaskStatusPopover:ComponentType<Record<string,unknown>>}).TaskStatusPopover;
const task=(id:string):OverviewTask=>({id,title:'合成任务',goal:'合成任务',notes:'',headVersion:1,revision:1,state:'open',outcome:null,controlState:'normal',historyState:'visible',sourceRequestId:null,workers:[{id:'worker-'+id,taskId:id,pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run-'+id,workerId:'worker-'+id,taskId:id,status:'running',phase:'executing',version:1,epoch:0,sourceRequestId:null}}]});
function render(data:TaskOverview|null,options:{stale?:boolean;error?:string;connected?:boolean}={}){
 context.snapshot={data,stale:options.stale??false,error:options.error??'',busy:false,refresh:()=>{}};
 return renderToStaticMarkup(createElement(Component,{state:{threadId:'synthetic',interactions:[]} as unknown as WebState,connected:options.connected??true,onInteraction:()=>{},asideContainer:null,onBeforeLayoutChange:()=>{}}));
}
const roots=(n:number)=>({tasks:Array.from({length:n},(_,i)=>task('task-'+i))});
test('rendered 0/1/12/large counts share root facts and an accessible button name',()=>{
 for(const [n,visible,name] of [[0,'','工作状态，无工作中任务'],[1,'1','工作状态，1 个任务工作中'],[12,'12','工作状态，12 个任务工作中'],[100,'99+','工作状态，100 个任务工作中']] as const){
  const html=render(roots(n));
  assert.ok(html.includes('aria-label="'+name+'"'),name);
  assert.match(html,/aria-expanded="false"/);assert.match(html,/aria-controls="task-status-panel"/);
  assert.match(html,/class="status-entry-icon" aria-hidden="true"/);
  if(n)assert.ok(html.includes('data-count="working">'+visible+'</span>'));
  else assert.doesNotMatch(html,/data-count="working"/);
 }
 const root=task('root');root.workers.push({...root.workers[0]!,id:'peer',run:{...root.workers[0]!.run,id:'peer',workerId:'peer'}});
 assert.match(render({tasks:[root]}),/aria-label="工作状态，1 个任务工作中"/);
});
test('unloaded, stale, failed and disconnected snapshots never present a current count or zero',()=>{
 for(const [data,options,want] of [
  [null,{},'正在读取'],[null,{error:'failed'},'读取失败'],
  [roots(12),{stale:true},'数量待核实'],[roots(0),{stale:true},'数量待核实'],
  [roots(1),{connected:false},'连接未确认'],[roots(1),{error:'failed'},'读取失败'],
 ] as const){
  const html=render(data,options);assert.doesNotMatch(html,/data-count="working"/);
  assert.ok(html.includes(want));assert.doesNotMatch(html,/aria-label="工作状态，无工作中任务"/);
 }
});

test('an uncertain task snapshot cannot announce a known zero or exact active total',()=>{
 const unknown=task('unknown');unknown.workers[0]!.run.phase='uncertain';
 for(const tasks of [[unknown],[task('active'),unknown]]){
  const html=render({tasks});assert.doesNotMatch(html,/data-count="working"/);
  assert.ok(html.includes('数量待核实'));assert.doesNotMatch(html,/无工作中任务/);
 }
});
