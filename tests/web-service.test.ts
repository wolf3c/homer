import {readTestConversation} from './fixtures/read-test-conversation.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from 'node:fs';
import type {Message} from "../src/service.js";
import { homerWebBridge } from "../src/web-homer.js";
import { createWebServer } from "../src/web-server.js";

import {fixture} from './web-service-fixture.js';
import {previewCollection} from './web-preview-collection-fixture.js';

const until = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error("synthetic_wait_timeout"); await new Promise(r => setTimeout(r, 5)); }
};

test("accepted input streams into persisted history; stop keeps main reusable and dispatched worker alive", async () => {
  const f = fixture();
  try {
    await f.app.start();
    await f.app.message("dispatch", "dispatch-request");
    await until(() => f.engines.some(engine => engine.worker && !!engine.pending));
    const receipt = f.app.submitMessage({ requestId: "stream-request", text: "stream" });
    assert.ok(receipt.replyId);
    await until(() => f.app.conversationControlState().activeMessageId === receipt.replyId);
    assert.equal(f.app.history.list("synthetic-main").find(message => message.id === receipt.replyId)?.text, "合成部分回复");
    await f.app.stopMain(receipt.replyId);
    await until(() => f.app.history.list("synthetic-main").find(message => message.id === receipt.replyId)?.status === "interrupted");
    assert.equal(f.engines.find(engine => engine.worker)?.interrupts, 0);
    assert.equal(f.app.snapshot().activeWorkers, 1);
    assert.equal(f.app.submitMessage({ requestId: "stream-request", text: "stream" }).fresh, false);
    assert.equal(await f.app.message("继续", "continue-request"), "准确的合成来源句子");
    assert.equal(f.engines.filter(engine => !engine.worker).length, 1);
    assert.equal(f.engines.find(engine => !engine.worker)?.closed, 0);
  } finally { await f.app.close(); }
});

test("quote source ID and selected text reach the existing main thread", async () => {
  const f = fixture();
  try {
    await f.app.start(); await f.app.message("来源", "source-request");
    const source = readTestConversation(f.app).messages.find(message => message.role === "assistant"&&message.text.includes('合成来源'))!;
    const quote = { messageId: source.id, text: "合成来源" };
    await f.app.message("请解释", "quote-request", quote);
    assert.ok(f.inputs.at(-1)?.includes(source.id)); assert.ok(f.inputs.at(-1)?.includes(JSON.stringify(quote.text)));
    assert.deepEqual(f.app.history.list("synthetic-main").find(message=>message.role==='user'&&message.requestId==='quote-request')?.quote, quote);
  } finally { await f.app.close(); }
});

test('the current Main turn can inspect and forward its exact uploaded attachment',async()=>{
 const f=fixture();
 try{
  await f.app.start();
  const requestId='active-upload',bytes=Buffer.from('Synthetic original bytes');
  const uploaded=await f.app.uploadAttachment({threadId:'synthetic-main',requestId,uploadId:'current-file',filename:'source.txt',data:bytes.toString('base64')});
  const ref={assetId:uploaded.assetId,revision:uploaded.revision};
  const engine=f.engines.find(candidate=>!candidate.worker)!;
  engine.turn=async(_text,options)=>{
   engine.turnId='active-upload-turn';options?.onStarted?.(engine.turnId);
   const owner=f.app as unknown as {mediaTool(name:string,args:unknown):Promise<{extraction:{text:string}}>};
   const inspected=await owner.mediaTool('inspect_attachment',ref);
   assert.equal(inspected.extraction.text,bytes.toString());
   await engine.call('send_user_message',{text:'已附上原文',attachments:[ref]});
   return {status:'completed',text:'迟到的原生最终回答'};
  };
  const accepted=f.app.submitMessage({requestId,text:'请附上原文',attachments:[ref]});
  await f.app.idle();
  const output=f.app.history.message(accepted.replyId)!;
  assert.equal(output.text,'已附上原文');
  assert.deepEqual(output.attachments,[ref]);
  const bridge=homerWebBridge(f.app),attachment={messageId:output.id,...ref};
  assert.equal((await bridge.media!.read(attachment)).data,bytes.toString('base64'));
  rmSync(f.app.media.readAttachment(ref).path+'.local-document-text-v1');
  f.app.media.reconcile();
  assert.equal(f.app.media.asset(ref).error,'media_derivative_missing');
  assert.equal((await bridge.media!.read(attachment)).data,bytes.toString('base64'));
  assert.ok((await bridge.history!.state()).artifacts?.some(file=>file.messageId===output.id&&file.assetId===ref.assetId));
 }finally{await f.app.close();}
});

