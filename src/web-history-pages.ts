import {DatabaseSync} from 'node:sqlite';
import type {ConversationHistory} from './web-history.js';
import type {MainProcessHistory,ProcessNode} from './main-process.js';
import type {MainInputs} from './recursive-main-inputs.js';
import {projectConversation,type ConversationBoundary} from './conversation-projection.js';
import type {ChannelPlugin} from './channel-plugin.js';
export type HistoryPageRequest={limit?:number;before?:string;after?:string;around?:string};
type Identity={id:string;threadId:string;messageId:string;replyId:string|null;requestId:string|null;sourceKind:string;position:number|null};
const processPrefix='publicMainNode:v1:';
const marks=(ids:readonly unknown[])=>ids.map(()=>'?').join(',');
function historyPredicates(){
  const hasUserNode=(m:string)=>`EXISTS(SELECT 1 FROM web_process_ids p WHERE p.threadId=${m}.threadId AND p.requestId=${m}.requestId AND p.sourceKind='user' AND p.position IS NOT NULL)`;
  const outcome=(m:string)=>`EXISTS(SELECT 1 FROM conversation_messages o WHERE o.threadId=${m}.threadId AND o.requestId=${m}.requestId AND o.id GLOB 'input-outcome:*')`;
  const legacy=(m:string)=>`(EXISTS(SELECT 1 FROM web_legacy_ids l WHERE l.threadId=${m}.threadId AND l.requestId=${m}.requestId) AND NOT ${outcome(m)})`;
  const inbox=(m:string,state:string)=>`EXISTS(SELECT 1 FROM agent_messages a JOIN agent_receipts r ON r.messageId=a.id WHERE a.kind='user_input' AND a.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND json_extract(a.payloadJson,'$.requestId')=${m}.requestId AND ${state})`;
  const queued=(m:string)=>`(${inbox(m,"r.state IN ('pending','offered','received','uncertain')")} AND NOT ${hasUserNode(m)} AND NOT ${legacy(m)})`;
  const cancelled=(m:string)=>inbox(m,"r.state NOT IN ('pending','offered','received','uncertain') AND json_extract(a.payloadJson,'$.terminal')='cancelled'");
  const formal=`((m.audience='user' AND m.operationKey IS NOT NULL) OR EXISTS(SELECT 1 FROM web_process_ids p WHERE p.threadId=m.threadId AND p.messageId=m.id)
   OR (m.role='user' AND NOT ${hasUserNode('m')} AND NOT ${queued('m')} AND NOT ${cancelled('m')} AND NOT ${outcome('m')})
   OR (m.role='assistant' AND NOT (EXISTS(SELECT 1 FROM web_process_ids p WHERE p.threadId=m.threadId AND p.replyId=m.id AND p.position IS NOT NULL) AND (m.status='running' OR EXISTS(SELECT 1 FROM web_process_ids f WHERE f.threadId=m.threadId AND f.replyId=m.id AND f.hasFinal=1)))
    AND NOT (${inbox('m',"EXISTS(SELECT 1 FROM conversation_inputs i WHERE i.requestId=m.requestId AND i.replyId=m.id)")} AND (${queued('m')} OR ${cancelled('m')} OR ${outcome('m')} OR m.text=''))))`;
 return {formal,outcome,legacy};
}
// These TEMP structures contain identities/relations only. Main DB schema,
// body, task status, native state and grants remain solely in their owners.
// One locked service connection owns their complete lifetime. Older programs
// cannot leave a stale persistent index: closing the connection destroys it.
export class WebHistoryPages{
 readonly initialization:{version:1;nodes:number;ms:number;batches:number};
 private get db(){return this.history.db;}
 constructor(private history:ConversationHistory,private processes:MainProcessHistory,private inputs:MainInputs,private channels?:Pick<ChannelPlugin,'readMessageSources'>){
  const start=performance.now(),db=this.db;
  // DDL for TEMP read indexes is deliberately outside business change observers.
  // One savepoint prevents a partially installed trigger set on initialization failure.
  const execute=(sql:string)=>DatabaseSync.prototype.exec.call(db,sql);
  execute('SAVEPOINT web_history_reader_initialize');
  try{
  execute(`CREATE TEMP TABLE IF NOT EXISTS web_formal_ids(id TEXT PRIMARY KEY,threadId TEXT,position INTEGER);
    CREATE INDEX IF NOT EXISTS temp.web_formal_order ON web_formal_ids(threadId,position);
    CREATE TEMP TABLE IF NOT EXISTS web_legacy_ids(id TEXT PRIMARY KEY,threadId TEXT,requestId TEXT);
    CREATE INDEX IF NOT EXISTS temp.web_legacy_request ON web_legacy_ids(threadId,requestId);
    CREATE TEMP TABLE IF NOT EXISTS web_process_ids(id TEXT PRIMARY KEY,threadId TEXT,messageId TEXT,replyId TEXT,requestId TEXT,sourceKind TEXT,position INTEGER,hasFinal INTEGER);
    CREATE INDEX IF NOT EXISTS temp.web_process_message ON web_process_ids(threadId,messageId);
    CREATE INDEX IF NOT EXISTS temp.web_process_request ON web_process_ids(threadId,requestId,sourceKind,position);
    CREATE INDEX IF NOT EXISTS temp.web_process_reply ON web_process_ids(threadId,replyId,position);
    CREATE TEMP TABLE IF NOT EXISTS web_process_workers(nodeId TEXT,taskId TEXT,PRIMARY KEY(nodeId,taskId));
    CREATE INDEX IF NOT EXISTS temp.web_process_task ON web_process_workers(taskId,nodeId);
    CREATE TEMP TABLE IF NOT EXISTS web_dirty_tasks(taskId TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS web_active_inputs(messageId TEXT PRIMARY KEY,seq INTEGER);
    CREATE INDEX IF NOT EXISTS temp.web_active_order ON web_active_inputs(seq);
    CREATE TEMP TABLE IF NOT EXISTS web_read_revision(id INTEGER PRIMARY KEY,revision INTEGER);
    INSERT OR IGNORE INTO web_read_revision VALUES(1,0);`);
  const {formal}=historyPredicates();
  const refreshLegacy=(ids:string)=>`DELETE FROM web_legacy_ids WHERE id IN (${ids});
    INSERT INTO web_legacy_ids SELECT m.id,m.threadId,m.requestId FROM conversation_messages m WHERE m.id IN (${ids}) AND m.role='assistant' AND m.text!='' AND m.id NOT GLOB 'input-outcome:*'
    AND NOT EXISTS(SELECT 1 FROM web_process_ids p WHERE p.threadId=m.threadId AND p.messageId=m.id)
    AND NOT EXISTS(SELECT 1 FROM web_process_ids p WHERE p.threadId=m.threadId AND p.replyId=m.id AND p.position IS NOT NULL);`;
  const refreshFormal=(ids:string)=>`DELETE FROM web_formal_ids WHERE id IN (${ids});INSERT INTO web_formal_ids SELECT m.id,m.threadId,m.rowid FROM conversation_messages m WHERE m.id IN (${ids}) AND ${formal};`;
  const front=(request:string)=>`SELECT id FROM conversation_messages WHERE requestId=${request} AND role='user' UNION SELECT replyId FROM conversation_inputs WHERE requestId=${request}`;
  const nodeIds=(value:string)=>`SELECT json_extract(${value},'$.messageId') UNION SELECT json_extract(${value},'$.replyMessageId')`;
  const indexNode=(value:string)=>`INSERT OR REPLACE INTO web_process_ids SELECT json_extract(${value},'$.id'),json_extract(${value},'$.threadId'),json_extract(${value},'$.messageId'),json_extract(${value},'$.replyMessageId'),
    coalesce((SELECT json_extract(a.payloadJson,'$.requestId') FROM json_each(${value},'$.sourceMessageIds') s JOIN agent_messages a ON a.id=s.value WHERE a.kind='user_input' ORDER BY cast(s.key AS INTEGER) LIMIT 1),
    (SELECT requestId FROM conversation_messages WHERE id=json_extract(${value},'$.replyMessageId'))),json_extract(${value},'$.sourceKind'),
    (SELECT rowid FROM conversation_messages WHERE id=json_extract(${value},'$.messageId')),CASE WHEN json_extract(${value},'$.replyPolicy')='explicitFinal' OR json_type(${value},'$.final')='object' OR (json_extract(${value},'$.sourceKind')='user' AND EXISTS(SELECT 1 FROM json_each(${value},'$.items') item WHERE json_extract(item.value,'$.kind')='commentary' AND json_extract(item.value,'$.phase')='final_answer')) THEN 1 ELSE 0 END;`;
  // Triggers execute in the original write transaction, including rollback.
  // Revision is a read invalidation fence, never a Run/version or stop target.
  const updateNode=`DELETE FROM web_process_workers WHERE nodeId=json_extract(new.value,'$.id');DELETE FROM web_process_ids WHERE id=json_extract(new.value,'$.id');${indexNode('new.value')}
    INSERT INTO web_process_workers SELECT DISTINCT json_extract(new.value,'$.id'),json_extract(j.value,'$.taskId') FROM json_each(new.value,'$.items') j WHERE json_extract(j.value,'$.kind')='worker';${refreshLegacy(nodeIds('new.value'))}${refreshFormal(nodeIds('new.value'))}${refreshFormal(front("(SELECT requestId FROM web_process_ids WHERE id=json_extract(new.value,'$.id'))"))}`;
  for(const event of ['INSERT','UPDATE'])execute(`CREATE TEMP TRIGGER IF NOT EXISTS web_meta_${event.toLowerCase()} AFTER ${event} ON main.meta WHEN new.key GLOB '${processPrefix}*' BEGIN ${updateNode}
    ${event==='UPDATE'?`${refreshLegacy(nodeIds('old.value'))}${refreshFormal(nodeIds('old.value'))}${refreshFormal(front("coalesce((SELECT json_extract(a.payloadJson,'$.requestId') FROM json_each(old.value,'$.sourceMessageIds') s JOIN agent_messages a ON a.id=s.value WHERE a.kind='user_input' ORDER BY cast(s.key AS INTEGER) LIMIT 1),(SELECT requestId FROM conversation_messages WHERE id=json_extract(old.value,'$.replyMessageId')))"))}`:''}UPDATE web_read_revision SET revision=revision+1; END;`);
  execute(`CREATE TEMP TRIGGER IF NOT EXISTS web_meta_delete AFTER DELETE ON main.meta WHEN old.key GLOB '${processPrefix}*' BEGIN
    DELETE FROM web_process_workers WHERE nodeId=json_extract(old.value,'$.id');DELETE FROM web_process_ids WHERE id=json_extract(old.value,'$.id');${refreshLegacy(nodeIds('old.value'))}${refreshFormal(nodeIds('old.value'))}${refreshFormal(front("(SELECT requestId FROM conversation_messages WHERE id=json_extract(old.value,'$.replyMessageId'))"))}UPDATE web_read_revision SET revision=revision+1;END;`);
  for(const event of ['INSERT','UPDATE','DELETE']){
   const ref=event==='DELETE'?'old':'new';
   execute(`CREATE TEMP TRIGGER IF NOT EXISTS web_history_${event.toLowerCase()} AFTER ${event} ON main.conversation_messages BEGIN
    ${event==='INSERT'?`UPDATE web_process_ids SET position=new.rowid WHERE messageId=new.id;`:event==='DELETE'?`UPDATE web_process_ids SET position=NULL WHERE messageId=old.id;`:''}
    ${refreshLegacy(`SELECT ${ref}.id UNION SELECT replyId FROM web_process_ids WHERE messageId=${ref}.id`)}
    ${refreshFormal(`SELECT ${ref}.id UNION SELECT replyId FROM web_process_ids WHERE messageId=${ref}.id`)}
    ${refreshFormal(front(`coalesce(${ref}.requestId,(SELECT requestId FROM web_process_ids WHERE messageId=${ref}.id))`))}
    UPDATE web_read_revision SET revision=revision+1;END;`);
   for(const table of ['tasks','runs'])execute(`CREATE TEMP TRIGGER IF NOT EXISTS web_dirty_${table}_${event.toLowerCase()} AFTER ${event} ON main.${table} BEGIN
    INSERT INTO web_dirty_tasks SELECT ${ref}.${table==='tasks'?'id':'taskId'} WHERE ${ref}.${table==='tasks'?'id':'taskId'} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM web_dirty_tasks WHERE taskId=${ref}.${table==='tasks'?'id':'taskId'});UPDATE web_read_revision SET revision=revision+1;END;`);
  }
  for(const table of ['worker_interactions','conversation_feedback','conversation_attachments','media_assets','media_derivatives']){
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
   for(const event of ['INSERT','UPDATE','DELETE'])execute(`CREATE TEMP TRIGGER IF NOT EXISTS web_revision_${table}_${event.toLowerCase()} AFTER ${event} ON main.${table} BEGIN UPDATE web_read_revision SET revision=revision+1;END;`);
  }
  for(const table of ['agent_messages','agent_receipts'])for(const event of ['INSERT','UPDATE','DELETE']){
   const ref=event==='DELETE'?'old':'new';
   const request=table==='agent_messages'?`json_extract(${ref}.payloadJson,'$.requestId')`:`(SELECT json_extract(payloadJson,'$.requestId') FROM agent_messages WHERE id=${ref}.messageId)`;
   const message=table==='agent_messages'?`${ref}.id`:`${ref}.messageId`;
   execute(`CREATE TEMP TRIGGER IF NOT EXISTS web_front_${table}_${event.toLowerCase()} AFTER ${event} ON main.${table} BEGIN
    DELETE FROM web_active_inputs WHERE messageId=${message};INSERT INTO web_active_inputs SELECT m.id,m.seq FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.id=${message} AND m.kind='user_input' AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND r.state IN ('pending','offered','received','uncertain');
    ${refreshFormal(front(request))} UPDATE web_read_revision SET revision=revision+1;END;`);
  }
  execute(`CREATE INDEX IF NOT EXISTS conversation_insert_order ON conversation_messages(threadId);
    CREATE INDEX IF NOT EXISTS main_input_request_identity ON agent_messages(recipientAgentId,json_extract(payloadJson,'$.requestId')) WHERE kind='user_input';
    CREATE INDEX IF NOT EXISTS conversation_request_identity ON conversation_messages(requestId,role);
    CREATE INDEX IF NOT EXISTS conversation_outcome_identity ON conversation_messages(threadId,requestId) WHERE id GLOB 'input-outcome:*';
    CREATE INDEX IF NOT EXISTS web_interaction_state ON worker_interactions(state);
    CREATE INDEX IF NOT EXISTS web_interaction_response ON worker_interactions(responseUserMessageId);
    CREATE INDEX IF NOT EXISTS web_interaction_source ON worker_interactions(json_extract(authority,'$.sourceRequestId'),state);`);
  // Explicit bounded batches for the one-time O(total) identity reconstruction.
  // No body copies or JS process JSON parsing. Not charged as a page read.
  let last='',nodes=0,batches=0;
  for(;;){
   const keys=db.prepare("SELECT key FROM meta WHERE key>? AND key GLOB 'publicMainNode:v1:*' ORDER BY key LIMIT 250").all(last) as {key:string}[];
   if(!keys.length)break;
   execute('SAVEPOINT web_index_batch');try{
    for(const {key} of keys){
     // Bind once through a CTE; statements contain only trusted SQL identifiers.
     db.prepare(`WITH source(value) AS (SELECT value FROM meta WHERE key=?) ${indexNode('(SELECT value FROM source)')}`).run(key);
     db.prepare(`INSERT OR IGNORE INTO web_process_workers SELECT json_extract(m.value,'$.id'),json_extract(j.value,'$.taskId') FROM meta m,json_each(m.value,'$.items') j WHERE m.key=? AND json_extract(j.value,'$.kind')='worker'`).run(key);
    }
    execute('RELEASE web_index_batch');
   }catch(error){execute('ROLLBACK TO web_index_batch;RELEASE web_index_batch');throw error;}
   nodes+=keys.length;batches++;last=keys.at(-1)!.key;
  }
  execute(`DELETE FROM web_legacy_ids;${refreshLegacy('SELECT id FROM conversation_messages')}DELETE FROM web_formal_ids;INSERT INTO web_formal_ids SELECT m.id,m.threadId,m.rowid FROM conversation_messages m WHERE ${formal};DELETE FROM web_dirty_tasks;
    DELETE FROM web_active_inputs;INSERT INTO web_active_inputs SELECT m.id,m.seq FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='user_input' AND m.recipientAgentId=(SELECT value FROM meta WHERE key='mainAgentId') AND r.state IN ('pending','offered','received','uncertain');`);
  this.initialization={version:1,nodes,batches,ms:performance.now()-start};
  execute('RELEASE web_history_reader_initialize');
  }catch(error){execute('ROLLBACK TO web_history_reader_initialize;RELEASE web_history_reader_initialize');throw error;}
 }
 get revision(){return Number(this.db.prepare('SELECT revision FROM web_read_revision WHERE id=1').get()!.revision);}
 private cursor(threadId:string,anchor:string){return Buffer.from(JSON.stringify({v:1,threadId,anchor})).toString('base64url');}
 private position(threadId:string,id:string){
  const row=this.db.prepare('SELECT rowid position FROM conversation_messages WHERE threadId=? AND id=?').get(threadId,id);
  if(!row)throw Error('history_message_not_found');return Number(row.position);
 }
 private anchor(threadId:string,cursor:string){
  if(cursor.length>600)throw Error('history_cursor_invalid');
  let value;try{value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{throw Error('history_cursor_invalid');}
  if(value?.v!==1||value.threadId!==threadId||typeof value.anchor!=='string'||value.anchor.length>100)throw Error('history_cursor_invalid');
  try{return this.position(threadId,value.anchor);}catch{throw Error('history_cursor_expired');}
 }
 // Indexed identity relations let the original owner expose boundary facts.
 // A local page is never asked to infer that outside records do not exist.
 read(threadId:string,request:HistoryPageRequest={},details=false){
  const limit=request.limit??40;
  if(!Number.isSafeInteger(limit)||limit<1||limit>80)throw Error('history_limit_invalid');
  if([request.before,request.after,request.around].filter(x=>x!==undefined).length>1)throw Error('history_direction_invalid');
  let position:number|undefined,inclusive=false;
  if(request.before)position=this.anchor(threadId,request.before);
  if(request.after)position=this.anchor(threadId,request.after);
  if(request.around){
   const original=this.db.prepare('SELECT id,role,requestId FROM conversation_messages WHERE threadId=? AND id=?').get(threadId,request.around);if(!original)throw Error('history_message_not_found');
   const retained=original.role==='assistant'&&this.db.prepare('SELECT 1 FROM web_formal_ids WHERE threadId=? AND id=?').get(threadId,String(original.id));
   const owner=original.role==='user'
    ?this.db.prepare("SELECT messageId FROM web_process_ids WHERE threadId=? AND requestId=? AND sourceKind='user' AND position IS NOT NULL ORDER BY position LIMIT 1").get(threadId,original.requestId??null)
    :retained?undefined:this.db.prepare('SELECT messageId FROM web_process_ids WHERE threadId=? AND messageId=? AND position IS NOT NULL LIMIT 1').get(threadId,String(original.id))
      ??this.db.prepare('SELECT messageId FROM web_process_ids WHERE threadId=? AND replyId=? AND position IS NOT NULL ORDER BY position DESC LIMIT 1').get(threadId,String(original.id));
   position=this.position(threadId,owner?String(owner.messageId):String(original.id));inclusive=true;
  }
  const direction=request.after?'ASC':'DESC',comparison=request.after?'>':inclusive?'<=':'<';

  // The thread-only index preserves rowid order; no timestamp sort or OFFSET.
  const sql=`SELECT u.id,u.position,m.requestId FROM web_formal_ids u JOIN conversation_messages m ON m.id=u.id WHERE u.threadId=? ${position===undefined?'':`AND u.position${comparison}?`} ORDER BY u.position ${direction} LIMIT ?`;
  const bindings=[threadId,...(position===undefined?[]:[position]),limit+1];
  const found=this.db.prepare(sql).all(...bindings) as {id:string;position:number;requestId:string|null}[];
  const more=found.length>limit,selected=found.slice(0,limit);if(!request.after)selected.reverse();
  const selectedIds=selected.map(row=>row.id),nodeRows=selectedIds.length?this.db.prepare(`SELECT * FROM web_process_ids WHERE threadId=? AND messageId IN (${marks(selectedIds)})`).all(threadId,...selectedIds) as Identity[]:[];
  const nodes=this.processes.headers(nodeRows.map(row=>row.id),details);
  const requests=[...new Set([...selected.flatMap(row=>row.requestId?[row.requestId]:[]),...nodeRows.flatMap(row=>row.requestId?[row.requestId]:[])])];
  const boundary:ConversationBoundary={visibleIds:new Set(selectedIds),requestsWithNodes:new Set(),outcomes:new Set(),legacyReplies:new Set(),nodeRequests:new Map(nodeRows.flatMap(n=>n.requestId?[[n.id,n.requestId] as const]:[])),continuedNodes:new Set()};
  const requestsWithNodes=boundary.requestsWithNodes as Set<string>,outcomes=boundary.outcomes as Set<string>,legacyReplies=boundary.legacyReplies as Set<string>,continuedNodes=boundary.continuedNodes as Set<string>;
  const related=new Set(selectedIds);
  if(requests.length){
   const facts=this.db.prepare(`SELECT i.requestId,i.replyId,
    (SELECT messageId FROM web_process_ids WHERE threadId=i.threadId AND requestId=i.requestId AND sourceKind='user' AND position IS NOT NULL ORDER BY position LIMIT 1) firstProcess,
    (SELECT id FROM conversation_messages WHERE threadId=i.threadId AND requestId=i.requestId AND role='user' ORDER BY rowid DESC LIMIT 1) userId,
    EXISTS(SELECT 1 FROM conversation_messages m WHERE m.threadId=i.threadId AND m.requestId=i.requestId AND m.id GLOB 'input-outcome:*') hasOutcome,
    (EXISTS(SELECT 1 FROM web_legacy_ids l WHERE l.threadId=i.threadId AND l.requestId=i.requestId) AND NOT EXISTS(SELECT 1 FROM conversation_messages o WHERE o.threadId=i.threadId AND o.requestId=i.requestId AND o.id GLOB 'input-outcome:*')) hasLegacy
    FROM conversation_inputs i WHERE i.threadId=? AND i.requestId IN (${marks(requests)})`).all(threadId,...requests);
   for(const fact of facts){const id=String(fact.requestId);if(fact.firstProcess){requestsWithNodes.add(id);}if(fact.hasOutcome)outcomes.add(id);if(fact.hasLegacy)legacyReplies.add(id);if(fact.replyId)related.add(String(fact.replyId));if(fact.userId)related.add(String(fact.userId));}
  }
  // Full projection marks a continuation only after an existing user process
  // has shown that request's source. A worker alone never establishes it.
  for(const node of nodeRows)if(node.requestId&&node.position!==null&&this.db.prepare("SELECT 1 FROM web_process_ids WHERE threadId=? AND requestId=? AND sourceKind='user' AND position IS NOT NULL AND position<? LIMIT 1").get(threadId,node.requestId,node.position))continuedNodes.add(node.id);
  const replies=[...new Set(nodeRows.flatMap(node=>node.replyId?[node.replyId]:[]))];
  for(const reply of replies)related.add(reply);
  const history=this.history.byIds(threadId,[...related]),inbox=this.inputs.byRequestIds(requests);
  const display=projectConversation(history,nodes,inbox,boundary);
  const sources=this.channels?.readMessageSources(inbox.filter(item=>item.source==='channel_plugin').map(item=>item.input.requestId),false);
  if(!details||sources?.size)display.messages=display.messages.map(message=>{
   const channelSource=message.role==='user'&&message.requestId?sources?.get(message.requestId):undefined;
   if(channelSource)return {...message,channelSource};
   if(!details&&message.process?.details==='unloaded'&&message.process.final)
    return {...message,process:{...message.process,final:{id:message.process.final.id,text:''}}};
   return message;
  });
  const first=selected[0],last=selected.at(-1);
  return {protocol:3 as const,threadId,revision:this.revision,...display,units:selectedIds,
   before:first&&(request.after||inclusive||more)?this.cursor(threadId,first.id):null,
   after:last&&(request.before||inclusive||request.after&&more)?this.cursor(threadId,last.id):null};
 }
 workerTargets(){
  const rows=this.db.prepare('SELECT DISTINCT w.nodeId,w.taskId FROM web_dirty_tasks d CROSS JOIN web_process_workers w ON w.taskId=d.taskId').all() as {nodeId:string;taskId:string}[];
  this.db.exec('DELETE FROM web_dirty_tasks');return rows;
 }
 queuePage(after=0){
  const page=this.inputs.activePage(after);return {items:this.projectQueue(page.items),after:page.after};
 }
 dispatchQueue(cursor:string|undefined,readEpoch:string,sources?:'all'){
  if(sources==='all'){
   const page=this.inputs.dispatchPage(cursor,readEpoch,'all');
   const users=page.items.filter(item=>item.origin==='user');
   const visible=new Map(this.projectQueue(users).map(item=>[item.messageId,item]));
   const workers=page.items.filter(item=>item.origin==='worker');
   const taskIds=[...new Set(workers.flatMap(item=>item.taskId?[item.taskId]:[]))];
   const interactionIds=[...new Set(workers.flatMap(item=>item.kind==='interaction_required'&&item.payload&&typeof item.payload==='object'&&typeof (item.payload as {interactionId?:unknown}).interactionId==='string'?[(item.payload as {interactionId:string}).interactionId]:[]))];
   let titles=new Map<string,string>(),interactions=new Map<string,{kind:string;runId:string}>();
   try{if(taskIds.length)titles=new Map((this.db.prepare(`SELECT id,title FROM tasks WHERE id IN (${marks(taskIds)})`).all(...taskIds) as {id:string;title:string}[]).map(row=>[row.id,row.title]));}catch{/* Missing metadata must not block the queue. */}
   try{if(interactionIds.length)interactions=new Map((this.db.prepare(`SELECT id,kind,runId FROM worker_interactions WHERE id IN (${marks(interactionIds)})`).all(...interactionIds) as {id:string;kind:string;runId:string}[]).map(row=>[row.id,row]));}catch{/* Fall back to a generic interaction. */}
   return {...page,items:page.items.flatMap<import('./recursive-main-inputs.js').MainDispatchInput&{user?:import('./web-history.js').ConversationMessage;statusText:string}>(item=>{
    if(item.origin==='worker'){
     const payload=item.payload&&typeof item.payload==='object'?item.payload as {interactionId?:unknown}:{};
     const interaction=typeof payload.interactionId==='string'?interactions.get(payload.interactionId):undefined;
     const kind=item.kind==='interaction_required'?(interaction?.runId===item.runId?(interaction.kind==='question'?'提问':interaction.kind==='authorization'?'操作或授权请求':'交互请求'):'交互请求'):item.kind==='worker_reply'?'执行信息已返回':item.kind==='task_archived'?'事项归档通知':'协作消息';
     const statusText=item.state==='queued'?'等待主 Agent 处理':item.state==='processing'?'主 Agent 正在接收或处理':'接收状态待核对';
     const title=item.taskId?titles.get(item.taskId)?.replace(/\s+/g,' ').trim():undefined;
     return [{...item,payload:null,text:[kind,statusText,title?'事项：'+title:'事项标题暂不可用'].join(' · '),statusText}];
    }
    const projected=visible.get(item.messageId);return projected?[{...item,...projected}]:[];
   })};
  }
  const page=this.inputs.dispatchPage(cursor,readEpoch),visible=new Map(this.projectQueue(page.items).map(item=>[item.messageId,item]));
  return {...page,items:page.items.flatMap(item=>{const projected=visible.get(item.messageId);return projected?[{...item,...projected}]:[];})};
 }
 private projectQueue(items:import('./recursive-main-inputs.js').QueuedInput[]){
  const requests=items.map(item=>item.input.requestId),users=[...this.history.inputs(String(this.db.prepare("SELECT value FROM meta WHERE key='mainThread'").get()!.value),requests).values()];
  const requestsWithNodes=new Set<string>(),legacyReplies=new Set<string>();
  for(const requestId of requests){
   const thread=users.find(user=>user.requestId===requestId)?.threadId;if(!thread)continue;
   if(this.db.prepare("SELECT 1 FROM web_process_ids WHERE threadId=? AND requestId=? AND sourceKind='user' AND position IS NOT NULL LIMIT 1").get(thread,requestId))requestsWithNodes.add(requestId);
   if(this.db.prepare(`SELECT 1 FROM web_legacy_ids WHERE threadId=? AND requestId=? AND NOT EXISTS(SELECT 1 FROM conversation_messages o WHERE o.threadId=? AND o.requestId=? AND o.id GLOB 'input-outcome:*') LIMIT 1`).get(thread,requestId,thread,requestId))legacyReplies.add(requestId);
  }
  const view=projectConversation(users,[],items,{visibleIds:new Set(),requestsWithNodes,legacyReplies,outcomes:new Set(),nodeRequests:new Map(),continuedNodes:new Set()});
  return view.queue;
 }
 process(id:string,threadId:string):ProcessNode{
  const node=this.processes.exact(id);if(!node||node.threadId!==threadId)throw Error('history_process_not_found');return node;
 }
}
export type HistoryPage=ReturnType<WebHistoryPages['read']>&{artifacts?:import('./web-contract.js').WebArtifact[];inactiveInteractions?:import('./web-contract.js').InactiveInteraction[];inactiveMore?:boolean};
