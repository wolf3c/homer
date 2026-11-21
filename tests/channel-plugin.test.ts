import {openTaskWorker} from './fixtures/open-task-worker.js';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import test from 'node:test';
import {ChannelPlugin, type ChannelAdapter, type ChannelHealth, type ChannelPacket} from '../src/channel-plugin.js';
import type {TurnResult} from '../src/engine.js';
import {fixture, until} from './fixtures/worker-chat-host.js';
import {mcpCall} from './fixtures/host-mcp-call.js';
import {commitSyntheticMessage} from './fixtures/synthetic-message.js';

const address = (suffix: string) => ({adapterId:'simulation',accountKey:suffix,senderKey:'sender-'+suffix,conversationKey:'room-'+suffix});
const A = address('a'), B = address('b');
const input = (entry: typeof A, eventId:string, text:string) => ({...entry,eventId,text});
const tables = (app: ReturnType<typeof fixture>['app']) => app.store.db.prepare(
  "SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all();
const nativeFinal=(text:string):TurnResult=>({status:'completed',text,messages:[{itemId:'final',phase:'final_answer',text}]});

test('connection health reads active bindings and live adapter state without the outbox',async()=>{
  const runtime=mkdtempSync(join(tmpdir(),'homer-connection-health-'));
  let state:ChannelHealth='checking';
  const app={config:{runtime},registerMainPluginTool(){}} as unknown as ConstructorParameters<typeof ChannelPlugin>[0];
  const adapters=['wechat','telegram'].map(id=>({
    id,accountLabel:()=>id+' fixture',connectionState:()=>state,
    async send(){throw Error('unexpected send');},
  }));
  const channels=new ChannelPlugin(app,adapters),db=new DatabaseSync(join(runtime,'channels.sqlite'));
  try{
    for(const adapter of adapters)channels.bind({...A,adapterId:adapter.id});
    assert.equal(channels.connectionStatus().length,2);
    db.exec('DROP TABLE channel_outbox');
    for(state of ['checking','ready','offline','ready'] as const){
      const rows=channels.connectionHealth();
      assert.deepEqual(rows.map(row=>row.state),[state,state]);
      assert.ok(rows.every(row=>row.label===row.adapterId+' fixture'&&!('failed' in row)&&!('senderKey' in row)));
    }
    db.exec("UPDATE channel_bindings SET revokedAt=1 WHERE adapterId='telegram'");
    assert.deepEqual(channels.connectionHealth().map(row=>row.adapterId),['wechat']);
  }finally{db.close();await channels.close();rmSync(runtime,{recursive:true,force:true});}
});

test('Homer manages configured channels and connects only explicitly bound accounts', async()=>{
  const connections:Parameters<NonNullable<ChannelAdapter['connect']>>[]=[];
  const sent:ChannelPacket[]=[];
  let stopGate:Promise<void>|undefined,finishStop:(()=>void)|undefined;
  const adapter:ChannelAdapter={id:'simulation',async send(packet){sent.push(packet);return {state:'sent'};},
    async connect(...args){
      connections.push(args);
      const signal=args[2];
      if(!signal.aborted)await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));
      await stopGate;
    }};
  const f=fixture([adapter]);
  try{
    const schema=tables(f.app);
    const channelSchema=()=>{
      const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
      try{return db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all();}
      finally{db.close();}
    };
    const originalChannelSchema=channelSchema();
    await f.app.start();
    assert.equal(connections.length,0);
    const bindingA=f.app.channels!.bind(A);
    const bindingB=f.app.channels!.bind(B);
    await until(()=>connections.length===2);
    const event={senderKey:A.senderKey,conversationKey:A.conversationKey,eventId:'first',text:'First'};
    assert.throws(()=>connections[0]![1]({...event,senderKey:B.senderKey}),/channel_binding_denied/);
    connections[0]![1](event);
    await f.app.idle();
    await until(()=>sent.length===1);
    assert.deepEqual(sent[0]!.address,A);
    await f.restart();
    assert.ok(connections.slice(0,2).every(connection=>connection[2].aborted));
    await until(()=>connections.length===4);
    assert.deepEqual(connections.slice(2).map(connection=>connection[0]),[A,B]);
    stopGate=new Promise<void>(resolve=>{finishStop=resolve;});
    f.app.channels!.revokeBinding(bindingA);
    assert.equal(connections[2]![2].aborted,true);
    assert.equal(connections[3]![2].aborted,false);
    assert.notEqual(f.app.channels!.bind(A),bindingA);
    assert.throws(()=>connections[2]![1](event),/channel_binding_denied/);
    await yieldTurn();
    assert.equal(connections.length,4);
    finishStop!();
    await until(()=>connections.length===5);
    f.app.channels!.revokeBinding(bindingA);
    assert.equal(connections[4]![2].aborted,false);
    f.app.channels!.revokeBinding(bindingB);
    await f.restart();
    await until(()=>connections.length===6);
    assert.deepEqual(connections[5]![0],A);
    assert.deepEqual(tables(f.app),schema);
    assert.deepEqual(channelSchema(),originalChannelSchema);
    assert.deepEqual(f.app.channels!.connectionStatus(),[
      {adapterId:'simulation',accountKey:'a',label:'a',state:'checking',failed:0,unknown:0},
    ]);
    stopGate=new Promise<void>(resolve=>{finishStop=resolve;});
    const closing=f.app.close();
    let repeatedCloseFinished=false;
    const repeatedClose=f.app.close().then(()=>{repeatedCloseFinished=true;});
    await yieldTurn();
    assert.equal(connections[5]![2].aborted,true);
    assert.equal(repeatedCloseFinished,false);
    const lock=join(f.app.config.runtime,'cli.lock');
    assert.equal(existsSync(lock),true);
    finishStop!();
    await Promise.all([closing,repeatedClose]);
    assert.equal(existsSync(lock),false);
  }finally{finishStop?.();await f.close();}
  assert.ok(connections.every(connection=>connection[2].aborted));
});

