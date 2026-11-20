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
const task=(id:string):OverviewTask=>({id,title:'合成任务',goal:'合成任务',notes:'',headVersion:1,revision:1,state:'open',historyState:'visible',sourceRequestId:null,workers:[{id:'worker-'+id,taskId:id,pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run-'+id,workerId:'worker-'+id,taskId:id,status:'running',phase:'executing',version:1,epoch:0,sourceRequestId:null}}]});
function render(data:TaskOverview|null,options:{stale?:boolean;error?:string;connected?:boolean}={}){
 context.snapshot={data,stale:options.stale??false,error:options.error??'',busy:false,refresh:()=>{}};
 return renderToStaticMarkup(createElement(Component,{state:{threadId:'synthetic',interactions:[]} as unknown as WebState,connected:options.connected??true,onInteraction:()=>{},asideContainer:null,onBeforeLayoutChange:()=>{}}));
}
const roots=(n:number)=>({tasks:Array.from({length:n},(_,i)=>task('task-'+i))});
test('entry keeps its accessible name for live, disconnected and historical snapshots',()=>{
 for(const data of [null,roots(0),roots(12)])for(const options of [{},{stale:true},{error:'failed'},{connected:false}]){
  const html=render(data,options);assert.match(html,/aria-label="工作状态"/);assert.match(html,/aria-controls="task-status-panel"/);
  assert.match(html,/aria-expanded="false"/);assert.doesNotMatch(html,/data-count=/);
 }
});
