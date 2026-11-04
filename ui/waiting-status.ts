import type {MainActivity,WebState} from '../src/web-contract.js';
import type {ProcessNode} from '../src/main-process.js';
import {compactProcessAction,confirmedTerminal} from './process-presentation.js';

// A live snapshot replaces observations; history merge must never preserve them.
export function liveMainActivity(state:WebState,connected:boolean):MainActivity|null{
  const activity=state.mainActivity;
  if(!connected||!state.threadId||state.upgrade.phase!=='running'||!activity)return null;
  const node=state.processNodes?.find(node=>node.id===activity.processId);
  if(!node||node.threadId!==state.threadId||activity.source!==(node.sourceKind==='user'?'user':'internal')||node.state==='worked'||node.status==='unknown')return null;
  if(activity.turnId&&node?.turnIds.length&&node.turnIds.at(-1)!==activity.turnId)return null;
  if(activity.source==='user'&&activity.turnId&&state.generation?.turnId!==activity.turnId)return null;
  return activity;
}
function stageText(activity:MainActivity,nativeText='处理中'){
  const labels={preparing:activity.source==='internal'?'正在准备协作处理':'正在准备本轮处理',native:nativeText,compacting:'正在压缩上下文，等待原生完成',finishing:'原生轮已结束，宿主处理中',unknown:'当前处理阶段待确认'};
  const retry=activity.retryObserved&&!['finishing','unknown'].includes(activity.stage)?'；本轮原生执行'+(activity.connectionIssue?'发生连接异常并':'')+'报告过重试，完成待确认':'';
  return labels[activity.stage]+retry;
}
export function processActivityText(state:WebState,connected:boolean,node:ProcessNode):string{
  const observation={connected,threadId:state.threadId,serviceRunning:state.upgrade.phase==='running',generationTurnId:state.generation?.turnId,mainActivity:state.mainActivity};
  if(confirmedTerminal(node))return compactProcessAction(node,observation);
  if((!connected||state.upgrade.phase!=='running')&&(node.state==='working'||node.items.some(item=>item.kind==='worker'&&['queued','running'].includes(item.runStatus??''))))return '以下为上次状态，当前执行状态未确认';
  if(node.status==='unknown')return '本次处理结束状态待核实';
  const activity=liveMainActivity(state,connected);
  if(!activity||activity.processId!==node.id)return node.state==='working'?'当前处理阶段待确认':'';
  if(activity.stage==='native'||activity.stage==='compacting'){
    const pending=activity.source==='user'&&state.generation?state.interactions.find(item=>item.runId==='main-native:'+state.generation!.generationId):undefined;
    if(pending)return pending.kind==='authorization'?'等待你确认本轮操作':'等待你补充本轮信息';
  }
  return stageText(activity,activity.stage==='native'?compactProcessAction(node,observation):undefined);
}
export function serviceActivityNotice(upgrade:WebState['upgrade']):string{
  if(upgrade.phase==='running')return '';
  if(upgrade.phase==='building')return '正在准备更新，当前工作继续。';
  const transport=upgrade.accepting?'普通消息可暂存，等待业务接收。':'当前暂不接收输入。';
  if(upgrade.phase==='recovery_required')return (upgrade.code==='dev_child_exit_unconfirmed'?'执行服务进程已退出，后台执行状态待核实。':'业务服务待恢复，当前执行状态待核实。')+transport;
  if(upgrade.phase==='stopping')return '执行服务正在停止，结束尚未确认。'+transport;
  return '服务正在准备或切换，以下执行记录为上次状态。'+transport;
}
