import type {DatabaseSync} from 'node:sqlite';
import type {DisplayMessage} from './conversation-projection.js';
import {taskSourceRequestsSql} from './recursive-tasks.js';
import {decodeConversationReferences,type ConversationMessage} from './web-history.js';
import {messageFileDestination,messageLinks} from './message-links.js';
import {referencesOf} from './preview-reference.js';
import type {WebHistoryPages,HistoryPageRequest} from './web-history-pages.js';

const visible=(m:Pick<DisplayMessage,'threadId'|'audience'|'revokedAt'|'status'>,thread:string)=>
 m.threadId===thread&&m.audience==='user'&&m.revokedAt==null&&m.status!=='cancelled';

type TaskSources={
 responses:(requests:readonly string[])=>{taskId:string|null;sourceRequestId:string|null;requestId:string;userId:string}[];
 related:(messages:readonly DisplayMessage[])=>DisplayMessage[];
 message:(id:string)=>ConversationMessage|undefined;
};
function taskMessages(db:DatabaseSync,reader:WebHistoryPages,thread:string,taskId:string,messages:readonly DisplayMessage[],sources:TaskSources){
 const readInputs=db.prepare(`SELECT c.requestId,c.replyId,u.id,u.quote FROM conversation_inputs c
  JOIN conversation_messages u ON u.threadId=c.threadId AND u.requestId=c.requestId AND u.role='user'
  AND u.audience='user' AND u.revokedAt IS NULL AND u.status!='cancelled'
  WHERE c.threadId=? AND c.requestId IN (SELECT value FROM json_each(?))`);
 const inputs=readInputs.all(thread,JSON.stringify([...new Set(messages.flatMap(m=>[m.requestId,m.source?.requestId].filter(Boolean)))]));
 const responses=sources.responses(inputs.map(row=>String(row.requestId)));
 const originalRequests=responses.flatMap(row=>row.taskId===null&&row.sourceRequestId?[row.sourceRequestId]:[]);
 const originalInputs=readInputs.all(thread,JSON.stringify(originalRequests));
 const inputIds=JSON.stringify([...inputs,...originalInputs].map(i=>i.requestId));
 const sourceRequests=new Set(db.prepare(`SELECT sourceRequestId FROM (${taskSourceRequestsSql}) WHERE sourceRequestId IN (SELECT value FROM json_each(?))`)
  .all(taskId,taskId,taskId,taskId,inputIds).map(row=>row.sourceRequestId));
 const relatedAnswers=new Map(responses.filter(row=>row.taskId===taskId||row.taskId===null&&row.sourceRequestId&&
  originalInputs.filter(input=>input.requestId===row.sourceRequestId).length===1&&
  originalInputs.some(input=>input.requestId===row.sourceRequestId&&(sourceRequests.has(input.requestId)||referencesTask(input))))
  .map(row=>[row.requestId,row.userId]));
 const byRequest=new Map<string,typeof inputs[number]|null>();
 for(const row of inputs){const key=String(row.requestId);byRequest.set(key,byRequest.has(key)?null:row);}
 function inputFor(m:DisplayMessage){return m.requestId?byRequest.get(m.requestId):undefined;}
 function referencesTask(input:typeof inputs[number]){
  try{return typeof input.quote==='string'&&decodeConversationReferences(input.quote).taskReference?.taskId===taskId;}
  catch{return false;}
 }
 function userMatches(m:DisplayMessage){
  const input=inputFor(m);
  return visible(m,thread)&&m.role==='user'&&input?.id===m.id&&
   (referencesTask(input)||sourceRequests.has(input.requestId)||relatedAnswers.get(String(input.requestId))===input.id);
 }
 const inputSource=db.prepare(`SELECT 1 FROM conversation_inputs c JOIN conversation_messages u
   ON u.threadId=c.threadId AND u.requestId=c.requestId AND u.role='user'
   WHERE c.threadId=? AND c.requestId=? AND u.audience='user' AND u.revokedAt IS NULL AND u.status!='cancelled'`);
 const projectedSources=new Map<string,DisplayMessage|undefined>();
 function projectedSource(id:string){
  if(!projectedSources.has(id))projectedSources.set(id,reader.read(thread,{around:id,limit:1}).messages.find(row=>row.id===id));
  return projectedSources.get(id);
 }
 function publicReferences(m:DisplayMessage){
  if(!m.resourceReference&&!m.resourceReferences?.length)return m;
  const {resourceReference:_reference,resourceReferences:_references,...message}=m;
  const allowed=referencesOf(m).filter(reference=>{
   const source=reference.source;
   if(source.kind==='draft-image')return reference.kind==='image'&&m.attachments?.some(asset=>asset.assetId===reference.image.assetId&&asset.revision===reference.image.revision);
   if(source.kind==='browser'&&source.requestId)return !!inputSource.get(thread,source.requestId);
   if(!source.messageId)return false;
   const original=sources.message(source.messageId);
   if(!original||original.threadId!==thread||original.revokedAt!=null||original.status==='cancelled')return false;
   if(source.kind==='attachment')return visible(original,thread)&&original.attachments?.some(asset=>asset.assetId===source.assetId&&asset.revision===source.revision);
   if(source.kind==='browser'&&visible(original,thread))return true;
   const published=visible(original,thread)?[original.text]:
    projectedSource(original.id)?.finalAnswers?.filter(part=>part.completed).map(part=>part.text)??[];
   if(source.kind==='message-file')return published.some(text=>messageFileDestination(text,source.destination,reference.kind==='image'));
   return published.some(text=>messageLinks(text).some(link=>link.url===source.url&&
    (source.kind!=='web'||link.id===source.sourceId&&link.title===source.title)));
  });
  return {...message,...(allowed.length?{resourceReferences:allowed}:{})};
 }
 const formal=db.prepare(`SELECT 1 FROM task_versions v JOIN operations o ON o.id=?
  WHERE v.taskId=? AND v.version=? AND o.state='confirmed' AND (o.kind='send_user_message' AND o.scopeId='user-messages'
   OR o.actorAgentId='host' AND o.kind IN ('worker_final','scheduled_final') AND o.scopeId=v.taskId
    AND json_extract(o.detailsJson,'$.taskVersion')=v.version)
  AND json_extract(o.responseJson,'$.messageId')=? AND
   (v.sourceRequestId IS NULL OR EXISTS (SELECT 1 FROM conversation_inputs c WHERE c.requestId=v.sourceRequestId AND c.threadId=?))`);
 const provenance=new Map(sources.related(messages.filter(m=>m.role==='assistant'&&m.threadId===thread&&m.revokedAt==null&&
  m.process?.threadId===thread)).map(m=>[m.id,m.taskSources??[]]));
 return messages.flatMap(m=>{
  if(m.threadId!==thread||m.revokedAt!=null)return [];
  if(m.role==='user')return userMatches(m)?[publicReferences(m)]:[];
  const input=inputFor(m),node=m.process;
  const checked=provenance.get(m.id)??[];
  const linked=!!input&&(referencesTask(input)||relatedAnswers.get(String(input.requestId))===input.id||
   sourceRequests.has(input.requestId)&&checked.some(source=>source.origin.kind==='activity'&&source.target.taskId===taskId))&&
   (input.replyId===m.id||m.id==='input-outcome:'+input.replyId||
    node?.threadId===thread&&node.sourceKind==='user'&&node.replyMessageId===input.replyId);
  const delivered=visible(m,thread)&&m.taskId===taskId&&m.taskVersion!=null&&!!m.operationKey&&
   !!formal.get(m.operationKey,taskId,m.taskVersion,m.id,thread);
  const confirmedWorker=visible(m,thread)&&m.status==='completed'&&node?.sourceKind==='worker'&&
   checked.some(source=>source.origin.kind==='message'&&source.origin.processId===node.id&&source.target.taskId===taskId);
  if(!linked&&!delivered&&!confirmedWorker)return [];
  const finals=node?.threadId===thread&&node.sourceKind==='user'?m.finalAnswers:undefined;
  if(!visible(m,thread)&&!finals?.length)return [];
  const {process:_process,source,sourceLabel:_sourceLabel,sourceMessageId:_sourceMessageId,toolActivities:_activities,finalAnswers:_finalAnswers,...publicMessage}=m;
  const body=finals?.length?finals.map(part=>part.text).join('\n\n'):visible(m,thread)?m.text:'';
  if(!body.trim()&&!m.attachments?.length)return [];
  return [publicReferences({...publicMessage,text:body,
   ...(!visible(m,thread)?{attachments:undefined,sources:undefined}:{}),
   ...(finals?.length?{finalAnswers:finals}:{}),
   ...(source&&userMatches(source)?{source:publicReferences(source)}:{})})];
 });
}

