import './fixtures/synthetic-home.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import test from 'node:test';
import {createSession} from '../scripts/deepseek-isolated.mjs';
import {Homer} from '../src/service.js';
import {memberCatalogPath} from '../src/member-models.js';
import {callHostMcp} from './fixtures/host-mcp-call.js';
import {hostMcpTools} from '../src/worker-interaction-mcp.js';
import {CodexEngine,EngineRpcUnconfirmed,type Tool} from '../src/engine.js';

async function loopback(reply:(payload:any,seq:number,worker:boolean)=>unknown){
  const session=createSession();
  let failure:unknown,sequence=0;
  const server=createServer(async(req,res)=>{
    try{
      if(!['/v1/responses','/v1/worker/responses'].includes(req.url??'')){res.writeHead(404).end();return;}
      let raw='';for await(const chunk of req)raw+=chunk;
      const payload=JSON.parse(raw);
      if(payload.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
      const id='resp-'+ ++sequence,item=await reply(payload,sequence,req.url==='/v1/worker/responses');
      const events=[{type:'response.created',response:{id}},{type:'response.output_item.done',item},
        {type:'response.completed',response:{id,status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
      res.writeHead(200,{'content-type':'text/event-stream'}).end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));
    }catch(e){failure??=e;res.writeHead(500).end();}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const config={...session.config,baseUrl:'http://127.0.0.1:'+address.port+'/v1',keyEnv:undefined,model:'gpt-6.1-terra',stopGraceMs:1000};
  return {session,config,async close(){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));rmSync(session.directory,{recursive:true,force:true});if(failure)throw failure;}};
}
const answer=(id:number)=>({type:'message',id:'msg-'+id,role:'assistant',content:[{type:'output_text',text:'Observed.'}]});
const exec=(id:number,input:string)=>({type:'custom_tool_call',id:'fc-'+id,namespace:'functions',name:'exec',call_id:'call-'+id,input});

test('opt-in Worker question goes through Main and receives a free text answer after ten minutes',{timeout:670000},async()=>{
  let app:Homer,askedAt=0,delivered=false;
  const f=await loopback((p,seq,worker)=>{
    const user=JSON.stringify(p.input.findLast((item:any)=>item.role==='user')?.content);
    const last=p.input.at(-1),result=last?.type==='function_call_output';
    const call=(name:string,args:unknown)=>({type:'function_call',namespace:'mcp__homer_interactions',name,call_id:'call-'+seq,arguments:JSON.stringify(args)});
    if(worker){
      if(!askedAt){
        askedAt=performance.now();
        return {type:'function_call',name:'request_user_input',call_id:'input',arguments:JSON.stringify({questions:[{id:'format',header:'Format',question:'Which synthetic format?',options:[{label:'Text',description:'Plain text'},{label:'PDF',description:'Print document'}]}]})};
      }
      assert.match(JSON.stringify(last),/SYNTHETIC_FREE_TEXT/);delivered=true;return answer(seq);
    }
    if(user.includes('SYNTHETIC_OPEN')){
      if(!result)return call('task_create',{title:'Synthetic format',goal:'Ask about the output format.'});
      if(!app.store.runs().length)return call('worker_open',{taskId:app.tasks.tasks()[0]!.id});
    }else if(user.includes('interactionId=')){
      const interactionId=app.interactions.list()[0]!.id;
      if(!result)return call('inspect_interaction',{interactionId});
      const prior=p.input.findLast((item:any)=>item.type==='function_call');
      if(prior?.name==='inspect_interaction')return user.includes('SYNTHETIC_FREE_TEXT')
        ?call('respond_interaction',{interactionId,action:'answer',reason:'User supplied format',answers:[{questionId:'format',answers:['SYNTHETIC_FREE_TEXT']}]})
        :call('escalate_interaction',{interactionId,question:'Which format?',reason:'User selects format'});
    }
    return answer(seq);
  });
  appendFileSync(join(f.config.codexHome,'config.toml'),'\n[features]\ndefault_mode_request_user_input = true\n');
  app=new Homer(f.config,async()=>{},(options,handle)=>new CodexEngine(options.role==='worker'?{...f.config,baseUrl:f.config.baseUrl+'/worker'}:f.config,options,handle));
  try{
    await app.start();await app.message('SYNTHETIC_OPEN','synthetic-open');
    assert.equal(await app.idle({returnOnUserWait:true}),'waiting_user');
    const pending=app.interactions.list()[0]!;
    assert.equal(pending.source,'native');assert.equal(pending.state,'pending_user');
    await new Promise(done=>setTimeout(done,600100));
    await app.message('SYNTHETIC_FREE_TEXT','synthetic-answer',undefined,pending.id);await app.idle();
    const after=app.interactions.inspect(pending.id),run=app.tasks.run(pending.runId);
    assert.ok(delivered&&after.deliveredAt&&performance.now()-askedAt>600000);
    assert.equal(run.threadId,pending.threadId);assert.equal(run.turnId,pending.turnId);assert.equal(run.status,'succeeded');
  }finally{try{await app.close();}finally{await f.close();}}
});

test('pinned Worker question availability in the product mode and without suggested options',async()=>{
  for(const optIn of [false,true]){
    let observed=false;
    const f=await loopback((p,seq)=>{
      if(seq===1)return {type:'function_call',name:'request_user_input',call_id:'input',arguments:JSON.stringify({questions:[{id:'format',header:'Format',question:'Which format?',options:[]}]})};
      const result=JSON.stringify(p.input.at(-1));
      assert.match(result,optIn?/requires non-empty options/:/unavailable|unsupported|unknown|not available|not found|not supported/i);
      observed=true;return answer(seq);
    });
    if(optIn)appendFileSync(join(f.config.codexHome,'config.toml'),'\n[features]\ndefault_mode_request_user_input = true\n');
    const e=new CodexEngine(f.config,{cwd:f.config.workspace,role:'worker',nativeTools:'worker',instructions:'Synthetic Worker.',readRoots:[],tools:[],
      onInteraction:async()=>{throw Error('unexpected_interaction');}},async()=>{throw Error('unexpected_dynamic_tool');});
    try{await e.start();await e.turn('Ask an open question.');assert.ok(observed);}
    finally{try{await e.close();}finally{await f.close();}}
  }
});

test('answering an interrupted native question cannot deliver into the next Worker turn',{timeout:20000},async()=>{
  let asked!:()=>void,release!:()=>void,delivered=false;
  const pending=new Promise<void>(done=>{asked=done;}),reply=new Promise<void>(done=>{release=done;});
  const f=await loopback((p,seq)=>{
    if(seq===1)return {type:'function_call',name:'request_user_input',call_id:'input',arguments:JSON.stringify({questions:[{id:'format',header:'Format',question:'Which format?',options:[{label:'Text',description:'Simple text'},{label:'PDF',description:'Print'}]}]})};
    assert.doesNotMatch(JSON.stringify(p.input),/SYNTHETIC_LATE/);return answer(seq);
  });
  appendFileSync(join(f.config.codexHome,'config.toml'),'\n[features]\ndefault_mode_request_user_input = true\n');
  const e=new CodexEngine(f.config,{cwd:f.config.workspace,role:'worker',nativeTools:'worker',instructions:'Synthetic Worker.',readRoots:[],tools:[],
    onInteraction:async()=>{asked();await reply;return {status:'answered',decision:{action:'answer',answers:{format:['SYNTHETIC_LATE']},reason:'Synthetic'}};}},async()=>{throw Error('unexpected_dynamic_tool');});
  e.on('interactionDelivered',()=>{delivered=true;});
  try{
    await e.start();const original=e.turn('Ask a question.');await pending;
    await e.interrupt();assert.equal((await original).status,'interrupted');
    const next=e.turn('Continue independently.');release();
    assert.equal((await next).status,'completed');assert.equal(delivered,false);
  }finally{release();try{await e.close();}finally{await f.close();}}
});

const homerNamespace='mcp__homer_interactions';

function assertFirstPacketCatalog(request:any,catalog:Tool[],field:string,direct:boolean){
  // A resume may replay older declarations before the current one.
  const groups=[...(request.tools??[]),...request.input.filter((item:any)=>item.type==='additional_tools').flatMap((item:any)=>item.tools)];
  const homer=groups.findLast(group=>group.name===homerNamespace);
  const expected=catalog.map(tool=>tool.name).sort();
  if(direct){
    assert.ok(homer,'expected native Homer function declarations');
    assert.deepEqual(homer.tools.map((tool:any)=>tool.name).sort(),expected);
    assert.deepEqual(homer.tools.find((tool:any)=>tool.name==='echo').parameters,catalog[0]!.inputSchema);
    return;
  }
  assert.equal(homer,undefined,'Homer tools should only be advertised inside exec');
  const description=groups.flatMap(group=>group.name==='functions'?group.tools:[group])
    .findLast(tool=>tool.name==='exec'&&tool.type==='custom')?.description;
  assert.ok(typeof description==='string','expected the functions.exec declaration in the first request');
  const names=Array.from(description.matchAll(/\bmcp__homer_interactions__(\w+)\(/g),match=>match[1]);
  assert.deepEqual(names.sort(),expected,'the first exec declaration must contain each current role tool exactly once');
  const signature=new RegExp('__echo\\(args:\\s*\\{\\s*'+field+':\\s*string\\s*[,;]?\\s*\\}');
  assert.ok(signature.test(description),'exec must declare exactly the current required echo argument');
}

for(const profile of ['Code Mode','bundled GPT','DeepSeek','direct-only control'] as const)
  test('pinned Homer role catalog on cold resume: '+profile,{timeout:90000},async t=>{
    const fields=['oldValue','newValue','latestValue'];
    const echo=homerNamespace+'__echo';
    let role:'main'|'worker'='main',field='',stage=0,catalog:Tool[]=[];
    const f=await loopback((p,seq)=>{
      stage++;
      const marker=field==='oldValue'?'retired':'added';
      const directOnly=profile==='direct-only control'&&field!=='oldValue';
      const direct=directOnly||profile==='DeepSeek';
      const accepted='accepted-'+role+'-'+field;
      if(stage===1){
        if(field!=='oldValue'){
          const oldCall=p.input.some((item:any)=>{
            if(item.type==='custom_tool_call')return item.input.includes(echo+'({oldValue:');
            return item.type==='function_call'&&item.name==='echo'&&Object.hasOwn(JSON.parse(item.arguments),'oldValue');
          });
          assert.ok(oldCall,'expected the successful A call in the resumed thread');
          assertFirstPacketCatalog(p,catalog,field,direct);
        }
        if(direct)return {type:'function_call',namespace:homerNamespace,name:'echo',call_id:'call-'+seq,arguments:JSON.stringify({[field]:role})};
        return exec(seq,'const first=await tools.'+echo+'({'+field+':'+JSON.stringify(role)+'});\n'+
          'text(await tools.'+homerNamespace+'__'+marker+'({receipt:first.content[0].text}));');
      }
      const result=JSON.stringify(p.input.at(-1));
      if(stage===2){
        assert.ok(result.includes(direct?accepted:'used-'+accepted),'tool handler must confirm the current arguments');
        if(directOnly)return exec(seq,'text(await tools.'+echo+'({'+field+':'+JSON.stringify(role)+'}));');
      }else{
        assert.ok(directOnly&&stage===3);
        assert.ok(result.includes('tools.'+echo+' is not a function'));
      }
      return answer(seq);
    });
    try{
      assert.equal(execFileSync(f.config.codexBin,['--version'],{env:{HOME:f.session.home,CODEX_HOME:f.config.codexHome},encoding:'utf8'}).trim(),'codex-cli 0.171.0-alpha.7');
      const fixture=join(f.session.directory,'fixture.mjs'),toolsFile=join(f.session.directory,'tools.json');
      writeFileSync(fixture,`import {createInterface} from 'node:readline';import {readFileSync} from 'node:fs';
const tools=JSON.parse(readFileSync(process.argv[2],'utf8'));let receipt;
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;
  let result={};
  if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'upgrade',version:'1'}};
  if(m.method==='tools/list')result={tools};
  if(m.method==='tools/call'){
    const {name,arguments:args}=m.params,key=tools[0].inputSchema.required[0];let text;
    if(name==='echo'&&Object.keys(args).length===1&&['main','worker'].includes(args[key]))text=receipt='accepted-'+args[key]+'-'+key;
    if(name===tools[1].name&&receipt&&args.receipt===receipt)text='used-'+receipt;
    result={isError:!text,content:[{type:'text',text:text??'invalid_test_arguments'}]};
  }
  console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
});`);
      const configPath=join(f.config.codexHome,'config.toml'),originalConfig=readFileSync(configPath,'utf8');
      const config=profile==='DeepSeek'?{...f.config,model:'deepseek-flash'}:f.config;
      const roles=profile==='Code Mode'||profile==='direct-only control'?['main','worker'] as const:['main'] as const;
      for(const kind of roles){
        role=kind;let threadId:string|undefined;
        writeFileSync(configPath,(profile==='bundled GPT'?'model_catalog_json='+JSON.stringify(memberCatalogPath)+'\n':'')+originalConfig);
        for(field of profile==='Code Mode'?fields:fields.slice(0,2)){
          const directOnly=profile==='direct-only control'&&field!=='oldValue';
          if(directOnly)appendFileSync(configPath,'\n[features.code_mode]\ndirect_only_tool_namespaces=["mcp__homer_interactions"]\n');
          stage=0;
          catalog=[
            {name:'echo',type:'function',description:'Synthetic echo',inputSchema:{type:'object',properties:{[field]:{type:'string'}},required:[field]}},
            {name:field==='oldValue'?'retired':'added',type:'function',description:'Confirm the preceding echo',inputSchema:{type:'object',properties:{receipt:{type:'string'}},required:['receipt']}},
            ...hostMcpTools(kind),
          ];
          writeFileSync(toolsFile,JSON.stringify(catalog));
          const engine=new CodexEngine(config,{role:kind,nativeTools:kind,cwd:config.workspace,readRoots:[],instructions:'Synthetic upgrade.',tools:[],threadId,
            interactionMcp:{command:process.execPath,cwd:config.workspace,args:[fixture,toolsFile],catalog}},async()=>{throw Error('unexpected_dynamic_tool');});
          try{
            const active=await engine.start();if(threadId)assert.equal(active,threadId);threadId=active;
            const status=await engine.request('mcpServerStatus/list',{threadId,serverName:'homer_interactions',detail:'full'});
            assert.deepEqual(status.data[0].tools.echo.inputSchema.required,[field]);
            assert.equal((await engine.turn('继续原事项')).status,'completed');
            assert.equal(stage,directOnly?3:2);
            if(profile==='Code Mode')t.diagnostic(JSON.stringify({role,threadId,required:field,handlerMatched:true}));
          }finally{await engine.close();}
        }
      }
    }finally{await f.close();}
  });

for(const direct of [false,true])test('Homer writes require live role identity and recover a lost reply: '+(direct?'direct-only control':'Code Mode'),{timeout:45000},async()=>{
  let app:Homer,main:CodexEngine,worker:CodexEngine,workerDenied=false,lostReply=false,recovered=false;
  let taskId='',workerId='',operationKey='',workerStarts=0;
  const create={title:'Synthetic dispatch',goal:'Continue the synthetic assignment.'};
  const f=await loopback(async(p,seq,isWorker)=>{
    const call=(name:string,args:unknown)=>direct
      ? {type:'function_call',namespace:homerNamespace,name,call_id:'direct-'+seq,arguments:JSON.stringify(args)}
      : exec(seq,'text(await tools.'+homerNamespace+'__'+name+'('+JSON.stringify(args)+'));');
    const last=p.input.at(-1),result=last?.type===(direct?'function_call_output':'custom_tool_call_output');
    const user=JSON.stringify(p.input.findLast((item:any)=>item.role==='user')?.content);
    const output=JSON.stringify(last?.output);
    if(isWorker){
      if(!result){
        await assert.rejects(callHostMcp(worker.options,'task_create',create),/interaction_tool_denied/);
        return call('task_create',create);
      }
      assert.match(output,direct?/unsupported call: .*task_create/:/task_create is not a function/);
      workerDenied=true;
    }else if(user.includes('DIRECT_DISPATCH')){
      if(!result){
        await assert.rejects(callHostMcp(main.options,'task_create',create),/schedule_call_scope_denied/);
        assert.equal(app.tasks.tasks().length,0);
        return call('task_create',create);
      }
      if(!taskId){taskId=app.tasks.tasks()[0]!.id;return call('worker_open',{taskId});}
      assert.match(output,/interaction_result_unconfirmed/);
      lostReply=true;
    }else if(user.includes('DIRECT_RECEIPT')){
      if(!result)return call('worker_read',{workerId});
      const parts=Array.isArray(last.output)?last.output.map((part:any)=>part.text).join(''):last.output;
      const envelope=JSON.parse(parts.slice(parts.indexOf('{')));
      const value=Array.isArray(envelope.content)?JSON.parse(envelope.content[0].text):envelope;
      if(!operationKey){
        operationKey=value.messages.find((m:any)=>m.kind==='worker_input').operationKey;
        return call('work_inspect',{operationKey});
      }
      const [receipt]=value.operations;
      assert.equal(receipt.state,'confirmed');
      assert.equal(receipt.response.workerId,workerId);
      recovered=true;
    }
    return answer(seq);
  });
  if(direct)appendFileSync(join(f.config.codexHome,'config.toml'),'\n[features.code_mode]\ndirect_only_tool_namespaces=["mcp__homer_interactions"]\n');
  const start=()=>new Homer(f.config,async()=>{},(options,handle)=>{
    const e=new CodexEngine(options.role==='worker'?{...f.config,baseUrl:f.config.baseUrl+'/worker'}:f.config,options,handle);
    if(options.role==='worker'){worker=e;workerStarts++;}else main=e;
    return e;
  });
  app=start();
  try{
    await app.start();
    const dispatch=app['mainTool'].bind(app);
    app['mainTool']=async call=>{
      const response=await dispatch(call);
      if(call.tool==='worker_open'){
        const sockets=app['interactionMcp']!['sockets'];
        assert.equal(sockets.size,1);
        for(const socket of sockets)socket.destroy();
      }
      return response;
    };
    await app.message('DIRECT_DISPATCH','direct-dispatch');await app.idle();
    assert.ok(lostReply&&workerDenied);
    const runs=app.store.runs();assert.equal(runs.length,1);
    workerId=runs[0]!.workerId;assert.equal(runs[0]!.status,'succeeded');
    assert.equal(app.tasks.tasks().length,1);
    const thread=app.store.meta('mainThread');
    await app.close({requireAllOwnersConfirmed:true});
    app=start();await app.start();assert.equal(app.store.meta('mainThread'),thread);
    await app.message('DIRECT_RECEIPT','direct-receipt');await app.idle();
    assert.ok(recovered);
    assert.equal(workerStarts,1);assert.equal(app.store.runs().length,1);
    const inputs=app.store.db.prepare("SELECT r.state,r.processedBy FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id WHERE m.kind='worker_input' AND m.operationKey=?").all(operationKey);
    assert.equal(inputs.length,1);assert.equal(inputs[0]!.state,'processed');assert.equal(inputs[0]!.processedBy,runs[0]!.id);
  }finally{try{await app.close({requireAllOwnersConfirmed:true});}finally{await f.close();}}
});

for(const route of ['steer','refused steer','lost receipt','stop','queued restart','cold resume after ten minutes'] as const)test('business question via '+route,{timeout:route==='cold resume after ten minutes'?670000:45000},async t=>{
  const active=['steer','refused steer','lost receipt'].includes(route);
  let release!:()=>void;
  const hold=new Promise<void>(done=>{release=done;});
  t.signal.addEventListener('abort',()=>release(),{once:true});
  let app:Homer,askedAt=0,replies=0;
  const f=await loopback(async(p,seq,worker)=>{
    const user=JSON.stringify(p.input.findLast((item:any)=>item.role==='user')?.content);
    const last=p.input.at(-1),result=last?.type==='custom_tool_call_output';
    const call=(name:string,args:unknown)=>exec(seq,'text(await tools.mcp__homer_interactions__'+name+'('+JSON.stringify(args)+'));');
    if(worker){
      if(user.includes('FORMAT_TEST_71')){replies++;return answer(seq);}
      if(!askedAt){askedAt=performance.now();return call('ask_main',{question:'Which format?'});}
      assert.match(JSON.stringify(last),/pending/);if(active)await hold;return {...answer(seq),phase:'final_answer'};
    }
    if(user.includes('START_TEST_71')){
      if(!result)return call('task_create',{title:'Format check',goal:'Ask which format to use.'});
      if(!app.store.runs().length)return call('worker_open',{taskId:app.tasks.tasks()[0]!.id});
    }else if(user.includes('interactionId=')){
      const interactionId=app.interactions.list()[0]!.id;
      if(!result)return call('inspect_interaction',{interactionId});
      const prior=p.input.findLast((item:any)=>item.type==='custom_tool_call');
      if(prior?.input.includes('__inspect_interaction('))return user.includes('FORMAT_TEST_71')
        ?call('respond_interaction',{interactionId,action:'answer',reason:'User selected format',answer:'FORMAT_TEST_71'})
        :call('escalate_interaction',{interactionId,question:'Which format?',reason:'User selects format'});
    }
    return {...answer(seq),phase:'final_answer'};
  });
  const start=()=>new Homer(f.config,async()=>{},(options,handle)=>{
    const engine=new CodexEngine(options.role==='worker'?{...f.config,baseUrl:f.config.baseUrl+'/worker'}:f.config,options,handle);
    if(options.role==='worker'&&route==='refused steer')engine.steer=async()=>{throw Error('message_target_stale');};
    if(options.role==='worker'&&route==='lost receipt'){
      const steer=engine.steer.bind(engine);
      engine.steer=async(id,text)=>{await steer(id,text);throw new EngineRpcUnconfirmed('engine_rpc_timeout');};
    }
    return engine;
  });
  app=start();
  try{
    await app.start();await app.message('START_TEST_71','open');
    await app.idle(active?{returnOnUserWait:true}:{});
    const question=app.interactions.list()[0]!;
    assert.equal(question.state,'pending_user');
    if(active){
      assert.equal(app.tasks.run(question.runId).phase,'executing');
      await app.message('FORMAT_TEST_71','answer',undefined,question.id);release();await app.idle();
      assert.equal(replies,1);
      assert.equal(app.store.runs().length,route==='refused steer'?2:1);
      assert.ok(app.store.runs().every(r=>r.threadId===question.threadId));
      if(route==='lost receipt'){
        await app.close();app=start();await app.start();await app.idle();
        assert.equal(replies,1);assert.equal(app.store.runs().length,1);assert.equal(app.interactions.inspect(question.id).deliveredAt,null);
        assert.equal(app.store.db.prepare("SELECT state FROM operations WHERE kind='worker_steer'").get()?.state,'uncertain');
      }else assert.ok(app.interactions.inspect(question.id).deliveredAt);
      return;
    }
    assert.equal(app.tasks.run(question.runId).status,'succeeded');
    assert.equal(app.upgradeStatus().safe,true);
    if(route==='stop'){
      await app.stop(question.runId);
      await assert.rejects(app.message('FORMAT_TEST_71','answer',undefined,question.id),/interaction_not_waiting_user/);
      assert.equal(app.interactions.inspect(question.id).state,'cancelled');
      assert.equal(replies,0);assert.equal(app.store.runs().length,1);return;
    }
    await app.close();app=start();await app.start();
    assert.equal(app.interactions.inspect(question.id).state,'pending_user');
    if(route==='queued restart'){
      app.tasks.claim=()=>undefined;
      await app.message('FORMAT_TEST_71','answer',undefined,question.id);
      assert.equal(app.store.runs().at(-1)?.status,'queued');assert.equal(app.interactions.inspect(question.id).deliveredAt,null);
      await app.close();app=start();await app.start();
    }else{
      await new Promise(done=>setTimeout(done,600100));
      await app.message('FORMAT_TEST_71','answer',undefined,question.id);
      assert.ok(performance.now()-askedAt>600000);
    }
    await app.idle();assert.equal(replies,1);
    const runs=app.store.runs();assert.equal(runs.length,2);assert.equal(runs[1]!.threadId,question.threadId);
    assert.notEqual(runs[1]!.turnId,question.turnId);assert.ok(app.interactions.inspect(question.id).deliveredAt);
  }finally{release();try{await app.close();}finally{await f.close();}}
});
