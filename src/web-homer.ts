import {readTaskConversation} from './task-conversation.js';
import {taskSourceRequestsSql} from './recursive-tasks.js';
import {decodeConversationReferences} from './web-history.js';
import {conversationUserText} from './user-intent.js';
import type {DatabaseSync} from 'node:sqlite';
import {activityOutcomes,publicActivityName} from './activity-facts.js';
import type {DisplayMessage,TaskMessageSource} from './conversation-projection.js';

// Read-only page enrichment. Inputs are the already-authorized persisted page,
// never arbitrary caller IDs or an inbox listing. No inspect/ACK/file grants.
export function withTaskSources(db:DatabaseSync,messages:readonly DisplayMessage[],threadId:string,includeCoveredSources=false):DisplayMessage[]{
 const batch=(sql:string,keys:readonly string[])=>{
  const out:Record<string,any>[]=[];
  for(let at=0;at<keys.length;at+=200){const part=keys.slice(at,at+200);out.push(...db.prepare(sql.replace('$keys',part.map(()=>'?').join(','))).all(...part));}
  return out;
 };
 const eligible=messages.filter(m=>m.role==='assistant'&&m.threadId===threadId&&(m.text.trim()||m.attachments?.length||m.finalAnswers?.some(a=>a.text.trim())||m.process?.threadId===threadId&&m.process.sourceKind==='worker'&&m.process.turnIds.length>0));
 const formal=eligible.filter(m=>m.operationKey&&typeof m.taskId==='string'&&m.taskId&&typeof m.taskVersion==='number'&&Number.isSafeInteger(m.taskVersion)&&m.taskVersion>0);
 const main=db.prepare("SELECT value FROM meta WHERE key='mainAgentId'").get()?.value;
 const inputReceipt=`FROM agent_messages i JOIN agent_receipts ir ON ir.messageId=i.id AND ir.recipientAgentId=i.recipientAgentId
   JOIN operations io ON io.id=i.operationKey
   WHERE i.id=json_extract(o.detailsJson,'$.inputMessageId') AND i.targetRunId IS NULL`;
 const userInput=`i.kind='user_input' AND i.senderAgentId='user:'||i.recipientAgentId
   AND io.kind='user_accept' AND io.actorAgentId=i.senderAgentId AND io.state='confirmed'
   AND io.scopeId=json_extract(o.detailsJson,'$.sourceRequestId') AND io.scopeId=json_extract(i.payloadJson,'$.requestId')
   AND json_extract(io.responseJson,'$.messageId')=i.id
   AND json_extract(io.detailsJson,'$.turnId')=json_extract(o.detailsJson,'$.turnId')
   AND EXISTS(SELECT 1 FROM conversation_inputs c WHERE c.requestId=io.scopeId AND c.threadId=json_extract(o.detailsJson,'$.threadId')
     AND c.replyId=json_extract(io.responseJson,'$.replyId'))`;
 const hostInput=`i.senderAgentId='host' AND io.state='confirmed'
   AND ir.state IN ('received','processed') AND coalesce(ir.offeredTurnId,ir.processedBy)=json_extract(o.detailsJson,'$.turnId')
   AND CASE i.kind
    WHEN 'scheduled_message' THEN io.actorAgentId='host' AND io.kind='schedule_delivery' AND io.scopeId='scheduled-deliveries'
      AND io.operationId=json_extract(i.payloadJson,'$.deliveryId') AND json_extract(io.responseJson,'$.messageId')=i.id
      AND json_extract(i.payloadJson,'$.instanceId')=i.recipientAgentId
      AND json_extract(i.payloadJson,'$.threadId')=json_extract(o.detailsJson,'$.threadId')
      AND json_extract(io.detailsJson,'$.threadId')=json_extract(o.detailsJson,'$.threadId')
    WHEN 'task_archived' THEN io.actorAgentId=i.recipientAgentId AND io.kind='archive_work' AND io.scopeId=i.taskId
      AND json_extract(io.detailsJson,'$.threadId')=json_extract(o.detailsJson,'$.threadId')
      AND json_extract(io.responseJson,'$.state')='archived' AND json_extract(io.responseJson,'$.taskId')=i.taskId
      AND json_extract(io.responseJson,'$.version')=i.taskVersion
      AND json_extract(io.responseJson,'$.revision')=json_extract(i.payloadJson,'$.revision')
    ELSE io.actorAgentId='host' AND io.scopeId=i.taskId AND EXISTS(SELECT 1 FROM runs r
      WHERE r.id=i.senderRunId AND r.taskId=i.taskId AND r.version=i.taskVersion AND i.senderEpoch<=r.epoch)
      AND (i.kind='worker_reply' AND io.kind='worker_return' AND json_extract(io.responseJson,'$.messageId')=i.id
        OR i.kind='interaction_required' AND io.kind='interaction_notice'
          AND io.operationId='interaction:'||json_extract(i.payloadJson,'$.interactionId'))
   END`;
 const sourceIds=[...new Set(eligible.flatMap(m=>m.process?.threadId===threadId&&m.process.sourceKind==='worker'&&m.process.turnIds.length?m.process.sourceMessageIds:[]))];
 const notices=new Map(batch(`SELECT m.id,m.taskId,m.taskVersion,m.senderAgentId,m.senderRunId,m.senderEpoch,m.kind,o.actorAgentId,o.kind AS operationKind,o.state AS operationState,o.scopeId,
   coalesce(ar.offeredTurnId,ar.processedBy) AS receivedTurnId,ar.state AS receiptState,
   CASE WHEN o.kind='worker_return' THEN json_extract(o.responseJson,'$.messageId')=m.id
     AND json_extract(m.payloadJson,'$.runId')=m.senderRunId AND json_extract(m.payloadJson,'$.epoch')=m.senderEpoch END AS replyMatches,
   CASE WHEN o.kind='archive_work' THEN json_extract(o.detailsJson,'$.threadId') END AS archiveThread,
   CASE WHEN o.kind='archive_work' THEN
     json_extract(o.responseJson,'$.operationKey')=o.id AND json_extract(o.responseJson,'$.taskId')=m.taskId
     AND json_extract(o.responseJson,'$.state')='archived' AND json_extract(m.payloadJson,'$.historyState')='archived'
     AND json_extract(o.responseJson,'$.version')=m.taskVersion
     AND json_type(m.payloadJson,'$.revision')='integer' AND json_extract(m.payloadJson,'$.revision')>0
     AND json_extract(o.responseJson,'$.revision')=json_extract(m.payloadJson,'$.revision')
     AND (EXISTS(SELECT 1 ${inputReceipt} AND i.recipientAgentId=m.recipientAgentId AND ((${userInput}) OR (${hostInput})))
       OR json_extract(o.detailsJson,'$.origin')='work_status' AND o.operationId GLOB 'work-status:*')
   END AS archiveMatches
   FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id AND ar.recipientAgentId=m.recipientAgentId
   JOIN operations o ON o.id=m.operationKey WHERE m.id IN ($keys) AND m.targetRunId IS NULL AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId')`,sourceIds).map(row=>[row.id,row]));
 const interactionNoticeIds=[...notices.values()].filter(n=>n.kind==='interaction_required'&&n.operationKind==='interaction_notice').map(n=>n.id);
 const interactions=new Map((interactionNoticeIds.length&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker_interactions'").get()?batch(`
   SELECT m.id,coalesce(c.threadId,(SELECT value FROM meta WHERE key='mainThread')) threadId,json_extract(w.details,'$.historyThreadId') AS historyThread
   FROM agent_messages m JOIN operations o ON o.id=m.operationKey
   JOIN worker_interactions w ON w.id=json_extract(m.payloadJson,'$.interactionId')
   JOIN runs r ON r.id=m.senderRunId
   LEFT JOIN conversation_inputs c ON c.requestId=json_extract(w.authority,'$.sourceRequestId')
   WHERE m.id IN ($keys) AND o.id='interaction:'||w.id AND o.operationId=o.id
     AND w.runId=r.id AND json_extract(m.payloadJson,'$.runId')=r.id AND json_extract(m.payloadJson,'$.workerId')=r.workerId
     AND w.runEpoch=m.senderEpoch AND w.taskVersion=m.taskVersion
     AND w.threadId=json_extract(m.payloadJson,'$.threadId') AND w.turnId=json_extract(m.payloadJson,'$.turnId')
     AND (json_extract(w.authority,'$.sourceRequestId') IS NULL OR c.requestId IS NOT NULL)`,interactionNoticeIds):[]).map(row=>[row.id,row]));
 const taskActions=(node:DisplayMessage['process'])=>node?.threadId===threadId?node.items.flatMap(item=>{
  if(item.kind!=='tool'||!item.activity?.target||item.activity.action.startsWith('inspect_'))return [];
  return [{item,activity:item.activity,target:item.activity.target}];
 }):[];
 const actions=eligible.flatMap(m=>taskActions(m.process));
 const titleEvents=new Map(eligible.flatMap(message=>{
  const node=message.process;
  if(includeCoveredSources||node?.threadId!==threadId)return [];
  const items=node.items.flatMap(item=>item.kind==='workerEvent'&&item.event?.title&&(
   item.event.eventKind==='delegated'&&item.event.bodySource==='description'||
   node.sourceKind==='worker'&&item.event.eventKind==='reply_received'&&item.event.sourceMessageId&&node.sourceMessageIds.includes(item.event.sourceMessageId)
  )?[{id:item.id,event:item.event}]:[]);
  return items.length?[[message.id,items] as const]:[];
 }));
 const titleSnapshots=[...titleEvents.values()].flatMap(items=>items.map(({event})=>event));
 const operations=new Map(batch(`SELECT o.id,o.actorAgentId,o.scopeId,o.kind,o.state,json_extract(o.responseJson,'$.taskId') AS responseTaskId,
   json_extract(o.responseJson,'$.version') AS responseVersion,
   CASE WHEN o.kind='worker_open' THEN json_extract(o.responseJson,'$.runId') END AS responseRunId,
   json_extract(o.detailsJson,'$.threadId') AS threadId,json_extract(o.detailsJson,'$.turnId') AS turnId,
   json_extract(o.detailsJson,'$.inputMessageId') AS inputMessageId,
   CASE WHEN o.kind='task_control' THEN
     json_extract(o.responseJson,'$.operationKey')=o.id
     AND CASE json_extract(o.detailsJson,'$.action')
       WHEN 'pause' THEN json_extract(o.responseJson,'$.state')='paused'
       WHEN 'resume' THEN json_extract(o.responseJson,'$.state')='open'
     END
     AND EXISTS(SELECT 1 ${inputReceipt} AND i.recipientAgentId=o.actorAgentId AND (
       (${userInput}) OR (${hostInput})
     )) END AS updateMatches
   FROM operations o WHERE o.id IN ($keys)`,[...new Set([...actions.map(({target})=>target.operationKey),
    ...titleSnapshots.map(event=>event.operationKey)].filter((key):key is string=>!!key))]).map(o=>[o.id,o]));
 const runIds=[...new Set([...notices.values()].flatMap(n=>typeof n.senderRunId==='string'?[n.senderRunId]:[]).concat([...actions.map(({target})=>target.runId),...titleSnapshots.map(event=>event.runId)].filter((id):id is string=>!!id)))];
 const runs=new Map(batch('SELECT id,taskId,version,epoch FROM runs WHERE id IN ($keys)',runIds).map(r=>[r.id,r]));
 const targets=[...notices.values()].map(n=>[n.taskId,n.taskVersion]).concat(actions.map(({target})=>[target.taskId,target.version]),formal.map(m=>[m.taskId,m.taskVersion]),titleSnapshots.map(event=>[event.taskId,event.version]));
 const keys=[...new Set(targets.filter(([id,version])=>typeof id==='string'&&Number.isSafeInteger(version)).map(pair=>JSON.stringify(pair)))];
 const versions=new Map<string,Record<string,any>>();
 for(let at=0;at<keys.length;at+=200){
  const rows=db.prepare(`SELECT v.taskId,v.version,t.title,c.id AS sourceMessageId FROM json_each(?) k JOIN task_versions v ON v.taskId=json_extract(k.value,'$[0]') AND v.version=json_extract(k.value,'$[1]') JOIN tasks t ON t.id=v.taskId LEFT JOIN conversation_inputs i ON i.requestId=v.sourceRequestId AND i.threadId=? LEFT JOIN conversation_messages c ON c.threadId=i.threadId AND c.requestId=i.requestId AND c.role='user' WHERE v.sourceRequestId IS NULL OR i.requestId IS NOT NULL`).all('['+keys.slice(at,at+200).join(',')+']',threadId);
  for(const row of rows){const key=JSON.stringify([row.taskId,row.version]),old=versions.get(key);versions.set(key,old?{...old,sourceMessageId:null}:row);}
 }
 type Node=NonNullable<DisplayMessage['process']>;
 const receivedIn=(notice:Record<string,any>,node:Node)=>
  ['received','processed'].includes(notice.receiptState)&&node.turnIds.includes(notice.receivedTurnId);
 const confirmedReply=(notice:Record<string,any>,node:Node)=>
  notice.kind==='worker_reply'&&notice.senderAgentId==='host'&&notice.actorAgentId==='host'&&
  notice.operationKind==='worker_return'&&notice.operationState==='confirmed'&&notice.replyMatches===1&&receivedIn(notice,node);
 const operationIn=(operation:Record<string,any>,node:Node)=>
  operation.state==='confirmed'&&operation.actorAgentId===main&&operation.threadId===threadId&&
  node.turnIds.includes(operation.turnId)&&node.sourceMessageIds.includes(operation.inputMessageId);
 const confirmedOpen=(operation:Record<string,any>,node:Node,{taskId,version,runId}:TaskMessageSource['target'])=>
  !!runId&&operation.kind==='worker_open'&&operationIn(operation,node)&&operation.scopeId===taskId&&
  operation.responseTaskId===taskId&&operation.responseVersion===version&&operation.responseRunId===runId;
 const out=new Map<string,TaskMessageSource[]>(),unresolved=new Set<string>(),seen=new Set<string>();
 const push=(id:string,source:TaskMessageSource)=>{
  const v=versions.get(JSON.stringify([source.target.taskId,source.target.version]));if(!v){unresolved.add(id);return;}
  const run=source.target.runId?runs.get(source.target.runId):undefined;
  if(source.target.runId&&(!run||run.taskId!==source.target.taskId||run.version!==source.target.version)){unresolved.add(id);return;}
  if(seen.has(source.key))return;seen.add(source.key);
  const list=out.get(id)??[];list.push({...source,title:publicActivityName(v.title)??'',...(v.sourceMessageId?{originalRequestMessageId:v.sourceMessageId}:{})});out.set(id,list);
 };
 for(const message of formal){
  const node=message.process?.threadId===threadId?message.process:undefined;
  push(message.id,{key:JSON.stringify([threadId,message.id,'message']),target:{taskId:message.taskId!,version:message.taskVersion!},title:'',icon:'Inbox',origin:{kind:'message',messageId:message.id,...(node?{processId:node.id}:{})},phaseLabel:'事项相关回复',owner:'main',previewVerified:true});
 }
 for(const message of eligible){
  const node=message.process?.threadId===threadId?message.process:undefined;
  const events=node?.items.flatMap(i=>i.kind==='workerEvent'&&i.event?[i.event]:[])??[];
  const eventMessages=new Set(events.map(e=>e.sourceMessageId)),eventOperations=new Set(events.map(e=>e.operationKey));
  if(node?.sourceKind==='worker'&&node.turnIds.length)for(const id of node.sourceMessageIds){
   if(eventMessages.has(id)&&!includeCoveredSources)continue;
   const notice=notices.get(id),run=notice?.senderRunId?runs.get(notice.senderRunId):undefined;
   if(!notice||notice.senderAgentId!=='host'||notice.operationState!=='confirmed'||notice.scopeId!==notice.taskId){unresolved.add(message.id);continue;}
   const runMatches=run&&run.taskId===notice.taskId&&run.version===notice.taskVersion&&notice.senderEpoch!=null&&notice.senderEpoch<=run.epoch;
   const received=typeof notice.receivedTurnId==='string'&&node.turnIds.includes(notice.receivedTurnId);
   if(includeCoveredSources&&!received)continue;
   const interaction=interactions.get(id);
   const verified=notice.operationKind==='interaction_notice'
    ? notice.actorAgentId==='host'&&notice.kind==='interaction_required'&&received&&runMatches&&interaction?.threadId===threadId&&(interaction.historyThread==null||interaction.historyThread===threadId)
    : notice.operationKind==='archive_work'
     ? notice.actorAgentId===main&&notice.kind==='task_archived'&&notice.senderRunId==null&&notice.senderEpoch==null&&received&&notice.archiveThread===threadId&&notice.archiveMatches
     : notice.actorAgentId==='host'&&(notice.kind==='worker_reply'
       ? ['worker_return','notify'].includes(notice.operationKind)&&runMatches
       : notice.operationKind==='notify'&&notice.kind!=='task_archived'&&(notice.kind!=='interaction_required'||notice.senderRunId==null));
   if(!verified){unresolved.add(message.id);continue;}
   const previewVerified=notice.kind==='worker_reply'?confirmedReply(notice,node):receivedIn(notice,node);
   push(message.id,{key:JSON.stringify([threadId,node.id,id]),target:{taskId:notice.taskId,version:notice.taskVersion,...(run?{runId:run.id}:{})},title:'',icon:notice.kind==='worker_reply'?'MessagesSquare':'Inbox',origin:{kind:'message',processId:node.id,messageId:id},phaseLabel:notice.kind==='worker_reply'?'收到 Worker 回复':notice.kind==='task_archived'?'事项已归档':'Homer 协作事项',owner:'main',...(previewVerified?{previewVerified:true}:{})});
  }
  if(!node)continue;
  for(const {item,activity,target} of taskActions(node)){
   const operation=operations.get(target.operationKey);
   if(eventOperations.has(target.operationKey??null)&&!includeCoveredSources)continue;
   if(!operation||includeCoveredSources&&operation.state!=='confirmed'||operation.actorAgentId!==main||!(operation.scopeId===target.taskId||['task_create','worker_open'].includes(operation.kind)&&operation.responseTaskId===target.taskId)){unresolved.add(message.id);continue;}
   const verified=operation.kind==='task_control'
    ? activity.action==='update_task'&&activity.outcome==='update_confirmed'&&item.status==='completed'&&operation.state==='confirmed'
      &&operation.responseTaskId===target.taskId&&operation.responseVersion===target.version&&!target.runId
      &&operation.threadId===threadId&&typeof operation.turnId==='string'&&node.turnIds.includes(operation.turnId)
      &&(!item.turnId||item.turnId===operation.turnId)&&node.sourceMessageIds.includes(operation.inputMessageId)&&operation.updateMatches
    : ({create_task:['task_create','worker_open'],update_task:['task_update'],stop_task:['worker_stop']} as Record<string,string[]>)[activity.action]?.includes(operation.kind);
   if(!verified){unresolved.add(message.id);continue;}
   const previewVerified=operation.kind==='worker_open'?confirmedOpen(operation,node,target)
    : operationIn(operation,node)&&(!item.turnId||item.turnId===operation.turnId)&&operation.responseTaskId===target.taskId&&
      (operation.kind==='worker_stop'||operation.responseVersion===target.version);
   push(message.id,{key:JSON.stringify([threadId,node.id,item.id]),target,title:'',icon:activity.action==='create_task'?'Send':'CornerDownRight',origin:{kind:'activity',processId:node.id,itemId:item.id},phaseLabel:activityOutcomes[activity.outcome],owner:'main',...(previewVerified?{previewVerified:true}:{})});
  }
 }
 return messages.map(message=>{
  const node=message.process;
  const eventTargets=titleEvents.get(message.id)?.flatMap(({id,event})=>{
   const {taskId,version,runId}=event;
   if(!node||!taskId||!version||!runId||!versions.has(JSON.stringify([taskId,version])))return [];
   const run=runs.get(runId);
   if(!run||run.taskId!==taskId||run.version!==version)return [];
   if(event.eventKind==='delegated'){
    const operation=operations.get(event.operationKey);
    if(!operation||!confirmedOpen(operation,node,{taskId,version,runId}))return [];
   }else{
    const notice=notices.get(event.sourceMessageId);
    if(!notice||!confirmedReply(notice,node)||notice.scopeId!==taskId||notice.taskId!==taskId||
       notice.taskVersion!==version||notice.senderRunId!==runId||notice.senderEpoch==null||notice.senderEpoch>run.epoch)return [];
   }
   return [[id,{taskId,version,runId}]] as const;
  });
  return {...message,...(out.has(message.id)?{taskSources:out.get(message.id)}:{}),
   ...(eventTargets?.length?{taskEventTargets:Object.fromEntries(eventTargets)}:{}),
   ...(unresolved.has(message.id)?{taskSourceUnresolved:true as const}:{})};
 });
}
import { readTaskOverview, readTaskDetail, readTaskSummary } from './task-overview.js';
import { businessOptions,projectQuestions } from './question-schema.js';
import {revealAttachmentFile} from './artifact-reveal.js';
import type { Homer } from "./service.js";
import { CONVERSATION_VIEW,type WebBridge,type DispatchQueuePage,type WebArtifact,type MessageAttachment,type WebApproval } from "./web-contract.js";

// Enrich only the authorized page. User decisions stay on their original message;
// the projection cannot grant authority or release an interaction callback.
function verifiedInteractionResponses(db:DatabaseSync,requests:readonly string[],threadId:string){
 if(!requests.length)return [];
 const rows=db.prepare(`SELECT w.id,w.kind,w.source,w.runId,w.userQuestion,w.responseUserText,u.text userText,u.quote userQuote,
  json_extract(w.details,'$.approval') approval,json_extract(w.details,'$.method') method,
  json_extract(w.details,'$.params.questions') questions,w.decision,w.state,w.deliveredAt,
  (SELECT r.taskId FROM runs r WHERE r.id=CASE WHEN w.runId LIKE 'main-native:worker-native:%' THEN substr(w.runId,27) ELSE w.runId END
    AND (w.runId LIKE 'main-native:worker-native:%' OR r.version=w.taskVersion AND r.threadId=w.threadId AND r.turnId=w.turnId)) taskId,source.requestId sourceRequestId,c.requestId,c.replyId,u.id userId
  FROM worker_interactions w
  JOIN conversation_inputs c ON c.requestId=w.responseUserMessageId AND c.threadId=?
  JOIN conversation_messages u ON u.threadId=c.threadId AND u.requestId=c.requestId AND u.role='user'
  LEFT JOIN conversation_inputs source ON source.requestId=json_extract(w.authority,'$.sourceRequestId') AND source.threadId=c.threadId
  WHERE w.responseUserMessageId IN (${requests.map(()=>'?').join(',')})
  AND (source.requestId IS NOT NULL
    OR ((json_extract(w.authority,'$.sourceRequestId') IS NULL OR json_extract(w.details,'$.method')='homer_preview_location')
      AND json_extract(w.details,'$.historyThreadId')=c.threadId)
    OR (json_extract(w.authority,'$.sourceRequestId') IS NULL AND w.source='ask_main'
      AND c.threadId=(SELECT value FROM meta WHERE key='mainThread')
      AND EXISTS(SELECT 1 FROM runs r WHERE r.id=w.runId AND r.threadId=w.threadId AND r.turnId=w.turnId AND r.version=w.taskVersion)))
  AND (json_type(w.details,'$.historyThreadId') IS NULL OR json_extract(w.details,'$.historyThreadId')=c.threadId)`)
  .all(threadId,...requests) as {id:string;kind:'authorization'|'question';source:string;runId:string;userQuestion:string|null;responseUserText:string;userText:string;userQuote:string|null;approval:string|null;method:string|null;questions:string|null;decision:string|null;state:string;deliveredAt:number|null;taskId:string|null;sourceRequestId:string|null;requestId:string;replyId:string;userId:string}[];
 const byRequest=new Map<string,typeof rows[number]|null>();
 for(const row of rows)byRequest.set(row.requestId,byRequest.has(row.requestId)?null:row);
 return [...byRequest.values()].filter((row):row is typeof rows[number]=>{
  if(!row)return false;
  if(row.userText===row.responseUserText)return true;
  if(row.kind!=='question'||row.source!=='ask_main'||!row.userQuote)return false;
  try{return conversationUserText({text:row.userText,...decodeConversationReferences(row.userQuote)})===row.responseUserText;}
  catch{return false;}
 });
}

export function withInteractionResponses(db:DatabaseSync,messages:readonly DisplayMessage[],threadId:string):DisplayMessage[]{
 const requests=[...new Set(messages.flatMap(m=>m.threadId===threadId&&m.requestId?[m.requestId]:[]))];
 const cards=new Map<string,NonNullable<DisplayMessage['interaction']>>(),hidden=new Set<string>();
 const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
 for(const row of verifiedInteractionResponses(db,requests,threadId)){
  const approval:WebApproval|undefined=row.approval?JSON.parse(row.approval):undefined;
  const card:NonNullable<DisplayMessage['interaction']>={id:row.id,kind:row.kind,title:row.userQuestion??'',answers:row.userText.trim()?[{text:row.userText}]:[]};
  if(row.kind==='authorization'){
   card.title=text(approval?.title)?approval.title:'';
   const description=[approval?.context,approval?.explanation];
   if(approval?.rememberLocation)description.push(row.deliveredAt!==null?'决定已交给原网页。':row.state==='expired'?'原请求已失效。':'已收到决定，等待原网页确认。');
   // Commands and permission paths have no separate object field in old records.
   if(['item/commandExecution/requestApproval','item/permissions/requestApproval'].includes(row.method??''))description.push(approval?.details);
   const parts=[...new Set(description.filter(text))].filter(value=>value!==card.title&&value!==approval?.scope);
   if(parts.length)card.description=parts.join('\n');
   if(text(approval?.scope))card.scope=approval.scope;
   card.answers=[{text:({'允许本次操作':'你已允许本次操作','记住此站点':'你已选择记住此站点','拒绝本次操作':'你已拒绝本次操作','取消本次请求':'你已取消本次请求'} as Record<string,string>)[row.responseUserText]??row.responseUserText}];
  }else if(row.runId.startsWith('main-native:')&&row.method==='item/tool/requestUserInput'){
   const questions=projectQuestions('question',{questions:row.questions?JSON.parse(row.questions):undefined});
   const answers=row.decision?JSON.parse(row.decision).answers:undefined;
   if(questions&&answers&&typeof answers==='object'&&!Array.isArray(answers)&&Object.keys(answers).length===questions.length&&questions.every(q=>Array.isArray(answers[q.id])&&answers[q.id].length&&answers[q.id].every(text))){
    card.title=questions.length===1?questions[0]!.question:'';
    card.answers=questions.map(q=>({...(!card.title?{question:q.question}:{}),text:answers[q.id].join('\n')}));
   }else card.unavailable=true;
  }
  if(!card.title&&!card.answers.some(a=>a.question))card.unavailable=true;
  cards.set(row.userId,card);
  const reply=messages.find(m=>m.id===row.replyId);
  if(row.runId.startsWith('main-native:')&&reply?.role==='assistant'&&reply.status==='completed'&&!reply.process&&!reply.attachments?.length&&!reply.media?.length&&[
   '已批准本次操作，等待执行结果。','已拒绝本次操作。','已记录取消，等待原生处理。','已提交本轮补充。'
  ].includes(reply.text))hidden.add(row.replyId);
 }
 return messages.filter(m=>!hidden.has(m.id)).map(m=>cards.has(m.id)?{...m,interaction:cards.get(m.id)}:m);
}

export function homerWebBridge(app: Homer,{draftUpload=true}:{draftUpload?:boolean}={}): WebBridge {
  app.registerWebSurface(draftUpload);
  const files=(messages:readonly import('./web-history.js').ConversationMessage[]):WebArtifact[]=>messages.flatMap(message=>{
    if(message.role!=='assistant'||message.audience!=='user'||message.revokedAt!=null||message.status!=='completed')return [];
    const destinations=message.attachments?.length?app.finalAttachmentDestinations(message.id):[];
    return (message.attachments??[]).flatMap((ref,index)=>{
      const asset=app.media.asset(ref);
      if(!app.media.originalAvailable(asset)||!asset.hash)return [];
      return [{...ref,id:JSON.stringify([message.id,ref.assetId,ref.revision]),messageId:message.id,
        title:asset.filename,sha256:asset.hash,size:asset.size,...(destinations[index]?{destination:destinations[index]}:{})}];
    });
  });
  const taskFiles=(id:string)=>{
    const thread=app.store.meta('mainThread')!;
    const rows=app.store.db.prepare(`SELECT m.id FROM conversation_messages m
      WHERE m.threadId=? AND m.taskId=? AND EXISTS(SELECT 1 FROM conversation_attachments a WHERE a.messageId=m.id) AND m.role='assistant' AND m.audience='user' AND m.revokedAt IS NULL AND m.status='completed'
      ORDER BY m.rowid DESC LIMIT 81`).all(thread,id);
    return {artifacts:files(app.history.byIds(thread,rows.slice(0,80).map(row=>String(row.id)))),moreArtifacts:rows.length>80};
  };
  const origin=async(input:MessageAttachment)=>{
    const message=app.attachmentMessage(input);
    app.media.readAttachment(input);
    return {message,files:files([message])};
  };
  const pageReader=()=>app.webHistoryPages();
  const epoch=(value:string)=>{if(value!==app.webReadEpoch)throw Error('history_epoch_changed');};
  // Worker events already contain their immutable, explicitly public snapshot.
  const page=(request:import('./web-history-pages.js').HistoryPageRequest={})=>{
    const result=pageReader().read(app.store.meta('mainThread')!,request);
    const artifacts=files(result.messages);
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
    return {...result,artifacts,inactiveInteractions,inactiveMore,messages:withInteractionResponses(app.store.db,withTaskSources(app.store.db,result.messages,result.threadId),result.threadId).map(message=>({...message,...(message.process?{process:message.process}:{}),...(message.attachments?{media:message.attachments.map(ref=>app.media.view(ref))}:{}),...(message.source?.attachments?{source:{...message.source,media:message.source.attachments.map(ref=>app.media.view(ref))}}:{})}))};
  };
  const queuePage=(after=0)=>{const page=pageReader().queuePage(after);return {...page,items:page.items.map(item=>({...item,user:{...item.user,...(item.user.attachments?{media:item.user.attachments.map(ref=>app.media.view(ref))}:{})}}))};};
  const interactionPage=(after=0)=>{
    if(!Number.isSafeInteger(after)||after<0)throw Error('history_cursor_invalid');
    const rows=app.store.db.prepare("SELECT id,rowid position FROM worker_interactions WHERE state='pending_user' AND responseUserMessageId IS NULL AND rowid>? ORDER BY rowid LIMIT 81").all(after),selected=rows.slice(0,80);
    const facts=new Map(selected.length?app.store.db.prepare(`SELECT i.id,t.title,(SELECT id FROM conversation_messages c WHERE c.threadId=? AND c.requestId=json_extract(i.authority,'$.sourceRequestId') AND c.role='user' ORDER BY c.rowid DESC LIMIT 1) sourceMessageId
      FROM worker_interactions i LEFT JOIN runs r ON r.id=CASE WHEN i.runId LIKE 'main-native:worker-native:%' THEN substr(i.runId,27) ELSE i.runId END LEFT JOIN tasks t ON t.id=r.taskId WHERE i.id IN (${selected.map(()=>'?').join(',')})`).all(app.store.meta('mainThread')!,...selected.map(row=>String(row.id))).map(row=>[String(row.id),row]):[]);
    return {items:selected.map(({id})=>app.interactions.inspect(String(id))).map(item=>({id:item.id,runId:item.runId,kind:item.kind,workTitle:String(facts.get(item.id)?.title??(item.runId.startsWith('main-native:worker-native:')?'后台原生请求':item.runId.startsWith('main-native:')?'主对话':'后台工作')),sourceRequestId:item.authority.sourceRequestId,...(facts.get(item.id)?.sourceMessageId?{sourceMessageId:String(facts.get(item.id)!.sourceMessageId)}:{}),...(item.source==='ask_main'&&item.kind==='question'&&item.details.userOptions?{options:businessOptions(item.details.userOptions)}:{}),question:item.userQuestion??'请补充完成这项工作所需的信息。',reason:item.escalationReason,...(item.kind==='authorization'&&item.details.approval?{approval:item.details.approval as WebApproval}:{}),...(item.details.method==='mcpServer/elicitation/request'&&(item.details.params as any)?._meta?.codex_approval_kind==='mcp_tool_call'?{canCancel:true as const}:{}),questions:item.runId.startsWith('main-native:')?projectQuestions(item.kind,item.details):undefined})),after:rows.length>80?Number(selected.at(-1)!.position):null};
  };
  return {
    history:{
      page:async input=>{
        epoch(input.readEpoch);
        if(!input.request.taskId)return page(input.request);
        const db=app.store.db,thread=app.store.meta('mainThread')!;
        const result=readTaskConversation(db,pageReader(),thread,input.readEpoch,input.request,{
          responses:requests=>verifiedInteractionResponses(db,requests,thread).filter(row=>!['pending_user','pending_main'].includes(row.state)),
          related:messages=>withTaskSources(db,messages,thread,true),
          message:id=>app.history.message(id),
        });
        const messages=withInteractionResponses(app.store.db,result.messages,result.threadId).map(message=>({...message,
          ...(message.attachments?{media:message.attachments.map(ref=>app.media.view(ref))}:{}),
          ...(message.source?.attachments?{source:{...message.source,media:message.source.attachments.map(ref=>app.media.view(ref))}}:{})}));
        if(input.request.around&&!messages.some(message=>message.id===input.request.around))throw Error('history_message_not_found');
        return {...result,messages,artifacts:files(messages)};
      },
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
        const requestId=message.requestId??app.store.db.prepare('SELECT requestId FROM web_process_ids WHERE threadId=? AND messageId=?').get(thread,input.id)?.requestId;
        const user=requestId?app.store.db.prepare("SELECT id FROM conversation_messages WHERE threadId=? AND requestId=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(thread,requestId):undefined;
        return {messageId:String(message.id),...(user?{sourceMessageId:String(user.id)}:{})};
      },
      queue:async(after,readEpoch)=>{if(readEpoch!==undefined)epoch(readEpoch);const result=queuePage(after);return {...result,threadId:app.store.meta('mainThread')!,readEpoch:app.webReadEpoch,revision:pageReader().revision};},
      dispatchQueue:async<S extends 'all'|undefined=undefined>({cursor,readEpoch,sources}:{cursor?:string;readEpoch:string;sources?:S})=>{
        epoch(readEpoch);const result=pageReader().dispatchQueue(cursor,readEpoch,sources);
        return {...result,view:'dispatch-v1',...(sources?{sources}:{}),threadId:app.store.meta('mainThread')!,readEpoch,revision:pageReader().revision,items:result.items.map(item=>('user' in item&&item.user)?{...item,user:{...item.user,...(item.user.attachments?{media:item.user.attachments.map(ref=>app.media.view(ref))}:{})}}:item)} as DispatchQueuePage<S>;
      },
      interactions:async(after,readEpoch,id)=>{
        if(readEpoch!==undefined)epoch(readEpoch);
        const threadId=app.store.meta('mainThread')!;
        let cursor:number|undefined;
        if(id!==undefined){
          const row=app.store.db.prepare(`SELECT w.rowid AS position FROM worker_interactions w
            WHERE w.id=? AND coalesce(json_extract(w.details,'$.historyThreadId'),?)=?
              AND (json_extract(w.details,'$.historyThreadId')=?
                OR EXISTS(SELECT 1 FROM runs r WHERE r.id=w.runId AND r.threadId=w.threadId AND r.turnId=w.turnId))`).get(id,threadId,threadId,threadId);
          if(!row||!app.interactions.actionable(id))throw Error('interaction_not_live');
          const current=interactionPage(after);
          if(current.items.some(item=>item.id===id))return {...current,threadId,readEpoch:app.webReadEpoch,revision:pageReader().revision};
          cursor=Number(row.position)-1;
        }
        return {...interactionPage(cursor??after),cursor,threadId,readEpoch:app.webReadEpoch,revision:pageReader().revision};
      },
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
        const activity=current.mainActivity;
        if(activity?.source==='internal'){
          const receipt=recent.messages.find(message=>message.process?.id===activity.processId)?.process;
          if(receipt)activity.finalText=app.liveReceiptText(receipt);
        }
        return {...current,threadId,messages:recent.messages,queue:queue.items,artifacts,inactiveInteractions,work:[],interactions,conversationView:CONVERSATION_VIEW,acceptedRequestIds:[],processNodes:[],
        queueDispatch:app.inputs.dispatchSummary(),runningTaskIds:app.runningTaskIds?.(),features:{draftUpload,taskOverview:true,taskConversation:1,taskArchive:1,taskReference:1,scheduleReference:1,workerEventCards:1,queueDispatch:1,queueSources:1,nativeQuestionAnswers:1,previewReferences:1,previewReferenceCollections:2},upgrade:{phase:'running'},
        history:{protocol:3,readEpoch:app.webReadEpoch,page:pageInfo,moreQueue:queue.after,moreInteractions:pending.after}};
        };
        return app.receptionTimings?app.receptionTimings.measure('state_history',build):build();
      },
    },
    openPreview:input=>app.openBrowserPreview(input),
    readMessageFile:input=>app.readMessageFile(input),
    messageFileInfo:(input,reveal)=>app.messageFileInfo(input,reveal),
    schedules:async input=>app.readSchedules(input),
    onStateChange: listener=>app.onStateChange(listener),
    taskOverview:{
      ...(app.archiveTaskFromWeb?{archive:async input=>app.archiveTaskFromWeb(input)}:{}),
      list:async page=>{
        const overview=readTaskOverview(app.store.db,page);
        for(const task of overview.tasks){
          if(task.historyState==='visible'&&task.workers.some(worker=>app.isWorkerExecuting?.(worker.run)===true))task.hasExecutingWorker=true;
        }
        const candidates=overview.tasks.filter(task=>task.historyState==='visible');
        if(candidates.length&&app.taskArchiveBlockers){
          const blockers=app.taskArchiveBlockers(candidates.map(task=>task.id));
          for(const task of candidates)task.archiveBlocker=blockers.get(task.id);
        }
        return overview;
      },
      summary:async id=>{
        const detail=readTaskSummary(app.store.db,id);
        const sources=app.store.db.prepare(`SELECT v.taskId,c.id,c.threadId FROM tasks t JOIN task_versions v ON v.taskId=t.id AND v.version=t.headVersion JOIN conversation_inputs input ON input.requestId=v.sourceRequestId JOIN conversation_messages c ON c.threadId=input.threadId AND c.requestId=input.requestId AND c.role='user' WHERE t.id=?`).all(id);
        const source=sources.length===1?sources[0]:undefined;
        return {...detail,requirements:detail.requirements!.map(r=>({...r,...(source?{sourceMessageId:String(source.id),threadId:String(source.threadId)}:{})})),...taskFiles(id)};
      },
      detail:async(id,query?:import('./task-overview.js').WorkerConversationQuery)=>{
        const detail=readTaskDetail(app.store.db,id,query);
        if(query)return detail;
        if(detail.historyState!=='archived')return {...detail,...taskFiles(id)};
        const thread=app.store.meta('mainThread')!;
        const rows=app.store.db.prepare(`SELECT id,role,substr(text,1,80) AS excerpt FROM (
          SELECT m.rowid AS position,m.id,m.role,m.text FROM conversation_messages m
          WHERE m.threadId=? AND m.taskId=? AND m.role='assistant' AND m.audience='user' AND m.revokedAt IS NULL
          UNION ALL
          SELECT m.rowid,m.id,m.role,m.text FROM conversation_messages m
          JOIN conversation_inputs input ON input.requestId=m.requestId AND input.threadId=m.threadId
          WHERE m.threadId=? AND m.role='user' AND m.audience='user' AND m.revokedAt IS NULL AND m.requestId IN (${taskSourceRequestsSql})
          ) ORDER BY position DESC LIMIT 81`).all(thread,id,thread,id,id,id,id) as NonNullable<typeof detail.publicMessages>;
        return {...detail,...taskFiles(id),publicMessages:rows.slice(0,80),moreMessages:rows.length>80};
      },
      origin:async(id,messageId)=>{
        if(!/^[\w:-]{1,100}$/.test(id)||!/^[\w:-]{1,100}$/.test(messageId))throw Error('task_origin_not_found');
        const source=app.store.db.prepare(`SELECT c.id FROM conversation_messages c JOIN conversation_inputs input ON input.requestId=c.requestId AND input.threadId=c.threadId
          WHERE c.id=? AND c.role='user' AND c.audience='user' AND c.requestId IN (${taskSourceRequestsSql})`).get(messageId,id,id,id,id);
        const message=app.history.message(messageId);
        if(!message||message.threadId!==app.store.meta('mainThread')||message.revokedAt!=null||
          !(source&&message.role==='user')&&!(message.taskId===id&&message.role==='assistant'&&message.audience==='user'))throw Error('task_origin_not_found');
        return {message,files:files([message])};
      }
    },
    media:{read:async input=>app.readAttachment(input),origin,reveal:input=>revealAttachmentFile(app.revealAttachment(input)),...(draftUpload?{upload:(input:import('./web-upload.js').WebUpload)=>app.uploadAttachment(input),discard:async(input:unknown)=>app.discardAttachment(input),previewDraft:async(input:unknown)=>app.readDraftImage(input)}:{})},
    submit: async (input,scope) => {
      if(scope){epoch(scope.readEpoch);if(scope.threadId!==app.store.meta('mainThread'))throw Error('queue_thread_conflict');}
      return app.submitMessage(input);
    },
    queue:{edit:async input=>app.editQueued(input),cancel:async input=>app.cancelQueued(input),move:async input=>app.moveQueued(input),interrupt:async(input,target)=>app.submitMessage(input,undefined,target)},
    stop: id => app.stopMain(id),
    feedback: async (id, value) => app.history.feedback(app.store.meta('mainThread')!, id, value),
    respond: async (id, input) => 'optionId' in input?app.submitBusinessOption(id,input):app.submitMessage({ ...input, interactionId: id }),
  };
}
