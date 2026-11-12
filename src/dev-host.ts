// Private IPC endpoint. Only the stable development launcher owns stdin.
import { randomUUID } from "node:crypto";
import { DesktopReviewRequired, Homer, type Message } from "./service.js";
import type { Config } from "./config.js";
import { effectiveEffort } from "./model-config.js";
import { engineError, codexVersion } from "./engine.js";
import { homerWebBridge } from "./web-homer.js";
import {desktopManagementAllowed} from './desktop-management.js';
import {configureDesktopImageDecoder} from './media-decode.js';
import {saveDesktopModelSource} from '../scripts/desktop-profile.mjs';
import {dingtalkChannel} from './dingtalk-channel.js';
import {telegramChannel} from './telegram-channel.js';
import {wechatChannel} from './wechat-channel.js';
import type {PowerFacts} from './desktop-power.js';

const send = (value: unknown) => new Promise<void>((resolve, reject) => {
  if (!process.send) return reject(new Error("dev_ipc_required"));
  process.send(value, error => error ? reject(error) : resolve());
});
let app: Homer | undefined;
let frozen = true;
let stopping = false;
let starting: Promise<void> | undefined;
let constructorRefused = false;
let powerRuntimeAvailable=false,powerSequence=0,lastPowerState='',lastPowerActivity='';
let powerTimer:ReturnType<typeof setInterval>|undefined;
const powerAcks=new Map<number,()=>void>();
function powerActivity(execution?:{executing:boolean;displayRequired:boolean}):Omit<PowerFacts,'nextScheduledAt'>{
 return {runtimeAvailable:powerRuntimeAvailable,...(execution??app!.desktopPowerFacts()),channels:app!.channels?.wakePollingChannels()??[]};
}
function publishPower(refreshCalendar=false){
 if(!desktop||!app||!process.connected)return;
 try{
  const activity=powerActivity(),activityKey=JSON.stringify(activity);
  if(!refreshCalendar&&activityKey===lastPowerActivity)return;
  const facts={...activity,nextScheduledAt:app.nextScheduledMessageAt()},key=JSON.stringify(facts);
  lastPowerActivity=activityKey;if(key===lastPowerState)return;lastPowerState=key;
  void send({kind:'power_state',facts}).catch(()=>{lastPowerState='';lastPowerActivity='';});
 }catch{lastPowerActivity='';} // The next owner notification retries without blocking a task.
}
function protectPower(execution:{executing:boolean;displayRequired:boolean}){
 if(!desktop||!app||!process.connected)return Promise.resolve();
 return new Promise<void>(resolve=>{
  const id=++powerSequence,timer=setTimeout(()=>finish(),1000);
  const finish=()=>{clearTimeout(timer);powerAcks.delete(id);resolve();};
  powerAcks.set(id,finish);
  try{void send({kind:'power_acquire',id,facts:{...powerActivity(execution),nextScheduledAt:app!.nextScheduledMessageAt()}}).catch(finish);}catch{finish();}
 });
}
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
      const account=await app!.manageNativeAccount({action:'account_state'});
      if(stopping)return;
      if(!account.connected){await send({kind:'chat_unavailable',code:'desktop_account_required'});invalidateState();return;}
    }
    if(stopping)return;
    const restoring=!!app!.store.meta('mainThread');
    starting=app!.start({keepManagementOnFailure:true});
    try{
      await starting;if(stopping)return;
      chatReady=true;
      await announceReady(restoring);
    }catch(error){
      const blocked=error instanceof Error&&['main_stop_unconfirmed','orphan_stop_unconfirmed','desktop_start_owner_unconfirmed'].includes(error.message);
      const code=blocked?(error as Error).message:'desktop_chat_unavailable';
      if(blocked)desktopRetryBlocked=true;
      await send({kind:'chat_unavailable',code});
    }finally{starting=undefined;invalidateState();}
  })().finally(()=>{desktopChatStarting=undefined;});
  return desktopChatStarting;
}
let webUploadProtocol=false;
const receipts = new Map<string, { resolve: () => void; reject: (error: Error) => void; requestId?:string;startedAt:number;sentAt?:number;measured:boolean }>();
async function output(message: Message) {
  const id = randomUUID();
  const source=message.requestId??('sourceRequestId' in message?message.sourceRequestId:undefined);
  const requestId=source&&/^[\w:.-]{1,150}$/.test(source)?source:undefined;
  // Keep per-write metadata on the original receipt, never a second outbox.
  // Only final replies add history points; high-volume deltas remain
  // inspectable while pending without evicting an entire turn's timing trail.
  const measured=message.type==='reply';
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
  clearInterval(powerTimer);powerTimer=undefined;
  for(const finish of powerAcks.values())finish();
  if(stateInvalidationRetry)clearTimeout(stateInvalidationRetry);
  frozen = true;
  let confirmed=false;
  try { await desktopChatStarting?.catch(() => {}); await starting?.catch(() => {}); await app?.close({requireAllOwnersConfirmed:desktop});confirmed=!!app||constructorRefused; }
  catch { process.exitCode = 1; }
  if(confirmed){powerRuntimeAvailable=false;publishPower();}
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
  const m = raw as { desktop?:boolean; kind: string; config: Config; buildHash?:string; terminalDeltas?:boolean;webUploadProtocol?:number;thread?: string; id: string; text: string; method: string; input: any };
  if (m.kind === "written") {
    const pending=receipts.get(m.id);
    if(pending?.measured)app?.receptionTimings.mark('output_ipc_ack',{outputId:m.id,requestId:pending.requestId});
    pending?.resolve();
  } else if (m.kind === "init") {
    if (app) throw new Error("dev_already_initialized");
    desktop=m.desktop===true;
    if(!desktop&&(m.config.pauseOldDesktopWork||m.config.dailyDeepSeek||m.config.desktopConnection||m.config.desktopModelSource||m.config.desktopProfile!==undefined||m.config.desktopAdopted||m.config.chatgpt||m.config.serviceTier!==undefined))throw Error('desktop_pause_scope_invalid');
    if(desktop){if(!m.config.desktopResources)throw Error('desktop_resource_identity_required');configureDesktopImageDecoder(m.config.desktopResources);}
    webUploadProtocol=m.webUploadProtocol===1;
    // Only an explicit plain-terminal opt-out skips IPC. Legacy/private host
    // callers keep their existing stream until they declare otherwise.
    const terminalDeltas=m.terminalDeltas!==false;
    const telegram=telegramChannel(m.config.runtime);
    const wechat=wechatChannel(m.config.runtime);
    const dingtalk=dingtalkChannel(m.config.runtime);
    const adapters=[...(telegram?[telegram]:[]),...(wechat?[wechat]:[]),...(dingtalk?[dingtalk]:[])];
    try {
    app = new Homer(m.config, async (message: Message) => {
      if (["main_start", "main_terminal", "tool_progress"].includes(message.type)) return;
      if(message.type==='delta'&&!terminalDeltas)return;
      await output(message);
    },undefined,adapters);
    for(const adapter of adapters)adapter.applyBindings(app.channels!);
    } catch(error) { if(desktop&&error instanceof DesktopReviewRequired)constructorRefused=true;await app?.close();throw error; }
    app.onStateChange(reason=>{invalidateState();publishPower();if(desktop&&(reason==='model-turn'||reason==='user-input'))void send({kind:reason==='model-turn'?'account_usage_dirty':'account_config_check'}).catch(()=>{});});
    if(desktop){
      powerRuntimeAvailable=true;app.bindDesktopPowerProtection(protectPower);app.onScheduleChanged(()=>publishPower(true));publishPower(true);
      powerTimer=setInterval(()=>publishPower(true),5000);powerTimer.unref();
    }
    if(m.buildHash)app.registerRuntimeBuild(m.buildHash);
    if(webUploadProtocol)app.registerWebSurface(true);
    if (m.thread && app.store.meta("mainThread") !== m.thread)
      throw new Error("main_resume_thread_mismatch");
    if(desktop){
      app.schedules.start();
      frozen=false;
      await send({kind:'management_ready',stateInvalidationProtocol:1,webHistoryProtocol:3});
      void startDesktopChat().catch(async()=>{try{await send({kind:'chat_unavailable',code:'desktop_chat_unavailable'});}catch{}});
      return;
    }
    const restoring = !!app.store.meta("mainThread");
    starting = app.start();
    await starting;
    if (stopping) return;
    if(webUploadProtocol)app.webHistoryPages();
    frozen = false;
    await send({ kind: "ready", thread: app.store.meta("mainThread"), restoring, stateInvalidationProtocol:1,webHistoryProtocol:3, model: m.config.model,
      effort: effectiveEffort(m.config.effort), engine: codexVersion(m.config.codexBin) });
  } else if(m.kind==='desktop_power_ack'){
    const id=(raw as {id:unknown}).id;
    if(desktop&&typeof id==='number'&&Number.isSafeInteger(id))powerAcks.get(id)?.();
  } else if(m.kind==='desktop_power'){
    try{
      if(!desktop||!app||stopping||m.method!=='resume')throw Error('desktop_power_forbidden');
      app.recheckScheduledMessages();await app.channels?.resumeAfterSleep(m.input?.afterSleep!==false);publishPower(true);
      await send({kind:'web_result',id:m.id,value:true});
    }catch{await send({kind:'web_result',id:m.id,error:'power_recheck_unconfirmed'});}
  } else if(m.kind==='desktop_account'){
    try{
      if(!desktop||!app||frozen||stopping)throw Error('desktop_account_forbidden');
      if(m.method==='channel-state'){
        await send({kind:'web_result',id:m.id,value:app.channels?.connectionStatus()??[]});
        return;
      }
      if(m.method==='models'){await send({kind:'web_result',id:m.id,value:await app.manageNativeAccount({action:'model_list'})});return;}
      if(m.method==='apply-models'){
        const profile=app.config.desktopProfile;if(!profile)throw Error('chatgpt_model_source_changed');
        await app.applyChatGPTModels(m.input,overrides=>saveDesktopModelSource(profile,'codex',overrides));
        await send({kind:'web_result',id:m.id,value:true});return;
      }
      if(!['state','connect','cancel'].includes(m.method))throw Error('desktop_account_forbidden');
      const state=await app.manageNativeAccount({action:'account_state'});
      const value=m.method==='connect'?await app.manageNativeAccount({action:'account_login',approve:true}):m.method==='cancel'&&state.loginId?await app.manageNativeAccount({action:'account_cancel',approve:true,loginId:state.loginId}):state;
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
      const bridge = homerWebBridge(app,{draftUpload:webUploadProtocol});
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
      else if(m.method==='taskOverview.detail'){const {id,...query}=m.input;value=await bridge.taskOverview!.detail(id,Object.keys(query).length?query:undefined);}
      else if(m.method === 'media.read')value=await bridge.media!.read(m.input);
      else if(m.method === 'media.origin'&&bridge.media?.origin)value=await bridge.media.origin(m.input);
      else if(m.method === 'media.reveal'&&bridge.media?.reveal)value=await bridge.media.reveal(m.input);
      else if(m.method === 'media.upload'){if(!bridge.media?.upload)throw Error('web_upload_unavailable');value=await bridge.media.upload(m.input);}
      else if(m.method === 'media.preview'){if(!bridge.media?.previewDraft)throw Error('web_upload_unavailable');value=await bridge.media.previewDraft(m.input);}
      else if(m.method === 'media.discard'){if(!bridge.media?.discard)throw Error('web_upload_unavailable');value=await bridge.media.discard(m.input);}
      else if (m.method === "submit") value = await bridge.submit(m.input);
      else if (m.method === "feedback") value = await bridge.feedback!(m.input.messageId, m.input.value);
      else if(m.method==='queue.edit')value=await bridge.queue!.edit(m.input);
      else if(m.method==='queue.cancel')value=await bridge.queue!.cancel(m.input);
      else if(m.method==='queue.move')value=await bridge.queue!.move!(m.input);
      else if(m.method==='queue.interrupt')value=await bridge.queue!.interrupt(m.input.input,m.input.target);
      else if (m.method === "stop") value = await bridge.stop(m.input.messageId);
      else if (m.method === "respond") value = await bridge.respond(m.input.id, m.input);
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
    const safe = !!app && !frozen && !stopping && app.upgradeStatus().safe;
    await send({kind: "upgrade_probe", id: m.id, safe});
  } else if (m.kind === "prepare") {
    if (!app || frozen) return;
    frozen = true;
    if (!app.upgradeStatus().safe) {
      frozen = false;
      await send({ kind: "busy" });
      return;
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
