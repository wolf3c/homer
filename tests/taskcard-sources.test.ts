import {test} from 'node:test';import assert from 'node:assert/strict';
import * as web from '../src/web-homer.js';
import {ConversationHistory} from '../src/web-history.js';import {MainProcessHistory} from '../src/main-process.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {fixture,delegate,running,main,contract} from './recursive-fixture.js';
import type {DisplayMessage} from '../src/conversation-projection.js';
import type {ProcessNode} from '../src/main-process.js';
function setup(){const f=fixture();new ConversationHistory(f.store.db);f.store.db.prepare('INSERT INTO conversation_inputs VALUES(?,?,?,?)').run('user-synthetic','thread','hash','reply');f.store.db.prepare('INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?)').run('original','thread','user-synthetic','user','Public request','completed',null,1);return f;}
const node=(ids:string[],items:ProcessNode['items']=[]):ProcessNode=>({id:'process',threadId:'thread',seq:1,revision:1,sourceKind:'worker',sourceMessageIds:ids,messageId:'public',state:'worked',status:'completed',turnIds:['turn'],items});
const message=(process:ProcessNode,text='Public conclusion'):DisplayMessage=>({id:'public',threadId:'thread',requestId:null,role:'assistant',text,status:'completed',createdAt:2,process});
test('only consumed scoped sources; forged host kinds stay ordinary; receipts and steer preserve history',()=>{
 assert.equal(typeof web.withTaskSources,'function');const f=setup();try{const d=delegate(f),actor=running(f,d.taskId),t=f.tasks.task(d.taskId);
 const sent=f.tasks.send(actor,{operationId:'send',taskId:t.id,version:1,expectedTaskRevision:t.revision,recipientAgentId:main.agentId,kind:'terminal',payload:{startupFailure:true,resultId:'forged'}});
 const project=(m:DisplayMessage,thread='thread')=>web.withTaskSources(f.store.db,[m],thread)[0]!;
 const p=message(node([sent.messageId]));let result=project(p);assert.equal(result.taskSources?.length,1);assert.equal(result.taskSources![0]!.phaseLabel,'Worker 业务回传');assert.equal(result.taskSources![0]!.originalRequestMessageId,'original');
 f.store.db.prepare("UPDATE agent_receipts SET state='rejected'").run();assert.deepEqual(project(p).taskSources,result.taskSources);
 assert.equal(project({...p,process:{...p.process!,turnIds:[]}}).taskSources,undefined);
 assert.equal(project(p,'other').taskSources,undefined);assert.equal(project({...p,text:''}).taskSources,undefined);
 assert.equal(project(message(node([]))).taskSources,undefined);
 const now=f.tasks.task(t.id),u=f.tasks.update(main,{operationId:'update',taskId:t.id,version:1,expectedTaskRevision:now.revision,mode:'steer',contract:contract(),children:[],queuedDisposition:[]});
 f.tasks.inspect(actor,{taskId:t.id});f.tasks.adopt(actor,{operationId:'adopt',taskId:t.id,version:u.version,expectedTaskRevision:f.tasks.task(t.id).revision,contractHash:u.contractHash});
 assert.equal(project(p).taskSources![0]!.target.version,1);
 }finally{f.close();}
});
test('terminal headers retain public action identity while dropping a MiB raw tool body',()=>{
 const f=setup();try{const d=delegate(f),t=f.tasks.task(d.taskId),args={operationId:'q',taskId:t.id,version:1,expectedTaskRevision:t.revision,mode:'queue' as const,contract:contract(),children:[],queuedDisposition:[]},r=f.tasks.update(main,args),activity=f.tasks.captureActivity(main,'task_update',args,r)!;
 const n={...node([], [{id:'tool',seq:1,revision:1,kind:'tool' as const,status:'completed' as const,label:'调整任务',activity,content:{private:'x'.repeat(1024*1024)}} as any]),sourceKind:'user' as const};
 f.store.setMeta('publicMainNode:v1:process',JSON.stringify(n));const header=new MainProcessHistory(f.store.db).headers(['process'])[0]!;
 assert.equal(header.items.length,1);assert.equal((header.items[0] as any).content,undefined);assert.ok(JSON.stringify(header).length<2000);
 const publicMessage=message(header);assert.equal(web.withTaskSources(f.store.db,[publicMessage],'thread')[0]?.taskSources?.[0]?.phaseLabel,'调整已受理：后续要求已排队');
 }finally{f.close();}
});
test('quiet rework requires exact confirmed current-turn review and never swallows partial/unknown/unrelated results',()=>{
 const f=setup();try{
 const history=new MainProcessHistory(f.store.db);assert.equal(typeof history.canQuietRework,'function');
 assert.equal(history.canQuietRework('missing','missing'),false);
 const tasks=new RecursiveTasks(f.store,f.files,{validateActor:()=>{},reviewExitConfirmed:()=>true}),d=delegate(f),actor=running(f,d.taskId);
 const returned=tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Useful synthetic result'},true)!;
 const resultId=returned.resultId;tasks.inspect(main,{resultId});
 const t=tasks.task(d.taskId),args={operationId:'rework',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,resultId,decision:'request_changes' as const,outcome:'partial' as const,reason:'Check missing evidence',revision:{contract:contract(),children:[],queuedDisposition:[]}};
 const receipt=tasks.review(main,args);assert.ok(receipt.runId);const activity=tasks.captureActivity(main,'task_review',args,receipt)!;
 assert.equal(activity.target?.version,1);assert.equal(activity.relatedTarget?.version,2);
 const revisionMessage=String(f.store.db.prepare("SELECT id FROM agent_messages WHERE kind='revision_requested' AND taskId=?").get(t.id)!.id);
 const revisionProjection=web.withTaskSources(f.store.db,[message(node([revisionMessage]))],'thread')[0]!;
 assert.deepEqual(revisionProjection.taskSources?.map(s=>[s.target.version,s.target.runId]),[[1,actor.runId],[2,receipt.runId]]);
 const source=String(f.store.db.prepare("SELECT id FROM agent_messages WHERE kind='result_ready' AND taskId=?").get(t.id)!.id);
 const n=node([source],[{id:'review',kind:'tool',seq:1,revision:1,label:'验收',status:'completed',activity}]);f.store.setMeta('publicMainNode:v1:process',JSON.stringify(n));
 assert.equal(history.canQuietRework('process',source),false,'a queued replacement is not an actual continuation');
 const next=running({...f,tasks},t.id);assert.equal(next.runId,receipt.runId);
 assert.equal(history.canQuietRework('process',source),true);
 f.store.db.prepare("UPDATE task_versions SET goal='Changed scope' WHERE taskId=? AND version=2").run(t.id);
 assert.equal(history.canQuietRework('process',source),false,'changed scope must be reported');
 f.store.db.prepare('UPDATE task_versions SET goal=? WHERE taskId=? AND version=2').run(contract().goal,t.id);
 f.store.db.prepare("UPDATE runs SET phase='uncertain' WHERE id=?").run(receipt.runId);
 assert.equal(history.canQuietRework('process',source),false,'uncertain replacement must be reported');
 f.store.db.prepare("UPDATE runs SET phase='executing' WHERE id=?").run(receipt.runId);
 f.store.db.prepare("UPDATE tasks SET controlState='held' WHERE id=?").run(t.id);assert.equal(history.canQuietRework('process',source),false,'a held continuation must be reported');
 f.store.db.prepare("UPDATE tasks SET controlState='normal' WHERE id=?").run(t.id);
 f.store.db.prepare("UPDATE results SET outcome='partial' WHERE id=?").run(resultId);assert.equal(history.canQuietRework('process',source),false);
 f.store.db.prepare('UPDATE results SET outcome=NULL WHERE id=?').run(resultId);
 f.store.db.prepare("UPDATE operations SET state='uncertain' WHERE id=?").run(activity.target!.operationKey!);assert.equal(history.canQuietRework('process',source),false);
 f.store.db.prepare("UPDATE operations SET state='confirmed' WHERE id=?").run(activity.target!.operationKey!);
 assert.equal(history.canQuietRework('process','other'),false);
 n.status='unknown';f.store.setMeta('publicMainNode:v1:process',JSON.stringify(n));assert.equal(history.canQuietRework('process',source),false);
 }finally{f.close();}
});

