// Commits synthetic user-visible messages through the normal message and media owners.
import {randomUUID} from 'node:crypto';
import type {Store} from '../../src/store.js';
import type {ConversationHistory} from '../../src/web-history.js';
import type {MediaStore} from '../../src/media-store.js';

export function commitSyntheticMessage(
 {store,history,media}: {store:Store;history:ConversationHistory;media?:MediaStore},
 threadId:string,
 text:string,
 files:readonly {filename:string;mime?:string;content:string|Buffer}[]=[],
 requestId?:string,
 task?:{taskId:string;taskVersion:number},
){
 const operationKey='synthetic-message-'+randomUUID();
 const stageKey='stage:'+operationKey;
 const attachments=files.map(({filename,mime='text/plain',content})=>{
  if(!media)throw Error('synthetic_media_required');
  return media.snapshot(stageKey,{filename,mime,kind:mime.startsWith('image/')?'image':'file',bytes:Buffer.from(content)});
 });
 const messageId=store.transaction(()=>{
  const actor=store.meta('mainAgentId')!;
  const operation=store.db.prepare("INSERT INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson,responseJson) VALUES(?,?,?,?,?,'synthetic','confirmed',?,?)");
  const id=history.commitAssistant({threadId,requestId,text,attachments,operationKey,...task});
  operation.run(operationKey,actor,'user-messages',operationKey,'send_user_message','{}',JSON.stringify({messageId:id,operationKey,state:'confirmed'}));
  if(attachments.length){
   operation.run(stageKey,actor,'message-attachments',stageKey,'attachment_stage',JSON.stringify({sources:attachments.map(()=>null)}),JSON.stringify(attachments));
   for(const ref of attachments)media!.pinAttachment(ref,'message:'+id);
   media!.unpin('operation:'+stageKey);
  }
  return id;
 });
 return {messageId,attachments,paths:attachments.map(ref=>'/api/media/'+messageId+'/'+ref.assetId+'/'+ref.revision)};
}
