import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,until} from './fixtures/worker-chat-host.js';
import {mcpCall} from './fixtures/host-mcp-call.js';
import {ChannelPlugin} from '../src/channel-plugin.js';

async function call(peer:any,name:string,args:unknown,id:string){
  const role=peer.options.role==='worker'?'worker':'main';
  const socket=peer.options.interactionMcp.args[peer.options.interactionMcp.args.indexOf(role)-1];
  peer.emit('hostMcpToolStarted',{threadId:peer.threadId,turnId:peer.turnId,itemId:id,tool:name,arguments:args});
  return mcpCall(socket,name,args,{callId:id,'x-codex-turn-metadata':{turn_id:peer.turnId}});
}

test('Main four schedule tools authenticate calls and recover committed receipts without IDs',async()=>{
  const f=fixture();
  try{
    f.setScript(async main=>{
      const args={text:'Inspect the report',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}};
      const first=await call(main,'schedule_create',args,'scheduled-create');
      assert.equal(first.error,undefined);
      const result=first.result as any;
      assert.ok(result.scheduleId);
      assert.deepEqual((await call(main,'schedule_create',args,'scheduled-create')).result,result);
      const other=(await call(main,'schedule_create',args,'independent-create')).result as any;
      assert.notEqual(other.scheduleId,result.scheduleId);
      const receipts=(await call(main,'schedule_list',{receipts:true},'recover-receipts')).result as any;
      assert.equal(receipts.items.length,2);
      assert.ok(receipts.items.some((item:any)=>item.response.scheduleId===result.scheduleId));
      const updated=(await call(main,'schedule_update',{scheduleId:result.scheduleId,expectedRevision:result.revision,text:'Inspect updated report'},'update-schedule')).result as any;
      assert.equal(updated.text,'Inspect updated report');
      const cancelled=(await call(main,'schedule_cancel',{scheduleId:updated.scheduleId,expectedRevision:updated.revision},'cancel-schedule')).result as any;
      assert.equal(cancelled.enabled,false);
      return {status:'completed',text:'Scheduled'};
    });
    await f.app.start();assert.equal(await f.app.message('Set up the ongoing report','schedule-source'),'Scheduled');
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM schedules').get()!.n,2);
  }finally{await f.close();}
});

test('Worker shares all four tools and its completed turn does not revoke a reminder',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture();let firstId='';
  try{
    f.setScript(async(main,text)=>{
      if(text==='Delegate reminder')await main.call('worker_open',{message:'Arrange the authorized reminder'});
      return {status:'completed',text:'Delegated'};
    });
    await f.app.start();await f.app.message('Delegate reminder','worker-reminder-source');
    await until(()=>f.engines.some(peer=>peer.options.role==='worker'&&peer.finish));
    const worker=f.engines.find(peer=>peer.options.role==='worker')!;
    const created=(await call(worker,'schedule_create',{text:'Worker future reminder',trigger:{at:new Date(Date.now()+60000).toISOString()}},'worker-create')).result as any;
    assert.ok(created.scheduleId);firstId=created.scheduleId;
    const changed=(await call(worker,'schedule_update',{scheduleId:firstId,expectedRevision:created.revision,text:'Worker updated reminder'},'worker-update')).result as any;
    assert.equal(changed.text,'Worker updated reminder');
    const list=(await call(worker,'schedule_list',{receipts:true},'worker-receipts')).result as any;
    assert.equal(list.items.length,2);
    const other=(await call(worker,'schedule_create',{text:'Cancel this reminder',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}},'worker-second')).result as any;
    assert.equal(((await call(worker,'schedule_cancel',{scheduleId:other.scheduleId,expectedRevision:other.revision},'worker-cancel')).result as any).enabled,false);
    worker.finish!({status:'completed',text:'Reminder set',messages:[]});await f.app.idle();
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    assert.ok(f.inputs.some(text=>text.includes('[定时消息正文]\nWorker updated reminder')));
    assert.equal(f.app.schedules.get(firstId).enabled,false);
  }finally{await f.close();}
});

