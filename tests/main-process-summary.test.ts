import test from 'node:test';
import assert from 'node:assert/strict';
import {MainProcessHistory} from '../src/main-process.js';
import {fixture} from './recursive-fixture.js';

test('ended process summaries retain final and Worker facts without loading ordinary commentary',()=>{
 const f=fixture();try{
  const processes=new MainProcessHistory(f.store.db),body='Synthetic detail '.repeat(65536);
  processes.start({id:'summary',threadId:'synthetic',sourceKind:'user',sourceMessageIds:['input'],messageId:'reply'},'turn');
  processes.agent('summary',{turnId:'turn',itemId:'detail',phase:'commentary',text:body,completed:true});
  processes.agent('summary',{turnId:'turn',itemId:'final',phase:'final_answer',text:'Checked final',completed:true});
  processes.agent('summary',{turnId:'turn',itemId:'streamed-final',phase:'final_answer',text:'Second public final',completed:false});
  processes.worker('summary',{taskId:'worker',version:1,taskRevision:1,runId:'run',runRevision:1,runStatus:'succeeded',resultState:'accepted',epoch:1,state:'settled',controlState:'open',outcome:'succeeded',phase:'ended',stopRequested:false});
  const working=processes.headers(['summary'])[0]!;
  assert.ok(working.items.some(item=>item.kind==='commentary'&&item.text===body));
  processes.finish('summary','completed','turn:turn:completed');
  f.store.db.exec('PRAGMA query_only=ON');
  const changes=f.store.db.prepare('SELECT total_changes() n').get();
  const summary=processes.headers(['summary'])[0]!;
  assert.equal(summary.details,'unloaded');
  assert.ok(Buffer.byteLength(JSON.stringify(summary))<4096);
  assert.deepEqual(summary.items.filter(item=>item.kind==='commentary').map(item=>item.text),['Checked final','Second public final']);
  assert.deepEqual(summary.items.filter(item=>item.kind==='worker'),working.items.filter(item=>item.kind==='worker'));
  for(const detail of [processes.headers(['summary'],true)[0]!,processes.exact('summary')!])
   assert.ok(detail.items.some(item=>item.kind==='commentary'&&item.text===body));
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() n').get(),changes);
 }finally{f.close();}
});
