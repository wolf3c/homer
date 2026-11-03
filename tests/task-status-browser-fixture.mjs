// Real production UI + read-only HTTP owners, synthetic tasks only. No service,
// accounts, model calls, or product runtime/config. Build path supplied by caller.
import {fixture} from './web-history-followup-fixture.mjs';
import {syntheticFile} from './recursive-publication-fixture.js';
import {WorkerProgressStore} from '../src/worker-progress.js';
import {readTaskOverview} from '../src/task-overview.js';
import {createInterface} from 'node:readline';
const f=await fixture(3,'after'),progress=new WorkerProgressStore();
f.store.setMeta('mainAgentId','main:status-browser');f.store.startRequest('request-2','synthetic');
const main={agentId:'main:status-browser',sourceRequestId:'request-2'};
const contract=goal=>({goal,inputs:[],resultKind:'aggregate',acceptance:{criteria:[]}});
const authority={sourceRequestId:'request-2',description:'Synthetic status card test',materials:[],resultIds:[],collaborateTaskIds:[]};
const root=(id,title,kind='main')=>f.tasks.createRoot(main,{operationId:id,title,contract:contract(title),authority,executorKind:kind});
const purchase=root('purchase','采购选型方案');
function child(parent,id,title){const t=f.tasks.task(parent);return f.tasks.delegate(main,{operationId:id,taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,contract:contract(title),dependencies:[]});}
const research=child(purchase.taskId,'research','资料整理 Worker'),data=child(purchase.taskId,'data','收费数据 Worker'),cost=child(purchase.taskId,'cost','成本分析 Worker'),tax=child(purchase.taskId,'tax','税费资料 Worker');
const running=[research,data,cost,tax];
for(const [i,w]of running.entries()){const r=f.tasks.claim(w.runId);f.tasks.bind(r.id,r.epoch,'worker-'+i,'turn-'+i);}
const r=f.tasks.run(data.runId);
f.store.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt,runEpoch,contractVersion,userQuestion,escalationReason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('status-approval','status-identity','synthetic-fingerprint',r.id,r.threadId,r.turnId,'"synthetic-native"','ask_main','authorization','{}',JSON.stringify({...authority,nativeApprovals:false}),'pending_user',1,1,r.epoch,r.contractVersion,'是否允许访问这份收费数据？','其他 Worker 仍继续推进。');
function scope(w){const t=f.tasks.task(w.taskId),r=f.tasks.run(w.runId);return {taskId:t.id,version:t.headVersion,runId:r.id,epoch:r.epoch,threadId:r.threadId,turnId:r.turnId};}
progress.plan(scope(research),[{step:'收集候选服务资料',status:'completed'},{step:'核对服务条款',status:'inProgress'},{step:'整理比较要点',status:'pending'}]);
progress.tool(scope(cost),{category:'command'});progress.message(scope(tax),{phase:'commentary',completed:true,text:'已整理税费参考说明，正在核对适用范围。'});
// Explicit fixture-only next records exercise the optional renderer; production
// never invents next actions from a chat summary or tool arguments.
const progressRead=id=>({taskId:id,workers:readTaskOverview(f.store.db).tasks.filter(t=>t.rootTaskId===id).flatMap(t=>{const r=t.run;if(!r?.threadId||!r.turnId)return [];const p=progress.get({taskId:t.id,version:t.headVersion,runId:r.id,epoch:r.epoch,threadId:r.threadId,turnId:r.turnId});return p?[t.id===cost.taskId?{...p,next:[{id:'next-cost',text:'提交成本表，等待主 Agent 验收'}]}:p]:[];})});
const market=root('market','停止旧版市场调研','worker');f.store.db.prepare("UPDATE tasks SET controlState='stopping' WHERE id=?").run(market.taskId);f.store.db.prepare("UPDATE runs SET status='running',phase='uncertain',stopRequestedAt=1 WHERE id=?").run(market.runId);
const event=root('event','活动资料整理','worker');f.store.db.prepare("UPDATE tasks SET state='recovery' WHERE id=?").run(event.taskId);f.store.db.prepare("UPDATE runs SET summary='已整理活动议程，待补齐嘉宾资料。' WHERE id=?").run(event.runId);
const report=syntheticFile({...f},'request-2','九月供应商比较报告.md','# 九月供应商比较报告\n\n合成报告，当前版本已交付。');const delivery=report.publish('九月供应商比较报告已正式交付。');f.tasks.markDelivery(delivery.id,'recorded');f.history.record(delivery.historyMessageId,'synthetic-history',delivery.text);f.store.db.prepare('UPDATE matters SET title=? WHERE id=?').run('九月供应商比较报告',f.tasks.task(f.tasks.run(report.run.id).taskId).matterId);
f.bridge.taskOverview.list=async()=>({...readTaskOverview(f.store.db),progressRevision:progress.revision});f.bridge.taskOverview.progress=async id=>progressRead(id);
f.server.publish();
console.log(JSON.stringify({url:f.server.url,ids:{purchase:purchase.taskId,research:research.taskId,data:data.taskId,cost:cost.taskId,tax:tax.taskId,market:market.taskId,event:event.taskId},synthetic:true}));
const input=createInterface({input:process.stdin});input.on('line',line=>{try{const command=JSON.parse(line);if(command.action==='publish')f.server.publish();if(command.action==='progress'){progress.message(scope(cost),{phase:'commentary',completed:true,text:'成本表已按统一口径更新。'});f.server.publish();}}catch{}});
process.on('SIGTERM',async()=>{input.close();await f.close();process.exit(0);});
