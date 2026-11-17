// Real production UI + read-only HTTP owners, synthetic tasks only. No service,
// accounts, model calls, or product runtime/config. Build path supplied by caller.
import {fixture} from './web-history-followup-fixture.mjs';
import {readTaskOverview} from '../src/task-overview.js';
import {createInterface} from 'node:readline';
const f=await fixture(3,'after');
f.store.setMeta('mainAgentId','main:status-browser');
f.inputs.accept({requestId:'status-browser-source',text:'核对采购选型、市场、活动与合成报告'});const source=f.inputs.claim();f.inputs.finish(source.messageId,source.revision,'completed');
const main={agentId:'main:status-browser',sourceRequestId:'status-browser-source',threadId:'synthetic-history'};
const authority={sourceRequestId:'status-browser-source',description:'Synthetic status card test'};
const create=(id,title)=>f.tasks.createTask(main,{operationId:id,title,goal:title,authority});
const purchase=create('purchase','采购选型方案');
const open=(task,id,title)=>f.tasks.workerOpen(main,{operationId:id,taskId:task.taskId,text:title});
const research=open(purchase,'research','资料整理 Worker'),data=open(purchase,'data','收费数据 Worker'),cost=open(purchase,'cost','成本分析 Worker'),tax=open(purchase,'tax','税费资料 Worker');
for(const [i,w]of [research,data,cost,tax].entries()){const r=f.tasks.claim(w.runId);f.tasks.bind(r.id,r.epoch,'worker-'+i,'turn-'+i);}
const r=f.tasks.run(data.runId);
f.store.db.prepare(`INSERT INTO worker_interactions(id,identity,fingerprint,runId,threadId,turnId,requestId,source,kind,details,authority,state,createdAt,updatedAt,runEpoch,taskVersion,userQuestion,escalationReason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('status-approval','status-identity','synthetic-fingerprint',r.id,r.threadId,r.turnId,'"synthetic-native"','ask_main','authorization','{}',JSON.stringify({...authority,nativeApprovals:false}),'pending_user',1,1,r.epoch,r.version,'是否允许访问这份收费数据？','其他 Worker 仍继续推进。');
function scope(w){const r=f.tasks.run(w.runId);return {taskId:r.taskId,version:r.version,runId:r.id,epoch:r.epoch,threadId:r.threadId,turnId:r.turnId};}
// Explicit fixture-only next records exercise optional public next steps.
const market=create('market','停止旧版市场调研'),marketWorker=open(market,'market-worker','市场调研 Worker');
const marketRun=f.tasks.claim(marketWorker.runId);f.tasks.bind(marketRun.id,marketRun.epoch,'market-thread','market-turn');f.store.db.prepare("UPDATE tasks SET controlState='stopping' WHERE id=?").run(market.taskId);f.store.db.prepare("UPDATE runs SET phase='uncertain',stopRequestedAt=1 WHERE id=?").run(marketRun.id);
const event=create('event','活动资料整理');open(event,'event-worker','活动资料 Worker');f.store.db.prepare("UPDATE tasks SET state='paused' WHERE id=?").run(event.taskId);
const report=create('report','九月供应商比较报告'),opened=open(report,'report-worker','核对九月供应商比较报告'),run=f.tasks.claim(opened.runId);
f.tasks.bind(run.id,run.epoch,'report-worker-thread','report-worker-turn');f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'合成报告已核对'},true);
f.attach('九月供应商比较报告已发送。',[{filename:'九月供应商比较报告.md',mime:'text/markdown',content:'# 九月供应商比较报告\n\n合成报告，当前版本已完成。'}],{taskId:report.taskId,taskVersion:1});
f.tasks.settleTask(main,{operationId:'report-settle',taskId:report.taskId,expectedRevision:f.tasks.task(report.taskId).revision,outcome:'succeeded'});
f.bridge.taskOverview.list=async()=>readTaskOverview(f.store.db);
f.server.publish();
console.log(JSON.stringify({url:f.server.url,ids:{purchase:purchase.taskId,research:research.workerId,data:data.workerId,cost:cost.workerId,tax:tax.workerId,market:market.taskId,event:event.taskId},synthetic:true}));
const input=createInterface({input:process.stdin});input.on('line',line=>{try{const command=JSON.parse(line);if(command.action==='publish')f.server.publish();if(command.action==='progress')f.server.publish();}catch{}});
process.on('SIGTERM',async()=>{input.close();await f.close();process.exit(0);});
