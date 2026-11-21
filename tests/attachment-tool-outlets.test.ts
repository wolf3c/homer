// Actual MCP transport with a local synthetic host.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createConnection,type Socket} from 'node:net';
import {mcpCall} from './fixtures/host-mcp-call.js';
import {MEDIA_TOOLS} from '../src/media-tools.js';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';
import {fixture,until} from './fixtures/worker-chat-host.js';

for(const outcome of ['confirmed','uncertain','live-retry'] as const)test('a lost Worker dispatch receipt supports '+outcome+' recovery',async()=>{
  const f=fixture();
  let dispatched=false,completed=false,activeSocket:Socket|undefined;
  try{
    await f.app.start();
    const requestId='selected-attachment-rpc';
    const ref=f.app.media.intent(requestId,'web:'+f.app.store.meta('mainThread'),'file');
    f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Synthetic attachment'),'text/plain');
    const handler=f.app['mainTool'].bind(f.app);
    f.app['mainTool']=async call=>{
      const result=await handler(call);
      if(call.callId==='committed')activeSocket?.destroy();
      return result;
    };
    f.setScript(async(main,text)=>{
      const path=f.app['interactionMcp']!.path;
      const call=(callId:string,tool:string,args:unknown)=>{
        main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId:callId,tool,arguments:args});
        return mcpCall(path,tool,args,{callId,'x-codex-turn-metadata':{turn_id:main.turnId}});
      };
      if(text.includes('Read the original receipt')){
        const tasks=(await call('list','list_work',{})).result.tasks;
        assert.equal(tasks.length,1);
        const {workers}=(await call('task','work_inspect',{taskId:tasks[0].id})).result;
        const {messages}=(await call('read','worker_read',{workerId:workers[0].workerId})).result;
        const {operationKey}=messages.find((msg:{kind:string})=>msg.kind==='worker_input');
        const [receipt]=(await call('inspect','work_inspect',{operationKey})).result.operations;
        assert.equal(receipt.state,outcome==='uncertain'?'uncertain':'confirmed');
        if(outcome==='uncertain')assert.equal(receipt.response,null);
        else assert.equal(receipt.response.workerId,workers[0].workerId);
        completed=true;
      }else if(text.includes('Process a synthetic file')){
        const create={title:'Selected file inspection',goal:'Inspect the selected file'};
        assert.equal((await mcpCall(path,'task_create',create)).error,'schedule_call_scope_denied');
        assert.equal(f.app.tasks.tasks().length,0);
        const {taskId}=(await call('create','task_create',create)).result;
        assert.equal((await call('foreign','worker_open',{taskId,attachments:[{...ref,revision:2}]})).error,'media_scope_denied');
        assert.equal((await call('forged','task_create',{...create,attachments:[ref]})).error,'invalid_tool_arguments');
        assert.equal(f.app.tasks.runs(taskId).length,0);
        const args={taskId,attachments:[ref]},id='committed';
        main.emit('hostMcpToolStarted',{threadId:main.threadId,turnId:main.turnId,itemId:id,tool:'worker_open',arguments:args});
        await new Promise<void>((done,reject)=>{
          const socket=activeSocket=createConnection(path);
          socket.on('connect',()=>socket.write(JSON.stringify({tool:'worker_open',arguments:args,meta:{callId:id,'x-codex-turn-metadata':{turn_id:main.turnId}}})+'\n'));
          socket.on('data',()=>reject(Error('unexpected_receipt')));socket.on('error',reject);socket.on('close',()=>done());
        });
        activeSocket=undefined;
        dispatched=true;
        await until(()=>f.engines.some(e=>e.options.role==='worker'&&!!e.input));
        const worker=f.engines.find(e=>e.options.role==='worker')!;
        const argv=worker.options.interactionMcp!.args;
        assert.equal((await mcpCall(argv[argv.indexOf('worker')-1]!,'task_create',create)).error,'interaction_tool_denied');
        if(outcome==='confirmed'){
          const fileArgs={...ref,filename:'export.txt'},tool='stage_file_result';
          worker.emit('hostMcpToolStarted',{threadId:worker.threadId,turnId:worker.turnId,itemId:'export',tool,arguments:fileArgs});
          const exportReceipt=await mcpCall(argv[argv.indexOf('worker')-1]!,tool,fileArgs,{callId:'export','x-codex-turn-metadata':{turn_id:worker.turnId}});
          assert.equal(readFileSync(exportReceipt.result.path,'utf8'),'Synthetic attachment');
        }
        f.app.media.revoke(requestId);
        if(outcome==='live-retry')assert.ok((await call(id,'worker_open',args)).result.workerId);
        assert.equal(f.app.tasks.tasks().length,1);
        worker.finish!({status:'completed',text:'Read the synthetic file.'});
      }
      return {status:'completed',text:'Checked'};
    });
    f.app.submitMessage({requestId,text:'Process a synthetic file',attachments:[ref]});
    await f.app.message('Barrier','followup');await f.app.idle();assert.ok(dispatched);
    if(outcome==='uncertain')assert.equal(f.app.store.db.prepare("UPDATE operations SET state='uncertain',responseJson=NULL WHERE kind='worker_open'").run().changes,1);
    await f.restart();
    await f.app.message('Read the original receipt','receipt-query');
    assert.ok(completed);
    assert.equal(f.app.store.runs().length,1);
    assert.equal(f.engines.filter(e=>e.options.role==='worker'&&e.input).length,1);
  }finally{activeSocket?.destroy();await f.close();}
});

