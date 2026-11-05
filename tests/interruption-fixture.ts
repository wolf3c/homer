// Actual Task/Worker state in memory; no engine, model, network or disk DB.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {realpathSync} from 'node:fs';
import {Store} from '../src/store.js';
import {RecursiveTasks,type Actor} from '../src/recursive-tasks.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import type {Files} from '../src/files.js';
export const main:Actor={agentId:'main:synthetic',threadId:'thread:synthetic-main',turnId:'turn:synthetic-main',sourceRequestId:'synthetic-user'};
export function fixture(t:TestContext){
 const store=new Store(':memory:');t.after(()=>store.close());
 const interactions=new WorkerInteractions(store.db);
 store.startRequest(main.sourceRequestId!,'synthetic-hash');store.setMeta('mainAgentId',main.agentId);store.setMeta('mainThread',main.threadId!);
 const files=new Proxy({workspace:realpathSync(process.cwd())},{get(target,key){if(key==='workspace')return target.workspace;return ()=>{throw Error('unexpected_file_capability:'+String(key));};}}) as Files;
 const tasks=new RecursiveTasks(store,files);tasks.migrate();
 const authority={sourceRequestId:main.sourceRequestId!,description:'Synthetic structured work only',materials:[],resultIds:[]};
 const task=tasks.createTask(main,{operationId:'create',goal:'核对合成材料',authority});
 const worker=tasks.workerOpen(main,{operationId:'open',taskId:task.taskId,text:'核对合成材料'});
 const effects:string[]=[];
 const tools=new RecursiveTools(tasks,{rootAuthority:()=>authority,wake:()=>{effects.push('wake');},stop:async r=>{effects.push('stop');return r;},steer:async r=>{effects.push('steer');return r;}});
 return {store,interactions,tasks,task,worker,authority,tools,effects};
}
export type Fixture=ReturnType<typeof fixture>;
export function running(f:Fixture):Actor{const run=f.tasks.claim(f.worker.runId)!;assert.ok(run);f.tasks.bind(run.id,run.epoch,'thread:'+run.workerId,'turn:'+run.id);return {agentId:'worker:'+run.workerId,runId:run.id,epoch:run.epoch,threadId:'thread:'+run.workerId,turnId:'turn:'+run.id};}
export function mutation(f:Fixture,operationId='action'){return {taskId:f.task.taskId,operationId,expectedRevision:f.tasks.task(f.task.taskId).revision};}
export function goalChange(f:Fixture,operationId='change-goal'){return {...mutation(f,operationId),patch:{goal:'按新要求核对合成材料'},authority:f.authority};}
export function snapshot(f:Fixture){const tables=f.store.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all() as {name:string;sql:string}[];return JSON.stringify(tables.map(row=>({...row,rows:f.store.db.prepare('SELECT * FROM "'+row.name.replaceAll('"','""')+'" ORDER BY rowid').all()})));}
