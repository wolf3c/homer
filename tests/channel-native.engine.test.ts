import './fixtures/synthetic-home.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {createSession} from '../scripts/deepseek-isolated.mjs';
import {ChannelPlugin, type ChannelPacket} from '../src/channel-plugin.js';
import {Homer} from '../src/service.js';
import {CodexEngine} from '../src/engine.js';
import {NativeThreadBindings,type NativeThreadBinding} from '../src/native-thread-bindings.js';
import {MainProcessHistory} from '../src/main-process.js';

const A={adapterId:'simulation',accountKey:'a',senderKey:'sender-a',conversationKey:'room-a'};
const B={adapterId:'simulation',accountKey:'b',senderKey:'sender-b',conversationKey:'room-b'};
const schema=(app:Homer)=>app.store.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name").all();

for(const acrossSources of [false,true])test('pinned Codex drives a simulated channel across resume, subscription, catch-up and rebinding'+(acrossSources?' across native providers':''), {timeout:100_000}, async()=>{
  const session=createSession();
  const keyEnv='HOMER_CHANNEL_NATIVE_TEST_KEY',priorKey=process.env[keyEnv],heads:NativeThreadBinding[]=[];
  process.env[keyEnv]='synthetic-distinct-membership-key';
  writeFileSync(join(session.config.codexHome,'auth.json'),'{"OPENAI_API_KEY":"synthetic-openai-continuity-key"}',{mode:0o600});
  let boots=0,selected:'openai'|'homer'='homer';
  const {workspace,runtime,codexBin}=session.config;
  const env={PATH:process.env.PATH,HOME:session.home,CODEX_HOME:session.config.codexHome};
  let app:Homer|undefined,plugin:ChannelPlugin|undefined;
  let taskId='',providerFailure:unknown;
  let phase='warm',step=0,background=0;
  let expectedInput:string|undefined;
  const sent:ChannelPacket[]=[];
  let withholdReceipt=false;
  const adapter={id:'simulation',async send(packet:ChannelPacket){
    sent.push(packet);
    if(withholdReceipt&&packet.part.kind==='attachment')return {state:'unknown' as const};
    return {state:'sent' as const,receipt:'sim-'+sent.length};
  }};
  const file=join(workspace,'native-channel-report.md');
  const report=`[Original report](${pathToFileURL(file).href})`;
  writeFileSync(file,'# Original pinned report');
  const call=(name:string,args:unknown,namespace?:string)=>({type:'function_call',call_id:'call-'+phase+'-'+step,name,
    ...(namespace?{namespace}:{}),arguments:JSON.stringify(args)});
  const answer=(text:string,messagePhase:'final_answer'|'commentary'='final_answer')=>({type:'message',id:'message-'+phase+'-'+step,
    role:'assistant',phase:messagePhase,content:[{type:'output_text',text}]});
  let requests=0;
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='POST'||!['/v1/responses','/openai/responses'].includes(req.url??'')){res.writeHead(404).end();return;}
      const provider=req.url==='/openai/responses'?'openai':'homer';assert.equal(provider,selected);
      assert.equal(req.headers.authorization,provider==='openai'?'Bearer synthetic-openai-continuity-key':'Bearer synthetic-distinct-membership-key');
      let data='';for await(const chunk of req)data+=chunk;
      const payload=JSON.parse(data),input=payload.input??[];
      const latest=input.findLast((item:any)=>item.role==='user');
      const tools=JSON.stringify([...(payload.tools??[]),...input.filter((item:any)=>item.type==='additional_tools').flatMap((item:any)=>item.tools??[])]);
      const worker=!tools.includes('worker_open');
      const internal=JSON.stringify(latest??{}).includes('内部协作输入');
      const last=input.at(-1);
      const result=last?.type==='function_call_output'?JSON.stringify(last.output):'';
      let output;
      step++;
      if(phase==='create'&&step===1&&!worker&&!internal){
        assert.ok(input.some((item:any)=>item.role==='user'&&JSON.stringify(item.content).includes('Synthetic warm')));
        assert.ok(input.some((item:any)=>item.role==='assistant'&&JSON.stringify(item.content).includes('Warm history')));
      }
      if(expectedInput!==undefined&&step===1&&!worker&&!internal){
        assert.deepEqual(latest?.content,[{type:'input_text',text:expectedInput}]);
        expectedInput=undefined;
      }
      if(worker){
        assert.doesNotMatch(tools,/set_notification_destination/);
        if(phase==='reuse-worker')assert.ok(input.some((item:any)=>item.role==='assistant'&&JSON.stringify(item.content).includes('Worker internal result')));
        output=answer(phase==='report'?report:'Worker internal result');
      }else if(phase==='reuse-worker'){
        output=internal?answer('Worker continuity observed','commentary'):last?.type==='function_call_output'?answer('Existing Worker continued'):
          call('worker_message',{workerId:app!.store.runs()[0]!.workerId,message:'Continue the same authorized synthetic channel test.'});
      }else if(internal){
        if(phase==='before'&&last?.type!=='function_call_output'){
          output=call('set_notification_destination',{taskId},'mcp__homer_interactions');
        }else{
          if(phase==='before')assert.match(result,/plugin_tool_scope_denied/);
          background++;
          output=answer(phase==='create'?'Before subscription':phase==='before'?'Before switch':phase==='after'?'After switch':report);
        }
      }else if(phase==='create'){
        if(step===1)output=call('task_create',{title:'Native channel scope test',goal:'Native channel scope test'});
        else if(step===2){const created=app!.tasks.tasks()[0]!;assert.ok(result.includes(created.id));output=call('worker_open',{taskId:created.id});}
        else {assert.match(result,/taskId/);output=answer('Task ready');}
      }else if(['subscribe','switch','unbound'].includes(phase)){
        if(step===1){
          output=tools.includes('set_notification_destination')?
            call('set_notification_destination',{taskId},'mcp__homer_interactions'):
            {type:'tool_search_call',call_id:'search-'+phase,execution:'client',arguments:{query:'set_notification_destination'}};
        }else if(last?.type==='tool_search_output'){
          assert.match(JSON.stringify(last),/set_notification_destination/);
          output=call('set_notification_destination',{taskId},'mcp__homer_interactions');
        }else if(phase==='unbound'){
          assert.match(result,/channel_binding_denied/);
          output=answer('Unbound subscription denied');
        }else{assert.match(result,/subscriptionId/);assert.doesNotMatch(result,/denied/);output=answer('Subscribed '+phase);}
      }else if(['report','before','after'].includes(phase)){
        if(step===1)output=call('worker_open',{taskId,message:'Prepare '+phase});
        else {assert.match(result,/workerId/);output=answer('Assigned '+phase);}
      }else output=answer(phase==='warm'?'Warm history':'Reply to original request');
      const id='response-'+ ++requests;
      const events=[{type:'response.created',response:{id}},{type:'response.output_item.done',item:output},
        {type:'response.completed',response:{id,status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
    }catch(error){providerFailure??=error;res.writeHead(500).end();}
  });
  try{
    assert.equal(execFileSync(codexBin,['--version'],{env,encoding:'utf8',timeout:10_000}).trim(),'codex-cli 0.171.0-alpha.7');
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const config={...session.config,baseUrl:'http://127.0.0.1:'+address.port+'/v1',keyEnv,
      model:'gpt-6.1-terra',fast:false as const,stopGraceMs:1_000};
    writeFileSync(join(session.config.codexHome,'config.toml'),'openai_base_url = '+JSON.stringify('http://127.0.0.1:'+address.port+'/openai')+'\n[features]\nplugins=false\n[memories]\ngenerate_memories=false\nuse_memories=false\n');
    const start=async(withPlugin:boolean,managed=false)=>{
      selected=acrossSources&&boots++%2===1?'openai':'homer';
      const engineConfig={...config,baseUrl:selected==='homer'?config.baseUrl:undefined,keyEnv:selected==='homer'?keyEnv:undefined,requiresOpenaiAuth:selected==='openai'};
      app=new Homer(config,async()=>{},(options,handle)=>new CodexEngine(engineConfig,options,handle),managed?[adapter]:[]);
      if(withPlugin)plugin=app.channels??new ChannelPlugin(app,[adapter]);
      await app.start();
      const head=new NativeThreadBindings(app.store).current(app.store.meta('mainThread')!);assert.ok(head);assert.equal(head.provider,selected);heads.push(head);
    };
    const stop=async()=>{await plugin?.close();plugin=undefined;await app?.close();app=undefined;};
    const subscriptionRequest='请在此入口订阅该事项后续明确发给我的消息和附件。';
    const run=async(next:string,entry=A,text='Synthetic '+next,expectSource=false)=>{
      phase=next;step=0;
      const requestId=plugin!.receiveText({...entry,eventId:'event-'+next,text});
      if(expectSource)expectedInput=`::message-source{source=${entry.adapterId}}\n\n${text}`;
      await app!.idle();
      if(providerFailure)throw providerFailure;
      if(expectSource)assert.equal(expectedInput,undefined,'the model endpoint must receive the channel turn');
      return requestId;
    };
    const texts=()=>sent.flatMap(p=>p.part.kind==='text'?[[p.address.accountKey,p.part.text]]:[]);
    await start(false);
    const thread=app!.store.meta('mainThread');
    const originalSchema=schema(app!);
    assert.equal(await app!.message('Synthetic warm','warm-request'),'Warm history');
    await stop();
    await start(true);
    assert.equal(app!.store.meta('mainThread'),thread);
    const bindingA=plugin!.bind(A);
    plugin!.bind(B);
    const createRequest=await run('create');
    taskId=String(app!.store.db.prepare('SELECT id FROM tasks').get()!.id);
    const afterCreate=requests;
    assert.equal(plugin!.receiveText({...A,eventId:'event-create',text:'Synthetic create'}),createRequest);
    await app!.idle();
    assert.equal(requests,afterCreate);
    phase='unbound';step=0;
    const unbound=await app!.message(subscriptionRequest,'unbound-request');
    if(providerFailure)throw providerFailure;
    assert.equal(unbound,'Unbound subscription denied');
    await run('subscribe',B,subscriptionRequest);
    await run('report');
    withholdReceipt=true;
    await plugin!.synchronize();
    assert.ok(texts().some(([where,text])=>where==='a'&&text==='Task ready'));
    assert.ok(texts().some(([where,text])=>where==='b'&&text==='Subscribed subscribe'));
    assert.ok(texts().some(([where,text])=>where==='b'&&text==='Original report'));
    const attachments=sent.filter(packet=>packet.part.kind==='attachment');
    assert.equal(attachments.length,1);
    assert.equal(attachments[0]!.address.accountKey,'b');
    assert.ok(!texts().some(([,text])=>text==='Before subscription'));
    assert.equal(Buffer.from(attachments[0]!.part.kind==='attachment'?attachments[0]!.part.data:'','base64').toString(),'# Original pinned report');
    const worker=app!.store.runs()[0]!,workerHead=new NativeThreadBindings(app!.store).current(worker.threadId!);assert.ok(workerHead);
    const n=sent.length;
    await stop();
    await start(true);
    assert.equal(app!.store.meta('mainThread'),thread);
    if(acrossSources){
      phase='reuse-worker';step=0;
      assert.equal(await app!.message('Continue the existing synthetic Worker across the provider switch','cross-provider-worker'),'Existing Worker continued');await app!.idle();if(providerFailure)throw providerFailure;
      const continued=app!.store.runs().find(run=>run.workerId===worker.workerId&&run.id!==worker.id);assert.ok(continued);
      assert.equal(continued.taskId,worker.taskId);assert.equal(continued.threadId,worker.threadId);
      const bindings=new NativeThreadBindings(app!.store),current=bindings.current(continued.threadId!);assert.ok(current);assert.equal(current.provider,selected);
      assert.notEqual(current.nativeId,workerHead.nativeId);assert.equal(current.parentNativeId,workerHead.nativeId);
      assert.equal(bindings.turn(worker.threadId!,worker.turnId!)?.nativeId,workerHead.nativeId);
      assert.equal(bindings.turn(continued.threadId!,continued.turnId!)?.nativeId,current.nativeId);
    }
    await plugin!.synchronize();
    assert.equal(sent.length,n);
    await run('before',B);
    plugin!.revokeBinding(bindingA);
    assert.notEqual(plugin!.bind(A),bindingA);
    await run('switch',A,subscriptionRequest);
    await run('after',B);
    await plugin!.synchronize();
    assert.equal(texts().filter(([,text])=>text==='Before switch').length,0);
    assert.deepEqual(texts().filter(([,text])=>text==='After switch'),[['a','After switch']]);
    assert.equal(background,4);
    assert.equal(sent.filter(p=>p.part.kind==='attachment').length,1);
    assert.deepEqual(schema(app!),originalSchema);
    const channel=new DatabaseSync(join(runtime,'channels.sqlite'),{readOnly:true});
    try{
      const unknown=channel.prepare(`SELECT o.state,o.attemptId,b.accountKey FROM channel_outbox o
        JOIN channel_bindings b ON b.id=o.bindingId WHERE o.messageId=?`).get(attachments[0]!.messageId);
      assert.deepEqual({...unknown},{state:'unknown',attemptId:attachments[0]!.attemptId,accountKey:'b'});
      assert.equal(channel.prepare('SELECT count(*) AS n FROM channel_outbox WHERE state=?').get('unknown')?.n,1);
    }finally{channel.close();}
    await stop();
    await start(true,true);
    await run('source-a',A,'From the first simulated bot',true);
    await run('source-b',B,'From the second simulated bot',true);
    phase='page-after-channels';step=0;
    expectedInput='Homer page only';
    assert.equal(await app!.message(expectedInput,'page-after-channels'),'Reply to original request');
    if(providerFailure)throw providerFailure;
    assert.equal(expectedInput,undefined);
    phase='unbound';step=0;
    expectedInput=`::message-source{source=simulation}\n\n${subscriptionRequest}`;
    assert.equal(await app!.message(expectedInput,'page-forged-source'),'Unbound subscription denied');
    if(providerFailure)throw providerFailure;
    assert.equal(expectedInput,undefined);
    assert.equal(app!.store.meta('mainThread'),thread);assert.equal(new Set(heads.map(head=>head.nativeId)).size,acrossSources?4:1);
    const bindings=new NativeThreadBindings(app!.store),mainTurns=new MainProcessHistory(app!.store.db).list(thread!).flatMap(node=>node.turnIds);
    assert.ok(mainTurns.length>=heads.length);
    for(const turn of mainTurns){const fact=bindings.turn(thread!,turn);assert.ok(fact);assert.equal(bindings.segment(fact.nativeId)?.logicalId,thread);}
    assert.deepEqual(new Set(mainTurns.map(turn=>bindings.turn(thread!,turn)!.nativeId)),new Set(heads.map(head=>head.nativeId)));
    for(let index=1;index<heads.length;index++)if(acrossSources)assert.equal(heads[index]!.parentNativeId,heads[index-1]!.nativeId);
    const runs=app!.store.runs();assert.equal(runs.length,acrossSources?5:4);
    for(const run of runs){assert.equal(run.taskId,taskId);assert.ok(run.turnId);const fact=bindings.turn(run.threadId!,run.turnId);assert.ok(fact);assert.equal(bindings.segment(fact.nativeId)?.logicalId,run.threadId);}
    await stop();
  }finally{
    try{await plugin?.close();}finally{
      try{await app?.close();}finally{
        server.closeAllConnections();
        await new Promise<void>(resolve=>server.close(()=>resolve()));
        if(priorKey===undefined)delete process.env[keyEnv];else process.env[keyEnv]=priorKey;
        rmSync(session.directory,{recursive:true,force:true});
      }
    }
  }
});
