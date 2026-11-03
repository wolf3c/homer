// Isolated Unix socket + actual stdio MCP child. No model, account or live data.
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {WorkerInteractionMcp} from '../src/worker-interaction-mcp.js';

export async function interactionFixture(handle:(name:string,args:unknown)=>Promise<unknown>,missing=false){
 const root=resolve('.codex/scratch/interface-contract-lifecycle-fix-20261030');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(root+'/mcp-'),server=new WorkerInteractionMcp(dir,handle);
 if(!missing)await server.start();
 const child=spawn(process.execPath,['--import','tsx',resolve('src/worker-interaction-mcp-stdio.ts'),server.path],{stdio:['pipe','pipe','pipe']});
 child.stderr.resume();let sequence=0;
 const pending=new Map<number,{done:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{const message=JSON.parse(line),call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);call.done(message.result);}});
 const call=(name:string,args:unknown={})=>new Promise<any>((done,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('test_mcp_timeout'));},25000);
  pending.set(id,{done,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');
 });
 return {server,call,async close(){
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('test_closed'));}pending.clear();
  child.kill();if(child.exitCode===null&&child.signalCode===null)await new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  lines.close();await server.close();rmSync(dir,{recursive:true,force:true});
 }};
}
