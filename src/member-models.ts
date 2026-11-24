import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import type {NativeModel,NativeModelSettings} from './model-config.js';

export type RoleSelection = {model:string; effort:string};
export type MemberSelection = {main:RoleSelection; worker:RoleSelection};
export type MemberOverrides = Partial<MemberSelection>;
type CatalogEntry = {
  slug:string;
  visibility:string;
  display_name:string;
  default_reasoning_level:string;
  supported_reasoning_levels:{effort:string}[];
  context_window:number;
  auto_compact_token_limit:number;
};

export const memberCatalogPath = fileURLToPath(new URL('../assets/membership/models.json', import.meta.url));
const defaultsUrl = new URL('../assets/membership/member-model-defaults.json', import.meta.url);
let catalog:CatalogEntry[] | undefined;

function listedModels() {
  catalog ??= (JSON.parse(readFileSync(memberCatalogPath, 'utf8')).models as CatalogEntry[]).filter(entry => entry.visibility === 'list');
  return catalog;
}

function entryFor(model:string) {
  return listedModels().find(entry => entry.slug === model);
}

export function isMemberRoleSelection(value:unknown):value is RoleSelection {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2
    || !('model' in value) || typeof value.model !== 'string' || !('effort' in value)) return false;
  return entryFor(value.model)?.supported_reasoning_levels.some(level => level.effort === value.effort) === true;
}

export function isMemberSelection(value:unknown):value is MemberSelection {
  return !!value && typeof value === 'object' && Object.keys(value).length === 2
    && 'main' in value && 'worker' in value && isMemberRoleSelection(value.main) && isMemberRoleSelection(value.worker);
}

export function resolveMemberSelection(value:unknown):MemberSelection {
  if (isMemberSelection(value)) return value;
  const defaults:unknown = JSON.parse(readFileSync(defaultsUrl, 'utf8'));
  if (!isMemberSelection(defaults)) throw Error('invalid_bundled_member_defaults');
  return defaults;
}

type MemberRoleConfig = RoleSelection & {
  baseUrl:string;
  fast:false;
  webSearch?:boolean;
  supportsWebSocket?:boolean;
  context:{contextWindow:number; autoCompactTokenLimit:number; autoCompactTokenLimitScope:'total'};
};

export function memberRoleConfig(selected:RoleSelection, baseUrl:string):MemberRoleConfig {
  const entry = entryFor(selected.model);
  if (!entry) throw Error('invalid_member_model');
  return {...selected, baseUrl, fast:false, context:{
    contextWindow:entry.context_window, autoCompactTokenLimit:entry.auto_compact_token_limit,
    autoCompactTokenLimitScope:'total',
  }};
}

export function memberRuntimeConfig(selection:MemberSelection, gatewayOrigin:string) {
  const baseUrl=gatewayOrigin+'/v1';
  return {main:memberRoleConfig(selection.main,baseUrl),worker:memberRoleConfig(selection.worker,baseUrl)};
}

export const sameMemberSelection=(a:RoleSelection|undefined,b:RoleSelection)=>
  a?.model===b.model&&a.effort===b.effort;

export function memberModelSettings(defaults:MemberSelection,overrides:MemberOverrides,unavailable:MemberOverrides={}):NativeModelSettings {
  const selection=({model,effort}:RoleSelection)=>({model,effort});
  const standard=(value:RoleSelection)=>({...selection(value),serviceTier:null});
  const current={main:overrides.main??defaults.main,worker:overrides.worker??defaults.worker};
  const settings:NativeModelSettings={
    current:{main:standard(current.main),worker:standard(current.worker)},
    defaults:{main:standard(defaults.main),worker:standard(defaults.worker)},
    inherited:{main:!overrides.main,worker:!overrides.worker},
  };
  try{
    settings.models=listedModels().map((entry):NativeModel=>({
      model:entry.slug,displayName:entry.display_name,defaultReasoningEffort:entry.default_reasoning_level,
      supportedReasoningEfforts:entry.supported_reasoning_levels.map(level=>({reasoningEffort:level.effort})),serviceTiers:[],
    }));
    settings.unavailable=(['main','worker'] as const).filter(role=>!isMemberRoleSelection(selection(current[role]))||sameMemberSelection(unavailable[role],current[role]));
  }catch{settings.error='native_models_unconfirmed';}
  return settings;
}
