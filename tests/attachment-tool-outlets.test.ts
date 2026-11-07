// Actual native dynamic RPC and MCP stdio boundaries with a local synthetic host.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {CodexEngine,type ToolCall} from '../src/engine.js';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';
import {fixture} from './fixtures/worker-chat-host.js';

test('native attachment scope errors are safe and an exact call recovers the committed receipt',async()=>{
  const f=fixture();let complete=false;
  try{
    await f.app.start();
    const requestId='selected-attachment-rpc';
    const ref=f.app.media.intent(requestId,'web:'+f.app.store.meta('mainThread'),'file');
    f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Synthetic attachment'),'text/plain');
    f.setScript(async (main,text)=>{
      if(!text.includes('Process a synthetic file'))return {status:'completed',text:'Barrier'};
      const engine=new CodexEngine(f.app.config,{cwd:f.app.config.workspace,readRoots:[],instructions:'',tools:[]},
        (call:ToolCall)=>f.app['mainTool'](call));
      const peer=engine as any;
      peer.threadId=main.threadId;peer.turnId=main.turnId;peer.active={text:'',earlyEvents:[]};
      const sent:any[]=[];let loseReply=false;
      peer.send=(message:unknown)=>{if(!loseReply)sent.push(message);};
      const call=(id:number,callId:string,tool:string,args:unknown)=>peer.receive(JSON.stringify({id,method:'item/tool/call',
        params:{threadId:main.threadId,turnId:main.turnId,callId,tool,arguments:args}}));
      await call(1,'foreign','worker_open',{message:'Private input',attachments:[{...ref,revision:2}]});
      assert.deepEqual(sent.at(-1).result,{success:false,contentItems:[{type:'inputText',text:'media_scope_denied'}]});
      assert.equal(f.app.tasks.tasks().length,0);
      await call(2,'forged','task_create',{goal:'Synthetic',attachments:[ref]});
      assert.deepEqual(sent.at(-1).result,{success:false,contentItems:[{type:'inputText',text:'invalid_tool_arguments'}]});
      const args={message:'Inspect the selected file',attachments:[ref]};
      loseReply=true;await call(3,'committed','worker_open',args);loseReply=false;
      const operation=f.app.store.db.prepare("SELECT responseJson FROM operations WHERE kind='worker_open'").get();
      assert.ok(operation);
      assert.equal(f.app.tasks.tasks().length,1);
      f.app.media.revoke(requestId);peer.toolResponses.clear();
      await call(4,'committed','worker_open',args);
      assert.equal(sent.at(-1).result.success,true);
      assert.deepEqual(JSON.parse(sent.at(-1).result.contentItems[0].text),JSON.parse(String(operation.responseJson)));
      assert.equal(f.app.tasks.tasks().length,1);
      complete=true;
      return {status:'completed',text:'Checked'};
    });
    f.app.submitMessage({requestId,text:'Process a synthetic file',attachments:[ref]});
    await f.app.message('Barrier','followup');
    assert.equal(complete,true);
  }finally{await f.close();}
});

test('MCP exposes scoped attachment reads and rejects a duplicate business outlet',async()=>{
  const f=fixture(),calls:string[]=[];
  let child:ReturnType<typeof spawn>|undefined,complete=false;
  const server=new WorkerInteractionMcp(f.app.config.runtime,async(name,args)=>{
    calls.push(name);return f.app['mediaTool'](name,args);
  });
  try{
    await f.app.start();await server.start();
    const requestId='selected-attachment-mcp';
    const ref=f.app.media.intent(requestId,'web:'+f.app.store.meta('mainThread'),'file');
    f.app.media.ready(ref,f.app.media.claim(ref)!,Buffer.from('Synthetic attachment'),'text/plain');
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
      const valid=await rpc('inspect_attachment',ref);
      assert.equal(valid.isError,false);
      assert.equal(JSON.parse(valid.content[0].text).assetId,ref.assetId);
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
