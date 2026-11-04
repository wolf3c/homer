import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './web-history-loading-fixture.js';
import {projectConversation} from '../src/conversation-projection.js';
import {WebHistoryPages} from '../src/web-history-pages.js';

test('bounded pages flatten to the full projection, retain insert order despite reversed clocks',()=>{
 const f=historyFixture(125);try{
  const oracle=projectConversation(f.history.list('synthetic-history'),f.processes.list('synthetic-history'),[]).messages;
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs);const pages=[];let before:string|undefined;
  do{const p=reader.read('synthetic-history',{limit:20,before},true);pages.unshift(p.messages);before=p.before??undefined;}while(before);
  assert.deepEqual(pages.flat(),oracle);
 }finally{f.close();}
});
test('new page path forbids full owners; fixed recent page remains bounded at 10000',()=>{
 for(const n of [20,1000,10000]){const f=historyFixture(n);try{
  const oracle=projectConversation(f.history.list('synthetic-history'),f.processes.list('synthetic-history'),f.inputs.list()).messages;
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs);
  f.history.list=()=>{throw Error('full_history_forbidden');};f.processes.list=()=>{throw Error('full_process_forbidden');};f.inputs.list=()=>{throw Error('full_inbox_forbidden');};
  let rows=0;const prepare=f.store.db.prepare.bind(f.store.db);f.store.db.prepare=sql=>{const s=prepare(sql),all=s.all.bind(s);s.all=((...args:Parameters<typeof all>)=>{const r=all(...args);rows+=r.length;return r;}) as typeof s.all;return s;};
  const p=reader.read('synthetic-history',{limit:40});assert.equal(p.units.length,Math.min(40,n));assert.equal(p.messages.length,Math.min(40,n)*2);assert.ok(rows<1000,`returned rows=${rows}`);
  assert.equal(p.messages[0]!.id,'user-'+Math.max(0,n-40));assert.equal(p.messages.at(-1)!.id,'node-'+(n-1));
  const pages=[];let before:string|undefined;do{const previous=rows,page=reader.read('synthetic-history',{limit:40,before},true);assert.ok(rows-previous<1000);pages.unshift(page.messages);before=page.before??undefined;}while(before);assert.deepEqual(pages.flat(),oracle);
  assert.throws(()=>reader.read('synthetic-history',{limit:81}),/history_limit_invalid/);
 }finally{f.close();}}
});
test('A1-B-A2 crosses pages: user once, continuation and exact public finals stay at original owners',()=>{
 const f=historyFixture(2);try{
  f.processes.start({id:'A2',threadId:'synthetic-history',sourceKind:'user',sourceMessageIds:[],messageId:'A2',replyMessageId:'reply-0'},'A2-turn');f.history.record('A2','synthetic-history','','running');
  f.processes.agent('A2',{turnId:'A2-turn',itemId:'final',phase:'final_answer',text:'同文',completed:true});f.processes.finish('A2','completed','A2-ended');
  f.history.record('publication-one','synthetic-history','同文');f.history.record('publication-two','synthetic-history','同文');
  const oracle=projectConversation(f.history.list('synthetic-history'),f.processes.list('synthetic-history'),[]).messages;
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs);let before:string|undefined;const pages=[];
  do{const p=reader.read('synthetic-history',{limit:1,before},true);pages.unshift(p.messages);before=p.before??undefined;}while(before);
  assert.deepEqual(pages.flat(),oracle);assert.equal(pages.flat().filter(m=>m.id==='user-0').length,1);
  assert.ok(pages.flat().every(m=>!('receipt' in m)));assert.equal(pages.flat().find(m=>m.id==='A2')!.text,'同文');assert.equal(pages.flat().find(m=>m.id==='A2')!.process!.final!.id,'A2-turn:final');assert.ok(!pages.flat().some(m=>m.id==='reply-0'));
  const around=reader.read('synthetic-history',{around:'A2',limit:1});assert.equal(around.messages[0]!.id,'A2');
  assert.throws(()=>reader.read('other-thread',{around:'A2'}),/history_message_not_found/);
 }finally{f.close();}
});