test('Worker cannot read receipts or change schedules owned by another delegation',async()=>{
  const f=fixture();
  try{
    f.setScript(async main=>{await main.call('worker_open',{message:'First delegation'});await main.call('worker_open',{message:'Second delegation'});return {status:'completed',text:'Delegated'};});
    await f.app.start();await f.app.message('Delegate two independent scopes','scope-source');
    await until(()=>f.engines.filter(peer=>peer.options.role==='worker'&&peer.finish).length===2);
    const [first,second]=f.engines.filter(peer=>peer.options.role==='worker');
    const created=(await call(first,'schedule_create',{text:'Only first delegate can change this',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}},'own-create')).result as any;
    assert.ok(created.scheduleId);
    assert.deepEqual(((await call(second,'schedule_list',{receipts:true},'other-receipts')).result as any).items,[]);
    assert.deepEqual(((await call(second,'schedule_list',{scheduleId:created.scheduleId},'other-list')).result as any).items,[]);
    assert.equal((await call(second,'schedule_update',{scheduleId:created.scheduleId,expectedRevision:created.revision,text:'Unrelated scope'},'other-update')).error,'schedule_scope_denied');
  }finally{await f.close();}
});

test('a later real user body change binds its new source while model-supplied source fields are rejected',async()=>{
  const f=fixture();let record:any;
  try{
    f.setScript(async(main,text)=>{
      if(text==='Original recurring task')record=(await call(main,'schedule_create',{text:'Original authorized body',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}},'body-create')).result;
      else{
        assert.equal((await call(main,'schedule_update',{scheduleId:record.scheduleId,expectedRevision:record.revision,text:'Injected body',sourceRef:'forged'},'forged-source')).error,'invalid_tool_arguments');
        record=(await call(main,'schedule_update',{scheduleId:record.scheduleId,expectedRevision:record.revision,text:'Newly authorized body'},'new-user-body')).result;
      }
      return {status:'completed',text:'Updated'};
    });
    await f.app.start();assert.equal(await f.app.message('Original recurring task','original-body-source'),'Updated');
    assert.equal(await f.app.message('Change body within this new request','new-body-source'),'Updated');
    const ref=JSON.parse(f.app.schedules.get(record.scheduleId).sourceRef);
    assert.equal(ref.authority.sourceRequestId,'new-body-source');
  }finally{await f.close();}
});

test('startup failure closes the scheduler before closing its storage',async()=>{
  const f=fixture(undefined,async()=>{throw Error('synthetic_engine_unavailable');});
  try{
    await assert.rejects(f.app.start(),/synthetic_engine_unavailable/);
    assert.throws(()=>f.app.schedules.create({text:'No timer after close',trigger:{at:new Date(Date.now()+60000).toISOString()},sourceRef:'unused'}),/schedules_closed/);
  }finally{await f.close();}
});

test('a model-source switch keeps old reminders paused across consecutive same-source restarts',async()=>{
  const f=fixture();let record:any,consumed=0;
  try{
    Object.assign(f.app.config,{pauseOldDesktopWork:true,desktopModelSource:'codex',desktopResources:{bundleRoot:f.app.config.runtime,manifestSha256:'a'.repeat(64)}});await f.restart();
    f.setScript(async(main,text)=>{
      if(text==='Set original ongoing reminder')record=(await call(main,'schedule_create',{text:'Old-source reminder',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}},'before-source-switch')).result;
      else if(text.includes('[定时消息正文]\nOld-source reminder'))consumed++;
      return {status:'completed',text:'Recorded'};
    });
    await f.app.message('Set original ongoing reminder','before-source-switch');assert.ok(record.scheduleId);
    Object.assign(f.app.config,{desktopModelSource:'website'});await f.restart();
    f.app.store.transaction(()=>f.app.inputs.enqueueScheduled({deliveryId:'paused-source-change',scheduleId:record.scheduleId,scheduledAt:Date.now(),text:'Old-source reminder',sourceRef:f.app.schedules.get(record.scheduleId).sourceRef}));
    f.app.recheckScheduledMessages();await f.app.idle();assert.equal(consumed,0);
    await f.restart();await f.app.idle();assert.equal(consumed,0);
    await f.app.message('Confirm original ongoing reminder','current-owner-confirmation');await f.app.idle();assert.equal(consumed,1);
  }finally{await f.close();}
});

