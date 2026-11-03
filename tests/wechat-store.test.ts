import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { WechatStore, decryptWechatPayload } from "../src/channels/wechat-store.js";
import { splitWechatText } from "../src/channels/wechat-api.js";
const key = "ab".repeat(32);
function setup() {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  const store = new WechatStore(db);
  const c = store.transition("connecting", false);
  store.bind(c.generation, { ownerId: "owner", botId: "bot", baseUrl: "https://ilinkai.weixin.qq.com", secretRef: "fixture" });
  return { db, store, generation: c.generation };
}
const message = (id: string, context = "context-" + id) => ({message_id:id,from_user_id:"owner",to_user_id:"bot",message_type:1,message_state:2,context_token:context,item_list:[{type:1,text_item:{text:"合成输入 " + id}}]});
test('ILINK-EXTRA-002 combined publication is opt-in, one durable operation and never merges old parts',()=>{
 const {db,store,generation}=setup();try{
  store.accept(generation,{msgs:[message('9702')]},key);const request=store.pending()[0]!.requestId;
  assert.equal(store.queueCombinedArtifact(request,'bundle','说明','run-synthetic',key),false);
  store.prepareCombinedDelivery(request);
  assert.equal(store.queueCombinedArtifact(request,'bundle','说明','run-synthetic',key),true);
  assert.equal(store.outbox().length,1);const row=store.outbox()[0]!;
  assert.deepEqual(JSON.parse(decryptWechatPayload(row.payload,key,row.id)),{artifactRunId:'run-synthetic',combinedText:'说明'});
  assert.equal(store.claim(row.id),true);store.failed(row.id,true,'wechat_send_uncertain');
  assert.equal(store.queueCombinedArtifact(request,'bundle','说明','run-synthetic',key),true);assert.equal(store.claim(row.id),false);assert.equal(store.outbox().length,1);
  store.queueText(request,'legacy','旧分片',key);assert.equal(store.queueCombinedArtifact(request,'legacy','说明','run-synthetic',key),false);
  assert.equal(store.queueCombinedArtifact(request,'large','字'.repeat(2000),'run-synthetic',key),false);
  assert.throws(()=>store.prepareCombinedDelivery('foreign'),/wechat_combo_source_denied/);
  db.prepare('UPDATE wechat_connection SET bindingId=?').run('foreign');assert.throws(()=>store.prepareCombinedDelivery(request),/wechat_combo_source_denied/);
 }finally{db.close();}
});
test('ILINK-EXTRA-001 opt-in outgoing quote is tied to original owner input and only the first reply part',()=>{
 const {db,store,generation}=setup();try{
  store.accept(generation,{msgs:[message('18446744073709551615')]},key);const input=store.pending()[0]!;
  store.prepareReplyQuote(input.requestId,key);store.queueText(input.requestId,'quoted-reply','字'.repeat(2000),key,true);
  const rows=store.outbox(),items=rows.map(row=>JSON.parse(decryptWechatPayload(row.payload,key,row.id)));
  assert.equal(items[0].ref_msg.svr_id,'18446744073709551615');assert.equal(items[1].ref_msg,undefined);
  store.queueText(input.requestId,'ordinary-status','状态',key);const last=store.outbox().at(-1)!;assert.equal(JSON.parse(decryptWechatPayload(last.payload,key,last.id)).ref_msg,undefined);
  assert.throws(()=>store.prepareReplyQuote('unknown',key),/wechat_quote_source_denied/);
  db.prepare('UPDATE wechat_connection SET bindingId=?').run('other-binding');assert.throws(()=>store.prepareReplyQuote(input.requestId,key),/wechat_quote_source_denied/);
 }finally{db.close();}
});
test("owner binds from local QR and strangers cannot claim or persist bodies", () => {
  const { db, store, generation } = setup();
  try {
    store.accept(generation,{msgs:[{...message("1"),from_user_id:"stranger"},{...message("2"),to_user_id:"wrong-bot"},{...message("3"),group_id:"group"}],get_updates_buf:"next"},key);
    assert.equal(store.pending().length,0); assert.equal(store.connection().ownerId,"owner"); assert.equal(store.connection().cursor,"next");
    const reconnect = store.transition("connecting",false);
    assert.throws(() => store.bind(reconnect.generation,{ownerId:"other",botId:"bot",baseUrl:"https://ilinkai.weixin.qq.com",secretRef:"new"}), /owner_mismatch/);
    assert.equal(store.connection().ownerId,"owner");
  } finally { db.close(); }
});
test("duplicate updates and reconnect batches create one durable request with original context", () => {
  const { db, store, generation } = setup();
  try {
    assert.equal(store.accept(generation,{msgs:[message("18446744073709551615")],get_updates_buf:"cursor-1"},key),1);
    const input = store.pending()[0]!;
    assert.equal(decryptWechatPayload(input.context,key,input.requestId),"context-18446744073709551615");
    assert.equal(store.accept(generation,{msgs:[message("18446744073709551615","overwritten")],get_updates_buf:"cursor-2"},key),0);
    assert.equal(store.pending()[0]!.context,input.context); assert.equal(store.connection().cursor,"cursor-2");
    store.submitted(input.requestId);
    assert.equal(store.pending().length,0); assert.equal(store.inbox(input.requestId)!.text,"");
    assert.equal(store.accept(generation,{msgs:[message("18446744073709551615")]},key),0);
  } finally { db.close(); }
});
test("cursor never commits when inbox write fails", () => {
  const { db, store, generation } = setup();
  try {
    db.exec("CREATE TRIGGER reject_wechat BEFORE INSERT ON wechat_inbox BEGIN SELECT RAISE(ABORT,'fixture_storage_failure'); END");
    assert.throws(() => store.accept(generation,{msgs:[message("1")],get_updates_buf:"lost"},key),/fixture_storage_failure/);
    assert.equal(store.connection().cursor,""); assert.equal(store.pending().length,0);
    db.exec("DROP TRIGGER reject_wechat");
    assert.equal(store.accept(generation,{msgs:[message("1")],get_updates_buf:"kept"},key),1);
  } finally { db.close(); }
});
test("old generations cannot ingest after disable or replacement", () => {
  const { db, store, generation } = setup();
  try {
    store.transition("disabled",false);
    assert.equal(store.accept(generation,{msgs:[message("1")],get_updates_buf:"stale"},key),0);
    assert.equal(store.connection().cursor,"");
    store.forget(); assert.equal(store.connection().ownerId,"owner");
  } finally { db.close(); }
});
test("outbox protects payload and context ownership; uncertain send never becomes retryable on restart", () => {
  const { db, store, generation } = setup();
  try {
    store.accept(generation,{msgs:[message("1"),message("2")]},key);
    const [one,two] = store.pending();
    assert.ok(one && two);
    const text = "合成😺".repeat(2000);
    store.transaction(() => store.queueText(one.requestId,"event-1",text,key));
    store.transaction(() => store.queueText(one.requestId,"event-1",text,key));
    const out = store.outbox(); assert.ok(out.length>1);
    assert.equal(out.map(row=>JSON.parse(decryptWechatPayload(row.payload,key,row.id)).text_item.text).join(""),text);
    assert.throws(()=>decryptWechatPayload(one.context,key,two.requestId),/private_data_invalid/);
    assert.equal(store.claim(out[0]!.id),true); store.reconcile();
    assert.equal(store.outbox()[0]!.state,"uncertain"); assert.equal(store.claim(out[0]!.id),false); assert.equal(store.claim(out[1]!.id),false);
    const c = store.transition("connecting",false);
    store.bind(c.generation,{ownerId:"owner",botId:"new-bot",baseUrl:"https://ilinkai.weixin.qq.com",secretRef:"new"});
    assert.equal(store.outbox().length,0); assert.equal(store.queueText(one.requestId,"late-old-task","private result",key),false);
  } finally { db.close(); }
});
test("unicode chunks preserve text and remain within a conservative byte budget", () => {
  const text = "中文😀\n".repeat(1500), parts = splitWechatText(text);
  assert.equal(parts.join(""),text); assert.ok(parts.every(part=>Buffer.byteLength(part)<=3500));
  assert.throws(()=>splitWechatText(text,1));
});

test("ILINK-OUT-04 uncertain text blocks the artifact in the same visible event across restart",()=>{
 const {db,store,generation}=setup();try{
  store.accept(generation,{msgs:[message('55')]},key);const input=store.pending()[0]!;
  store.queueText(input.requestId,'paired-event','text',key);store.queueArtifact(input.requestId,'paired-event','run',key,1);
  const rows=store.outbox();assert.equal(rows.length,2);assert.equal(rows[1]!.part,1);
  assert.equal(store.claim(rows[1]!.id),false);assert.equal(store.claim(rows[0]!.id),true);store.failed(rows[0]!.id,true,'wechat_send_uncertain');
  const restored=new WechatStore(db);restored.reconcile();assert.equal(restored.claim(rows[1]!.id),false);
  assert.equal(restored.outbox()[0]!.state,'uncertain');
 }finally{db.close();}
});
