import {leaseOwnerGone,processIdentity,terminateLease} from './processes.js';
import {nativeHistoryBridge} from './native-history-bridge.js';
import {TurnExecution,executionCounters} from './execution-limits.js';
import {INTERACTION_LIMITS} from './interaction-limits.js';
import {verifiedDesktopResources} from './desktop-resources.js';
import{materializeNativeImage}from"./native-generated-files.js";
import {
  spawn,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { mkdirSync, existsSync, realpathSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Config } from "./config.js";
import { effectiveEffort, effectiveFast, type ModelRole } from "./model-config.js";
import {usesHomerNativeHome,effectiveModelConfig,configuredWebSearchMode} from "./config.js";
import {deepseekProfile,materializeDeepSeekCatalog} from './deepseek-model.js';
import {validateContextTuning} from './model-context.js';
import {validateModelCapabilities,membershipModelCatalog,materializeModelCatalog} from './model-catalog.js';
import { WorkerNativeRequests, type NativeRequest } from "./worker-native-requests.js";
import type { InteractionResolution } from "./worker-interactions.js";
import { HOST_MCP_TOOLS } from "./worker-interaction-mcp.js";
import {publicActivityName} from './activity-facts.js';
import {nativeToolContent} from './tool-content.js';
import {activitySummaryText} from './message-quote.js';
import {queryHomerTokenFailure} from './homer-account.js';
export type Tool = {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type ToolCall = {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
};
export type TurnResult = {
  status: string;
  text: string;
  errorCode?: string;
  usage?: unknown;
  nativeOutputError?:string;
  messages?:{itemId:string;phase:string|null;text:string}[];
};
export type EngineImage={url:string};
import type {NativeProcessEvent, NativeToolCategory, TurnTimingEvidence} from './main-process.js';
const finiteTime=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const nativeCategories:Record<string,NativeToolCategory>={commandExecution:'command',fileChange:'fileChange',webSearch:'webSearch',imageView:'imageView',imageGeneration:'imageGeneration',mcpToolCall:'externalTool',dynamicToolCall:'externalTool'};
// Turn timestamps are protocol seconds; item timestamps are protocol milliseconds.
function turnTiming(turn:any,observedAtMs=Date.now()):TurnTimingEvidence{
  return {observedAtMs,...(finiteTime(turn?.startedAt)&&finiteTime(turn.startedAt*1000)?{startedAtMs:turn.startedAt*1000}:{}),...(finiteTime(turn?.completedAt)&&finiteTime(turn.completedAt*1000)?{endedAtMs:turn.completedAt*1000}:{}),...(finiteTime(turn?.durationMs)?{durationMs:turn.durationMs}:{})};
}
function safeNativeProcess(threadId:string,turnId:string,item:any,completed:boolean):NativeProcessEvent|undefined{
  if(!item||typeof item.id!=='string'||typeof item.type!=='string')return;
  if(item.type==='mcpToolCall'&&(typeof item.server!=='string'||typeof item.tool!=='string'))return;
  if(item.type==='dynamicToolCall'&&typeof item.tool!=='string')return;
  if(!Object.hasOwn(nativeCategories,item.type))return;
  let category=nativeCategories[item.type]!;
  if(item.type==='commandExecution'){
    const actions=Array.isArray(item.commandActions)?item.commandActions.map((action:any)=>action?.type):[];
    category=!actions.length||actions.some((type:unknown)=>!['read','search','listFiles'].includes(String(type)))?'command':actions.every((type:unknown)=>type==='read')?'readFiles':actions.every((type:unknown)=>type==='search')?'search':actions.every((type:unknown)=>type==='listFiles')?'listFiles':'inspectFiles';
  }
  let status:NativeProcessEvent['status']=completed?'unknown':'running';
  if(completed){
    if(['completed','failed','declined','interrupted'].includes(item.status))status=item.status;
    if(status==='completed'&&item.type==='commandExecution'&&typeof item.exitCode==='number'&&item.exitCode!==0)status='failed';
    if(['webSearch','imageView'].includes(item.type)&&item.status===undefined)status='completed';
    if(item.type==='dynamicToolCall'&&item.success===false)status='failed';
    if(item.type==='imageGeneration'&&item.failure)status='failed';
  }
  // Public labels stay separate from the authorized, bounded call snapshot.
  const fileCount=category==='fileChange'&&Array.isArray(item.changes)&&item.changes.every((change:any)=>typeof change?.path==='string')?new Set(item.changes.map((change:any)=>change.path)).size:undefined;
  const tool=category==='externalTool'?publicActivityName(item.tool):undefined;
  return {threadId,turnId,itemId:item.id,category,status,completed,content:nativeToolContent(item,completed),...(tool?{toolName:tool,label:'调用外部工具：'+tool}:{}),observedAtMs:Date.now(),...(fileCount!==undefined?{fileCount}:{}),...(finiteTime(item.startedAtMs)?{startedAtMs:item.startedAtMs}:{}),...(finiteTime(item.completedAtMs)?{endedAtMs:item.completedAtMs}:{}),...(finiteTime(item.durationMs)?{durationMs:item.durationMs}:{})};
}
export type EngineOptions = {
  cwd: string;
  readRoots: string[];
  instructions: string;
  tools: Tool[];
  // Homer execution role, independent of native tool permissions/sub-agents.
  role?: ModelRole;
  threadId?: string;
  interactionMcp?: { command: string; args: string[]; cwd: string; catalog?: Tool[] };
  onInteraction?: (request: NativeRequest) => Promise<InteractionResolution>;
  nativeTools?: "main" | "worker";
  controlOnly?: boolean;
};
export type EngineLike = {
  request?(method:string,params:any):Promise<any>;
  refreshCapabilities?(force?:boolean):Promise<void|{pending:boolean}>;
  readonly nativeBusy?:boolean;
  readonly turnActive?:boolean;
  readonly nativeInteractionPending?:boolean;
  // A failed turn and an unavailable process are separate facts.
  readonly available?:boolean;
  imageCapability?():Promise<boolean>;
  resumable?: boolean;
  pid?: number;
  threadId?: string;
  turnId?: string;
  on(event: string, listener: (...args: any[]) => void): any;
  start(): Promise<string>;
  turn(
    text: string,
    options?: {
      cwd?:string;
      onStarted?: (id: string, timing?: TurnTimingEvidence) => void;
      images?:EngineImage[];
      skills?:{name:string;path:string}[];
    },
  ): Promise<TurnResult>;
  interrupt(): Promise<boolean>;
  steer?(expectedTurnId:string,text:string):Promise<{turnId:string}>;
  compact?():Promise<void>;
  close(): Promise<boolean>;
};
export function engineError(error: unknown): string {
  if (error instanceof Error && /^prompt_file_(missing|unreadable|empty):(main|worker)\.md$/.test(error.message))
    return error.message;
  if (error instanceof Error && /^[a-z][a-z0-9_]{1,70}$/.test(error.message))
    return error.message;
  return "engine_protocol_error";
}
// Only pending RPCs rejected by transport shutdown carry this evidence.
// The request may have executed; pre-send and explicit native errors do not.
export class EngineRpcUnconfirmed extends Error {}
// Only error classifications escape the adapter. Raw errors can include response bodies or URLs.
function rpcError(value: any): Error {
  if(value?.data?.config_write_error_code==='configVersionConflict')return new Error('capability_config_conflict');
  const msg = String(value?.message ?? "");
  if(value?.code===-32600&&/^thread not found: [a-zA-Z0-9_-]+$/.test(msg))return new Error('engine_thread_not_found');
  if (/insufficient[_\s-]+(?:quota|balance|credits?)|(?:quota|balance|credits?)(?:\s+is)?\s+(?:not enough|insufficient|exhausted)|(?:余额|额度)不足/i.test(msg))
    return new Error("engine_quota_insufficient");
  if (/^\s*401\b|\b(?:HTTP(?:\/[\d.]+)?\s+|status(?:\s+code)?[=:]?\s*)401\b|unauthorized|authentication/i.test(msg))
    return new Error("engine_authentication_failed");
  if (/^\s*429\b|\b(?:HTTP(?:\/[\d.]+)?\s+|status(?:\s+code)?[=:]?\s*)429\b|rate[ _.-]?limit|too many requests/i.test(msg))
    return new Error("engine_rate_limited");
  if (/sandbox|permissions|operation not permitted/i.test(msg))
    return new Error("engine_permission_failed");
  if (/read.*rollout|rollout.*not found|no.*rollout/i.test(msg))
    return new Error("engine_thread_history_unavailable");
  if (/model.*not|unsupported.*model/i.test(msg))
    return new Error("engine_model_unavailable");
  return new Error("engine_rpc_failed");
}
// Host file operations protect the installed executables and companion bundle.
export function nativeExecutableRoots(config:Config){
  const roots=new Set([realpathSync(process.execPath),realpathSync(config.codexBin)]);
  for(let directory=dirname(config.codexBin);dirname(directory)!==directory;directory=dirname(directory)){
    const metadata=join(directory,'package.json');
    if(existsSync(metadata)&&/^@openai\/codex(?:-[a-z0-9-]+)?$/.test(JSON.parse(readFileSync(metadata,'utf8')).name??'')){roots.add(realpathSync(directory));break;}
  }
  const companion=join(dirname(config.codexBin),'codex-code-mode-host');
  if(existsSync(companion))roots.add(realpathSync(companion));
  if(config.desktopResources)roots.add(verifiedDesktopResources(config.desktopResources).bundleRoot);
  return [...roots];
}
function controlPermissions(config: Config, readRoots: string[]) {
  const filesystem: Record<string, string> = {":root": "deny", ":minimal": "read", [dirname(config.codexBin)]: "read"};
  for (const root of readRoots) filesystem[root] = "read";
  return { filesystem, network: { enabled: false } };
}
function toml(v: unknown): string {
  if (typeof v === "object" && v !== null && !Array.isArray(v))
    return (
      "{" +
      Object.entries(v)
        .map(([k, x]) => `${JSON.stringify(k)}=${toml(x)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
// Only networking settings reach the trusted Codex transport; no other
// application environment or proxy configuration is exposed to model tools.
export function codexProxyEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  systemSettings?: string,
): NodeJS.ProcessEnv {
  const proxy: NodeJS.ProcessEnv = {};
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"])
    if (source[key]) proxy[key] = source[key];
  if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some(key => proxy[key]))
    return proxy;
  if (systemSettings === undefined && process.platform === "darwin") {
    try {
      systemSettings = execFileSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 2000 });
    } catch {
      // Without a configured system proxy, preserve normal direct transport.
      return proxy;
    }
  }
  const value = (key: string) => systemSettings?.match(new RegExp("^\\s*" + key + "\\s*:\\s*(\\S+)\\s*$", "m"))?.[1];
  for (const kind of ["HTTP", "HTTPS"]) {
    const host = value(kind + "Proxy");
    const port = Number(value(kind + "Port"));
    if (value(kind + "Enable") === "1" && host && /^[a-zA-Z0-9.:[\]-]+$/.test(host) && Number.isInteger(port) && port > 0 && port <= 65535)
      proxy[kind + "_PROXY"] = `http://${host}:${port}`;
  }
  return proxy;
}
export class CodexEngine extends EventEmitter implements EngineLike {
  private readonly sourceConfig:Config;
  private imageSupported?:{model:string;supported:boolean};
  private async modelInfo(name=this.config.model){
    let cursor:string|undefined;const cursors=new Set<string>();
    do{
      const response=await this.request('model/list',{includeHidden:true,...(cursor?{cursor}:{})});
      const model=response.data?.find((value:any)=>value.model===name||value.id===name);if(model)return model;
      const next=response.nextCursor;if(next!=null&&(typeof next!=='string'||!next||cursors.has(next)))throw Error('engine_model_catalog_invalid');
      cursor=next??undefined;if(cursor)cursors.add(cursor);
    }while(cursor);
  }
  async imageCapability(){
    const model=this.config.desktopModelSource==='codex'&&!this.active&&!this.preparation&&!this.compaction?effectiveModelConfig(this.sourceConfig,this.options.role).model:this.config.model;
    if(this.imageSupported?.model===model)return this.imageSupported.supported;
    const info=await this.modelInfo(model),supported=!!info?.inputModalities?.includes('image');
    this.imageSupported={model,supported};return supported;
  }
  private child?: ChildProcessWithoutNullStreams;
  private preparation?: object;
  private async prepared<T>(operation:object,work:Promise<T>):Promise<T>{
    const value=await work;
    if(this.preparation!==operation)throw Error("engine_configuration_cancelled");
    return value;
  }
  private sequence = 0;
  private pending = new Map<
    number,
    {
      method: string;
      resolve: (value: any) => void;
      reject: (e: Error) => void;
      checking?:boolean;
    }
  >();
  private active?: {
    resolve: (r: TurnResult) => void;
    reject: (e: Error) => void;
    messages:NonNullable<TurnResult['messages']>;
    usage?: unknown;
    execution:TurnExecution;
    guardRequested?:boolean;
    evidenceItems?:Set<string>;
    partialMessages?:Map<string,{itemId:string;phase:string|null;text:string}>;
    earlyEvents: string[];
    nativeImageItems?:Set<string>;
    nativeOutputError?:string;
    deltaFenced?:boolean;
    reasoningSummary?:{itemId:string;itemIds:Set<string>;summaryIndex:number;text:string;completed?:boolean};
    messageOrder?:string[];
    settling?:boolean;
  };
  private usageBaseline?:ReturnType<typeof executionCounters>;
  private compaction?: {
    turnId?: string;
    itemId?: string;
    settling?: boolean;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  private historyBridge?:Awaited<ReturnType<typeof nativeHistoryBridge>>;
  private exited = false;
  private closing = false;
  private failure?: Error;
  private websiteToken?:string;
  private failureChecks=new AbortController();
  private toolResponses = new Map<string, Promise<any>>();
  private nativeRequests: WorkerNativeRequests;
  private nativeItems = new Map<string, Record<string, unknown>>();
  private backgroundTimer?:NodeJS.Timeout;
  private backgroundCheck?:Promise<void>;
  private backgroundUnconfirmed=false;
  private appliedVersion?:string;
  get nativeBusy(){return this.backgroundUnconfirmed;}
  get turnActive(){return !!this.active&&!this.active.settling;}
  get available(){return !this.failure&&!this.closing&&!this.exited;}
  private backgroundActivity(busy:boolean){if(this.backgroundUnconfirmed!==busy){this.backgroundUnconfirmed=busy;this.emit('powerActivity');}}
  private async refreshBackground(){
    if(!this.options.nativeTools||!this.threadId||this.closing||this.exited)return;
    if(this.backgroundCheck)return this.backgroundCheck;
    if(this.backgroundTimer){clearTimeout(this.backgroundTimer);this.backgroundTimer=undefined;}
    const work=(async()=>{let confirmed=false;try{
      const result=await this.request('thread/backgroundTerminals/list',{threadId:this.threadId,limit:100});
      confirmed=Array.isArray(result.data);this.backgroundActivity(!confirmed||result.data.length>0||!!result.nextCursor);
    }catch{this.backgroundActivity(true);}
    finally{this.backgroundCheck=undefined;if(confirmed&&this.backgroundUnconfirmed&&!this.closing&&!this.exited){this.backgroundTimer=setTimeout(()=>void this.refreshBackground(),500);this.backgroundTimer.unref();}}
    })();this.backgroundCheck=work;return work;
  }
  pid?: number;
  private windowsLease?:{pid:number;identity:string};
  threadId?: string;
  turnId?: string;
  // Codex does not persist a fresh empty thread until its first turn.
  resumable = false;
  version?: string;
  constructor(
    readonly config: Config,
    readonly options: EngineOptions,
    readonly handleTool: (call: ToolCall) => Promise<unknown>,
  ) {
    super();
    this.sourceConfig=config;
    this.config=effectiveModelConfig(config,options.role);
    if(this.config.desktopModelSource==='website'&&this.config.keyEnv)this.websiteToken=process.env[this.config.keyEnv];
    this.nativeRequests = this.requestBridge();
  }
  private async modelError(value:unknown):Promise<Error>{
    const error=rpcError(value);
    if(error.message!=='engine_authentication_failed'||this.config.desktopModelSource!=='website'||!this.websiteToken||!this.config.baseUrl)return error;
    return Error(await queryHomerTokenFailure(this.websiteToken,{gatewayOrigin:new URL(this.config.baseUrl).origin},this.failureChecks.signal));
  }
  private get executionEnabled(){return this.config.executionLimits!==undefined||!!deepseekProfile(this.config);}
  private publishExecution(active:NonNullable<CodexEngine['active']>){
    if(this.active!==active||!this.executionEnabled)return;
    active.usage={...(active.usage&&typeof active.usage==='object'?active.usage:{}),execution:{...active.execution.snapshot}};
    this.emit('usage',active.usage);
    if(active.execution.snapshot.stopReason&&!active.guardRequested){
      active.guardRequested=true;
      // ACK or timeout never completes a turn. Only native terminal owns that.
      void this.interrupt();
    }
  }
  private requestBridge() {
    return new WorkerNativeRequests({
      worker: this.options.role === 'worker',
      current: () => ({ active: !!this.active && !this.active.settling && !this.closing && !this.exited, threadId: this.threadId, turnId: this.turnId }),
      forward: request => {
        if (this.options.onInteraction) return this.options.onInteraction(request);
        if (request.method === "mcpServer/elicitation/request") throw Error("interaction_handler_unavailable");
        return Promise.resolve({status: "denied", decision: {action: "deny", reason: "interaction_capability_denied"}});
      },
      send: message => this.send(message),
      delivered: id => this.emit("interactionDelivered", id),
      invalidated: (id, code) => this.emit("interactionInvalidated", id, code),
      changed: () => this.emit('interactionWaiting'),
    });
  }
  get nativeInteractionPending() { return this.nativeRequests.hasPending; }
  private publishNativeProcess(method:string,p:any){
    const hostTool=p.item?.type==='mcpToolCall'&&p.item.server==='homer_interactions'||p.item?.type==='dynamicToolCall'&&this.options.tools.some(tool=>tool.name===p.item.tool);
    const workerMcp=this.options.nativeTools==='worker'&&p.item?.type==='mcpToolCall'&&p.item.server==='homer_interactions';
    if(method==='item/started'&&this.options.nativeTools&&hostTool&&p.item.type==='mcpToolCall'&&typeof p.item.id==='string'&&typeof p.item.tool==='string')
      this.emit('hostMcpToolStarted',{threadId:p.threadId,turnId:p.turnId,itemId:p.item.id,tool:p.item.tool,arguments:p.item.arguments});
    const safe=hostTool&&!workerMcp?undefined:safeNativeProcess(p.threadId,p.turnId,p.item,method==='item/completed');
    if(safe)this.emit('nativeProcess',safe);
  }
  private assertInteractionMcpBoundary(effective:any){
    // Native tables merge. File-backed declarations may not append env or
    // other options to Homer's endpoint; ignored untrusted layers stay ignored.
    if(effective.layers?.some((l:any)=>!l.disabledReason&&l.name?.type!=="sessionFlags"&&Object.hasOwn(l.config?.mcp_servers??{},"homer_interactions"))||(effective.config?.mcp_servers?.homer_interactions&&!this.options.interactionMcp))
      throw new Error("engine_interaction_mcp_boundary_mismatch");
    if(this.options.interactionMcp&&!Array.isArray(effective.layers))throw new Error("engine_interaction_mcp_boundary_mismatch");
    if(this.options.interactionMcp){
      const trusted=effective.config?.mcp_servers?.homer_interactions;
      if(trusted?.command!==this.options.interactionMcp.command||JSON.stringify(trusted?.args)!==JSON.stringify(this.options.interactionMcp.args)||trusted?.cwd!==this.options.interactionMcp.cwd||trusted?.url||trusted?.enabled===false)
        throw new Error("engine_interaction_mcp_boundary_mismatch");
    }
  }
  async start(): Promise<string> {
    try{return await this.startConfigured();}catch(error){await this.close();throw error;}
  }
  // Native 0.163.0: priority is Fast; explicit null clears an inherited tier.
  private get serviceTier(){return this.config.serviceTier!==undefined?this.config.serviceTier:effectiveFast(this.config.fast,this.options.role)?"priority":null;}
  private async startConfigured(): Promise<string> {
    if(this.failureChecks.signal.aborted)this.failureChecks=new AbortController();
    if (!usesHomerNativeHome(this.config)) throw Error("engine_native_tools_home_required");
    const proxy=codexProxyEnvironment();
    const deepseek=deepseekProfile(this.config);
    const context=this.config.context?validateContextTuning(this.config.context):deepseek;
    // This initializes new threads only. Resumes retain the native stored mode;
    // Workers and configuration-only connections never opt new threads in.
    const generateMemories=!this.options.threadId&&this.options.role!=="worker";
    const memorySettings={"features.memories":true,"memories.dedicated_tools":true,...(this.config.dailyDeepSeek?{"memories.generate_memories":generateMemories,"memories.extract_model":this.config.model,"memories.consolidation_model":this.config.model}:{})};
    const settings: Record<string, unknown> = {
      ...(this.options.controlOnly ? {
        default_permissions: "homer_control",
        "permissions.homer_control": controlPermissions(this.config, this.options.readRoots),
        approval_policy: "never",
      } : {}),
      ...(this.options.controlOnly || this.config.keyEnv ? {"shell_environment_policy.inherit": "none"} : {}),
      ...(this.options.nativeTools?{"features.multi_agent":this.options.nativeTools==="worker","features.multi_agent_v2":this.options.nativeTools==="worker","agents.enabled":this.options.nativeTools==="worker"}:{}),
      "features.code_mode_host": true,
      ...(this.options.controlOnly?{"features.memories":false}:memorySettings),
      "features.unbounded_connection_retries": false,
      "analytics.enabled": false,
      "feedback.enabled": false,
      model: this.config.model,
      model_provider: "openai",
    };
    const deepseekCatalogPath=deepseek?materializeDeepSeekCatalog(this.config.runtime):undefined;
    const capabilities=this.config.capabilities??(this.config.context&&this.config.effort===null?{inputModalities:['text'] as ('text'|'image')[],reasoningEfforts:[],webSearch:false,toolSearch:false}:undefined);
    const membershipCatalog=capabilities&&context?membershipModelCatalog(this.config.model,this.config.effort??null,context.contextWindow,validateModelCapabilities(capabilities,this.config.effort??null)):undefined;
    const membershipCatalogPath=membershipCatalog?materializeModelCatalog(this.config.runtime,membershipCatalog):undefined;
    const webSearchMode=configuredWebSearchMode(this.config);
    if(webSearchMode)settings.web_search=webSearchMode;
    if(membershipCatalogPath)settings.model_catalog_json=membershipCatalogPath;
    if(context)Object.assign(settings,{model_context_window:context.contextWindow,model_auto_compact_token_limit:context.autoCompactTokenLimit,model_auto_compact_token_limit_scope:context.autoCompactTokenLimitScope});
    if(deepseek)Object.assign(settings,{model_catalog_json:deepseekCatalogPath,web_search:'disabled'});
    if (this.config.baseUrl) {
      settings.model_provider = "homer";
      settings["model_providers.homer"] = {
        name: "Homer authorized connection",
        base_url: this.config.baseUrl,
        wire_api: "responses",
        supports_websockets: false,
        request_max_retries: 0,
        stream_max_retries: 0,
        requires_openai_auth: this.config.keyEnv
          ? false
          : this.config.requiresOpenaiAuth,
        ...(this.config.keyEnv ? { env_key: this.config.keyEnv } : {}),
      };
    }
    if(this.config.desktopModelSource==='codex'&&!this.options.controlOnly&&this.options.threadId){
      const bridge=await nativeHistoryBridge(proxy);
      if(this.closing){await bridge.close();throw Error('engine_closed');}
      this.historyBridge=bridge;
      settings.openai_base_url=this.historyBridge.baseUrl;
      settings['features.enable_request_compression']=false;
    }
    settings.cli_auth_credentials_store="file";
    settings.mcp_oauth_credentials_store="file";
    settings.sqlite_home=this.config.codexHome;
    settings.log_dir=join(this.config.codexHome,"log");
    const catalog=this.options.interactionMcp?.catalog??HOST_MCP_TOOLS;
    const interactionMcp = this.options.interactionMcp ? {
      command:this.options.interactionMcp.command,args:this.options.interactionMcp.args,cwd:this.options.interactionMcp.cwd, enabled: true, startup_timeout_sec: INTERACTION_LIMITS.connectMs/1000, tool_timeout_sec:INTERACTION_LIMITS.nativeToolSeconds,
      enabled_tools: catalog.map(tool => tool.name), disabled_tools: [],
      default_tools_approval_mode: "prompt",
      // These calls are Homer business-state tools. Permission to call them is
      // separate from the reasoned Worker operation decision stored by Homer.
      tools: Object.fromEntries(catalog.map(tool => [tool.name, { enabled: true, approval_mode: "approve" }])),
    } : undefined;
    if (interactionMcp) settings["mcp_servers.homer_interactions"] = interactionMcp;
    const args = [
      "app-server",
      "--stdio",
      ...Object.entries(settings).flatMap(([k, v]) => [
        "-c",
        `${k}=${toml(v)}`,
      ]),
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: join(this.config.codexHome,"host-home"),
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      CODEX_HOME: this.config.codexHome,
      ...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TEMP,USERPROFILE:join(this.config.codexHome,'host-home')}:{ }),
      ...proxy,
    };
    if(this.historyBridge){env.NO_PROXY=[proxy.NO_PROXY??proxy.no_proxy,'127.0.0.1'].filter(Boolean).join(',');env.no_proxy=env.NO_PROXY;}
    if (this.config.keyEnv)
      env[this.config.keyEnv] = this.config.desktopModelSource==='website'?this.websiteToken:process.env[this.config.keyEnv];
    mkdirSync(env.HOME!,{recursive:true,mode:0o700});
    const child = this.child = spawn(this.config.codexBin, args, {
      cwd: this.options.cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pid = this.child.pid;
    if(process.platform==='win32'&&this.pid){const identity=processIdentity(this.pid);if(identity)this.windowsLease={pid:this.pid,identity};}
    this.emit("spawn");
    this.child.stdin.on("error", () =>
      this.fail(new Error("engine_stdin_closed")),
    );
    this.child.stderr.resume(); // Never echo provider bodies, arguments, or engine diagnostics.
    this.child.on("error", () => this.fail(new Error("engine_spawn_failed")));
    this.child.on("exit", () => {
      this.exited = true;
      this.fail(new Error("engine_disconnected"));
      this.emit('powerActivity');
      this.emit("exit");
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      if (this.child !== child) return;
      void this.receive(line).catch(() => {
        if (this.child === child) this.fail(new Error("engine_invalid_message"));
      });
    }).on("close", () => {
      if (this.child === child) this.fail(new Error("engine_disconnected"));
    });
    // Bound only the local protocol handshake. Native operations after this
    // ACK own their completion, cancellation and retry budgets.
    let initializeTimer: NodeJS.Timeout | undefined;
    let initialized: any;
    try {
      initialized = await Promise.race([
        this.request("initialize", {
          clientInfo: { name: "homer", version: "0.1.0" },
          capabilities: { experimentalApi: true, requestAttestation: false },
        }),
        new Promise<never>((_, reject) => {
          initializeTimer = setTimeout(() => reject(new Error("engine_initialize_timeout")), 15000);
        }),
      ]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (initializeTimer) clearTimeout(initializeTimer);
    }
    this.version = initialized.userAgent?.match(/\/([\d.]+)/)?.[1];
    this.notify("initialized", {});
    if(this.version!=="0.163.0"||resolve(initialized.codexHome??"/")!==resolve(this.config.codexHome))throw Error("capability_native_version_or_home_mismatch");
    const effective = await this.request("config/read", {
      includeLayers: true,
      cwd: this.options.cwd,
    });
    if(this.config.context){
      const actual=effective.config;
      if(actual?.model!==this.config.model||actual?.model_context_window!==context!.contextWindow||actual?.model_auto_compact_token_limit!==context!.autoCompactTokenLimit||actual?.model_auto_compact_token_limit_scope!==context!.autoCompactTokenLimitScope)throw Error('engine_model_context_mismatch');
    }
    if((membershipCatalogPath&&effective.config?.model_catalog_json!==membershipCatalogPath)||
       (!deepseek&&webSearchMode&&effective.config?.web_search!==webSearchMode))throw Error('engine_model_catalog_mismatch');
    if(deepseek){
      const actual=effective.config;
      if(actual?.model!==this.config.model||actual?.model_catalog_json!==deepseekCatalogPath||actual?.model_context_window!==deepseek.contextWindow||actual?.model_auto_compact_token_limit!==deepseek.autoCompactTokenLimit||actual?.model_auto_compact_token_limit_scope!==deepseek.autoCompactTokenLimitScope||actual?.web_search!=='disabled')throw Error('engine_deepseek_config_mismatch');
      const models=await this.request('model/list',{includeHidden:true});
      const model=models.data?.find((m:any)=>m.model===this.config.model||m.id===this.config.model);
      if(!model||model.defaultReasoningEffort!=='high'||!['low','high','max'].every(e=>model.supportedReasoningEfforts?.some((r:any)=>r.reasoningEffort===e)))throw Error('engine_deepseek_catalog_mismatch');
    }
    if(!this.options.controlOnly){
      if(effective.config?.features?.memories!==true||effective.config?.memories?.dedicated_tools!==true)throw Error("engine_native_memory_tools_unavailable");
      if(this.config.dailyDeepSeek){
        if(effective.config?.memories?.generate_memories!==generateMemories)throw Error("engine_memory_generation_mismatch");
        if(effective.config?.memories?.extract_model!==this.config.model||effective.config?.memories?.consolidation_model!==this.config.model)throw Error("engine_memory_model_mismatch");
      }
    }
    this.assertInteractionMcpBoundary(effective);
    if(this.options.controlOnly)return "";
    if(this.options.nativeTools){const local=await this.request("environment/info",{environmentId:"local"});if(!local?.shell)throw Error("engine_local_environment_unavailable");}
    const params = {
      model: this.config.model,
      serviceTier: this.serviceTier,
      // Omit fresh cwd: fixed native start otherwise implicitly trusts writable unknown projects.
      ...(this.options.threadId?{cwd:this.options.cwd}:{}),
      runtimeWorkspaceRoots: [this.options.cwd],
      developerInstructions: this.options.instructions,
      environments: this.options.nativeTools?[{environmentId:"local",cwd:this.options.cwd,runtimeWorkspaceRoots:[this.options.cwd,...(this.options.nativeTools==="main"?[this.config.workspace]:[])]}]:[],
      config: { "skills.config": effective.config?.skills?.config??[], mcp_servers: {
        ...(interactionMcp ? { homer_interactions: interactionMcp } : {}),
      }, ...memorySettings },
    };
    if(this.serviceTier){
      const model=await this.modelInfo();
      // The native engine omits tiers that a model explicitly does not advertise.
      // Do not let that known downgrade look like a successful Fast request.
      if(Array.isArray(model?.serviceTiers)&&!model.serviceTiers.some((tier:any)=>tier.id===this.serviceTier))throw Error("engine_fast_unavailable");
    }
    const response = await this.request(
      this.options.threadId ? "thread/resume" : "thread/start",
      this.options.threadId
        ? { ...params, threadId: this.options.threadId, excludeTurns: true }
        : { ...params, dynamicTools: this.options.tools },
    );
    if(this.options.threadId&&response.thread.id!==this.options.threadId)throw Error('engine_resume_thread_mismatch');
    this.threadId = response.thread.id;
    if(this.config.desktopModelSource==='codex')
      await this.request('thread/settings/update',{threadId:this.threadId,model:this.config.model,effort:effectiveEffort(this.config.effort,this.options.role),serviceTier:this.serviceTier});
    // Turn effort:null inherits ambient settings; replace only the membership thread's reasoning state.
    if(this.config.context&&this.config.effort===null)
      await this.request('thread/settings/update',{threadId:this.threadId,collaborationMode:{mode:'default',settings:{model:this.config.model,reasoning_effort:null,developer_instructions:''}},summary:'none'});
    this.resumable = !!this.options.threadId;
    if (this.options.interactionMcp) {
      const inventory = await this.request("mcpServerStatus/list", { threadId: this.threadId, serverName: "homer_interactions", detail: "full", limit: 100 });
      const trusted = inventory.data?.find((entry: any) => entry.name === "homer_interactions");
      if (JSON.stringify(Object.keys(trusted?.tools ?? {}).sort()) !== JSON.stringify(catalog.map(tool => tool.name).sort()))
        throw new Error("engine_interaction_tools_unavailable");
    }
    if(this.options.nativeTools){this.appliedVersion=effective.layers?.find((l:any)=>l.name?.type==="user"&&resolve(l.name.file)===resolve(this.config.codexHome,"config.toml"))?.version;await this.refreshBackground();}
    this.emit("thread", this.threadId);
    return this.threadId!;
  }
  private send(value: unknown) {
    if (!this.child || this.exited) throw new Error("engine_disconnected");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  private notify(method: string, params: unknown) {
    this.send({ method, params });
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.closing) return Promise.reject(new Error("engine_closed"));
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      // A lost receipt does not prove an operation failed. Keep its id until
      // native response/error or transport shutdown; never replay mutations.
      this.pending.set(id, { method, resolve, reject });
      try {
        this.send({ id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private fail(error: Error) {
    this.failureChecks.abort();
    if(this.active&&!this.active.settling&&this.threadId&&this.turnId)this.emit('turnUnavailable',{threadId:this.threadId,turnId:this.turnId});
    this.nativeRequests.close();
    if (!this.closing) {this.failure = error;this.preparation=undefined;}
    for (const p of this.pending.values()) {
      p.reject(new EngineRpcUnconfirmed(engineError(error)));
    }
    this.pending.clear();
    if (this.compaction) {
      this.compaction.reject(error);
      this.compaction = undefined;
    }
    if (this.active) {
      this.active.reject(error);
      this.active = undefined;
    }
  }
  private async receive(line: string) {
    const bytes=Buffer.byteLength(line);
    if(bytes>32*1024*1024)throw Error("engine_message_too_large");
    const m = JSON.parse(line);
    // 0.163 also pushes the complete Apps catalog as a notification (observed
    // 6.7 MB). It has no model payload or business callback; queries stay native.
    if(m.id===undefined&&m.method==='app/list/updated'&&Array.isArray(m.params?.data))return;
    // Fixed native plugin catalogs currently exceed 15 MB. Only a response to
    // one of our native catalog requests receives the larger bounded quota.
    const catalog=!m.method&&["plugin/list","plugin/search","plugin/read","skills/list","app/list"].includes(this.pending.get(m.id)?.method??"");
    const nativeImage=this.options.nativeTools&&this.active&&m.method==='item/completed'&&m.params?.item?.type==='imageGeneration'&&m.params.threadId===this.threadId&&(!this.turnId||m.params.turnId===this.turnId);
    if(bytes>2*1024*1024&&!catalog&&!nativeImage)throw Error("engine_message_too_large");
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (p) {
        if(p.checking)return;
        let error:Error|undefined;
        if(m.error){p.checking=true;error=await this.modelError(m.error);if(this.pending.get(m.id)!==p)return;}
        this.pending.delete(m.id);
        error ? p.reject(error) : p.resolve(m.result);
      }
      return;
    }
    const p = m.params;
    // The RPC acknowledgement is authoritative. Notifications can precede it;
    // hold them until the accepted turn ID and onStarted callback are bound.
    if (this.active && !this.turnId && p?.threadId === this.threadId && (p.turnId || p.turn?.id)) {
      this.active.earlyEvents.push(line);
      return;
    }
    if (m.id !== undefined) {
      const item = this.nativeItems.get(JSON.stringify([p?.threadId,p?.turnId,p?.itemId]));
      const details = item ? { ...p, operation: item, ...(p.command == null && item.command ? { command: item.command } : {}) } : p;
      if (await this.nativeRequests.receive(m.id, m.method, details)) return;
      let result: unknown;
      if (m.method === "item/tool/call") {
        if (
          p.threadId !== this.threadId ||
          p.turnId !== this.turnId ||
          this.closing || !this.active || this.active.settling
        ) {
          result = {
            success: false,
            contentItems: [{ type: "inputText", text: "tool_scope_denied" }],
          };
        } else {
          let response = this.toolResponses.get(p.callId);
          if (!response) {
            response = (async () => {
              try {
                return {
                  success: true,
                  contentItems: [
                    {
                      type: "inputText",
                      text: JSON.stringify(await this.handleTool(p)),
                    },
                  ],
                };
              } catch (e) {
                return {
                  success: false,
                  contentItems: [{ type: "inputText", text: engineError(e) }],
                };
              }
            })();
            this.toolResponses.set(p.callId, response);
          }
          const owner=this.active,turnId=this.turnId;
          result = await response;
          if(owner&&!owner.settling&&this.active===owner&&turnId===this.turnId&&this.executionEnabled){owner.execution.evidence({type:'dynamicToolCall',...(result as object)});this.publishExecution(owner);}
        }
      } else {
        this.send({
          id: m.id,
          error: { code: -32601, message: "Homer M0 refuses this capability" },
        });
        this.emit("denied", m.method);
        return;
      }
      if (!this.exited && !this.closing) {
        const bound = this.active && !this.active.settling && p?.threadId === this.threadId && p?.turnId === this.turnId;
        this.send({ id: m.id, result: bound ? result : { success: false, contentItems: [{ type: "inputText", text: "tool_scope_denied" }] } });
        if (bound) this.emit("toolResponse", p.callId);
      }
      return;
    }
    if(m.method==='account/login/completed'){this.emit('accountLoginCompleted',{loginId:typeof p?.loginId==='string'?p.loginId:null,success:p?.success===true});return;}
    if(m.method==='mcpServer/oauthLogin/completed'){this.emit('oauthCompleted',{success:p?.success===true});return;}
    // Callback ownership is the connection/parent segment. Child completion
    // never completes the parent turn or enters its public output projection.
    if (m.method === 'serverRequest/resolved') this.nativeRequests.resolved(p?.threadId, p?.requestId);
    if (m.method === 'turn/completed') this.nativeRequests.endTurn(p?.turn?.id, p?.threadId);
    if (m.method === 'item/started' && this.active && !this.active.settling && !this.closing &&
        (this.options.role === 'worker' || p?.threadId === this.threadId && p?.turnId === this.turnId) &&
        ['fileChange','commandExecution'].includes(p?.item?.type))
      this.nativeItems.set(JSON.stringify([p.threadId,p.turnId,p.item.id]),p.item);
    if (p?.threadId !== this.threadId) return;
    if(this.active?.settling&&(p.turnId===this.turnId||p.turn?.id===this.turnId)){
      if(this.options.nativeTools==='worker'&&m.method==='item/completed')this.publishNativeProcess(m.method,p);
      return;
    }
    if(m.method==='turn/plan/updated'&&this.active&&p.turnId===this.turnId&&Array.isArray(p.plan))this.emit('publicPlan',{threadId:p.threadId,turnId:p.turnId,plan:p.plan});
    const compact = this.compaction;
    if (compact&&!compact.settling) {
      // Compact's ACK has no turn id. Its new native turn/item binds the
      // completion; unrelated and duplicate item notifications cannot finish it.
      if (m.method === "turn/started" && !compact.turnId && p.turn.id !== this.turnId)
        compact.turnId = p.turn.id;
      if (m.method === "item/started" && p.item?.type === "contextCompaction" && (!compact.turnId || compact.turnId === p.turnId)) {
        compact.turnId = p.turnId;
        compact.itemId = p.item.id;
      }
      if (m.method === "item/completed" && p.item?.type === "contextCompaction" && p.turnId === compact.turnId && p.item.id === compact.itemId)
        compact.resolve();
      if (m.method === "turn/completed" && p.turn.id === compact.turnId){
        compact.settling=true;
        const error=p.turn.error?await this.modelError(p.turn.error):new Error(p.turn.status === "interrupted" ? "engine_compact_interrupted" : "engine_compact_unconfirmed");
        if(this.compaction===compact)compact.reject(error);
      }
    }
    if(p.item?.type==='contextCompaction'&&typeof p.item.id==='string'&&['item/started','item/completed'].includes(m.method)&&
      (this.active&&p.turnId===this.turnId||compact&&!compact.settling&&p.turnId===compact.turnId))
      this.emit('contextCompaction',{state:m.method==='item/completed'?'completed':'started',threadId:p.threadId,turnId:p.turnId,itemId:p.item.id});
    if(this.active&&p.turnId===this.turnId&&m.method==='item/completed'&&this.executionEnabled){
      if(p.item?.type==='contextCompaction'&&typeof p.item.id==='string')this.active.execution.compact(p.item.id);
      else if(typeof p.item?.id==='string'){
        const seen=this.active.evidenceItems??=new Set<string>();
        if(!seen.has(p.item.id)){seen.add(p.item.id);this.active.execution.evidence(p.item);}
      }
      this.publishExecution(this.active);
    }
    if(m.method==='error'&&p.willRetry===true&&this.active&&p.threadId===this.threadId&&p.turnId===this.turnId){
      const info=p.error?.codexErrorInfo;
      const connectionIssue=!!info&&typeof info==='object'&&['httpConnectionFailed','responseStreamConnectionFailed','responseStreamDisconnected'].some(key=>Object.hasOwn(info,key));
      // There is no upstream delta offset across native stream retries.
      this.active.deltaFenced=true;
      if(this.active.reasoningSummary)this.active.reasoningSummary.text='';
      this.emit('turnRetry',{threadId:p.threadId,turnId:p.turnId,...(connectionIssue?{connectionIssue:true}:{})});
    }
    if(m.method==='item/completed'&&p.item?.type==='imageGeneration'&&p.item.status==='completed'&&!p.item.failure&&p.turnId===this.turnId&&this.active&&this.options.nativeTools){
      const seen=this.active.nativeImageItems??=new Set<string>();
      if(!seen.has(p.item.id)){
        seen.add(p.item.id);
        try{const file=materializeNativeImage(this.options.cwd,this.threadId!,p.item.id,p.item.result);this.emit('nativeGeneratedFile',{threadId:p.threadId,turnId:p.turnId,...file});}
        catch(error){this.active.nativeOutputError=engineError(error);}
      }
    }
    if (m.method === "item/started" && p.turnId === this.turnId && this.options.nativeTools && p.item?.type==='commandExecution') this.backgroundActivity(true);
    if(m.method==='item/completed'&&p.item?.type==='commandExecution'&&this.options.nativeTools)void this.refreshBackground();
    if (m.method === "turn/started" && this.active && p.turn.id === this.turnId) {
      this.emit("turn", p.turn.id);
      this.emit('turnTiming',{threadId:p.threadId,turnId:p.turn.id,...turnTiming(p.turn)});
    }
    // Worker terminal observations may outlive their turn. The service accepts
    // them only against an already retained exact call/epoch, never as new work.
    if(['item/started','item/completed'].includes(m.method)&&(p.turnId===this.turnId&&this.active||this.options.nativeTools==='worker'&&m.method==='item/completed')){
      this.publishNativeProcess(m.method,p);
    }
    if(this.active&&this.turnId&&p.turnId===this.turnId&&!this.closing){
      const active=this.active,prior=active.reasoningSummary;
      if(['item/started','item/completed'].includes(m.method)&&p.item?.type==='reasoning'&&typeof p.item.id==='string'&&p.item.id){
        const item=p.item;
        if(!(prior&&prior.itemId===item.id&&prior.completed&&m.method==='item/started')&&
          (!prior||prior.itemId===item.id||!prior.itemIds.has(item.id))&&Array.isArray(item.summary)&&item.summary.every((text:unknown)=>typeof text==='string')){
          const summaryIndex=Math.max(0,item.summary.length-1);
          if(!prior||prior.itemId!==item.id||summaryIndex>=prior.summaryIndex){
            active.reasoningSummary={itemId:item.id,itemIds:prior?.itemIds??new Set(),summaryIndex,text:(item.summary[summaryIndex]??'').slice(0,4096),completed:m.method==='item/completed'};
          }
        }
      }else if(m.method==='item/reasoning/summaryTextDelta'&&!active.deltaFenced&&typeof p.itemId==='string'&&p.itemId&&Number.isSafeInteger(p.summaryIndex)&&p.summaryIndex>=0&&typeof p.delta==='string'&&(!prior||prior.itemId===p.itemId&&!prior.completed&&p.summaryIndex>=prior.summaryIndex)){
        active.reasoningSummary={itemId:p.itemId,itemIds:prior?.itemIds??new Set(),summaryIndex:p.summaryIndex,text:((prior&&prior.summaryIndex===p.summaryIndex?prior.text:'')+p.delta).slice(0,4096)};
      }
      const summary=active.reasoningSummary;
      if(summary&&summary!==prior){
        // Retain identities, never old text, to reject earlier item replays.
        summary.itemIds.add(summary.itemId);
        const text=activitySummaryText(summary.text);
        if(text)this.emit('reasoningSummary',{threadId:p.threadId,turnId:p.turnId,text});
      }
    }
    if (m.method === "thread/tokenUsage/updated" && p.turnId === this.turnId && this.active) {
      this.active.usage = p.tokenUsage;
      this.active.execution.usage(p.tokenUsage);
      this.usageBaseline=executionCounters(p.tokenUsage?.total);
      if(this.executionEnabled)this.publishExecution(this.active);else this.emit("usage",p.tokenUsage);
    }
    if (['item/started','item/completed'].includes(m.method) && p.item?.type === 'agentMessage' && p.threadId === this.threadId && p.turnId === this.turnId && this.active && !this.active.messages.some(item=>item.itemId===p.item.id)) {
      const order=this.active.messageOrder??=[];if(!order.includes(p.item.id))order.push(p.item.id);
      this.emit('agentMessage', { threadId:p.threadId, turnId:p.turnId, itemId:p.item.id, phase:p.item.phase, text:p.item.text, completed:m.method==='item/completed' });
    }
    if (m.method === "item/agentMessage/delta" && p.threadId === this.threadId && p.turnId === this.turnId && this.active && !this.active.deltaFenced && !this.active.messages.some(item=>item.itemId===p.itemId) && typeof p.delta === "string") {
      const partial=this.active.partialMessages??=new Map();
      const prior=partial.get(p.itemId);partial.set(p.itemId,{itemId:p.itemId,phase:prior?.phase??null,text:(prior?.text??'')+p.delta});
      const order=this.active.messageOrder??=[];if(!order.includes(p.itemId))order.push(p.itemId);
      this.emit('agentMessage', { threadId:p.threadId, turnId:p.turnId, itemId:p.itemId, delta:p.delta, completed:false });
      this.emit("textDelta", { threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, delta: p.delta });
    }
    if (
      m.method === "item/completed" &&
      p.item.type === "agentMessage" &&
      p.threadId === this.threadId &&
      p.turnId === this.turnId &&
      this.active
    )
    {
      const item={itemId:p.item.id,phase:p.item.phase??null,text:p.item.text};
      const index=this.active.messages.findIndex(m=>m.itemId===item.itemId);
      if(index<0)this.active.messages.push(item);
    }
    if (
      m.method === "turn/completed" &&
      p.threadId === this.threadId &&
      p.turn.id === this.turnId &&
      this.active
    ) {
      const a = this.active;
      if(a.settling)return;
      a.settling=true;
      if(a.execution.snapshot.stopReason&&a.partialMessages)for(const message of a.partialMessages.values())if(!a.messages.some(m=>m.itemId===message.itemId))a.messages.push(message);
      // summary/notLoaded are display projections, never full source snapshots.
      // Keep the turn bound until every source update has reached persistence.
      if(p.turn.itemsView==='full'){
        const items=(p.turn.items??[]).filter((item:any)=>item.type==='agentMessage');
        const protocolOrder=(p.turn.items??[]).map((item:any)=>item.id);
        for(const [index,item] of items.entries()){
          const prior=a.messages.find(message=>message.itemId===item.id);
          this.emit('agentMessage',{threadId:p.threadId,turnId:p.turn.id,itemId:item.id,phase:item.phase??null,text:item.text,
            completed:p.turn.status==='completed'||!!prior,snapshot:true,...(index===items.length-1?{order:protocolOrder}:{})});
        }
        const order=a.messageOrder??=[];
        for(const item of items)if(!order.includes(item.id))order.push(item.id);
        const rank=new Map(items.map((item:any,index:number)=>[item.id,index]));
        const slots=order.flatMap((id,index)=>rank.has(id)?[index]:[]);
        const sorted=slots.map(index=>order[index]!).sort((a,b)=>(rank.get(a) as number)-(rank.get(b) as number));
        slots.forEach((slot,index)=>{order[slot]=sorted[index]!;});
        for(const item of items){
          const message={itemId:item.id,phase:item.phase??null,text:item.text},index=a.messages.findIndex(m=>m.itemId===item.id);
          if(index<0)a.messages.push(message);else a.messages[index]=message;
        }
      }
      if(a.messageOrder)a.messages.sort((x,y)=>a.messageOrder!.indexOf(x.itemId)-a.messageOrder!.indexOf(y.itemId));
      try{this.emit('turnTerminal',{threadId:p.threadId,turnId:p.turn.id,...turnTiming(p.turn)});}
      catch(error){a.reject(error instanceof Error?error:Error('engine_terminal_observer_failed'));throw error;}
      const errorCode=a.execution.snapshot.stopReason??(p.turn.error?(await this.modelError(p.turn.error)).message:undefined);
      if(this.active!==a)return;
      this.active = undefined;
      const result:TurnResult={status:p.turn.status,text:a.messages.map(m=>m.text).join('\n').trim(),messages:a.messages,...(errorCode?{errorCode}:{}),usage:a.usage,...(a.nativeOutputError?{nativeOutputError:a.nativeOutputError}:{})};
      try{
        this.emit('nativeCompleted',{threadId:p.threadId,turnId:p.turn.id,status:p.turn.status,result});
      }catch(error){const failure=error instanceof Error?error:Error('engine_terminal_observer_failed');a.reject(failure);throw failure;}
      // Worker returns must not wait on an unrelated background RPC. Main keeps
      // its existing refresh boundary; Worker closure still fences side effects.
      if(this.options.role==='worker')a.resolve(result);
      await this.refreshBackground();
      this.emit('nativeBackgroundRefreshed',{turnId:p.turn.id,status:p.turn.status});
      if(this.options.role!=='worker')a.resolve(result);
    }
  }
  async turn(
    text: string,
    options?: {
      cwd?:string;
      onStarted?: (id: string, timing?: TurnTimingEvidence) => void;
      images?:EngineImage[];
      skills?:{name:string;path:string}[];
    },
  ): Promise<TurnResult> {
    if (this.active||this.compaction||this.preparation) throw new Error("engine_turn_busy");
    if(this.closing||this.exited)throw Error("engine_closed");
    if (!this.threadId) throw new Error("engine_not_started");
    const operation={};this.preparation=operation;
    try{
    if(this.config.desktopModelSource==='codex'){
      const next=effectiveModelConfig(this.sourceConfig,this.options.role);
      if(next.model!==this.config.model||next.effort!==this.config.effort||next.serviceTier!==this.config.serviceTier){
        if(next.serviceTier){
          const model=await this.prepared(operation,this.modelInfo(next.model));
          if(Array.isArray(model?.serviceTiers)&&!model.serviceTiers.some((tier:any)=>tier.id===next.serviceTier))throw Error('engine_fast_unavailable');
        }
        await this.prepared(operation,this.request('thread/settings/update',{threadId:this.threadId,model:next.model,effort:effectiveEffort(next.effort,this.options.role),serviceTier:next.serviceTier}));
        Object.assign(this.config,next);
      }
    }
    if(options?.cwd&&resolve(options.cwd)!==resolve(this.options.cwd)){

        this.assertInteractionMcpBoundary(await this.prepared(operation,this.request('config/read',{includeLayers:true,cwd:options.cwd})));
        // 0.163.0 retains the startup project layers across settings updates
        // and MCP reload. Cold resume is the native way to load another CWD.
        // Empty threads have no resumable history; never silently use old MCP.
        if(!this.resumable)throw Error('engine_project_switch_requires_history');
        if(this.options.nativeTools){await this.prepared(operation,this.refreshBackground());if(this.nativeBusy)throw Error('capability_engine_busy');}
        const threadId=this.threadId!;
        if(!await this.prepared(operation,this.closeProcess()))throw Error('engine_shutdown_unconfirmed');
        this.options.cwd=options.cwd;this.options.threadId=threadId;
        this.exited=false;this.closing=false;this.failure=undefined;this.nativeRequests=this.requestBridge();
        if(await this.prepared(operation,this.start())!==threadId)throw Error('main_resume_thread_mismatch');
    }
    if(options?.cwd)this.options.cwd=options.cwd;
    if(options?.images?.some(image=>!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image.url))||Number(options?.images?.length??0)>10)throw Error('engine_image_input_denied');
    if(options?.images?.length&&!await this.prepared(operation,this.imageCapability()))throw Error('engine_image_model_unavailable');
    let resultResolve!: (r: TurnResult) => void,
      resultReject!: (e: Error) => void;
    const completion = new Promise<TurnResult>((res, rej) => {
      resultResolve = res;
      resultReject = rej;
    });
    completion.catch(() => {});
    this.toolResponses.clear();
    this.nativeItems.clear();
    this.turnId = undefined;
    const execution=new TurnExecution({...this.config.executionLimits,maxConsecutiveCompactions:this.config.executionLimits?.maxConsecutiveCompactions??(deepseekProfile(this.config)?3:0)},this.usageBaseline??(!this.resumable?{inputTokens:0,cachedInputTokens:0,outputTokens:0}:undefined));
    const active = { execution, resolve: resultResolve, reject: resultReject, messages:[] as NonNullable<TurnResult['messages']>, earlyEvents: [] as string[] };
    this.active = active;
    this.publishExecution(active);
    try {
      this.assertInteractionMcpBoundary(await this.prepared(operation,this.request('config/read',{includeLayers:true,cwd:this.options.cwd})));
      if(this.active!==active)throw Error('engine_turn_no_longer_active');
      const response = await this.request("turn/start", {
        cwd:this.options.cwd, runtimeWorkspaceRoots:[this.options.cwd],
        ...(this.options.nativeTools?{environments:[{environmentId:"local",cwd:this.options.cwd,runtimeWorkspaceRoots:[this.options.cwd]}]}:{}),
        threadId: this.threadId,
        ...(this.config.desktopModelSource==='codex'?{model:this.config.model}:{}),
        input: [{ type: "text", text, text_elements: [] },...(options?.skills??[]).map(skill=>({type:"skill",...skill})),...(options?.images??[]).map(image=>({type:'image',url:image.url}))],
        effort: effectiveEffort(this.config.effort, this.options.role),
        serviceTier: this.serviceTier,
      });
      if (this.active !== active) throw new Error("engine_turn_no_longer_active");
      this.resumable = true;
      this.turnId = response.turn.id;
      options?.onStarted?.(this.turnId!,turnTiming(response.turn));
      for (const line of active.earlyEvents) await this.receive(line);
      active.earlyEvents.length = 0;
      return await completion;
    } catch (e) {
      this.active = undefined;
      throw e;
    }
    }finally{if(this.preparation===operation)this.preparation=undefined;}
  }
  // Registry/credential changes may force resume; Skill-only writes use native reload.
  async refreshCapabilities(force=true){
    if(this.active||this.compaction||this.preparation)throw Error('capability_engine_busy');
    if(this.closing||this.exited)throw Error('engine_closed');
    const operation={};this.preparation=operation;
    try{
    const effective=await this.prepared(operation,this.request('config/read',{includeLayers:true,cwd:this.options.cwd}));
    this.assertInteractionMcpBoundary(effective);
    let version:string|undefined;
    if(this.options.nativeTools){
      const layer=effective.layers?.find((l:any)=>l.name?.type==='user'&&resolve(l.name.file)===resolve(this.config.codexHome,'config.toml'));
      version=layer?.version;
    }
    // Native reload is useful even when a pinned per-thread configuration
    // subsequently requires resume. Never turn a Skill-only write into close().
    await this.prepared(operation,this.request('config/mcpServer/reload',undefined));
    await this.prepared(operation,this.request('skills/list',{cwds:[this.options.cwd],forceReload:true}));
    if(this.options.nativeTools&&(force||version!==this.appliedVersion)){
      await this.prepared(operation,this.refreshBackground());
      if(this.nativeBusy||!this.resumable)return {pending:true};
      const threadId=this.threadId!;
      if(!await this.prepared(operation,this.closeProcess()))throw Error('engine_shutdown_unconfirmed');
      this.options.threadId=threadId;this.exited=false;this.closing=false;this.failure=undefined;this.nativeRequests=this.requestBridge();
      const resumed=await this.prepared(operation,this.start());if(resumed!==threadId)throw Error('main_resume_thread_mismatch');
    }
    return {pending:false};
    }finally{if(this.preparation===operation)this.preparation=undefined;}
  }
  async steer(expectedTurnId:string,text:string):Promise<{turnId:string}> {
    if(!this.active||this.active.settling||!this.threadId||this.turnId!==expectedTurnId||this.closing)throw Error('engine_steer_not_applicable');
    const result=await this.request('turn/steer',{threadId:this.threadId,expectedTurnId,input:[{type:'text',text,text_elements:[]}]});
    if(result.turnId!==expectedTurnId)throw Error('engine_steer_turn_mismatch');return result;
  }
  async compact():Promise<void> {
    if(this.active||this.compaction||this.preparation||!this.threadId||this.closing)throw Error('engine_compact_not_applicable');
    let resolve!: () => void, reject!: (error: Error) => void;
    const completed = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    completed.catch(() => {});
    const compact = { resolve, reject };
    this.compaction = compact;
    try {
      await this.request('thread/compact/start',{threadId:this.threadId});
      await completed;
    } finally {
      if (this.compaction === compact) this.compaction = undefined;
    }
  }
  async interrupt() {
    const turnId = this.compaction?.turnId ?? this.turnId;
    if (turnId) this.nativeRequests.endTurn(turnId);
    if(this.active?.settling||this.compaction?.settling)return true;
    if (!this.threadId || !turnId || (!this.active && !this.compaction)) return !this.active && !this.compaction;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.request("turn/interrupt", {
          threadId: this.threadId,
          turnId,
        }),
        new Promise<void>((r) => {
          timer = setTimeout(r, this.config.stopGraceMs);
        }),
      ]);
      return false;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async close(): Promise<boolean> {
    this.preparation=undefined;
    return this.closeProcess();
  }
  private async closeProcess(): Promise<boolean> {
    this.closing = true;
    if(this.backgroundTimer){clearTimeout(this.backgroundTimer);this.backgroundTimer=undefined;}
    this.fail(new Error("engine_closed"));
    if (!this.child){await this.historyBridge?.close();this.historyBridge=undefined;return true;}
    // Process groups are used only for children created by this instance.
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (this.pid) process.kill(-this.pid, signal);
      } catch {}
    };
    const waitForExit = (timeoutMs: number) => new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.child!.off("exit", done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.child!.once("exit", done);
    });
    if(process.platform==='win32'){
      const drain=async()=>{if(!this.exited){this.child!.stdin?.end();if(!this.exited)await waitForExit(46000);}};
      const stopped=this.windowsLease?await terminateLease(this.windowsLease,drain):(await drain(),false);
      if(this.exited){await this.historyBridge?.close();this.historyBridge=undefined;}
      return this.exited&&stopped;
    }
    if (!this.exited && this.options.role === 'worker') {
      // Fixed Codex 0.163.0 drains stdio EOF and shuts down native threads.
      // Its Unix watchdog is 45s; allow that bounded drain before signals.
      this.child.stdin?.end();
      await waitForExit(46000);
    }
    if (!this.exited) {
      kill("SIGTERM");
      await waitForExit(this.config.stopGraceMs);
    }
    if (this.options.role !== 'worker' || !this.exited) kill("SIGKILL");
    if (!this.exited) await waitForExit(1000);
    if(this.exited){await this.historyBridge?.close();this.historyBridge=undefined;}
    if(!this.exited||this.options.role!=='worker')return this.exited;
    const pid=this.pid;if(pid===undefined||!Number.isSafeInteger(pid)||pid<=1)return false;
    // A reaped leader may precede its draining children; probe without signalling a reused PID.
    const until=Date.now()+this.config.stopGraceMs;
    while(!leaseOwnerGone(pid)){
      const remaining=until-Date.now();if(remaining<=0)return false;
      await new Promise<void>(resolve=>setTimeout(resolve,Math.min(30,remaining)));
    }
    return true;
  }
}
export function codexVersion(bin: string) {
  return execFileSync(bin, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
}