test('lost complete create response is recovered after restart without knowing schedule or native IDs',async()=>{
  const f=fixture();let oldMeta:unknown;
  try{
    f.setScript(async(main,text)=>{
      if(text==='Create then lose response'){
        oldMeta={callId:'lost-create','x-codex-turn-metadata':{turn_id:main.turnId}};
        await call(main,'schedule_create',{text:'Durable future reminder',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}},'lost-create');
      }else if(text==='Recover original receipt'){
        const recovered=(await call(main,'schedule_list',{receipts:true},'new-recovery-call')).result as any;
        assert.equal(recovered.items.length,1);assert.equal(recovered.items[0].callId,'lost-create');
        assert.ok(recovered.items[0].response.scheduleId);
        const socket=main.options.interactionMcp!.args[main.options.interactionMcp!.args.indexOf('main')-1]!;
        assert.equal((await mcpCall(socket,'schedule_create',{text:'Durable future reminder',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'}},oldMeta)).error,'schedule_call_scope_denied');
      }
      return {status:'completed',text:'Verified'};
    });
    await f.app.start();assert.equal(await f.app.message('Create then lose response','lost-create-source'),'Verified');
    await f.restart();assert.equal(await f.app.message('Recover original receipt','recovery-source'),'Verified');
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM schedules').get()!.n,1);
  }finally{await f.close();}
});

test('revoked source is rejected at consumption instead of becoming fresh user authority',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture();
  try{
    f.setScript(async(main,text)=>{
      if(text==='Reminder with revocable source')await call(main,'schedule_create',{text:'Must not execute after revocation',trigger:{at:new Date(Date.now()+60000).toISOString()}},'revoke-create');
      return {status:'completed',text:'Set'};
    });
    await f.app.start();await f.app.message('Reminder with revocable source','revocable-source');
    const message=f.app.store.db.prepare("SELECT id FROM conversation_messages WHERE requestId='revocable-source' AND role='user'").get()!;
    f.app.history.revokeMessage(f.app.store.meta('mainThread')!,String(message.id));
    await f.app.message('New source does not restore old permissions','unrelated-confirmation');
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    assert.ok(f.app.store.db.prepare("SELECT 1 FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='scheduled_message' AND r.state='rejected'").get());
    assert.equal(f.inputs.length,2);
  }finally{await f.close();}
});

test('scheduled inputs remain pending until the restored Main engine finishes initialization',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  let waiting=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const f=fixture(undefined,async()=>{if(waiting)await gate;});let consumed=0,restarting:Promise<void>|undefined;
  try{
    f.setScript(async(main,text)=>{
      if(text.includes('[定时消息正文]'))consumed++;
      else assert.equal((await call(main,'schedule_create',{text:'Wait for initialized Main',trigger:{at:new Date(now+60000).toISOString()}},'initialize-reminder')).error,undefined);
      return {status:'completed',text:'Set'};
    });
    await f.app.start();await f.app.message('Remind me after recovery','initializing-source');
    waiting=true;now+=60000;restarting=f.restart();await until(()=>f.engines.length===2);
    f.app.recheckScheduledMessages();await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(consumed,0);
    assert.equal(f.app.store.db.prepare("SELECT state FROM agent_receipts r JOIN agent_messages m ON m.id=r.messageId WHERE m.kind='scheduled_message'").get()!.state,'pending');
    release();await restarting;await f.app.idle();assert.equal(consumed,1);
  }finally{release();await restarting?.catch(()=>{});await f.close();}
});

for(const revoked of [false,true])test('a scheduled Telegram group message waits for source preparation without losing authorization checks: '+revoked,async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture([{id:'telegram',send:async()=>({state:'sent'})}]);let consumed=0,requestId='';
  try{
    f.setScript(async(main,text)=>{
      if(text.includes('[定时消息正文]'))consumed++;
      else{
        const result=await call(main,'schedule_create',{text:'Delayed group reminder',trigger:{at:new Date(now+60000).toISOString()}},'group-reminder');
        assert.equal(result.error,undefined);
      }
      return {status:'completed',text:'Set'};
    });
    await f.app.start();
    const plugin=f.app.channels!,groups=plugin.telegramGroups(),binding=plugin.bind({adapterId:'telegram',accountKey:'account',senderKey:'sender',conversationKey:'chat'}),date=Math.floor(now/1000);
    groups.membership(binding,-100001,true,date-10,1);groups.caughtUp(binding);
    groups.submit(binding,-100001,date,2,10,null,'Schedule this group reminder');await f.app.idle();
    requestId=String(f.app.store.db.prepare("SELECT json_extract(payloadJson,'$.requestId') id FROM agent_messages WHERE kind='user_input'").get()!.id);
    groups.polled(binding,true);assert.equal(plugin.telegramInputState(requestId),'preparing');
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    const receipt=()=>f.app.store.db.prepare("SELECT r.state FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='scheduled_message'").get()!.state;
    assert.equal(receipt(),'pending');assert.equal(consumed,0);
    assert.equal(f.app.store.db.prepare('SELECT enabled FROM schedules').get()!.enabled,0,'delivery still ends at the original inbox');
    if(revoked)plugin.revokeBinding(binding);else groups.caughtUp(binding);
    await f.app.idle();
    assert.equal(receipt(),revoked?'rejected':'processed');assert.equal(consumed,revoked?0:1);
    groups.caughtUp(binding);f.app.recheckScheduledMessages();await f.app.idle();
    assert.equal(consumed,revoked?0:1);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='scheduled_message'").get()!.n,1);
  }finally{await f.close();}
});