test('preview text and web annotations reach the existing main queue with verified sources',async()=>{
 const f=fixture();
 try{
  await f.app.start();
  const [source]=await f.attach('preview-source',[{filename:'引用.md',content:'# 合成原文\n\n这一段可以引用'}]);
  const reference={kind:'text' as const,source:source!,text:'这一段可以引用'};
  const input={requestId:'preview-text',text:'请解释',resourceReference:reference};
  f.app.submitMessage(input);await f.app.idle();
  assert.ok(f.inputs.at(-1)?.includes(source!.messageId));assert.ok(f.inputs.at(-1)?.includes(reference.text));
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.requestId===input.requestId&&m.role==='user')?.resourceReference,reference);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'preview-forged',resourceReference:{...reference,text:'不存在的原文'}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'preview-hash',resourceReference:{...reference,source:{...reference.source,sha256:'b'.repeat(64)}}}),/preview_source_mismatch/);
  const messageId=f.app.history.accept('synthetic-main',{requestId:'web-source',text:'来源'}).replyId;
  f.app.history.finish(messageId,'[合成页面](https://example.com/preview)','completed');
  const web={kind:'web' as const,source:{kind:'web' as const,messageId,sourceId:'link-1',url:'https://example.com/preview',title:'合成页面'},annotations:[{id:'note-1',element:'button',elementPath:'#start',comment:'改大一些',x:10,y:30}]};
  f.app.submitMessage({requestId:'preview-web',text:'',resourceReference:web});await f.app.idle();
  assert.ok(f.inputs.at(-1)?.includes('#start'));assert.ok(f.inputs.at(-1)?.includes('改大一些'));
  assert.throws(()=>f.app.submitMessage({requestId:'preview-url-forged',text:'说明',resourceReference:{...web,source:{...web.source,url:'https://other.invalid/'}}}),/preview_source_mismatch/);
 }finally{await f.app.close();}
});

test('HTML preview batches keep verified artifact identity and accepted retry while rejecting forged sources',async()=>{
 const f=fixture();let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
 try{
  await f.app.start();
  const [source]=await f.attach('html-batch-source',[{filename:'source.html',content:'<!doctype html><h1>Untrusted $hidden heading</h1><h2>Other heading</h2>'}]);
  const annotations=[{id:'one',element:'h1 $hidden',elementPath:'body > h1',comment:'放大主标题',x:5,y:10},{id:'two',element:'h2',elementPath:'body > h2',comment:'保留副标题',x:5,y:30}];
  const input={requestId:'html-batch',text:'保留正文',resourceReference:{kind:'web' as const,source:source!,annotations}};
  assert.throws(()=>f.app.submitMessage({...input,requestId:'html-forged-hash',resourceReference:{...input.resourceReference,source:{...source!,sha256:'b'.repeat(64)}}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'html-forged-title',resourceReference:{...input.resourceReference,source:{...source!,title:'other.html'}}}),/preview_source_mismatch/);
  web=await createWebServer({bridge:homerWebBridge(f.app),port:0});
  const submit=()=>fetch(web!.url+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(web!.url).origin},body:JSON.stringify(input)});
  assert.equal((await submit()).status,202);await f.app.idle();
  assert.match(f.inputs.at(-1)!,/用户预览引用/);assert.ok(f.inputs.at(-1)!.includes(source!.sha256));
  for(const annotation of annotations)assert.ok(f.inputs.at(-1)!.includes(annotation.comment));
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.role==='user'&&m.requestId===input.requestId)?.resourceReference,input.resourceReference);
  const before=f.inputs.length;f.app.readAttachment=()=>{throw Error('synthetic_source_now_stale');};
  const retry=await submit();assert.equal(retry.status,202);assert.equal((await retry.json() as {fresh:boolean}).fresh,false);await f.app.idle();assert.equal(f.inputs.length,before);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'html-new-stale'}),/synthetic_source_now_stale/);
 }finally{await web?.close();await f.app.close();}
});