test('closing during startup never restores a channel or releases the runtime early',async t=>{
  for(const withAdapter of [false,true])await t.test(withAdapter?'with a bound adapter':'without adapters',async()=>{
    let resume!:()=>void,connections=0;
    const waiting=new Promise<void>(resolve=>{resume=resolve;});
    const f=fixture(withAdapter?[{id:A.adapterId,async connect(){connections++;},async send(){return {state:'sent'};}}]:[],()=>waiting);
    try{
      if(withAdapter)f.app.channels!.bind(A);
      else assert.equal(existsSync(join(f.app.config.runtime,'channels.sqlite')),false);
      const started=f.app.start();
      void started.catch(()=>{});
      await until(()=>f.engines.length===1);
      const closing=f.app.close();
      await yieldTurn();
      const lock=join(f.app.config.runtime,'cli.lock');
      assert.equal(existsSync(lock),true);
      assert.equal(connections,0);
      resume();
      await assert.rejects(started,/application_closing/);
      await closing;
      assert.equal(connections,0);
      assert.equal(existsSync(lock),false);
    }finally{resume();await f.close();}
  });
});

async function subscribe(main: ReturnType<typeof fixture>['engines'][number], taskId:string, armCut?:(cut:()=>Promise<unknown>)=>void) {
  const name='set_notification_destination', args={taskId}, itemId='synthetic-subscribe';
  const child=spawn(main.options.interactionMcp!.command,main.options.interactionMcp!.args,{
    cwd:main.options.interactionMcp!.cwd,stdio:['pipe','pipe','pipe'],
  });
  const stopped=new Promise<NodeJS.Signals|null>(resolve=>child.once('close',(_code,signal)=>resolve(signal)));
  const lines=createInterface({input:child.stdout});
  const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(Error('test_stdio_timeout'));},3000);
    function cleanup(){clearTimeout(timeout);lines.off('line',receive);lines.off('close',closed);}
    function closed(){cleanup();reject(Error('test_stdio_closed'));}
    function receive(line:string){cleanup();resolve(JSON.parse(line).result);}
    lines.on('line',receive);
    lines.once('close',closed);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method,params})+'\n');
  });
  try {
    const list=await rpc('tools/list',{});
    assert.ok(list.tools.some((tool:any)=>tool.name===name));
    main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId,tool:name,arguments:args});
    armCut?.(()=>{child.kill('SIGKILL');return stopped;});
    const call=rpc('tools/call',{name,arguments:args,_meta:{callId:itemId,'x-codex-turn-metadata':{turn_id:main.turnId}}});
    if(armCut){
      await assert.rejects(call,/test_stdio_closed/);
      assert.equal(await stopped,'SIGKILL');
      return;
    }
    const result=await call;
    assert.equal(result.isError,false,JSON.stringify(result));
    return JSON.parse(result.content[0].text) as {subscriptionId:string;state:string};
  } finally {lines.close();child.stdin.end();child.kill();await stopped;}
}

test('a subscribed Worker final is caught up once with the exact linked file',async()=>{
  const f=fixture();
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket){sent.push(packet);return {state:'sent' as const};}};
  let plugin=new ChannelPlugin(f.app,[adapter]);
  let taskId='',workerId='',returned=0;
  const report=join(f.app.config.workspace,'report.md'),destination=pathToFileURL(report).href;
  const finals=['Before subscription',`Subscribed final. [Report](${destination})`,
    '[Desktop file](/private/synthetic/report.md)','![Desktop image][picture]\n\n[picture]: file:///private/synthetic/screenshot.png'];
  try{
    plugin.bind(B);
    plugin.bind(A);
    f.setScript(async(main,text)=>{
      if(text==='delegate')({taskId,workerId}=await openTaskWorker(main,'Prepare report','Prepare report'));
      else if(text==='subscribe')await subscribe(main,taskId);
      else if(text==='continue')await main.call('worker_message',{workerId,message:'Continue'});
      else if(text.startsWith('[内部协作输入')){
        const final=finals[returned++]!;
        return {status:'completed',text:'INTERNAL COMMENTARY\n'+final,messages:[
          {itemId:'commentary',phase:'commentary',text:'INTERNAL COMMENTARY'},
          {itemId:'final',phase:'final_answer',text:final},
        ]};
      }
      return {status:'completed',text:'Acknowledged'};
    });
    const endWorker=async()=>{
      await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
      const worker=f.engines.findLast(engine=>engine.options.role==='worker'&&engine.finish)!;
      const finish=worker.finish!;worker.finish=undefined;
      finish({status:'completed',text:`INTERNAL WORKER REPLY [Report](${destination})`});
      await f.app.idle();
    };
    await f.app.start();
    writeFileSync(report,'# Published report');
    plugin.receiveText(input(A,'delegate','delegate'));
    await endWorker();
    plugin.receiveText(input(B,'subscribe','subscribe'));
    await f.app.idle();
    for(let i=1;i<finals.length;i++){
      plugin.receiveText(input(A,'continue-'+i,'continue'));
      await endWorker();
    }
    assert.equal(sent.length,0);
    const expected=f.app.history.list(f.app.store.meta('mainThread')!).find(message=>message.text===finals[1])!;
    assert.ok(expected);
    const [ref]=expected.attachments??[];
    assert.ok(ref);
    writeFileSync(report,'# Changed after publication');
    const projected=(await import('../src/web-homer.js')).homerWebBridge(f.app);
    const state=await projected.history!.state();
    assert.ok(state.artifacts?.some(file=>file.messageId===expected.id&&file.assetId===ref.assetId&&file.destination===destination));
    assert.equal(Buffer.from((await projected.media!.read({messageId:expected.id,...ref})).data,'base64').toString(),'# Published report');
    assert.equal(f.app.readMessageFile({threadId:expected.threadId,messageId:expected.id,destination}).bytes.toString(),'# Published report');
    assert.equal(f.app.readCommittedMessage(expected.id,{taskId,taskVersion:expected.taskVersion!+1}),undefined);
    assert.equal(f.app.readCommittedMessage(expected.id,{requestId:'other-input'}),undefined);
    const visible=f.app.webHistoryPages().read(f.app.store.meta('mainThread')!).messages.map(message=>message.text);
    for(const final of finals)assert.equal(visible.filter(text=>text===final).length,1);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    const results=()=>sent.filter(packet=>packet.part.kind!=='text'||packet.part.text!=='Acknowledged');
    assert.deepEqual(results().map(packet=>[packet.address,packet.messageId,packet.part.kind==='text'?packet.part.text:Buffer.from(packet.part.data,'base64').toString()]),
      [[B,expected.id,'Subscribed final. Report'],[B,expected.id,'# Published report']]);
    await plugin.synchronize();
    assert.equal(results().length,2);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    assert.equal(results().length,2);
  }finally{await plugin.close();await f.close();}
});