test('TEMP identity updates roll back atomically and rebuild after connection loss; headers defer huge details',()=>{
 const f=historyFixture(20);try{
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs);
  f.store.db.exec('BEGIN');f.processes.start({id:'rollback',threadId:'synthetic-history',sourceKind:'worker',sourceMessageIds:[],messageId:'rollback'},'r');f.history.record('rollback','synthetic-history','rollback');f.store.db.exec('ROLLBACK');
  assert.ok(!reader.read('synthetic-history').units.includes('rollback'));
  const node=f.processes.exact('node-19')!;node.items=[{id:'huge-call',seq:1,revision:1,kind:'tool',category:'host',label:'检查资料',status:'completed',content:{input:{state:'not-recorded'},output:{state:'recorded',value:'x'.repeat(1024*1024)}}}];
  f.store.setMeta('publicMainNode:v1:node-19',JSON.stringify({...node,completedItemIds:[],itemPhases:{}}));
  const page=reader.read('synthetic-history');assert.equal(page.messages.at(-1)!.process!.details,'unloaded');assert.equal(page.messages.at(-1)!.process!.items.length,0);assert.ok(JSON.stringify(page).length<100000);
  assert.equal(reader.process('node-19','synthetic-history').items.length,1);assert.throws(()=>reader.process('node-19','other'),/history_process_not_found/);
 }finally{f.close();}
});

import {homerWebBridge} from '../src/web-homer.js';
import type {Homer} from '../src/service.js';
import {syntheticFile} from './recursive-publication-fixture.js';
function bridgeFixture(f:ReturnType<typeof historyFixture>){
 const reader=new WebHistoryPages(f.history,f.processes,f.inputs);
 const host={...f,webReadEpoch:'synthetic-epoch',webHistoryPages:()=>reader,registerChannelCapabilities(){},onStateChange(){return()=>{};},media:{view(){throw Error('synthetic_no_media');}},conversationControlState:()=>({isRunning:false,activeMessageId:null}),snapshot(){throw Error('full_snapshot_forbidden');},conversationState(){throw Error('full_conversation_forbidden');}};
 return homerWebBridge(host as unknown as Homer);
}
test('new state and off-window receipts do not call full snapshot; received user is formal once',async()=>{
 const f=historyFixture(100);try{
  f.inputs.accept({requestId:'queued',text:'待发送合成消息'});const claimed=f.inputs.claim()!;
  f.store.transaction(()=>{f.processes.start({id:'claimed-node',threadId:'synthetic-history',sourceKind:'user',sourceMessageIds:[claimed.messageId],messageId:'claimed-node',replyMessageId:claimed.replyId},'claimed-turn');f.history.record('claimed-node','synthetic-history','','running');f.inputs.startedInTransaction(claimed.messageId,claimed.revision,'claimed-generation','claimed-turn');});
  const bridge=bridgeFixture(f),state=await bridge.history!.state();
  assert.ok(state.history);assert.equal(state.messages.filter(m=>m.role==='user'&&m.requestId==='queued').length,1);assert.equal(state.queue!.filter(q=>q.input.requestId==='queued').length,0);
  const checked=await bridge.history!.receipts({requestIds:['request-0','queued','missing']});assert.deepEqual(checked.acceptedRequestIds,['request-0','queued']);assert.equal(checked.statuses.at(-1)!.state,'unconfirmed');
  await assert.rejects(bridge.history!.page({readEpoch:'old-epoch',request:{}}),/history_epoch_changed/);
 }finally{f.close();}
});

