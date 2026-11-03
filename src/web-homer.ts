import type {DatabaseSync} from 'node:sqlite';
import {activityOutcomes,publicActivityName,type ActivityTarget} from './activity-facts.js';
import type {DisplayMessage,TaskMessageSource} from './conversation-projection.js';

// Read-only page enrichment. Inputs are the already-authorized persisted page,
// never arbitrary caller IDs or an inbox listing. No inspect/ACK/file grants.
export function withTaskSources(db:DatabaseSync,messages:readonly DisplayMessage[],threadId:string):DisplayMessage[]{
 const batch=(sql:string,keys:readonly string[])=>{
  const out:Record<string,any>[]=[];
  for(let at=0;at<keys.length;at+=200){const part=keys.slice(at,at+200);out.push(...db.prepare(sql.replace('$keys',part.map(()=>'?').join(','))).all(...part));}
  return out;
 };
 const eligible=messages.filter(m=>m.role==='assistant'&&m.threadId===threadId&&(m.text.trim()||m.finalAnswers?.some(a=>a.text.trim())));
 const sourceIds=[...new Set(eligible.flatMap(m=>m.process?.threadId===threadId&&m.process.sourceKind==='worker'&&m.process.turnIds.length?m.process.sourceMessageIds:[]))];
 // Select only the public envelope for Workers, and fixed identity fields for
 // authenticated host notices. Receipt state can change after consumption.
 const notices=batch(`SELECT m.id,m.taskId,m.taskVersion,m.senderAgentId,m.senderRunId,m.senderEpoch,m.kind,m.operationKey,o.actorAgentId,o.kind AS operationKind,o.state AS operationState,o.scopeId,
 CASE WHEN m.senderAgentId='host' AND o.actorAgentId='host' THEN json_object('runId',json_extract(m.payloadJson,'$.runId'),'version',json_extract(m.payloadJson,'$.version'),'previousVersion',json_extract(m.payloadJson,'$.previousVersion'),'resultId',json_extract(m.payloadJson,'$.resultId'),'stopConfirmed',json_extract(m.payloadJson,'$.stopConfirmed')) ELSE '{}' END AS identityJson
 FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id AND ar.recipientAgentId=m.recipientAgentId JOIN operations o ON o.id=m.operationKey
 WHERE m.id IN ($keys) AND m.targetRunId IS NULL AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId')`,sourceIds);
 const noticeMap=new Map<string,Record<string,any>>(notices.map(row=>[row.id,{...row,identity:JSON.parse(row.identityJson)}]));
 const actions=eligible.flatMap(m=>m.process?.threadId===threadId?m.process.items.flatMap(i=>i.kind==='tool'&&i.activity?.target&&!i.activity.action.startsWith('inspect_')?[{node:m.process!,item:i,activity:i.activity}]:[]):[]);
 const operations=new Map(batch('SELECT o.id,o.actorAgentId,o.scopeId,o.kind,o.state,o.detailsJson,o.responseJson,v.taskId AS createdTaskId,v.version AS createdVersion FROM operations o LEFT JOIN task_versions v ON v.triggerOpId=o.id WHERE o.id IN ($keys)',[...new Set(actions.flatMap(a=>a.activity.target?.operationKey?[a.activity.target.operationKey]:[]))]).map(o=>[o.id,o]));
 const publications=batch(`SELECT d.id,d.rootTaskId,d.version,d.resultId,d.historyMessageId,d.state,d.outcome,d.revokedAt,r.runId,r.taskId AS resultTaskId,r.version AS resultVersion FROM deliveries d LEFT JOIN results r ON r.id=d.resultId WHERE d.historyMessageId IN ($keys)`,eligible.map(m=>m.id));
 const resultIds=[...new Set(notices.flatMap(n=>{const p=JSON.parse(n.identityJson);return typeof p.resultId==='string'?[p.resultId]:[];}))];
 const results=new Map(batch('SELECT id,taskId,version,runId,completionResultId FROM results WHERE id IN ($keys)',resultIds).map(r=>[r.id,r]));
 const runIds=[...new Set([...notices.flatMap(n=>{const p=JSON.parse(n.identityJson);return [n.senderRunId,p.runId].filter((x):x is string=>typeof x==='string');}),...actions.flatMap(a=>[a.activity.target?.runId,a.activity.relatedTarget?.runId].filter((x):x is string=>!!x)),...publications.flatMap(d=>d.runId?[d.runId]:[])])];
 const runs=new Map(batch('SELECT id,taskId,contractVersion,epoch,replacesRunId FROM runs WHERE id IN ($keys)',runIds).map(r=>[r.id,r]));
 const targets=new Map<string,ActivityTarget>();
 const addTarget=(t:ActivityTarget)=>{if(typeof t.taskId==='string'&&Number.isSafeInteger(t.version)&&t.version>0)targets.set(JSON.stringify([t.taskId,t.version]),t);};
 for(const n of notices){addTarget({taskId:n.taskId,version:n.taskVersion});const p=JSON.parse(n.identityJson),r=results.get(p.resultId);if(r)addTarget({taskId:r.taskId,version:r.version});if(p.version)addTarget({taskId:n.taskId,version:p.version});}
 for(const a of actions){addTarget(a.activity.target!);if(a.activity.relatedTarget)addTarget(a.activity.relatedTarget);}
 for(const d of publications)addTarget({taskId:d.rootTaskId,version:d.version});
 const versions=new Map<string,Record<string,any>>(),keys=[...targets.keys()];
 for(let at=0;at<keys.length;at+=200){
  const rows=db.prepare(`SELECT v.taskId,v.version,v.presentationJson,c.id AS sourceMessageId FROM json_each(?) k JOIN task_versions v ON v.taskId=json_extract(k.value,'$[0]') AND v.version=json_extract(k.value,'$[1]') JOIN conversation_inputs i ON i.requestId=v.sourceRequestId AND i.threadId=? LEFT JOIN conversation_messages c ON c.threadId=i.threadId AND c.requestId=i.requestId AND c.role='user'`).all('['+keys.slice(at,at+200).join(',')+']',threadId);
  for(const row of rows){const key=JSON.stringify([row.taskId,row.version]),old=versions.get(key);versions.set(key,old?{...old,sourceMessageId:null}:row);}
 }
 const dbMain=db.prepare("SELECT value FROM meta WHERE key='mainAgentId'").get()?.value;
 const byNode=new Map<string,typeof actions>(),byMessage=new Map<string,typeof publications>();
 for(const a of actions){const list=byNode.get(a.node.id)??[];list.push(a);byNode.set(a.node.id,list);}
 for(const d of publications){const list=byMessage.get(d.historyMessageId)??[];list.push(d);byMessage.set(d.historyMessageId,list);}
 const seen=new Set<string>(),out=new Map<string,TaskMessageSource[]>(),unresolved=new Set<string>();
 const push=(messageId:string,source:TaskMessageSource)=>{
  const v=versions.get(JSON.stringify([source.target.taskId,source.target.version]));if(!v){unresolved.add(messageId);return;}
  const title=v.presentationJson?publicActivityName(JSON.parse(v.presentationJson).title):undefined;
  const list=out.get(messageId)??[];if(!seen.has(source.key)){seen.add(source.key);list.push({...source,title:title??'后台工作',...(v.sourceMessageId?{originalRequestMessageId:v.sourceMessageId}:{})});}out.set(messageId,list);
 };
 for(const m of eligible){
  const node=m.process?.threadId===threadId?m.process:undefined;
  const events=node?.items.flatMap(i=>i.kind==='workerEvent'&&i.event?[i.event]:[])??[];
  const eventMessages=new Set(events.map(e=>e.sourceMessageId)),eventResults=new Set(events.map(e=>e.resultId)),eventOperations=new Set(events.map(e=>e.operationKey));
  if(node?.sourceKind==='worker'&&node.turnIds.length)for(const id of node.sourceMessageIds){
   const n=noticeMap.get(id);if(!n){unresolved.add(m.id);continue;}
   if(eventMessages.has(id))continue;
   let target:ActivityTarget={taskId:n.taskId,version:n.taskVersion},phaseLabel='Worker 业务回传',icon:TaskMessageSource['icon']='MessagesSquare',owner:TaskMessageSource['owner']='main';
   if(n.senderAgentId==='host'){
    if(n.actorAgentId!=='host'||n.operationKind!=='notify'||n.operationState!=='confirmed'||n.scopeId!==n.taskId){unresolved.add(m.id);continue;}
    const p=n.identity,r=results.get(p.resultId);
    if(n.kind==='revision_requested'){
      const next=runs.get(p.runId);
      if(!r||r.taskId!==n.taskId||r.completionResultId||p.previousVersion!==r.version||n.taskVersion!==p.version||!next||next.taskId!==n.taskId||next.contractVersion!==p.version||next.replacesRunId!==r.runId){unresolved.add(m.id);continue;}
      for(const [side,target,phaseLabel] of [
        ['previous',{taskId:r.taskId,version:r.version,resultId:r.id,...(r.runId?{runId:r.runId}:{})},'原成果已要求修改'],
        ['next',{taskId:n.taskId,version:p.version,runId:next.id},'新要求已就绪，待补充核验']
      ] as const)push(m.id,{key:JSON.stringify([threadId,node.id,id,side]),target,title:'',icon:'RotateCcw',origin:{kind:'message',processId:node.id,messageId:id},phaseLabel,owner:'main'});
      continue;
    }
    if(r){
      if(r.taskId!==n.taskId||r.completionResultId||p.version!=null&&p.version!==r.version||p.runId!=null&&p.runId!==r.runId){unresolved.add(m.id);continue;}
      target={taskId:r.taskId,version:r.version,...(r.runId?{runId:r.runId}:{}),resultId:r.id};
      if(eventResults.has(r.id))continue;
    }else if(p.resultId!=null){unresolved.add(m.id);continue;}
    else if(p.runId){const run=runs.get(p.runId),version=p.version??(n.kind==='review_required'?n.taskVersion:undefined);if(!run||run.taskId!==n.taskId||!Number.isSafeInteger(version)||version!==run.contractVersion){unresolved.add(m.id);continue;}target={taskId:n.taskId,version,runId:run.id};}
    const labels:Record<string,string>={result_ready:'收到成果，待主 Agent 核对',revision_requested:'已要求补充核验',terminal:p.stopConfirmed===true?'已确认停止':'执行终止，结果需核对',result_accepted:'验收已接受',review_required:'验收待协调',supervision_required:'主 Agent 协调中'};
    phaseLabel=labels[n.kind]??'主 Agent 协调事件';icon=n.kind==='result_ready'?'Inbox':n.kind==='revision_requested'?'RotateCcw':n.kind==='terminal'?'Pause':'MessagesSquare';
   }else{
    const run=runs.get(n.senderRunId);if(!run||run.taskId!==n.taskId||n.senderEpoch==null||n.senderEpoch>run.epoch||n.actorAgentId!==n.senderAgentId||n.operationKind!=='send'||n.scopeId!==n.taskId){unresolved.add(m.id);continue;}
    target={...target,runId:run.id};
   }
   push(m.id,{key:JSON.stringify([threadId,node.id,id]),target,title:'',icon,origin:{kind:'message',processId:node.id,messageId:id,...(n.senderEpoch!=null?{senderEpoch:n.senderEpoch}:{})},phaseLabel,owner});
  }
  for(const a of byNode.get(node?.id??'')??[]){
   const t=a.activity.target!,op=operations.get(t.operationKey);
   const expected:Record<string,string[]>={update_task:['update'],stop_task:['stop'],continue_task:['continue'],review_result:['review','legacy_review'],create_task:['delegate','create_root','create_pending_root','legacy_dispatch'],prepare_delivery:['publish']};
   const scopeMatches=op&&(a.activity.action==='create_task'?op.createdTaskId===t.taskId&&op.createdVersion===t.version:op.scopeId===t.taskId);
   if(!op||!scopeMatches||op.actorAgentId!==dbMain||!expected[a.activity.action]?.includes(op.kind)){unresolved.add(m.id);continue;}
   if(eventOperations.has(t.operationKey??null))continue;
   const info=[t,...(a.activity.relatedTarget?[a.activity.relatedTarget]:[])];
   for(const target of info){
    const run=target.runId?runs.get(target.runId):undefined;if(target.runId&&(!run||run.taskId!==target.taskId)){unresolved.add(m.id);continue;}
    push(m.id,{key:JSON.stringify([threadId,node!.id,a.item.id,target]),target,title:'',icon:a.activity.action==='review_result'?'RotateCcw':a.activity.action==='stop_task'?'CircleStop':a.activity.action==='create_task'?'Send':'CornerDownRight',origin:{kind:'activity',processId:node!.id,itemId:a.item.id},phaseLabel:(a.activity.action==='update_task'?'调整已受理：':'')+activityOutcomes[a.activity.outcome],owner:'main'});
   }
  }
  for(const d of byMessage.get(m.id)??[]){
   if(d.resultId&&(d.resultTaskId!==d.rootTaskId||d.resultVersion!==d.version)){unresolved.add(m.id);continue;}
   const states:Record<string,string>={recorded:'已记录',prepared:'已准备，尚未送达',submitting:'送达待确认',uncertain:'状态待核实',revoked:'已撤回'};
   push(m.id,{key:JSON.stringify([threadId,'delivery',d.id]),target:{taskId:d.rootTaskId,version:d.version,deliveryId:d.id,...(d.resultId?{resultId:d.resultId}:{}),...(d.runId?{runId:d.runId}:{})},title:'',icon:d.state==='recorded'&&d.revokedAt==null?(d.outcome==='partial'?'CircleDashed':d.outcome==='failed'?'CircleX':d.outcome==='cancelled'?'CircleStop':'Check'):'Pause',origin:{kind:'delivery',deliveryId:d.id},phaseLabel:'当次交付来源（当前回执：'+(d.revokedAt!=null?'已撤回':states[d.state]??'待核实')+'）',owner:'main'});
  }
 }
 return messages.map(m=>({...m,...(out.has(m.id)?{taskSources:out.get(m.id)}:{}),...(unresolved.has(m.id)?{taskSourceUnresolved:true as const}:{})}));
}
import { readTaskOverview, readTaskDetail, readTaskSummary } from './task-overview.js';
import { basename } from "node:path";
import { projectQuestions } from './question-schema.js';
import {revealPublishedArtifact} from './artifact-reveal.js';
import type { Homer } from "./service.js";
import type { WebBridge,DispatchQueuePage } from "./web-contract.js";

