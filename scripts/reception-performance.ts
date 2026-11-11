// Synthetic, isolated benchmark. Never opens the user's runtime/database.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
const source = resolve(process.argv[2] ?? '.');
const load = (file: string) => import(pathToFileURL(join(source, 'src', file + '.ts')).href);
const [{ Store }, { Files }, { WorkerInteractions }, { ConversationHistory }, { RecursiveTasks }, { MainInputs }, {Homer}, {MainProcessHistory}, {homerWebBridge}] = await Promise.all(['store','files','worker-interactions','web-history','recursive-tasks','recursive-main-inputs','service','main-process','web-homer'].map(load));
const root = resolve('.codex/scratch/main-agent-reception-optimization'); mkdirSync(root, {recursive:true});
const results=[];
for (const size of [60,120,240]) {
 const dir=mkdtempSync(join(root,'synthetic-perf-')), store=new Store(join(dir,'synthetic.sqlite'));
 try {
  const interactions=new WorkerInteractions(store.db), files=new Files(join(dir,'workspace')); const history=new ConversationHistory(store.db), tasks=new RecursiveTasks(store,files);tasks.migrate(); store.setMeta('mainThread','synthetic-thread');
  const queue=new MainInputs(tasks,history);
  for(let i=0;i<size;i++){queue.accept({requestId:'synthetic-'+i,text:'Synthetic input '+i});const next=queue.claim();queue.finish(next.messageId,next.revision,'completed');}
  queue.accept({requestId:'synthetic-pending',text:'Synthetic pending'});
  const app=Object.create(Homer.prototype);Object.assign(app,{store,history,tasks,files,interactions,inputs:queue,processes:new MainProcessHistory(store.db),workers:new Map()});
  const bridge=homerWebBridge(app),pendingRow=queue.row('synthetic-pending');
  let prepares=0, historyLists=0, returnedRows=0,candidateSql='';
  const prepare=store.db.prepare.bind(store.db), list=history.list.bind(history);
  store.db.prepare=(sql:string)=>{prepares++;if(/\br\.state\s*=\s*'pending'/.test(sql))candidateSql=sql;const statement=prepare(sql);for(const method of ['get','all'] as const){const call=statement[method].bind(statement);statement[method]=(...args:any[])=>{const result=call(...args);returnedRows+=Array.isArray(result)?result.length:result?1:0;return result;};}return statement;};
  history.list=(...args:any[])=>{historyLists++;return list(...args);};
  const sample=async(name:string,fn:()=>unknown,restore=()=>{})=>{
   await fn();restore(); const times=[];let prepareCount=0,listCount=0,rowCount=0;
   for(let i=0;i<7;i++){prepares=0;historyLists=0;returnedRows=0;const start=performance.now();await fn();times.push(performance.now()-start);prepareCount+=prepares;listCount+=historyLists;rowCount+=returnedRows;restore();}
   times.sort((a,b)=>a-b);return {name,prepares:prepareCount/7,historyLists:listCount/7,returnedRows:rowCount/7,p50Ms:times[3],p95Ms:times[6],samples:7};
  };
  const restoreClaim=()=>{
   store.db.prepare("UPDATE agent_receipts SET state='pending',revision=0,offeredTurnId=NULL WHERE messageId=?").run(pendingRow.id);
   store.db.prepare("UPDATE conversation_messages SET status=CASE WHEN role='user' THEN 'queued' ELSE 'running' END WHERE requestId='synthetic-pending'").run();
   store.db.prepare("DELETE FROM requests WHERE id='synthetic-pending'").run();
  };
  const measurements=[await sample('input.current',()=>queue.current(pendingRow)),await sample('queue.list',()=>queue.list()),await sample('queue.runnable',()=>queue.runnable()),await sample('queue.claim',()=>queue.claim(),restoreClaim),await sample('history.list',()=>history.list('synthetic-thread')),await sample('web.history.state+serialize',async()=>JSON.stringify(await bridge.history!.state()))];
  const state=await bridge.history!.state();
  assert.ok(candidateSql,'pending queue query was not captured');
  results.push({historicalInputs:size,pending:1,serializedStateBytes:Buffer.byteLength(JSON.stringify(state)),measurements,plan:prepare("EXPLAIN QUERY PLAN SELECT text,quote FROM conversation_messages WHERE threadId=? AND requestId=? AND role='user' ORDER BY createdAt,rowid LIMIT 1").all('synthetic-thread','synthetic-pending'),candidatePlan:prepare('EXPLAIN QUERY PLAN '+candidateSql).all(store.meta('mainAgentId'),store.meta('mainThread'))});
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,source,sample:'generated synthetic only; same process and schema',results},null,2));
