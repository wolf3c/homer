// Actual fixed Codex + scripted loopback Responses. All projects, HOME, notes,
// threads and child agents are synthetic. No account or paid model is used.
import {createServer} from 'node:http';import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {CodexEngine} from '../src/engine.js';
const root=resolve('.codex/scratch/flexible-execution-review');mkdirSync(root,{recursive:true});const d=mkdtempSync(join(root,'native-lifecycle-')),project=join(d,'project'),other=join(d,'project-b'),home=join(d,'codex');for(const p of[project,other,home])mkdirSync(p);
writeFileSync(join(home,'config.toml'),'sandbox_mode = "danger-full-access"\napproval_policy = "on-request"\n');
writeFileSync(join(project,'AGENTS.md'),'SYNTHETIC_LOCAL_AGENT_GUIDANCE_42\n');mkdirSync(join(project,'.agents/skills/local-proof'),{recursive:true});writeFileSync(join(project,'.agents/skills/local-proof/SKILL.md'),'---\nname: local-proof\ndescription: SYNTHETIC_LOCAL_SKILL_DISCOVERY_24\n---\nSynthetic local project skill.\n');
const config={appData:d,codexHome:home,workspace:project,runtime:join(d,'runtime'),codexBin:resolve(process.argv[2]!),baseUrl:'',model:'gpt-6.1-sol',effort:'low' as const,requiresOpenaiAuth:false,stopGraceMs:1000};mkdirSync(config.runtime);
const requests:{foreground:boolean;script:boolean;inputKinds:string[];itemType?:string}[]=[];
let activeRole:'main'|'worker'='main';const instructionChecks:{role:string;nativeBase:boolean;methodsCount:number;methodsInDeveloper:boolean;methodsInNativeBase:boolean;historicalCustomBase:boolean}[]=[];
let stopMode=false,stopChildStarted=false,ownedSleepPid:number|undefined,extractions=0;
let script='',sent=false,sequence=0,parentStep=0,childStep=0,approvals=0;let nativeDefaultSeen=false,productMethodsSeen=false,localGuidanceSeen=false,localSkillSeen=false,oldBaseSeen=false;const outputs:string[]=[];const catalogNames=new Set<string>();let spawnAvailable=false;let parentActive=false;let childId='';let childCompleted=false;
const server=createServer(async(req,res)=>{
 if(req.url==='/synthetic-development'){res.end('synthetic-localhost-development');return;}if(req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
 let raw='';for await(const b of req)raw+=b;const data=JSON.parse(raw),input=JSON.stringify(data.input??[]);sequence++;const user=(data.input??[]).findLast((x:any)=>x.role==='user');const userText=(user?.content??[]).map((x:any)=>x.text??'').join('');const foreground=/^(Synthetic |SYNTHETIC_NATIVE_PARENT)/.test(userText.trim())||(data.input??[]).some((x:any)=>x.type==='agent_message'&&JSON.stringify(x).includes('SYNTHETIC_NATIVE_CHILD:'));requests.push({foreground,script:!!script,inputKinds:(data.input??[]).map((x:any)=>x.type??x.role)});
 nativeDefaultSeen||=typeof data.instructions==='string'&&data.instructions.length>1000&&!data.instructions.includes('SYNTHETIC_OLD_HOMER_BASE');nativeDefaultSeen||=input.includes('You are')&&!input.includes('SYNTHETIC_OLD_HOMER_BASE');productMethodsSeen||=input.includes('SYNTHETIC_PRODUCT_METHODS');localGuidanceSeen||=input.includes('SYNTHETIC_LOCAL_AGENT_GUIDANCE_42');localSkillSeen||=input.includes('SYNTHETIC_LOCAL_SKILL_DISCOVERY_24');oldBaseSeen||=(String(data.instructions)+input).includes('SYNTHETIC_OLD_HOMER_BASE');
 if(foreground){const messages=(data.input??[]).filter((x:any)=>x.type==='message'),native=messages.find((x:any)=>JSON.stringify(x).includes('You are Codex'));
 const methods=messages.filter((x:any)=>JSON.stringify(x).includes('SYNTHETIC_PRODUCT_METHODS'));
 instructionChecks.push({role:activeRole,nativeBase:!!native,methodsCount:methods.length,methodsInDeveloper:methods.length===1&&methods[0].role==='developer',methodsInNativeBase:JSON.stringify(native??{}).includes('SYNTHETIC_PRODUCT_METHODS'),historicalCustomBase:input.includes('SYNTHETIC_OLD_HOMER_BASE')});}
 const catalog=[...(data.tools??[]),...(data.input??[]).filter((x:any)=>x.type==='additional_tools').flatMap((x:any)=>x.tools??[])];
 for(const t of catalog){catalogNames.add(t.name??t.type);for(const n of t.tools??[]){catalogNames.add(t.name+'.'+n.name);if(n.name==='spawn_agent')spawnAvailable=true;}}
 const out=(data.input??[]).filter((x:any)=>['function_call_output','custom_tool_call_output'].includes(x.type));for(const o of out)outputs.push(JSON.stringify(o.output));
 let item:any;
 const code=(body:string)=>({id:'call-'+sequence,type:'custom_tool_call',namespace:'functions',name:'exec',call_id:'exec-'+sequence,input:body});
 const fn=(name:string,args:any)=>({id:'call-'+sequence,type:'function_call',namespace:'collaboration',name,call_id:'collab-'+sequence,arguments:JSON.stringify(args)});
 const extraction=!!data.text?.format?.schema?.properties?.raw_memory;
 if(extraction){extractions++;item=message(JSON.stringify({raw_memory:'Synthetic durable extraction fact.',rollout_summary:'Synthetic probe completed.',rollout_slug:'synthetic-probe'}));}
 else if((data.input??[]).some((x:any)=>x.type==='agent_message'&&JSON.stringify(x).includes('SYNTHETIC_NATIVE_CHILD:'))&&parentActive){
  if(stopMode){if(stopChildStarted)return;stopChildStarted=true;item=code('text(await tools.exec_command({cmd:'+JSON.stringify('/bin/sh -c '+JSON.stringify('printf $$ > '+join(project,'owned-child.pid')+'; exec /bin/sleep 90'))+',login:false,yield_time_ms:1000}));');}
  else if(childStep++===0)item=code('text(await tools.exec_command({cmd:"pwd; printf native-child > native-child.txt",login:false}));');
  else {childCompleted=true;item=message('SYNTHETIC_NATIVE_CHILD_COMPLETED');}
 }else if(parentActive){
  if(parentStep===0){parentStep++;item=fn('spawn_agent',{task_name:'synthetic_native_child',message:'SYNTHETIC_NATIVE_CHILD: execute the one scripted synthetic command and finish.',fork_turns:'none'});}
  else if(parentStep===1){parentStep++;const text=JSON.stringify(out);const match=text.match(/(?:agent_id|agentId|id)[\\"\s:]+([a-f0-9-]{36})/);childId=match?.[1]??'';item=fn('wait_agent',{timeout_ms:10000});}
  else if(parentStep===2&&!childCompleted){item=fn('wait_agent',{timeout_ms:10000});}
  else {parentActive=false;item=message('SYNTHETIC_NATIVE_PARENT_COMPLETED');}
 }else if(script&&!sent&&foreground){sent=true;item=code(script);}else item=message('Synthetic lifecycle receipt.');
 function message(text:string){return {id:'msg-'+sequence,type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]};}
 requests.at(-1)!.itemType=item.type;
 const response={id:'response-'+sequence,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};res.setHeader('Content-Type','text/event-stream');for(const e of[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,...(item.type==='message'?{content:[]}:{})}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');res.end();
});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));config.baseUrl=`http://127.0.0.1:${(server.address() as any).port}/v1`;
const make=(role:'main'|'worker'='main',threadId?:string)=>{activeRole=role;return new CodexEngine(config,{cwd:project,readRoots:[],instructions:'SYNTHETIC_PRODUCT_METHODS',tools:[],nativeTools:role,threadId,onInteraction:async()=>{approvals++;return {status:'denied',decision:{action:'deny',reason:'synthetic_unexpected_approval'}};}},async()=>{throw Error('no_host_tools');});};
let engine=make();const receipt:Record<string,unknown>={realModel:false,realAccount:false,synthetic:true};
async function run(text:string,body='',cwd?:string){script=body;sent=false;const r=await engine.turn(text,{cwd});assert.equal(r.status,'completed');script='';return r;}
async function networking(role:string){
 const base=config.baseUrl.replace(/\/v1$/,''),suffix=role+'.txt';
 const commands=[
  ['/usr/bin/curl','--noproxy','*','--fail','--silent','--show-error','--max-time','12','--output','public-'+suffix,'https://github.com/robots.txt'],
  ['/usr/bin/git','-c','credential.helper=','-c','core.askPass=','-c','http.lowSpeedLimit=1','-c','http.lowSpeedTime=10','ls-remote','https://github.com/makecindy/cindy.git','HEAD'],
  ['/usr/bin/curl','--noproxy','*','--fail','--silent','--show-error','--max-time','12','--output','dependency-'+role+'.tgz','https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz'],
  ['/usr/bin/curl','--noproxy','*','--fail','--silent','--show-error','--max-time','5','--output','local-'+suffix,base+'/synthetic-development'],
 ];const exits=[];
 for(const [index,command]of commands.entries()){const result=await engine.request('command/exec',{command,cwd:project,permissionProfile:'homer',timeoutMs:12000});exits.push(result.exitCode);if(index===1)writeFileSync(join(project,'git-'+suffix),result.stdout??'');}
 receipt[role+'NetworkExits']=exits;assert.deepEqual(exits,[0,0,0,0]);
 assert.match(readFileSync(join(project,'git-'+suffix),'utf8'),/^[a-f0-9]+\s+HEAD/);assert.equal(readFileSync(join(project,'local-'+suffix),'utf8'),'synthetic-localhost-development');
 receipt[role+'Network']={https:true,publicGitRead:true,registryDownloadOnly:true,localhost:true,lifecycleScriptsExecuted:false};
}
try{
 await engine.start();const c=await engine.request('config/read',{cwd:project});receipt.nativeConfig={featuresMemories:c.config.features.memories,memories:c.config.memories};assert.notEqual(c.config.memories.generate_memories,false);assert.notEqual(c.config.memories.use_memories,false);assert.equal(c.config.memories.dedicated_tools,true);
 if(process.argv.includes('--network'))await networking('main');
 const skill=await engine.request('skills/list',{cwds:[project],forceReload:true});receipt.localSkillDiscovery=(skill.data??[]).some((g:any)=>(g.skills??[]).some((s:any)=>s.name==='local-proof'));assert.equal(receipt.localSkillDiscovery,true);
 await run('Synthetic ordinary project command.','text(await tools.exec_command({cmd:"pwd; printf ordinary > ordinary.txt",login:false}));');assert.equal(readFileSync(join(project,'ordinary.txt'),'utf8'),'ordinary');
 await run('Synthetic switched directory.','text(await tools.exec_command({cmd:"pwd; printf second > second.txt",login:false}));',other);assert.equal(readFileSync(join(other,'second.txt'),'utf8'),'second');receipt.nativeCwdSwitch=true;
 await run('Synthetic native note write and read.','text(await tools.memories__add_ad_hoc_note({filename:"2026-10-19T00-00-00-synthetic-probe.md",note:"SYNTHETIC_SHARED_NATIVE_NOTE_73"}));text(await tools.memories__read({path:"extensions/ad_hoc/notes/2026-10-19T00-00-00-synthetic-probe.md"}));',project);assert.ok(outputs.some(x=>x.includes('SYNTHETIC_SHARED_NATIVE_NOTE_73')));receipt.mainNativeNote=true;
 assert.equal(spawnAvailable,false);receipt.mainNativeSpawnVisible=false;receipt.mainNativeWaitVisible=[...catalogNames].some(x=>x==='collaboration.wait_agent');assert.equal(receipt.mainNativeWaitVisible,false);
 const mainThread=engine.threadId;receipt.mainClosed=await engine.close();engine=make('main',mainThread);await engine.start();await run('Synthetic same main resume with native defaults.');assert.equal(engine.threadId,mainThread);await engine.close();engine=make('worker');await engine.start();if(process.argv.includes('--network'))await networking('worker');
 parentActive=true;const parentResult=await run('SYNTHETIC_NATIVE_PARENT: test the actual native child lifecycle.');assert.equal(parentResult.text,'SYNTHETIC_NATIVE_PARENT_COMPLETED');parentActive=false;assert.equal(spawnAvailable,true);assert.equal(childCompleted,true);assert.equal(readFileSync(join(project,'native-child.txt'),'utf8'),'native-child');receipt.nativeChildCompleted=true;receipt.nativeChildIdParsed=!!childId;receipt.nativeChildCwdInherited=true;
 const workerThread=engine.threadId;receipt.parentClosed=await engine.close();assert.equal(receipt.parentClosed,true);engine=make('worker',workerThread);await engine.start();await run('Synthetic same Worker resume with native defaults.');assert.equal(engine.threadId,workerThread);await engine.close();
 engine=make('worker');await engine.start();await run('Synthetic worker native note read.','text(await tools.memories__read({path:"extensions/ad_hoc/notes/2026-10-19T00-00-00-synthetic-probe.md"}));');receipt.workerNativeRead=outputs.some(x=>x.includes('SYNTHETIC_SHARED_NATIVE_NOTE_73'));assert.equal(receipt.workerNativeRead,true);
 await engine.close();
 engine=make('worker');await engine.start();stopMode=true;parentActive=true;parentStep=0;childStep=0;
 const stoppedTurn=engine.turn('SYNTHETIC_NATIVE_PARENT: stop the synthetic parent with its native child still active.').catch(()=>undefined);
 const deadline=Date.now()+12000;while(!existsSync(join(project,'owned-child.pid'))){assert.ok(Date.now()<deadline,'native child start deadline');await new Promise(r=>setTimeout(r,20));}
 ownedSleepPid=Number(readFileSync(join(project,'owned-child.pid'),'utf8'));assert.ok(ownedSleepPid>1);process.kill(ownedSleepPid,0);
 receipt.parentStoppedWithLiveChild=await engine.close();await stoppedTurn;parentActive=false;stopMode=false;
 const end=Date.now()+2000;let alive=true;while(Date.now()<end){try{process.kill(ownedSleepPid,0);await new Promise(r=>setTimeout(r,20));}catch{alive=false;break;}}
 receipt.nativeChildShellSurvivedParentClose=alive;assert.equal(alive,false,'owned native child Shell must exit with parent');ownedSleepPid=undefined;
 // Backdate ONLY our synthetic native threads to satisfy Codex's unchanged native idle gate (48h fixture age).
 const fixtureDb=new DatabaseSync(join(home,'state_5.sqlite'));fixtureDb.prepare("UPDATE threads SET updated_at_ms=?,recency_at_ms=?,has_user_event=1,tokens_used=4096,preview='Synthetic eligibility fixture' WHERE memory_mode='enabled'").run(Date.now()-48*3600000,Date.now()-48*3600000);fixtureDb.close();
 engine=make();await engine.start();await run('Synthetic trigger native startup extraction.');const extractionDeadline=Date.now()+10000;const memoryDb=new DatabaseSync(join(home,'memories_1.sqlite'));let rows=memoryDb.prepare('SELECT count(*) n FROM stage1_outputs').get()!;while(!Number(rows.n)&&Date.now()<extractionDeadline){await new Promise(r=>setTimeout(r,20));rows=memoryDb.prepare('SELECT count(*) n FROM stage1_outputs').get()!;}receipt.nativeAutomaticExtractionRows=rows.n;memoryDb.close();assert.ok(Number(rows.n)>0);receipt.nativeAutomaticExtractionRequests=extractions;await engine.close();
 // An old custom base survives omission on resume. This proves why the host
 // must not silently claim that changing the RPC field migrates old threads.
 engine=make();await engine.start();const old=await engine.request('thread/start',{model:config.model,cwd:project,approvalPolicy:'never',baseInstructions:'SYNTHETIC_OLD_HOMER_BASE',config:{'features.memories':true,'memories.dedicated_tools':true}});engine.threadId=old.thread.id;await run('Synthetic persist historical base.');await engine.close();oldBaseSeen=false;engine=make('main',old.thread.id);await engine.start();await run('Synthetic resume historical base.');receipt.oldCustomBasePersists=oldBaseSeen;assert.equal(oldBaseSeen,true);
 const db=new DatabaseSync(join(home,'state_5.sqlite'));receipt.nativeMemoryModes=db.prepare('SELECT DISTINCT memory_mode FROM threads').all();db.close();
 receipt.newAndNativeResumedInstructionChecks=instructionChecks.filter(x=>!x.historicalCustomBase);for(const check of instructionChecks.filter(x=>!x.historicalCustomBase)){assert.equal(check.nativeBase,true);assert.equal(check.methodsCount,1);assert.equal(check.methodsInDeveloper,true);assert.equal(check.methodsInNativeBase,false);}
 receipt.oldThreadNativeResetSupported=false;receipt.oldThreadMigrationPassed=false;receipt.nativeDefaultBaseSeen=nativeDefaultSeen;receipt.productDeveloperInstructionsSeen=productMethodsSeen;receipt.localAgentsSeen=localGuidanceSeen;receipt.localSkillSeen=localSkillSeen;receipt.approvals=approvals;assert.equal(nativeDefaultSeen,true);assert.equal(productMethodsSeen,true);assert.equal(localGuidanceSeen,true);assert.equal(approvals,0);receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error instanceof Error&&'code' in error?String(error.code):'native_lifecycle_failed';receipt.childStep=childStep;receipt.parentStep=parentStep;receipt.catalog=[...catalogNames];receipt.requests=requests;receipt.outputClassifications=outputs.slice(-3).map(x=>({unknownTool:/unknown|not found|Unknown/.test(x),error:/error|Error|failed/.test(x),bytes:x.length}));process.exitCode=1;}
finally{await engine.close();if(ownedSleepPid){try{process.kill(ownedSleepPid,'SIGKILL');}catch{}}server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));writeFileSync(join(root,'native-lifecycle-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
