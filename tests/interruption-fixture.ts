// Requirements-derived synthetic fixtures. No native engine, model, network or disk DB.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {realpathSync} from 'node:fs';
import {Store} from '../src/store.js';
import {RecursiveTasks,type Actor,type Contract} from '../src/recursive-tasks.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import type {Files} from '../src/files.js';
export const main:Actor={agentId:'main:synthetic',sourceRequestId:'synthetic-user'};
export const contract:Contract={goal:'核对合成材料',inputs:[],resultKind:'structured',acceptance:{criteria:[]}};
export function fixture(t:TestContext){
 const store=new Store(':memory:');t.after(()=>store.close());
 const interactions=new WorkerInteractions(store.db);
 store.startRequest(main.sourceRequestId!,'synthetic-hash');store.setMeta('mainAgentId',main.agentId);
 const files=new Proxy({workspace:realpathSync(process.cwd())},{get(target,key){if(key==='workspace')return target.workspace;return ()=>{throw Error('unexpected_file_capability:'+String(key));};}}) as Files;
 const tasks=new RecursiveTasks(store,files);tasks.migrate();
 const root=tasks.createRoot(main,{operationId:'create',title:'合成核对事项',executorKind:'worker',contract,authority:{sourceRequestId:main.sourceRequestId!,description:'Synthetic structured work only',materials:[],resultIds:[],collaborateTaskIds:[]}});
 const effects:string[]=[];
 const tools=new RecursiveTools(tasks,{rootAuthority:()=>{throw Error('unexpected_root_authority');},wake:()=>{effects.push('wake');},stop:async r=>{effects.push('stop');return r;},update:async r=>{effects.push('update');return r;}});
 return {store,interactions,tasks,root,tools,effects};
}
export type Fixture=ReturnType<typeof fixture>;
export function running(f:Fixture,id=f.root.taskId):Actor{const t=f.tasks.task(id),r=f.tasks.claim(t.currentRunId!)!;assert.ok(r);f.tasks.bind(r.id,r.epoch,'thread:'+r.id,'turn:'+r.id);return {agentId:t.executorAgentId,runId:r.id,epoch:r.epoch,threadId:'thread:'+r.id,turnId:'turn:'+r.id};}
export function mutation(f:Fixture,id=f.root.taskId,op='action'){const t=f.tasks.task(id);return {taskId:id,operationId:op,version:t.headVersion,expectedTaskRevision:t.revision};}
export function replacement(f:Fixture,op='replace'){return {...mutation(f,undefined,op),mode:'stop_replace' as const,contract,children:[],queuedDisposition:[]};}
export function snapshot(f:Fixture){const tables=f.store.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all() as {name:string;sql:string}[];return JSON.stringify(tables.map(row=>({...row,rows:f.store.db.prepare('SELECT * FROM "'+row.name.replaceAll('"','""')+'" ORDER BY rowid').all()})));}
export function complete(f:Fixture,a:Actor){const receipt=f.tasks.endSegment(a.runId!,a.epoch!,{status:'completed',text:JSON.stringify({summary:'合成成果'})},true)!;f.tasks.endSegment(a.runId!,a.epoch!,{status:'completed',text:'Synthetic final result'},true);f.tasks.inspect(main,{resultId:receipt.resultId!});f.tasks.review(main,{...mutation(f,undefined,'review'),resultId:receipt.resultId!,accepted:true,outcome:'succeeded',reason:'Synthetic inspection',evidence:{facts:true},children:[]});return receipt;}
