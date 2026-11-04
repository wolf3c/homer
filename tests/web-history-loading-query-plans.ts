// Explain the actual owner queries with synthetic rows only; no VM-visit claims.
import {readFileSync,writeFileSync} from 'node:fs';
import {historyFixture,syntheticRoot} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
const f=historyFixture(20);
try{
 for(let n=0;n<200;n++)f.inputs.accept({requestId:'synthetic-plan-'+n,text:'Synthetic query-plan input'});
 new WebHistoryPages(f.history,f.processes,f.inputs);
 const source=readFileSync(new URL('../src/recursive-main-inputs.ts',import.meta.url),'utf8');
 const inputRows=source.match(/const inputRows = `([^`]+)`/)?.[1];if(!inputRows)throw Error('owner_query_not_found');
 const old=inputRows+" WHERE m.kind='user_input' AND m.recipientAgentId=? AND r.state IN ('pending','offered','received','uncertain') ORDER BY m.seq LIMIT 81";
 const bounded=inputRows.replace('FROM agent_messages m','FROM web_active_inputs w CROSS JOIN agent_messages m ON m.id=w.messageId')+" WHERE w.seq>? AND m.kind='user_input' AND m.recipientAgentId=? ORDER BY w.seq LIMIT 81";
 const agent=f.store.meta('mainAgentId')!;
 const plan=(sql:string,args:(string|number)[])=>({sql,plan:f.store.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args),returnedRows:f.store.db.prepare(sql).all(...args).length});
 const inactive=readFileSync(new URL('../src/web-homer.ts',import.meta.url),'utf8').match(/prepare\(`(WITH cancelled AS[^`]+)`\)/)?.[1];if(!inactive)throw Error('inactive_owner_query_not_found');
 const result={seed:20261021,syntheticOnly:true,meaning:'Returned rows are not SQLite rows visited. Range/index plans are retained separately from access counters.',directActiveCandidate:plan(old,[agent]),activeIdentity:plan(bounded,[0,agent]),unboundedWorkerCandidate:plan('SELECT DISTINCT w.nodeId,w.taskId FROM web_dirty_tasks d JOIN web_process_workers w ON w.taskId=d.taskId',[]),workerRelation:plan('SELECT DISTINCT w.nodeId,w.taskId FROM web_dirty_tasks d CROSS JOIN web_process_workers w ON w.taskId=d.taskId',[]),unboundedInactiveCandidate:plan("SELECT id FROM worker_interactions WHERE json_extract(authority,'$.sourceRequestId')=? AND state IN ('cancelled','expired') ORDER BY rowid LIMIT 81",['synthetic-plan-0']),boundedInactive:plan(inactive,['synthetic-plan-0','synthetic-plan-0'])};
 writeFileSync(syntheticRoot+'/read-query-plan-evidence.json',JSON.stringify(result,null,2)+'\n');
}finally{f.close();}