for(const variant of ['visible','archive-before-timer','archive-before-send','revoked'] as const)test(`a scheduled result preserves the original subscription across restart: ${variant}`,async t=>{
  const revoke=variant==='revoked';
  let now=Date.now(),taskId='',runs=0;
  let scheduleError:unknown;
  t.mock.method(Date,'now',()=>now);
  const f=fixture(),final='The timed report is ready.';
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket){sent.push(packet);return {state:'sent' as const};}};
  let plugin=new ChannelPlugin(f.app,[adapter]);
  try{
    const originBinding=plugin.bind(A);plugin.bind(B);
    f.setScript(async(main,text)=>{
      if(text==='prepare')({taskId}=await openTaskWorker(main,'Prepare report','Upcoming report'));
      else if(text==='subscribe')await subscribe(main,taskId);
      else if(text==='archive'){
        await main.call('archive_work',{taskId});
      }else if(text.includes('"kind":"task_archived"')){
        return {status:'completed',text:''};
      }else if(text==='plan'){
        const mcp=main.options.interactionMcp!;
        const call=async(name:string,args:object)=>{
          const itemId='timed-report-'+name;
          main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId,tool:name,arguments:args});
          return mcpCall(mcp.args[mcp.args.indexOf('main')-1]!,name,args,{callId:itemId,'x-codex-turn-metadata':{turn_id:main.turnId}});
        };
        const created=await call('schedule_create',{text:'Prepare the timed report',...(!revoke?{taskId}:{}),trigger:{at:new Date(now+60000).toISOString()}});
        scheduleError=created.error;
        if(revoke&&created.result){
          const {scheduleId,revision}=created.result as {scheduleId:string;revision:number};
          scheduleError=(await call('schedule_update',{scheduleId,expectedRevision:revision,taskId})).error;
        }
      }else if(text.startsWith('[定时消息；')){
        runs++;
        return {status:'completed',text:final,messages:[{itemId:'f',phase:'final_answer',text:final}]};
      }
      return {status:'completed',text:'Acknowledged'};
    });
    await f.app.start();
    plugin.receiveText(input(A,'prepare','prepare'));
    await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
    f.engines.find(engine=>engine.options.role==='worker')!.finish!({status:'completed',text:'Ready'});
    await f.app.idle();
    assert.ok(taskId);
    plugin.receiveText(input(B,'subscribe','subscribe'));await f.app.idle();
    plugin.receiveText(input(A,'plan','plan'));await f.app.idle();
    assert.equal(scheduleError,undefined);
    assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM schedules').get()!.n,1);
    const archive=async()=>{
      plugin.receiveText(input(A,'archive','archive'));await f.app.idle();
      assert.equal(f.app.tasks.task(taskId).historyState,'archived');
    };
    if(variant==='archive-before-timer')await archive();
    now+=60000;f.app.recheckScheduledMessages();await f.app.idle();
    assert.equal(runs,1);
    const entry=f.app.history.list(f.app.store.meta('mainThread')!).find(message=>message.text===final)!;
    assert.equal(entry?.taskId,taskId);
    assert.equal(entry?.requestId,null);
    assert.equal(sent.length,0);
    if(variant==='archive-before-send')await archive();
    if(revoke)plugin.revokeBinding(originBinding);
    const deliveries=()=>sent.filter(item=>item.part.kind==='text'&&item.part.text===final);
    for(let i=0;i<2;i++){
      await plugin.close();await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
      await plugin.synchronize();
      assert.deepEqual(deliveries().map(item=>[item.address,item.messageId]),revoke?[]:[[B,entry.id]]);
    }
    assert.equal(runs,1);
  }finally{await plugin.close();await f.close();}
});