test('input outcome, cancelled and uncertain sources remain equivalent across every page',()=>{
 const f=historyFixture(2);try{
  f.inputs.accept({requestId:'cancelled-input',text:'取消的合成输入'});f.inputs.cancel({requestId:'cancelled-input',operationId:'cancel-once',expectedRevision:0});
  f.inputs.accept({requestId:'uncertain-input',text:'未确认的合成输入'});const item=f.inputs.claim()!;
  f.store.transaction(()=>{f.inputs.uncertainInTransaction(item.messageId,item.revision);f.history.record('input-outcome:'+item.replyId,'synthetic-history','接收未确认的合成记录','interrupted',item.input.requestId);});
  const oracle=projectConversation(f.history.list('synthetic-history'),f.processes.list('synthetic-history'),f.inputs.list());
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs),pages=[];let before:string|undefined;
  do{const p=reader.read('synthetic-history',{limit:1,before},true);pages.unshift(p.messages);before=p.before??undefined;}while(before);
  assert.deepEqual(pages.flat(),oracle.messages);assert.deepEqual(reader.queuePage().items,oracle.queue);
 }finally{f.close();}
});
test('initialization failure rolls back its whole TEMP schema and leaves original writes usable',()=>{
 const f=historyFixture(2);try{
  f.store.setMeta('publicMainNode:v1:invalid-json','not-json');assert.throws(()=>new WebHistoryPages(f.history,f.processes,f.inputs));
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM sqlite_temp_master WHERE name LIKE 'web_%'").get()!.n,0);
  f.history.record('after-index-failure','synthetic-history','合成原写入仍可用');assert.equal(f.history.message('after-index-failure')!.text,'合成原写入仍可用');
 }finally{f.close();}
});
test('exact hydration drives supplied IDs rather than scanning the thread for ORDER BY',()=>{
 const f=historyFixture(100);try{
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs),prepare=f.store.db.prepare.bind(f.store.db),plans:string[]=[];
  f.store.db.prepare=sql=>{const statement=prepare(sql);if(sql.includes('feedbackValue FROM')){const original=statement.all.bind(statement);statement.all=((...args:Parameters<typeof original>)=>{plans.push(...prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>String(row.detail)));return original(...args);}) as typeof statement.all;}return statement;};
  reader.read('synthetic-history');assert.ok(plans.some(plan=>plan.includes('sqlite_autoindex_conversation_messages_1 (id=?)')),plans.join('\n'));
  assert.ok(!plans.some(plan=>plan.includes('conversation_insert_order (threadId=?)')),plans.join('\n'));
 }finally{f.close();}
});
test('pending tail does not replace formal page; forward cursors invert the previous page',()=>{
 const f=historyFixture(100);try{
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs);
  for(let n=0;n<200;n++)f.inputs.accept({requestId:'tail-'+n,text:'合成待发送 '+n});
  const recent=reader.read('synthetic-history',{limit:20}),older=reader.read('synthetic-history',{limit:20,before:recent.before!}),forward=reader.read('synthetic-history',{limit:20,after:older.after!});
  assert.deepEqual(recent.units,forward.units);assert.equal(recent.units.at(-1),'node-99');
  assert.equal(reader.queuePage().items.length,80);assert.ok(reader.queuePage().after);
  const claimed=f.inputs.claim()!;f.store.transaction(()=>{f.processes.start({id:'tail-node',threadId:'synthetic-history',sourceKind:'user',sourceMessageIds:[claimed.messageId],messageId:'tail-node',replyMessageId:claimed.replyId},'tail-turn');f.history.record('tail-node','synthetic-history','','running');f.inputs.startedInTransaction(claimed.messageId,claimed.revision,'tail-generation','tail-turn');});
  const oracle=projectConversation(f.history.list('synthetic-history'),f.processes.list('synthetic-history'),f.inputs.list());
  const pages=[];let before:string|undefined;do{const p=reader.read('synthetic-history',{limit:20,before},true);pages.unshift(p.messages);before=p.before??undefined;}while(before);
  assert.deepEqual(pages.flat(),oracle.messages);assert.equal(reader.queuePage().items.some(q=>q.input.requestId===claimed.input.requestId),false);
 }finally{f.close();}
});
test('worker relation selects only affected node and dirty acknowledgement rolls back with owner sync',()=>{
 const f=historyFixture(100);try{
  const reader=new WebHistoryPages(f.history,f.processes,f.inputs),node=f.processes.exact('node-0')!;
  node.items=[{id:'worker:target',kind:'worker',seq:1,revision:1,taskId:'target',version:1,taskRevision:1,runId:null,runRevision:null,runStatus:null,resultState:null,epoch:null,phase:null,stopRequested:false,state:'working',controlState:'normal',outcome:null}];
  f.store.setMeta('publicMainNode:v1:node-0',JSON.stringify({...node,completedItemIds:[],itemPhases:{}}));
  f.store.db.prepare('INSERT INTO web_dirty_tasks VALUES(?)').run('target');f.store.db.prepare('INSERT INTO web_dirty_tasks VALUES(?)').run('unrelated');
  const prepare=f.store.db.prepare.bind(f.store.db);let workerPlan:string[]=[];
  f.store.db.prepare=sql=>{if(sql.startsWith('SELECT DISTINCT w.nodeId,w.taskId'))workerPlan=prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>String(row.detail));return prepare(sql);};
  assert.throws(()=>f.store.transaction(()=>{assert.deepEqual(reader.workerTargets().map(({nodeId,taskId})=>[nodeId,taskId]),[['node-0','target']]);throw Error('synthetic_owner_failed');}),/synthetic_owner_failed/);
  assert.deepEqual(reader.workerTargets().map(({nodeId,taskId})=>[nodeId,taskId]),[['node-0','target']]);assert.deepEqual(reader.workerTargets(),[]);
  assert.ok(workerPlan.some(detail=>detail.includes('SEARCH w USING')&&detail.includes('web_process_task')),workerPlan.join('\n'));
  assert.ok(!workerPlan.some(detail=>detail.startsWith('SCAN w')),workerPlan.join('\n'));
 }finally{f.close();}
});
test('page publication keeps every authorized file at its exact original message and revocation removes all',()=>{
 const f=historyFixture(100);try{
  f.store.startRequest('request-0','synthetic-publication-hash');
  const made=syntheticFile(f as unknown as Homer,'request-0','first.md','# First',[{filename:'second.md',content:'# Second'}]),delivery=made.publish();
  f.history.record(delivery.historyMessageId,'synthetic-history',delivery.text);f.tasks.markDelivery(delivery.id,'recorded');
  assert.deepEqual(f.tasks.publishedForMessages([delivery.historyMessageId]).map(file=>file.resultId).sort(),made.resultIds.sort());
  assert.deepEqual(f.tasks.publishedForMessages(['node-99']),[]);
  f.store.db.prepare('UPDATE deliveries SET revokedAt=1 WHERE id=?').run(delivery.id);assert.deepEqual(f.tasks.publishedForMessages([delivery.historyMessageId]),[]);
 }finally{f.close();}
});
test('more than 80 native pending forms retain exact sources; interaction-only changes invalidate the read revision',async()=>{
 const f=historyFixture(100);try{
  const bridge=bridgeFixture(f),before=(await bridge.history!.state()).history!.page.revision;
  for(let n=0;n<81;n++){
   const opened=f.interactions.open({runId:'main-native:synthetic-'+n,threadId:'synthetic-history',turnId:'native-turn-'+n,requestId:n,source:'native',kind:'question',details:{},authority:{sourceRequestId:'request-0',description:'Synthetic native question',nativeApprovals:false}},()=>true);
   f.interactions.escalate(opened.id,'合成待答 '+n,'Synthetic explicit user input needed');
  }
  const state=await bridge.history!.state();assert.equal(state.interactions.length,80);assert.ok(state.history!.moreInteractions);assert.ok(state.history!.page.revision>before);
  assert.equal(state.interactions[0]!.workTitle,'主对话');assert.equal(state.interactions[0]!.sourceMessageId,'user-0');
  const next=await bridge.history!.interactions(state.history!.moreInteractions!);assert.equal(next.items.length,1);assert.equal(next.after,null);
  const ids=f.interactions.list().map(item=>item.id);for(const [n,id]of ids.entries()){if(n%2)f.interactions.expire(id);else f.interactions.cancelRun(f.interactions.inspect(id).runId);}
  const prepare=f.store.db.prepare.bind(f.store.db);let inactivePlan:string[]=[];
  f.store.db.prepare=sql=>{const statement=prepare(sql);if(sql.includes('worker_interactions')&&sql.includes("'cancelled'")&&sql.includes('LIMIT 81')){const all=statement.all.bind(statement);statement.all=((...args:Parameters<typeof all>)=>{inactivePlan=prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>String(row.detail));return all(...args);})as typeof statement.all;}return statement;};
  const inactive=await bridge.history!.page({readEpoch:'synthetic-epoch',request:{around:'node-0'}});assert.equal(inactive.inactiveInteractions!.length,80);assert.equal(inactive.inactiveMore,true);
  assert.deepEqual(inactive.inactiveInteractions!.map(item=>item.id),prepare("SELECT id FROM worker_interactions WHERE json_extract(authority,'$.sourceRequestId')=? AND state IN ('cancelled','expired') ORDER BY rowid LIMIT 80").all('request-0').map(row=>String(row.id)));
  assert.ok(inactivePlan.filter(detail=>detail.startsWith('CO-ROUTINE')).length>=2,inactivePlan.join('\n'));
 }finally{f.close();}
});


test('synthetic streaming updates the public final without replacing commentary',async()=>{
 const {updateSyntheticPublicText}=await import('./web-history-loading-fixture.js'),f=historyFixture(1);
 try{
  const node=f.processes.exact('node-0')!;node.items=[{id:'progress',kind:'commentary',phase:'commentary',seq:1,revision:1,text:'公开进展'}];
  f.store.setMeta('publicMainNode:v1:node-0',JSON.stringify(node));
  assert.equal(updateSyntheticPublicText(f,'node-0','显式正式答复').changes,1);
  const current=f.processes.exact('node-0')!;assert.equal(current.items[0]!.id,'progress');
  assert.equal(current.items[1]!.kind,'commentary');assert.equal((current.items[1] as {phase:string}).phase,'final_answer');
  const state=projectConversation(f.history.list('synthetic-history'),f.processes.list('synthetic-history'),f.inputs.list());
  assert.equal(state.messages.find(message=>message.id==='node-0')!.text,'显式正式答复');
 }finally{f.close();}
});
