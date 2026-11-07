// Synthetic display facts plus existing in-memory history/HTTP owners.
// Deliberately independent of uncommitted activity-capture/task-navigation code.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './web-history-followup-fixture.mjs';
export async function legacyActivityFixture(mode='all-old'){
 const f=await fixture(90,'after');
 const facts=[
  {action:'inspect_task',objectName:'周报材料核对',outcome:'record_read'},
  {action:'inspect_task',objectName:'周报材料核对',outcome:'record_read'},
  {action:'inspect_attachment',objectName:'季度经营数据核对与改进建议_待确认范围说明_2026年十月最终候选.md',outcome:'attachment_read'},
  {action:'inspect_run',outcome:'record_read'},
  {action:'update_task',outcome:'update_confirmed'},
 ].map((activity,i)=>({id:'activity-call-'+i,seq:i+1,revision:2,kind:'tool',category:'host',label:i===4?'调整任务':'检查资料',status:'completed',activity:{schemaVersion:1,...activity}}));
 const activityReads=[];
 const readProcess=f.bridge.history.process;f.bridge.history.process=async input=>{activityReads.push(input.itemId??null);return readProcess(input);};
 const initial=JSON.parse(f.store.meta('publicMainNode:v1:node-89'));
 f.store.setMeta('publicMainNode:v1:node-89',JSON.stringify({...initial,state:'working',status:'running',final:undefined}));
 f.processes.workerEvent('node-89',{eventKey:'synthetic:delegated',eventKind:'delegated',title:'核对日期',body:'核对原材料中的日期。',bodySource:'description',taskId:null,version:1,runId:null,resultId:null,sourceMessageId:null,operationKey:'synthetic-event',observedAtMs:1});
 const base=JSON.parse(f.store.meta('publicMainNode:v1:node-89'));
 const old=Array.from({length:24},(_,i)=>({id:'old-'+i,seq:i+1,revision:1,kind:'tool',category:'host',label:i%2?'检查资料':'核对成果',status:'completed'}));
 const risks=['running','failed','declined','interrupted','unknown','blocked'].map((status,i)=>({id:'risk-'+i,seq:30+i,revision:1,kind:'tool',category:'host',label:'检查资料',status}));
 const event={...base.items.find(item=>item.kind==='workerEvent'),seq:50};
 let running=false;
 const readState=f.bridge.history.state;
 f.bridge.history.state=async()=>{const state=await readState();return {...state,isRunning:running,activeMessageId:running?'node-89':null,generation:running?{threadId:'synthetic-history',turnId:'turn-89',messageId:'node-89'}:null,mainActivity:running?{source:'user',stage:'native',processId:'node-89',turnId:'turn-89'}:null};};
 function setScenario(value){
  const prior=JSON.parse(f.store.meta('publicMainNode:v1:node-89'));
  const items=value==='all-old'?old:value==='detailed'?facts:value==='mixed'?[old[0],facts[0],old[1],facts[1],old[2],facts[2],event]:value==='risks'?[...old,...risks,event]:value==='running'?[...old,{...risks[0],id:'live-call'},facts[0]]:value==='updated'?[...old,{...risks[0],id:'live-call',revision:2,status:'completed',activity:facts[2].activity},facts[0]]:old;
  const working=['mixed','detailed','running','updated'].includes(value);
  running=working;
  const node={...base,revision:prior.revision+1,final:undefined,state:working?'working':'worked',status:value==='risks'?'failed':value==='unknown'?'unknown':value==='interrupted'?'interrupted':working?'running':'completed',items:items.map((item,index)=>({...item,seq:index+1}))};
  f.store.setMeta('publicMainNode:v1:node-89',JSON.stringify(node));
  f.store.db.prepare("UPDATE conversation_messages SET text='',status=? WHERE id='node-89'").run(working?'running':'completed');f.server.publish();
 }
 setScenario(mode);
 return {...f,old,facts,risks,activityReads,setScenario,async connect(page){
  if(!f.server.connectionFile)return;
  // Read only this fixture's ephemeral launcher; never emit its key in evidence.
  const address=new URL(readFileSync(f.server.connectionFile,'utf8').match(/href="([^"]+)"/)[1]);
  assert.equal(address.origin,f.server.url);assert.equal(address.pathname,'/connect');
  await page.command('Page.navigate',{url:address.href});
  await page.until(()=>location.pathname==='/'&&!!sessionStorage.getItem('homer-user-connection'));
 }};
}
