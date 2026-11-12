import { readFileSync, realpathSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { canonicalDir, inside } from "./files.js";
import { PRODUCT_MODEL_DEFAULTS, chatgptModelConfig, type ChatGPTModelOverrides, type ReasoningEffort } from "./model-config.js";
import {deepseekProfile,validateDeepSeekTuning,type DeepSeekTuning} from './deepseek-model.js';
import {validateExecutionLimits,type ExecutionLimits} from './execution-limits.js';
export type Config = {
  executionLimits?:ExecutionLimits;
  // Internal verified release identity; never accepted from loadConfig input.
  desktopResources?: import('./desktop-resources.js').DesktopResourceIdentity;
  // Trusted desktop entry only; never accepted from a user config file.
  dailyDeepSeek?: boolean;
  desktopModelSource?: 'codex'|'website';
  desktopProfile?:string;
  desktopConnection?: import('./homer-account.js').HomerRuntimeConfig;
  chatgpt?:ChatGPTModelOverrides;
  desktopAdopted?: boolean;
  pauseOldDesktopWork?: boolean;
  appData?: string;
  nativeCodexHome?: string;
  workspace: string;
  runtime: string;
  codexBin: string;
  codexHome: string;
  model: string;
  // Explicit shared override; absence lets each execution role use its default.
  effort?: ReasoningEffort|null;
  fast?: boolean;
  serviceTier?:string|null;
  deepseek?: DeepSeekTuning;
  // Provider-neutral context delivered by the trusted desktop connection.
  context?: import('./model-context.js').ContextTuning;
  capabilities?: import('./model-catalog.js').ModelCapabilities;
  baseUrl?: string;
  keyEnv?: string;
  requiresOpenaiAuth: boolean;
  stopGraceMs: number;
};
export function loadConfig(path?: string): Config {
  const raw = path ? JSON.parse(readFileSync(path, "utf8")) : {};
  if(raw.fast!==undefined&&typeof raw.fast!=="boolean")throw Error("invalid_fast");
  const fastOverride=process.env.HOMER_FAST;
  if(fastOverride!==undefined&&fastOverride!=="true"&&fastOverride!=="false")throw Error("invalid_fast");
  const base = path ? dirname(resolve(path)) : process.cwd();
  const bin = process.env.HOMER_CODEX_BIN ?? raw.codexBin ?? "codex";
  const binary = bin.includes("/")
    ? resolve(bin)
    : execFileSync("/usr/bin/which", [bin], { encoding: "utf8" }).trim();
  const appData = resolve(process.env.HOMER_DATA_HOME ?? raw.appData ?? (process.platform === "darwin" ? join(homedir(), "Library/Application Support/Homer") : join(homedir(), ".local/share/Homer")));
  const nativeCodexHome=resolve(process.env.HOMER_NATIVE_CODEX_HOME ?? raw.nativeCodexHome ?? join(appData,"codex"));
  const c: Config = {
    appData,
    nativeCodexHome,
    workspace: resolve(base, raw.workspace ?? join(appData,"workspace")),
    runtime: resolve(base, raw.runtime ?? join(appData,"runtime")),
    codexBin: realpathSync(binary),
    codexHome: resolve(
      process.env.HOMER_CODEX_HOME ??
        raw.codexHome ??
        nativeCodexHome,
    ),
    model: process.env.HOMER_MODEL ?? raw.model ?? PRODUCT_MODEL_DEFAULTS.model,
    effort: process.env.HOMER_EFFORT ?? raw.effort,
    fast: fastOverride===undefined ? raw.fast : fastOverride==="true",
    ...(raw.executionLimits!==undefined?{executionLimits:validateExecutionLimits(raw.executionLimits)}:{}),
    ...(raw.deepseek!==undefined?{deepseek:raw.deepseek}:{}),
    baseUrl: process.env.HOMER_CODEX_BASE_URL ?? raw.baseUrl ?? PRODUCT_MODEL_DEFAULTS.baseUrl,
    keyEnv: process.env.HOMER_CODEX_KEY_ENV ?? raw.keyEnv ?? PRODUCT_MODEL_DEFAULTS.keyEnv,
    requiresOpenaiAuth: raw.requiresOpenaiAuth ?? PRODUCT_MODEL_DEFAULTS.requiresOpenaiAuth,
    stopGraceMs: raw.stopGraceMs ?? 3000,
  };
  if (c.effort !== undefined && !["low", "medium", "high", "xhigh", "max", "ultra"].includes(c.effort??''))
    throw new Error("invalid_effort");
  if (!Number.isInteger(c.stopGraceMs) || c.stopGraceMs < 100 || c.stopGraceMs > 900000)
    throw new Error("invalid_stopGraceMs");
  if (
    c.runtime === c.workspace ||
    inside(c.workspace, c.runtime) ||
    inside(c.runtime, c.workspace)
  )
    throw new Error("workspace_runtime_overlap");
  if (c.baseUrl) {
    const u = new URL(c.baseUrl);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (!["https:"].includes(u.protocol) &&
        !(
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) &&
          u.protocol === "http:"
        ))
    )
      throw new Error("invalid_provider_url");
  }
  if (c.keyEnv && !/^[A-Z][A-Z0-9_]+$/.test(c.keyEnv))
    throw new Error("invalid_key_env");
  canonicalDir(c.runtime);
  canonicalDir(c.workspace);
  validateDeepSeekTuning(c.deepseek);
  return effectiveModelConfig(c);
}

export function capabilityHome(config:Config){return config.nativeCodexHome??join(config.appData??join(config.runtime,'application-data'),'codex');}
export function usesHomerNativeHome(config:Config){return resolve(config.codexHome)===resolve(capabilityHome(config));}
export function configuredWebSearchMode(config:Config):'live'|'disabled'|undefined{
  if(config.context && (config.capabilities || config.effort===null))
    return config.capabilities?.webSearch===true?'live':'disabled';
  if(config.desktopModelSource==='website' && config.dailyDeepSeek)return 'disabled';
}
export function effectiveModelConfig(config:Config,role:"main"|"worker"="main"):Config{
  validateExecutionLimits(config.executionLimits);
  if(config.desktopModelSource==='codex'){
    if(!config.desktopResources||!config.pauseOldDesktopWork)throw Error('desktop_model_source_scope_invalid');
    const selected=chatgptModelConfig(config.chatgpt)[role];
    return {...config,dailyDeepSeek:false,desktopConnection:undefined,context:undefined,capabilities:undefined,...selected,fast:selected.serviceTier!==null,baseUrl:undefined,keyEnv:undefined,requiresOpenaiAuth:true};
  }
  if(config.dailyDeepSeek){
    if(!config.desktopResources||!config.pauseOldDesktopWork)throw Error('daily_deepseek_desktop_required');
    const selected=config.desktopConnection?.[role];
    config={...config,...selected,baseUrl:selected?.baseUrl,context:selected?.context,capabilities:selected?.capabilities,keyEnv:'HOMER_DEEPSEEK_TOKEN',requiresOpenaiAuth:false};
  }
  const profile=deepseekProfile(config);
  return profile?{...config,effort:profile.effort,fast:profile.fast}:config;
}
