import type {ConversationMessage} from './web-history.js';
import type {ProcessNode} from './main-process.js';
import type {QueuedInput} from './recursive-main-inputs.js';
import type {ChannelMessageSource} from './channel-plugin.js';

export type DisplayQueueInput=QueuedInput & {user:ConversationMessage;editable:boolean;statusText:string};
export type TaskMessageSource={key:string;target:import('./activity-facts.js').ActivityTarget;title:string;icon:import('./task-status.js').TaskSemanticIcon;origin:{kind:'activity';processId:string;itemId:string}|{kind:'message';processId:string;messageId:string;senderEpoch?:number};phaseLabel:string;owner:'main'|'worker'|'ended'|'unknown';originalRequestMessageId?:string};
export type DisplayMessage=ConversationMessage & {process?:ProcessNode;finalAnswers?:{id:string;text:string;completed:boolean}[];sourceLabel?:string;sourceMessageId?:string;source?:ConversationMessage;inputState?:string;taskSources?:TaskMessageSource[];taskSourceUnresolved?:true;channelSource?:ChannelMessageSource;interaction?:{id:string;kind:"authorization"|"question";title:string;description?:string;scope?:string;answers:{question?:string;text:string}[];unavailable?:true}};

export type ConversationBoundary={visibleIds:ReadonlySet<string>;requestsWithNodes:ReadonlySet<string>;outcomes:ReadonlySet<string>;legacyReplies:ReadonlySet<string>;nodeRequests:ReadonlyMap<string,string>;continuedNodes:ReadonlySet<string>};

