import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

type RoleSelection = {model:string; effort:string};
export type MemberSelection = {main:RoleSelection; worker:RoleSelection};
type CatalogEntry = {
  slug:string;
  visibility:string;
  supported_reasoning_levels:{effort:string}[];
  context_window:number;
  auto_compact_token_limit:number;
};

export const memberCatalogPath = fileURLToPath(new URL('../assets/membership/models.json', import.meta.url));
const defaultsUrl = new URL('../assets/membership/member-model-defaults.json', import.meta.url);
let catalog:CatalogEntry[] | undefined;

function entryFor(model:string) {
  catalog ??= JSON.parse(readFileSync(memberCatalogPath, 'utf8')).models as CatalogEntry[];
  return catalog.find(entry => entry.visibility === 'list' && entry.slug === model);
}

function isRoleSelection(value:unknown):value is RoleSelection {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2
    || !('model' in value) || typeof value.model !== 'string' || !('effort' in value)) return false;
  return entryFor(value.model)?.supported_reasoning_levels.some(level => level.effort === value.effort) === true;
}

export function isMemberSelection(value:unknown):value is MemberSelection {
  return !!value && typeof value === 'object' && Object.keys(value).length === 2
    && 'main' in value && 'worker' in value && isRoleSelection(value.main) && isRoleSelection(value.worker);
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

export function memberRuntimeConfig(selection:MemberSelection, gatewayOrigin:string) {
  function role(selected:RoleSelection):MemberRoleConfig {
    const entry = entryFor(selected.model);
    if (!entry) throw Error('invalid_member_model');
    return {...selected, baseUrl:gatewayOrigin+'/v1', fast:false, context:{
      contextWindow:entry.context_window, autoCompactTokenLimit:entry.auto_compact_token_limit,
      autoCompactTokenLimitScope:'total',
    }};
  }
  return {main:role(selection.main), worker:role(selection.worker)};
}
