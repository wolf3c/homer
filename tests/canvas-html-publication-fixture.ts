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

export function htmlAttachmentFixture(filename='正式预览.html',bytes=Buffer.from('<!doctype html><meta charset="utf-8"><h1>正式 HTML 成果</h1>')){
 const root=resolve('.codex/scratch/message-attachments');
 mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'fixture-')),store=new Store(join(dir,'homer.sqlite'));
 const close=()=>{store.close();rmSync(dir,{recursive:true,force:true});};
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
   store,files,tasks,history,media,inputs,
   stateObservers:new Set(),sink:async()=>{},
   config:{workspace,runtime,codexHome,nativeCodexHome:codexHome,codexBin:process.execPath},
   main:{threadId,turnId:'synthetic-turn',interrupt:async()=>true},
   mainContext:{requestId,messageId:replyId,event:false,userText:'请附上已核对的文件',queuedInput},
  });
  const hidden=media.snapshot('staged-only',{filename:'uncommitted.txt',bytes:Buffer.from('uncommitted bytes'),kind:'file',mime:'text/plain'});
  const bridge=homerWebBridge(app,{draftUpload:false,nativeCapabilities:false});
  const send=(attachments:unknown[]=[{path:original}],operationId='synthetic-send')=>{
   const sent=app.sendUserMessage(app.mainActor(),{operationId,text:'文件见附件',attachments});
   const ref=history.message(sent.messageId)?.attachments?.[0];
   if(!ref)throw Error('synthetic_attachment_missing');
   const snapshot=media.readAttachment(ref);
   return {messageId:String(sent.messageId),...ref,path:snapshot.path,sha256:snapshot.asset.hash};
  };
  return {dir,store,history,media,app,bridge,inputs,queuedInput,threadId,replyId,original,protectedFile,hidden,bytes,classifiedMime:detectMedia(bytes),send,close};
 }catch(error){close();throw error;}
}