// One non-persistent view of existing identities. History is already in SQLite
// insertion order. Inbox sequence never orders the formal conversation.
export function projectConversation(history:readonly ConversationMessage[],nodes:readonly ProcessNode[],inbox:readonly QueuedInput[],boundary?:ConversationBoundary){
 const byId=new Map(history.map(message=>[message.id,message]));
 const users=new Map(history.filter(message=>message.role==='user'&&message.requestId).map(message=>[message.requestId!,message]));
 const byInbox=new Map(inbox.map(item=>[item.messageId,item]));
 const byReply=new Map(inbox.map(item=>[item.replyId,item]));
 const byRequest=new Map(inbox.map(item=>[item.input.requestId,item]));
 const nodeByMessage=new Map(nodes.map(node=>[node.messageId,node]));
 const requestFor=(node:ProcessNode)=>boundary?.nodeRequests.get(node.id)??node.sourceMessageIds.map(id=>byInbox.get(id)?.input.requestId).find(Boolean)??(node.replyMessageId?byId.get(node.replyMessageId)?.requestId??byReply.get(node.replyMessageId)?.input.requestId:undefined);
 const requestsWithNodes=new Set([...boundary?.requestsWithNodes??[],...nodes.filter(node=>byId.has(node.messageId)&&node.sourceKind==='user').map(requestFor)]);
 const managedReplies=new Set(nodes.filter(node=>byId.has(node.messageId)).flatMap(node=>node.replyMessageId?[node.replyMessageId]:[]));
 const publicFinals=(node:ProcessNode)=>node.sourceKind==='user'?node.items.filter(item=>item.kind==='commentary'&&item.phase==='final_answer'):[];
 const finalReplies=new Set(nodes.filter(node=>node.replyPolicy==='explicitFinal'||node.final||publicFinals(node).length).map(node=>node.replyMessageId));
 const outcomes=new Set([...boundary?.outcomes??[],...history.filter(message=>message.id.startsWith('input-outcome:')).map(message=>message.requestId)]);
 const legacyReplies=new Set([...boundary?.legacyReplies??[],...history.filter(message=>message.role==='assistant'&&message.text&&!outcomes.has(message.requestId)&&!nodeByMessage.has(message.id)&&!managedReplies.has(message.id)&&!message.id.startsWith('input-outcome:')).map(message=>message.requestId)]);

 const queue:DisplayQueueInput[]=inbox.flatMap(item=>{
  const user=users.get(item.input.requestId);
  if(!user||requestsWithNodes.has(item.input.requestId)||legacyReplies.has(item.input.requestId)||!['queued','processing','uncertain'].includes(item.state))return [];
  return [{...item,user,editable:item.editable===true,statusText:item.state==='queued'?(item.editable===false?'发送状态待核对，无法编辑或取消':item.preparation==='preparing'?'附件准备中，等待送交主 Agent':'等待送交主 Agent'):item.state==='processing'?'已领取，正在送交；接收未确认':'接收结果未确认，未自动重跑'}];
 });
 const queuedRequests=new Set(queue.map(item=>item.input.requestId)),shownUsers=new Set<string>();
 const messages:DisplayMessage[]=[];let lastProcessSeq=0,orderWarning:string|undefined;
 for(const message of history){
  if(boundary&&!boundary.visibleIds.has(message.id))continue;
  const item=byRequest.get(message.requestId??'');
  if(message.role==='user'){
   if(requestsWithNodes.has(message.requestId??'')||queuedRequests.has(message.requestId??'')||item?.state==='cancelled'||outcomes.has(message.requestId))continue;
   messages.push({...message,...(item?{inputState:item.state}:{})});continue;
  }
  const node=nodeByMessage.get(message.id);
  if(node){
   if(node.seq<=lastProcessSeq)orderWarning='部分旧过程编号与原历史次序不同，当前按原历史位置展示。';
   lastProcessSeq=Math.max(lastProcessSeq,node.seq);
   const requestId=requestFor(node)??null,source=users.get(requestId??''),continuation=!!source&&(boundary?boundary.continuedNodes.has(node.id):shownUsers.has(source.id));
   if(node.sourceKind==='user'&&source&&!continuation){messages.push({...source,createdAt:message.createdAt,inputState:byRequest.get(requestId!)?.state});shownUsers.add(source.id);}
   const nativeFinal=node.sourceKind==='user'&&node.final&&node.final.id!==node.messageId?node.final:undefined;
   const finals=publicFinals(node).flatMap(item=>item.kind==='commentary'?[{id:item.id,text:item.text,completed:item.completed??(node.state==='worked'&&item.id===nativeFinal?.id)}]:[]);
   const hostFinal=node.final?.id===node.messageId?node.final:undefined;
   const displayNode={...node,final:nativeFinal??hostFinal};
   messages.push({...message,requestId,text:finals.length?finals.map(item=>item.text).join('\n\n'):(hostFinal||node.sourceKind!=='user'&&!node.final?message.text:''),status:node.status==='unknown'?'interrupted':node.status==='failed'?'failed':node.status==='interrupted'?'interrupted':node.state==='working'?'running':'completed',process:displayNode,...(finals.length?{finalAnswers:finals}:{}),
    ...(continuation&&source?{sourceMessageId:source.id}:{}),
    sourceLabel:node.sourceKind==='worker'?'处理协作结果':node.sourceKind==='scheduled'?'定时消息':!source?'处理来源未关联':continuation?'继续处理：'+(source!.text.slice(0,80)||'附件请求'):undefined,toolActivities:[]});continue;
  }
  // Keep a historical host reply at its original identity when no segment has
  // a final; it may be the only public answer for that request.
  if(message.operationKey&&message.audience==='user'){messages.push(message);continue;}
  if(message.audience==='internal')continue;
  if(managedReplies.has(message.id)&&(message.status==='running'||finalReplies.has(message.id)))continue;
  if(item?.replyId===message.id&&(queuedRequests.has(item.input.requestId)||item.state==='cancelled'||outcomes.has(item.input.requestId)||!message.text))continue;
  const source=message.requestId?users.get(message.requestId):undefined;
  messages.push({...message,...(message.id.startsWith('input-outcome:')&&source?{sourceMessageId:source.id,sourceLabel:'送交结果：'+(source.text.slice(0,80)||'附件请求'),...(!queuedRequests.has(source.requestId!)&&!requestsWithNodes.has(source.requestId!)?{source}:{})}:{})});
 }
 return {messages,queue,orderWarning};
}