test('a revoked original channel binding cannot authorize a delayed message',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture(),plugin=new ChannelPlugin(f.app,[{id:'simulation',send:async()=>({state:'sent'})}]);
  const address={adapterId:'simulation',accountKey:'account',senderKey:'sender',conversationKey:'chat'};
  try{
    const binding=plugin.bind(address);
    f.setScript(async main=>{
      const result=await call(main,'schedule_create',{text:'Delayed channel task',trigger:{at:new Date(Date.now()+60000).toISOString()}},'channel-schedule');
      assert.equal(result.error,undefined);return {status:'completed',text:'Set'};
    });
    await f.app.start();plugin.receiveText({...address,eventId:'original-channel-event',text:'Schedule in this chat'});await f.app.idle();
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM schedules').get()!.n,1);
    plugin.revokeBinding(binding);
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    assert.equal(f.inputs.length,1);
    assert.ok(f.app.store.db.prepare("SELECT 1 FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='scheduled_message' AND r.state='rejected'").get());
  }finally{await plugin.close();await f.close();}
});

test('revoking a channel during delayed consumption blocks subsequent delegation and public delivery',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture(),plugin=new ChannelPlugin(f.app,[{id:'simulation',send:async()=>({state:'sent'})}]);
  const address={adapterId:'simulation',accountKey:'account',senderKey:'sender',conversationKey:'chat'};
  let checked=false,failure:unknown;
  try{
    const binding=plugin.bind(address);
    f.setScript(async(main,text)=>{
      if(text.includes('[定时消息正文]')){
        try{
          plugin.revokeBinding(binding);
          await assert.rejects(main.call('worker_open',{message:'Must remain unauthorized'}),/channel_binding_denied/);
          await assert.rejects(main.call('send_user_message',{text:'Must not be delivered'}),/channel_binding_denied/);
          checked=true;
        }catch(error){failure=error;throw error;}
      }else await call(main,'schedule_create',{text:'Recheck delayed source',trigger:{at:new Date(now+60000).toISOString()}},'recheck-live-channel');
      return {status:'completed',text:'Set'};
    });
    await f.app.start();plugin.receiveText({...address,eventId:'original-channel-event',text:'Schedule in this chat'});await f.app.idle();
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    assert.ifError(failure);assert.equal(checked,true);assert.equal(f.app.store.runs().length,0);
    assert.equal(f.app.store.db.prepare("SELECT 1 FROM conversation_messages WHERE text='Must not be delivered'").get(),undefined);
  }finally{await plugin.close();await f.close();}
});

