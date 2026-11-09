import type {DatabaseSync} from 'node:sqlite';
import {activityOutcomes,publicActivityName} from './activity-facts.js';
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
 const notices=new Map(batch(`SELECT m.id,m.taskId,m.taskVersion,m.senderAgentId,m.senderRunId,m.senderEpoch,m.kind,o.actorAgentId,o.kind AS operationKind,o.state AS operationState,o.scopeId FROM agent_messages m JOIN agent_receipts ar ON ar.messageId=m.id AND ar.recipientAgentId=m.recipientAgentId JOIN operations o ON o.id=m.operationKey WHERE m.id IN ($keys) AND m.targetRunId IS NULL AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId')`,sourceIds).map(row=>[row.id,row]));
 const actions=eligible.flatMap(m=>m.process?.threadId===threadId?m.process.items.flatMap(i=>i.kind==='tool'&&i.activity?.target&&!i.activity.action.startsWith('inspect_')?[{node:m.process,item:i,activity:i.activity}]:[]):[]);
 const operations=new Map(batch(`SELECT id,actorAgentId,scopeId,kind,state,json_extract(responseJson,'$.taskId') AS createdTaskId FROM operations WHERE id IN ($keys)`,[...new Set(actions.flatMap(a=>a.activity.target?.operationKey?[a.activity.target.operationKey]:[]))]).map(o=>[o.id,o]));
 const runIds=[...new Set([...notices.values()].flatMap(n=>typeof n.senderRunId==='string'?[n.senderRunId]:[]).concat(actions.flatMap(a=>a.activity.target?.runId?[a.activity.target.runId]:[])))];
 const runs=new Map(batch('SELECT id,taskId,version,epoch FROM runs WHERE id IN ($keys)',runIds).map(r=>[r.id,r]));
 const targets=[...notices.values()].map(n=>[n.taskId,n.taskVersion]).concat(actions.map(a=>[a.activity.target!.taskId,a.activity.target!.version]));
 const keys=[...new Set(targets.filter(([id,version])=>typeof id==='string'&&Number.isSafeInteger(version)).map(pair=>JSON.stringify(pair)))];
 const versions=new Map<string,Record<string,any>>();
 for(let at=0;at<keys.length;at+=200){
  const rows=db.prepare(`SELECT v.taskId,v.version,t.title,c.id AS sourceMessageId FROM json_each(?) k JOIN task_versions v ON v.taskId=json_extract(k.value,'$[0]') AND v.version=json_extract(k.value,'$[1]') JOIN tasks t ON t.id=v.taskId JOIN conversation_inputs i ON i.requestId=v.sourceRequestId AND i.threadId=? LEFT JOIN conversation_messages c ON c.threadId=i.threadId AND c.requestId=i.requestId AND c.role='user'`).all('['+keys.slice(at,at+200).join(',')+']',threadId);
  for(const row of rows){const key=JSON.stringify([row.taskId,row.version]),old=versions.get(key);versions.set(key,old?{...old,sourceMessageId:null}:row);}
 }
 const main=db.prepare("SELECT value FROM meta WHERE key='mainAgentId'").get()?.value;
 const out=new Map<string,TaskMessageSource[]>(),unresolved=new Set<string>(),seen=new Set<string>();
 const push=(id:string,source:TaskMessageSource)=>{
  const v=versions.get(JSON.stringify([source.target.taskId,source.target.version]));if(!v){unresolved.add(id);return;}
  const run=source.target.runId?runs.get(source.target.runId):undefined;
  if(source.target.runId&&(!run||run.taskId!==source.target.taskId||run.version!==source.target.version)){unresolved.add(id);return;}
  if(seen.has(source.key))return;seen.add(source.key);
  const list=out.get(id)??[];list.push({...source,title:publicActivityName(v.title)??'后台工作',...(v.sourceMessageId?{originalRequestMessageId:v.sourceMessageId}:{})});out.set(id,list);
 };
 for(const message of eligible){
  const node=message.process?.threadId===threadId?message.process:undefined;
  const events=node?.items.flatMap(i=>i.kind==='workerEvent'&&i.event?[i.event]:[])??[];
  const eventMessages=new Set(events.map(e=>e.sourceMessageId)),eventOperations=new Set(events.map(e=>e.operationKey));
  if(node?.sourceKind==='worker'&&node.turnIds.length)for(const id of node.sourceMessageIds){
   if(eventMessages.has(id))continue;
   const notice=notices.get(id),run=notice?.senderRunId?runs.get(notice.senderRunId):undefined;
   if(!notice||notice.senderAgentId!=='host'||notice.actorAgentId!=='host'||notice.operationState!=='confirmed'||notice.scopeId!==notice.taskId||!['worker_return','notify'].includes(notice.operationKind)||notice.kind==='worker_reply'&&(!run||run.taskId!==notice.taskId||run.version!==notice.taskVersion||notice.senderEpoch==null||notice.senderEpoch>run.epoch)){unresolved.add(message.id);continue;}
   push(message.id,{key:JSON.stringify([threadId,node.id,id]),target:{taskId:notice.taskId,version:notice.taskVersion,...(run?{runId:run.id}:{})},title:'',icon:notice.kind==='worker_reply'?'MessagesSquare':'Inbox',origin:{kind:'message',processId:node.id,messageId:id},phaseLabel:notice.kind==='worker_reply'?'收到 Worker 回复':notice.kind==='task_archived'?'事项已归档':'主 Agent 协作事项',owner:'main'});
  }
  for(const action of actions.filter(a=>a.node?.id===node?.id)){
   const target=action.activity.target!,operation=operations.get(target.operationKey);
   if(eventOperations.has(target.operationKey??null))continue;
   if(!operation||operation.actorAgentId!==main||!(operation.scopeId===target.taskId||['task_create','worker_open'].includes(operation.kind)&&operation.createdTaskId===target.taskId)||!({create_task:['task_create','worker_open'],update_task:['task_update'],stop_task:['worker_stop']} as Record<string,string[]>)[action.activity.action]?.includes(operation.kind)){unresolved.add(message.id);continue;}
   push(message.id,{key:JSON.stringify([threadId,node!.id,action.item.id]),target,title:'',icon:action.activity.action==='create_task'?'Send':'CornerDownRight',origin:{kind:'activity',processId:node!.id,itemId:action.item.id},phaseLabel:activityOutcomes[action.activity.outcome],owner:'main'});
  }
 }
 return messages.map(m=>({...m,...(out.has(m.id)?{taskSources:out.get(m.id)}:{}),...(unresolved.has(m.id)?{taskSourceUnresolved:true as const}:{})}));
}
import { readTaskOverview, readTaskDetail, readTaskSummary } from './task-overview.js';
import { projectQuestions } from './question-schema.js';
import {revealAttachmentFile} from './artifact-reveal.js';
import type { Homer } from "./service.js";
import type { WebBridge,DispatchQueuePage,WebArtifact,MessageAttachment } from "./web-contract.js";