export function readTaskConversation(db:DatabaseSync,reader:WebHistoryPages,thread:string,epoch:string,request:HistoryPageRequest,sources:TaskSources){
 const {taskId,limit=40,before,after,around,range}=request;
 if(!taskId||!db.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId))throw Error('task_not_found');
 if(!Number.isSafeInteger(limit)||limit<1||limit>80||[before,after,around,range].filter(v=>v!==undefined).length>1)
  throw Error('history_request_invalid');
 const encode=(lower:number,upper=lower)=>Buffer.from(JSON.stringify([thread,epoch,taskId,lower,upper])).toString('base64url');
 function decode(token:string){
  let value:unknown;
  try{value=JSON.parse(Buffer.from(token,'base64url').toString('utf8'));}catch{throw Error('history_cursor_invalid');}
  if(!Array.isArray(value)||value.length!==5||value[0]!==thread||value[1]!==epoch||value[2]!==taskId||
     !Number.isSafeInteger(value[3])||!Number.isSafeInteger(value[4])||value[3]<0||value[4]<value[3])throw Error('history_cursor_invalid');
  return {lower:Number(value[3]),upper:Number(value[4])};
 }
 const fixed=range?decode(range):undefined;
 const forward=after!==undefined;
 let lower=fixed?.lower??(after?decode(after).lower+1:undefined);
 let upper=fixed?.upper??(before?decode(before).upper-1:undefined);
 let first:number|undefined,last:number|undefined,more=false;
 let result:ReturnType<WebHistoryPages['read']>;
 let messages:DisplayMessage[]=[];
 for(let attempt=0;;attempt++){
  result=reader.read(thread,{limit:fixed?120:Math.min(limit,40),around},false,{lower,upper,forward,refresh:!!fixed});
  const scan=result.scanned!;
  first=forward?(first??scan.first):(scan.first??first);
  last=forward?(scan.last??last):(last??scan.last);
  more=scan.more;
  messages=taskMessages(db,reader,thread,taskId,result.messages,sources);
  if(around){
   if(messages.some(m=>m.id===around))break;
   if(!result.messages.some(m=>m.id===around&&m.revokedAt==null&&(visible(m,thread)||m.finalAnswers?.length)))throw Error('history_message_not_found');
   throw Error('history_message_outside_task');
  }
  if(fixed&&more)throw Error('history_cursor_expired');
  if(fixed||messages.length||!more||attempt===2)break;
  if(forward)lower=scan.last!+1;
  else upper=scan.first!-1;
 }
 // Include the examined gaps, so a row which moves to a new position can
 // disappear from its old range and reappear on a subsequent forward read.
 const start=fixed?.lower??(forward&&after?decode(after).lower+1:!more&&!around?0:first??0);
 const end=fixed?.upper??(before?decode(before).upper-1:last??(after?decode(after).lower:0));
 const cursorEnd=Math.max(start,end);
 return {protocol:result.protocol,threadId:thread,revision:result.revision,
  messages,units:messages.map(m=>m.id),queue:[],orderWarning:undefined,before:!fixed&&!forward&&more&&first!==undefined?encode(first):null,
  after:forward&&more&&last!==undefined?encode(last):null,
  scope:{taskId,range:encode(start,cursorEnd),tail:encode(last??Math.max(0,end))}};
}