test('preview formula quotations validate canonical math and reject changed expressions',async()=>{
 const f=fixture();
 try{
  await f.app.start();
  const [source]=await f.attach('preview-math-source',[{filename:'Math.md',content:'Cost is $$x_i^2$$ today.\n\n$$\n\\frac{a_b}{c_d}\n$$\n\n```math\nx^2 + y^2\n= z^2\n```\n\n```math\n\\frac{\n```'}]);
  for(const [index,text] of ['Cost is $x_i^2$ today.','$$\n\\frac{a_b}{c_d}\n$$','x^2 + y^2\n= z^2','\\frac{'].entries()){
   f.app.submitMessage({requestId:'preview-math-'+index,text:'Explain',resourceReference:{kind:'text',source:source!,text}});await f.app.idle();
  }
  assert.throws(()=>f.app.submitMessage({requestId:'preview-math-forged',text:'Explain',resourceReference:{kind:'text',source:source!,text:'$x_i^3$'}}),/preview_source_mismatch/);
 }finally{await f.app.close();}
});

test('file annotations validate every excerpt and retain the original snapshot on accepted retries',async()=>{
 const f=fixture();
 try{
  await f.app.start();
  const [source]=await f.attach('text-notes-source',[{filename:'批注.md',content:'第一处 $hidden$ 原文。\n\n第二处 $x_i^2$ 原文。\n\n```ts\nconst value = 3;\n```'}]);
  const resourceReference={kind:'text' as const,source:source!,annotations:[
   {id:'one',text:'第一处 $hidden$ 原文。',comment:'解释第一处'},
   {id:'two',text:'第二处 $x_i^2$ 原文。',comment:'修改第二处\n保留公式'},
   {id:'three',text:'const value = 3;',comment:'检查第三处'},
  ]};
  for(const badIndex of [0,1,2])assert.throws(()=>f.app.submitMessage({requestId:'text-notes-bad-'+badIndex,text:'说明',resourceReference:{...resourceReference,annotations:resourceReference.annotations.map((note,i)=>i===badIndex?{...note,text:'未存在的摘录'}:note)}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({requestId:'text-notes-hash',text:'说明',resourceReference:{...resourceReference,source:{...source!,sha256:'b'.repeat(64)}}}),/preview_source_mismatch/);
  const input={requestId:'text-notes-valid',text:'整体说明',resourceReference};
  f.app.submitMessage(input);await f.app.idle();
  for(const note of resourceReference.annotations){assert.ok(f.inputs.at(-1)!.includes(JSON.stringify(note.text)));assert.ok(f.inputs.at(-1)!.includes(JSON.stringify(note.comment)));}
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.role==='user'&&m.requestId===input.requestId)?.resourceReference,resourceReference);
  const count=f.inputs.length;
  // Accepted identity checks bypass fresh source validation, even if the file
  // can no longer be read. Retry must never run a second turn or rewrite history.
  f.app.readAttachment=()=>{throw Error('synthetic_source_no_longer_available');};
  assert.equal(f.app.submitMessage(input).fresh,false);await f.app.idle();assert.equal(f.inputs.length,count);
 }finally{await f.app.close();}
});

