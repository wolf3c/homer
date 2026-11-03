// Credential-free proof of native phase-2 artifact output through its real shell tool.
// Only the newly created temporary database is modified; never live data.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=resolve('.codex/scratch/native-memory-adoption-20261018');
mkdirSync(root,{recursive:true});
const dir=mkdtempSync(join(root,'consolidation-output-'));
if(process.argv.length!==2)throw Error('synthetic_only_no_arguments');
const home=join(dir,'application-data/codex'),cwd=join(dir,'workspace');
for(const path of [home,join(home,'host-home'),cwd])mkdirSync(path,{recursive:true,mode:0o700});
const binary=resolve('.codex/private/engines/codex-0.163.0/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
const marker='HOMER_NATIVE_PROBE_'+randomUUID().replaceAll('-','');
let backgroundToolSent=false,backgroundToolReturned=false;
let requestCount=0,foregroundRequests=0,backgroundRequests=0,child,thread,seq=0;
const events=[],pending=new Map(),observations=[];
const scripted=createServer(async(req,res)=>{
 let body='';try{for await(const chunk of req)body+=chunk;}catch(error){if(req.aborted)return;throw error;}
 if(req.url!=='/v1/responses'){res.writeHead(404);return res.end();}
 const data=JSON.parse(body);requestCount++;
 const id='probe-'+requestCount;
 let item={id:'msg-'+id,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic storage contract only.',annotations:[]}]};
 const foreground=JSON.stringify(data.input?.findLast(x=>x.role==='user')??{}).includes('Synthetic native memory contract:');
 if(foreground)foregroundRequests++;else {backgroundRequests++;observations.push({background:true,toolOutputs:(data.input??[]).filter(x=>['custom_tool_call_output','function_call_output'].includes(x.type)),parentInstructionsInherited:JSON.stringify([data.instructions,...(data.input??[])]).includes('Synthetic contract probe. No real data or provider.')});}
 if(!foreground&&!backgroundToolSent){
  backgroundToolSent=true;
  const command="printf '%s\\n' '# Task Group: Synthetic output contract' '' 'No real user facts.' > MEMORY.md\nprintf '%s\\n' 'v1' 'Synthetic output contract only.' > memory_summary.md";
  item={id:'fc-'+id,type:'custom_tool_call',namespace:'functions',name:'exec',call_id:'background-write-'+id,input:'const r=await tools.exec_command('+JSON.stringify({cmd:command,workdir:join(home,'memories')})+'); text({exitCode:r.exit_code,output:r.output});'};
 }else if(!foreground&&backgroundToolSent){backgroundToolReturned=true;}
 const response={id:'resp-'+id,object:'response',created_at:1,model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 res.setHeader('Content-Type','text/event-stream');
 for(const e of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');
 res.end();
});
await new Promise(r=>scripted.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+scripted.address().port;
const settings={model:'gpt-6.1-sol',model_provider:'synthetic_memory',
 'model_providers.synthetic_memory':{name:'Synthetic native lifecycle',base_url:origin+'/v1',wire_api:'responses',requires_openai_auth:false,supports_websockets:false},
 sqlite_home:home,log_dir:join(home,'log'),cli_auth_credentials_store:'file',mcp_oauth_credentials_store:'file',
 'features.memories':true,'memories.use_memories':true,'memories.generate_memories':false,'memories.dedicated_tools':true,
 'memories.extract_model':'gpt-6.1-sol','memories.consolidation_model':'gpt-6.1-sol','memories.max_rollouts_per_startup':1,
 'features.code_mode_host':true,'features.code_mode':false,'features.shell_tool':true,'features.shell_snapshot':false,
 'features.apps':false,'features.plugins':false,'features.multi_agent':false,'features.multi_agent_v2':false,
 'features.browser_use':false,'features.computer_use':false,'features.hooks':false,'features.skip_host_skill_discovery':true,
 web_search:'disabled','analytics.enabled':false,'feedback.enabled':false,approval_policy:'never'};
const toml=v=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+toml(x)).join(',')+'}':JSON.stringify(v);
function rpc(method,params={}){return new Promise((accept,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('native_timeout:'+method));},20000);pending.set(id,{accept,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
async function start(){
 child=spawn(binary,['app-server','--stdio',...Object.entries(settings).flatMap(([k,v])=>['-c',k+'='+toml(v)])],{cwd,env:{PATH:process.env.PATH,HOME:join(home,'host-home'),CODEX_HOME:home,TMPDIR:process.env.TMPDIR}});
 child.stderr.resume();
 child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('native_disconnected'));}pending.clear();});
 createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('native_rpc_'+m.error.code)):p.accept(m.result);}else if(m.method)events.push(m);});
 const init=await rpc('initialize',{clientInfo:{name:'homer-native-memory-lifecycle',version:'1'},capabilities:{experimentalApi:true}});
 assert.match(init.userAgent,/\/0\.163\.0 /);assert.equal(resolve(init.codexHome),home);
 child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 thread=(await rpc('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only',baseInstructions:'Synthetic contract probe. No real data or provider.'})).thread.id;
}
async function close(){if(!child||child.exitCode!==null)return;const own=child;const ended=new Promise(r=>own.once('exit',r));own.kill('SIGTERM');await ended;child=undefined;}
async function run(){
 events.length=0;
 const started=await rpc('turn/start',{threadId:thread,environments:[],input:[{type:'text',text:'Synthetic native memory contract: output path'}]});
 const end=Date.now()+20000;
 while(Date.now()<end){const done=events.find(e=>e.method==='turn/completed'&&e.params.threadId===thread&&e.params.turn.id===started.turn.id);if(done){assert.equal(done.params.turn.status,'completed');return;}await new Promise(r=>setTimeout(r,20));}
 throw Error('native_turn_timeout');
}
const receipt={at:new Date().toISOString(),realModel:false,realAccount:false,dir,home,marker};
async function job(){
 const dbPath=join(home,'memories_1.sqlite');if(!existsSync(dbPath))return;
 const db=new DatabaseSync(dbPath,{readOnly:true});try{if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='jobs'").get())return;return db.prepare("SELECT status,retry_remaining,retry_at,last_error FROM jobs WHERE kind='memory_consolidate_global'").get();}finally{db.close();}
}
try{
 await start();receipt.thread=thread;
 await run();
 const deadline=Date.now()+25000;let row;
 while(Date.now()<deadline){row=await job();if(['done','succeeded','error'].includes(row?.status))break;await new Promise(r=>setTimeout(r,25));}
 receipt.backgroundObservations=observations.filter(x=>x.background);receipt.job=row;receipt.backgroundToolSent=backgroundToolSent;receipt.backgroundToolReturned=backgroundToolReturned;
 receipt.memoryFileExists=existsSync(join(home,'memories/MEMORY.md'));receipt.summaryFileExists=existsSync(join(home,'memories/memory_summary.md'));
 assert.equal(foregroundRequests,1);assert.equal(backgroundRequests,2);assert.equal(row?.status,'done');assert.equal(backgroundToolReturned,true);assert.equal(receipt.memoryFileExists,true);assert.equal(receipt.summaryFileExists,true);
 receipt.realModel=false;receipt.realAccount=false;receipt.liveDataTouched=false;receipt.status='passed';
}catch(error){receipt.error=error.message;process.exitCode=1;}
finally{await close();scripted.closeAllConnections();await new Promise(r=>scripted.close(r));writeFileSync(join(dir,'native-consolidation-output-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({directory:dir,status:receipt.status,job:receipt.job,backgroundToolReturned:receipt.backgroundToolReturned,memoryFileExists:receipt.memoryFileExists,error:receipt.error,foregroundRequests,backgroundRequests,realModel:false,liveDataTouched:false}));}
