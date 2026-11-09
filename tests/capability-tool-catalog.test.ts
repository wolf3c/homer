// The removed tool is rejected by both production MCP catalogs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {WorkerInteractionMcp,HOST_MCP_TOOLS,WORKER_HOST_MCP_TOOLS} from '../src/worker-interaction-mcp.js';

for(const role of ['main','worker'] as const)test('capabilities is absent and rejected by the '+role+' native MCP',async()=>{
 const root=resolve('.codex/scratch/remove-capability-settings-20261023');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(root+'/catalog-'),calls:unknown[]=[];
 const owner=new WorkerInteractionMcp(dir,async(name,args)=>{calls.push({name,args});return {source:'synthetic-native-owner',action:(args as any).action};},role==='main'?HOST_MCP_TOOLS:WORKER_HOST_MCP_TOOLS);
 let child:ReturnType<typeof spawn>|undefined;
 try{
  await owner.start();child=spawn(process.execPath,['--import','tsx',resolve('src/worker-interaction-mcp-stdio.ts'),owner.path,role],{stdio:['pipe','pipe','pipe']});
  let seq=0,stderr='';const pending=new Map<number,(value:any)=>void>();child.stderr!.on('data',data=>{stderr+=data;});
  const lines=createInterface({input:child.stdout!});lines.on('line',line=>{const value=JSON.parse(line);pending.get(value.id)?.(value);pending.delete(value.id);});
  const rpc=(method:string,params:unknown)=>new Promise<any>((accept,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('synthetic_capability_catalog_timeout'));},5000);pending.set(id,value=>{clearTimeout(timer);accept(value);});child!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'synthetic-capabilities-preservation',version:'1'}});
  const tools=(await rpc('tools/list',{})).result.tools;
  assert.ok(tools.some((tool:any)=>tool.name==='work_directory'));
  assert.ok(!tools.some((tool:any)=>tool.name==='capabilities'));
  const reply=await rpc('tools/call',{name:'capabilities',arguments:{action:'state'}});
  assert.ok(reply.error||reply.result?.isError);
  assert.deepEqual(calls,[]);assert.equal(stderr,'');lines.close();
 }finally{child?.kill();if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(accept=>child!.once('exit',()=>accept()));await owner.close();rmSync(dir,{recursive:true,force:true});}
});