test('two simulated bots on one adapter isolate bindings, replies and subscribed attachments', async () => {
  const f=fixture();
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket){sent.push(packet);return {state:'sent' as const,receipt:'receipt-'+sent.length};}};
  const schema=tables(f.app);
  let plugin:ChannelPlugin|undefined;
  let taskId='',workerId='';
  let background=0;
  try {
    const report=join(f.app.config.workspace,'report.md'),notes=join(f.app.config.workspace,'notes.md');
    const reportFinal=`[Report ready](${pathToFileURL(report).href}) · [Notes](${pathToFileURL(notes).href})`;
    writeFileSync(report,'# Original report');
    writeFileSync(notes,'# Original notes');
    f.setScript(async(main,text)=>{
      if(text==='delegate'){
        ({taskId,workerId}=await openTaskWorker(main,'Inspect the report'));
        return {status:'completed',text:'Accepted'};
      }
      if(text==='subscribe'){await subscribe(main,taskId);return {status:'completed',text:'Subscribed'};}
      if(text==='continue'){await main.call('worker_message',{workerId,message:'Continue'});return {status:'completed',text:'Continuing'};}
      if(text.startsWith('[内部协作输入')){
        if(++background===1)return nativeFinal('Before subscription');
        if(background===2)return {status:'completed',text:'Progress after subscription\n'+reportFinal,messages:[
          {itemId:'progress',phase:'commentary',text:'Progress after subscription'},
          {itemId:'final',phase:'final_answer',text:reportFinal},
        ]};
        return nativeFinal(background===3?'Before switch':'After switch');
      }
      return nativeFinal('Progress answer');
    });
    plugin=new ChannelPlugin(f.app,[adapter]);
    assert.notEqual(plugin.bind(A),plugin.bind(B));
    await f.app.start();
    const thread=f.app.store.meta('mainThread');
    const first=plugin.receiveText(input(A,'event-1','delegate'));
    assert.equal(plugin.receiveText(input(A,'event-1','delegate')),first);
    assert.throws(()=>plugin!.receiveText(input(A,'event-1','other')),/channel_event_conflict/);
    assert.throws(()=>plugin!.receiveText(input({...A,senderKey:B.senderKey},'bad','fake')),/channel_binding_denied/);
    assert.throws(()=>plugin!.receiveText(input({...A,conversationKey:B.conversationKey},'bad','fake')),/channel_binding_denied/);
    const unsupported={...input(A,'attachment','fake'),attachments:[{}]};
    assert.throws(()=>plugin!.receiveText(unsupported),/channel_input_invalid/);
    const endWorker=async ()=>{
      await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
      const worker=f.engines.findLast(engine=>engine.options.role==='worker'&&engine.finish)!;
      assert.ok(!worker.options.interactionMcp!.catalog!.some(tool=>tool.name==='set_notification_destination'));
      const finish=worker.finish!;worker.finish=undefined;
      finish({status:'completed',text:reportFinal});
      await f.app.idle();
    };
    await endWorker();
    await plugin.synchronize();
    assert.deepEqual(sent.map(p=>[p.address.accountKey,p.part.kind==='text'&&p.part.text]),[['a','Accepted']]);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    assert.equal(f.app.store.meta('mainThread'),thread);
    // Providers may reuse the same event ID across different bot accounts.
    const second=plugin.receiveText(input(B,'event-1','subscribe'));
    assert.notEqual(second,first);
    assert.equal(plugin.receiveText(input(B,'event-1','subscribe')),second);
    await f.app.idle();
    plugin.receiveText(input(A,'event-ask','ask'));
    plugin.receiveText(input(A,'event-continue','continue'));
    await endWorker();
    writeFileSync(report,'# Changed source');
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    // No listener ran for these messages. Startup catch-up must recover all of them.
    plugin.start();
    await until(()=>sent.length===7);
    await plugin.synchronize();
    const texts=sent.flatMap(p=>p.part.kind==='text'?[[p.address.accountKey,p.part.text]]:[]);
    assert.deepEqual(texts.filter(([key])=>key==='a').map(([,text])=>text),['Accepted','Progress answer','Continuing']);
    assert.deepEqual(texts.filter(([key])=>key==='b').map(([,text])=>text),['Subscribed','Report ready · Notes']);
    const files=sent.flatMap(p=>p.part.kind==='attachment'?[[p.address.accountKey,p.part.filename,Buffer.from(p.part.data,'base64').toString()]]:[]);
    assert.deepEqual(files,[['b','report.md','# Original report'],['b','notes.md','# Original notes']]);
    for(const packet of sent)assert.deepEqual(packet.address,packet.address.accountKey===A.accountKey?A:B);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    plugin.receiveText(input(B,'before-switch','continue'));
    await endWorker();
    plugin.receiveText(input(A,'switch','subscribe'));
    await f.app.idle();
    plugin.receiveText(input(B,'after-switch','continue'));
    await endWorker();
    await plugin.synchronize();
    const after=sent.flatMap(p=>p.part.kind==='text'&&/^(Before|After) switch$/.test(p.part.text)?[[p.address.accountKey,p.part.text]]:[]);
    assert.deepEqual(after,[['a','After switch']]);
    assert.deepEqual(tables(f.app),schema);
  } finally {await plugin?.close();await f.close();}
});

test('subscription survives a lost tool receipt and old retries cannot undo a later switch',async t=>{
  const f=fixture();
  const sent:ChannelPacket[]=[];
  const adapter:ChannelAdapter={id:'simulation',async send(packet){sent.push(packet);return {state:'sent'};}};
  let plugin:ChannelPlugin|undefined,taskId='',workerId='',background=0;
  let cut:(()=>Promise<unknown>)|undefined,firstSubscription='',secondSubscription='';
  let receiptLost=false;
  let applySubscription!:Parameters<typeof f.app.registerMainPluginTool>[1];
  const install=(app:typeof f.app)=>{
    const register=app.registerMainPluginTool.bind(app);
    t.mock.method(app,'registerMainPluginTool',(...[tool,handle]:Parameters<typeof register>)=>{
      applySubscription=handle;
      register(tool,(args,context)=>{
        const result=handle(args,context);
        if(!cut)return result;
        firstSubscription=(result as {subscriptionId:string}).subscriptionId;
        const stopped=cut();
        cut=undefined;
        // Keep the host response gated until the bridge is confirmed dead.
        return stopped.then(()=>result);
      });
    });
    plugin=new ChannelPlugin(app,[adapter]);
  };
  const finishWorker=async()=>{
    await until(()=>f.engines.some(engine=>engine.finish));
    const worker=f.engines.findLast(engine=>engine.finish)!;
    const finish=worker.finish!;
    worker.finish=undefined;
    finish({status:'completed',text:'Synthetic work'});
    await f.app.idle();
  };
  const original=input(A,'subscribe-a','subscribe before receipt loss');
  try{
    f.setScript(async(main,text)=>{
      if(text==='delegate')({taskId,workerId}=await openTaskWorker(main,'Create synthetic work'));
      else if(text===original.text){
        await subscribe(main,taskId,kill=>{cut=kill;});
        receiptLost=true;
      }
      else if(text==='switch')secondSubscription=(await subscribe(main,taskId))!.subscriptionId;
      else if(text==='continue')await main.call('worker_message',{workerId,message:'Continue'});
      else if(text.startsWith('[内部协作输入')){
        return nativeFinal(`Background ${++background}`);
      }
      return {status:'completed',text:'Acknowledged'};
    });
    install(f.app);
    plugin!.bind(A);plugin!.bind(B);
    await f.app.start();
    plugin!.receiveText(input(A,'delegate','delegate'));
    await finishWorker();
    const requestId=plugin!.receiveText(original);
    await f.app.idle();
    assert.ok(firstSubscription);
    assert.equal(receiptLost,true);
    await plugin!.close();
    await f.restart(install);

    const inputCount=f.inputs.length;
    assert.equal(plugin!.receiveText(original),requestId);
    await f.app.idle();
    assert.equal(f.inputs.length,inputCount);
    // The production MCP path checks live turn identity. Exercise the registered
    // handler directly here to supply the original trusted request during replay.
    const replay=()=>applySubscription({taskId},{requestId,authorizeTask:id=>assert.equal(id,taskId)});
    plugin!.receiveText(input(B,'continue-1','continue'));
    await finishWorker();
    assert.deepEqual(replay(),{taskId,subscriptionId:firstSubscription,state:'active'});
    await plugin!.synchronize();

    plugin!.receiveText(input(B,'switch','switch'));
    await f.app.idle();
    assert.ok(secondSubscription&&secondSubscription!==firstSubscription);
    assert.deepEqual(replay(),{taskId,subscriptionId:firstSubscription,state:'superseded'});
    plugin!.receiveText(input(A,'continue-2','continue'));
    await finishWorker();
    await plugin!.synchronize();
    assert.deepEqual(sent.flatMap(packet=>packet.part.kind==='text'&&packet.part.text.startsWith('Background ')
      ?[[packet.address.accountKey,packet.part.text]]:[]),[['a','Background 2'],['b','Background 3']]);
    const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
    try{
      const rows=db.prepare('SELECT id,revokedAt FROM channel_subscriptions WHERE taskId=? ORDER BY rowid').all(taskId);
      assert.deepEqual(rows.map(row=>[row.id,row.revokedAt===null]),[[firstSubscription,false],[secondSubscription,true]]);
    }finally{db.close();}
  }finally{await plugin?.close();await f.close();}
});

