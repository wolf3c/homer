import {createHash} from 'node:crypto';
import type{NativeCapabilities}from'./native-capabilities.js';
// Review native metadata and the exact mutation, never the model's permission claim.
// Installation/configuration remains exclusively in NativeCapabilities/Codex.
export async function capabilityOperationReview(manager:NativeCapabilities,input:any,guard:()=>void){
 const state=await manager.manage({action:'state'},'agent',guard);guard();
 if(state.version!==input.expectedVersion)throw Error('capability_config_conflict');
 let operation:any,summary:any;
 if(['plugin_install','plugin_uninstall'].includes(input.action)){
  const detail=await manager.manage({action:'plugin_read',target:input.target},'agent',guard);guard();
  if(input.reviewHash!==detail.reviewHash)throw Error('capability_plugin_review_conflict');
  const plugin=detail.plugin,metadata=plugin?.summary;
  if(!metadata||typeof metadata.id!=='string')throw Error('capability_plugin_review_unavailable');
  if(input.action==='plugin_install'&&metadata.installed)throw Error('capability_plugin_already_installed');
  if(input.action==='plugin_uninstall'&&(!metadata.installed||input.pluginId!==metadata.id))throw Error('capability_plugin_target_invalid');
  operation={action:input.action,target:detail.target,reviewHash:detail.reviewHash,expectedVersion:state.version,...(input.action==='plugin_uninstall'?{pluginId:metadata.id}:{})};
  summary={name:metadata.interface?.displayName??metadata.name,id:metadata.id,version:metadata.version??'原生目录未提供版本',source:metadata.source,developer:metadata.interface?.developerName,website:metadata.interface?.websiteUrl,skills:plugin.skills,hooks:plugin.hooks,apps:plugin.apps,mcpServers:plugin.mcpServers,authPolicy:metadata.authPolicy,onboardingSkill:plugin.onboardingSkill,appTemplates:plugin.appTemplates,scheduledTasks:plugin.scheduledTasks};
 }else if(input.action==='mcp_save'){
  const server=await manager.mcpServerForReview(input,guard);guard();
  // This is a review/display policy, not the native input schema. Ordinary
  // approval must show the complete effective operation. Hidden arguments or
  // advanced fields require the trusted user configuration path, even when
  // inherited by a patch; a hash cannot authorize unseen values.
  const visible=new Set(['command','url','enabled','enabled_tools','cwd','startup_timeout_sec','tool_timeout_sec','default_tools_approval_mode']);
  if(Object.keys(server).some(k=>!visible.has(k)&&!(k==='args'&&Array.isArray(server.args)&&server.args.length===0)))throw Error('capability_mcp_trusted_configuration_required');
  operation={action:input.action,name:input.name,server,expectedVersion:state.version};summary={...operation,reviewScope:'完整配置；所有生效字段逐值展示',configurationHash:createHash('sha256').update(JSON.stringify(operation)).digest('hex')};
 }else throw Error('capability_action_denied');
 const question=(input.action==='plugin_uninstall'?'卸载所示工具：':'安装或配置所示工具：')+'\n'+JSON.stringify(summary,null,2)+'\n数据位置：'+manager.home+'。由 Codex 原生安装/配置；卸载可在同一对话请求并审阅原生卸载（MCP 可移除）。新本地程序可能以本机账户执行；所示程序、Hooks、MCP、Apps 的权限须一并核对。额外依赖、第三方登录、费用和系统权限另行批准。版本变化需重新审阅。';
 if(question.length>4000)throw Error('capability_review_too_large');
 return {operation,question,details:input.action==='mcp_save'?summary:operation};
}
