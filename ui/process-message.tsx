import {scheduleMessageBody} from '../src/schedule-reference';
import {messageSourceParts} from '../src/message-quote';
import {type ReactNode} from 'react';
import {MessagePrimitive,useAuiState,type ThreadMessageLike} from '@assistant-ui/react';
import type {WebState} from '../src/web-contract';
import {projectProcessItems} from './process-presentation';

type Entry={kind:'answer';source:'model'|'host'};
export type ActivityPresentation={entries:Record<string,Entry>};
// Preserve final item identities; process commentary and tool calls have no UI parts.
export function projectProcessMessage(message:WebState['messages'][number]):{content:ThreadMessageLike['content'];presentation:ActivityPresentation}{
 const content:Exclude<ThreadMessageLike['content'],string>[number][]=[],entries:ActivityPresentation['entries']={};
 const text=(id:string,body:string,source:Entry['source'])=>{if(!body.trim())return;content.push({type:'text',id,text:body});entries['text:'+id]={kind:'answer',source};};
 if(message.role==='assistant')for(const item of projectProcessItems(message.process?.items??[]).items){
  if(item.kind==='commentary'&&item.phase==='final_answer')text(item.id,item.text,item.turnId&&item.itemId?'model':'host');
 }
 if(!message.process&&message.finalAnswers?.length){
  for(const part of message.finalAnswers)text(part.id,part.text,'model');
 }else if(!message.process)text('answer:'+message.id,
  (message.role==='user'?scheduleMessageBody(message.text,message.scheduleReference):undefined)??message.text,'host');
 else if(message.process.sourceKind==='worker'||messageSourceParts(message)===undefined)text('host:'+message.id,message.text,'host');
 return {content,presentation:{entries}};
}
export function useProcessParts(){
 const presentation=useAuiState(s=>s.message.metadata.custom.activityPresentation as ActivityPresentation|undefined);
 const parts=useAuiState(s=>s.message.parts);
 const answerIndices:number[]=[];
 parts.forEach((part,index)=>{if(part.type==='text'&&presentation?.entries['text:'+part.id])answerIndices.push(index);});
 const renderAnswers=(Text:({text}:{text:string})=>ReactNode)=>answerIndices.map(index=>{const part=parts[index],id=part?.type==='text'?part.id:undefined,source=id?presentation?.entries['text:'+id]?.source:undefined;return <div key={id??index} style={{display:'contents'}} data-message-item-id={source==='model'?id:undefined}><MessagePrimitive.PartByIndex index={index} components={{Text}}/></div>;});
 return {hasBody:answerIndices.length>0,renderAnswers};
}