test('unknown send and revoked binding stay pinned to their original outbox items', async () => {
  const f=fixture();
  let plugin:ChannelPlugin|undefined;
  let old='';
  let rebound='';
  let finishSend!:()=>void;
  const stoppingSend=new Promise<void>(resolve=>{finishSend=resolve;});
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket,signal:AbortSignal){
    sent.push(packet);
    if(packet.address.accountKey==='b'){
      plugin!.revokeBinding(old);
      rebound=plugin!.bind(A);
    }
    if(packet.part.kind==='attachment'){
      await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));
      await stoppingSend;
      return {state:'unknown' as const};
    }
    return {state:'sent' as const};
  }};
  try {
    const report=join(f.app.config.workspace,'report.md');writeFileSync(report,'# Synthetic report');
    f.setScript(async(_main,text)=>nativeFinal(text==='file'?`[Report](${pathToFileURL(report).href})`:'Normal'));
    plugin=new ChannelPlugin(f.app,[adapter]);
    old=plugin.bind(A);
    plugin.bind(B);
    await f.app.start();
    plugin.receiveText(input(A,'unknown','file'));
    await f.app.idle();
    const inFlight=plugin.synchronize();
    await until(()=>sent.length===2);
    let closed=false;
    const closing=plugin.close().then(()=>{closed=true;});
    await yieldTurn();
    assert.equal(closed,false);
    finishSend();
    await closing;
    await inFlight;
    assert.equal(sent.length,2);
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    plugin.receiveText(input(B,'gate','reply'));
    plugin.receiveText(input(A,'revoked','reply'));
    await f.app.idle();await plugin.synchronize();
    assert.deepEqual(sent.map(packet=>packet.address.accountKey),['a','a','b']);
    assert.ok(rebound&&rebound!==old);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    assert.equal(sent.length,3);
    assert.throws(()=>plugin!.receiveText(input(A,'revoked','reply')),/channel_event_conflict/);
  } finally {finishSend();await plugin?.close();await f.close();}
});

test('recovery retains the exact in-flight attachment when a successful transport receipt cannot be saved', async()=>{
  const f=fixture();
  let plugin:ChannelPlugin|undefined,db:DatabaseSync|undefined;
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket){
    sent.push(packet);
    if(packet.part.kind==='attachment')db!.exec(`CREATE TRIGGER reject_channel_receipt BEFORE UPDATE OF nextPart ON channel_outbox
      BEGIN SELECT RAISE(ABORT,'simulated receipt write failure'); END`);
    return {state:'sent' as const,receipt:'receipt-'+sent.length};
  }};
  try{
    const file=join(f.app.config.workspace,'report.md');
    writeFileSync(file,'# Durable attempted attachment');
    f.setScript(async()=>nativeFinal(`[Report](${pathToFileURL(file).href})`));
    plugin=new ChannelPlugin(f.app,[adapter]);plugin.bind(A);
    db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'));
    await f.app.start();
    plugin.receiveText(input(A,'receipt-loss','report'));
    await f.app.idle();
    await assert.rejects(plugin.synchronize(),/simulated receipt write failure/);
    assert.equal(sent.length,2);
    const packet=sent[1]!;
    const ref=f.app.history.message(packet.messageId)!.attachments![0]!;
    const outbox=()=>db!.prepare('SELECT state,attemptId,nextPart,receipts FROM channel_outbox WHERE messageId=?').get(packet.messageId)!;
    assert.equal(outbox().state,'sending');
    assert.deepEqual(JSON.parse(String(outbox().receipts)).at(-1),
      {attemptId:packet.attemptId,part:1,attachment:ref,state:'sending'});
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    assert.equal(sent.length,2);
    const row=outbox();
    assert.equal(row.state,'unknown');
    assert.equal(row.attemptId,packet.attemptId);
    assert.equal(row.nextPart,1);
    assert.deepEqual(JSON.parse(String(row.receipts)).map((r:any)=>r.state),['sent','unknown']);
    assert.deepEqual(JSON.parse(String(row.receipts))[1].attachment,ref);
  }finally{db?.close();await plugin?.close();await f.close();}
});

test('idle polling avoids rescans and only backfills the missed second reply of a request', async t=>{
  const f=fixture();
  const sent:ChannelPacket[]=[];
  const plugin=new ChannelPlugin(f.app,[{id:'simulation',async send(packet){sent.push(packet);return {state:'sent'};}}]);
  let release!:()=>void;
  let requestId:string;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  try{
    f.setScript(async()=>{
      const thread=f.app.store.meta('mainThread')!;
      const {messageId}=commitSyntheticMessage(f.app,thread,'First reply',[],requestId);
      (f.app as unknown as {notifyCommittedMessage(id:string):void}).notifyCommittedMessage(messageId);
      await blocked;
      commitSyntheticMessage(f.app,thread,'Second reply',[],requestId);
      return nativeFinal('First reply');
    });
    plugin.bind(A);plugin.bind(B);
    await f.app.start();
    const reads=t.mock.method(f.app,'listCommittedMessages');
    t.mock.timers.enable({apis:['setInterval']});
    plugin.start();
    requestId=plugin.receiveText(input(A,'two-replies','Two replies'));
    await until(()=>sent.length===1);
    await plugin.synchronize();
    const settled=reads.mock.callCount();
    assert.ok(settled>0);
    assert.equal(sent.length,1);
    t.mock.timers.tick(5000);
    await yieldTurn();
    assert.equal(reads.mock.callCount(),settled);

    release();
    await f.app.idle();
    assert.equal(sent.length,1);
    t.mock.timers.tick(1000);
    await until(()=>sent.length===2);
    await plugin.synchronize();
    assert.deepEqual(sent.map(packet=>[packet.address,packet.part]),[[A,{kind:'text',text:'First reply'}],[A,{kind:'text',text:'Second reply'}]]);
    assert.deepEqual(f.app.listCommittedMessages({requestId}).items.map(message=>message.messageId),sent.map(packet=>packet.messageId));
  }finally{release();await plugin.close();t.mock.timers.reset();await f.close();}
});

