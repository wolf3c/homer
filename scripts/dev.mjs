#!/usr/bin/env node
// Stable terminal owner: this process is deliberately never watched/restarted.
import { fork } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { sourceSnapshot, buildCandidate, buildUiCandidate, backendHash, uiHash, trustedHash, candidateGuard } from "./dev-build.mjs";

import {verifyBuild,sealBuild,copyRuntimeDependencies} from "./trusted-build.mjs";
import { IngressJournal } from "./dev-ingress.mjs";

export async function runDev({ root, configPath, json = false, webPort, mobileSignalOrigin = process.env.HOMER_MOBILE_SIGNAL_ORIGIN, mobileTurnAccount, pollMs = 300, debounceMs = 600, input = process.stdin, output = process.stdout, fixedBuild, fixedUi, fallbackUi, desktop }) {
  if(desktop&&!fixedBuild)throw Error("desktop_fixed_build_required");
  const desktopAccessToken=desktop?randomBytes(32).toString('hex'):undefined;
  const managementAllowed=desktop?(await import(pathToFileURL(join(fixedBuild.directory,'dist/desktop-management.js')).href)).desktopManagementAllowed:()=>false;
  if(fixedBuild&&!desktop){
    const dependencies=copyRuntimeDependencies(fixedBuild.directory,fixedBuild.config.runtime);
    const config=fixedBuild.config;
    fixedBuild=sealBuild(fixedBuild,dependencies);
    fixedUi=sealBuild({...fixedUi,hash:fixedUi.uiHash,config},dependencies);
    fallbackUi=sealBuild({...fallbackUi,hash:fallbackUi.uiHash,config},dependencies);
  }
  let current, candidate, child, phase = "building", stopped = false, eof = false;
  let building = false, lastHash, changedAt = 0, rejectedHash, checking = false;
  let expectedThread, handoffThread, timer, readyTimer, initial = true, upgradeProbe = false;
  let buildController;
  let web, cachedState, cachedHistoryState, webHistoryProtocol=0, finishing = false, desktopStoppedConfirmed=false,desktopChatError,desktopHostStarted=false,desktopStartupError;
  let review, approvedSourceHash, acceptedSnapshot, pendingUi, drainingReads=false, updateStopId, updateStopped=false;
  let recoveryCode;
  let journal, unlockGateway, uiCurrent, observedHash, rejectedUiHash;
  const uiBuilds = new Map(), ingressSending = new Set(), ingressWaiters = new Map(), ownedBuilds = new Set();
  const webRequests = new Map();
  const queue = [], inFlight = new Set();
  let doneResolve;
  const done = new Promise(r => { doneResolve = r; });
  const outputTimings=[];
  const markOutput=(phase,outputId)=>{try{if(typeof outputId!=='string'||!/^[-\w:.]{1,150}$/.test(outputId))return;outputTimings.push({phase,outputId,at:Date.now(),monotonicMs:performance.now()});if(outputTimings.length>128)outputTimings.splice(0,outputTimings.length-128);}catch{}};
  const write = (message,outputId) => new Promise((accept, reject) => {
    if (["main_start", "main_terminal", "tool_progress"].includes(message.type)) return accept();
    if (message.type === "delta" && !json) return accept();
    const measured=outputId&&['reply','delivery'].includes(message.type);
    if(measured)markOutput('output_write_start',outputId);
    output.write((json ? JSON.stringify(message) : `${message.type === "reply" ? "荷马" : message.type === "delivery" ? "交付" : "状态"}：${message.text}`) + "\n", e => {
      if(measured)markOutput(e?'output_write_failed':'output_write_end',outputId);
      e ? reject(e) : accept();
    });
  });
  const notice = text => write({ type: "progress", text });
  const send = message => {
    if (!child?.connected) return false;
    child.send(message, error => { if (error) void notice("dev_ipc_send_failed；已提交请求执行结果不确定，不自动重放。"); });
    return true;
  };
  const prepareWhenDrained=()=>{
    if(drainingReads&&phase==='preparing'&&!webRequests.size){drainingReads=false;send({kind:'prepare'});}
  };
  const invokeWeb = async (method, request = {}) => {
    if(method.startsWith('history.')&&webHistoryProtocol!==3)throw Error('history_protocol_required');
    // Only unsent reads may wait across a handoff. Mutations retain their exact
    // live context and fail visibly instead of running later in a new version.
    if (method.startsWith("history.") || ["taskOverview.progress", "taskOverview.list", "taskOverview.detail", "taskOverview.summary", "taskOverview.origin", "wechat.state", "wechat.qr", "telegram.state", "artifact", "artifactOrigin"].includes(method)) {
      const deadline = Date.now() + 5000;
      while (phase !== "running" && !(desktop&&phase==='management'&&managementAllowed(method,request)) && !stopped && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    }
    return new Promise((accept, reject) => {
    const management=desktop&&phase==='management'&&managementAllowed(method,request);
    if ((!management&&phase !== "running") || !child?.connected || stopped) return reject(new Error("service_upgrading"));
    const id = randomUUID();
    // QR poll allows 35s protocol wait plus dedicated Keychain write/read and
    // old-reference cleanup. This is a bounded management call, not main work.
    if(method==='media.upload'&&(!request||typeof request.data!=='string'||request.data.length>Math.ceil(8*1024*1024/3)*4))return reject(new Error('web_upload_size_limit'));
    const timeout = setTimeout(() => { webRequests.delete(id); reject(new Error("web_receipt_unconfirmed"));prepareWhenDrained(); }, method==='media.upload'?180000:method === "wechat.poll" || method === "telegram.configure" ? 90000 : method.startsWith("wechat.") || method.startsWith("telegram.") ? 35000 : 5000);
    webRequests.set(id, { accept, reject, timeout, method });
    if (!send({ kind: "web", id, method, input: request })) {
      clearTimeout(timeout); webRequests.delete(id); reject(new Error("web_receipt_unconfirmed"));prepareWhenDrained();
    }
    });
  };
  desktop?.bindAccount?.(action=>new Promise((accept,reject)=>{
    if(!['state','connect','cancel'].includes(action)||!['running','management'].includes(phase)||!child?.connected||stopped)return reject(Error('desktop_account_unavailable'));
    const id=randomUUID(),timeout=setTimeout(()=>{webRequests.delete(id);reject(Error('desktop_account_unconfirmed'));},15000);
    webRequests.set(id,{accept,reject,timeout,method:'desktop_account'});
    if(!send({kind:'desktop_account',id,method:action})){clearTimeout(timeout);webRequests.delete(id);reject(Error('desktop_account_unconfirmed'));}
  }));
  // UI adoption keeps the same executor and transport. Read-only refreshes
  // cannot starve it; mutations must settle before adopting trusted assets.
  const hasWebMutation=()=>[...webRequests.values()].some(item=>!item.method.startsWith("history.")&&!["state","taskOverview.progress", "taskOverview.list","taskOverview.detail", "taskOverview.summary", "taskOverview.origin","wechat.state","wechat.qr","telegram.state","artifact","artifactOrigin","media.read"].includes(item.method));
  const canStopForUpdate=()=>!stopped&&phase==='running'&&!!journal&&!inFlight.size&&!hasWebMutation()&&!queue.length&&!journal.pending().length;
  const updateBusy=()=>{updateStopId=undefined;upgradeProbe=false;desktop?.onEvent?.({kind:'update-busy'});};
  desktop?.bindUpdateStop?.(()=>{
    if(updateStopId)return;
    if(!canStopForUpdate()||upgradeProbe||!child?.connected){updateBusy();return;}
    updateStopId=randomUUID();upgradeProbe=true;
    if(!send({kind:'probe',id:updateStopId}))updateBusy();
  });
  const acceptInput = input => {
    if (stopped || !journal) throw Error("service_not_ready");
    if(desktop&&phase!=="running")throw Error("desktop_chat_not_ready");
    const stored = journal.store(input);publish();
    if (phase !== "running") return stored;
    const receipt = new Promise((accept, reject) => {
      const waiter = {accept, reject};
      const entries = ingressWaiters.get(input.requestId) ?? new Set();
      entries.add(waiter); ingressWaiters.set(input.requestId, entries);
      waiter.timeout = setTimeout(() => { entries.delete(waiter); if (!entries.size) ingressWaiters.delete(input.requestId); accept(stored); }, 2000);
    });
    flush();
    return receipt;
  };
  const pruneBuilds = () => {
    const retained = new Set([current?.directory, candidate?.directory,pendingUi?.directory, ...[...uiBuilds.values()].map(build => build.directory)]);
    for (const directory of ownedBuilds) if (!retained.has(directory)) { rmSync(directory, {recursive:true, force:true}); ownedBuilds.delete(directory); }
  };
  const recoveryRequired = async code => {
    recoveryCode=['dev_trusted_build_changed','dev_lock_release_unconfirmed','dev_inflight_unsettled','dev_child_exit_unconfirmed'].includes(code)?code:undefined;
    phase = "recovery_required";
    await notice(`${code}；入口继续暂存普通消息，业务状态须核对后重启，不自动重放执行或未知外发。`);
    publish();
  };
  const publish = () => { void web?.publish(); };
  async function startWeb(build) {
    if (webPort === undefined || web) return;
    const { createWebServer } = await import(pathToFileURL(join(build.directory, "dist/web-server.js")).href);
    const createServer = mobileSignalOrigin ? (await import(pathToFileURL(join(build.directory, 'dist/mobile-gateway.js')).href)).createMobileGateway : createWebServer;
    const state = async () => {
      if (phase === "running" || desktop&&phase==='management') {
        const owner=child,value=await invokeWeb("state");
        if(owner!==child)throw Error("service_generation_changed");
        cachedState=value;
      }
      if (!cachedState) throw new Error("service_not_ready");
      return { ...cachedState, upgrade: { reviewRequired:!!review, phase, ...(phase==='recovery_required'&&recoveryCode?{code:recoveryCode}:desktop&&desktopChatError?{code:desktopChatError}:{}), version: current?.version, uiVersion: uiCurrent?.uiHash, accepting: !!journal && !stopped && (!desktop||phase==='running'), transportPending: journal?.pending().map(item => item.id) ?? [], transportRejected: journal?.rejected() ?? [] } };
    };
    const historyState=async()=>{
      if(phase==='running'||desktop&&phase==='management'){
        const owner=child,value=await invokeWeb('history.state');if(owner!==child)throw Error('service_generation_changed');cachedHistoryState=value;
      }
      if(!cachedHistoryState)throw Error('service_not_ready');
      return {...cachedHistoryState,upgrade:{reviewRequired:!!review,phase,...(phase==='recovery_required'&&recoveryCode?{code:recoveryCode}:desktop&&desktopChatError?{code:desktopChatError}:{}),version:current?.version,uiVersion:uiCurrent?.uiHash,accepting:!!journal&&!stopped&&(!desktop||phase==='running')}};
    };
    web = await createServer({ port: webPort,
      ...(desktop?{desktopAccessToken}:{}),
      ...(mobileSignalOrigin?{signalOrigin:mobileSignalOrigin,turnAccount:mobileTurnAccount,databasePath:join(build.config.runtime,'homer.sqlite')} : {}),
      updateReview:{read:()=>review?{hash:review.hash,files:review.files}:null,approve:hash=>{
        if(!review||hash!==review.hash||sourceSnapshot(root,configPath).hash!==hash)throw Error('dev_update_review_stale');
        approvedSourceHash=hash;review=undefined;publish();return {approved:true};
      }},
      getAssets: version => ({ uiDirectory: version ? uiBuilds.has(version) ? join(uiBuilds.get(version).directory, "dist/web") : undefined : join(uiCurrent.directory, "dist/web"), logoPath: join(current.directory, "assets/branding/odysseus-20261030/homer-odysseus-256.png") }),
      bridge: { state,history:{state:historyState,page:input=>invokeWeb('history.page',input),process:input=>invokeWeb('history.process',input),resolve:input=>invokeWeb('history.resolve',input),queue:(after,readEpoch)=>invokeWeb('history.queue',{after,readEpoch}),dispatchQueue:input=>invokeWeb('history.dispatchQueue',input),interactions:(after,readEpoch)=>invokeWeb('history.interactions',{after,readEpoch}),receipts:async input=>{
        const value=await invokeWeb('history.receipts',input),transport=journal?.receipts(input.requestIds)??[];
        return {...value,statuses:value.statuses.map(item=>value.acceptedRequestIds.includes(item.requestId)?item:transport.find(row=>row.requestId===item.requestId)??item)};
      }},taskOverview:{progress:id=>invokeWeb("taskOverview.progress",{id}),summary:id=>invokeWeb("taskOverview.summary",{id}),origin:(id,messageId)=>invokeWeb("taskOverview.origin",{id,messageId}),list:()=>invokeWeb("taskOverview.list"),detail:(id,query)=>invokeWeb("taskOverview.detail",{id,...query})},media:{read:input=>invokeWeb('media.read',input),upload:input=>invokeWeb('media.upload',input),discard:input=>invokeWeb('media.discard',input)}, submit: async input => acceptInput(input), stop: messageId => invokeWeb("stop", { messageId }),
        queue:{edit:input=>invokeWeb('queue.edit',input),cancel:input=>invokeWeb('queue.cancel',input),move:input=>invokeWeb('queue.move',input),interrupt:(input,target)=>invokeWeb('queue.interrupt',{input,target})},
        feedback: (messageId, value) => invokeWeb("feedback", { messageId, value }),
        respond: (id, input) => invokeWeb("respond", { ...input, id }), artifact: runId => invokeWeb("artifact", { runId }), artifactOrigin: resultId => invokeWeb("artifactOrigin", {resultId}),
        revealArtifact:resultId=>invokeWeb('revealArtifact',{resultId}),
        wechat: { state: () => invokeWeb("wechat.state"), beginLogin: () => invokeWeb("wechat.login"),
          pollLogin: (id, verifyCode) => invokeWeb("wechat.poll", { id, verifyCode }), qrPng: id => invokeWeb("wechat.qr", { id }),
          disable: () => invokeWeb("wechat.disable"), reconnect: () => invokeWeb("wechat.reconnect"), disconnect: () => invokeWeb("wechat.disconnect") },
        telegram: { state: () => invokeWeb("telegram.state"), configure: token => invokeWeb("telegram.configure", { token }),
          beginPairing: () => invokeWeb("telegram.pair"), candidate: code => invokeWeb("telegram.candidate", { code }),
          approve: (code, userId, chatId) => invokeWeb("telegram.approve", { code, userId, chatId }),
          connect: () => invokeWeb("telegram.connect"), disconnect: () => invokeWeb("telegram.disconnect"), forget: () => invokeWeb("telegram.forget") },
      },
    });
    if(desktop)desktop.onEvent?.({kind:"url",url:web.url,desktopAccessToken});
    await notice(`本地界面已启动：${web.url}；直接打开此地址即可继续；Web 与本终端共用原主对话，关闭页面不会停止后台工作。`);
  }
  const flush = () => {
    if (phase !== "running" || stopped) return;
    while (queue.length) {
      const item = queue.shift();
      if (item.text === "/status") { inFlight.add(item.id); send({ kind: "line", ...item }); }
      else journal.store({ requestId: item.id, text: item.text });
    }
    for (const item of journal?.pending() ?? []) {
      if (ingressSending.has(item.id)) continue;
      ingressSending.add(item.id);
      if (!send({ kind: "ingress", id: item.id, input: item.input })) ingressSending.delete(item.id);
    }
    if (eof && webPort === undefined && !inFlight.size && !journal?.pending().length) { phase = "stopping"; send({ kind: "eof" }); }
  };
  const finish = () => {
    if (finishing) return;
    finishing = true;
    clearInterval(timer); clearTimeout(readyTimer);

    for (const request of webRequests.values()) { clearTimeout(request.timeout); request.reject(new Error("web_receipt_unconfirmed")); }
    webRequests.clear();
    for (const entries of ingressWaiters.values()) for (const waiter of entries) { clearTimeout(waiter.timeout); waiter.reject(Error("web_receipt_unconfirmed")); }
    ingressWaiters.clear();
    journal?.close(); journal = undefined; unlockGateway?.(); unlockGateway = undefined;
    rl.close(); input.pause();
    process.off("SIGINT", signal); process.off("SIGTERM", signal);
    if (web) void web.close().finally(doneResolve); else doneResolve();
  };
  const signal = () => {
    if (stopped) return;
    stopped = true;
    if (journal) for (const item of queue.splice(0)) if (item.text !== "/status") journal.store({requestId: item.id, text: item.text});
    buildController?.abort();
    clearInterval(timer);
    if (child) { phase = "stopping";publish(); send({ kind: "stop" }); }
    else if (!building) finish();
  };
  const rl = createInterface({ input, terminal: false });
  rl.on("line", line => {
    const text = line.trim();
    if (!text || stopped) return;
    if(text==="/timings"){send({kind:"timings"});return;}
    if (text === "/quit") { signal(); return; }
    if (text.length > 16000) { void notice("invalid_message"); return; }
    const item = { id: randomUUID(), text };
    try {
      if (journal && text !== "/status") {journal.store({requestId: item.id, text});publish();} else queue.push(item);
      flush();
    } catch (error) { void notice(error.message); }
  });
  rl.on("close", () => { eof = true; flush(); });
  process.on("SIGINT", signal); process.on("SIGTERM", signal);
  function launch(build, rollback = false) {
    if (stopped) return finish();
    try{verifyBuild(build);}catch{
      if(desktop){desktopStartupError='dev_trusted_build_changed';process.exitCode=1;finish();}
      else void recoveryRequired("dev_trusted_build_changed");
      return;
    }
    phase = rollback ? "rollback" : "starting";web?.reset();
    handoffThread = undefined;
    const own = fork(join(build.directory, "dist/dev-host.js"), [], {
      cwd: desktop?build.config.appData:root, execPath: process.execPath, execArgv: ["--disable-warning=ExperimentalWarning"], stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    desktopHostStarted=true;desktop?.onHostSpawn?.();
    child = own;
    // Do not kill a timed-out startup: it may still own an engine lease/lock.
    readyTimer = setTimeout(() => void notice("dev_start_waiting；启动尚未确认，输入继续保留，未宣称升级生效。"), 20000);
    own.on("message", raw => {
      void receive(raw).catch(() => { if (fixedBuild) process.exitCode = 1; void notice("cli_output_unconfirmed"); signal(); });
    });
    own.on("error", () => { void notice("dev_child_spawn_failed"); });
    own.on("exit", (code, exitSignal) => {
      if(own!==child)return;
      clearTimeout(readyTimer); child = undefined;
      void exited(code, exitSignal);
    });
    own.send({ kind: "init", desktop:!!desktop, config: build.config, buildHash:build.hash,terminalDeltas:json,webUploadProtocol:fixedBuild&&!desktop?0:webPort===undefined?0:1,nativeCapabilitiesProtocol:fixedBuild&&!desktop?0:webPort===undefined?0:1, thread: expectedThread });
    async function receive(m) {
      if(own!==child)return;
      if(desktop&&m.kind==='desktop_stopped'){desktopStoppedConfirmed=m.confirmed===true;return;}
      if(desktop&&m.kind==='management_ready'){
        if(m.stateInvalidationProtocol!==1)throw Error('state_invalidation_protocol_required');
        webHistoryProtocol=m.webHistoryProtocol??0;
        clearTimeout(readyTimer);current=build;phase='management';cachedState=undefined;
        await startWeb(build);publish();return;
      }
      if(desktop&&(m.kind==='account_usage_dirty'||m.kind==='account_config_check')){desktop.onEvent?.({kind:m.kind});return;}
      if(desktop&&m.kind==='chat_unavailable'){desktopChatError=m.code;desktop.onEvent?.({kind:'chat_unavailable',code:m.code});publish();return;}
      if(m.kind==="state_invalidated"&&m.protocol===1){publish();return;}
      if (m.kind === "ingress_result") {
        ingressSending.delete(m.id);
        if (!m.error) journal.acknowledge(m.id);
        else if (m.error !== "service_upgrading") { journal.reject(m.id, m.error); void notice(`输入未获业务接收：${m.id} ${m.error}；未自动改写或重放。`); }
        if (m.error !== "service_upgrading") {
          for (const waiter of ingressWaiters.get(m.id) ?? []) { clearTimeout(waiter.timeout); m.error ? waiter.reject(Error(m.error)) : waiter.accept(m.value); }
          ingressWaiters.delete(m.id);
        }
        flush(); publish();
      }
      else if (m.kind === "output") { await write(m.message,m.id); own.send({ kind: "written", id: m.id }); publish(); }
      else if(m.kind==="timings"){await notice(JSON.stringify(m.diagnostics?{...m.diagnostics,gatewayOutput:outputTimings.map(record=>({...record}))}:null));}
      else if (m.kind === "web_result") {
        const request = webRequests.get(m.id);
        if (request) { clearTimeout(request.timeout); webRequests.delete(m.id); m.error ? request.reject(new Error(m.error)) : request.accept(m.value);prepareWhenDrained(); }
      }
      else if (m.kind === "settled") { inFlight.delete(m.id); flush(); }
      else if (m.kind === "fatal") { if(desktop&&initial)desktopStartupError=m.code;await notice(`开发服务启动／运行失败：${m.code}；未自动重放请求。`); }
      else if (m.kind === "ready") {
        desktopChatError=undefined;
        webHistoryProtocol=m.webHistoryProtocol??0;
        clearTimeout(readyTimer);
        if(webPort!==undefined&&m.stateInvalidationProtocol!==1){await recoveryRequired("state_invalidation_protocol_required");return;}
        cachedState=undefined;cachedHistoryState=undefined;web?.reset();
        if (expectedThread && m.thread !== expectedThread) { signal(); return; }
        journal.bindThread(m.thread);
        expectedThread = m.thread;
        current = build;
        if(build.snapshot)acceptedSnapshot=build.snapshot;
        if (!uiCurrent) { uiCurrent = build; uiBuilds.set(build.uiHash, build); }
        if (candidate?.hash === build.hash) candidate = undefined;
        initial = false;
        phase = "running";
        recoveryCode=undefined;
        pruneBuilds();
        await startWeb(build);
        publish();
        await notice(`Homer 开发版${rollback ? "已恢复旧版" : "已生效"} ${build.version}（${m.engine}，${m.model}，${m.effort ?? build.config.effort}）；${m.restoring ? "原主对话标识已核验" : "首次主对话"}。`);
        flush();
      } else if (m.kind === "upgrade_probe") {
        upgradeProbe = false;
        if(updateStopId&&m.id===updateStopId){
          if(m.safe&&canStopForUpdate()){phase='preparing';publish();drainingReads=true;prepareWhenDrained();}
          else updateBusy();
          return;
        }
        if(m.safe&&phase==='running'&&pendingUi?.hash===m.id&&!stopped&&!inFlight.size&&!hasWebMutation()&&!queue.length&&!journal.pending().length){
          verifyBuild(pendingUi);uiCurrent=pendingUi;uiBuilds.set(pendingUi.uiHash,pendingUi);acceptedSnapshot=pendingUi.snapshot;pendingUi=undefined;pruneBuilds();publish();await notice('界面构建检查通过，已审阅并在安全空闲生效；原执行版本与任务继续运行。');
        }else if (m.safe && phase === "running" && candidate?.hash === m.id && !stopped && !inFlight.size && !hasWebMutation() && !queue.length && !journal.pending().length) {
          phase = "preparing";publish();drainingReads=true;prepareWhenDrained();
        }
      } else if (m.kind === "busy") {
        if(updateStopId)updateBusy();
        phase = "running";publish();
        flush();
      } else if (m.kind === "handoff") handoffThread = m.thread;
    }
    async function exited(code, exitSignal) {
      for (const request of webRequests.values()) { clearTimeout(request.timeout); request.reject(new Error("web_receipt_unconfirmed")); }
      webRequests.clear();
      ingressSending.clear(); upgradeProbe = false;
      if (stopped || phase === "stopping") return finish();
      if(updateStopId){
        if(phase==='preparing'&&typeof handoffThread==='string'&&!!handoffThread&&handoffThread===expectedThread&&desktopStoppedConfirmed&&code===0&&!exitSignal&&!inFlight.size&&!existsSync(join(current.config.runtime,'cli.lock'))){
          updateStopped=true;stopped=true;return finish();
        }
        return recoveryRequired('dev_child_exit_unconfirmed');
      }
      if (phase === "preparing" && handoffThread && code === 0 && !exitSignal) {
        if (existsSync(join(current.config.runtime, "cli.lock"))) {
          await notice("dev_lock_release_unconfirmed；停止切换。");
          return recoveryRequired("dev_lock_release_unconfirmed");
        }
        expectedThread = handoffThread;
        if (inFlight.size) {
          return recoveryRequired("dev_inflight_unsettled");
        }
        return launch(candidate??current,!candidate);
      }
      if (phase === "starting" && current && !initial && !exitSignal && !existsSync(join(current.config.runtime, "cli.lock"))) {
        rejectedHash = build.hash; candidate = undefined;
        await notice("候选启动失败，正在恢复旧版；交接输入继续保留。");
        return launch(current, true);
      }
      await notice(`开发服务退出（${code ?? exitSignal}）；${inFlight.size ? "已提交请求结果不确定，不自动重放；" : ""}${queue.length ? `仍有 ${queue.length} 条未提交输入，请在重新启动后重新输入；` : ""}未创建替代主对话。`);
      if (web && journal) return recoveryRequired("dev_child_exit_unconfirmed");
      process.exitCode = 1;
      finish();
    }
  }
  async function tick() {
    if (stopped || checking) return;
    checking = true;
    try {
      const snapshot = sourceSnapshot(root, configPath);
      if (snapshot.hash !== lastHash) { lastHash = snapshot.hash; changedAt = Date.now(); }
      if(current&&snapshot.hash!==current.hash&&snapshot.hash!==rejectedHash){
        candidateGuard(snapshot,current);
        if(trustedHash(snapshot)!==trustedHash(acceptedSnapshot)&&approvedSourceHash!==snapshot.hash){
          if(review?.hash!==snapshot.hash){
            const files=[];for(const path of new Set([...acceptedSnapshot.files.keys(),...snapshot.files.keys()])){
              const before=acceptedSnapshot.files.get(path),after=snapshot.files.get(path);if(before?.equals(after??Buffer.alloc(0)))continue;
              files.push({path,before:before?.toString('utf8')??null,after:after?.toString('utf8')??null});
            }
            review={hash:snapshot.hash,files};await notice('可信代码变化等待真实用户审阅：/settings/update；旧版继续可用。');publish();
          }
          flush();return;
        }
        if(review){review=undefined;publish();}
      }
      const reviewedBaseline=current?{...current,trustedHash:trustedHash(acceptedSnapshot),reviewedSourceHash:approvedSourceHash}:undefined;
      if (!building && current && backendHash(snapshot)===current.backendHash && uiHash(snapshot) !== uiCurrent?.uiHash && uiHash(snapshot) !== rejectedUiHash && snapshot.hash!==pendingUi?.hash && Date.now() - changedAt >= debounceMs) {
        building = true; buildController = new AbortController();
        try {
          if (uiBuilds.size >= 8 && !uiBuilds.has(uiHash(snapshot))) throw Error("dev_ui_retention_limit_restart_required");
          const nextUi = await buildUiCandidate(root, configPath, snapshot, reviewedBaseline, buildController.signal);
          if (stopped) { rmSync(nextUi.directory, {recursive:true, force:true}); return; }
          ownedBuilds.add(nextUi.directory);nextUi.snapshot=snapshot;pendingUi=nextUi;
          publish(); await notice(`界面 ${nextUi.uiHash.slice(0,12)} 构建检查通过，等待安全边界。`);
        } catch (error) {
          if (!stopped && error.message !== "dev_candidate_superseded") { rejectedUiHash = uiHash(snapshot); await notice(`界面候选未生效：${/^[a-z_]+$/.test(error.message) ? error.message : "dev_build_failed"}；当前界面继续可用。`); }
        } finally { building = false; buildController = undefined; }
      }
      if (!building && (phase === "running" || (!child && phase === "building")) && snapshot.hash !== observedHash && backendHash(snapshot) !== current?.backendHash && snapshot.hash !== candidate?.hash && snapshot.hash !== rejectedHash && Date.now() - changedAt >= debounceMs) {
        building = true;
        buildController = new AbortController();
        try {
          const next = await buildCandidate(root, configPath, snapshot, reviewedBaseline, buildController.signal);
          if (stopped) { rmSync(next.directory, {recursive:true, force:true}); return finish(); }
          ownedBuilds.add(next.directory);next.snapshot=snapshot;observedHash = snapshot.hash;
          if (!journal) {
            const { acquireLock } = await import(pathToFileURL(join(next.directory, "dist/processes.js")).href);
            const gatewayDir = join(next.config.runtime, "gateway"); mkdirSync(gatewayDir, {recursive:true, mode:0o700});
            unlockGateway = acquireLock(gatewayDir);
            try { journal = new IngressJournal(next.config.runtime, next.boundary); journal.bindContract(next.schema + ":" + next.toolsHash); expectedThread = journal.thread; } catch (error) { journal?.close(); journal = undefined; unlockGateway(); unlockGateway = undefined; throw error; }
          }
          if (current) { candidate = next; await notice(`候选 ${next.version} 构建检查通过，等待安全边界；忙碌任务继续运行。`); }
          else launch(next);
        } catch (error) {
          pruneBuilds();
          if (!stopped && error.message !== "dev_candidate_superseded") {
            rejectedHash = snapshot.hash;
            await notice(`候选未生效：${/^[a-z_]+$/.test(error.message) ? error.message : "dev_build_failed"}；${current ? "旧版继续运行。" : "修正后自动重试。"}`);
          }
        } finally { building = false; buildController = undefined; if (stopped && !child) finish(); }
      }
      flush();
      // Never activate a candidate superseded by another edit or partial write.
      if(pendingUi&&pendingUi.hash!==snapshot.hash){pendingUi=undefined;pruneBuilds();}
      if(pendingUi&&phase==="running"&&!upgradeProbe&&!inFlight.size&&!hasWebMutation()&&!queue.length&&!journal?.pending().length){upgradeProbe=true;send({kind:"probe",id:pendingUi.hash});}
      if (candidate && candidate.hash !== snapshot.hash) { candidate = undefined; pruneBuilds(); }
      if (candidate && phase === "running" && (!eof || webPort !== undefined) && !inFlight.size && !hasWebMutation() && !queue.length && !journal?.pending().length && Date.now() - changedAt >= debounceMs) {
        if (!upgradeProbe) { upgradeProbe = true; send({kind: "probe", id: candidate.hash}); }
      }
    } catch(error) {rejectedHash=lastHash;await notice(`${/^[a-z_]+$/.test(error.message)?error.message:"dev_source_read_failed"}；旧版保留，等待源码／配置恢复。`);}
    finally { checking = false; }
  }
  if (fixedBuild) {
    // Explicit maintenance mode: no source reads, builds, watchers or automatic
    // backend changes. The entry verifies the complete sealed manifest first.
    try {
      const { acquireLock } = await import(pathToFileURL(join(fixedBuild.directory, "dist/processes.js")).href);
      const gatewayDir = join(fixedBuild.config.runtime, "gateway"); mkdirSync(gatewayDir, {recursive:true, mode:0o700});
      unlockGateway = acquireLock(gatewayDir);
      journal = new IngressJournal(fixedBuild.config.runtime, fixedBuild.boundary);
      if (fixedBuild.config.pauseOldDesktopWork) journal.assertNoPending();
      journal.bindContract(fixedBuild.schema + ":" + fixedBuild.toolsHash);
      expectedThread = journal.thread;
      if (expectedThread && expectedThread !== fixedBuild.thread) throw Error("pinned_thread_mismatch");
      expectedThread = fixedBuild.thread;
      uiCurrent = fixedUi;
      for (const ui of [fallbackUi, fixedUi]) uiBuilds.set(ui.uiHash, ui);
      await notice("Homer 固定维护入口：保留原业务版本与消息队列；/quit 正常退出，不自动换版。");
      launch(fixedBuild);
    } catch (error) { desktopStartupError=error.message;process.exitCode = 1; await notice(error.message); finish(); }
  } else {
    await notice("Homer 开发启动器：可信代码须真实用户审阅，构建通过后在空闲边界换版；/quit 退出，EOF 等待交付。");
    timer = setInterval(() => void tick(), pollMs);
    await tick();
  }
  await done;
  if(desktop)return {stoppedConfirmed:desktopStoppedConfirmed,updateStopped,noHostStarted:!desktopHostStarted,...(desktopStartupError?{startupError:desktopStartupError}:{})};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2), at = args.indexOf("--config"), portAt = args.indexOf("--port");
  const webPort = args.includes("--web") ? portAt >= 0 ? Number(args[portAt + 1]) : 4780 : undefined;
  const invalidArgs = args.some((arg, i) => (at >= 0 && i === at + 1) || (portAt >= 0 && i === portAt + 1) ? false : !["--config", "--json", "--help", "--web", "--port"].includes(arg)) || args.filter(a => a === "--config").length > 1 || args.filter(a => a === "--port").length > 1 || (portAt >= 0 && (!args.includes("--web") || !Number.isInteger(webPort) || webPort < 1 || webPort > 65535));
  if (args.includes("--help")) console.log("npm run dev -- --config <原配置> [--json] [--web --port 4780]\nnpm run web -- --config <原配置> [--port 4780]\n稳定终端、候选构建、安全空闲换版；依赖／数据库／主工具契约变化阻止自动切换。");
  else if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith("--"))) { console.error("missing_config"); process.exitCode = 1; }
  else if (invalidArgs) { console.error("dev_unsupported_argument"); process.exitCode = 1; }
  else if (!process.version.startsWith("v22.")) { console.error("Node 22 required"); process.exitCode = 1; }
  else {
    const configPath = at >= 0 ? resolve(args[at + 1]) : undefined;
    // Validate readability before attaching terminal listeners.
    if (configPath) readFileSync(configPath);
    await runDev({ root, configPath, json: args.includes("--json"), webPort });
  }
}