export function homerWebBridge(app: Homer,{draftUpload=true,nativeCapabilities=true}:{draftUpload?:boolean;nativeCapabilities?:boolean}={}): WebBridge {
  app.registerChannelCapabilities('web',()=>({draftUpload}));
  const pageReader=()=>app.webHistoryPages();
  const epoch=(value:string)=>{if(value!==app.webReadEpoch)throw Error('history_epoch_changed');};
  const legacyLinks=(node:import('./main-process.js').ProcessNode)=>{
    const activityLinks:Record<string,import('./activity-facts.js').ActivityLink>={};
    for(const item of node.items)if(item.kind==='worker'){
      const link=app.tasks.activityLink({taskId:item.taskId,version:item.version,...(item.runId?{runId:item.runId}:{})},node.threadId);
      if(link)activityLinks[item.id]=link;
    }
    return {...node,activityLinks};
  };
  // Worker events already contain their immutable, explicitly public snapshot.
  const page=(request:import('./web-history-pages.js').HistoryPageRequest={})=>{
    const result=pageReader().read(app.store.meta('mainThread')!,request);
    const artifacts=app.tasks.publishedForMessages(result.units).map(file=>({id:file.resultId,title:basename(file.path),workTitle:'正式交付',historyMessageId:file.historyMessageId,messageId:file.historyMessageId,version:file.version,outcome:file.outcome??undefined}));
    const sources=new Map(result.units.length?app.store.db.prepare(`SELECT historyMessageId,routeSourceRequestId FROM deliveries WHERE historyMessageId IN (${result.units.map(()=>'?').join(',')})`).all(...result.units).filter(row=>row.routeSourceRequestId!==null).map(row=>[String(row.historyMessageId),String(row.routeSourceRequestId)]):[]);
    const requests=[...new Set(result.messages.flatMap(m=>m.requestId?[m.requestId]:[]))];
    let inactiveMore=false;
    const inactiveInteractions=requests.flatMap(source=>{const rows=app.store.db.prepare(`WITH cancelled AS (
      SELECT id,rowid position FROM worker_interactions WHERE json_extract(authority,'$.sourceRequestId')=? AND state='cancelled' ORDER BY rowid LIMIT 81),expired AS (
      SELECT id,rowid position FROM worker_interactions WHERE json_extract(authority,'$.sourceRequestId')=? AND state='expired' ORDER BY rowid LIMIT 81)
      SELECT id FROM (SELECT * FROM cancelled UNION ALL SELECT * FROM expired) ORDER BY position LIMIT 81`).all(source,source);if(rows.length>80)inactiveMore=true;return rows.slice(0,80);}).flatMap(({id})=>{
      const item=app.interactions.inspect(String(id));if(typeof item.details.historyThreadId==='string'&&item.details.historyThreadId!==result.threadId)return [];
      const process=result.messages.find(m=>m.process?.threadId===item.threadId&&m.process.turnIds.includes(item.turnId))?.process;
      const user=result.messages.find(m=>m.role==='user'&&m.requestId===item.authority.sourceRequestId);
      if(!process&&!user)return [];
      return [{id:item.id,kind:item.kind,state:item.state as 'cancelled'|'expired',...(item.code?{code:item.code}:{}),sourceRequestId:item.authority.sourceRequestId,...(process?{processId:process.id}:{messageId:user!.id})}];
    });
    return {...result,artifacts,inactiveInteractions,inactiveMore,messages:withTaskSources(app.store.db,result.messages,result.threadId).map(message=>({...message,...(message.process?{process:legacyLinks(message.process)}:{}),requestId:message.requestId??sources.get(message.id)??null,...(message.attachments?{media:message.attachments.map(ref=>app.media.view(ref))}:{}),...(message.source?.attachments?{source:{...message.source,media:message.source.attachments.map(ref=>app.media.view(ref))}}:{})}))};
  };
  const queuePage=(after=0)=>{const page=pageReader().queuePage(after);return {...page,items:page.items.map(item=>({...item,user:{...item.user,...(item.user.attachments?{media:item.user.attachments.map(ref=>app.media.view(ref))}:{})}}))};};
  const interactionPage=(after=0)=>{
    if(!Number.isSafeInteger(after)||after<0)throw Error('history_cursor_invalid');
    const rows=app.store.db.prepare("SELECT id,rowid position FROM worker_interactions WHERE state='pending_user' AND rowid>? ORDER BY rowid LIMIT 81").all(after),selected=rows.slice(0,80);
    const facts=new Map(selected.length?app.store.db.prepare(`SELECT i.id,m.title,(SELECT id FROM conversation_messages c WHERE c.threadId=? AND c.requestId=json_extract(i.authority,'$.sourceRequestId') AND c.role='user' ORDER BY c.rowid DESC LIMIT 1) sourceMessageId
      FROM worker_interactions i LEFT JOIN runs r ON r.id=CASE WHEN i.runId LIKE 'main-native:worker-native:%' THEN substr(i.runId,27) ELSE i.runId END LEFT JOIN matters m ON m.id=r.matterId WHERE i.id IN (${selected.map(()=>'?').join(',')})`).all(app.store.meta('mainThread')!,...selected.map(row=>String(row.id))).map(row=>[String(row.id),row]):[]);
    return {items:selected.map(({id})=>app.interactions.inspect(String(id))).map(item=>({id:item.id,runId:item.runId,kind:item.kind,workTitle:String(facts.get(item.id)?.title??(item.runId.startsWith('main-native:worker-native:')?'后台原生请求':item.runId.startsWith('main-native:')?'主对话':'后台工作')),sourceRequestId:item.authority.sourceRequestId,...(facts.get(item.id)?.sourceMessageId?{sourceMessageId:String(facts.get(item.id)!.sourceMessageId)}:{}),question:item.userQuestion??'请补充完成这项工作所需的信息。',reason:item.escalationReason,...(item.details.method==='mcpServer/elicitation/request'&&(item.details.params as any)?._meta?.codex_approval_kind==='mcp_tool_call'?{canCancel:true as const}:{}),questions:item.runId.startsWith('main-native:')?projectQuestions(item.kind,item.details):undefined})),after:rows.length>80?Number(selected.at(-1)!.position):null};
  };
  return {
    history:{
      page:async input=>{epoch(input.readEpoch);return page(input.request);},
      process:async input=>{
        epoch(input.readEpoch);const thread=app.store.meta('mainThread')!,node=pageReader().process(input.id,thread);
        const activityLinks:Record<string,import('./activity-facts.js').ActivityLink>={};
        // Opening the process reads facts only. Resolve navigation/file grants
        // for one explicitly selected activity, never every completed call.
        const item=input.itemId===undefined?undefined:node.items.find(item=>item.id===input.itemId);
        if(input.itemId!==undefined&&!item)throw Error('history_activity_not_found');
        if(item){
          const target=item.kind==='tool'?item.activity?.target:item.kind==='worker'?{taskId:item.taskId,version:item.version,...(item.runId?{runId:item.runId}:{})}:undefined;
          const link=target?app.tasks.activityLink(target,thread):undefined;if(link)activityLinks[item.id]=link;
        }
        return {...node,activityLinks};
      },
      resolve:async input=>{
        epoch(input.readEpoch);const thread=app.store.meta('mainThread')!;
        const message=app.store.db.prepare('SELECT id,requestId FROM conversation_messages WHERE threadId=? AND id=?').get(thread,input.id);if(!message)throw Error('history_message_not_found');
        const requestId=message.requestId??app.store.db.prepare('SELECT requestId FROM web_process_ids WHERE threadId=? AND messageId=?').get(thread,input.id)?.requestId??app.store.db.prepare('SELECT routeSourceRequestId FROM deliveries WHERE historyMessageId=?').get(input.id)?.routeSourceRequestId;
        const user=requestId?app.store.db.prepare("SELECT id FROM conversation_messages WHERE threadId=? AND requestId=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(thread,requestId):undefined;
        return {messageId:String(message.id),...(user?{sourceMessageId:String(user.id)}:{})};
      },
      queue:async(after,readEpoch)=>{if(readEpoch!==undefined)epoch(readEpoch);const result=queuePage(after);return {...result,threadId:app.store.meta('mainThread')!,readEpoch:app.webReadEpoch,revision:pageReader().revision};},
      dispatchQueue:async<S extends 'all'|undefined=undefined>({cursor,readEpoch,sources}:{cursor?:string;readEpoch:string;sources?:S})=>{
        epoch(readEpoch);const result=pageReader().dispatchQueue(cursor,readEpoch,sources);
        return {...result,view:'dispatch-v1',...(sources?{sources}:{}),threadId:app.store.meta('mainThread')!,readEpoch,revision:pageReader().revision,items:result.items.map(item=>('user' in item&&item.user)?{...item,user:{...item.user,...(item.user.attachments?{media:item.user.attachments.map(ref=>app.media.view(ref))}:{})}}:item)} as DispatchQueuePage<S>;
      },
      interactions:async(after,readEpoch)=>{if(readEpoch!==undefined)epoch(readEpoch);const result=interactionPage(after);return {...result,threadId:app.store.meta('mainThread')!,readEpoch:app.webReadEpoch,revision:pageReader().revision};},
      receipts:async({requestIds,operations,threadId,readEpoch})=>{
        if(!Array.isArray(requestIds)||requestIds.length>80||requestIds.some(id=>typeof id!=='string'||! /^[\w:-]{1,100}$/.test(id)))throw Error('receipt_ids_invalid');
        if(readEpoch!==undefined)epoch(readEpoch);
        if(threadId!==undefined&&threadId!==app.store.meta('mainThread'))throw Error('queue_thread_conflict');
        if(operations!==undefined&&(!Array.isArray(operations)||operations.length>80||operations.some(op=>!op||((typeof op.requestId!=='string'||!/^[\w:-]{1,100}$/.test(op.requestId))&&(typeof op.messageId!=='string'||!/^[\w:-]{1,100}$/.test(op.messageId)))||(op.requestId!==undefined&&op.messageId!==undefined)||typeof op.operationId!=='string'||!/^[\w:.-]{1,150}$/.test(op.operationId))))throw Error('queue_operation_invalid');
        const thread=app.store.meta('mainThread')!,acceptedRequestIds=requestIds.filter(id=>!!app.store.db.prepare('SELECT 1 FROM conversation_inputs WHERE threadId=? AND requestId=?').get(thread,id));
        const states=new Map(app.inputs.byRequestIds(acceptedRequestIds).map(item=>[item.input.requestId,item]));
        return {acceptedRequestIds,statuses:requestIds.map(requestId=>{const item=states.get(requestId);return {requestId,state:item?.state??(acceptedRequestIds.includes(requestId)?'accepted':'unconfirmed'),...(item?{revision:item.revision,inputRevision:item.inputRevision,editable:item.editable===true}:{})};}),...(operations?{operations:operations.map(op=>{
          const scopeId=op.messageId??op.requestId,belongs=op.messageId?app.inputs.messageBelongs(op.messageId):app.store.db.prepare('SELECT 1 FROM conversation_inputs WHERE threadId=? AND requestId=?').get(thread,op.requestId!),result=belongs?app.inputs.operationReceipt(scopeId!,op.operationId):undefined;
          return {...op,committed:!!result,...(result?{result}:{})};
        })}:{})};
      },
      state:async()=>{
        const build=():Awaited<ReturnType<NonNullable<WebBridge['history']>['state']>>=>{
        const recent=page(),threadId=recent.threadId,queue=queuePage();
        const {messages:_messages,queue:_queue,artifacts,inactiveInteractions,...pageInfo}=recent;
        const pending=interactionPage(),interactions=pending.items;
        const current=app.conversationControlState();
        return {...current,threadId,messages:recent.messages,queue:queue.items,artifacts,inactiveInteractions,work:[],interactions,conversationView:3,acceptedRequestIds:[],processNodes:[],
        queueDispatch:app.inputs.dispatchSummary(),features:{draftUpload,nativeCapabilities,taskOverview:true,workerExecution:1,workerEventCards:1,queueDispatch:1,queueSources:1,nativeQuestionAnswers:1,previewReferences:1,previewReferenceCollections:2},upgrade:{phase:'running'},
        history:{protocol:3,readEpoch:app.webReadEpoch,page:pageInfo,moreQueue:queue.after,moreInteractions:pending.after}};
        };
        return app.receptionTimings?app.receptionTimings.measure('state_history',build):build();
      },
    },
    onStateChange: listener=>app.onStateChange(listener),
    taskOverview:{execution:async(selector,before)=>app.readWorkerExecution(selector,before),call:async(selector,key)=>app.readWorkerCall(selector,key),list:async()=>({...readTaskOverview(app.store.db),progressRevision:app.workerProgress?.revision??0}),progress:async id=>{
      const db=app.store.db;
      if(!db.prepare('SELECT id FROM tasks WHERE id=? AND rootTaskId=id AND parentTaskId IS NULL').get(id))throw Error('task_not_found');
      // Scope the read before projection: progress needs no global result,
      // delivery or interaction scans, and never reads historical Runs.
      const scopes=db.prepare(`SELECT t.id AS taskId,t.headVersion AS version,r.id AS runId,r.epoch,r.threadId,r.turnId
        FROM tasks t JOIN runs r ON r.id=t.currentRunId AND r.taskId=t.id AND r.contractVersion=t.headVersion
        WHERE t.rootTaskId=? AND t.executorKind='worker' AND r.threadId IS NOT NULL AND r.turnId IS NOT NULL`).all(id) as import('./worker-progress.js').WorkerScope[];
      return {taskId:id,workers:scopes.flatMap(scope=>{const progress=app.workerProgress?.get(scope);return progress?[progress]:[];})};
    },summary:async id=>{
      const detail=readTaskSummary(app.store.db,id);
      // Unique exact original message only; never choose an arbitrary thread when ambiguous.
      const sources=app.store.db.prepare(`SELECT v.taskId,c.id,c.threadId FROM tasks t JOIN task_versions v ON v.taskId=t.id AND v.version=t.headVersion JOIN conversation_inputs input ON input.requestId=v.sourceRequestId JOIN conversation_messages c INDEXED BY conversation_request_user ON c.threadId=input.threadId AND c.requestId=input.requestId AND c.role='user' WHERE t.rootTaskId=?`).all(id);
      const counts=new Map<string,number>();for(const row of sources){const id=String(row.taskId);counts.set(id,(counts.get(id)??0)+1);}
      const byTask=new Map(sources.filter(row=>counts.get(String(row.taskId))===1).map(row=>[String(row.taskId),row]));
      const ids=detail.publications!.flatMap(p=>p.historyMessageId?[p.historyMessageId]:[]);
      return {...detail,requirements:detail.requirements!.map(r=>({...r,...(byTask.has(r.taskId)?{sourceMessageId:String(byTask.get(r.taskId)!.id),threadId:String(byTask.get(r.taskId)!.threadId)}:{})})),artifacts:app.tasks.publishedForMessages(ids).map(file=>({id:file.resultId,title:basename(file.path),historyMessageId:file.historyMessageId}))};
    },detail:async id=>{
      const detail=readTaskDetail(app.store.db,id);
      const publications=app.store.db.prepare("SELECT historyMessageId FROM deliveries WHERE rootTaskId=? AND state='recorded' AND revokedAt IS NULL ORDER BY version DESC,rowid DESC LIMIT 81").all(id);
      const ids=publications.slice(0,80).flatMap(row=>row.historyMessageId?[String(row.historyMessageId)]:[]);
      return {...detail,artifacts:ids.length?app.tasks.publishedForMessages(ids).map(file=>({id:file.resultId,title:basename(file.path),historyMessageId:file.historyMessageId})):[],moreArtifacts:publications.length>80};
    },origin:async(id,messageId)=>{
      if(!/^[\w:-]{1,100}$/.test(id)||!/^[\w:-]{1,100}$/.test(messageId))throw Error('task_origin_not_found');
      const source=app.store.db.prepare(`SELECT c.id FROM tasks t JOIN task_versions v ON v.taskId=t.id JOIN conversation_inputs input ON input.requestId=v.sourceRequestId JOIN conversation_messages c ON c.threadId=input.threadId AND c.requestId=input.requestId AND c.role='user' WHERE t.rootTaskId=? AND c.id=? LIMIT 1`).get(id,messageId);
      const publication=app.store.db.prepare("SELECT id FROM deliveries WHERE rootTaskId=? AND historyMessageId=? AND state='recorded' AND revokedAt IS NULL LIMIT 1").get(id,messageId);
      if(!source&&!publication)throw Error('task_origin_not_found');
      const message=app.history.message(messageId);if(!message||(source?message.role!=='user':message.role!=='assistant'))throw Error('task_origin_not_found');
      const files=publication?app.tasks.publishedForMessages([messageId]).map(file=>({id:file.resultId,title:basename(file.path),workTitle:'正式交付',historyMessageId:messageId,version:file.version})):[];
      return {message,files};
    }},
    media:{read:async input=>app.readAttachment(input),...(draftUpload?{upload:(input:import('./web-upload.js').WebUpload)=>app.uploadAttachment(input),discard:async(input:unknown)=>app.discardAttachment(input),previewDraft:async(input:unknown)=>app.readDraftImage(input)}:{})},
    state: async () => {
      const started=performance.now();app.receptionTimings?.mark('state_start');
      try{
      const snapshot = app.receptionTimings?app.receptionTimings.measure('state_snapshot',()=>app.snapshot()):app.snapshot();
      const tasks=new Map(snapshot.tasks?.map(task=>[task.id,task]));
      const conversation=app.receptionTimings?app.receptionTimings.measure('state_conversation',()=>app.conversationState()):app.conversationState();
      const deliverySources=new Map(snapshot.deliveries.map(delivery=>[delivery.historyMessageId,delivery.routeSourceRequestId]));
      const work = snapshot.runs.flatMap(run=>{
        const artifacts=app.tasks.publishedArtifacts(run.id);
        const taskId=app.tasks.run(run.id).taskId,task=tasks.get(taskId)??app.tasks.task(taskId);
        if(task.parentTaskId&&!artifacts.length)return [];
        return [{id:run.id,title:snapshot.matters.find(matter=>matter.id===run.matterId)?.title??'正在办的事',status:run.status,summary:run.summary,hasArtifact:!!artifacts.length,
          artifacts:artifacts.map(file=>({id:file.resultId,title:basename(file.path),historyMessageId:file.historyMessageId,version:file.version,outcome:file.outcome??undefined}))}];
      });
      const visible=new Set(conversation.messages.map(message=>message.id));
      const artifacts=work.flatMap(work=>work.artifacts.map(file=>({...file,workTitle:work.title,...(visible.has(file.historyMessageId)?{messageId:file.historyMessageId}:{})})));
      return {
        queueDispatch:app.inputs.dispatchSummary(),features:{draftUpload,nativeCapabilities,taskOverview:true,workerExecution:1,workerEventCards:1,queueDispatch:1,queueSources:1,nativeQuestionAnswers:1,previewReferences:1,previewReferenceCollections:2},
        ...conversation,
        processNodes:conversation.processNodes,
        messages:withTaskSources(app.store.db,conversation.messages,conversation.threadId).map(message=>({...message,requestId:message.requestId??deliverySources.get(message.id)??null})),
        work,artifacts,
        inactiveInteractions:snapshot.interactions.flatMap(summary=>{
          if(summary.state!=='expired'&&summary.state!=='cancelled')return [];
          const item=app.interactions.inspect(summary.id),sourceRequestId=item.authority.sourceRequestId;
          // A source match is exact. A conflicting recorded history thread is never guessed away.
          if(typeof item.details.historyThreadId==='string'&&item.details.historyThreadId!==conversation.threadId)return [];
          const process=conversation.processNodes.find(node=>node.threadId===item.threadId&&node.turnIds.includes(item.turnId));
          const message=conversation.messages.find(message=>message.role==='user'&&message.requestId===sourceRequestId);
          if(!process&&!message)return [];
          return [{id:item.id,kind:item.kind,state:summary.state,...(item.code?{code:item.code}:{}),sourceRequestId,...(process?{processId:process.id}:{messageId:message!.id})}];
        }),
        interactions: snapshot.interactions.filter(item => item.state === "pending_user").map(summary => app.interactions.inspect(summary.id)).map(item => ({
          id: item.id, runId: item.runId, kind: item.kind,
          workTitle:snapshot.matters.find(matter=>matter.id===snapshot.runs.find(run=>run.id===(item.runId.startsWith('main-native:worker-native:')?item.runId.slice(26):item.runId))?.matterId)?.title??(item.runId.startsWith('main-native:worker-native:')?'后台原生请求':item.runId.startsWith('main-native:')?'主对话':undefined),sourceRequestId:item.authority.sourceRequestId,
          question: item.userQuestion ?? "请补充完成这项工作所需的信息。", reason: item.escalationReason,
          ...(item.details.method==='mcpServer/elicitation/request'&&(item.details.params as any)?._meta?.codex_approval_kind==='mcp_tool_call'?{canCancel:true as const}:{}),questions: item.runId.startsWith('main-native:')?projectQuestions(item.kind, item.details):undefined,
        })),
        upgrade: { phase: "running" },
      };
      }finally{app.receptionTimings?.mark('state_end',{},undefined,performance.now()-started);}
    },
    submit: async input => app.submitMessage(input),
    queue:{edit:async input=>app.editQueued(input),cancel:async input=>app.cancelQueued(input),move:async input=>app.moveQueued(input),interrupt:async(input,target)=>app.submitMessage(input,undefined,target)},
    stop: id => app.stopMain(id),
    feedback: async (id, value) => app.history.feedback(app.store.meta('mainThread')!, id, value),
    respond: async (id, input) => app.submitMessage({ ...input, interactionId: id }),
    artifactOrigin: async resultId => {
      if(!/^result-[\w-]+$/.test(resultId))throw Error('artifact_not_authorized');
      const verified=app.tasks.publishedResult(resultId);
      if(!verified)throw Error('artifact_not_authorized');
      const message=app.history.message(verified.historyMessageId);
      if(!message||message.role!=='assistant')throw Error('artifact_origin_not_found');
      // Reuse exactly the existing publication/file grant and integrity check.
      // No caller-controlled thread or path and no directory traversal API.
      const files=app.tasks.delivery(verified.deliveryId).publishedFileResultIds.flatMap(id=>{
        const file=app.tasks.publishedResult(id);
        if(!file||file.deliveryId!==verified.deliveryId||file.historyMessageId!==message.id)return [];
        const bytes=app.files.resultBytes(app.files.prepareRun(app.tasks.run(file.runId).matterId,file.runId),file.path);
        if(bytes.sha256!==file.sha256)throw Error('result_hash_mismatch');
        return [{id:file.resultId,title:basename(file.path),workTitle:'原交付',historyMessageId:message.id,version:file.version,outcome:file.outcome??undefined}];
      });
      return {message,files};
    },
    revealArtifact: id=>revealPublishedArtifact(app.tasks,id),
    artifact: async id => app.previewArtifact(id),
  };
}
