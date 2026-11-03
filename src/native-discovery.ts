import{createHash,randomUUID}from'node:crypto';
import{resolve,relative,isAbsolute,join,parse}from'node:path';
import{existsSync,lstatSync}from'node:fs';
import type{NativeRpc}from'./native-capabilities.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const inside=(home:string,path:string)=>{const r=relative(resolve(home),resolve(path));return r!==''&&!r.startsWith('..')&&!isAbsolute(r);};
function target(home:string,value:any){
 if(!record(value)||typeof value.pluginName!=='string'||!value.pluginName.trim()||value.pluginName.length>200||Object.keys(value).some(k=>!['pluginName','marketplacePath','remoteMarketplaceName'].includes(k)))throw Error('capability_plugin_target_invalid');
 if(value.marketplacePath!==undefined&&(typeof value.marketplacePath!=='string'||!inside(home,value.marketplacePath)))throw Error('capability_path_denied');
 if(value.remoteMarketplaceName!==undefined&&(typeof value.remoteMarketplaceName!=='string'||!value.remoteMarketplaceName.trim()||value.remoteMarketplaceName.length>200))throw Error('capability_plugin_target_invalid');
 if(!value.marketplacePath===!value.remoteMarketplaceName)throw Error('capability_plugin_target_invalid');
 if(value.marketplacePath){let path=parse(resolve(value.marketplacePath)).root;for(const part of resolve(value.marketplacePath).slice(path.length).split('/')){path=join(path,part);if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('capability_path_denied');}}
 return {...value};
}
async function readPlugin(home:string,rpc:NativeRpc,value:any,guard:()=>void){
 let selected=target(home,value),result=await rpc('plugin/read',selected);guard();
 const remoteId=result.plugin?.summary?.remotePluginId;
 if(selected.remoteMarketplaceName&&typeof remoteId==='string'&&remoteId&&selected.pluginName!==remoteId){
  const id=result.plugin.summary.id;selected={...selected,pluginName:remoteId};
  result=await rpc('plugin/read',selected);guard();
  if(result.plugin?.summary?.id!==id||result.plugin?.summary?.remotePluginId!==remoteId)throw Error('capability_plugin_target_conflict');
 }
 return {...result,target:selected};
}
async function status(call:()=>Promise<any>){try{return {value:await call()};}catch(error){return {error:error instanceof Error&&/^[a-z][a-z0-9_]{1,70}$/.test(error.message)?error.message:'capability_native_query_failed'};}}
// Native services/files are the authority. No plugin registry, installer or
// connector client is recreated here. Human mutations cannot be called by a model.
export async function nativeDiscovery(home:string,rpc:NativeRpc,input:any,actor:'agent'|'user',guard:()=>void):Promise<any>{
 const cwd=join(home,'homer-control');
 if(input.action==='discover'){
  const queries=[['features',()=>rpc('experimentalFeature/list',{limit:200})],['provider',()=>rpc('modelProvider/capabilities/read',{})],['skills',async()=>{const result=await rpc('skills/list',{cwds:[cwd],forceReload:true});return {...result,data:(result.data??[]).map((d:any)=>({...d,skills:(d.skills??[]).filter((skill:any)=>typeof skill.path==='string'&&inside(home,skill.path))}))};}],['plugins',async()=>{const result=await rpc('plugin/list',{cwds:[cwd]});let remaining=actor==='agent'?30:Number.MAX_SAFE_INTEGER;const total=(result.marketplaces??[]).reduce((n:number,m:any)=>n+(m.plugins?.length??0),0);return {...result,total,summaryOnly:actor==='agent',marketplaces:(result.marketplaces??[]).map((m:any)=>({name:m.name,path:m.path,plugins:(m.plugins??[]).filter(()=>remaining-->0).map((p:any)=>({id:p.id,name:p.name,installed:p.installed,enabled:p.enabled,availability:p.availability,installPolicy:p.installPolicy,disabledReason:p.disabledReason,interface:p.interface?{displayName:p.interface.displayName}:null}))}))};}],['apps',()=>rpc('app/list',{limit:100})]] as const;
  const values=await Promise.all(queries.map(async([key,call])=>[key,await status(call)]));guard();return Object.fromEntries(values);
 }
 if(input.action==='plugin_search'){
  if(typeof input.query!=='string'||!input.query.trim()||input.query.length>200)throw Error('capability_plugin_query_invalid');
  const found=await rpc('plugin/search',{searchTerm:input.query,cwds:[cwd],limit:30,...(typeof input.cursor==='string'?{cursor:input.cursor}:{})});guard();
  return {...found,data:(found.data??[]).map((item:any)=>{try{return {...item,target:target(home,{pluginName:!item.marketplacePath&&item.plugin?.remotePluginId||item.plugin?.name,...(item.marketplacePath?{marketplacePath:item.marketplacePath}:{remoteMarketplaceName:item.marketplaceName})})};}catch(error){return {...item,target:null,targetError:error instanceof Error?error.message:'capability_plugin_target_invalid'};}})};
 }
 if(input.action==='plugin_read'){
  const result=await readPlugin(home,rpc,input.target,guard);return {...result,reviewHash:hash(result.plugin)};
 }
 if(actor!=='user'||input.approve!==true)throw Error('capability_user_approval_required');
 if(input.action==='plugin_install'){
  const result=await readPlugin(home,rpc,input.target,guard),selected=result.target;
  if(typeof input.reviewHash!=='string'||input.reviewHash!==hash(result.plugin))throw Error('capability_plugin_review_conflict');
  if(result.plugin?.summary?.availability==='DISABLED_BY_ADMIN'||result.plugin?.summary?.installPolicy==='NOT_AVAILABLE')throw Error('capability_plugin_unavailable');
    const installed=await rpc('plugin/install',{...selected,installAttemptId:randomUUID()});guard();
  return {...installed,saved:true,application:'next_turn'};
 }
  if(input.action==='plugin_uninstall'){
  if(typeof input.pluginId!=='string'||!input.pluginId.trim()||input.pluginId.length>300)throw Error('capability_plugin_target_invalid');
  const review=await readPlugin(home,rpc,input.target,guard),selected=review.target;
  if(typeof input.reviewHash!=='string'||input.reviewHash!==hash(review.plugin))throw Error('capability_plugin_review_conflict');
  if(review.plugin?.summary?.id!==input.pluginId||!review.plugin?.summary?.installed)throw Error('capability_plugin_target_invalid');
  const result=await rpc('plugin/uninstall',{pluginId:selected.remoteMarketplaceName&&review.plugin.summary.remotePluginId||input.pluginId});guard();return {...result,removed:true,application:'next_turn'};
 }
 throw Error('capability_action_denied');
}
