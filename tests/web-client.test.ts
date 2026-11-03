import { test } from "node:test";
import assert from "node:assert/strict";
import { canAcceptInput, canSubmitMessage, prepareMessage, prepareInteractionResponse } from "../ui/conversation-client.js";

test('Web attachment send keeps uploaded request identity and exact refs on retry',()=>{
 const refs=[{assetId:'asset-00000000-0000-0000-0000-000000000001',revision:1}];
 const input=prepareMessage('',undefined,undefined,()=> 'upload-request',refs);
 assert.deepEqual(input,{requestId:'upload-request',text:'',attachments:refs});
 assert.equal(prepareMessage('',undefined,input,()=> 'new',refs),input);
 assert.equal(prepareMessage('changed',undefined,input,()=> 'new',refs).requestId,'new');
 assert.equal(prepareMessage('text',undefined,input,()=> 'new',[]).attachments,undefined);
});

test('queue editor accepts retained attachments but cannot save an empty message after removing the last one',()=>{
 const refs=[{assetId:'asset-00000000-0000-0000-0000-000000000001',revision:1}];
 assert.equal(canSubmitMessage('',[],refs),true);
 assert.equal(canSubmitMessage('',[],[]),false);
 assert.equal(canSubmitMessage('保留说明',[],[]),true);
});

test("unconfirmed send retries the same request only while text and source quote are unchanged", () => {
  const pending = { requestId: "synthetic-original", text: "补充要求", quote: { messageId: "message-source", text: "选中原文" } };
  let generated = 0;
  const newId = () => "synthetic-new-" + ++generated;
  assert.equal(prepareMessage(pending.text, { ...pending.quote }, pending, newId).requestId, pending.requestId);
  assert.equal(generated, 0);
  assert.equal(prepareMessage("修改要求", pending.quote, pending, newId).requestId, "synthetic-new-1");
  assert.equal(prepareMessage(pending.text, { ...pending.quote, messageId: "message-another" }, pending, newId).requestId, "synthetic-new-2");
  assert.equal(prepareMessage(pending.text, undefined, pending, newId).requestId, "synthetic-new-3");
  assert.deepEqual(prepareMessage(pending.text, pending.quote, undefined, newId).quote, pending.quote);
});


test("an unconfirmed card answer retains its request identity only for the same interaction and text", () => {
  const pending = { requestId: "synthetic-card-original", text: "允许本次读取", interactionId: "interaction-original" };
  let generated = 0;
  const newId = () => "synthetic-card-new-" + ++generated;
  assert.deepEqual(prepareInteractionResponse(pending.text, pending.interactionId, pending, newId), pending);
  assert.equal(generated, 0);
  assert.equal(prepareInteractionResponse("拒绝本次读取", pending.interactionId, pending, newId).requestId, "synthetic-card-new-1");
  assert.equal(prepareInteractionResponse(pending.text, "interaction-next", pending, newId).requestId, "synthetic-card-new-2");
  assert.equal(prepareInteractionResponse(pending.text, pending.interactionId, undefined, newId).interactionId, pending.interactionId);
});


test("durable gateway permits normal input across a handoff while old hosts and disconnected clients remain fenced",()=>{
  assert.equal(canAcceptInput(true,{phase:'preparing',accepting:true}),true);
  assert.equal(canAcceptInput(true,{phase:'starting',accepting:true}),true);
  assert.equal(canAcceptInput(false,{phase:'running',accepting:true}),false);
  assert.equal(canAcceptInput(true,{phase:'preparing'}),false);
  assert.equal(canAcceptInput(true,{phase:'running'}),true);
  assert.equal(canAcceptInput(true,{phase:'running',accepting:false}),false);
});

test('structured composer restores every legacy draft annotation without changing pending payload',async()=>{
 const {singleComposerDraft}=await import('../ui/conversation-client.js');
 const draft={text:'原说明',quotes:[{messageId:'a',text:'第一段',annotation:'甲要求'},{messageId:'b',text:'第二段',annotation:'乙要求'}]};
 const before=JSON.stringify(draft),restored=singleComposerDraft(draft);
 assert.equal(restored.text,draft.text);assert.deepEqual(restored.quotes,draft.quotes);assert.equal(restored.notice,undefined);
 assert.equal(JSON.stringify(draft),before);
 const single=singleComposerDraft({text:'说明',quotes:[{messageId:'a',text:'原文',annotation:''}]});assert.equal(single.quotes.length,1);assert.equal(single.text,'说明');
});
