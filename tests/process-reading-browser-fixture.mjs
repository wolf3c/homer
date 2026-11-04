// RunActivity-only synthetic owners; no service, account or executing engine.
import {fixture} from './web-history-followup-fixture.mjs';
export async function readingFixture(){
 const f=await fixture(90,'after');
 const tools=Array.from({length:8},(_,i)=>({id:'reading-call-'+i,revision:1,seq:i+1,kind:'tool',category:'host',label:i===5?'核对成果':'检查资料',status:'completed'}));
 function save(n,patch){
  const key='publicMainNode:v1:node-'+n,original=JSON.parse(f.store.meta(key));
  f.store.setMeta(key,JSON.stringify({...original,revision:original.revision+1,sourceKind:'worker',replyPolicy:'explicitFinal',replyMessageId:undefined,sourceMessageIds:[],final:undefined,deliveryMessageId:undefined,deliveryMessageIds:undefined,state:'worked',status:'completed',items:[],...patch}));
  f.store.db.prepare("UPDATE conversation_messages SET text='',status='completed' WHERE id=?").run('node-'+n);
 }
 for(const n of [88,89])f.store.db.prepare('DELETE FROM conversation_messages WHERE id IN (?,?)').run('user-'+n,'reply-'+n);
 save(88,{items:tools});save(89,{});
 const setMode=mode=>{
  if(mode!=='streaming')throw Error('unsupported_synthetic_activity_mode');
  save(89,{sourceKind:'user',state:'working',status:'running',startedAtMs:1000,timingState:'running',timingSource:'hostObserved',items:[{id:'reading-progress',kind:'commentary',phase:'commentary',seq:1,revision:1,text:'公开进展：第一部分已核对。'}]});
  f.server.publish();
 };
 return {...f,tools,setMode};
}
