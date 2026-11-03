import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectProcessMessage,toolPartStatus} from './helpers/tool-ui-loader.mjs';
import {toMessagePartStatus} from '../node_modules/@assistant-ui/core/dist/utils/normalizePartStatus.js';
const tool=(id,status,value)=>({id,kind:'tool',seq:2,revision:1,status,label:'检查资料',toolName:'synthetic_tool',content:{input:{state:'recorded',value:{query:'SYNTHETIC_INPUT'}},output:{state:'recorded',value}}});
const message={id:'message',role:'assistant',text:'正式正文',createdAt:123,process:{sourceKind:'user',items:[{id:'blank',kind:'commentary',text:''},{id:'commentary',kind:'commentary',phase:'commentary',text:'公开进度'},tool('call','completed',false),{id:'final',kind:'commentary',phase:'final_answer',text:'正式正文',completed:true,seq:3,revision:1}]},finalAnswers:[{id:'final',text:'正式正文',completed:true}]};
test('same message parts carry ordered commentary, true tool values and explicit final identities; metadata contains no payload',()=>{
 const projected=projectProcessMessage(message);
 assert.deepEqual(projected.content.map(p=>p.type),['text','tool-call','text']);
 assert.equal(projected.content[0].id,'commentary');assert.equal(projected.content[1].toolCallId,'call');assert.equal(projected.content[2].id,'final');
 assert.equal(projected.content[1].result,false);assert.match(projected.content[1].argsText,/SYNTHETIC_INPUT/);
 assert.doesNotMatch(JSON.stringify(projected.presentation),/SYNTHETIC_INPUT|公开进度.*公开进度|正式正文/);
 assert.equal(projected.presentation.entries['text:final'].kind,'answer');
 const duplicate=projectProcessMessage({...message,process:{...message.process,items:[...message.process.items,{...tool('call','failed',0),revision:2}]}});
 assert.equal(duplicate.content.filter(p=>p.type==='tool-call').length,1);assert.equal(duplicate.content[1].toolCallId,'call');assert.equal(duplicate.content[1].result,0);
});
test('missing, hidden and pending results never fabricate {}, while false, 0, null and empty strings survive',()=>{
 for(const value of [false,0,null,''])assert.equal(projectProcessMessage({...message,process:{...message.process,items:[tool('call','completed',value)]}}).content[0].result,value);
 for(const state of ['not-recorded','hidden','pending']){
  const t=tool('call','completed',null);t.content={input:{state},output:{state}};
  const p=projectProcessMessage({...message,process:{...message.process,items:[t]}});
  assert.equal(p.content[0].argsText,'');assert.equal(Object.hasOwn(p.content[0],'result'),false);assert.ok(p.presentation.entries['tool-call:call'].outputNote);
 }
 const legacy=tool('legacy','completed');delete legacy.content;
 const p=projectProcessMessage({...message,process:{...message.process,items:[legacy]}});assert.match(p.presentation.entries['tool-call:legacy'].inputNote,/当时未保存/);
});
test('failed result remains failed even when installed core derives complete; every real status has a distinct label',()=>{
 const p=projectProcessMessage({...message,process:{...message.process,items:[tool('failed','failed',{isError:true})]}});
 assert.equal(toMessagePartStatus({role:'assistant',status:{type:'complete',reason:'stop'},content:p.content},0,p.content[0]).type,'complete','upstream counterexample remains reproduced');
 assert.deepEqual(toolPartStatus(p.presentation.entries['tool-call:failed'].status),{type:'incomplete',reason:'error',error:'调用失败'});
 const labels=[];for(const status of ['running','completed','failed','interrupted','declined','unknown','blocked']){
  const m=projectProcessMessage({...message,process:{...message.process,items:[tool('status',status,null)]}});labels.push(m.presentation.entries['tool-call:status'].statusLabel);
 }
 assert.equal(new Set(labels).size,7);assert.equal(toolPartStatus('unknown').reason,'other');assert.equal(toolPartStatus('blocked').reason,'other');assert.equal(toolPartStatus('declined').reason,'cancelled');
 const stale=projectProcessMessage({...message,process:{...message.process,items:[{...tool('running','running'),startedAtMs:123}]}},true);
 assert.equal(stale.content[0].timing,undefined);assert.match(stale.presentation.entries['tool-call:running'].statusLabel,/上次/);assert.equal(toolPartStatus('running',false).type,'incomplete');
});
