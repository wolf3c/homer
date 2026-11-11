import {commitSyntheticMessage} from './fixtures/synthetic-message.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {MainProcessHistory} from '../src/main-process.js';
import {projectConversation} from '../src/conversation-projection.js';
import {unconfirmedInputs} from '../ui/conversation-client.js';
function fixture(){
 mkdirSync(resolve('.codex/scratch/conversation-projection-implementation'),{recursive:true});
 const root=mkdtempSync(resolve('.codex/scratch/conversation-projection-implementation/sqlite-'));
 const store=new Store(join(root,'synthetic.sqlite'));new WorkerInteractions(store.db);
 const history=new ConversationHistory(store.db),tasks=new RecursiveTasks(store,new Files(join(root,'workspace')));tasks.migrate();store.setMeta('mainThread','synthetic');
 const inputs=new MainInputs(tasks,history),processes=new MainProcessHistory(store.db);
 const state=()=>projectConversation(history.list('synthetic'),processes.list('synthetic'),inputs.list());
 const accepted=()=>history.acceptedRequestIds('synthetic');
 function ack(item:ReturnType<MainInputs['claim']>,id:string){assert.ok(item);store.transaction(()=>{
  processes.start({id,threadId:'synthetic',sourceKind:'user',sourceMessageIds:[item.messageId],messageId:id,replyMessageId:item.replyId},id+'-turn');history.record(id,'synthetic','','running');
  inputs.startedInTransaction(item.messageId,item.revision,'generation-'+item.input.requestId,id+'-turn');
 });}
 return{root,store,history,inputs,processes,tasks,state,accepted,ack,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
test('B: pending is a separate queue; edit/cancel, claim lock and exact ACK move the original identity once',()=>{
 const f=fixture();try{
 f.inputs.accept({requestId:'A',text:'整理方案'});const a=f.inputs.claim()!;f.ack(a,'A1');
 f.inputs.accept({requestId:'B',text:'查资料'});f.inputs.accept({requestId:'C',text:'核对进度'});
 const b=f.inputs.list()[1]!,c=f.inputs.list()[2]!,userB=f.history.inputs('synthetic',['B']).get('B')!;
 assert.deepEqual(f.state().messages.map(m=>m.id),[f.history.inputs('synthetic',['A']).get('A')!.id,'A1']);
 assert.deepEqual(f.state().queue.map(q=>q.input.requestId),['B','C']);
 const edit={requestId:'B',operationId:'edit-B',expectedRevision:b.revision,input:{...b.input,text:'查最新资料'}};f.inputs.edit(edit);f.inputs.edit(edit);
 f.inputs.cancel({requestId:'C',operationId:'cancel-C',expectedRevision:c.revision});f.inputs.accept(c.input);
 assert.deepEqual(f.accepted(),['A','B','C']);assert.deepEqual(unconfirmedInputs([{input:b.input},{input:c.input},{input:{requestId:'D',text:'查资料'}}],f.accepted()).map(item=>item.input.requestId),['D']);assert.deepEqual(f.state().queue.map(q=>q.input.text),['查最新资料']);
 f.processes.finish('A1','completed','turn:A:terminal:completed');f.inputs.finish(a.messageId,a.revision,'completed');
 const claimed=f.inputs.claim()!;assert.equal(claimed.input.text,'查最新资料');assert.equal(f.state().queue[0]!.editable,false);
 assert.throws(()=>f.inputs.edit({...edit,operationId:'late'}),/processing/);assert.throws(()=>f.inputs.cancel({requestId:'B',operationId:'late-cancel',expectedRevision:claimed.revision}),/processing/);
 f.ack(claimed,'B1');assert.equal(f.state().queue.length,0);assert.deepEqual(f.state().messages.map(m=>m.id),[f.history.inputs('synthetic',['A']).get('A')!.id,'A1',userB.id,'B1']);
 assert.equal(f.state().messages.find(m=>m.id===userB.id)?.text,'查最新资料');
 }finally{f.close();}
});
test('ACK local failure rolls node/history/receipt back together, then uncertain never replays on persistent reopen',()=>{
 const f=fixture();try{
 f.inputs.accept({requestId:'B',text:'查资料'});const b=f.inputs.claim()!;
 f.store.db.exec("CREATE TEMP TRIGGER fail_ack BEFORE UPDATE OF state ON agent_receipts WHEN NEW.state='received' BEGIN SELECT RAISE(ABORT,'synthetic_ack_db_failure'); END");
 assert.throws(()=>f.ack(b,'B1'),/synthetic_ack_db_failure/);assert.equal(f.processes.list('synthetic').length,0);assert.ok(!f.history.list('synthetic').some(m=>m.id==='B1'));assert.equal(f.inputs.list()[0]!.state,'processing');
 f.store.db.exec('DROP TRIGGER fail_ack');assert.equal(f.inputs.uncertain(b.messageId,b.revision),true);const revision=f.inputs.list()[0]!.revision;
 f.inputs.reconcile();f.inputs.reconcile();assert.equal(f.inputs.list()[0]!.revision,revision);assert.equal(f.inputs.claim(),undefined);
 assert.equal(f.state().messages.length,0);assert.equal(f.state().queue[0]!.state,'uncertain');assert.equal(f.state().queue[0]!.editable,false);
 const reopened=new Store(join(f.root,'synthetic.sqlite'));try{const again=new MainInputs(new RecursiveTasks(reopened,new Files(join(f.root,'workspace'))),new ConversationHistory(reopened.db));again.reconcile();assert.equal(again.list()[0]!.state,'uncertain');assert.equal(again.claim(),undefined);}finally{reopened.close();}
 }finally{f.close();}
});
test('formal scan preserves explicit message text, final identity and A1 B A2 without node.seq sorting',()=>{
 const f=fixture();try{
 f.inputs.accept({requestId:'A',text:'same text'});const a=f.inputs.claim()!;f.ack(a,'A1');
 f.processes.agent('A1',{turnId:'A1-turn',itemId:'earlier',phase:'final_answer',text:'Earlier public answer',completed:true});
 f.processes.agent('A1',{turnId:'A1-turn',itemId:'final',phase:'final_answer',text:'Final answer',completed:true});
 f.history.finish(a.replyId,'Earlier public answer\n\nFinal answer','completed');
 const sent=commitSyntheticMessage(f,'synthetic','Original explicit message');f.processes.finish('A1','completed','turn:A:terminal:completed');
 f.inputs.finish(a.messageId,a.revision,'completed');f.inputs.accept({requestId:'B',text:'same text'});const b=f.inputs.claim()!;f.ack(b,'B1');f.inputs.finish(b.messageId,b.revision,'completed');
 f.processes.start({id:'A2',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[a.messageId],messageId:'A2',replyMessageId:a.replyId},'A2-turn');f.history.record('A2','synthetic','','running');
 const stored=f.store.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:A1')!;f.store.db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify({...JSON.parse(String(stored.value)),seq:50}),'publicMainNode:v1:A1');
 const state=f.state();assert.ok(state.orderWarning);assert.equal(state.messages[1]?.id,'A1');assert.equal(state.messages.filter(m=>m.role==='user'&&m.requestId==='A').length,1);assert.equal(state.messages.filter(m=>m.role==='user').length,2);
 assert.equal(state.messages.find(m=>m.id===sent.messageId)?.text,'Original explicit message');assert.match(state.messages.at(-1)!.sourceLabel!,/继续处理/);
 const node=f.processes.list('synthetic').find(node=>node.id==='A1')!;assert.equal(node.final?.text,'Final answer');assert.equal(node.items.length,2,'store retains all public items');assert.ok(node.items[0]?.kind==='commentary');assert.equal(node.items[0].phase,'final_answer');
 const rendered=state.messages.find(m=>m.id==='A1')!;assert.equal(rendered.text,'Earlier public answer\n\nFinal answer');assert.deepEqual(rendered.finalAnswers?.map(item=>item.id),['A1-turn:earlier','A1-turn:final']);assert.deepEqual(rendered.process!.items.map(item=>item.id),['A1-turn:earlier','A1-turn:final'],'source items survive projection; the adapter renders each once');
 assert.ok(!state.messages.some(message=>message.id===a.replyId));assert.equal(f.history.message(a.replyId)?.text,'Earlier public answer\n\nFinal answer','aggregate receipt remains stored');
 }finally{f.close();}
});
test('74 terminal queue records and legacy replies stay in history; similar inputs keep distinct identities',()=>{
 const f=fixture();try{for(let i=0;i<74;i++){f.inputs.accept({requestId:'old-'+i,text:'Similar synthetic input '+i});const item=f.inputs.claim()!;f.history.finish(item.replyId,'Legacy reply '+i,'completed');f.inputs.finish(item.messageId,item.revision,i<69?'completed':'failed');}
 const before=f.history.list('synthetic');const state=f.state();assert.deepEqual(state.messages.map(m=>m.id),before.map(m=>m.id));assert.equal(state.queue.length,0);assert.equal(new Set(state.messages.map(m=>m.id)).size,148);
 }finally{f.close();}
});
test('preparing inputs remain editable until claim and retain their original ACK',()=>{
 const f=fixture();try{
  let ready=false;
  const inputs=new MainInputs(f.tasks,f.history,undefined,{claim:()=>{},readiness:()=>ready?'ready':'preparing'});
  inputs.accept({requestId:'prepare',text:'合成附件准备'});let item=inputs.list()[0]!;assert.equal(item.preparation,'preparing');assert.equal(item.editable,true);assert.equal(inputs.claim(),undefined);
  inputs.edit({requestId:'prepare',operationId:'prepare-edit',expectedRevision:item.revision,input:{requestId:'prepare',text:'合成新版'}});item=inputs.list()[0]!;
  ready=true;const claimed=inputs.claim()!;assert.equal(inputs.list()[0]!.editable,false);assert.throws(()=>inputs.cancel({requestId:'prepare',operationId:'claimed-cancel',expectedRevision:claimed.revision}),/queue_input_processing/);f.ack(claimed,'prepare1');
  assert.equal(f.store.db.prepare('SELECT offeredTurnId FROM agent_receipts WHERE messageId=?').get(claimed.messageId)?.offeredTurnId,'generation-prepare');
  assert.throws(()=>f.ack(claimed,'duplicate-ack'),/revision/);
 }finally{f.close();}
});
test('insertion order survives clock rollback, no-final host text survives unknown, same text publications remain distinct',()=>{
 const f=fixture();try{
  f.history.record('first','synthetic','同文');f.history.record('second','synthetic','同文');f.store.db.prepare('UPDATE conversation_messages SET createdAt=-1 WHERE id=?').run('second');
  f.processes.start({id:'no-final',threadId:'synthetic',sourceKind:'worker',sourceMessageIds:[],messageId:'no-final'},'turn');f.history.record('no-final','synthetic','公开历史正文','running');f.processes.finish('no-final','unknown');
  assert.deepEqual(f.state().messages.map(m=>m.id),['first','second','no-final']);assert.equal(f.state().messages.at(-1)!.text,'公开历史正文');assert.equal(f.state().messages.at(-1)!.status,'interrupted');
 }finally{f.close();}
});
test('a resumed attempt with no ACK appends its own host outcome and does not duplicate the original user or change the ended node',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'A',text:'继续整理方案'});const a=f.inputs.claim()!;f.ack(a,'A1');f.processes.agent('A1',{turnId:'A1-turn',itemId:'final',phase:'final_answer',text:'A1 公开答复',completed:true});f.processes.finish('A1','completed','turn:A1:terminal:completed');const before=JSON.stringify(f.processes.list('synthetic')[0]);
  f.history.record('worker-late','synthetic','晚到的正式交付');f.inputs.uncertain(a.messageId,a.revision);f.history.record('input-outcome:'+a.replyId,'synthetic','继续送交时接收未确认','interrupted','A');
  const state=f.state();assert.deepEqual(state.messages.map(m=>m.id),[f.history.inputs('synthetic',['A']).get('A')!.id,'A1','worker-late','input-outcome:'+a.replyId]);assert.equal(state.messages.at(-1)?.source,undefined);assert.equal(JSON.stringify(f.processes.list('synthetic')[0]),before);
 }finally{f.close();}
});
test('legacy host fallback stays readable without masquerading as native final; public phase and publication identity never dedupe by text',()=>{
 const f=fixture();try{
  f.processes.start({id:'old-host',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'old-host'},'old-turn');f.history.record('old-host','synthetic','旧宿主失败原文','failed');
  const row=f.store.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:old-host')!;const stored=JSON.parse(String(row.value));stored.state='worked';stored.status='failed';stored.final={id:'old-host',text:'旧宿主失败原文'};f.store.db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(stored),'publicMainNode:v1:old-host');
  const legacy=f.state().messages[0]!;assert.equal(legacy.process?.final?.id,'old-host');assert.equal(legacy.text,'旧宿主失败原文');
  f.inputs.accept({requestId:'no-final',text:'历史请求'});const input=f.inputs.claim()!;f.ack(input,'no-final-node');f.processes.finish('no-final-node','failed','turn:no-final:failed');f.history.finish(input.replyId,'历史唯一宿主答复','failed');f.inputs.finish(input.messageId,input.revision,'failed');
  assert.equal(f.state().messages.find(message=>message.id===input.replyId)?.text,'历史唯一宿主答复');
  f.processes.start({id:'native',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'native'},'new-turn');f.history.record('native','synthetic','','running');
  f.processes.agent('native',{turnId:'new-turn',itemId:'unknown',phase:'future_phase',text:'EXPLICIT_UNKNOWN_PHASE',completed:true});
  f.processes.agent('native',{turnId:'new-turn',itemId:'final',phase:'final_answer',text:'同文',completed:true});f.processes.finish('native','completed','turn:new:terminal:completed');
  f.history.record('publication-one','synthetic','同文');f.history.record('publication-two','synthetic','同文');const state=f.state();assert.equal(state.messages.filter(m=>m.text==='同文').length,3);assert.deepEqual(state.messages.find(m=>m.id==='native')?.process?.items.map(item=>item.id),['new-turn:final']);assert.ok(!JSON.stringify(state).includes('EXPLICIT_UNKNOWN_PHASE'));assert.ok(String(f.store.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:native')!.value).includes('EXPLICIT_UNKNOWN_PHASE'));
 }finally{f.close();}
});

test('explicit final streams in one body slot, completed text repairs delta and failure stays failed',()=>{
 const f=fixture();try{
  f.inputs.accept({requestId:'stream',text:'合成流式请求'});const input=f.inputs.claim()!;f.ack(input,'stream-node');
  const event={turnId:'stream-node-turn',itemId:'final',phase:'final_answer'};
  f.processes.agent('stream-node',{...event,delta:'旧草稿',completed:false});
  let message=f.state().messages.find(item=>item.id==='stream-node')!;
  assert.equal(message.text,'旧草稿');assert.equal(message.status,'running');assert.equal(message.finalAnswers?.[0]?.completed,false);assert.deepEqual(message.process?.items.map(item=>item.id),['stream-node-turn:final']);
  f.processes.agent('stream-node',{...event,text:'完整校正文',completed:true});
  message=f.state().messages.find(item=>item.id==='stream-node')!;assert.equal(message.text,'完整校正文');assert.equal(message.status,'running');
  f.processes.agent('stream-node',{...event,text:'重复终态',completed:true});f.processes.agent('stream-node',{...event,phase:'partial_answer',text:'PRIVATE_PARTIAL',completed:true});
  f.processes.finish('stream-node','failed','failed-terminal');message=f.state().messages.find(item=>item.id==='stream-node')!;
  assert.equal(message.status,'failed');assert.equal(message.text,'完整校正文');assert.equal(message.finalAnswers?.length,1);assert.ok(!JSON.stringify(f.state()).includes('PRIVATE_PARTIAL'));
 }finally{f.close();}
});
