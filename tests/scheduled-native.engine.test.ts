import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import test from 'node:test';
import {createSession} from '../scripts/deepseek-isolated.mjs';
import {CodexEngine,type EngineOptions,type ToolCall} from '../src/engine.js';
import {Homer,type EngineFactory} from '../src/service.js';

const names=['schedule_create','schedule_list','schedule_update','schedule_cancel'];
type Role='main'|'worker';
type Start=Omit<ToolCall,'callId'>&{itemId:string};

test('pinned Main and Worker discover scheduled tools on old threads and authenticate real MCP calls',{timeout:150_000},async()=>{
  const session=createSession();
  let app:Homer|undefined,phase:'warm'|'main'|'worker'='warm',failure:unknown,request=0;
  let opening=false,continuing=false,workerId='';
  const programs:Record<Role,{index:number;callId?:string;scheduleId?:string}>={main:{index:0},worker:{index:0}};
  const starts:{engine:CodexEngine;call:Start}[]=[],authenticated:{engine:CodexEngine;tool:string;args:unknown;meta:any;identity:Pick<ToolCall,'threadId'|'turnId'|'callId'>}[]=[];
  const inventories:{role:Role;warm:boolean;threadId:string;names:string[]}[]=[],resumes:{role:Role;threadId:string}[]=[];
  const call=(name:string,args:unknown,callId:string,scheduled=false)=>({type:'function_call',call_id:callId,name,...(scheduled?{namespace:'mcp__homer_interactions'}:{}),arguments:JSON.stringify(args)});
  const answer=(text:string)=>({type:'message',id:'message-'+request,role:'assistant',content:[{type:'output_text',text}]});
  const program=(role:Role,payload:any)=>{
    const state=programs[role],last=payload.input?.at(-1);
    if(last?.type==='function_call_output'&&last.call_id===state.callId){
      const output=JSON.stringify(last.output);
      assert.doesNotMatch(output,/schedule_call_scope_denied|schedule_scope_denied|invalid_tool_arguments/);
      if(state.index===0){
        const row=app!.store.db.prepare('SELECT id FROM schedules WHERE text=?').get(role+' native reminder');
        assert.ok(row,'the real host must commit the native create');state.scheduleId=String(row.id);
        assert.ok(output.includes(state.scheduleId));
      }else if(state.index===1||state.index===4){
        const operations=app!.store.db.prepare("SELECT id,kind,responseJson FROM operations WHERE scopeId='schedules' AND json_extract(responseJson,'$.scheduleId')=? ORDER BY rowid").all(state.scheduleId!);
        assert.equal(operations.length,state.index===1?1:3);
        for(const operation of operations){assert.ok(output.includes(String(operation.id)));assert.ok(output.includes(String(operation.kind)));}
        assert.ok(output.includes(state.scheduleId!));
        if(role==='worker')for(const operation of app!.store.db.prepare("SELECT id FROM operations WHERE scopeId='schedules' AND json_extract(responseJson,'$.scheduleId')<>?").all(state.scheduleId!))
          assert.equal(output.includes(String(operation.id)),false,'Worker receipts exclude the Main schedule');
      }else{
        const row=app!.store.db.prepare('SELECT revision,enabled,text FROM schedules WHERE id=?').get(state.scheduleId!)!;
        assert.equal(row.revision,state.index===2?2:3);assert.equal(row.text,role+' updated reminder');
        if(state.index===3)assert.equal(row.enabled,0);
        assert.ok(output.includes(state.scheduleId!));
      }
      state.index++;state.callId=undefined;
    }
    if(state.index===5)return answer(role+' schedules verified');
    const name=['schedule_create','schedule_list','schedule_update','schedule_cancel','schedule_list'][state.index]!;
    const tools=JSON.stringify(payload.tools??[]),discovery=payload.input?.findLast((item:any)=>item.type==='tool_search_output');
    if(!tools.includes(name)&&!JSON.stringify(discovery??{}).includes(name))
      return {type:'tool_search_call',call_id:role+'-search-'+state.index,execution:'client',arguments:{query:name}};
    const args=state.index===0?{text:role+' native reminder',trigger:{at:new Date(Date.now()+86_400_000).toISOString()}}
      :state.index===1||state.index===4?{receipts:true}
      :{scheduleId:state.scheduleId,expectedRevision:state.index===2?1:2,...(state.index===2?{text:role+' updated reminder'}:{})};
    state.callId=role+'-schedule-'+state.index;
    return call(name,args,state.callId,true);
  };
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(404).end();return;}
      let body='';for await(const chunk of req)body+=chunk;
      const payload=JSON.parse(body);
      if(payload.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end();return;}
      request++;
      const worker=!JSON.stringify(payload.tools??[]).includes('worker_open');
      const latest=payload.input?.findLast((item:any)=>item.role==='user');
      const internal=JSON.stringify(latest??{}).includes('内部协作输入');
      const last=payload.input?.at(-1);
      let output;
      if(internal&&!worker)output=answer('Internal result observed');
      else if(phase==='warm'){
        if(worker)output=answer('Warm Worker history');
        else if(!opening){opening=true;output=call('worker_open',{message:'Synthetic authorization: prepare a reminder now and later create, inspect, update and cancel it.',title:'Native scheduled tools'},'warm-worker');}
        else{assert.equal(last?.type,'function_call_output');assert.match(JSON.stringify(last.output),/workerId/);output=answer('Warm Main history');}
      }else if(phase==='worker'&&!worker){
        if(!continuing){continuing=true;output=call('worker_send',{workerId,message:'Create, inspect, update and cancel the authorized synthetic reminder, then recover its original operation receipts.'},'resume-worker');}
        else{assert.equal(last?.type,'function_call_output');assert.match(JSON.stringify(last.output),/workerId/);output=answer('Worker resumed');}
      }else output=program(worker?'worker':'main',payload);
      const id='scheduled-native-'+request;
      const events=[{type:'response.created',response:{id}},{type:'response.output_item.done',item:output},
        {type:'response.completed',response:{id,status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
      res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
    }catch(error){failure??=error;res.writeHead(500).end();}
  });
  try{
    assert.ok(existsSync(session.config.codexBin),'Project fixed Codex 0.163.0 executable is unavailable: '+session.config.codexBin);
    assert.equal(execFileSync(session.config.codexBin,['--version'],{env:{PATH:process.env.PATH,HOME:session.home,CODEX_HOME:session.config.codexHome},encoding:'utf8',timeout:10_000}).trim(),'codex-cli 0.163.0');
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const config={...session.config,baseUrl:'http://127.0.0.1:'+address.port+'/v1',keyEnv:undefined,model:'gpt-6.1-terra',stopGraceMs:1000};
    const start=async(warm:boolean)=>{
      const factory:EngineFactory=(options,handle)=>{
        const role=options.nativeTools!;
        const selected:EngineOptions=warm?{...options,interactionMcp:{...options.interactionMcp!,catalog:options.interactionMcp!.catalog!.filter(tool=>!names.includes(tool.name))}}:options;
        const engine=new CodexEngine(config,selected,handle),nativeRequest=engine.request.bind(engine),nativeStart=engine.start.bind(engine);
        engine.request=(method,params)=>{if(method==='thread/resume')resumes.push({role,threadId:(params as {threadId:string}).threadId});return nativeRequest(method,params);};
        engine.start=async()=>{
          const threadId=await nativeStart(),inventory=await engine.request('mcpServerStatus/list',{threadId,serverName:'homer_interactions',detail:'full',limit:100});
          const catalog=inventory.data.find((entry:any)=>entry.name==='homer_interactions');
          inventories.push({role,warm,threadId,names:Object.keys(catalog.tools)});return threadId;
        };
        engine.on('hostMcpToolStarted',call=>starts.push({engine,call}));return engine;
      };
      app=new Homer(config,async()=>{},factory);
      const evidence=app['scheduleCalls'],authenticate=evidence.authenticate.bind(evidence);
      evidence.authenticate=async(...args)=>{
        const identity=await authenticate(...args);
        authenticated.push({engine:args[0] as CodexEngine,tool:args[1],args:args[2],meta:args[3],identity});return identity;
      };
      await app.start();
    };
    await start(true);assert.equal(await app!.message('Warm old sessions for the authorized reminder','native-warm'),'Warm Main history');await app!.idle();
    if(failure)throw failure;
    const mainThread=app!.store.meta('mainThread')!,worker=app!.store.runs()[0]!;workerId=worker.workerId;
    assert.ok(worker.threadId);assert.equal(inventories.filter(item=>item.warm).length,2);
    for(const inventory of inventories)for(const name of names)assert.equal(inventory.names.includes(name),false);
    await app!.close();app=undefined;phase='main';await start(false);
    assert.equal(app!.store.meta('mainThread'),mainThread);
    assert.equal(await app!.message('Create, inspect, update, cancel and recover the synthetic reminder','native-main-schedules'),'main schedules verified');await app!.idle();
    if(failure)throw failure;
    phase='worker';assert.equal(await app!.message('Continue the same Worker reminder assignment','native-worker-schedules'),'Worker resumed');await app!.idle();
    if(failure)throw failure;
    for(const role of ['main','worker'] as const){
      assert.equal(programs[role].index,5);
      const inventory=inventories.find(item=>!item.warm&&item.role===role)!;assert.ok(inventory);
      assert.equal(inventory.threadId,role==='main'?mainThread:worker.threadId);
      for(const name of names)assert.ok(inventory.names.includes(name),role+' discovers '+name+' after resume');
      assert.ok(resumes.some(item=>item.role===role&&item.threadId===inventory.threadId));
      const calls=authenticated.filter(item=>item.engine.options.nativeTools===role);
      assert.deepEqual(calls.map(item=>item.tool),['schedule_create','schedule_list','schedule_update','schedule_cancel','schedule_list']);
      for(const item of calls){
        const native=starts.find(start=>start.engine===item.engine&&start.call.itemId===item.meta.callId);
        assert.ok(native,'MCP metadata matches a start from the same actual engine');
        assert.equal(native.call.threadId,item.identity.threadId);assert.equal(native.call.turnId,item.meta['x-codex-turn-metadata'].turn_id);
        assert.equal(native.call.turnId,item.identity.turnId);assert.equal(native.call.itemId,item.identity.callId);
        assert.equal(native.call.tool,item.tool);assert.deepEqual(native.call.arguments,item.args);
      }
    }
    assert.equal(app!.store.db.prepare('SELECT count(*) n FROM schedules WHERE enabled=0 AND revision=3').get()!.n,2);
    assert.equal(app!.store.db.prepare("SELECT count(*) n FROM operations WHERE scopeId='schedules' AND state='confirmed'").get()!.n,6);
  }finally{
    try{await app?.close();}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(session.directory,{recursive:true,force:true});}
  }
});
