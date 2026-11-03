import {isDeepStrictEqual} from 'node:util';
import {publicMcpServer,publicMcpCatalog} from './native-mcp-config.js';
import{nativeDiscovery}from './native-discovery.js';
import {nativeToolChoices,validateNativeToolSettings} from "./native-tool-settings.js";
import {mkdirSync,lstatSync,existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname,basename,parse} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export type NativeRpc=(method:string,params:any)=>Promise<any>;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const record=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
function name(value:unknown){if(typeof value!=='string'||! /^[a-z][a-z0-9_-]{0,63}$/.test(value)||value==='homer_interactions')throw Error('capability_name_invalid');return value;}
function safePath(path:string){let next=parse(resolve(path)).root;for(const part of resolve(path).slice(next.length).split('/')){next=join(next,part);if(existsSync(next)&&lstatSync(next).isSymbolicLink())throw Error('capability_path_denied');}}
export function validateMcpServer(value:unknown):Record<string,any>{
 if(!record(value))throw Error('capability_mcp_invalid');const v=value as Record<string,any>;
 // Native Codex owns supported fields, types, defaults and timeout ranges.
 // Homer retains its existing endpoint-source policy at this entry point.
 if(v.url!==undefined&&v.url!==null){let u:URL;try{if(typeof v.url!=='string')throw Error();u=new URL(v.url);}catch{throw Error('capability_url_invalid');}if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('capability_url_invalid');}
 return structuredClone(v);
}
// The native file and native management service own configuration. This class
// only constrains Homer entry points; it has no registry, loader, client or DB.
export class NativeCapabilities {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(readonly home:string,readonly rpc:NativeRpc,readonly adopted:()=>boolean,readonly logout?:(name:string,server:Record<string,any>)=>Promise<void>,readonly validateMcp?:(name:string,server:Record<string,any>)=>Promise<void>){}
 private file(nameValue:unknown){const file=join(this.home,'skills',name(nameValue),'SKILL.md');safePath(file);return file;}
 private async config(){const result=await this.rpc('config/read',{includeLayers:true,cwd:join(this.home,'homer-control')});const layer=result.layers?.find((l:any)=>l.name?.type==='user'&&resolve(l.name.file)===resolve(this.home,'config.toml'));if(!layer)throw Error('capability_native_config_unavailable');return {version:layer.version as string,servers:layer.config?.mcp_servers??{},effective:result.config,user:layer.config??{}};}
 private mcpProposal(input:any,previous:any){
  if(!record(input.server))throw Error('capability_mcp_invalid');let proposed=structuredClone(input.server);
  if(input.preserveExisting===true){if(!record(previous))throw Error('capability_server_missing');proposed={...previous,...proposed};for(const [key,value]of Object.entries(input.server))if(value===null)delete proposed[key];}
  return validateMcpServer(proposed);
 }
 // Host-only review preparation. Never expose the returned full object through
 // manage/state, Agent results or persisted approval records.
 async mcpServerForReview(input:any,guard:()=>void){
  const current=await this.config();guard();if(current.version!==input.expectedVersion)throw Error('capability_config_conflict');
  const n=name(input.name);return this.mcpProposal(input,current.servers[n]);
 }
 async state(){const config=await this.config();const response=await this.rpc('skills/list',{cwds:[join(this.home,'homer-control')],forceReload:true});const root=resolve(this.home,'skills')+'/';return {toolSettings:nativeToolChoices(config.user),version:config.version,boundToNativeHome:this.adopted(),settingsPath:join(this.home,'config.toml'),skills:(response.data??[]).flatMap((x:any)=>x.skills??[]).filter((s:any)=>s.path?.startsWith(root)&&!s.path.slice(root.length).startsWith('.')).filter((s:any)=>/^[a-z][a-z0-9_-]{0,63}$/.test(basename(dirname(s.path)))&&resolve(s.path)===resolve(root,basename(dirname(s.path)),'SKILL.md')).map((s:any)=>({name:basename(dirname(s.path)),skillName:s.name,description:s.description,enabled:s.enabled,hash:hash(readFileSync(this.file(basename(dirname(s.path))),'utf8'))})),servers:Object.entries(config.servers).filter(([n])=>n!=='homer_interactions').map(([n,v])=>{try{return {name:n,server:publicMcpServer(validateMcpServer(v)),managed:true};}catch{return {name:n,managed:false};}}),application:this.adopted()?'next_turn':'isolated_configuration_only'};}
 async manage(input:any,actor:'agent'|'user',guard:()=>void=()=>{}):Promise<any>{const work=this.queue.then(()=>this.change(input,actor,guard));this.queue=work.catch(()=>{});return work;}
 private async change(input:any,actor:'agent'|'user',guard:()=>void):Promise<any>{
  guard();const rpc=(method:string,params:any)=>{guard();return this.rpc(method,params);};
  if(!record(input)||typeof input.action!=='string')throw Error('capability_request_invalid');const action=input.action;
  if(action==='state')return this.state();
  if(['discover','plugin_search','plugin_read'].includes(action))return nativeDiscovery(this.home,rpc,input,actor,guard);
  if(action==='skill_read'){const file=this.file(input.name),content=readFileSync(file,'utf8');const listed=await rpc('skills/list',{cwds:[join(this.home,'homer-control')],forceReload:true});const metadata=(listed.data??[]).flatMap((d:any)=>d.skills??[]).find((s:any)=>s.path===file);return {name:input.name,description:metadata?.description,content,hash:hash(content)};}
  if(action==='skill_save'||action==='skill_remove'){
   const file=this.file(input.name);const old=existsSync(file)?readFileSync(file,'utf8'):null;if((old===null?null:hash(old))!==input.expectedHash)throw Error('capability_skill_conflict');
   if(action==='skill_remove'){if(old!==null)unlinkSync(file);await rpc('skills/list',{cwds:[join(this.home,'homer-control')],forceReload:true});return {removed:true};}
   let content:string;
   if(typeof input.content==='string'){
    if(!input.content.startsWith('---\n')||Buffer.byteLength(input.content)>64000)throw Error('capability_skill_invalid');content=input.content;
   }else{
    if(old!==null&&!/^---\nname: [a-z][a-z0-9_-]*\ndescription: [^\n]+\n---\n/.test(old))throw Error('capability_skill_raw_update_required');
    if(typeof input.description!=='string'||!input.description.trim()||input.description.length>1000||/[\r\n]/.test(input.description)||typeof input.body!=='string'||!input.body.trim()||Buffer.byteLength(input.body)>60000)throw Error('capability_skill_invalid');
    content=`---\nname: ${name(input.name)}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.body.trim()}\n`;
   }
   mkdirSync(dirname(file),{recursive:true,mode:0o700});safePath(file);const temp=file+'.'+randomUUID()+'.tmp';
   try{writeFileSync(temp,content,{mode:0o600,flag:'wx'});renameSync(temp,file);const check=await rpc('skills/list',{cwds:[join(this.home,'homer-control')],forceReload:true});if(check.data?.some((d:any)=>d.errors?.some((e:any)=>e.path===file)))throw Error('capability_skill_native_invalid');}
   catch(error){if(old!==null)writeFileSync(file,old,{mode:0o600});else if(existsSync(file))unlinkSync(file);throw error;}finally{if(existsSync(temp))unlinkSync(temp);}
   return {name:input.name,hash:hash(content),saved:true,application:this.adopted()?'next_turn':'isolated_configuration_only'};
  }
  if(action==='catalog'){const n=name(input.name);const current=await this.config();if(!current.servers[n])throw Error('capability_server_missing');await rpc('config/mcpServer/reload',undefined);return publicMcpCatalog(await rpc('mcpServerStatus/list',{serverName:n,detail:'full',limit:100}));}
  if(action==='models'){const response=await rpc('model/list',{includeHidden:true});return {models:response.data.map((m:any)=>({id:m.id,model:m.model,displayName:m.displayName,supportedReasoningEfforts:m.supportedReasoningEfforts,inputModalities:m.inputModalities}))};}
  if(action==='oauth_logout'){
   if(actor!=='user'||input.approve!==true)throw Error('capability_user_approval_required');const n=name(input.name),current=await this.config();guard();if(current.version!==input.expectedVersion)throw Error('capability_config_conflict');const server=validateMcpServer(current.servers[n]);if(!server.url||!this.logout)throw Error('capability_oauth_unavailable');await this.logout(n,server);return {loggedOut:true,application:this.adopted()?'safe_reconnect_required':'isolated_configuration_only'};
  }
  if(action==='oauth'){
   if(actor!=='user'||input.approve!==true)throw Error('capability_user_approval_required');const n=name(input.name),config=await this.config();guard();if(config.version!==input.expectedVersion)throw Error('capability_config_conflict');const server=validateMcpServer(config.servers[n]);if(!server.url||server.enabled===false)throw Error('capability_oauth_unavailable');
   // Native code owns state, PKCE, callback and credentials. URLs stay in the
   // trusted management response, never an Agent tool result or a diagnostic.
   return rpc('mcpServer/oauth/login',{name:n,timeoutSecs:120});
  }
  const config=await this.config();guard();if(config.version!==input.expectedVersion)throw Error('capability_config_conflict');
  if(['plugin_install','plugin_uninstall'].includes(action))return nativeDiscovery(this.home,rpc,input,actor,guard);
  if(action==='tools_configure'){if(actor!=='user'||input.approve!==true)throw Error('capability_user_approval_required');const settings=validateNativeToolSettings(input.settings);const receipt=await rpc('config/batchWrite',{filePath:join(this.home,'config.toml'),expectedVersion:config.version,reloadUserConfig:false,edits:Object.entries(settings).map(([keyPath,value])=>({keyPath,value,mergeStrategy:'replace'}))});return {saved:true,version:receipt.version,application:this.adopted()?'safe_reconnect_required':'isolated_configuration_only'};}
  if(action==='skill_toggle'){if(typeof input.enabled!=='boolean')throw Error('capability_request_invalid');let file:string;
   if(input.path!==undefined){if(typeof input.path!=='string'||!resolve(input.path).startsWith(resolve(this.home)+'/')||!input.path.endsWith('/SKILL.md'))throw Error('capability_path_denied');file=resolve(input.path);safePath(file);const listed=await rpc('skills/list',{cwds:[join(this.home,'homer-control')],forceReload:true});guard();if(!listed.data?.some((d:any)=>d.skills?.some((s:any)=>s.path===file)))throw Error('capability_skill_missing');}else file=this.file(input.name);
   if(!existsSync(file))throw Error('capability_skill_missing');return rpc('skills/config/write',{path:file,enabled:input.enabled});}
  const n=name(input.name);const servers={...config.servers};
  if(action==='mcp_save'){
   const previous=servers[n],proposed=this.mcpProposal(input,previous);
   if(!this.validateMcp)throw Error('capability_mcp_validation_unavailable');
   await this.validateMcp(n,proposed);guard();
   // Compare every non-scope field, including fields added by native Codex in
   // the future. Object order is irrelevant; omitted/default fields stay exact.
   const identity=(v:any)=>{const {enabled_tools,...rest}=v;return rest;};
   const tools=proposed.enabled_tools,priorTools=previous?.enabled_tools;
   const subset=record(previous)&&isDeepStrictEqual(identity(previous),identity(proposed))&&Array.isArray(tools)&&tools.every((t:any)=>typeof t==='string')&&(priorTools===undefined||Array.isArray(priorTools)&&tools.every((t:string)=>priorTools.includes(t)));
   if(!subset&&(actor!=='user'||input.approve!==true))throw Error('capability_user_approval_required');
   servers[n]=proposed;
  }else if(action==='mcp_toggle'){if(!servers[n])throw Error('capability_server_missing');validateMcpServer(servers[n]);if(typeof input.enabled!=='boolean')throw Error('capability_request_invalid');servers[n]={...servers[n],enabled:input.enabled};}
  else if(action==='mcp_remove'){if(!servers[n])throw Error('capability_server_missing');delete servers[n];}
  else throw Error('capability_action_denied');
  // Edit this server only; never rewrite unrelated or built-in connections.
  let receipt:any;try{receipt=await rpc('config/batchWrite',{filePath:join(this.home,'config.toml'),expectedVersion:config.version,reloadUserConfig:false,edits:[{keyPath:'mcp_servers.'+n,value:servers[n]??null,mergeStrategy:'replace'}]});}
  catch(error){if(error instanceof Error&&error.message==='capability_config_conflict')throw error;throw Error('capability_mcp_save_failed');}
  return {saved:true,version:receipt.version,application:this.adopted()?'next_turn':'isolated_configuration_only'};
 }
}
