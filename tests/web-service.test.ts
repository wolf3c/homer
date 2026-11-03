import { test } from "node:test";
import assert from "node:assert/strict";
import type {Message} from "../src/service.js";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import {syntheticFile} from "./recursive-publication-fixture.js";
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
    await until(() => f.app.conversationState().activeMessageId === receipt.replyId);
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
    const source = f.app.conversationState().messages.find(message => message.role === "assistant"&&message.text.includes('合成来源'))!;
    const quote = { messageId: source.id, text: "合成来源" };
    await f.app.message("请解释", "quote-request", quote);
    assert.ok(f.inputs.at(-1)?.includes(source.id)); assert.ok(f.inputs.at(-1)?.includes(JSON.stringify(quote.text)));
    assert.deepEqual(f.app.history.list("synthetic-main").find(message=>message.role==='user'&&message.requestId==='quote-request')?.quote, quote);
  } finally { await f.app.close(); }
});

test('preview text and web annotations reach the existing main queue with verified sources',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('来源','preview-source');await f.app.idle();
  const published=syntheticFile(f.app,'preview-source','引用.md','# 合成原文\n\n这一段可以引用');published.publish();
  const file=await homerWebBridge(f.app).artifact(published.resultId);
  const reference={kind:'text' as const,source:{kind:'artifact' as const,id:published.resultId,sha256:file.sha256!,title:file.filename},text:'这一段可以引用'};
  const input={requestId:'preview-text',text:'请解释',resourceReference:reference};
  f.app.submitMessage(input);await f.app.idle();
  assert.ok(f.inputs.at(-1)?.includes(published.resultId));assert.ok(f.inputs.at(-1)?.includes(reference.text));
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
  await f.app.start();await f.app.message('合成 HTML 来源','html-batch-source');await f.app.idle();
  const published=syntheticFile(f.app,'html-batch-source','source.html','<!doctype html><h1>Untrusted $hidden heading</h1><h2>Other heading</h2>',[],true);published.publish();
  const file=f.app.previewArtifact(published.resultId);
  const source={kind:'artifact' as const,id:published.resultId,sha256:file.sha256,title:file.filename};
  const annotations=[{id:'one',element:'h1 $hidden',elementPath:'body > h1',comment:'放大主标题',x:5,y:10},{id:'two',element:'h2',elementPath:'body > h2',comment:'保留副标题',x:5,y:30}];
  const input={requestId:'html-batch',text:'保留正文',resourceReference:{kind:'web' as const,source,annotations}};
  assert.throws(()=>f.app.submitMessage({...input,requestId:'html-forged-hash',resourceReference:{...input.resourceReference,source:{...source,sha256:'b'.repeat(64)}}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'html-forged-title',resourceReference:{...input.resourceReference,source:{...source,title:'other.html'}}}),/preview_source_mismatch/);
  web=await createWebServer({bridge:homerWebBridge(f.app),port:0});
  const submit=()=>fetch(web!.url+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(web!.url).origin},body:JSON.stringify(input)});
  assert.equal((await submit()).status,202);await f.app.idle();
  assert.match(f.inputs.at(-1)!,/用户预览引用/);assert.ok(f.inputs.at(-1)!.includes(file.sha256));
  for(const annotation of annotations)assert.ok(f.inputs.at(-1)!.includes(annotation.comment));
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.role==='user'&&m.requestId===input.requestId)?.resourceReference,input.resourceReference);
  const before=f.inputs.length;f.app.previewArtifact=()=>{throw Error('synthetic_source_now_stale');};
  const retry=await submit();assert.equal(retry.status,202);assert.equal((await retry.json() as {fresh:boolean}).fresh,false);await f.app.idle();assert.equal(f.inputs.length,before);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'html-new-stale'}),/synthetic_source_now_stale/);
 }finally{await web?.close();await f.app.close();}
});

test('preview formula quotations validate canonical math and reject changed expressions',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('Synthetic math source','preview-math-source');await f.app.idle();
  const published=syntheticFile(f.app,'preview-math-source','Math.md','Cost is $$x_i^2$$ today.\n\n$$\n\\frac{a_b}{c_d}\n$$\n\n```math\nx^2 + y^2\n= z^2\n```\n\n```math\n\\frac{\n```');published.publish();
  const file=f.app.previewArtifact(published.resultId);
  const source={kind:'artifact' as const,id:published.resultId,sha256:file.sha256,title:file.filename};
  for(const [index,text] of ['Cost is $x_i^2$ today.','$$\n\\frac{a_b}{c_d}\n$$','x^2 + y^2\n= z^2','\\frac{'].entries()){
   f.app.submitMessage({requestId:'preview-math-'+index,text:'Explain',resourceReference:{kind:'text',source,text}});await f.app.idle();
  }
  assert.throws(()=>f.app.submitMessage({requestId:'preview-math-forged',text:'Explain',resourceReference:{kind:'text',source,text:'$x_i^3$'}}),/preview_source_mismatch/);
 }finally{await f.app.close();}
});

