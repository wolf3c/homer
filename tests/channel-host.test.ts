import assert from 'node:assert/strict';
import {mcpCall} from './fixtures/host-mcp-call.js';
import test from 'node:test';
import {fixture} from './fixtures/worker-chat-host.js';

test('scoped catch-up returns all confirmed replies, filters revoked and unrelated rows', async () => {
  const f = fixture();
  try {
    f.setScript(async (main, text) => {
      if (text === 'multi') {
        await main.call('send_user_message', {text: 'First'});
        await main.call('send_user_message', {text: 'Second'});
      }
      return {status:'completed', text:'Normal'};
    });
    await f.app.start();
    await f.app.message('multi', 'channel-multi');
    await f.app.message('other', 'channel-other');
    const page = f.app.listCommittedMessages({requestId:'channel-multi'});
    assert.deepEqual(page.items.map(item => 'text' in item && item.text), ['First', 'Second']);
    assert.deepEqual(f.app.listCommittedMessages({taskId:'other'}).items, []);
    assert.equal(f.app.readCommittedMessage(page.items[0]!.messageId, {requestId:'channel-other'}), undefined);
    f.app.history.revokeMessage(f.app.store.meta('mainThread')!, page.items[0]!.messageId);
    assert.deepEqual(f.app.listCommittedMessages({requestId:'channel-multi'}).items.map(item=>item.messageId), [page.items[1]!.messageId]);
    f.app.store.db.exec('BEGIN IMMEDIATE');
    try { assert.throws(() => f.app.listCommittedMessages({requestId:'channel-multi'}), /committed_read_unavailable/); }
    finally { f.app.store.db.exec('ROLLBACK'); }
  } finally { await f.close(); }
});

test('scoped enumeration continues after a full page without duplicating message IDs', async () => {
  const f=fixture();
  try {
    f.setScript(async main=>{
      for(let index=0;index<66;index++)await main.call('send_user_message',{text:'Part '+index});
      return {status:'completed',text:''};
    });
    await f.app.start();
    await f.app.message('multi','channel-paged');
    const scope={requestId:'channel-paged'};
    const first=f.app.listCommittedMessages(scope);
    assert.equal(first.items.length,64);
    assert.notEqual(first.after,null);
    const last=f.app.listCommittedMessages(scope,first.after!);
    assert.equal(last.after,null);
    const items=[...first.items,...last.items];
    assert.equal(new Set(items.map(item=>item.messageId)).size,66);
    assert.deepEqual(items.map(item=>'text' in item&&item.text),Array.from({length:66},(_,index)=>'Part '+index));
  } finally { await f.close(); }
});

test('plugin tools accept a matched live Main call once and inject its real request', async () => {
  const f = fixture();
  try {
    let writes = 0;
    let previous: {callId:string;'x-codex-turn-metadata':{turn_id:string|undefined}}|undefined;
    const name = 'test_subscription';
    f.app.registerMainPluginTool({type:'function', name, description:'Synthetic subscription',
      inputSchema:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false}},
      (_args, {requestId}) => ({requestId, writes: ++writes}));
    f.setScript(async (main,text) => {
      const socket = main.options.interactionMcp!.args[main.options.interactionMcp!.args.indexOf('main')-1]!;
      const args = {taskId:'task-a'}, meta = {callId:'item-a', 'x-codex-turn-metadata':{turn_id:main.turnId}};
      if(text==='later'){
        assert.equal((await mcpCall(socket,name,args,previous)).error,'plugin_tool_scope_denied');
        return {status:'completed',text:'Done'};
      }
      previous=meta;
      assert.equal((await mcpCall(socket,name,args)).error, 'plugin_tool_scope_denied');
      const first = mcpCall(socket,name,args,meta);
      setTimeout(() => main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId:'item-a',tool:name,arguments:args}), 15);
      assert.deepEqual((await first).result,{requestId:'trusted-input',writes:1});
      assert.equal((await mcpCall(socket,name,args,meta)).error, 'plugin_tool_scope_denied');
      main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId:'item-b',tool:name,arguments:args});
      assert.equal((await mcpCall(socket,name,{taskId:'task-b'},{...meta,callId:'item-b'})).error, 'plugin_tool_scope_denied');
      return {status:'completed',text:'Done'};
    });
    await f.app.start();
    assert.ok(f.engines[0]!.options.interactionMcp!.catalog!.some(t=>t.name===name));
    await f.app.message('subscribe','trusted-input');
    await f.app.message('later','another-input');
    assert.equal(writes,1);
  } finally { await f.close(); }
});