test('restart backfill skips a full page of outbox entries and sends the next reply once', async t=>{
  const f=fixture();
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket){sent.push(packet);return {state:'sent' as const};}};
  let plugin=new ChannelPlugin(f.app,[adapter]);
  let requestId:string;
  try{
    plugin.bind(A);
    f.setScript(async()=>{
      const thread=f.app.store.meta('mainThread')!;
      for(let i=0;i<64;i++)commitSyntheticMessage(f.app,thread,'Earlier reply '+i,[],requestId);
      return nativeFinal('Earlier replies');
    });
    await f.app.start();
    requestId=plugin.receiveText(input(A,'full-page','Populate one page'));
    await f.app.idle();
    await plugin.synchronize();
    const delivered=sent.map(packet=>packet.messageId);
    assert.equal(delivered.length,64);
    assert.equal(new Set(delivered).size,64);

    const {messageId}=commitSyntheticMessage(f.app,f.app.store.meta('mainThread')!,'Reply pending backfill',[],requestId);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    const reads=t.mock.method(f.app,'readCommittedMessage');
    await plugin.synchronize();
    assert.deepEqual(sent.map(packet=>packet.messageId),[...delivered,messageId]);
    assert.equal(reads.mock.callCount(),2);
    assert.ok(reads.mock.calls.every(call=>call.arguments[0]===messageId));

    await plugin.synchronize();
    assert.equal(reads.mock.callCount(),2);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    assert.deepEqual(sent.map(packet=>packet.messageId),[...delivered,messageId]);
  }finally{await plugin.close();await f.close();}
});

test('pending input waits for its original adapter and recovers after a lost acceptance receipt', async()=>{
  const f=fixture();
  let plugin:ChannelPlugin|undefined;
  const sent:ChannelPacket[]=[];
  const adapter={id:'simulation',async send(packet:ChannelPacket){sent.push(packet);return {state:'sent' as const};}};
  try{
    plugin=new ChannelPlugin(f.app,[adapter]);plugin.bind(A);
    assert.throws(()=>plugin!.receiveText(input(A,'pending-before-start','Deferred text')));
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[]);});
    await plugin.synchronize();
    await f.app.idle();
    assert.deepEqual(f.inputs,[]);
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    await f.app.idle();
    assert.deepEqual(f.inputs,['Deferred text']);
    await plugin.synchronize();
    const event=input(A,'acceptance-receipt-lost','Accepted before receipt failure');
    const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'));
    let acceptedRequestId:string;
    try{
      db.exec(`CREATE TRIGGER reject_acceptance_receipt BEFORE UPDATE OF pendingText ON channel_requests
        BEGIN SELECT RAISE(ABORT,'simulated acceptance receipt write failure'); END`);
      assert.throws(()=>plugin!.receiveText(event),/simulated acceptance receipt write failure/);
      await f.app.idle();
      const pending=db.prepare('SELECT id,pendingText FROM channel_requests WHERE pendingText IS NOT NULL').get();
      assert.ok(pending);
      assert.equal(pending.pendingText,event.text);
      acceptedRequestId=String(pending.id);
      assert.equal(f.app.listCommittedMessages({requestId:acceptedRequestId}).items.length,1);
    }finally{db.exec('DROP TRIGGER IF EXISTS reject_acceptance_receipt');db.close();}
    await plugin.close();
    await f.restart(app=>{plugin=new ChannelPlugin(app,[adapter]);});
    await plugin.synchronize();
    assert.equal(plugin.receiveText(event),acceptedRequestId);
    await f.app.idle();
    await plugin.synchronize();
    assert.deepEqual(f.inputs,['Deferred text',event.text]);
    assert.deepEqual(sent.map(packet=>packet.address),[A,A]);
    assert.equal(new Set(sent.map(packet=>packet.messageId)).size,2);
  }finally{await plugin?.close();await f.close();}
});

test('live adapter replacement waits for old connections and preserves the main and binding',async()=>{
 let stopped!:()=>void,oldConnected=false,newConnected=0,saved=false;
 const gate=new Promise<void>(resolve=>{stopped=resolve;});
 const old:ChannelAdapter={id:'simulation',send:async()=>({state:'sent'}),connect:async(_a,_r,signal)=>{
  oldConnected=true;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));await gate;
 }};
 const f=fixture([old]);
 try{
  const binding=f.app.channels!.bind(A);await f.app.start();await until(()=>oldConnected);
  const main=f.engines[0];
  const next={id:'simulation',send:async()=>({state:'sent' as const}),applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',[A,B]);},
   async connect(_a:unknown,_r:unknown,signal:AbortSignal){newConnected++;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));}};
  const applying=f.app.channels!.reconfigure('simulation',()=>{saved=true;},()=>next);
  await yieldTurn();assert.equal(saved,false);assert.equal(newConnected,0);
  stopped();await applying;await until(()=>newConnected===2);
  assert.equal(saved,true);assert.equal(f.engines[0],main);
  const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT id FROM channel_bindings WHERE accountKey=? AND revokedAt IS NULL').get('a')!.id,binding);}finally{db.close();}
 }finally{stopped();await f.close();}
});

test('saved adapter failure pauses private request authority until an explicit reload',async()=>{
 const old:ChannelAdapter={id:'simulation',send:async()=>({state:'sent'})},f=fixture([old]);
 try{
  f.app.channels!.bind(A);await f.app.start();
  const request=f.app.channels!.receiveText(input(A,'before','before'));await f.app.idle();
  await assert.rejects(f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(){throw Error('synthetic_bind_failure');}})),/synthetic_bind_failure/);
  assert.equal(f.app.channels!.channelInputState(request),'preparing');
  assert.equal(f.app.channels!.connectionStatus()[0]!.state,'offline');
  await f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',[]);}}));
  assert.equal(f.app.channels!.channelInputState(request),'denied');
 }finally{await f.close();}
});