test('due delivery is a scheduled source, preserves durable user authority, and stops at inbox',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture();let consumptionError:unknown;
  try{
    f.setScript(async (main,text)=>{
      if(text==='Set a reminder'){
        const result=await call(main,'schedule_create',{text:'Future report',trigger:{at:new Date(Date.now()+60000).toISOString()}},'once-create');
        assert.equal(result.error,undefined);
      }else if(text.includes('Future report')){
        try{
          assert.match(text,/定时/);
          const task=await main.call('worker_open',{message:'Handle the reminder'});
          assert.ok(task.taskId);
          assert.equal(f.app.tasks.version(task.taskId,1).sourceRequestId,'reminder-source');
          await until(()=>f.engines.some(peer=>peer.options.role==='worker'&&peer.finish));
          f.engines.find(peer=>peer.options.role==='worker'&&peer.finish)!.finish!({status:'completed',text:'Delegated reminder handled',messages:[]});
          await main.call('send_user_message',{text:'Delayed result'});
        }catch(error){consumptionError=error;throw error;}
      }
      return {status:'completed',text:''};
    });
    await f.app.start();await f.app.message('Set a reminder','reminder-source');
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    assert.ifError(consumptionError);
    assert.ok(f.inputs.some(text=>text.includes('Future report')));
    const row=f.app.store.db.prepare("SELECT * FROM agent_messages WHERE kind='scheduled_message'").get()!;
    assert.equal(row.senderAgentId,'host');assert.equal(row.taskId,null);
    assert.equal(f.app.store.db.prepare('SELECT enabled FROM schedules').get()!.enabled,0);
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_messages WHERE kind='scheduled_message'").get()!.n,1);
    const delivered=f.app.store.db.prepare("SELECT requestId,taskId FROM conversation_messages WHERE text='Delayed result' AND role='assistant'").get()!;
    assert.equal(delivered.requestId,null);assert.equal(delivered.taskId,null);
  }finally{await f.close();}
});

test('due messages enter the inbox while Homer is busy without waiting for business completion',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  let release!:()=>void,created=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),f=fixture();
  try{
    f.setScript(async(main,text)=>{
      if(text==='Hold current work'){
        for(const id of ['busy-first','busy-second']){
          assert.equal((await call(main,'schedule_create',{text:id,trigger:{at:new Date(now+60000).toISOString()}},id)).error,undefined);
        }
        created=true;await gate;
      }
      return {status:'completed',text:''};
    });
    await f.app.start();const request=f.app.message('Hold current work','busy-source');
    await until(()=>created);now+=60000;f.app.recheckScheduledMessages();
    assert.equal(f.app.store.db.prepare("SELECT count(*) n FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='scheduled_message' AND r.state='pending'").get()!.n,2);
    assert.equal(f.app.store.db.prepare('SELECT count(*) n FROM schedules WHERE enabled=1').get()!.n,0);
    assert.equal(f.inputs.length,1);
    release();await request;await f.app.idle();
    assert.equal(f.inputs.length,3);
  }finally{release();await f.close();}
});
