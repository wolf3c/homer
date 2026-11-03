// Private IPC endpoint. Only the stable development launcher owns stdin.
import { randomUUID } from "node:crypto";
import { DesktopReviewRequired, Homer, type Message } from "./service.js";
import type { Config } from "./config.js";
import { effectiveEffort } from "./model-config.js";
import { engineError, codexVersion } from "./engine.js";
import { homerWebBridge } from "./web-homer.js";
import { HomerWechat } from "./channels/wechat-homer.js";
import { TelegramHomerBridge } from "./channels/telegram-homer-bridge.js";
import { TelegramManagement } from "./channels/telegram-management.js";
import { prepareTelegramMigration } from "./channels/telegram-migration.js";
import {desktopManagementAllowed} from './desktop-management.js';
import {configureDesktopImageDecoder} from './media-decode.js';

const send = (value: unknown) => new Promise<void>((resolve, reject) => {
  if (!process.send) return reject(new Error("dev_ipc_required"));
  process.send(value, error => error ? reject(error) : resolve());
});
let app: Homer | undefined;
let wechat: HomerWechat | undefined;
let telegram: TelegramHomerBridge | undefined;
let telegramManagement: TelegramManagement | undefined;
let frozen = true;
let stopping = false;
let starting: Promise<void> | undefined;
let constructorRefused = false;
let stateInvalidationScheduled=false,stateInvalidationPending=false,stateInvalidationSending=false;
let stateInvalidationRetry:ReturnType<typeof setTimeout>|undefined;
function invalidateState(){
  stateInvalidationPending=true;
  if(stateInvalidationScheduled||stateInvalidationSending||stateInvalidationRetry||!process.connected)return;
  stateInvalidationScheduled=true;
  queueMicrotask(()=>{stateInvalidationScheduled=false;void flushStateInvalidation();});
}
async function flushStateInvalidation(){
  if(!stateInvalidationPending||stateInvalidationSending||!process.connected)return;
  stateInvalidationSending=true;stateInvalidationPending=false;
  try{await send({kind:'state_invalidated',protocol:1});}
  catch{stateInvalidationPending=true;stateInvalidationRetry=setTimeout(()=>{stateInvalidationRetry=undefined;void flushStateInvalidation();},500);stateInvalidationRetry.unref();}
  finally{stateInvalidationSending=false;if(stateInvalidationPending&&!stateInvalidationRetry)invalidateState();}
}
let desktop=false,chatReady=false,desktopRetryBlocked=false;
let desktopChatStarting:Promise<void>|undefined;
async function announceReady(restoring:boolean){
  if(webUploadProtocol)app!.webHistoryPages();
  await send({kind:'ready',thread:app!.store.meta('mainThread'),restoring,stateInvalidationProtocol:1,webHistoryProtocol:3,model:app!.modelConfig.model,effort:effectiveEffort(app!.modelConfig.effort),engine:codexVersion(app!.config.codexBin)});
}
async function startDesktopChat(){
  if(!desktop||!app||stopping||chatReady||desktopRetryBlocked)return;
  if(desktopChatStarting)return desktopChatStarting;
  desktopChatStarting=(async()=>{
    const config=app!.modelConfig;
    if(config.keyEnv){
      // BYOK is configured independently of native ChatGPT account/read.
      // Presence permits local startup; only a real response proves validity.
      if(!config.baseUrl||!process.env[config.keyEnv]){await send({kind:'chat_unavailable',code:'desktop_account_required'});invalidateState();return;}
    }else{
      const account=await app!.manageCapabilities({action:'account_state'});
      if(stopping)return;
      if(!account.connected){await send({kind:'chat_unavailable',code:'desktop_account_required'});invalidateState();return;}
    }
    if(stopping)return;
    const restoring=!!app!.store.meta('mainThread');
    starting=(async()=>{if(!app!.config.pauseOldDesktopWork)await prepareTelegramMigration(app!.store.db,app!.config.runtime);await app!.start({keepManagementOnFailure:true});})();
    try{
      await starting;if(stopping)return;
      // Commit core readiness exactly once before optional channel restoration.
      chatReady=true;
      await announceReady(restoring);
    }catch(error){
      const blocked=error instanceof Error&&['main_stop_unconfirmed','orphan_stop_unconfirmed','desktop_start_owner_unconfirmed'].includes(error.message);
      const code=blocked?(error as Error).message:'desktop_chat_unavailable';
      if(blocked)desktopRetryBlocked=true;
      await send({kind:'chat_unavailable',code});
    }finally{starting=undefined;invalidateState();}
    if(chatReady&&!stopping&&!app!.config.pauseOldDesktopWork){
      telegram=new TelegramHomerBridge(app!);telegramManagement=new TelegramManagement(telegram.channel);
      try{await wechat!.restore();}catch{await send({kind:'desktop_channel_unavailable',channel:'wechat'});}
      try{await telegram.restore();}catch{await send({kind:'desktop_channel_unavailable',channel:'telegram'});}
    }
  })().finally(()=>{desktopChatStarting=undefined;});
  return desktopChatStarting;
}
let nativeCapabilitiesProtocol=false;
let webUploadProtocol=false;
const receipts = new Map<string, { resolve: () => void; reject: (error: Error) => void; requestId?:string;startedAt:number;sentAt?:number;measured:boolean }>();
async function output(message: Message) {
  const id = randomUUID();
  const source=message.requestId??('sourceRequestId' in message?message.sourceRequestId:undefined);
  const requestId=source&&/^[\w:.-]{1,150}$/.test(source)?source:undefined;
  // Keep per-write metadata on the original receipt, never a second outbox.
  // Only final replies/deliveries add history points; high-volume deltas remain
  // inspectable while pending without evicting an entire turn's timing trail.
  const measured=message.type==='reply'||message.type==='delivery';
  const receipt = new Promise<void>((resolve, reject) => receipts.set(id, { resolve, reject,requestId,startedAt:Date.now(),measured }));
  if(measured)app?.receptionTimings.mark('output_ipc_start',{outputId:id,requestId});
  try {
    await send({ kind: "output", id, message });
    const pending=receipts.get(id);if(pending)pending.sentAt=Date.now();
    if(measured)app?.receptionTimings.mark('output_ipc_sent',{outputId:id,requestId});
    await receipt;
  }
  finally { receipts.delete(id); }
}
async function stop() {
  if (stopping) return;
  stopping = true;
  if(stateInvalidationRetry)clearTimeout(stateInvalidationRetry);
  frozen = true;
  let confirmed=false;
  try { await desktopChatStarting?.catch(() => {}); await starting?.catch(() => {}); await telegram?.close(); await wechat?.management.close(); await app?.close({requireAllOwnersConfirmed:desktop});confirmed=!!app||constructorRefused; }
  catch { process.exitCode = 1; }
  if(desktop){try{await send({kind:'desktop_stopped',confirmed});}catch{process.exitCode=1;}}
  process.disconnect?.();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => {
  for (const receipt of receipts.values()) receipt.reject(new Error("cli_output_unconfirmed"));
  if (!stopping) void stop();
});
process.on("message", (raw: unknown) => {
  void receive(raw).catch(async error => {
    try { await send({ kind: "fatal", code: engineError(error) }); } catch {}
    process.exitCode = 1;
    await stop();
  });
});
async function receive(raw: unknown) {
  const m = raw as { desktop?:boolean; kind: string; config: Config; buildHash?:string; terminalDeltas?:boolean;webUploadProtocol?:number;nativeCapabilitiesProtocol?:number;thread?: string; id: string; text: string; method: string; input: any };
  if (m.kind === "written") {
    const pending=receipts.get(m.id);
    if(pending?.measured)app?.receptionTimings.mark('output_ipc_ack',{outputId:m.id,requestId:pending.requestId});
    pending?.resolve();
  } else if (m.kind === "init") {
    if (app) throw new Error("dev_already_initialized");
    desktop=m.desktop===true;
    if(!desktop&&(m.config.pauseOldDesktopWork||m.config.dailyDeepSeek||m.config.desktopConnection||m.config.desktopModelSource))throw Error('desktop_pause_scope_invalid');
    if(desktop){if(!m.config.desktopResources)throw Error('desktop_resource_identity_required');configureDesktopImageDecoder(m.config.desktopResources);}
    webUploadProtocol=m.webUploadProtocol===1;nativeCapabilitiesProtocol=m.nativeCapabilitiesProtocol===1;
    // Only an explicit plain-terminal opt-out skips IPC. Legacy/private host
    // callers keep their existing stream until they declare otherwise.
    const terminalDeltas=m.terminalDeltas!==false;
    try {
    app = new Homer(m.config, async (message: Message) => {
      // Only local durable acceptance here. The channel's independent sender
      // owns external delivery; its network outcome cannot replay the Worker.
      if(!app?.config.pauseOldDesktopWork){await wechat?.onMessage(message);await telegram?.handleMessage(message);}
      if (["main_start", "main_terminal", "tool_progress"].includes(message.type)) return;
      if(message.type==='delta'&&!terminalDeltas)return;
      await output(message);
    });
    } catch(error) { if(desktop&&error instanceof DesktopReviewRequired)constructorRefused=true;throw error; }
    app.onStateChange(reason=>{invalidateState();if(desktop&&(reason==='model-turn'||reason==='user-input'))void send({kind:reason==='model-turn'?'account_usage_dirty':'account_config_check'}).catch(()=>{});});
    if(m.buildHash)app.registerRuntimeBuild(m.buildHash);
    if(webUploadProtocol)app.registerChannelCapabilities('web',()=>({draftUpload:true}));
    if(!m.config.pauseOldDesktopWork)wechat = new HomerWechat(app);
    if (m.thread && app.store.meta("mainThread") !== m.thread)
      throw new Error("main_resume_thread_mismatch");
    if(desktop){
      frozen=false;
      await send({kind:'management_ready',stateInvalidationProtocol:1,webHistoryProtocol:3});
      void startDesktopChat().catch(async()=>{try{await send({kind:'chat_unavailable',code:'desktop_chat_unavailable'});}catch{}});
      return;
    }
    const restoring = !!app.store.meta("mainThread");
    starting = (async () => {
      await prepareTelegramMigration(app!.store.db, m.config.runtime);
      await app!.start();
      telegram = new TelegramHomerBridge(app!);
      telegramManagement = new TelegramManagement(telegram.channel);
      await wechat!.restore();
      // A broken/revoked external credential must not prevent local Homer use.
      try { await telegram.restore(); }
      catch { await output({ type: "progress", text: "Telegram 恢复未确认；请在本地设置页核对凭据或消费者冲突。" }); }
    })();
    await starting;
    if (stopping) return;
    if(webUploadProtocol)app.webHistoryPages();
    frozen = false;
    await send({ kind: "ready", thread: app.store.meta("mainThread"), restoring, stateInvalidationProtocol:1,webHistoryProtocol:3, model: m.config.model,
      effort: effectiveEffort(m.config.effort), engine: codexVersion(m.config.codexBin) });
  } else if(m.kind==='desktop_account'){
    try{
      if(!desktop||!app||frozen||stopping||!['state','connect','cancel'].includes(m.method))throw Error('desktop_account_forbidden');
      const state=await app.manageCapabilities({action:'account_state'});
      const value=m.method==='connect'?await app.manageCapabilities({action:'account_login',approve:true}):m.method==='cancel'&&state.loginId?await app.manageCapabilities({action:'account_cancel',approve:true,loginId:state.loginId}):state;
      await send({kind:'web_result',id:m.id,value});
    }catch(error){await send({kind:'web_result',id:m.id,error:engineError(error)});}
  } else if (m.kind === "web") {
    try {
      if (!app || frozen || stopping) throw new Error("service_upgrading");
      if(desktop&&!chatReady){
        if(!desktopManagementAllowed(m.method,m.input))throw Error('desktop_chat_not_ready');
        await send({kind:'web_result',id:m.id,value:{...app.conversationControlState(),threadId:'',messages:[],queue:[],work:[],interactions:[],upgrade:{phase:'management',accepting:false}}});
        return;
      }
      const bridge = homerWebBridge(app,{draftUpload:webUploadProtocol,nativeCapabilities:!!nativeCapabilitiesProtocol});
      let value: unknown;
      if(m.method==='history.state')value=await bridge.history!.state();
      else if(m.method==='history.page')value=await bridge.history!.page(m.input);
      else if(m.method==='history.process')value=await bridge.history!.process(m.input);
      else if(m.method==='history.resolve')value=await bridge.history!.resolve(m.input);
      else if(m.method==='history.receipts')value=await bridge.history!.receipts(m.input);
      else if(m.method==='history.queue')value=await bridge.history!.queue(m.input.after,m.input.readEpoch);
      else if(m.method==='history.dispatchQueue')value=await bridge.history!.dispatchQueue!(m.input);
      else if(m.method==='history.interactions')value=await bridge.history!.interactions(m.input.after,m.input.readEpoch);
      else if(m.method==='taskOverview.progress')value=await bridge.taskOverview!.progress!(m.input.id);
      else if(m.method==='taskOverview.list')value=await bridge.taskOverview!.list();
      else if(m.method==='taskOverview.summary')value=await bridge.taskOverview!.summary!(m.input.id);
      else if(m.method==='taskOverview.origin')value=await bridge.taskOverview!.origin!(m.input.id,m.input.messageId);
      else if(m.method==='taskOverview.detail')value=await bridge.taskOverview!.detail(m.input.id);
      else if(m.method === 'media.read')value=await bridge.media!.read(m.input);
      else if(m.method === 'media.upload'){if(!bridge.media?.upload)throw Error('web_upload_unavailable');value=await bridge.media.upload(m.input);}
      else if(m.method === 'media.discard'){if(!bridge.media?.discard)throw Error('web_upload_unavailable');value=await bridge.media.discard(m.input);}
      else if (m.method === "state") value = await bridge.state();
      else if (m.method === "submit") value = await bridge.submit(m.input);
      else if (m.method === "feedback") value = await bridge.feedback!(m.input.messageId, m.input.value);
      else if(m.method==='queue.edit')value=await bridge.queue!.edit(m.input);
      else if(m.method==='queue.cancel')value=await bridge.queue!.cancel(m.input);
      else if(m.method==='queue.move')value=await bridge.queue!.move!(m.input);
      else if(m.method==='queue.interrupt')value=await bridge.queue!.interrupt(m.input.input,m.input.target);
      else if (m.method === "stop") value = await bridge.stop(m.input.messageId);
      else if (m.method === "respond") value = await bridge.respond(m.input.id, m.input);
      else if (m.method === "artifactOrigin") value = await bridge.artifactOrigin!(m.input.resultId);
      else if (m.method === "revealArtifact") value = await bridge.revealArtifact!(m.input.resultId);
      else if (m.method === "artifact") value = await bridge.artifact(m.input.runId);
      else if (wechat && m.method === "wechat.state") value = await wechat.management.state();
      else if (wechat && m.method === "wechat.login") value = await wechat.management.beginLogin();
      else if (wechat && m.method === "wechat.poll") value = await wechat.management.pollLogin(m.input.id, m.input.verifyCode);
      else if (wechat && m.method === "wechat.qr") value = await wechat.management.qrPng(m.input.id);
      else if (wechat && m.method === "wechat.disable") value = await wechat.management.disable();
      else if (wechat && m.method === "wechat.reconnect") value = await wechat.management.reconnect();
      else if (wechat && m.method === "wechat.disconnect") value = await wechat.management.disconnect();
      else if (telegramManagement && m.method === "telegram.state") value = await telegramManagement.state();
      else if (telegramManagement && m.method === "telegram.configure") value = await telegramManagement.configure(m.input.token);
      else if (telegramManagement && m.method === "telegram.pair") value = await telegramManagement.beginPairing();
      else if (telegramManagement && m.method === "telegram.candidate") value = await telegramManagement.candidate(m.input.code);
      else if (telegramManagement && m.method === "telegram.approve") value = await telegramManagement.approve(m.input.code, m.input.userId, m.input.chatId);
      else if (telegramManagement && m.method === "telegram.connect") value = await telegramManagement.connect();
      else if (telegramManagement && m.method === "telegram.disconnect") value = await telegramManagement.disconnect();
      else if (telegramManagement && m.method === "telegram.forget") value = await telegramManagement.forget();
      else throw new Error("web_method_denied");
      await send({ kind: "web_result", id: m.id, value });
    } catch (error) { await send({ kind: "web_result", id: m.id, error: engineError(error) }); }
  } else if (m.kind === "ingress") {
    try {
      if (!app || frozen || stopping) throw Error("service_upgrading");
      if(desktop&&!chatReady)throw Error("desktop_chat_not_ready");
      const value = app.submitMessage(m.input);
      await send({ kind: "ingress_result", id: m.id, value });
    } catch (error) { await send({ kind: "ingress_result", id: m.id, error: engineError(error) }); }
  } else if(m.kind==='timings'){
    await send({kind:'timings',diagnostics:app?{...app.receptionTimings.read(),outputPending:[...receipts].slice(0,64).map(([outputId,{requestId,startedAt,sentAt}])=>({outputId,requestId,startedAt,sentAt}))}:null});
  } else if (m.kind === "line") {
    if (!app || frozen) throw new Error("dev_input_while_frozen");
    if (m.text === "/status") await output({ type: "progress", text: JSON.stringify(app.snapshot()) });
    else await app.message(m.text, m.id);
    await send({ kind: "settled", id: m.id });
  } else if (m.kind === "probe") {
    // A busy owner stays fully available. Only a positive preflight permits
    // the launcher to freeze ingress; prepare still performs the final check.
    const safe = !!app && !frozen && !stopping && app.upgradeStatus().safe && !!wechat?.management.canUpgrade() && !!telegramManagement?.canUpgrade();
    await send({kind: "upgrade_probe", id: m.id, safe});
  } else if (m.kind === "prepare") {
    if (!app || frozen) return;
    frozen = true;
    if (!app.upgradeStatus().safe || !wechat?.management.canUpgrade() || !telegramManagement?.canUpgrade()) {
      frozen = false;
      await send({ kind: "busy" });
      return;
    }
    // Stop ingress before the final safety check. An update accepted during
    // the initial check must remain in this host's original main queue.
    await wechat.management.close();
    await telegram!.close();
    if (!app.upgradeStatus().safe) {
      wechat = new HomerWechat(app); await wechat.restore();
      telegram = new TelegramHomerBridge(app); telegramManagement = new TelegramManagement(telegram.channel); await telegram.restore();
      frozen = false; await send({ kind: "busy" }); return;
    }
    await send({ kind: "handoff", thread: app.store.meta("mainThread") });
    await stop(); // Parent waits for process exit, never just this notification.
  } else if (m.kind === "eof") {
    frozen = true;
    if (await app?.idle({ returnOnUserWait: true }) === "waiting_user")
      await output({ type: "progress", text: "输入已结束，待答 Worker 将停止；待答不能跨进程恢复。" });
    await stop();
  } else if (m.kind === "stop") await stop();
}