test('live replacement stops the old multipart sender between parts',async()=>{
 let finish!:()=>void,started=false;const sent:string[]=[],gate=new Promise<void>(resolve=>{finish=resolve;});
 const old:ChannelAdapter={id:'simulation',async send(packet){started=true;sent.push('old:'+packet.part.kind);await gate;return {state:'sent'};}},f=fixture([old]);
 try{
  const file=join(f.app.config.workspace,'proof.txt');writeFileSync(file,'synthetic');
  f.setScript(async()=>nativeFinal(`[report](${pathToFileURL(file).href})`));
  f.app.channels!.bind(A);await f.app.start();f.app.channels!.receiveText(input(A,'multipart','multipart'));
  await until(()=>started);
  const applying=f.app.channels!.reconfigure('simulation',()=>{},()=>({id:'simulation',async send(packet){sent.push('new:'+packet.part.kind);return {state:'sent' as const};},applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',[A]);}}));
  await yieldTurn();finish();await applying;await f.app.idle();await f.app.channels!.synchronize();
  assert.equal(sent.filter(v=>v.startsWith('old:')).length,1);assert.ok(sent.includes('new:attachment'));
 }finally{finish();await f.close();}
});

test('live replacement preserves an unrecorded transport receipt as unknown without replay',async()=>{
 let db:DatabaseSync|undefined,sends=0;
 const old:ChannelAdapter={id:'simulation',async send(){
  sends++;db!.exec("CREATE TRIGGER reject_live_receipt BEFORE UPDATE OF nextPart ON channel_outbox BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
  return {state:'sent'};
 }};
 const f=fixture([old]);
 try{
  f.app.channels!.bind(A);db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'));
  await f.app.start();f.app.channels!.receiveText(input(A,'receipt','receipt'));await f.app.idle();
  await assert.rejects(f.app.channels!.synchronize(),/synthetic receipt failure/);
  assert.equal(db.prepare('SELECT state FROM channel_outbox').get()!.state,'sending');
  db.exec('DROP TRIGGER reject_live_receipt');
  await f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',[A]);}}));
  await f.app.channels!.synchronize();
  assert.equal(db.prepare('SELECT state FROM channel_outbox').get()!.state,'unknown');assert.equal(sends,1);
 }finally{db?.close();await f.close();}
});

test('live channel changes leave an executing Worker and main engine intact',async()=>{
 const old:ChannelAdapter={id:'simulation',send:async()=>({state:'sent'})},f=fixture([old]);
 try{
  f.setScript(async main=>{await openTaskWorker(main,'Keep working');return {status:'completed',text:'delegated'};});
  f.app.channels!.bind(A);await f.app.start();f.app.channels!.receiveText(input(A,'delegate-live','delegate'));
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const main=f.engines[0],worker=f.engines.find(engine=>engine.options.role==='worker')!,finish=worker.finish,thread=worker.threadId;
  await f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',[A,B]);}}));
  assert.equal(f.engines[0],main);assert.equal(worker.threadId,thread);assert.equal(worker.finish,finish);assert.equal(f.engines.filter(engine=>engine.options.role==='worker').length,1);
 }finally{await f.close();}
});


test('saved apply failure holds newly committed text and attachments until explicit reload',async()=>{
 let release!:()=>void,entered=false;const gate=new Promise<void>(resolve=>release=resolve),sent:ChannelPacket[]=[];
 const old:ChannelAdapter={id:'simulation',async send(packet){sent.push(packet);return {state:'sent'};}},f=fixture([old]);
 try{
  const file=join(f.app.config.workspace,'paused.txt');writeFileSync(file,'synthetic');
  f.setScript(async()=>{entered=true;await gate;return nativeFinal(`[held reply](${pathToFileURL(file).href})`);});
  f.app.channels!.bind(A);await f.app.start();f.app.channels!.receiveText(input(A,'paused-send','report'));await until(()=>entered);
  await assert.rejects(f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(){throw Error('synthetic_apply_failed');}})),/synthetic_apply_failed/);
  release();await f.app.idle();await f.app.channels!.synchronize();
  assert.equal(sent.length,0);
  const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT state FROM channel_outbox').get()!.state,'queued');}finally{db.close();}
  await f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',[A]);}}));
  await f.app.channels!.synchronize();assert.deepEqual(sent.map(packet=>packet.part.kind),['text','attachment']);
 }finally{release();await f.close();}
});

test('saved apply failure holds subscribed Worker output until explicit reload',async()=>{
 const sent:ChannelPacket[]=[],old:ChannelAdapter={id:'simulation',async send(packet){sent.push(packet);return {state:'sent'};}},f=fixture([old]);let taskId='';
 try{
  const file=join(f.app.config.workspace,'subscription.txt');writeFileSync(file,'synthetic');
  const report=`[held subscription](${pathToFileURL(file).href})`;
  f.setScript(async(main,text)=>{
   if(text.endsWith('delegate')){({taskId}=await openTaskWorker(main,'synthetic work'));return {status:'completed',text:'accepted'};}
   if(text.endsWith('subscribe')){await subscribe(main,taskId);return {status:'completed',text:'subscribed'};}
   return nativeFinal(report);
  });
  const plugin=f.app.channels;assert.ok(plugin);plugin.bind(A);await f.app.start();plugin.receiveText(input(A,'subscription-delegate','delegate'));
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));const registered=plugin.receiveText(input(A,'subscription-register','subscribe'));
  await until(()=>f.app.store.request(registered)?.state==='completed');await plugin.synchronize();
  const baseline=sent.length;await assert.rejects(plugin.reconfigure('simulation',()=>{},()=>({...old,applyBindings(){throw Error('synthetic_apply_failed');}})),/synthetic_apply_failed/);
  const worker=f.engines.find(engine=>engine.options.role==='worker');assert.ok(worker?.finish);worker.finish({status:'completed',text:report});worker.finish=undefined;
  await f.app.idle();await plugin.synchronize();assert.equal(sent.length,baseline);
  const db=new DatabaseSync(join(f.app.config.runtime,'channels.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare("SELECT count(*) n FROM channel_outbox WHERE subscriptionId IS NOT NULL AND state='queued'").get()?.n,1);}finally{db.close();}
  await plugin.reconfigure('simulation',()=>{},()=>({...old,applyBindings(next:ChannelPlugin){next.configureBindings('simulation',[A]);}}));await plugin.synchronize();
  assert.deepEqual(sent.slice(baseline).map(packet=>packet.part.kind),['text','attachment']);
 }finally{await f.close();}
});


for(const revoke of [false,true])test(`claimed input waits through live reconfiguration before ${revoke?'rejecting revocation':'the same-identity turn'}`,async()=>{
 let ready=false,release!:()=>void,stop!:()=>void,connected=false,closes=0;
 const capabilities=new Promise<void>(resolve=>release=resolve),stopping=new Promise<void>(resolve=>stop=resolve);
 const old:ChannelAdapter={id:'simulation',send:async()=>({state:'sent'}),async connect(_a,_r,signal){connected=true;if(!signal.aborted)await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));await stopping;}},f=fixture([old]);
 try{
  f.app.channels!.bind(A);await f.app.start();await until(()=>connected);
  const main=f.engines[0]!,close=main.close.bind(main);
  Object.assign(main,{refreshCapabilities:async()=>{ready=true;await capabilities;}});main.close=async()=>{closes++;return close();};
  f.app.channels!.receiveText(input(A,'prepare-live','accepted input'));await until(()=>ready);
  const applying=f.app.channels!.reconfigure('simulation',()=>{},()=>({...old,applyBindings(plugin:ChannelPlugin){plugin.configureBindings('simulation',revoke?[]:[A]);}}));
  release();await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(closes,0);assert.deepEqual(f.inputs,[]);
  stop();await applying;await f.app.idle();
  assert.deepEqual(f.inputs,revoke?[]:['::message-source{source=simulation}\n\naccepted input']);assert.equal(closes,0);assert.equal(f.engines[0],main);
 }finally{release();stop();await f.close();}
});


