import {composerFixture} from './composer-browser-server.mjs';
const details='/bin/zsh -lc \'node /synthetic/中文目录/'+('long-command-path-'.repeat(45))+'/probe.mjs --说明="<script>仅作为文字</script>"\'\n工作目录：/synthetic/工作目录';
export const approval={id:'synthetic-approval',runId:'main-native:synthetic-generation',kind:'authorization',workTitle:'主对话',sourceRequestId:'synthetic-source',question:'确认本次操作：\n'+details,reason:'仅授权当前请求；不授予永久权限或自动重试。',approval:{title:'允许执行这条命令？',explanation:'隔离合成命令，请核对完整路径与参数。',scope:'仅批准当前命令。',detailLabel:'查看完整命令与工作目录',details}};
export async function approvalFixture(options){
 const decisions=[],held=[];let mode='unknown';
 const f=await composerFixture({...options,interaction({url,body,res,json}){
  decisions.push({id:decodeURIComponent(url.pathname.split('/').at(-1)),...body});
  if(mode==='hold'){held.push({res,json});return;}
  if(mode==='expired'){f.update({interactions:[]});return json({error:'interaction_not_live'},409);}
  if(mode==='unknown')return json({error:'synthetic_receipt_unknown'},503);
  return json({ok:true});
 }});
 const source={id:'synthetic-original',threadId:'approval-thread',requestId:'synthetic-source',role:'user',text:'核对合成命令的原请求',status:'completed',createdAt:1700000000000};
 const answer={id:'synthetic-answer',threadId:'approval-thread',requestId:'synthetic-source',role:'assistant',text:'隔离合成答复，顶部状态和成果预览仍沿产品组件。',status:'completed',createdAt:1700000001000};
 const reset=(overrides={})=>{decisions.length=0;mode='unknown';f.reset({threadId:'approval-thread',messages:[source,answer],interactions:[approval],features:{taskOverview:true},...overrides});};reset();
 return {...f,decisions,reset,setMode(value){mode=value;},release(error){for(const {json} of held)json(error?{error}:{ok:true},error?409:200);held.length=0;},close:async()=>{for(const {res} of held)res.end();await f.close();}};
}
