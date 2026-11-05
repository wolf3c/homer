import {conversationInput} from './web-history.js';
import {webUpload} from './web-upload.js';
import {WEB_CHAT_POST,type WebBridge} from './web-contract.js';

// Shared chat operations. Device access is checked by its transport before entry.
export function createWebChat(bridge:WebBridge){
 let reading=0,uploading=0;
 const boundedRead=async<T,>(read:()=>Promise<T>)=>{if(reading>=4)throw Error('history_read_busy');reading++;try{return await read();}finally{reading--;}};
 const id=(value:unknown)=>typeof value==='string'&&/^[\w:-]{1,100}$/.test(value);
 return async(op:string,input:any={}):Promise<unknown>=>{
  if(op==='history.state'){if(!bridge.history)throw Error('history_protocol_required');return boundedRead(()=>bridge.history!.state());}
  if(op==='media.upload'){
   if(!bridge.media?.upload)throw Error('web_upload_unavailable');if(uploading>=2)throw Error('web_upload_busy');
   webUpload(input);uploading++;try{return await bridge.media.upload(input);}finally{uploading--;}
  }
  if(op==='media.preview'){
   if(!bridge.media?.previewDraft)throw Error('web_upload_unavailable');
   const preview=await bridge.media.previewDraft(input);
   if(!['image/png','image/jpeg','image/webp'].includes(preview.mime))throw Error('media_preview_unavailable');
   return preview;
  }
  if(op==='media.read'){
   if(!id(input?.messageId)||typeof input.assetId!=='string'||!/^asset-[a-f0-9-]{36}$/.test(input.assetId)||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>99999999)throw Error('media_request_invalid');
   if(!bridge.media)throw Error('media_unavailable');return bridge.media.read(input);
  }
  if(op==='files.read'||op==='files.origin'){
   if(typeof input?.id!=='string'||! /^(?:run|result)-[\w-]{1,100}$/.test(input.id))throw Error('artifact_request_invalid');
   if(op==='files.read')return bridge.artifact(input.id);
   if(!bridge.artifactOrigin)throw Error('artifact_origin_unavailable');return bridge.artifactOrigin(input.id);
  }
  if(op.startsWith('tasks.')){
   const owner=bridge.taskOverview;if(!owner)throw Error('task_overview_unavailable');
   if(op==='tasks.list')return owner.list();
   if(op==='tasks.execution'||op==='tasks.call'){
    if(!id(input?.taskId)||!id(input.runId)||Object.keys(input).some(key=>!['taskId','runId',op==='tasks.call'?'callKey':'before'].includes(key))||input.before!==undefined&&(typeof input.before!=='string'||! /^[A-Za-z0-9_-]{1,256}$/.test(input.before)))throw Error('task_execution_invalid');
    if(!owner.execution||!owner.call)throw Error('task_execution_unavailable');
    const selector={taskId:input.taskId,runId:input.runId};
    if(op==='tasks.call'){if(typeof input.callKey!=='string'||! /^[A-Za-z0-9_-]{1,256}$/.test(input.callKey))throw Error('task_execution_invalid');return boundedRead(()=>owner.call!(selector,input.callKey));}
    return boundedRead(()=>owner.execution!(selector,input.before));
   }
   if(!id(input?.id))throw Error('task_overview_invalid');
   if(op==='tasks.detail'){
    if(Object.keys(input).some(key=>!['id','workerId','after','messageId','offset'].includes(key)))throw Error('task_overview_invalid');
    const {workerId,after,messageId,offset}=input;
    if(workerId===undefined){if(after!==undefined||messageId!==undefined||offset!==undefined)throw Error('worker_query_invalid');return boundedRead(()=>owner.detail(input.id));}
    if(!id(workerId)||after!==undefined&&(!Number.isSafeInteger(after)||after<0)||offset!==undefined&&(!Number.isSafeInteger(offset)||offset<0)||messageId!==undefined&&!id(messageId)||offset!==undefined&&messageId===undefined||messageId!==undefined&&after!==undefined)throw Error('worker_query_invalid');
    return boundedRead(()=>owner.detail(input.id,{workerId,...(after!==undefined?{after}:{}),...(messageId!==undefined?{messageId}:{}),...(offset!==undefined?{offset}:{})}));
   }
   if(op==='tasks.summary'&&owner.summary)return owner.summary(input.id);
   if(op==='tasks.progress'&&owner.progress)return owner.progress(input.id);
   if(op==='tasks.origin'&&owner.origin&&id(input.messageId))return owner.origin(input.id,input.messageId);
   throw Error('task_overview_unavailable');
  }
  let path=Object.keys(WEB_CHAT_POST).find(path=>WEB_CHAT_POST[path]!.op===op);
  if(op==='interactions.respond'){
   if(typeof input?.id!=='string'||! /^[\w-]{1,100}$/.test(input.id))throw Error('invalid_interaction_id');
   path='/api/interactions/'+input.id;input=input.input;
  }
  if(!path)throw Error('route_not_found');
  if(path.startsWith('/api/history/')){
    if(!bridge.history)throw Error('history_protocol_required');
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('history_request_invalid');
    if(path==='/api/history/page'){
      const r=input.request;
      if(typeof input.readEpoch!=='string'||input.readEpoch.length>100||!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(key=>!['limit','before','after','around'].includes(key))||['before','after','around'].some(key=>r[key]!==undefined&&(typeof r[key]!=='string'||r[key].length>600)))throw Error('history_request_invalid');
      return (await boundedRead(()=>bridge.history!.page(input)));
    }
    if(path==='/api/history/process'||path==='/api/history/resolve'){
      if(typeof input.readEpoch!=='string'||input.readEpoch.length>100||typeof input.id!=='string'||!/^[\w:-]{1,100}$/.test(input.id))throw Error('history_request_invalid');
      if(input.itemId!==undefined&&(path!=='/api/history/process'||typeof input.itemId!=='string'||!/^[\w:-]{1,300}$/.test(input.itemId)))throw Error('history_request_invalid');
      return (await boundedRead<unknown>(()=>path==='/api/history/resolve'?bridge.history!.resolve(input):bridge.history!.process(input)));
    }
    if(path==='/api/history/receipts')return (await boundedRead(()=>bridge.history!.receipts(input)));
    if(path==='/api/history/queue'){
      if(input.view!==undefined){
        if(input.view!=='dispatch-v1'||typeof input.readEpoch!=='string'||input.readEpoch.length>100||(input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length>1000)))throw Error('history_request_invalid');
        if(!bridge.history.dispatchQueue)throw Error('queue_dispatch_unavailable');
        if(input.sources!==undefined&&input.sources!=='all')throw Error('history_request_invalid');
        return (await boundedRead(()=>bridge.history!.dispatchQueue!({readEpoch:input.readEpoch,cursor:input.cursor,...(input.sources==='all'?{sources:'all' as const}:{})})));
      }
      return (await boundedRead(()=>bridge.history!.queue(input.after??0,input.readEpoch)));
    }
    if(path==='/api/history/interactions')return (await boundedRead(()=>bridge.history!.interactions(input.after??0,input.readEpoch)));
  }
  if(path==='/api/uploads/discard'){
    if(!bridge.media?.discard)throw Error('web_upload_unavailable');
    return (await bridge.media.discard(input));
  }
  if (path === "/api/messages") return (await bridge.submit(conversationInput(input)));
  if (path === '/api/messages/feedback') {
    if (!bridge.feedback) throw Error('feedback_unavailable');
    if (typeof input?.messageId !== 'string' || !/^[\w:-]{1,100}$/.test(input.messageId) || !['up','down',null].includes(input.value)) throw Error('invalid_feedback');
    return (await bridge.feedback(input.messageId, input.value));
  }
  if(path==='/api/messages/interrupt'){
    if(!bridge.queue)throw Error('queue_unavailable');
    const target=input?.target;
    if(typeof target?.messageId!=='string'||typeof target?.generationId!=='string'||! /^[\w:-]{1,100}$/.test(target.messageId)||! /^[\w:-]{1,100}$/.test(target.generationId))throw Error('queue_interrupt_target_invalid');
    return (await bridge.queue.interrupt(conversationInput(input.input),{messageId:target.messageId,generationId:target.generationId}));
  }
  if(path==='/api/messages/edit'||path==='/api/messages/cancel'||path==='/api/messages/move'){
    if(!bridge.queue)throw Error('queue_unavailable');
    const messageMove=path.endsWith('/move')&&typeof input?.messageId==='string';
    if((!messageMove&&(typeof input?.requestId!=='string'||! /^[\w:.-]{1,150}$/.test(input.requestId)))||typeof input?.operationId!=='string'||! /^[\w:.-]{1,150}$/.test(input.operationId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw Error('queue_mutation_invalid');
    const scoped=input.threadId!==undefined||input.readEpoch!==undefined;
    if(scoped&&(typeof input.threadId!=='string'||!input.threadId||input.threadId.length>150||typeof input.readEpoch!=='string'||!input.readEpoch||input.readEpoch.length>100))throw Error('queue_scope_invalid');
    const change={requestId:input.requestId,operationId:input.operationId,expectedRevision:input.expectedRevision,...(scoped?{threadId:input.threadId,readEpoch:input.readEpoch}:{})};
    if(path.endsWith('/move')){
      if(!bridge.queue.move)throw Error('queue_move_unavailable');
      if(messageMove){
        if(input.requestId!==undefined||! /^[\w:-]{1,100}$/.test(input.messageId)||!scoped||typeof input.expectedOrderVersion!=='string'||! /^[a-f0-9]{64}$/.test(input.expectedOrderVersion)||(input.beforeMessageId!==null&&(typeof input.beforeMessageId!=='string'||! /^[\w:-]{1,100}$/.test(input.beforeMessageId))))throw Error('queue_move_invalid');
        return (await bridge.queue.move({messageId:input.messageId,beforeMessageId:input.beforeMessageId,operationId:input.operationId,expectedRevision:input.expectedRevision,threadId:input.threadId,readEpoch:input.readEpoch,expectedOrderVersion:input.expectedOrderVersion}));
      }
      if(!scoped||typeof input.expectedOrderVersion!=='string'||! /^[a-f0-9]{64}$/.test(input.expectedOrderVersion)||(input.beforeRequestId!==null&&(typeof input.beforeRequestId!=='string'||! /^[\w:-]{1,100}$/.test(input.beforeRequestId))))throw Error('queue_move_invalid');
      return (await bridge.queue.move({...change,threadId:input.threadId,readEpoch:input.readEpoch,expectedOrderVersion:input.expectedOrderVersion,beforeRequestId:input.beforeRequestId}));
    }
    return (path.endsWith('/edit')?await bridge.queue.edit({...change,input:conversationInput(input.input)}):await bridge.queue.cancel(change));
  }
  if (path === "/api/stop") {
    if (typeof input?.messageId !== "string" || !/^[\w:-]{1,100}$/.test(input.messageId)) throw new Error("invalid_message_id");
    return (await bridge.stop(input.messageId));
  }
  const interaction = path.match(/^\/api\/interactions\/([\w-]{1,100})$/);
  if (interaction) {
    const valid = conversationInput({...input,interactionId:interaction[1]!});
    return (await bridge.respond(interaction[1]!, { requestId: valid.requestId, text: valid.text,...(valid.questionAnswers?{questionAnswers:valid.questionAnswers}:{}) }));
  }
  throw Error('route_not_found');
 };
}