test('MCP exposes scoped attachment reads and rejects a duplicate business outlet',async()=>{
  const f=fixture(),calls:string[]=[];
  let child:ReturnType<typeof spawn>|undefined,complete=false;
  const server=new WorkerInteractionMcp(f.app.config.runtime,async(name,args)=>{
    calls.push(name);return f.app['mediaTool'](name,args);
  },[...MEDIA_TOOLS]);
  try{
    await f.app.start();await server.start();
    const requestId='selected-attachment-mcp';
    const body='Synthetic attachment with a literal $fixture-skill.';
    const upload=await f.app.uploadAttachment({requestId,threadId:f.app.store.meta('mainThread'),uploadId:'selected-file',
      filename:'notes.txt',data:Buffer.from(body).toString('base64')});
    const ref={assetId:upload.assetId,revision:upload.revision};
    child=spawn(process.execPath,['--import','tsx',resolve('src/worker-interaction-mcp-stdio.ts'),server.path],{stdio:['pipe','pipe','pipe']});
    const pending=new Map<number,(message:any)=>void>();let sequence=0,stderr='';
    child.stderr!.on('data',chunk=>stderr+=chunk);
    createInterface({input:child.stdout!}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
    const rpc=(name:string,args:unknown)=>new Promise<any>((done,reject)=>{
      const id=++sequence,timer=setTimeout(()=>reject(Error('synthetic_timeout')),3000);
      pending.set(id,message=>{clearTimeout(timer);done(message.result);});
      child!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');
    });
    f.setScript(async(_main,text)=>{
      if(!text.includes('Read the selected file'))return {status:'completed',text:'Barrier'};
      assert.doesNotMatch(text,/\$fixture-skill/);
      assert.match(text,/inspect_attachment/);
      const facts=JSON.parse(text.split('\n').at(-1)!);
      assert.equal(facts.length,1);
      assert.equal(facts[0].assetId,ref.assetId);
      assert.equal(facts[0].revision,ref.revision);
      assert.equal(facts[0].kind,'file');
      assert.equal(facts[0].state,'ready');
      assert.equal(facts[0].filename,'notes.txt');
      assert.ok(facts[0].reference);
      assert.equal(facts[0].extraction,undefined);
      const valid=await rpc('inspect_attachment',ref);
      assert.equal(valid.isError,false);
      const result=JSON.parse(valid.content[0].text);
      assert.equal(result.assetId,ref.assetId);
      assert.equal(result.extraction.state,'ready');
      assert.equal(result.extraction.text,body);
      assert.deepEqual(await rpc('inspect_attachment',{...ref,revision:2}),{isError:true,content:[{type:'text',text:'media_scope_denied'}]});
      f.app.store.db.prepare('UPDATE media_assets SET requestId=? WHERE id=?').run('private-foreign-source',ref.assetId);
      assert.deepEqual(await rpc('inspect_attachment',ref),{isError:true,content:[{type:'text',text:'media_scope_denied'}]});
      for(const name of ['task_create','worker_open','task_delegate'])
        assert.deepEqual(await rpc(name,{goal:'Private input'}),{isError:true,content:[{type:'text',text:'interaction_tool_denied'}]});
      assert.deepEqual(calls,['inspect_attachment','inspect_attachment','inspect_attachment']);
      assert.equal(f.app.tasks.tasks().length,0);
      assert.equal(stderr,'');
      complete=true;
      return {status:'completed',text:'Checked'};
    });
    f.app.submitMessage({requestId,text:'Read the selected file',attachments:[ref]});
    await f.app.message('Barrier','after-selected-attachment');
    assert.equal(complete,true);
  }finally{
    child?.kill();
    if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(done=>child!.once('exit',()=>done()));
    await server.close();await f.close();
  }
});
