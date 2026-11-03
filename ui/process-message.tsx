import {messageSourceParts} from '../src/message-quote';
import {useMemo,type ReactNode} from 'react';
import {MessagePrimitive,useAuiState,type ThreadMessageLike,type ToolCallMessagePartComponent,type ToolCallMessagePartStatus} from '@assistant-ui/react';
import type {WebState} from '../src/web-contract';
import type {ToolContent,ToolValue} from '../src/tool-content';
import {projectProcessItems,toolActivityText,toolStatusText,type ToolItem} from './process-presentation';
import {ToolFallback} from './vendor/assistant-ui/tool-fallback.aui';
import './vendor/assistant-ui/tool-fallback.css';
import type {RunActivityEntry} from './vendor/assistant-ui/run-activity';
import {activityOutcomes} from '../src/activity-facts';

type Entry={kind:'commentary'|'tool'|'answer';label:string;status?:ToolItem['status'];live?:boolean;statusLabel?:string;inputNote?:string;outputNote?:string;factLabel?:string;phase?:string|null;completed?:boolean;source?:'model'|'host'};
export type ActivityPresentation={entries:Record<string,Entry>};
function valueNote(value:ToolValue|undefined,name:string,status:ToolItem['status']){
 if(!value||value.state==='not-recorded')return name+'当时未保存。';
 if(value.state==='pending')return status==='running'?name+'尚未返回。':name+'在结束时未记录。';
 if(value.state==='hidden')return name+(value.reason==='binary'?'为图像内容，请沿原成果入口查看。':'无法安全保存，内容已隐藏。');
 if(!('value' in value))return name+'当时未保存。';
 return (value.state==='truncated'?name+'已省略超限内容。':'')+(value.redacted?'明确凭据已遮蔽。':'')+(value.value===''?name+'为空字符串。':'');
}
const recorded=(value:ToolValue|undefined):value is Extract<ToolValue,{value:unknown}>=>value?.state==='recorded'||value?.state==='truncated';
// One derived message, with exact item IDs. Metadata carries classification and
// labels only; call bodies live solely in tool-call parts.
export function projectProcessMessage(message:WebState['messages'][number],stale=false,activeTurnId?:string):{content:ThreadMessageLike['content'];presentation:ActivityPresentation}{
 const content:Exclude<ThreadMessageLike['content'],string>[number][]=[],entries:ActivityPresentation['entries']={};
 const text=(id:string,body:string,kind:Entry['kind'])=>{if(!body.trim())return;content.push({type:'text',id,text:body});entries['text:'+id]={kind,label:kind==='answer'?'正式答复':body.slice(0,240)};};
 if(message.role==='assistant')for(const item of projectProcessItems(message.process?.items??[]).items){
  if(item.kind==='commentary'){
   text(item.id,item.text,item.phase==='final_answer'?'answer':'commentary');
   const entry=entries['text:'+item.id];if(entry)Object.assign(entry,{phase:item.phase??null,completed:item.completed,source:item.turnId&&item.itemId?'model':'host'});
  }
  else if(item.kind==='tool'){
   const input=item.content?.input,output=item.content?.output;
   const itemStale=stale||activeTurnId!==undefined&&item.turnId!==undefined&&item.turnId!==activeTurnId;
   content.push({type:'tool-call',toolCallId:item.id,toolName:item.toolName??item.label??'工具名称未保留',argsText:recorded(input)?JSON.stringify(input.value,null,2):'',
    ...(recorded(output)?{result:output.value}:{}),isError:item.status==='failed',
    ...(item.startedAtMs!==undefined&&(item.status!=='running'||!itemStale)?{timing:{startedAt:item.startedAtMs,...(item.endedAtMs!==undefined?{completedAt:item.endedAtMs}:{})}}:{})});
   entries['tool-call:'+item.id]={kind:'tool',status:item.status,live:!itemStale,statusLabel:item.status==='running'&&itemStale?'上次调用中，结束未确认':toolStatusText[item.status],label:toolActivityText(item,itemStale),inputNote:valueNote(input,'参数',item.status),outputNote:valueNote(output,'结果',item.status),...(item.activity?{factLabel:'业务记录：'+(item.activity.objectName?item.activity.objectName+' · ':'')+activityOutcomes[item.activity.outcome]}:{})};
  }
 }
 if(!message.process){text('answer:'+message.id,message.text,'answer');}
 else if(message.process.sourceKind==='worker'||messageSourceParts(message)===undefined)text('host:'+message.id,message.text,'answer');
 return {content,presentation:{entries}};
}
export function toolPartStatus(status:ToolItem['status']|undefined,live=true):ToolCallMessagePartStatus{
 if(status==='completed')return {type:'complete'};
 if(status==='running')return live?{type:'running'}:{type:'incomplete',reason:'other'};
 return {type:'incomplete',reason:status==='interrupted'||status==='declined'?'cancelled':status==='failed'?'error':'other',...(status==='failed'?{error:toolStatusText.failed}:{})};
}
// Pure body display is shared with task details; no assistant runtime required.
export function ToolCallBody({content,status}:{content?:ToolContent;status:ToolItem['status']}){
 const input=content?.input,output=content?.output;
 return <><ToolFallback.Error status={toolPartStatus(status)}/><ToolFallback.Args argsText={recorded(input)?JSON.stringify(input.value,null,2):''}/><p role="note">{valueNote(input,'参数',status)}</p><ToolFallback.Result result={recorded(output)?output.value:undefined}/><p role="note">{valueNote(output,'结果',status)}</p></>;
}
const HomerToolFallback:ToolCallMessagePartComponent=props=>{
 const entry=useAuiState(s=>(s.message.metadata.custom.activityPresentation as ActivityPresentation|undefined)?.entries['tool-call:'+props.toolCallId]);
 const status=toolPartStatus(entry?.status,entry?.live);
 // The original business InteractionCard owns identity, single-use authority,
 // expiry and unknown delivery. No synthetic approval/resume callbacks here.
 return <ToolFallback.Root data-tool-id={props.toolCallId} data-tool-status={entry?.status}>
  <ToolFallback.Trigger toolName={props.toolName} status={status} label={entry?.statusLabel??'结束状态待核实'}/>
  <ToolFallback.Content>
   <ToolFallback.Error status={status}/>
   <ToolFallback.Args argsText={props.argsText}/>
   {entry?.inputNote&&<p role="note">{entry.inputNote}</p>}
   <ToolFallback.Result result={props.result}/>
   {entry?.outputNote&&<p role="note">{entry.outputNote}</p>}
   {entry?.factLabel&&<p role="note">{entry.factLabel}</p>}
  </ToolFallback.Content>
 </ToolFallback.Root>;
};
// Identify normalized parts by ID and render each process item once inside
// the original disclosure, regardless of tool status.
export function useProcessParts(renderText:(text:string)=>ReactNode){
 const presentation=useAuiState(s=>s.message.metadata.custom.activityPresentation as ActivityPresentation|undefined);
 const parts=useAuiState(s=>s.message.parts);
 const entries:RunActivityEntry[]=[];
 const components=useMemo(()=>({Text:({text}:{text:string})=><div className="process-item">{renderText(text)}</div>,tools:{Fallback:HomerToolFallback}}),[renderText]);
 const answerIndices:number[]=[];
 parts.forEach((part,index)=>{
  const id=part.type==='tool-call'?'tool-call:'+part.toolCallId:part.type==='text'?'text:'+part.id:'';
  const entry=presentation?.entries[id];if(!entry)return;
  if(entry.kind==='answer'){answerIndices.push(index);return;}
  const content=<MessagePrimitive.PartByIndex key={id} index={index} components={components}/>;
  entries.push({id,kind:entry.kind,label:entry.label,content});
 });
 // Formal answers use the existing Markdown renderer supplied by the caller.
 const renderAnswers=(Text:({text}:{text:string})=>ReactNode)=>answerIndices.map(index=>{const part=parts[index],id=part?.type==='text'?part.id:undefined,source=id?presentation?.entries['text:'+id]?.source:undefined;return <div key={id??index} style={{display:'contents'}} data-message-item-id={source==='model'?id:undefined}><MessagePrimitive.PartByIndex index={index} components={{Text}}/></div>;});
 return {entries,hasBody:answerIndices.length>0,renderAnswers};
}