for(const action of ['retry','cancel','restart'])test('deferred channel input survives saved failure and '+action,async()=>{
 let release:()=>void=()=>{},stop:()=>void=()=>{},ready=false;
 const capabilities=new Promise<void>(resolve=>release=resolve),stopping=new Promise<void>(resolve=>stop=resolve);
 const old:ChannelAdapter={id:'simulation',send:async()=>({state:'sent'}),async connect(_a,_r,signal){if(signal.aborted===false)await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));await stopping;}},f=fixture([old]);
 try{
  const plugin=f.app.channels;assert.ok(plugin);plugin.bind(A);await f.app.start();const main=f.engines[0];assert.ok(main);
  Object.assign(main,{refreshCapabilities:async()=>{ready=true;await capabilities;}});
  const requestId=plugin.receiveText(input(A,'defer-failure','accepted input')),original=f.app.inputs.byRequestIds([requestId])[0];assert.ok(original);await until(()=>ready);
  const applying=plugin.reconfigure('simulation',()=>{},()=>({...old,applyBindings(){throw Error('synthetic_apply_failed');}}));
  const failed=assert.rejects(applying,/synthetic_apply_failed/);void failed.catch(()=>{});release();
  await until(()=>f.app.inputs.byRequestIds([requestId])[0]?.state==='queued');stop();await failed;await f.app.idle();
  const queued=f.app.inputs.byRequestIds([requestId])[0];assert.ok(queued);assert.equal(queued.messageId,original.messageId);assert.equal(queued.replyId,original.replyId);assert.equal(f.app.store.request(requestId),undefined);assert.deepEqual(f.inputs,[]);
  if(action==='cancel')f.app.cancelQueued({requestId,operationId:'cancel-deferred',expectedRevision:queued.revision});
  if(action==='restart')await f.restart();
  else await plugin.reconfigure('simulation',()=>{},()=>({...old,applyBindings(next:ChannelPlugin){next.configureBindings('simulation',[A]);}}));
  await f.app.idle();await f.app.channels?.synchronize();assert.deepEqual(f.inputs,action==='cancel'?[]:['::message-source{source=simulation}\n\naccepted input']);
  assert.equal(f.app.inputs.byRequestIds([requestId])[0]?.state,action==='cancel'?'cancelled':'completed');
  if(action==='retry')assert.equal(f.engines[0],main);
 }finally{release();stop();await f.close();}
});


for(const action of ['retry','cancel','revoke'])test('deferred Telegram background remains scoped through '+action,async()=>{
 let release:()=>void=()=>{},loading=false,loads=0;const gate=new Promise<void>(resolve=>release=resolve);
 const address={...A,adapterId:'telegram'},old:ChannelAdapter={id:'telegram',send:async()=>({state:'sent'})},f=fixture([old]);
 try{
  const plugin=f.app.channels;assert.ok(plugin);const binding=plugin.bind(address),groups=plugin.telegramGroups();await f.app.start();
  const date=Math.floor(Date.now()/1000);groups.membership(binding,-1001,true,date,1);groups.caughtUp(binding);
  groups.submit(binding,-1001,date,2,2,null,'group question',async()=>{loads++;loading=true;await gate;return [{id:1,text:'scoped background'}];});
  await until(()=>loading);const queued=f.app.inputs.list()[0];assert.ok(queued);const requestId=queued.input.requestId;
  await assert.rejects(plugin.reconfigure('telegram',()=>{},()=>({...old,applyBindings(){throw Error('synthetic_apply_failed');}})),/synthetic_apply_failed/);
  release();await f.app.idle();assert.equal(f.app.inputs.byRequestIds([requestId])[0]?.state,'queued');
  if(action==='cancel'){const pending=f.app.inputs.byRequestIds([requestId])[0];assert.ok(pending);f.app.cancelQueued({requestId,operationId:'cancel-background',expectedRevision:pending.revision});}
  if(action==='revoke')groups.membership(binding,-1001,false,date,3);
  await plugin.reconfigure('telegram',()=>{},()=>({...old,applyBindings(next:ChannelPlugin){next.configureBindings('telegram',[address]);}}));groups.caughtUp(binding);await f.app.idle();
  assert.equal(f.inputs.length,action==='retry'?1:0);
  if(action==='retry'){assert.match(f.inputs[0]??'',/scoped background/);assert.equal((f.inputs[0]??'').match(/scoped background/g)?.length,1);assert.equal(loads,1);}
  else assert.equal(loads,1);
  assert.equal(plugin.takeTelegramBackground(requestId),undefined);
 }finally{release();await f.close();}
});
