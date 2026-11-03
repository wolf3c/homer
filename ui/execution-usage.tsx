import type {NativeTokenUsage} from '../src/native-usage';
import './execution-usage.css';

export function ExecutionUsage({usage,stale=false}:{usage?:NativeTokenUsage['execution'];stale?:boolean}){
 if(!usage)return null;
 const cost=usage.costStatus==='estimated'&&usage.estimatedCostCny!==null
  ?'本轮估算 ¥'+usage.estimatedCostCny.toFixed(4):'费用暂不可估算';
 const counts=usage.inputTokens!==null&&usage.cachedInputTokens!==null&&usage.outputTokens!==null
  ?`输入 ${usage.inputTokens.toLocaleString('en-US')}（含缓存 ${usage.cachedInputTokens.toLocaleString('en-US')}） · 输出 ${usage.outputTokens.toLocaleString('en-US')}`:undefined;
 const stop=usage.stopReason==='engine_compaction_loop'?'已请求停止：连续压缩未取得新结果'
  :usage.stopReason==='engine_cost_limit_reached'?'已请求停止：达到本轮费用阈值':undefined;
 return <div className="execution-usage" aria-label="本轮用量" title="按已观测用量和配置单价估算；尚在执行的请求可能继续产生费用。">
  {stale&&<span>上次记录</span>}<span>{cost}</span>{counts&&<span>{counts}</span>}
  {usage.consecutiveCompactions>0&&<span>连续压缩 {usage.consecutiveCompactions} 次</span>}
  {stop&&<span className="execution-usage-stop">{stop}</span>}
 </div>;
}
