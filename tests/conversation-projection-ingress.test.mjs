import {readTestConversation} from './fixtures/read-test-conversation.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syntheticHost} from '../scripts/recursive-synthetic-host.ts';
import {homerWebBridge} from '../src/web-homer.js';
import {IngressJournal} from '../scripts/dev-ingress.mjs';
import {unconfirmedInputs} from '../ui/conversation-client.ts';

test('lost transport/business receipts keep exact acceptance identity, execute once and never revive a cancelled queue input',async()=>{
 const f=syntheticHost();let journal;
 try{
  await f.app.start();journal=new IngressJournal(f.app.config.runtime,'synthetic-projection-binding');
  journal.bindContract('synthetic-projection-contract');journal.bindThread(f.app.store.meta('mainThread'));
  const input={requestId:'synthetic-lost-business-ack',text:'合成接收身份'};
  const stored=journal.store(input);assert.equal(stored.accepted,false);assert.equal(f.app.inputs.list().length,0,'transport storage is not business acceptance');
  const accepted=f.app.submitMessage(input);await f.app.idle();assert.equal(accepted.fresh,true);journal.close();
  journal=new IngressJournal(f.app.config.runtime,'synthetic-projection-binding');const retry=f.app.submitMessage(journal.pending()[0].input);await f.app.idle();assert.equal(retry.fresh,false);assert.equal(retry.replyId,accepted.replyId);assert.equal(f.seen.filter(text=>text===input.text).length,1);journal.acknowledge(input.requestId);
  const cancelled={requestId:'synthetic-cancelled-ack',text:'合成取消项'};journal.store(cancelled);f.app.inputs.accept(cancelled);const queue=f.app.inputs.list().find(item=>item.input.requestId===cancelled.requestId);f.app.inputs.cancel({requestId:cancelled.requestId,operationId:'synthetic-cancel',expectedRevision:queue.revision});
  assert.equal(f.app.inputs.accept(journal.pending()[0].input).fresh,false);journal.acknowledge(cancelled.requestId);
  const state=readTestConversation(f.app);assert.deepEqual(unconfirmedInputs([{input},{input:cancelled}],(await homerWebBridge(f.app).history.receipts({requestIds:[input.requestId,cancelled.requestId]})).acceptedRequestIds),[]);assert.equal(state.queue.length,0);assert.ok(!state.messages.some(message=>message.requestId===cancelled.requestId));assert.equal(f.app.inputs.list().find(item=>item.input.requestId===cancelled.requestId).state,'cancelled');assert.equal(f.seen.length,1);
 }finally{journal?.close();await f.close();}
});