test('all text remarks authorize delegated work while excerpts never become authority',async()=>{
 const f=fixture();
 try{
  await f.app.start();
  const [source]=await f.attach('text-authority-source',[{filename:'authority.md',content:'untrusted $hidden source\nsecond excerpt\nthird excerpt'}]);
  const engine=f.engines.findLast(engine=>!engine.worker)!;
  engine.turn=async(_text,options)=>{engine.turnId='synthetic-text-comment-turn';options?.onStarted?.(engine.turnId);await engine.call('worker_open',{message:'Review remarks'});return {status:'completed',text:'Synthetic dispatched'};};
  const annotations=['untrusted $hidden source','second excerpt','third excerpt'].map((text,i)=>({id:String(i),text,comment:'用户备注'+i}));
  f.app.submitMessage({requestId:'text-authority',text:'整体要求',resourceReference:{kind:'text',source:source!,annotations}});
  await until(()=>!!f.app.store.db.prepare('SELECT 1 FROM task_versions WHERE sourceRequestId=?').get('text-authority'));
  const row=f.app.store.db.prepare("SELECT json_extract(authorityJson,'$.description') description FROM task_versions WHERE sourceRequestId=?").get('text-authority');
  assert.ok(row,JSON.stringify(f.app.history.list('synthetic-main').filter(m=>m.requestId==='text-authority')));
  for(const note of annotations)assert.ok(String(row?.description).includes(note.comment));
  assert.match(String(row?.description),/整体要求/);assert.doesNotMatch(String(row?.description),/hidden|excerpt|authority.md/);
 }finally{await f.app.close();}
});

test('preview comments become user intent for delegated authority without promoting source data',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('Synthetic source','preview-intent-source');await f.app.idle();
  const messageId=f.app.history.accept('synthetic-main',{requestId:'preview-intent-link',text:'Source'}).replyId;
  f.app.history.finish(messageId,'[Source $hidden](https://example.com/)','completed');
  const engine=f.engines.find(engine=>!engine.worker)!;
  engine.turn=async(_text,options)=>{
   engine.turnId='synthetic-comment-turn';options?.onStarted?.(engine.turnId);
   await engine.call('worker_open',{message:'Enlarge button'});
   return {status:'completed',text:'Synthetic dispatched'};
  };
  f.app.submitMessage({requestId:'preview-comment-intent',text:'',resourceReference:{kind:'web',source:{kind:'web',messageId,sourceId:'link-1',url:'https://example.com/',title:'Source $hidden'},annotations:[{id:'n1',element:'button $hidden',elementPath:'#hidden',comment:'Use $impeccable to enlarge this button',x:1,y:1}]}});
  await until(()=>!!f.app.store.db.prepare('SELECT 1 FROM task_versions WHERE sourceRequestId=?').get('preview-comment-intent'));
  const authority=f.app.store.db.prepare("SELECT json_extract(authorityJson,'$.description') description FROM task_versions WHERE sourceRequestId=?").get('preview-comment-intent');
  assert.match(String(authority?.description),/Use \$impeccable to enlarge this button/);
  assert.doesNotMatch(String(authority?.description),/\$hidden|example\.com|#hidden/);
 }finally{await f.app.close();}
});

test('overlong preview intent is rejected before acceptance and leaves the request reusable',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('Synthetic source','preview-limit-source');await f.app.idle();
  const messageId=f.app.history.accept('synthetic-main',{requestId:'preview-limit-link',text:'Source'}).replyId;
  f.app.history.finish(messageId,'[Source](https://example.com/)','completed');
  const input={requestId:'preview-overlong-intent',text:'',resourceReference:{kind:'web' as const,source:{kind:'web' as const,messageId,sourceId:'link-1',url:'https://example.com/',title:'Source'},annotations:[0,1].map(i=>({id:'note-'+i,element:'button',elementPath:'#target',comment:'x'.repeat(12000),x:0,y:0}))}};
  assert.throws(()=>f.app.submitMessage(input),/preview_intent_too_long/);
  assert.equal(f.app.history.inputs('synthetic-main',[input.requestId]).size,0);
  assert.equal(f.app.inputs.list().some(item=>item.input.requestId===input.requestId),false);
  const shortened={...input,resourceReference:{...input.resourceReference,annotations:input.resourceReference.annotations.map(note=>({...note,comment:'x'.repeat(11000)}))}};
  assert.equal(f.app.submitMessage(shortened).fresh,true);await f.app.idle();
 }finally{await f.app.close();}
});

