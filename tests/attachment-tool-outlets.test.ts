// Actual dynamic RPC handler and MCP socket/stdio, synthetic arguments only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {MainProcessHistory} from '../src/main-process.js';
import {RecursiveTools} from '../src/recursive-tools.js';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';
import {fixture,contract,main} from './recursive-fixture.js';
mkdirSync('.codex/scratch/recursive-agent-implementation',{recursive:true});
test('both existing outlets retain fixed safe attachment codes; no raw input or new envelope',async()=>{
 const f=fixture(),dir=mkdtempSync(resolve('.codex/scratch/recursive-agent-implementation/mcp-'));
 let loseReply:(()=>void)|undefined;
 const tools=new RecursiveTools(f.tasks,{rootAuthority:()=>f.tasks.authority(f.root.taskId,1),wake(){loseReply?.();},stop:async()=>{},update:async()=>{}});
 const processes=new MainProcessHistory(f.store.db),host:any=Object.create(Homer.prototype);
 processes.start({id:'outlet',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'outlet-reply'},'turn');
 Object.assign(host,{mainContext:{event:true,processId:'outlet'},processes});
 const handle=(tool:string,args:unknown)=>host.mainActivity(tool,()=>tools.call(main,tool,args));
 const engine:any=new CodexEngine({workspace:process.cwd(),runtime:process.cwd(),codexHome:'/synthetic/no-account',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},call=>handle(call.tool,call.arguments));
 engine.threadId='thread';engine.turnId='turn';engine.active={text:'',earlyEvents:[]};const sent:any[]=[];engine.send=(message:unknown)=>sent.push(message);
 const server=new WorkerInteractionMcp(dir,handle);let child:ReturnType<typeof spawn>|undefined;
 try{
  await server.start();child=spawn(process.execPath,['--import','tsx',resolve('src/worker-interaction-mcp-stdio.ts'),server.path],{stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,(message:any)=>void>();let seq=0,stderr='';child.stderr!.on('data',chunk=>stderr+=chunk);
  createInterface({input:child.stdout!}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
  const rpc=(method:string,params:unknown)=>new Promise<any>((done,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('synthetic_timeout')),3000);pending.set(id,message=>{clearTimeout(timer);done(message);});child!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'synthetic',version:'1'}});
  for(const [index,id,code] of [[1,'private-invalid-reference','task_attachment_reference_invalid'],[2,'asset-00000000-0000-4000-8000-000000000001@1','task_authority_input_denied']] as const){
   const args={operationId:'outlet-'+index,parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Synthetic',executorKind:'worker',contract:{...contract(),inputs:[{type:'attachment',id}]},dependencies:[]};
   await engine.receive(JSON.stringify({id:index,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'call-'+index,tool:'task_delegate',arguments:args}}));
   assert.deepEqual(sent.at(-1).result,{success:false,contentItems:[{type:'inputText',text:code}]});
   const reply=await rpc('tools/call',{name:'task_delegate',arguments:args});
   assert.deepEqual(reply.result,{isError:true,content:[{type:'text',text:code}]});
   assert.equal((processes.list('synthetic')[0]!.items.at(-1) as any).label,'未创建任务');
  }
  assert.equal(f.tasks.tasks().length,1);assert.equal(f.store.runs().length,0);assert.equal(stderr,'');
  const args={operationId:'lost-socket',parentTaskId:null,parentVersion:null,expectedTaskRevision:null,title:'Synthetic',executorKind:'worker',contract:contract(),dependencies:[]};
  let bytes='';await new Promise<void>((done,reject)=>{
   const socket=createConnection(server.path);const timer=setTimeout(()=>reject(Error('synthetic_drop_timeout')),3000);
   loseReply=()=>socket.destroy();socket.setEncoding('utf8');socket.on('data',data=>bytes+=data);socket.on('error',reject);socket.on('close',()=>{clearTimeout(timer);done();});
   socket.on('connect',()=>socket.write(JSON.stringify({tool:'task_delegate',arguments:args})+'\n'));
  });
  loseReply=undefined;assert.equal(bytes,'');
  assert.equal((processes.list('synthetic')[0]!.items.at(-1) as any).label,'任务已创建');
  assert.ok(processes.list('synthetic')[0]!.items.every(item=>item.kind==='tool'));
  const prior=JSON.parse(String(f.store.db.prepare("SELECT responseJson FROM operations WHERE operationId='lost-socket'").get()!.responseJson));
  const recovered=await rpc('tools/call',{name:'task_delegate',arguments:args});
  assert.equal(recovered.result.isError,false);assert.deepEqual(JSON.parse(recovered.result.content[0].text),prior);
  assert.equal(f.tasks.tasks().length,2);assert.equal(f.store.runs().length,1);
 }finally{
  child?.kill();if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(done=>child!.once('exit',()=>done()));
  await server.close();f.close();rmSync(dir,{recursive:true,force:true});
 }
});
