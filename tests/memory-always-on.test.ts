import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {ConversationHistory} from '../src/web-history.js';
import {Memory} from '../src/memory.js';
test('HMR-MEMORY-ALWAYS-01 rejects disable and pause before legacy idempotent receipts can bypass policy',()=>{
 const store=new Store(':memory:');new ConversationHistory(store.db);const memory=new Memory(store);
 try{const before=memory.settings();for(const change of [{enabled:false},{autoSave:false}])assert.throws(()=>memory.configure({operationId:'deny',expectedRevision:before.revision,...change}),/memory_always_on/);assert.deepEqual(memory.settings(),before);}
 finally{store.close();}
});
test('HMR-MEMORY-ALWAYS-02 legacy disabled settings recover once with epoch fence, preserving entries and owner',()=>{
 const store=new Store(':memory:');new ConversationHistory(store.db);const memory=new Memory(store);
 try{const owner=memory.ownerId;store.db.prepare('UPDATE memory_settings SET enabled=0,autoSave=0 WHERE ownerId=?').run(owner);
  const before=memory.settings();const restored=new Memory(store);assert.equal(restored.ownerId,owner);assert.equal(restored.settings().enabled,true);assert.equal(restored.settings().autoSave,true);assert.equal(restored.settings().epoch,before.epoch+1);
  assert.deepEqual(new Memory(store).settings(),restored.settings());
 }finally{store.close();}
});
