import { basename } from "node:path";
import type { Homer, Message } from "../service.js";
import { WechatApi, WechatError } from "./wechat-api.js";
import { WechatChannel, type WechatBridge } from "./wechat-channel.js";
import { MacWechatSecrets, type WechatSecrets } from "./wechat-secrets.js";
import { WechatManagement } from "./wechat-management.js";

type Receipt = { requestId: string; replyId: string; bindingId: string; peerId: string; messageId: string };

// The service host owns this adapter and composes onMessage into its existing sink.
// It never constructs a Homer, an engine, a thread or another database.
export class HomerWechat implements WechatBridge {
  readonly channel: WechatChannel;
  readonly management: WechatManagement;
  constructor(readonly app: Homer, api = new WechatApi(), secrets: WechatSecrets = new MacWechatSecrets()) {
    this.channel = new WechatChannel(app.store.db, this, api, secrets,app.media);
    app.registerChannelCapabilities('wechat',()=>({...this.channel.status(),direction:'bound_owner_only'}));
    app.registerReplyQuote(requestId=>this.authorized(requestId)?this.channel.prepareReplyQuote(requestId):Promise.reject(new WechatError('wechat_quote_source_denied')));
    app.registerCombinedDelivery(requestId=>this.authorized(requestId)?this.channel.prepareCombinedDelivery(requestId):Promise.reject(new WechatError('wechat_combo_source_denied')));
    this.management = new WechatManagement(this.channel, () => this.recoverReplies());
    app.store.db.exec(`CREATE TABLE IF NOT EXISTS wechat_homer_receipts(
      requestId TEXT PRIMARY KEY REFERENCES wechat_inbox(requestId),
      replyId TEXT NOT NULL UNIQUE REFERENCES conversation_messages(id)
    )`);
  }
  private receipt(requestId: string): Receipt | undefined {
    return this.app.store.db.prepare(`SELECT r.*,i.bindingId,i.peerId,i.messageId FROM wechat_homer_receipts r
      JOIN wechat_inbox i ON i.requestId=r.requestId WHERE r.requestId=?`).get(requestId) as Receipt | undefined;
  }
  private authorized(requestId: string) {
    const input = this.channel.store.inbox(requestId), connection = this.channel.store.connection();
    return !!input && !!this.receipt(requestId) && input.bindingId === connection.bindingId && input.peerId === connection.ownerId;
  }
  async submit(input: Parameters<WechatBridge["submit"]>[0]) {
    const row = this.channel.store.inbox(input.requestId), connection = this.channel.store.connection(), origin = input.origin;
    if (!row || !connection.enabled || row.bindingId !== connection.bindingId || row.peerId !== connection.ownerId ||
      origin.channel !== "wechat" || origin.bindingGeneration !== row.bindingId || origin.peerId !== row.peerId ||
      origin.botId !== connection.botId || origin.messageId !== row.messageId ||
      (row.state === "pending" && row.text !== input.text)) throw new WechatError("wechat_origin_mismatch");
    if(JSON.stringify(input.attachments??[])!==JSON.stringify(this.channel.store.attachments(input.requestId)))throw new WechatError('wechat_origin_mismatch');
    // Legacy requests without common history must not be adopted either.
    if (!this.receipt(input.requestId) && this.app.store.request(input.requestId))
      throw new WechatError("request_id_conflict");
    return this.app.submitMessage({ requestId: input.requestId, text: input.text,...(input.attachments?.length?{attachments:input.attachments}:{}) }, {
      source: "wechat",
      // Synchronous SQL only, inside the service's history transaction. The
      // service starts its main queue only after this transaction has committed.
      persist: accepted => {
        const previous = this.receipt(input.requestId);
        if (accepted.fresh) {
          if (previous) throw new WechatError("request_id_conflict");
          this.app.store.db.prepare("INSERT INTO wechat_homer_receipts VALUES(?,?)").run(input.requestId, accepted.replyId);
        } else if (!previous || previous.replyId !== accepted.replyId || previous.bindingId !== origin.bindingGeneration ||
          previous.peerId !== origin.peerId || previous.messageId !== origin.messageId) throw new WechatError("request_id_conflict");
      },
    });
  }
  mediaChanged(){this.app.mediaChanged();}
  async artifact(runId: string) {
    const verified=this.app.tasks.publishedArtifact(runId);
    if(!verified?.routeSourceRequestId||!this.authorized(verified.routeSourceRequestId))throw new WechatError('artifact_not_authorized');
    const file=this.app.files.resultBytes(this.app.files.prepareRun(this.app.tasks.run(runId).matterId,runId),verified.path);
    return { filename: basename(verified.path), bytes:file.data,mime:file.mime,sha256:file.sha256 };
  }
  async onMessage(message: Message): Promise<boolean> {
    if(message.type==='coordination'){
      const output=message.messageId?this.app.processes.coordination(message.messageId):undefined;
      if(!output||output.text!==message.text||!this.authorized(output.sourceRequestId))return false;
      if(output.interactionId){
        const item=this.app.interactions.inspect(output.interactionId);
        if(item.userQuestion){
          if(item.state!=='pending_user'||this.app.store.run(item.runId)?.sourceRequestId!==output.sourceRequestId)return false;
          message={type:'question',runId:item.runId,interactionId:item.id,requestId:output.sourceRequestId,text:output.text};
        }
      }
      if(message.type==='coordination')return this.channel.publish({eventId:'homer-wechat:coordination:'+output.messageId,requestId:output.sourceRequestId,type:'coordination',text:output.text});
    }
    if(message.type==='tool_progress'){
      if(this.authorized(message.sourceRequestId))await this.channel.progressFor(message.sourceRequestId,message.progress).catch(()=>false);
      return false;
    }
    if(message.type==='main_start'||message.type==='main_terminal'){
      if(this.authorized(message.sourceRequestId))void this.channel.typingFor(message.sourceRequestId,message.type==='main_start');return false;
    }
    if (message.type === "progress" || message.type === "delta") return false;
    if(message.type==='delivery'){
      if(!message.deliveryId)return false;
      const d=this.app.tasks.delivery(message.deliveryId);
      if(!['submitting','recorded','uncertain'].includes(d.state)||d.text!==message.text||d.historyMessageId!==message.messageId||d.routeSourceRequestId!==message.requestId)return false;
    }
    const run = message.runId ? this.app.store.run(message.runId) : undefined;
    if (message.runId && !run) return false;
    if (run && message.requestId && message.requestId !== run.sourceRequestId) return false;
    const requestId = message.requestId ?? run?.sourceRequestId;
    if (!requestId || !this.authorized(requestId)) return false;
    if (message.interactionId && (!run || this.app.interactions.inspect(message.interactionId).runId !== run.id)) return false;
    // A request has one final reply; each interaction and run has its own stable
    // question/delivery identity. Neither transport retries nor restarts rename it.
    const files=message.type==='delivery'&&message.deliveryId?this.app.tasks.delivery(message.deliveryId).publishedFileResultIds:[];
    const text=files.length>1?message.text+`\n\n本次有 ${files.length} 个成果，请在荷马 Web 主对话的“成果下载”逐个获取。`:message.text;
    const eventId = "homer-wechat:" + message.type + ":" + (message.deliveryId ?? message.interactionId ?? requestId);
    return this.channel.publish({ eventId, requestId, type: message.type, text,
      ...(message.interactionId ? { interactionId: message.interactionId } : {}),
      ...(message.type === "delivery" && files.length<=1 && run && this.app.tasks.publishedArtifact(run.id) ? { artifactRunId: run.id } : {}),
    });
  }
  private async recoverReplies() {
    const c = this.channel.store.connection();
    if (!c.bindingId || !c.secretRef || !["connected", "disabled"].includes(c.status)) return;
    const replies = this.app.store.db.prepare(`SELECT r.requestId,m.text,m.status FROM wechat_homer_receipts r
      JOIN conversation_messages m ON m.id=r.replyId JOIN wechat_inbox i ON i.requestId=r.requestId
      WHERE i.bindingId=? AND m.threadId=? AND m.status IN ('completed','failed','interrupted') ORDER BY m.createdAt,m.rowid`)
      .all(c.bindingId, this.app.store.meta("mainThread")!) as { requestId: string; text: string; status: string }[];
    for(const messageId of this.app.processes.coordinationIds(this.app.store.meta('mainThread')!)){
      const output=this.app.processes.coordination(messageId);if(output)await this.onMessage({type:'coordination',messageId,text:output.text});
    }
    for (const reply of replies) {
      const text = reply.status === "interrupted"
        ? `${reply.text ? reply.text + "\n\n" : ""}上次主回复已中断；已保存的任务不会自动重跑，请查询当前进度。`
        : reply.text || "上次主回复未完成；已保存的任务不会自动重跑，请查询当前进度。";
      try { await this.onMessage({ type: "reply", requestId: reply.requestId, text }); }
      catch (error) {
        if (!(error instanceof WechatError)) throw error;
        this.app.store.db.prepare("UPDATE wechat_connection SET error=? WHERE id=1 AND bindingId=?").run(error.code, c.bindingId);
        return; // Original history remains available for an explicit reconnect.
      }
    }
  }
  async restore() { await this.channel.restore(); await this.recoverReplies(); return this.channel.status(); }
}
