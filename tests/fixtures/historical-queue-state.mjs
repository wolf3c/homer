// Sanitized failure shape: synthetic text and IDs only, never copied user content.
export const markdown = '# 合成交接核对\n\n'+('已完成项目请逐项核对，保留原请求身份，不重复执行。'.repeat(14))+'\n\n- 性能核对\n- 时间线核对\n- 状态核对\n\n| 项目 | 状态 |\n| --- | --- |\n| 合成版本 | 待核对 |\n\n```ts\nconst synthetic = true;\n```';
export function historicalQueueState(){
 const threadId='synthetic-thread',messages=[],queue=[];
 const message=(id,requestId,role,text,status,createdAt)=>({id,threadId,requestId,role,text,status,createdAt,sources:[],toolActivities:[]});
 function pair(id,state,text,seq){
  const status=state==='uncertain'?'processing':state;
  const user=message('user-'+id,id,'user',text,status,seq*10);
  const reply=message('reply-'+id,id,'assistant',state==='cancelled'?'':'合成回复 '+id,state==='uncertain'?'interrupted':state,seq*10+1);
  messages.push(user,reply);queue.push({messageId:'inbox-'+id,seq,revision:2,inputRevision:1,input:{requestId:id,text},replyId:reply.id,state,source:'local',generationId:'generation-'+id});
  return {user,reply};
 }
 for(let i=0;i<74;i++)pair('legacy-'+i,i<69?'completed':i<71?'failed':i<73?'cancelled':'uncertain','合成历史用户 '+i,i+1);
 const a=pair('handoff-original','uncertain',markdown,75),b=pair('handoff-later','completed',markdown+'\n后续合成核对',76);
 const node=(id,seq,state,status,final)=>({id:'node-'+id,threadId,sourceKind:'user',sourceMessageIds:['inbox-'+id],messageId:'node-'+id,replyMessageId:'reply-'+id,seq,revision:4,state,status,turnIds:['turn-'+id],items:[],...(final?{final:{id:'final-'+id,text:final},endEventId:'terminal-'+id}:{})});
 const nodes=[node('handoff-original',1,'working','unknown'),node('handoff-later',2,'worked','completed','合成核对已完成')];
 nodes[0].items=[{id:'unconfirmed-native-tool',kind:'tool',seq:1,revision:1,label:'检查资料',status:'running'}];
 messages.push(...nodes.map(n=>message(n.messageId,n.replyMessageId==='reply-handoff-original'?a.user.requestId:b.user.requestId,'assistant',n.final?.text??'',n.status==='unknown'?'interrupted':'completed',n.seq*10+750)));
 // Authoritative history order, not node ownership inferred from timestamps.
 messages.sort((x,y)=>x.createdAt-y.createdAt);
 return {threadId,messages,queue,processNodes:nodes,isRunning:false,activeMessageId:null,generation:null,mainActivity:null,work:[],interactions:[],upgrade:{phase:'running',accepting:true,version:'synthetic-history-repair'},features:{}};
}
export function queuedPair(id,seq,state='queued'){
 const input={requestId:id,text:'合成排队 '+id};
 return {user:{id:'user-'+id,threadId:'synthetic-thread',requestId:id,role:'user',text:input.text,status:state==='uncertain'?'interrupted':state,createdAt:1000+seq},queue:{messageId:'inbox-'+id,seq,revision:0,inputRevision:1,input,replyId:'reply-'+id,state,source:'local',...(state==='queued'?{preparation:'preparing'}:{})}};
}
