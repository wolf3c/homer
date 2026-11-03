import { randomUUID, randomBytes,createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { WechatApi, WechatError, WECHAT_AUTH_ORIGIN, wechatUrl, splitWechatText, type WechatCredential, type WechatItem } from "./wechat-api.js";
import { MacWechatSecrets, validateWechatCredential, type WechatSecrets } from "./wechat-secrets.js";
import { WechatStore, decryptWechatPayload,encryptWechatPayload } from "./wechat-store.js";
import { MediaStore,type AttachmentRef } from '../media-store.js';
import { modelImage,imageThumbnail } from '../media-decode.js';
import {extractDocument} from '../media-documents.js';
import {audioPcm,pcmWav,transcribeAudio} from '../media-audio.js';
import {analyzeVideo,videoThumbnail} from '../media-video.js';
import type {MainProgress} from '../main-progress.js';

// Owned by the existing service host. No channel may create a Homer or Codex instance.
export type WechatOrigin = {
  channel: "wechat"; bindingGeneration: string; botId: string; peerId: string; messageId: string;
};
export interface WechatBridge {
  // Adapter-injected provenance. Public Web/CLI inputs must not supply this trusted argument.
  submit(input: { requestId: string; text: string; origin: WechatOrigin;attachments?:AttachmentRef[] }): Promise<unknown>;
  mediaChanged?():void;
  artifact(runId: string): Promise<{ filename: string; bytes: Uint8Array;mime?:string;sha256?:string }>;
}
export type WechatVisibleEvent = {
  // Stable across host retries/restart. Host resolves Run.sourceRequestId before calling.
  eventId: string; requestId: string; type: "reply" | "question" | "delivery" | "error" | "coordination";
  text: string; interactionId?: string; artifactRunId?: string;
};
export type WechatLoginView = { id: string; status: string; qrCodeUrl?: string; expiresAt?: number; error?: string };
type Login = { id: string; generation: number; qrcode: string; base: string; qrCodeUrl: string; expiresAt: number; status: string };
const code = (error: unknown) => error instanceof WechatError ? error.code : "wechat_operation_unavailable";
export class WechatChannel {
  readonly store: WechatStore;
  private credential?: WechatCredential;
  private abort = new AbortController();
  private login?: Login;
  private polling?: Promise<void>;
  private sending?: Promise<void>;
  private submitting?: Promise<void>;
  private sendRequested = false;
  private submitRequested = false;
  private loginPoll?: Promise<WechatLoginView>;
  private jobs = new Set<Promise<unknown>>();
  private closed = false;
  private savingSecrets = new Set<string>();
  private typing?:{requestId:string;generation:number;ticket:string;at:number};
  private typingEpoch=0;
  private typingRequest?:string;
  private configTicket?:{bindingId:string;contextHash:string;ticket:string;expiresAt:number};
  private extension={notifyStart:'unverified',notifyStop:'unverified',typing:'unverified',progress:'unverified',combination:'unverified',outgoingQuote:'unverified'};
  constructor(db: DatabaseSync, private bridge: WechatBridge, private api = new WechatApi(), private secrets: WechatSecrets = new MacWechatSecrets(),private media?:MediaStore) {
    this.store = new WechatStore(db,media);
    this.store.reconcile();
  }
  status() {
    const c = this.store.connection();
    return { status: c.status, enabled: !!c.enabled, bound: !!c.bindingId, generation: c.generation,
      ...(c.error ? { error: c.error } : {}),
      pending: this.store.outbox().filter(x => x.state === "pending").length,
      uncertain: this.store.outbox().filter(x => x.state === "uncertain").length,
      failed: this.store.outbox().filter(x => x.state === "failed").length,extensions:{...this.extension} };
  }
  canUpgrade() {
    // A settled unknown receipt is durable and must remain unknown. A live
    // sender/submitter or management operation still owns effects and blocks
    // handoff. The ordinary abortable long poll is drained by close().
    return !this.closed && !this.sending && !this.submitting && !this.loginPoll &&
      !this.savingSecrets.size && this.jobs.size === (this.polling ? 1 : 0) &&
      !this.store.db.prepare("SELECT 1 FROM wechat_outbox WHERE state='sending' LIMIT 1").get();
  }
  private alive(generation: number, signal: AbortSignal) { return !this.closed && !signal.aborted && this.store.current(generation); }
  private track<T>(job: Promise<T>) {
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job)).catch(() => {}); return job;
  }
  private invalidate(status: string, enabled: boolean, error: string | null = null) {
    const next = this.store.transition(status, enabled, error);
    this.abort.abort(); this.abort = new AbortController(); this.login = undefined; this.loginPoll = undefined;
    this.typingEpoch++;this.typingRequest=undefined;this.configTicket=undefined;
    const typing=this.typing;this.typing=undefined;if(typing&&this.credential)void this.track(this.api.sendTyping(this.credential,typing.ticket,2).catch(()=>{}));
    return next;
  }
  private async credentials() {
    const c = this.store.connection();
    if (!c.secretRef) throw new WechatError("wechat_not_connected");
    const credential = this.credential ?? await this.secrets.get(c.secretRef);
    validateWechatCredential(credential);
    if (credential.botId !== c.botId || credential.ownerId !== c.ownerId || credential.baseUrl !== c.baseUrl)
      throw new WechatError("wechat_credentials_invalid");
    return credential;
  }
  private async removeSecret(reference: string) {
    await this.secrets.delete(reference);
    this.store.releaseSecret(reference);
  }
  private async cleanUnusedSecrets() {
    for (const reference of this.store.unusedSecrets())
      if (!this.savingSecrets.has(reference)) await this.removeSecret(reference).catch(() => {});
  }
  async restore() {
    if (this.closed) throw new WechatError("wechat_channel_closed");
    await this.cleanUnusedSecrets();
    const c = this.store.connection();
    if (!c.enabled || !c.bindingId) {
      if (c.status === "connecting") this.invalidate(c.bindingId ? "disabled" : "unconfigured", false, "wechat_login_expired");
      return this.status();
    }
    const { generation } = this.invalidate("connected", true);
    const signal = this.abort.signal;
    try {
      const credential = await this.credentials();
      if (!this.alive(generation, signal)) return this.status();
      this.credential = credential; this.startTransport(generation, signal);
    } catch (error) { if (this.alive(generation, signal)) this.invalidate("invalid", false, code(error)); }
    return this.status();
  }
  async beginLogin(): Promise<WechatLoginView> {
    if (this.closed) throw new WechatError("wechat_channel_closed");
    return this.track(this.doBeginLogin());
  }
  private async doBeginLogin(): Promise<WechatLoginView> {
    const { generation } = this.invalidate("connecting", false);
    const signal = this.abort.signal;
    try {
      const qr = await this.api.beginQr(signal);
      if (!this.alive(generation, signal)) throw new WechatError("wechat_connection_superseded");
      this.login = { id: randomUUID(), generation, qrcode: qr.qrcode, base: WECHAT_AUTH_ORIGIN,
        qrCodeUrl: qr.qrcode_img_content, expiresAt: Date.now() + 5 * 60 * 1000, status: "wait" };
      return this.view(this.login);
    } catch (error) {
      if (this.alive(generation, signal)) this.invalidate("error", false, code(error));
      throw new WechatError(code(error));
    }
  }
  private view(login: Login): WechatLoginView {
    return { id: login.id, status: login.status, ...(login.status === "wait" || login.status === "scaned" ? { qrCodeUrl: login.qrCodeUrl, expiresAt: login.expiresAt } : {}) };
  }
  async pollLogin(id: string, verifyCode?: string): Promise<WechatLoginView> {
    const login = this.login;
    if (!login || login.id !== id || !this.store.current(login.generation)) throw new WechatError("wechat_login_not_active");
    if (["expired", "confirmed", "verify_code_blocked", "already_bound"].includes(login.status)) return this.view(login);
    if (this.loginPoll) return this.loginPoll;
    if (Date.now() >= login.expiresAt) {
      login.status = "expired"; return this.view(login);
    }
    const job = this.track(this.doPollLogin(login, this.abort.signal, verifyCode));
    this.loginPoll = job;
    try { return await job; } finally { if (this.loginPoll === job) this.loginPoll = undefined; }
  }
  private async doPollLogin(login: Login, signal: AbortSignal, verifyCode?: string): Promise<WechatLoginView> {
    const generation = login.generation;
    let reference: string | undefined;
    try {
      const result = await this.api.pollQr(login.base, login.qrcode, signal, verifyCode);
      if (!this.alive(generation, signal)) throw new WechatError("wechat_connection_superseded");
      if (result.status === "scaned_but_redirect") {
        if (!result.redirect_host) throw new WechatError("wechat_qr_redirect_invalid");
        login.base = wechatUrl(result.redirect_host.startsWith("https://") ? result.redirect_host : "https://" + result.redirect_host).origin;
        login.status = "scaned";
      } else if (result.status === "confirmed") {
        const credential = validateWechatCredential({ botToken: result.bot_token, botId: result.ilink_bot_id,
          ownerId: result.ilink_user_id, baseUrl: result.baseurl ? wechatUrl(result.baseurl).origin : undefined, dataKey: randomBytes(32).toString("hex") });
        const owner = this.store.connection().ownerId;
        if (owner && owner !== credential.ownerId) throw new WechatError("wechat_owner_mismatch");
        reference = "wechat-" + randomUUID();
        this.store.registerSecret(reference); this.savingSecrets.add(reference);
        try { await this.secrets.set(reference, credential); }
        finally { this.savingSecrets.delete(reference); }
        if (!this.alive(generation, signal)) throw new WechatError("wechat_connection_superseded");
        const old = this.store.bind(generation, { ownerId: credential.ownerId, botId: credential.botId, baseUrl: credential.baseUrl, secretRef: reference });
        reference = undefined; this.credential = credential; login.status = "confirmed";
        this.startTransport(generation, signal);
        // Do not let best-effort cleanup invalidate the new connection.
        if (old) await this.removeSecret(old).catch(() => {});
      } else if (result.status === "binded_redirect") {
        // No credentials were issued: never claim success without our own saved binding.
        if (!this.store.connection().secretRef) throw new WechatError("wechat_login_credentials_missing");
        login.status = "already_bound";
      } else if (["wait", "scaned", "expired", "need_verifycode", "verify_code_blocked"].includes(result.status)) login.status = result.status;
      else throw new WechatError("wechat_qr_status_invalid");
      return this.view(login);
    } catch (error) {
      if (reference) await this.removeSecret(reference).catch(() => {});
      if (!this.alive(generation, signal)) throw new WechatError("wechat_connection_superseded");
      if (error instanceof WechatError && error.code === "wechat_network_unavailable") return { ...this.view(login), error: error.code };
      this.invalidate("error", false, code(error));
      throw new WechatError(code(error));
    }
  }
  disable() { this.invalidate("disabled", false); return this.status(); }
  async reconnect() { return this.restoreEnabled(); }
  private async restoreEnabled() {
    if (!this.store.connection().secretRef) throw new WechatError("wechat_not_connected");
    this.invalidate("connected", true); return this.restore();
  }
  async disconnect() {
    this.invalidate("unconfigured", false); this.credential = undefined;
    const reference = this.store.forget();
    if (reference) await this.removeSecret(reference);
    return this.status();
  }
  // Host calls before closing the shared DB. Preserve enabled intent across a process restart.
  async close() {
    if (this.closed) return;
    const c = this.store.connection(),credential=this.credential; this.invalidate(c.status, !!c.enabled, c.error);
    this.closed = true;
    if(credential)await this.api.notify(credential,'stop').then(()=>this.extension.notifyStop='accepted').catch(()=>this.extension.notifyStop='unavailable');
    await Promise.allSettled([...this.jobs]); this.credential = undefined;
  }
  private startTransport(generation: number, signal: AbortSignal) {
    if(this.credential)void this.track(this.api.notify(this.credential,'start',signal).then(()=>{if(this.alive(generation,signal))this.extension.notifyStart='accepted';}).catch(()=>{if(this.alive(generation,signal))this.extension.notifyStart='unavailable';}));
    this.pump(generation, signal); this.flush(generation, signal);
    this.prepareMedia(generation,signal);
    const poll = this.track(this.poll(generation, signal)); this.polling = poll;
    void poll.finally(() => { if (this.polling === poll) this.polling = undefined; }).catch(() => {});
  }
  typingFor(requestId:string,active:boolean){
    const input=this.store.inbox(requestId),current=this.store.connection();
    if(active&&(!input||input.bindingId!==current.bindingId||input.peerId!==current.ownerId||!current.enabled))return Promise.resolve();
    if(!active&&this.typingRequest!==requestId)return Promise.resolve();
    this.typingRequest=active?requestId:undefined;
    const epoch=++this.typingEpoch,c=this.store.connection(),signal=this.abort.signal;
    return this.track((async()=>{
      try{
        const old=this.typing;this.typing=undefined;
        if(old&&this.credential)await this.api.sendTyping(this.credential,old.ticket,2,signal);
        if(!active||!this.alive(c.generation,signal))return;
        const input=this.store.inbox(requestId);if(!input||input.bindingId!==c.bindingId||input.peerId!==c.ownerId)return;
        const credential=await this.credentials(),context=decryptWechatPayload(input.context,credential.dataKey,input.requestId),contextHash=createHash('sha256').update(context).digest('hex');
        let ticket=this.configTicket;
        if(!ticket||ticket.bindingId!==c.bindingId||ticket.contextHash!==contextHash||ticket.expiresAt<Date.now()){
          const config=await this.api.getConfig(credential,context,signal);if(typeof config.typing_ticket!=='string'||!config.typing_ticket)throw new WechatError('wechat_typing_unavailable');
          ticket={bindingId:c.bindingId!,contextHash,ticket:config.typing_ticket,expiresAt:Date.now()+60000};
        }
        if(epoch!==this.typingEpoch||!this.alive(c.generation,signal))return;
        this.configTicket=ticket;this.typing={requestId,generation:c.generation,ticket:ticket.ticket,at:Date.now()};await this.api.sendTyping(credential,ticket.ticket,1,signal);
        if(epoch!==this.typingEpoch||!this.alive(c.generation,signal)){await this.api.sendTyping(credential,ticket.ticket,2).catch(()=>{});return;}
        this.extension.typing='accepted';
      }catch{if(epoch===this.typingEpoch)this.extension.typing='unavailable';}
    })());
  }
  private async poll(generation: number, signal: AbortSignal) {
    let failures = 0, timeout = 35000;
    while (this.alive(generation, signal)) {
      try {
        const credential = await this.credentials();
        if (!this.alive(generation, signal)) return;
        const batch = await this.api.updates(credential, this.store.connection().cursor, signal, timeout);
        if (!this.alive(generation, signal)) return;
        this.store.accept(generation, batch, credential.dataKey); failures = 0;
        this.store.transportState(generation, "connected");
        if (typeof batch.longpolling_timeout_ms === "number") timeout = Math.min(65000, Math.max(10000, batch.longpolling_timeout_ms + 5000));
        this.pump(generation, signal); this.flush(generation, signal);
        this.prepareMedia(generation,signal);
        await delay(100, undefined, { signal });
      } catch (error) {
        if (!this.alive(generation, signal)) return;
        if (code(error) === "wechat_credentials_invalid") { this.invalidate("invalid", false, code(error)); return; }
        this.store.transportState(generation, "reconnecting", code(error));
        await delay(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)), undefined, { signal }).catch(() => {});
      }
    }
  }
  private pump(generation: number, signal: AbortSignal) {
    if (this.submitting) { this.submitRequested = true; return; }
    const job = this.track((async () => {
      while (this.alive(generation, signal)) {
        const input = this.store.pending()[0]; if (!input) return;
        try {
          const c = this.store.connection();
          if (input.bindingId !== c.bindingId || input.peerId !== c.ownerId || !c.botId) return;
          const attachments=this.media?this.store.attachments(input.requestId):[];
          await this.bridge.submit({ requestId: input.requestId, text: input.text,...(attachments.length?{attachments}:{}), origin: {
            channel: "wechat", bindingGeneration: input.bindingId, botId: c.botId, peerId: input.peerId, messageId: input.messageId,
          } });
          if (this.alive(generation, signal)) this.store.submitted(input.requestId);
        } catch (error) {
          if (!this.alive(generation, signal)) return;
          // Existing service will never silently re-run a request interrupted after dispatch.
          if (error instanceof Error && /request_interrupted_use_new_id|request_id_conflict/.test(error.message)) this.store.block(input.requestId);
          return;
        }
      }
    })());
    this.submitting = job;
    void job.finally(() => {
      if (this.submitting === job) this.submitting = undefined;
      if (this.submitRequested && !this.closed) {
        this.submitRequested = false;
        const current = this.store.connection();
        if (current.enabled) this.pump(current.generation, this.abort.signal);
      }
    }).catch(() => {});
  }
  private preparing=new Set<string>();
  private prepareMedia(generation:number,signal:AbortSignal){
    if(!this.media||!this.alive(generation,signal))return;
    const rows=this.store.db.prepare(`SELECT a.id AS assetId,a.revision,s.payload FROM media_assets a JOIN wechat_media_sources s ON s.assetId=a.id
      WHERE a.bindingId=? AND a.state IN ('received','retryable_failed') ORDER BY s.rowid LIMIT 10`).all(this.store.connection().bindingId) as {assetId:string;revision:number;payload:string}[];
    for(const row of rows){
      if(this.preparing.size>=2)break;if(this.preparing.has(row.assetId))continue;
      const lease=this.media.claim(row);if(!lease)continue;this.preparing.add(row.assetId);
      const job=this.track((async()=>{
        try{const credential=await this.credentials();if(!this.alive(generation,signal))throw new WechatError('wechat_media_cancelled');
          const item=JSON.parse(decryptWechatPayload(row.payload,credential.dataKey,row.assetId));
          const result=await this.api.download(item,signal);
          const derived=result.kind==='image'?await modelImage(result.bytes,result.mime,signal):undefined;
          const extracted=result.kind==='file'?await extractDocument(result.bytes,item.file_item?.file_name??'附件',signal).then(value=>({state:'ready',...value})).catch(error=>({state:'unavailable',error:error instanceof Error?error.message:'document_parse_failed'})):undefined;
          let audio:Buffer|undefined,transcription:unknown;
          const video=result.kind==='video'?await analyzeVideo(result.bytes,signal).catch(error=>({frames:[],audio:undefined,extraction:{state:'unavailable',error:error instanceof Error?error.message:'media_video_decode_failed'}})):undefined;
          if(result.kind==='voice'){
            try{audio=await audioPcm(result.bytes,result.mime,signal,{encodeType:item.voice_item?.encode_type,sampleRate:item.voice_item?.sample_rate,bitsPerSample:item.voice_item?.bits_per_sample});
              transcription=item.voice_item?.text?{state:'ready',text:item.voice_item.text,transform:'wechat-protocol-transcription',coverage:'协议提供转写；未逐词核对原音频'}:{state:'ready',...await transcribeAudio(audio,signal)};
            }catch(error){transcription={state:'unavailable',error:error instanceof Error?error.message:'media_audio_decode_failed'};}
          }
          if(!this.alive(generation,signal))throw new WechatError('wechat_media_cancelled');
          this.media!.ready(row,lease,result.bytes,result.mime);
          if(derived)this.media!.derivative(this.media!.asset(row).requestId,row,derived);
          if(extracted)this.media!.derivative(this.media!.asset(row).requestId,row,{bytes:Buffer.from(JSON.stringify(extracted)),mime:'application/json',transform:'local-document-text-v1',width:0,height:0});
          if(audio)this.media!.derivative(this.media!.asset(row).requestId,row,{bytes:pcmWav(audio),mime:'audio/wav',transform:'audio-preview-wav16k-v1',width:0,height:0});
          if(transcription)this.media!.derivative(this.media!.asset(row).requestId,row,{bytes:Buffer.from(JSON.stringify(transcription)),mime:'application/json',transform:'audio-transcription-v1',width:0,height:0});
          if(video){for(const frame of video.frames)this.media!.derivative(this.media!.asset(row).requestId,row,frame);this.media!.derivative(this.media!.asset(row).requestId,row,{bytes:Buffer.from(JSON.stringify(video.extraction)),mime:'application/json',transform:'video-analysis-v1',width:0,height:0});}
        }catch(error){const message=error instanceof Error?error.message:'media_prepare_failed';this.media!.failed(row,lease,message,/network|download_failed|cancelled/.test(message));
          this.store.db.prepare("UPDATE media_assets SET state='failed',error=? WHERE id=? AND revision=? AND state='ready'").run(/^[a-z][a-z0-9_]{1,70}$/.test(message)?message:'media_prepare_failed',row.assetId,row.revision);
          if(this.alive(generation,signal))await delay(500,undefined,{signal}).catch(()=>{});
        }finally{this.preparing.delete(row.assetId);this.bridge.mediaChanged?.();}
      })());
      void job.finally(()=>this.prepareMedia(generation,signal)).catch(()=>{});
    }
  }
  async publish(event: WechatVisibleEvent) {
    return this.track(this.publishEvent(event));
  }
  async progressFor(requestId:string,progress:MainProgress){
    const c=this.store.connection(),input=this.store.inbox(requestId);
    if(this.closed||!c.enabled||!input||input.bindingId!==c.bindingId||input.peerId!==c.ownerId)return false;
    const credential=await this.credentials();if(!this.alive(c.generation,this.abort.signal))return false;
    const queued=this.store.queueProgress(requestId,progress,credential.dataKey);
    if(queued)this.flush(c.generation,this.abort.signal);return queued;
  }
  async prepareReplyQuote(requestId:string){
    const c=this.store.connection(),credential=await this.credentials();
    if(!this.alive(c.generation,this.abort.signal))throw new WechatError('wechat_quote_source_denied');
    return this.store.prepareReplyQuote(requestId,credential.dataKey);
  }
  async prepareCombinedDelivery(requestId:string){
    const c=this.store.connection();await this.credentials();
    if(!this.alive(c.generation,this.abort.signal))throw new WechatError('wechat_combo_source_denied');
    return this.store.prepareCombinedDelivery(requestId);
  }
  private async publishEvent(event: WechatVisibleEvent) {
    const c = this.store.connection(), input = this.store.inbox(event.requestId);
    if (!input || input.bindingId !== c.bindingId) return false;
    const credential = await this.credentials();
    const current = this.store.connection();
    // Disabling changes the transport epoch, not the task's persisted reply binding.
    if (current.bindingId !== c.bindingId) return false;
    // Commit before acknowledging the host event. No transport errors can trigger a Worker replay.
    this.store.transaction(() => {
      const text = event.interactionId ? `${event.text}\n\n待答编号：${event.interactionId}。回复时请注明该编号。` : event.text;
      if(event.artifactRunId&&this.store.queueCombinedArtifact(event.requestId,event.eventId,text,event.artifactRunId,credential.dataKey))return;
      this.store.queueText(event.requestId, event.eventId, text, credential.dataKey,event.type==='reply');
      if (event.artifactRunId) {
        // Preserve previously committed event identities on host recovery.
        const legacy=this.store.outbox().some(row=>row.eventKey===event.eventId+':file');
        this.store.queueArtifact(event.requestId, legacy?event.eventId+':file':event.eventId, event.artifactRunId, credential.dataKey,legacy?0:splitWechatText(text).length);
      }
    });
    if (current.enabled && !this.closed) this.flush(current.generation, this.abort.signal);
    return true;
  }
  private flush(generation: number, signal: AbortSignal) {
    if (this.sending) { this.sendRequested = true; return; }
    const job = this.track((async () => {
      while (this.alive(generation, signal)) {
        const item = this.store.outbox().find(row => row.state === "pending" && this.store.claim(row.id)); if (!item) return;
        const input = this.store.inbox(item.requestId); if (!input) return;
        let artifact = false,sendAttempted=false;
        try {
          const credential = await this.credentials();
          if (!this.alive(generation, signal)) { this.store.release(item.id); return; }
          const context = decryptWechatPayload(input.context, credential.dataKey, input.requestId);
          const payload = JSON.parse(decryptWechatPayload(item.payload, credential.dataKey, item.id)) as WechatItem | { artifactRunId: string;combinedText?:string };
          let outgoing: WechatItem;
          if ("artifactRunId" in payload) {
            artifact = true;
            const verified = await this.bridge.artifact(payload.artifactRunId);
            if (!this.alive(generation, signal)) { this.store.release(item.id); return; }
            const hash=createHash('sha256').update(verified.bytes).digest('hex');
            const previous=this.store.db.prepare('SELECT * FROM wechat_media_uploads WHERE outboxId=?').get(item.id);
            if(previous&&previous.sourceHash!==hash)throw new WechatError('wechat_artifact_changed');
            this.store.db.prepare("INSERT INTO wechat_media_uploads VALUES(?,?,'uploading',NULL,NULL) ON CONFLICT(outboxId) DO NOTHING").run(item.id,hash);
            if(previous?.state==='uploaded'&&typeof previous.payload==='string')outgoing=JSON.parse(decryptWechatPayload(previous.payload,credential.dataKey,item.id));
            else{
              const kind=verified.mime?.startsWith('image/')?'image':verified.mime?.startsWith('video/')?'video':verified.mime==='audio/silk'?'voice':'file';
              const thumbnail=kind==='image'?await imageThumbnail(Buffer.from(verified.bytes),verified.mime!,signal):kind==='video'?await videoThumbnail(Buffer.from(verified.bytes),signal):undefined;
              outgoing=verified.filename.endsWith('.md')?await this.api.uploadMarkdown(credential,verified.filename,verified.bytes,signal):await this.api.uploadMedia(credential,verified.filename,Buffer.from(verified.bytes),kind,signal,thumbnail);
              this.store.db.prepare("UPDATE wechat_media_uploads SET state='uploaded',payload=? WHERE outboxId=?").run(encryptWechatPayload(JSON.stringify(outgoing),credential.dataKey,item.id),item.id);
            }
            const current=await this.bridge.artifact(payload.artifactRunId);
            if(createHash('sha256').update(current.bytes).digest('hex')!==hash)throw new WechatError('wechat_artifact_changed');
          } else outgoing = payload;
          if (!this.alive(generation, signal)) { this.store.release(item.id); return; }
          const items='artifactRunId' in payload&&typeof payload.combinedText==='string'?[{type:1,text_item:{text:payload.combinedText}} as WechatItem,outgoing]:[outgoing];
          sendAttempted=true;const receipt=items.length>1?await this.api.sendItems(credential,input.peerId,context,item.id,items,signal):await this.api.send(credential, input.peerId, context, item.id, outgoing, signal);
          if(outgoing.type===11||outgoing.type===12)this.extension.progress='accepted';
          if(items.length>1)this.extension.combination='accepted';
          if(outgoing.ref_msg)this.extension.outgoingQuote='accepted';
          if(receipt&&typeof receipt.message_id==='string')this.store.quotes.remember(item.bindingId,input.peerId,receipt.message_id,items,credential.dataKey);
          this.store.sent(item.id);
        } catch (error) {
          this.store.failed(item.id, sendAttempted&&(!(error instanceof WechatError) || error.uncertain), code(error));
          if (code(error) === "wechat_credentials_invalid" && this.alive(generation, signal)) this.invalidate("invalid", false, code(error));
          if (!this.alive(generation, signal)) return;
          if (artifact && this.credential) this.store.queueText(item.requestId, "file-status:" + item.id,
            error instanceof WechatError && !error.uncertain
              ? "成果文件尚未发送成功，原任务和已核验成果已保留。请在 Homer 本地成果入口查看。"
              : "成果文件的微信发送结果尚未确认，请先检查附件。Homer 不会自动重复发送，也不会重新执行原任务。",
            this.credential.dataKey);
        }
      }
    })());
    this.sending = job;
    void job.finally(() => {
      if (this.sending === job) this.sending = undefined;
      if (this.sendRequested && !this.closed) {
        this.sendRequested = false;
        const current = this.store.connection();
        if (current.enabled) this.flush(current.generation, this.abort.signal);
      }
    }).catch(() => {});
  }
}
