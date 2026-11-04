// Fixed binary + loopback scripted Responses; no real account, login or plugin installation.
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {CodexEngine,codexVersion} from '../src/engine.js';
const binary=process.argv[2];
if(!binary)throw Error('fixed_native_binary_argument_required');
const bin=resolve(binary);
const scratch=resolve('.codex/scratch/native-rpc-lifecycle-implementation');
mkdirSync(scratch,{recursive:true});
const dir=mkdtempSync(join(scratch,'isolated-native-'));
const home=join(dir,'codex'),cwd=join(dir,'workspace');for(const p of[home,cwd])mkdirSync(p);
let calls=0;
const server=createServer(async(req,res)=>{
 if(req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
 // Consume but never record the synthetic request body.
 for await(const _ of req){}
 const id=++calls;
 const item={id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic compaction summary.',annotations:[]}]};
 const response={id:'resp-'+id,object:'response',model:'gpt-6.1-sol',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 res.setHeader('Content-Type','text/event-stream');
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
 res.end();
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
process.env.NO_PROXY='127.0.0.1,localhost';
const engine=new CodexEngine({appData:dir,workspace:cwd,runtime:join(dir,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:bin,baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',model:'gpt-6.1-sol',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:1000},{cwd,readRoots:[cwd],instructions:'Synthetic local protocol validation.',tools:[],nativeCapabilities:true,nativeTools:'main'},async()=>({}));
const timeline:string[]=[];
const receive=engine['receive'].bind(engine);
engine['receive']=async line=>{
 const m=JSON.parse(line);
 if(m.method==='turn/started')timeline.push('turn/started');
 if(m.params?.item?.type==='contextCompaction')timeline.push(m.method+':contextCompaction');
 if(m.method==='turn/completed')timeline.push('turn/completed:'+m.params.turn.status);
 return receive(line);
};
const safety=setTimeout(()=>void engine.close(),20000); // Validation-only cap on this isolated probe.
let stopped=false;
try {
 assert.match(codexVersion(bin),/0\.163\.0/);
 await engine.start();assert.equal(engine.version,'0.163.0');
 const account=await engine.request('account/read',{refreshToken:false});assert.equal(account.account,null);
 assert.equal((await engine.turn('Synthetic transport setup.')).status,'completed');
 timeline.length=0;
 const request=engine.request.bind(engine);
 engine.request=async(method,params)=>{const value=await request(method,params);if(method==='thread/compact/start')timeline.push('compact:ACK');return value;};
 await engine.compact();
 // Confirm the actual fixed-native terminal event too, not only the item notification.
 await new Promise<void>((resolve,reject)=>{
  let waiting=true;
  const deadline=setTimeout(()=>{waiting=false;reject(Error('probe_terminal_missing'));},1000);
  const check=()=>{if(!waiting)return;if(timeline.includes('turn/completed:completed')){waiting=false;clearTimeout(deadline);resolve();}else setImmediate(check);};check();
 });
 assert.ok(timeline.includes('item/started:contextCompaction'));
 assert.ok(timeline.includes('item/completed:contextCompaction'));
 stopped=await engine.close();assert.equal(stopped,true);assert.equal(engine['pending'].size,0);
 console.log(JSON.stringify({nativeVersion:engine.version,node:process.version,isolatedHome:true,accountPresent:false,loopbackModelResponses:calls,compactionTimeline:timeline,pendingAfterClose:engine['pending'].size,exitConfirmed:stopped,realLogin:false,realInstall:false},null,2));
} finally {
 clearTimeout(safety);if(!stopped)stopped=await engine.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));assert.equal(stopped,true,'probe_exit_unconfirmed');rmSync(dir,{recursive:true,force:true});
}
