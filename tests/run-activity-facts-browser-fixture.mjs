// Isolated synthesis via real task/publication/HTTP owners; no Homer service, account or model.
import {fixture} from './web-history-followup-fixture.mjs';
import {syntheticFile} from './recursive-publication-fixture.js';
export async function activityFixture(){
 const f=await fixture(90,'after');
 const source='request-89',actor={agentId:'main:activity-browser',sourceRequestId:source};
 f.store.setMeta('mainAgentId',actor.agentId);f.store.startRequest(source,'synthetic-activity');
 const create=(operationId,title)=>f.tasks.createRoot(actor,{operationId,title,executorKind:'main',contract:{presentation:{title},goal:'核对这一次活动对应的原始要求。',inputs:[],resultKind:'aggregate',acceptance:{criteria:[]}},authority:{sourceRequestId:source,description:'Synthetic activity only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
 const a=create('activity-a','周报材料核对'),b=create('activity-b','周报材料核对');
 const file=syntheticFile({...f},source,'季度经营数据核对与改进建议_待确认范围说明_2026年十月最终候选.md','# 隔离合成成果\n\n此文件只用于活动验收。');
 const d=file.publish('合成正式答复：已记录这份成果，剩余范围按原要求核对。');f.tasks.markDelivery(d.id,'recorded');f.history.record(d.historyMessageId,'synthetic-history',d.text);
 const taskId=f.tasks.run(file.run.id).taskId;
 // These are synthetic public presentation inputs, not a collector integration test.
 // Use the committed activity schema; do not depend on a parallel backend collector.
 const fact=(action,outcome,objectName,target)=>({schemaVersion:1,action,outcome,objectName,target});
 const readTask=root=>fact('inspect_task','record_read','周报材料核对',{taskId:root.taskId,version:1});
 const target={taskId,version:1,resultId:file.resultId};
 const facts=[readTask(a),readTask(b),fact('inspect_file','file_read','季度经营数据核对与改进建议_待确认范围说明_2026年十月最终候选.md',target),fact('review_result','accepted','合成成果',target),fact('prepare_delivery','delivery_prepared','合成正式交付',{...target,deliveryId:d.id})];
 // The recorded activity is v1 even though the task now has a newer v2.
 f.store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson) VALUES('synthetic-v2-op',?,?,'synthetic-v2','update','synthetic','confirmed','{}')").run(actor.agentId,a.taskId);
 f.store.db.prepare(`INSERT INTO task_versions(taskId,version,goal,inputsJson,resultKind,acceptanceJson,authorityJson,sourceRequestId,triggerOpId,workingDirectory) SELECT taskId,2,'这是后续版本，不能替换活动中的原要求',inputsJson,resultKind,acceptanceJson,authorityJson,sourceRequestId,'synthetic-v2-op',workingDirectory FROM task_versions WHERE taskId=? AND version=1`).run(a.taskId);
 f.store.db.prepare('UPDATE tasks SET headVersion=2 WHERE id=?').run(a.taskId);
 const tools=facts.map((activity,i)=>({id:'activity-call-'+i,seq:i+1,revision:2,kind:'tool',category:'host',label:i===3?'核对成果':i===4?'整理交付':'检查资料',status:'completed',activity}));
 tools.push({id:'returned-only',seq:6,revision:2,kind:'tool',category:'host',label:'检查资料',status:'completed'});
 const base=JSON.parse(f.store.meta('publicMainNode:v1:node-89'));
 function setMode(mode='running'){
  const node={...base,revision:Number(JSON.parse(f.store.meta('publicMainNode:v1:node-89')).revision)+1,final:undefined,sourceKind:'user',state:mode==='running'?'working':'worked',status:'running',items:mode==='legacy'?[{id:'legacy-generic',kind:'tool',seq:1,revision:1,category:'host',label:'检查资料',status:'completed'},{id:'legacy-associated',kind:'worker',seq:2,revision:1,taskId:a.taskId,version:1,runId:null,taskRevision:1,runRevision:null,runStatus:null,resultState:null,epoch:null,state:'reviewing',controlState:'normal',outcome:null,phase:null,stopRequested:false}]:mode==='risks'?tools.concat(['failed','declined','interrupted','unknown','blocked'].map((status,i)=>({id:'risk-'+i,seq:7+i,revision:1,kind:'tool',category:'host',label:'检查资料',status}))):tools};
  if(mode!=='running')node.status=mode==='risks'?'failed':'completed';
  f.store.setMeta('publicMainNode:v1:node-89',JSON.stringify(node));f.store.db.prepare("UPDATE conversation_messages SET text='',status=? WHERE id='node-89'").run(node.state==='working'?'running':'completed');f.server.publish();
 }
 // A stale reference and a generic old record have no actionable arrow.
 const legacy={...JSON.parse(f.store.meta('publicMainNode:v1:node-88')),revision:2,items:[{id:'unreadable-legacy',seq:1,revision:1,kind:'worker',taskId:a.taskId,version:77,runId:null}],final:undefined};
 f.store.setMeta('publicMainNode:v1:node-88',JSON.stringify(legacy));f.store.db.prepare("UPDATE conversation_messages SET text='' WHERE id='node-88'").run();
 let delay=0,deny=false;const activityReads=[];
 const read=f.bridge.history.process;f.bridge.history.process=async input=>{activityReads.push(input.itemId??null);const result=await read(input);if(delay)await new Promise(done=>setTimeout(done,delay));if(deny)throw Error('synthetic_read_denied');return result;};
 const state=f.bridge.history.state;f.bridge.history.state=async()=>({...await state(),isRunning:true,activeMessageId:'node-89',generation:{threadId:'synthetic-history',turnId:'turn-89',messageId:'node-89'},mainActivity:{source:'user',stage:'native',processId:'node-89',turnId:'turn-89'}});
 setMode();return {...f,a,b,file,delivery:d,tools,setMode,activityReads,stream(){const key='publicMainNode:v1:node-89',node=JSON.parse(f.store.meta(key));node.revision++;node.items=[...node.items.filter(item=>item.id!=='review-stream'),{id:'review-stream',kind:'commentary',seq:99,revision:node.revision,text:'合成新增公开进展 '+node.revision}];f.store.setMeta(key,JSON.stringify(node));f.server.publish();},delay(ms){delay=ms;},deny(value){deny=value;},thread(value){f.store.setMeta('mainThread',value);f.server.publish();}};
}