test("Web pending card reply returns through main decision to the original interaction", async () => {
  const messages: Message[] = [];
  const f = fixture(async message => { messages.push(message); });
  try {
    await f.app.start();
    await f.app.message('dispatch','source-synthetic');await until(()=>f.engines.some(engine=>engine.worker&&!!engine.pending));
    const worker=f.engines.find(engine=>engine.worker)!;messages.length=0;
    const answer=worker.call('ask_main',{question:'选择格式'}),original=f.app.interactions.list()[0]!;
    await until(() => f.app.interactions.inspect(original.id).state === "pending_user");
    assert.equal(messages.some(message => message.type === "main_start" || message.type === "main_terminal"), false, "internal Worker review is not a user generation");
    const bridge = homerWebBridge(f.app), before = await bridge.history!.state();
    assert.equal(before.interactions[0]?.id, original.id);
    assert.equal(before.interactions[0]?.sourceRequestId,'source-synthetic');
    assert.equal(before.interactions[0]?.workTitle,'合成后台任务');
    await bridge.respond(original.id, { requestId: "user-answer", text: "请用表格" });
    assert.equal(((await answer) as {answer:string}).answer, "用户指定表格");
    assert.equal(f.app.interactions.inspect(original.id).responseUserMessageId, "user-answer");
    assert.equal(f.app.interactions.inspect(original.id).responseUserText, "请用表格");
    assert.equal((await bridge.history!.state()).interactions.length, 0);
    assert.equal((await bridge.respond(original.id, { requestId: "user-answer", text: "请用表格" }) as {fresh:boolean}).fresh,false);
    assert.deepEqual(f.engines.filter(engine => engine.worker),[worker]);
  } finally { await f.app.close(); }
});

test("an empty unpersisted engine thread blocks automatic handoff until a turn can be resumed", async () => {
  const f = fixture();
  try {
    await f.app.start();
    await f.app.idle();
    f.engines[0]!.resumable = false;
    assert.equal(f.app.upgradeStatus().safe, false);
    f.engines[0]!.resumable = true;
    assert.equal(f.app.upgradeStatus().safe, true);
  } finally { await f.app.close(); }
});


test("real user generation sink orders start/delta/confirmed terminal and ignores delayed stop and foreign events", async () => {
  const messages: Message[] = [];
  const f = fixture(async message => {
    if (message.type as string === "main_start") await new Promise(resolve => setTimeout(resolve, 10));
    messages.push(message);
  });
  try {
    await f.app.start(); await f.app.message("dispatch", "lifecycle-dispatch");
    await until(() => f.engines.some(engine => engine.worker && !!engine.pending));
    messages.length = 0;
    const main = f.engines.find(engine => !engine.worker)!; main.confirmInterrupt = false;
    const receipt = f.app.submitMessage({ requestId: "lifecycle-stream", text: "stream" });
    await until(() => messages.some(message => message.type === "delta"));
    const start = messages[0] as Message & { generationId: string; threadId: string; turnId: string; sourceRequestId: string };
    assert.equal(start.type, "main_start"); assert.equal(start.threadId, "synthetic-main");
    assert.equal(start.turnId, main.turnId); assert.equal(start.sourceRequestId, "lifecycle-stream");
    assert.equal(start.messageId, receipt.replyId); assert.ok(start.generationId);
    main.emit("textDelta", { threadId: main.threadId, turnId: "retired-turn", delta: "STALE" });
    await f.app.stopMain(receipt.replyId);
    assert.equal(messages.some(message => message.type as string === "main_terminal"), false, "interrupt acknowledgement is not turn completion");
    assert.equal(f.engines.find(engine => engine.worker)!.interrupts, 0);
    main.pending!({ status: "interrupted", text: "合成部分回复" }); main.pending = undefined;
    await until(() => messages.some(message => message.type as string === "main_terminal"));
    const terminal = messages.find(message => message.type as string === "main_terminal") as typeof start & { status: string };
    assert.equal(terminal.generationId, start.generationId); assert.equal(terminal.status, "interrupted");
    assert.equal(terminal.text, "合成部分回复"); assert.deepEqual(messages.filter(message => message.type === "delta").map(message => message.text), ["合成部分回复"]);
    assert.deepEqual(messages.map(message => message.type), ["main_start", "delta", "main_terminal", "reply"]);
    const next = f.app.submitMessage({ requestId: "lifecycle-next", text: "stream" });
    await until(() => f.app.conversationControlState().activeMessageId === next.replyId);
    const before = main.interrupts;
    await assert.rejects(() => f.app.stopMain(receipt.replyId), /main_reply_not_active/);
    assert.equal(main.interrupts, before);
    main.pending!({ status: "completed", text: "下一轮完成" }); main.pending = undefined;
    await until(() => messages.filter(message => message.type as string === "main_terminal").length === 2);
    const terminals = messages.filter(message => message.type as string === "main_terminal") as (typeof terminal)[];
    assert.equal(terminals.at(-1)?.status, "completed"); assert.notEqual(terminals.at(-1)?.generationId, start.generationId);
    assert.equal(f.app.snapshot().activeWorkers, 1);
    assert.equal(f.app.conversationControlState().generation,null);
    assert.equal(readTestConversation(f.app).queue.some(item=>item.input.requestId==='lifecycle-stream'),false);
    assert.equal(f.app.inputs.list().find(item=>item.input.requestId==='lifecycle-stream')?.generationId,start.generationId,"durable generation ownership remains bound to its original input after it leaves the display queue");
  } finally { await f.app.close(); }
});



