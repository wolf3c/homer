import './fixtures/synthetic-home.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {until} from './fixtures/worker-chat-host.js';
import {createSession} from '../scripts/deepseek-isolated.mjs';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';

function gate(){
  let release!:()=>void;
  const wait=new Promise<void>(done=>{release=done;});
  return {wait,release};
}

test('pinned Worker steers once, refuses a terminal race, and reconciles a late command before resuming its idle thread',{timeout:45000},async t=>{
  const session=createSession(),received=gate(),respond=gate(),terminal=gate(),deliver=gate();
  const supplement='SYNTHETIC_LIVE_SUPPLEMENT',stale='SYNTHETIC_STALE_SUPPLEMENT',followup='SYNTHETIC_IDLE_FOLLOWUP';
  let app:Homer|undefined,workerRequests=0,sequence=0,sawSupplement=false,providerFailure:unknown;
  const wire:{method:string;params:any}[]=[],receipts=new Map<string,{state:string;route:string;code?:string}>();
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='POST'||!['/v1/main/responses','/v1/worker/responses'].includes(req.url??'')){res.writeHead(404).end();return;}
      let body='';for await(const chunk of req)body+=chunk;
      const payload=JSON.parse(body),input=payload.input??[],last=input.at(-1);
      if(payload.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
      const main=req.url==='/v1/main/responses',id='synthetic-'+ ++sequence;
      const answer={type:'message',id,role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Observed.'}]};
      const call=(name:string,args:unknown)=>({type:'custom_tool_call',namespace:'functions',name:'exec',call_id:id,input:'const response=await tools.mcp__homer_interactions__'+name+'('+JSON.stringify(args)+');text(response.content?.[0]?.text??response)'});
      let output:unknown=answer;
      if(main){
        const current=JSON.stringify(input.findLast((item:any)=>item.role==='user')?.content);
        if(current.includes('SYNTHETIC_OPEN')){
          if(last?.type!=='custom_tool_call_output')output=call('task_create',{title:'Synthetic dispatch',goal:'Process the synthetic follow-ups.'});
          else if(!app!.store.runs().length)output=call('worker_open',{taskId:app!.tasks.tasks()[0]!.id});
        }else{
          const message=[supplement,stale,followup].find(marker=>current.includes(marker));
          if(message&&!current.includes('内部协作输入')){
            if(last?.type==='custom_tool_call_output'){
              const output=Array.isArray(last.output)?last.output.map((part:any)=>part.text).join('\n'):last.output;
              assert.ok(output.includes('{'),'missing Worker message receipt');
              receipts.set(message,JSON.parse(output.slice(output.indexOf('{'))));
            }
            else output=call('worker_message',{workerId:app!.store.runs()[0]!.workerId,message});
          }
        }
      }else{
        if(++workerRequests===1){received.release();await respond.wait;}
        sawSupplement||=input.some((item:any)=>item.role==='user'&&JSON.stringify(item.content).includes(supplement));
        assert.ok(!input.some((item:any)=>item.role==='user'&&JSON.stringify(item.content).includes(stale)));
      }
      const events=[{type:'response.created',response:{id}},{type:'response.output_item.done',item:output},
        {type:'response.completed',response:{id,status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
      res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));
    }catch(error){providerFailure??=error;res.writeHead(500).end();}
  });
  t.signal.addEventListener('abort',()=>{received.release();respond.release();terminal.release();deliver.release();},{once:true});
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const config={...session.config,baseUrl:'http://127.0.0.1:'+address.port+'/v1',keyEnv:undefined,model:'gpt-6.1-terra',stopGraceMs:1000};
    assert.equal(execFileSync(config.codexBin,['--version'],{env:{PATH:process.env.PATH,HOME:session.home,CODEX_HOME:config.codexHome},encoding:'utf8'}).trim(),'codex-cli 0.171.0-alpha.7');
    app=new Homer(config,async()=>{},(options,handle)=>{
      const engine=new CodexEngine({...config,baseUrl:config.baseUrl+'/'+(options.role??'main')},options,handle);
      if(options.role==='worker'){
        const send=engine['send'].bind(engine),receive=engine['receive'].bind(engine);
        engine['send']=(message:any)=>{if(['turn/start','turn/steer'].includes(message.method))wire.push(message);send(message);};
        engine['receive']=async line=>{
          const event=JSON.parse(line);
          // Native has finished, but Homer still knows only the last acknowledged active turn.
          if(event.method==='turn/completed'&&event.params.turn.id===engine.turnId){terminal.release();await deliver.wait;}
          await receive(line);
        };
      }
      return engine;
    });
    await app.start();
    const message=async(marker:string)=>{
      const answer=await app!.message(marker,marker);
      if(providerFailure)throw providerFailure;
      assert.equal(answer,'Observed.');
    };
    await message('SYNTHETIC_OPEN');await received.wait;
    await until(()=>app!.store.runs()[0]?.phase==='executing');
    const original=app.store.runs()[0]!;
    await message(supplement);assert.equal(receipts.get(supplement)?.state,'received');assert.equal(receipts.get(supplement)?.route,'steer');
    respond.release();await terminal.wait;
    await message(stale);assert.equal(receipts.get(stale)?.state,'failed');assert.equal(receipts.get(stale)?.code,'engine_rpc_failed');
    deliver.release();await app.idle();
    assert.equal(app.store.runs().length,1);
    assert.ok(sawSupplement,'the loopback provider saw the accepted supplement in the original turn');
    assert.deepEqual(wire.map(call=>call.method),['turn/start','turn/steer','turn/steer']);
    for(const call of wire.slice(1))assert.equal(call.params.expectedTurnId,original.turnId);
    const bindings=app['nativeThreads'],logical=original.threadId!,turnId=original.turnId!;
    const binding=bindings.current(logical)!;
    const {thread}=await app['nativeRpc']('thread/read',{threadId:binding.nativeId,includeTurns:false});
    assert.equal(thread.status.type,'notLoaded');
    const rows=readFileSync(thread.path,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
    assert.equal(rows[0]?.payload.history_mode,'paginated');
    const oldCommand='exec-synthetic-late';
    const replayMarker=join(config.workspace,'unexpected-command-replay');
    bindings.recordWorkerEffect(logical,binding.nativeId,turnId,oldCommand,'running',false,()=>true);
    const ended=rows.findLast(row=>row.payload?.type==='task_complete'&&row.payload.turn_id===turnId);
    assert.ok(ended);
    const completedAt=Date.parse(ended.timestamp)+42;
    appendFileSync(thread.path,JSON.stringify({timestamp:new Date(completedAt).toISOString(),ordinal:rows.at(-1).ordinal+1,
      type:'event_msg',payload:{type:'item_completed',thread_id:binding.nativeId,turn_id:turnId,completed_at_ms:completedAt,
        item:{type:'CommandExecution',id:oldCommand,command:['/usr/bin/touch',replayMarker],cwd:pathToFileURL(config.workspace).href,
          parsed_cmd:[],source:'unified_exec_startup',status:'failed',exit_code:-1}}})+'\n');
    assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
    await message(followup);await app.idle();assert.equal(receipts.get(followup)?.route,'followup');
    assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
    assert.equal(existsSync(replayMarker),false);
    const runs=app.store.runs();assert.equal(runs.length,2);assert.equal(runs[1]!.workerId,original.workerId);
    assert.equal(runs[1]!.threadId,original.threadId);assert.notEqual(runs[1]!.turnId,original.turnId);
    assert.deepEqual(wire.map(call=>call.method),['turn/start','turn/steer','turn/steer','turn/start']);
    assert.ok(wire.every(call=>call.params.threadId===original.threadId));
    if(providerFailure)throw providerFailure;
  }finally{
    respond.release();deliver.release();
    try{await app?.close({requireAllOwnersConfirmed:true});}finally{
      server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
      rmSync(session.directory,{recursive:true,force:true});
    }
  }
});
