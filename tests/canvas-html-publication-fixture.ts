// Real local message and file owners with isolated SQLite and synthetic bytes.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {ConversationHistory} from '../src/web-history.js';
import {MediaStore} from '../src/media-store.js';
import {detectMedia} from '../src/media-policy.js';
import {homerWebBridge} from '../src/web-homer.js';
import {Homer} from '../src/service.js';
import {createHooks} from '../src/hooks.js';
import type {AttachmentRef} from '../src/media-store.js';

export function htmlAttachmentFixture(filename='正式预览.html',bytes=Buffer.from('<!doctype html><meta charset="utf-8"><h1>正式 HTML 成果</h1>')){
 const root=resolve('.codex/scratch/message-attachments');
 mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'fixture-')),store=new Store(join(dir,'homer.sqlite'));
 const hookEvents=createHooks<{'message.committed':Readonly<{messageId:string}>}>(['message.committed'],()=>{});
 const close=()=>{hookEvents.close();store.close();rmSync(dir,{recursive:true,force:true});};
 try{
  const workspace=join(dir,'workspace'),runtime=join(dir,'runtime'),codexHome=join(dir,'codex');
  const files=new Files(workspace),tasks=new RecursiveTasks(store,files);tasks.migrate();
  const history=new ConversationHistory(store.db),media=new MediaStore(store.db,join(runtime,'media'));
  const threadId='attachment-thread',requestId='synthetic-request',agentId='main:attachments';
  store.setMeta('mainThread',threadId);store.setMeta('mainAgentId',agentId);
  const original=join(workspace,filename);writeFileSync(original,bytes);
  const protectedFile=join(runtime,'private.txt');writeFileSync(protectedFile,'synthetic protected content');
  const inputs=new MainInputs(tasks,history);
  const {replyId}=inputs.accept({requestId,text:'请附上已核对的文件'});
  const queuedInput=inputs.claim([],'all');
  if(queuedInput?.origin!=='user')throw Error('synthetic_input_not_claimed');
  inputs.started(queuedInput.messageId,queuedInput.revision,'synthetic-generation','synthetic-turn');
  const app=Object.assign(Object.create(Homer.prototype),{
   store,files,tasks,history,media,inputs,hookEvents,hooks:hookEvents.listener,
   stateObservers:new Set(),sink:async()=>{},
   config:{workspace,runtime,codexHome,nativeCodexHome:codexHome,codexBin:process.execPath},
   main:{threadId,turnId:'synthetic-turn',interrupt:async()=>true},
   mainContext:{requestId,messageId:replyId,event:false,userText:'请附上已核对的文件',queuedInput},
  });
  const hidden=media.snapshot('staged-only',{filename:'uncommitted.txt',bytes:Buffer.from('uncommitted bytes'),kind:'file',mime:'text/plain'});
  const bridge=homerWebBridge(app,{draftUpload:false});
  const send=(attachments:unknown[]=[{path:original}],operationId='synthetic-send',task?:{taskId:string;taskVersion:number})=>{
   // Seed an old-format published attachment with the existing media owners.
   const actor=app.mainActor(),context=app.mainContext;
   app.validateMainContext(context);
   const staged=app.stageAttachments(actor,operationId,attachments,context) as {key:string;refs:AttachmentRef[]};
   const operationKey='send:'+operationId;
   const messageId=store.transaction(()=>{
    const id=history.commitAssistant({threadId,requestId,text:'文件见附件',operationKey,attachments:staged.refs,...task});
    store.db.prepare(`INSERT OR IGNORE INTO operations(id,actorAgentId,scopeId,operationId,kind,payloadHash,state,detailsJson,responseJson)
      VALUES(?,?,'user-messages',?,'send_user_message','synthetic','confirmed','{}',?)`)
      .run(operationKey,actor.agentId,operationId,JSON.stringify({messageId:id}));
    app.commitAttachments(staged.key,staged.refs,id);
    return id;
   });
   const ref=history.message(messageId)?.attachments?.[0];
   if(!ref)throw Error('synthetic_attachment_missing');
   const snapshot=media.readAttachment(ref);
   return {messageId,...ref,path:snapshot.path,sha256:snapshot.asset.hash};
  };
  return {dir,store,history,media,app,bridge,inputs,queuedInput,threadId,replyId,original,protectedFile,hidden,bytes,classifiedMime:detectMedia(bytes),send,close};
 }catch(error){close();throw error;}
}
