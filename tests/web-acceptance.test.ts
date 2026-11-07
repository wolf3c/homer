import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Homer} from '../src/service.js';
import type {ConversationReceipt} from '../src/web-history.js';

// Synthetic contract inputs only. No model/provider connection.
async function fixture(){
  const parent=resolve('.codex/scratch/assistant-ui');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'acceptance-'));
  mkdirSync(join(base,'workspace/materials'),{recursive:true});mkdirSync(join(base,'runtime'));
  const turns:string[]=[];
  class Fake extends EventEmitter{
    threadId='synthetic-atomic-thread';async start(){return this.threadId;}
    async turn(text:string,options?:{onStarted?:(id:string)=>void}){options?.onStarted?.('synthetic-turn-'+turns.length);turns.push(text);return {status:'completed',text:'合成回执'};}
    async interrupt(){return true;}async close(){return true;}
  }
  const app=new Homer({workspace:join(base,'workspace'),runtime:join(base,'runtime'),codexHome:join(base,'home'),nativeCodexHome:join(base,'home'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,timeoutMs:3000,mainTimeoutMs:3000,stopGraceMs:50},async()=>{},()=>new Fake());
  await app.start();await app.idle();
  app.store.db.exec('CREATE TABLE synthetic_channel_sources(requestId TEXT PRIMARY KEY,replyId TEXT NOT NULL,peer TEXT NOT NULL)');
  const rows=()=>app.store.db.prepare('SELECT * FROM synthetic_channel_sources').all();
  const adapter=(peer:string)=>({source:'synthetic_channel',persist(receipt:ConversationReceipt){
    const existing=app.store.db.prepare('SELECT * FROM synthetic_channel_sources WHERE requestId=?').get('channel-input') as {replyId:string;peer:string}|undefined;
    if(!receipt.fresh){if(!existing||existing.peer!==peer||existing.replyId!==receipt.replyId)throw new Error('channel_source_conflict');return;}
    app.store.db.prepare('INSERT INTO synthetic_channel_sources VALUES(?,?,?)').run('channel-input',receipt.replyId,peer);
  }});
  return {app,turns,rows,adapter};
}
test('channel mapping and conversation receipt commit together before main is queued; duplicate validates content and trusted source',async()=>{
  const f=await fixture();try{
    const input={requestId:'channel-input',text:'合成渠道输入'};
    const first=f.app.submitMessage(input,f.adapter('peer-a'));
    assert.equal(f.rows().length,1);assert.equal(f.app.history.list('synthetic-atomic-thread').length,2);assert.equal(f.turns.length,0);
    const before=f.app.conversationState();assert.equal(before.messages.length,0);assert.deepEqual(before.queue.map(row=>row.input.requestId),[input.requestId]);assert.deepEqual(before.acceptedRequestIds,[input.requestId]);
    assert.equal(f.app.submitMessage(input,f.adapter('peer-a')).fresh,false);
    assert.throws(()=>f.app.submitMessage(input,f.adapter('peer-b')),/channel_source_conflict/);
    assert.throws(()=>f.app.submitMessage({...input,text:'改过内容'},f.adapter('peer-a')),/request_id_conflict/);
    assert.throws(()=>f.app.submitMessage(input,{...f.adapter('peer-a'),source:'another_channel'}),/request_id_conflict/);
    assert.equal(f.rows()[0]!.replyId,first.replyId);
    await f.app.idle();assert.equal(f.turns.length,1);assert.equal(f.app.conversationState().messages.filter(m=>m.role==='user'&&m.requestId===input.requestId).length,1);assert.equal(f.app.conversationState().queue.length,0);
  }finally{await f.app.close();}
});
test('failed channel SQL rolls back mapping/history together and never dispatches; channel cannot claim prior Web or CLI request',async()=>{
  const f=await fixture();try{
    assert.throws(()=>f.app.submitMessage({requestId:'channel-input',text:'合成失败输入'},{source:'synthetic_channel',persist(receipt){f.adapter('peer-a').persist(receipt);throw new Error('synthetic_sql_failed');}}),/synthetic_sql_failed/);
    assert.equal(f.rows().length,0);assert.equal(f.app.conversationState().messages.length,0);await f.app.idle();assert.equal(f.turns.length,0);
    assert.throws(()=>f.app.submitMessage({requestId:'async-hook',text:'合成同步边界'},{source:'synthetic_channel',persist:()=>Promise.resolve()}),/accept_hook_must_be_synchronous/);
    assert.equal(f.app.conversationState().messages.length,0);
    await f.app.message('合成原本地输入','channel-input');
    let called=false;
    assert.throws(()=>f.app.submitMessage({requestId:'channel-input',text:'合成原本地输入'},{source:'synthetic_channel',persist(){called=true;}}),/request_id_conflict/);
    assert.equal(called,false);assert.equal(f.rows().length,0);assert.equal(f.turns.length,1);
  }finally{await f.app.close();}
});

test('multi-quote channel acceptance keeps mapping atomic and checks duplicate origin before dispatch',async()=>{
  const f=await fixture();try{
    const source=f.app.history.add('synthetic-atomic-thread','合成渠道引用原文');
    const input={requestId:'channel-input',text:'',quotes:[{messageId:source,text:'引用原文',annotation:'合成独立批注'}]};
    assert.throws(()=>f.app.submitMessage(input,{source:'synthetic_channel',persist(receipt){f.adapter('peer-a').persist(receipt);throw new Error('synthetic_sql_failed');}}),/synthetic_sql_failed/);
    assert.equal(f.rows().length,0);assert.equal(f.app.conversationState().messages.length,1);
    await f.app.idle();assert.equal(f.turns.length,0);
    f.app.submitMessage(input,f.adapter('peer-a'));
    assert.equal(f.rows().length,1);
    assert.equal(f.app.submitMessage(input,f.adapter('peer-a')).fresh,false);
    assert.throws(()=>f.app.submitMessage(input,f.adapter('peer-b')),/channel_source_conflict/);
    await f.app.idle();assert.equal(f.turns.length,1);
  }finally{await f.app.close();}
});