export function homerWebBridge(app: Homer,{draftUpload=true}:{draftUpload?:boolean}={}): WebBridge {
  app.registerWebSurface(draftUpload);
  const files=(messages:readonly import('./web-history.js').ConversationMessage[]):WebArtifact[]=>messages.flatMap(message=>{
    if(message.role!=='assistant'||message.audience!=='user'||message.revokedAt!=null||message.status!=='completed')return [];
    return (message.attachments??[]).flatMap(ref=>{
      const asset=app.media.asset(ref);
      if(!app.media.originalAvailable(asset)||!asset.hash)return [];
      return [{...ref,id:JSON.stringify([message.id,ref.assetId,ref.revision]),messageId:message.id,
        title:asset.filename,sha256:asset.hash}];
    });
  });
  const taskFiles=(id:string)=>{
    const thread=app.store.meta('mainThread')!;
    const rows=app.store.db.prepare(`SELECT m.id FROM conversation_messages m JOIN conversation_attachments a ON a.messageId=m.id
      WHERE m.threadId=? AND m.taskId=? AND m.role='assistant' AND m.audience='user' AND m.revokedAt IS NULL AND m.status='completed'
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
    return {...result,artifacts,inactiveInteractions,inactiveMore,messages:withTaskSources(app.store.db,result.messages,result.threadId).map(message=>({...message,...(message.process?{process:message.process}:{}),...(message.attachments?{media:message.attachments.map(ref=>app.media.view(ref))}:{}),...(message.source?.attachments?{source:{...message.source,media:message.source.attachments.map(ref=>app.media.view(ref))}}:{})}))};
  };
  const queuePage=(after=0)=>{const page=pageReader().queuePage(after);return {...page,items:page.items.map(item=>({...item,user:{...item.user,...(item.user.attachments?{media:item.user.attachments.map(ref=>app.media.view(ref))}:{})}}))};};
  const interactionPage=(after=0)=>{
    if(!Number.isSafeInteger(after)||after<0)throw Error('history_cursor_invalid');
    const rows=app.store.db.prepare("SELECT id,rowid position FROM worker_interactions WHERE state='pending_user' AND responseUserMessageId IS NULL AND rowid>? ORDER BY rowid LIMIT 81").all(after),selected=rows.slice(0,80);
    const facts=new Map(selected.length?app.store.db.prepare(`SELECT i.id,t.title,(SELECT id FROM conversation_messages c WHERE c.threadId=? AND c.requestId=json_extract(i.authority,'$.sourceRequestId') AND c.role='user' ORDER BY c.rowid DESC LIMIT 1) sourceMessageId
      FROM worker_interactions i LEFT JOIN runs r ON r.id=CASE WHEN i.runId LIKE 'main-native:worker-native:%' THEN substr(i.runId,27) ELSE i.runId END LEFT JOIN tasks t ON t.id=r.taskId WHERE i.id IN (${selected.map(()=>'?').join(',')})`).all(app.store.meta('mainThread')!,...selected.map(row=>String(row.id))).map(row=>[String(row.id),row]):[]);
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
        const requestId=message.requestId??app.store.db.prepare('SELECT requestId FROM web_process_ids WHERE threadId=? AND messageId=?').get(thread,input.id)?.requestId;
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
        queueDispatch:app.inputs.dispatchSummary(),features:{draftUpload,taskOverview:true,workerExecution:1,workerEventCards:1,queueDispatch:1,queueSources:1,nativeQuestionAnswers:1,previewReferences:1,previewReferenceCollections:2},upgrade:{phase:'running'},
        history:{protocol:3,readEpoch:app.webReadEpoch,page:pageInfo,moreQueue:queue.after,moreInteractions:pending.after}};
        };
        return app.receptionTimings?app.receptionTimings.measure('state_history',build):build();
      },
    },
    onStateChange: listener=>app.onStateChange(listener),
    taskOverview:{
      execution:async(selector,before)=>app.readWorkerExecution(selector,before),
      call:async(selector,key)=>app.readWorkerCall(selector,key),
      list:async()=>({...readTaskOverview(app.store.db),progressRevision:app.workerProgress.revision}),
      progress:async id=>{
        const db=app.store.db;
        if(!db.prepare("SELECT id FROM tasks WHERE id=? AND historyState='visible'").get(id))throw Error('task_not_found');
        const scopes=db.prepare(`SELECT r.taskId,r.version,r.id AS runId,r.epoch,r.threadId,r.turnId FROM runs r WHERE r.taskId=? AND r.threadId IS NOT NULL AND r.turnId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runs next WHERE next.workerId=r.workerId AND next.rowid>r.rowid)`).all(id) as import('./worker-progress.js').WorkerScope[];
        return {taskId:id,workers:scopes.flatMap(scope=>{const progress=app.workerProgress.get(scope);return progress?[progress]:[];})};
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
        return {...detail,...taskFiles(id)};
      },
      origin:async(id,messageId)=>{
        if(!/^[\w:-]{1,100}$/.test(id)||!/^[\w:-]{1,100}$/.test(messageId))throw Error('task_origin_not_found');
        const source=app.store.db.prepare(`SELECT c.id FROM task_versions v JOIN conversation_inputs input ON input.requestId=v.sourceRequestId JOIN conversation_messages c ON c.threadId=input.threadId AND c.requestId=input.requestId AND c.role='user' WHERE v.taskId=? AND c.id=? LIMIT 1`).get(id,messageId);
        const message=app.history.message(messageId);
        if(!message||message.threadId!==app.store.meta('mainThread')||message.revokedAt!=null||
          !(source&&message.role==='user')&&!(message.taskId===id&&message.role==='assistant'&&message.audience==='user'))throw Error('task_origin_not_found');
        return {message,files:files([message])};
      }
    },
    media:{read:async input=>app.readAttachment(input),origin,reveal:input=>revealAttachmentFile(app.revealAttachment(input)),...(draftUpload?{upload:(input:import('./web-upload.js').WebUpload)=>app.uploadAttachment(input),discard:async(input:unknown)=>app.discardAttachment(input),previewDraft:async(input:unknown)=>app.readDraftImage(input)}:{})},
    submit: async input => app.submitMessage(input),
    queue:{edit:async input=>app.editQueued(input),cancel:async input=>app.cancelQueued(input),move:async input=>app.moveQueued(input),interrupt:async(input,target)=>app.submitMessage(input,undefined,target)},
    stop: id => app.stopMain(id),
    feedback: async (id, value) => app.history.feedback(app.store.meta('mainThread')!, id, value),
    respond: async (id, input) => app.submitMessage({ ...input, interactionId: id }),
  };
}