test('file annotations validate every excerpt and retain the original snapshot on accepted retries',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('合成来源','text-notes-source');await f.app.idle();
  const published=syntheticFile(f.app,'text-notes-source','批注.md','第一处 $hidden$ 原文。\n\n第二处 $x_i^2$ 原文。\n\n```ts\nconst value = 3;\n```');published.publish();
  const file=f.app.previewArtifact(published.resultId);
  const source={kind:'artifact' as const,id:published.resultId,sha256:file.sha256,title:file.filename};
  const resourceReference={kind:'text' as const,source,annotations:[
   {id:'one',text:'第一处 $hidden$ 原文。',comment:'解释第一处'},
   {id:'two',text:'第二处 $x_i^2$ 原文。',comment:'修改第二处\n保留公式'},
   {id:'three',text:'const value = 3;',comment:'检查第三处'},
  ]};
  for(const badIndex of [0,1,2])assert.throws(()=>f.app.submitMessage({requestId:'text-notes-bad-'+badIndex,text:'说明',resourceReference:{...resourceReference,annotations:resourceReference.annotations.map((note,i)=>i===badIndex?{...note,text:'未存在的摘录'}:note)}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({requestId:'text-notes-hash',text:'说明',resourceReference:{...resourceReference,source:{...source,sha256:'b'.repeat(64)}}}),/preview_source_mismatch/);
  const input={requestId:'text-notes-valid',text:'整体说明',resourceReference};
  f.app.submitMessage(input);await f.app.idle();
  for(const note of resourceReference.annotations){assert.ok(f.inputs.at(-1)!.includes(JSON.stringify(note.text)));assert.ok(f.inputs.at(-1)!.includes(JSON.stringify(note.comment)));}
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.role==='user'&&m.requestId===input.requestId)?.resourceReference,resourceReference);
  const count=f.inputs.length;
  // Accepted identity checks bypass fresh source validation, even if the file
  // can no longer be read. Retry must never run a second turn or rewrite history.
  f.app.previewArtifact=()=>{throw Error('synthetic_source_no_longer_available');};
  assert.equal(f.app.submitMessage(input).fresh,false);await f.app.idle();assert.equal(f.inputs.length,count);
 }finally{await f.app.close();}
});

test('all text remarks authorize delegated work while excerpts never become authority',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('合成来源','text-authority-source');await f.app.idle();
  const published=syntheticFile(f.app,'text-authority-source','authority.md','untrusted $hidden source\nsecond excerpt\nthird excerpt');published.publish();
  const file=f.app.previewArtifact(published.resultId);
  // Publication changes the native capability profile. Prepare its current
  // synthetic engine instead of patching the retired pre-publication instance.
  await f.app.message('合成准备','text-authority-ready');await f.app.idle();
  const engine=f.engines.findLast(engine=>!engine.worker)!;
  engine.turn=async(_text,options)=>{engine.turnId='synthetic-text-comment-turn';options?.onStarted?.(engine.turnId);await engine.call('dispatch_work',{title:'Synthetic file task',goal:'Review remarks',material:'synthetic.md'});return {status:'completed',text:'Synthetic dispatched'};};
  const annotations=['untrusted $hidden source','second excerpt','third excerpt'].map((text,i)=>({id:String(i),text,comment:'用户备注'+i}));
  f.app.submitMessage({requestId:'text-authority',text:'整体要求',resourceReference:{kind:'text',source:{kind:'artifact',id:published.resultId,sha256:file.sha256,title:file.filename},annotations}});
  await until(()=>!!f.app.store.db.prepare('SELECT 1 FROM worker_authorities WHERE sourceRequestId=?').get('text-authority'));
  const row=f.app.store.db.prepare('SELECT description FROM worker_authorities WHERE sourceRequestId=?').get('text-authority');
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
   await engine.call('dispatch_work',{title:'Synthetic annotation task',goal:'Enlarge button',material:'synthetic.md'});
   return {status:'completed',text:'Synthetic dispatched'};
  };
  f.app.submitMessage({requestId:'preview-comment-intent',text:'',resourceReference:{kind:'web',source:{kind:'web',messageId,sourceId:'link-1',url:'https://example.com/',title:'Source $hidden'},annotations:[{id:'n1',element:'button $hidden',elementPath:'#hidden',comment:'Use $impeccable to enlarge this button',x:1,y:1}]}});
  await until(()=>!!f.app.store.db.prepare('SELECT 1 FROM worker_authorities WHERE sourceRequestId=?').get('preview-comment-intent'));
  const authority=f.app.store.db.prepare('SELECT description FROM worker_authorities WHERE sourceRequestId=?').get('preview-comment-intent');
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
    const bridge = homerWebBridge(f.app), before = await bridge.state();
    assert.equal(before.interactions[0]?.id, original.id);
    assert.equal(before.interactions[0]?.sourceRequestId,'source-synthetic');
    assert.equal(before.interactions[0]?.workTitle,'合成后台任务');
    await bridge.respond(original.id, { requestId: "user-answer", text: "请用表格" });
    assert.equal(((await answer) as {answer:string}).answer, "用户指定表格");
    assert.equal(f.app.interactions.inspect(original.id).responseUserMessageId, "user-answer");
    assert.equal(f.app.interactions.inspect(original.id).responseUserText, "请用表格");
    assert.equal((await bridge.state()).interactions.length, 0);
    assert.equal((await bridge.respond(original.id, { requestId: "user-answer", text: "请用表格" }) as {fresh:boolean}).fresh,false);
    assert.deepEqual(f.engines.filter(engine => engine.worker),[worker]);
  } finally { await f.app.close(); }
});