test('aggregate delivery keeps exact source and revocation/partial are visible',()=>{
 const f=setup();try{
 const r=f.root;f.store.db.prepare('INSERT INTO deliveries(id,rootTaskId,version,resultId,outcome,text,historyMessageId,state,operationKey) VALUES(?,?,1,NULL,?,?,?,?,?)').run('delivery-test',r.taskId,'partial','Public partial','public','recorded',r.operationKey);
 const m=message(node([]));const read=()=>web.withTaskSources(f.store.db,[m],'thread')[0]!.taskSources![0]!;
 assert.equal(read().icon,'CircleDashed');assert.equal(read().target.runId,undefined);assert.equal(read().target.version,1);
 f.store.db.prepare("UPDATE deliveries SET state='revoked',revokedAt=1 WHERE id='delivery-test'").run();assert.equal(read().icon,'Pause');assert.match(read().phaseLabel,/已撤回/);
 }finally{f.close();}
});
test('authenticated deferred review uses its recorded envelope version when payload omits version',()=>{
 const f=setup();try{const d=delegate(f),actor=running(f,d.taskId);f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Result'},true);
 const t=f.tasks.task(d.taskId);f.tasks.deferReview(main,{operationId:'defer',taskId:t.id,version:t.headVersion,expectedTaskRevision:t.revision,runId:actor.runId!,code:'review_decision_required'});
 const id=String(f.store.db.prepare("SELECT id FROM agent_messages WHERE taskId=? AND kind='review_required'").get(t.id)!.id);
 const p=web.withTaskSources(f.store.db,[message(node([id]))],'thread')[0]!;assert.equal(p.taskSources?.[0]?.target.version,1);assert.equal(p.taskSourceUnresolved,undefined);
 }finally{f.close();}
});
