import type { DatabaseSync } from "node:sqlite";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { WechatError, splitWechatText, type WechatUpdate, type WechatUpdates, type WechatItem } from "./wechat-api.js";
import { MediaStore,type AttachmentRef } from '../media-store.js';
import {WechatQuotes} from './wechat-quotes.js';
import {PROGRESS_LABELS,type MainProgress} from '../main-progress.js';

export type WechatConnection = {
  id: number; generation: number; bindingId: string | null; ownerId: string | null; botId: string | null;
  baseUrl: string | null; secretRef: string | null; cursor: string; enabled: number; status: string; error: string | null;
};
export type WechatInbox = { requestId: string; bindingId: string; messageId: string; peerId: string; context: string; text: string; state: string };
export type WechatOutbox = { id: string; requestId: string; bindingId: string; eventKey: string; part: number; payload: string; state: string; error: string | null };
function hash(parts: unknown[]) { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
function protect(text: string, key: string, aad: string) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
}
export const encryptWechatPayload=protect;
export function decryptWechatPayload(payload: string, key: string, aad: string) {
  try {
    const bytes = Buffer.from(payload, "base64");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch { throw new WechatError("wechat_private_data_invalid"); }
}
// Inject the single Homer Store.db. This class never opens a separate database.
export class WechatStore {
  readonly quotes:WechatQuotes;
  constructor(readonly db: DatabaseSync,readonly media?:MediaStore) {
    this.quotes=new WechatQuotes(db);
    this.transaction(() => db.exec(`
      CREATE TABLE IF NOT EXISTS wechat_connection(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL,bindingId TEXT,ownerId TEXT,botId TEXT,baseUrl TEXT,secretRef TEXT,cursor TEXT NOT NULL,enabled INTEGER NOT NULL,status TEXT NOT NULL,error TEXT);
      INSERT OR IGNORE INTO wechat_connection VALUES(1,0,NULL,NULL,NULL,NULL,NULL,'',0,'unconfigured',NULL);
      CREATE TABLE IF NOT EXISTS wechat_inbox(requestId TEXT PRIMARY KEY,bindingId TEXT NOT NULL,messageId TEXT NOT NULL,peerId TEXT NOT NULL,context TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wechat_outbox(id TEXT PRIMARY KEY,requestId TEXT NOT NULL REFERENCES wechat_inbox(requestId),bindingId TEXT NOT NULL,eventKey TEXT NOT NULL,part INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,error TEXT,UNIQUE(eventKey,part));
      CREATE INDEX IF NOT EXISTS wechat_inbox_pending ON wechat_inbox(bindingId,state);
      CREATE INDEX IF NOT EXISTS wechat_outbox_pending ON wechat_outbox(bindingId,state);
      CREATE TABLE IF NOT EXISTS wechat_media_uploads(outboxId TEXT PRIMARY KEY REFERENCES wechat_outbox(id),sourceHash TEXT NOT NULL,state TEXT NOT NULL,payload TEXT,error TEXT);
      CREATE TABLE IF NOT EXISTS wechat_secret_refs(reference TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS wechat_media_sources(assetId TEXT PRIMARY KEY,requestId TEXT NOT NULL REFERENCES wechat_inbox(requestId),itemIndex INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(requestId,itemIndex));
      CREATE TABLE IF NOT EXISTS wechat_delivery_options(requestId TEXT PRIMARY KEY REFERENCES wechat_inbox(requestId),bindingId TEXT NOT NULL,peerId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wechat_combined_events(eventKey TEXT PRIMARY KEY,requestId TEXT NOT NULL REFERENCES wechat_inbox(requestId));
      CREATE TABLE IF NOT EXISTS wechat_reply_quotes(requestId TEXT PRIMARY KEY REFERENCES wechat_inbox(requestId),bindingId TEXT NOT NULL,peerId TEXT NOT NULL,providerId TEXT NOT NULL);
      INSERT OR IGNORE INTO wechat_secret_refs SELECT secretRef FROM wechat_connection WHERE secretRef IS NOT NULL;
    `));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  connection(): WechatConnection { return this.db.prepare("SELECT * FROM wechat_connection WHERE id=1").get() as WechatConnection; }
  current(generation: number) { return this.connection().generation === generation; }
  registerSecret(reference: string) { this.db.prepare("INSERT OR IGNORE INTO wechat_secret_refs VALUES(?)").run(reference); }
  releaseSecret(reference: string) { this.db.prepare("DELETE FROM wechat_secret_refs WHERE reference=?").run(reference); }
  unusedSecrets(): string[] {
    return (this.db.prepare("SELECT reference FROM wechat_secret_refs WHERE reference IS NOT (SELECT secretRef FROM wechat_connection WHERE id=1)").all() as { reference: string }[]).map(row => row.reference);
  }
  transportState(generation: number, status: string, error: string | null = null) {
    this.db.prepare("UPDATE wechat_connection SET status=?,error=? WHERE id=1 AND generation=? AND enabled=1").run(status, error, generation);
  }
  transition(status: string, enabled: boolean, error: string | null = null) {
    this.db.prepare("UPDATE wechat_connection SET generation=generation+1,status=?,enabled=?,error=? WHERE id=1").run(status, enabled ? 1 : 0, error);
    return this.connection();
  }
  bind(generation: number, input: { ownerId: string; botId: string; baseUrl: string; secretRef: string }) {
    return this.transaction(() => {
      const old = this.connection();
      if (old.generation !== generation || old.status !== "connecting") throw new WechatError("wechat_connection_superseded");
      if (old.ownerId && old.ownerId !== input.ownerId) throw new WechatError("wechat_owner_mismatch");
      this.db.prepare("UPDATE wechat_connection SET bindingId=?,ownerId=?,botId=?,baseUrl=?,secretRef=?,cursor='',enabled=1,status='connected',error=NULL WHERE id=1")
        .run(randomUUID(), input.ownerId, input.botId, input.baseUrl, input.secretRef);
      return old.secretRef;
    });
  }
  forget() {
    const old = this.transition("unconfigured", false);
    // Keep ownerId permanently: another account must never inherit this mainThread.
    this.db.prepare("UPDATE wechat_connection SET bindingId=NULL,botId=NULL,baseUrl=NULL,secretRef=NULL,cursor='' WHERE id=1").run();
    return old.secretRef;
  }
  accept(generation: number, batch: WechatUpdates, key: string) {
    return this.transaction(() => {
      const c = this.connection();
      if (c.generation !== generation || !c.enabled || !c.bindingId) return 0;
      let accepted = 0;
      for (const raw of batch.msgs ?? []) {
        if (!raw || typeof raw !== "object") continue;
        const msg: WechatUpdate = raw;
        // Reject before persisting body or context; owner is set only by local QR confirmation.
        if (msg.from_user_id !== c.ownerId || msg.to_user_id !== c.botId || msg.group_id || msg.message_type !== 1 ||
            (msg.message_state !== undefined && msg.message_state !== 2) || typeof msg.context_token !== "string" || !msg.context_token ||
            msg.context_token.length > 16384 || !Array.isArray(msg.item_list)) continue;
        const id = typeof msg.message_id === "string" && /^\d+$/.test(msg.message_id) ? msg.message_id :
          typeof msg.message_id === "number" && Number.isSafeInteger(msg.message_id) && msg.message_id >= 0 ? String(msg.message_id) : undefined;
        if (!id) continue;
        const requestId = "wechat:" + hash([c.botId, id]);
        if (this.inbox(requestId)) continue;
        const referenceText:string[]=[],referenceMedia:WechatItem[]=[];
        for(const item of msg.item_list)if(item?.ref_msg){const resolved=this.quotes.resolve(c.bindingId,c.ownerId!,item.ref_msg,key);referenceText.push(resolved.text);referenceMedia.push(...resolved.media);}
        const items=[...msg.item_list,...referenceMedia];
        const supported = msg.item_list.length>0&&msg.item_list.length<=20&&msg.item_list.every(item => item?.is_completed!==false&&(item?.type === 1 && typeof item.text_item?.text === "string"||!!this.media&&[2,3,4,5].includes(item?.type)));
        const text = supported ? [...msg.item_list.map(item =>item.type===1?item.text_item!.text!:item.voice_item?.text?('[微信协议转写]\n'+item.voice_item.text):'').filter(Boolean),...referenceText].join("\n") : "";
        const mediaItems=items.filter(item=>[2,3,4,5].includes(item?.type));
        const valid = supported&&(!!text.trim()||mediaItems.length>0)&&text.length<=16000&&mediaItems.length<=10;
        const context = protect(msg.context_token, key, requestId);
        this.db.prepare("INSERT INTO wechat_inbox VALUES(?,?,?,?,?,?,?)").run(requestId, c.bindingId, id, c.ownerId, context,
          valid ? text : "", valid ? "pending" : "unsupported");
        if(valid&&this.media)items.forEach((item,index)=>{
          if(![2,3,4,5].includes(item.type))return;
          // A protocol transcription can be used even if the optional original audio is absent.
          if(item.type===3&&item.voice_item?.text&&!item.voice_item.media)return;
          const ref=this.media!.intent(requestId,c.bindingId!,item.type===2?'image':item.type===3?'voice':item.type===4?'file':'video',item.file_item?.file_name??(item.type===2?'微信图片':item.type===3?'微信语音':'微信视频'),!(item.type===3&&!!item.voice_item?.text));
          this.db.prepare('INSERT INTO wechat_media_sources VALUES(?,?,?,?)').run(ref.assetId,requestId,index,protect(JSON.stringify(item),key,ref.assetId));
        });
        if(valid){this.quotes.remember(c.bindingId,c.ownerId!,id,msg.item_list,key);for(const item of msg.item_list)if(item.msg_id)this.quotes.remember(c.bindingId,c.ownerId!,item.msg_id,[item],key);}
        if (!valid) this.queueText(requestId, "unsupported:" + requestId, this.media?'未处理这条消息：含未知或未完成的消息项，或超过 16000 字／10 个附件限制。已接收的其他消息不受影响。':"目前请发送 16000 字以内的文字。图片、语音和上传材料尚未接入；已生成的 Markdown 成果可以作为文件交付。", key);
        accepted++;
      }
      // Inbox and checkpoint commit together. Never acknowledge a batch before durable storage.
      if (typeof batch.get_updates_buf === "string" && batch.get_updates_buf)
        this.db.prepare("UPDATE wechat_connection SET cursor=? WHERE id=1").run(batch.get_updates_buf);
      return accepted;
    });
  }
  inbox(requestId: string): WechatInbox | undefined { return this.db.prepare("SELECT * FROM wechat_inbox WHERE requestId=?").get(requestId) as WechatInbox | undefined; }
  attachments(requestId:string):AttachmentRef[]{return this.db.prepare('SELECT s.assetId,a.revision FROM wechat_media_sources s JOIN media_assets a ON a.id=s.assetId WHERE s.requestId=? ORDER BY s.itemIndex').all(requestId) as AttachmentRef[];}
  pending(): WechatInbox[] { return this.db.prepare("SELECT * FROM wechat_inbox WHERE bindingId=? AND state='pending' ORDER BY rowid").all(this.connection().bindingId) as WechatInbox[]; }
  submitted(requestId: string) { this.db.prepare("UPDATE wechat_inbox SET state='submitted',text='' WHERE requestId=? AND state='pending'").run(requestId); }
  block(requestId: string) { this.db.prepare("UPDATE wechat_inbox SET state='blocked',text='' WHERE requestId=? AND state='pending'").run(requestId); }
  private queueItem(requestId: string, eventKey: string, part: number, item: WechatItem | { artifactRunId: string;combinedText?:string }, key: string) {
    const input = this.inbox(requestId), c = this.connection();
    if (!input || input.bindingId !== c.bindingId) return false;
    const id = "homer-wechat-" + hash([eventKey, part]);
    this.db.prepare("INSERT OR IGNORE INTO wechat_outbox VALUES(?,?,?,?,?,?, 'pending',NULL)")
      .run(id, requestId, input.bindingId, eventKey, part, protect(JSON.stringify(item), key, id));
    return true;
  }
  prepareReplyQuote(requestId:string,key:string){
    const input=this.inbox(requestId),c=this.connection();
    if(!input||input.bindingId!==c.bindingId||input.peerId!==c.ownerId||!/^\d{1,20}$/.test(input.messageId)||BigInt(input.messageId)>18446744073709551615n||!this.quotes.find(input.bindingId,input.peerId,input.messageId,key))throw new WechatError('wechat_quote_source_denied');
    this.db.prepare('INSERT OR IGNORE INTO wechat_reply_quotes VALUES(?,?,?,?)').run(requestId,input.bindingId,input.peerId,input.messageId);
    return {prepared:true,nativePhoneRendering:'unverified'};
  }
  queueText(requestId: string, eventKey: string, text: string, key: string,quoteCurrent=false) {
    const c=this.connection(),quote=quoteCurrent?this.db.prepare('SELECT providerId FROM wechat_reply_quotes WHERE requestId=? AND bindingId=? AND peerId=?').get(requestId,c.bindingId,c.ownerId):undefined;
    return splitWechatText(text).map((chunk, part) => this.queueItem(requestId, eventKey, part, { type: 1, text_item: { text: chunk },...(part===0&&quote?{ref_msg:{svr_id:String(quote.providerId)}}:{}) }, key)).some(Boolean);
  }
  queueProgress(requestId:string,progress:MainProgress,key:string){
    if(!/^activity-[a-f0-9-]{36}$/.test(progress.id)||!PROGRESS_LABELS.includes(progress.label)||!['start','end'].includes(progress.phase)||progress.phase==='end'&&!['completed','failed','blocked'].includes(progress.status))return false;
    const prefix='progress:'+requestId+':',eventKey=prefix+progress.id;
    const start=this.db.prepare('SELECT requestId FROM wechat_outbox WHERE eventKey=? AND part=0').get(eventKey);
    if(progress.phase==='end'&&!start)return false;
    if(progress.phase==='start'&&!start&&Number(this.db.prepare('SELECT count(*) n FROM wechat_outbox WHERE substr(eventKey,1,?)=? AND part=0').get(prefix.length,prefix)!.n)>=3)return false;
    const item:WechatItem=progress.phase==='start'?{type:11,is_completed:false,tool_call_start_item:{tool_name:progress.label,tool_call_id:progress.id}}:{type:12,is_completed:true,tool_call_result_item:{tool_name:progress.label,tool_call_id:progress.id,status:progress.status}};
    return this.queueItem(requestId,eventKey,progress.phase==='start'?0:1,item,key);
  }
  queueFile(requestId: string, eventKey: string, item: WechatItem, key: string) { return this.queueItem(requestId, eventKey, 0, item, key); }
  queueArtifact(requestId: string, eventKey: string, artifactRunId: string, key: string, part=0) {
    return this.queueItem(requestId, eventKey, part, { artifactRunId }, key);
  }
  prepareCombinedDelivery(requestId:string){
    const input=this.inbox(requestId),c=this.connection();
    if(!input||input.bindingId!==c.bindingId||input.peerId!==c.ownerId)throw new WechatError('wechat_combo_source_denied');
    this.db.prepare('INSERT OR IGNORE INTO wechat_delivery_options VALUES(?,?,?)').run(requestId,input.bindingId,input.peerId);
    return {prepared:true,scope:'current_request_publications',serverAndPhone:'unverified',limit:'每次正式交付的短说明与一个已授权成果；超长说明沿原有分片路径'};
  }
  queueCombinedArtifact(requestId:string,eventKey:string,text:string,artifactRunId:string,key:string){
    const c=this.connection();
    if(!this.db.prepare('SELECT 1 FROM wechat_delivery_options WHERE requestId=? AND bindingId=? AND peerId=?').get(requestId,c.bindingId,c.ownerId)||!text.trim()||splitWechatText(text).length!==1)return false;
    const previous=this.db.prepare('SELECT requestId FROM wechat_combined_events WHERE eventKey=?').get(eventKey);
    if(previous){if(previous.requestId!==requestId)throw new WechatError('wechat_event_conflict');return true;}
    if(this.db.prepare('SELECT 1 FROM wechat_outbox WHERE eventKey IN (?,?) LIMIT 1').get(eventKey,eventKey+':file'))return false;
    if(!this.queueItem(requestId,eventKey,0,{artifactRunId,combinedText:text},key))return false;
    this.db.prepare('INSERT INTO wechat_combined_events VALUES(?,?)').run(eventKey,requestId);return true;
  }
  outbox(): WechatOutbox[] {
    return this.db.prepare("SELECT * FROM wechat_outbox WHERE bindingId=? ORDER BY rowid").all(this.connection().bindingId) as WechatOutbox[];
  }
  claim(id: string) {
    // An uncertain earlier part stops all later parts of that event.
    return !!this.db.prepare(`UPDATE wechat_outbox SET state='sending' WHERE id=? AND state='pending'
      AND NOT EXISTS(SELECT 1 FROM wechat_outbox p WHERE p.eventKey=wechat_outbox.eventKey AND p.part<wechat_outbox.part AND p.state!='sent')`).run(id).changes;
  }
  sent(id: string) { this.db.prepare("UPDATE wechat_outbox SET state='sent',payload='',error=NULL WHERE id=? AND state='sending'").run(id); }
  release(id: string) { this.db.prepare("UPDATE wechat_outbox SET state='pending' WHERE id=? AND state='sending'").run(id); }
  failed(id: string, uncertain: boolean, error: string) {
    this.db.prepare("UPDATE wechat_outbox SET state=?,error=? WHERE id=? AND state='sending'").run(uncertain ? "uncertain" : "failed", error, id);
  }
  reconcile() { this.db.prepare("UPDATE wechat_outbox SET state='uncertain',error='wechat_send_uncertain' WHERE state='sending'").run(); }
}