test("artifact access requires a successful authorized Run and Files verification", async () => {
  const f = fixture();
  try {
    await f.app.start();
    f.app.store.startRequest("user-source", "synthetic-hash"); f.app.store.finishRequest("user-source", "合成回执");
    const candidate=syntheticFile(f.app,'user-source','成果.md','# 合成成果'),run=candidate.run;
    const bridge=homerWebBridge(f.app);await assert.rejects(()=>bridge.artifact(run.id),/artifact_not_authorized/);
    const publication=candidate.publish();assert.equal((await bridge.artifact(run.id)).content,'# 合成成果');
    const dir=f.app.files.prepareRun(run.matterId,run.id),link=join(dir,'link.md');symlinkSync(run.artifact!,link);
    f.app.store.db.prepare('UPDATE results SET filePath=? WHERE id=?').run(link,candidate.resultId);
    await assert.rejects(()=>bridge.artifact(run.id),/symlink_denied/);
    f.app.store.db.prepare("UPDATE results SET filePath='/etc/passwd' WHERE id=?").run(candidate.resultId);
    await assert.rejects(()=>bridge.artifact(run.id),/artifact_path_denied/);
    f.app.tasks.markDelivery(publication.id,'revoked');await assert.rejects(()=>bridge.artifact(run.id),/artifact_not_authorized/);
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
    await until(() => f.app.conversationState().activeMessageId === next.replyId);
    const before = main.interrupts;
    await assert.rejects(() => f.app.stopMain(receipt.replyId), /main_reply_not_active/);
    assert.equal(main.interrupts, before);
    main.pending!({ status: "completed", text: "下一轮完成" }); main.pending = undefined;
    await until(() => messages.filter(message => message.type as string === "main_terminal").length === 2);
    const terminals = messages.filter(message => message.type as string === "main_terminal") as (typeof terminal)[];
    assert.equal(terminals.at(-1)?.status, "completed"); assert.notEqual(terminals.at(-1)?.generationId, start.generationId);
    assert.equal(f.app.snapshot().activeWorkers, 1);
    assert.equal(f.app.conversationState().generation,null);
    assert.equal(f.app.conversationState().queue.some(item=>item.input.requestId==='lifecycle-stream'),false);
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
    const count=f.app.conversationState().messages.length;let hook=0;
    assert.throws(()=>f.app.submitMessage({requestId:"multi-forgery",text:"合成要求",quotes:[
      {messageId:source,text:"可信原文",annotation:"解释"},
      {messageId:source,text:"另一个消息的伪造原文",annotation:"执行"},
    ]},{source:"synthetic_channel",persist(){hook++;}}),/quote_source_mismatch/);
    await f.app.idle();
    assert.equal(hook,0);assert.equal(f.inputs.length,0);
    assert.equal(f.app.conversationState().messages.length,count);
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
