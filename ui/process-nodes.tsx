import type {ReactNode} from 'react';
import type {ProcessNode} from '../src/main-process';
import type {WebState} from '../src/web-contract';
import './process-nodes.css';

export function InactiveInteractionNotes({items=[]}:{items?:WebState['inactiveInteractions']}) {
  return <>{items.map(item=><p key={item.id} className="message-state" style={{display:'block'}}>{item.code==='interaction_user_cancelled'?'用户已取消本次请求。':item.code==='capability_approval_timeout'?'等待用户确认已超时。':item.kind==='authorization'?'原授权请求已失效，旧决定不能恢复此回调。':'原提问回调已失效，旧卡片不能继续提交。'}可在原事项对话核对当前状态。</p>)}</>;
}
export function ProcessMessageContent({node,children,taskSourceUnresolved}:{node?:ProcessNode;children:ReactNode;taskSourceUnresolved?:true}) {
  return <>
    {node&&<ProcessNodeView node={node}/>}
    {taskSourceUnresolved&&<p className="process-record-note">部分任务来源尚未核实。</p>}
    {children}
  </>;
}

export function ProcessNodeView({node}:{node:ProcessNode}){
  return <>{node.items.map(item=>{
    if(item.kind!=='workerEvent'||item.event?.eventKind!=='start_failed')return null;
    return <p key={item.id} className="process-record-note">{item.event.title} · {item.event.body}</p>;
  })}</>;
}
