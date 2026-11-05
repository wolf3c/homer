import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MainProcessHistory} from '../src/main-process.js';

test('a publication suppresses duplicate output only for its exact consumed input and body',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
   CREATE TABLE agent_messages(id TEXT PRIMARY KEY,taskId TEXT,recipientAgentId TEXT);
   CREATE TABLE operations(id TEXT PRIMARY KEY,detailsJson TEXT);
   CREATE TABLE deliveries(id TEXT PRIMARY KEY,taskId TEXT,historyMessageId TEXT,operationKey TEXT,state TEXT,text TEXT,revokedAt INTEGER);
   INSERT INTO meta VALUES('mainAgentId','main');
   INSERT INTO agent_messages VALUES('source','task-one','main');
   INSERT INTO operations VALUES('op','{"inputMessageId":"source"}');
   INSERT INTO deliveries VALUES('delivery','task-one','published','op','prepared','Final answer',NULL);`);
  const history=new MainProcessHistory(db);
  history.start({id:'node',threadId:'thread',sourceKind:'worker',sourceMessageIds:['source'],messageId:'reply'},'turn');
  history.delivery('node',{historyMessageId:'published',text:'Final answer'});
  assert.equal(history.hasSourceDelivery('node','source','Final answer'),true);
  assert.equal(history.hasSourceDelivery('node','source','Different answer'),false);
  db.exec("UPDATE operations SET detailsJson='{\"inputMessageId\":\"other-source\"}'");
  assert.equal(history.hasSourceDelivery('node','source','Final answer'),false);
  db.exec("UPDATE operations SET detailsJson='{\"inputMessageId\":\"source\"}'; UPDATE deliveries SET state='uncertain'");
  assert.equal(history.hasSourceDelivery('node','source','Final answer'),true);
  db.exec('UPDATE deliveries SET revokedAt=1');
  assert.equal(history.hasSourceDelivery('node','source','Final answer'),false);
 }finally{db.close();}
});