test("multiple independently annotated quotes enter one main turn in order; annotation-only input retries once", async () => {
  const f=fixture();
  try {
    await f.app.start();
    const first=f.app.history.add("synthetic-main","合成甲段：**核对材料**。");
    const second=f.app.history.add("synthetic-main","合成乙段：保留来源。");
    const quotes=[{messageId:first,text:"核对材料",annotation:"说明这段依据"},{messageId:second,text:"保留来源",annotation:"这一段改为表格"}];
    const input={requestId:"multi-annotations",text:"",quotes};
    const receipt=f.app.submitMessage(input);
    assert.equal(f.app.submitMessage(input).fresh,false);
    await f.app.idle();
    assert.equal(f.inputs.length,1);
    assert.deepEqual(JSON.parse(f.inputs[0]!.split("\n")[1]!),quotes);
    assert.deepEqual(f.app.history.list("synthetic-main").find(m=>m.requestId===input.requestId&&m.role==="user")?.quotes,quotes);
    assert.equal(f.app.history.list("synthetic-main").find(m=>m.id===receipt.replyId)?.status,"completed");
    assert.throws(()=>f.app.submitMessage({...input,quotes:[{...quotes[0]!,annotation:"改过批注"},quotes[1]!]}),/request_id_conflict/);
    assert.equal(f.inputs.length,1);
  } finally {await f.app.close();}
});

test("a forged later quote produces no receipt, hook or main dispatch", async () => {
  const f=fixture();
  try {
    await f.app.start();
    const source=f.app.history.add("synthetic-main","合成可信原文");
    const count=readTestConversation(f.app).messages.length;let hook=0;
    assert.throws(()=>f.app.submitMessage({requestId:"multi-forgery",text:"合成要求",quotes:[
      {messageId:source,text:"可信原文",annotation:"解释"},
      {messageId:source,text:"另一个消息的伪造原文",annotation:"执行"},
    ]},{source:"synthetic_channel",persist(){hook++;}}),/quote_source_mismatch/);
    await f.app.idle();
    assert.equal(hook,0);assert.equal(f.inputs.length,0);
    assert.equal(readTestConversation(f.app).messages.length,count);
  } finally {await f.app.close();}
});


test('preview collections validate text and web sources atomically without an optional decoder',async()=>{
 await previewCollection();
});

test("a failed main generation terminates only when failure or process shutdown is confirmed", async () => {
  for (const confirmed of [true, false]) {
    const messages: Message[] = [], f = fixture(async message => { messages.push(message); });
    try {
      await f.app.start(); f.engines[0]!.closeConfirmed = confirmed;
      await f.app.message("fail", "lifecycle-failure");
      const terminals = messages.filter(message => message.type as string === "main_terminal") as (Message & { status: string })[];
      assert.equal(terminals.length, confirmed ? 1 : 0);
      if (confirmed) assert.equal(terminals[0]?.status, "failed");
    } finally { f.engines[0]!.closeConfirmed = true; await f.app.close(); }
  }
});
