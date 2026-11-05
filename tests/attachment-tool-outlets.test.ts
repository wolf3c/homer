// Actual dynamic RPC and MCP socket/stdio with isolated synthetic media only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {CodexEngine,type ToolCall} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {MediaStore} from '../src/media-store.js';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';
import {chatFixture} from './task-chat-fixture.js';

function setup(){
 const f=chatFixture(),media=new MediaStore(f.store.db,join(f.dir,'media'));
 const ref=media.intent(f.actor.sourceRequestId!,'synthetic','file');media.ready(ref,media.claim(ref)!,Buffer.from('Synthetic attachment'),'text/plain');
 const host=Object.create(Homer.prototype) as any;
 Object.assign(host,{media,store:f.store,closing:false,mainContext:{event:false,requestId:f.actor.sourceRequestId,queuedInput:{input:{attachments:[ref]}}}});
 const tasks=new RecursiveTasks(f.store,f.files,{validateActor(){},validateAttachments:(source,refs)=>host.validateTaskAttachments(source,refs)});
 return {...f,tasks,media,host,ref};
}

test('native attachment failures expose fixed safe codes and a lost committed call recovers one persisted receipt',async()=>{
 const f=setup();try{
  let attachments=['private-invalid-reference'];
  const effects={rootAuthority:()=>({...f.authority,attachments}),wake(){},stop:async()=>({}),steer:async()=>({})};
  let tools=new RecursiveTools(f.tasks,effects);
  const engine:any=new CodexEngine({workspace:f.files.workspace,runtime:f.dir,codexHome:join(f.dir,'no-account'),model:'synthetic'} as any,{cwd:f.files.workspace,readRoots:[],instructions:'',tools:[]},(call:ToolCall)=>tools.call({...f.actor,threadId:call.threadId,turnId:call.turnId},call.tool,call.arguments,call.callId));
  engine.threadId=f.actor.threadId;engine.turnId=f.actor.turnId;engine.active={text:'',earlyEvents:[]};
  const sent:any[]=[];let loseReply=false;engine.send=(message:unknown)=>{if(!loseReply)sent.push(message);};
  const receive=(id:number,callId:string,args:unknown)=>engine.receive(JSON.stringify({id,method:'item/tool/call',params:{threadId:f.actor.threadId,turnId:f.actor.turnId,callId,tool:'task_create',arguments:args}}));
  for(const [index,refs,code] of [
   [1,['private-invalid-reference'],'task_attachment_reference_invalid'],
   [2,['asset-00000000-0000-4000-8000-000000000001@1'],'task_authority_input_denied'],
  ] as const){
   attachments=[...refs];await receive(index,'invalid-'+index,{goal:'private raw user input'});
   assert.deepEqual(sent.at(-1).result,{success:false,contentItems:[{type:'inputText',text:code}]});
   assert.equal(f.tasks.tasks().length,0);assert.equal(f.tasks.runs().length,0);
  }
  attachments=[f.ref.assetId+'@1'];
  await receive(3,'forged',{goal:'Synthetic',attachments});
  assert.deepEqual(sent.at(-1).result,{success:false,contentItems:[{type:'inputText',text:'invalid_tool_arguments'}]});
  const args={goal:'Synthetic attachment investigation'};loseReply=true;await receive(4,'committed',args);loseReply=false;
  assert.equal(f.tasks.tasks().length,1);assert.equal(sent.length,3);
  const prior=f.tasks.operationsForInput(f.actor,f.actor.inputMessageId!).find(op=>op.kind==='task_create')!.response;
  f.media.revoke(f.actor.sourceRequestId!);engine.toolResponses.clear();tools=new RecursiveTools(f.tasks,effects);
  await receive(5,'committed',args);assert.equal(sent.at(-1).result.success,true);
  assert.deepEqual(JSON.parse(sent.at(-1).result.contentItems[0].text),prior);assert.equal(f.tasks.tasks().length,1);assert.equal(f.tasks.runs().length,0);
 }finally{f.close();}
});

test('MCP keeps only attachment reads, rejects a duplicate business outlet and hides foreign attachment data',async()=>{
 const f=setup(),calls:string[]=[];let child:ReturnType<typeof spawn>|undefined;
 const server=new WorkerInteractionMcp(f.dir,async(name,args)=>{calls.push(name);return f.host.mediaTool(name,args);});
 try{
  await server.start();child=spawn(process.execPath,['--import','tsx',resolve('src/worker-interaction-mcp-stdio.ts'),server.path],{stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,(message:any)=>void>();let sequence=0,stderr='';child.stderr!.on('data',chunk=>stderr+=chunk);
  createInterface({input:child.stdout!}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
  const rpc=(name:string,args:unknown)=>new Promise<any>((done,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('synthetic_timeout')),3000);pending.set(id,message=>{clearTimeout(timer);done(message);});child!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');});
  const invoke=async(args:unknown)=>{const reply=await rpc('inspect_attachment',args);return reply.result;};
  const valid=await invoke(f.ref);assert.equal(valid.isError,false);assert.equal(JSON.parse(valid.content[0].text).assetId,f.ref.assetId);
  assert.deepEqual(await invoke({...f.ref,revision:2}),{isError:true,content:[{type:'text',text:'media_scope_denied'}]});
  f.store.db.prepare('UPDATE media_assets SET requestId=? WHERE id=?').run('private-foreign-source',f.ref.assetId);
  assert.deepEqual(await invoke(f.ref),{isError:true,content:[{type:'text',text:'media_scope_denied'}]});
  for(const name of ['task_create','worker_open','task_delegate']){
   const reply=await rpc(name,{goal:'private raw input'});assert.deepEqual(reply.result,{isError:true,content:[{type:'text',text:'interaction_tool_denied'}]});
  }
  assert.deepEqual(calls,['inspect_attachment','inspect_attachment','inspect_attachment']);assert.equal(f.tasks.tasks().length,0);assert.equal(f.tasks.runs().length,0);assert.equal(stderr,'');
 }finally{
  child?.kill();if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(done=>child!.once('exit',()=>done()));
  await server.close();f.close();
 }
});
