import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,copyFileSync,chmodSync,writeFileSync,readFileSync,existsSync,renameSync,symlinkSync,readdirSync,lstatSync,appendFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {desktopBoundary,prepareDesktopProfile} from '../scripts/desktop-profile.mjs';
import {DatabaseSync} from 'node:sqlite';
import {PassThrough,Writable} from 'node:stream';
import {pathToFileURL} from 'node:url';
const scratch=resolve('.codex/scratch/macos-desktop-application'),app=resolve(process.env.HOMER_TEST_APP??join(scratch,'Homer.app'));
const resources=join(app,'Contents/Resources'),node=join(app,'Contents/MacOS/node');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const runtimeAccess=new Map();
const parent=resolve(process.env.HOMER_TEST_SCRATCH??join(scratch,'runtime-tests'));mkdirSync(parent,{recursive:true});
function profile(state={}){
 const root=mkdtempSync(join(parent,'中文 空格-'));
 writeFileSync(join(root,'.homer-desktop-test-profile'),'{"format":1}');
 copyFileSync(resolve('tests/fixtures/desktop-app-server.mjs'),join(root,'fixture-codex.mjs'));chmodSync(join(root,'fixture-codex.mjs'),0o700);
 writeFileSync(join(root,'fixture-control.json'),JSON.stringify(state));
 for(const part of ['host-home','tmp'])mkdirSync(join(root,part));return root;
}
function launch(root,daily=false){
 const child=spawn(node,[join(resources,'homer/scripts/desktop-runtime.mjs'),'--profile',root,'--test-profile',...(daily?['--deepseek-daily']:[])],{cwd:root,env:{PATH:dirname(node)+':/usr/bin:/bin',HOME:join(root,'host-home'),TMPDIR:join(root,'tmp'),LANG:'zh_CN.UTF-8'},stdio:['pipe','pipe','pipe',...(daily?['pipe']:[])]});
 if(daily){
  const baseUrl=JSON.parse(readFileSync(join(resources,'desktop-manifest.json'))).account.gatewayOrigin+'/v1';
  child.stdio[3].end(JSON.stringify(daily==='manual-token'?{token:'synthetic-deepseek-token'}:{token:'synthetic-deepseek-token',subject:'fixture_user',config:{main:{baseUrl,model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl,model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}}));
 }
 const events=[];let buffer='',stderr='';child.stdout.on('data',bytes=>{buffer+=bytes;let at;while((at=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,at));if(event.kind==='url'){assert.equal(typeof event.desktopAccessToken==='string'&&/^[a-f0-9]{64}$/.test(event.desktopAccessToken),true,'private desktop credential format');runtimeAccess.set(new URL(event.url).origin,event.desktopAccessToken);delete event.desktopAccessToken;}events.push(event);buffer=buffer.slice(at+1);}});child.stderr.on('data',b=>{stderr+=b;});
 const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
 return {child,events,exited,stderr:()=>stderr,async url(){for(let i=0;i<500;i++){const event=events.find(e=>e.kind==='url');if(event)return event.url;const error=events.find(e=>e.kind==='error');if(error)throw Error(error.code);if(child.exitCode!==null)throw Error('runtime exited');await wait(20);}throw Error('URL timeout');},async stop(){child.stdin.end('{"kind":"quit"}\n');let timer;const exit=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('stop timeout')),20000)})]).finally(()=>clearTimeout(timer));assert.equal(exit.code,0,JSON.stringify(events));assert.ok(events.some(e=>e.kind==='stopped'));recordSyntheticShutdown(root,events,exit);}};
}
function recordSyntheticShutdown(root,events,exit){
 const descriptor=join(root,'desktop-adoption.json'),adoption=existsSync(descriptor)?JSON.parse(readFileSync(descriptor)):undefined;
 const runtime=adoption?join(dirname(adoption.sourceConfig),'runtime-local-subscription'):join(root,'runtime');
 const codexHome=adoption?join(dirname(root),'Homer/codex'):join(root,'codex');
 const ownerPresent=existsSync(join(codexHome,'desktop-owner.json')),runtimeLockPresent=existsSync(join(runtime,'cli.lock')),gatewayLockPresent=existsSync(join(runtime,'gateway/cli.lock'));
 let leases=0;const database=join(runtime,'homer.sqlite');
 if(existsSync(database)){const db=new DatabaseSync(database,{readOnly:true});try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='meta'").get())leases=db.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'lease:%'").get().n;}finally{db.close();}}
 const receipt={synthetic:true,adopted:!!adoption,stopped:events.filter(e=>e.kind==='stopped'),runtimeExit:exit,ownerPresent,runtimeLockPresent,gatewayLockPresent,leases};
 appendFileSync(join(parent,'shutdown-receipts.jsonl'),JSON.stringify(receipt)+'\n');
 assert.equal(ownerPresent,false);assert.equal(runtimeLockPresent,false);assert.equal(gatewayLockPresent,false);assert.equal(leases,0);
}
const request=(url,path,input,headers={})=>fetch(url+path,{method:input===undefined?'GET':'POST',headers:{Origin:url,'X-Homer-Desktop-Access':runtimeAccess.get(new URL(url).origin),...(input===undefined?{}:{'Content-Type':'application/json'}),...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});
async function stateWhen(url,predicate){for(let i=0;i<500;i++){const r=await request(url,'/api/state');if(r.ok){const s=await r.json();if(predicate(s))return s;}await wait(20);}throw Error('state timeout');}
const methods=root=>existsSync(join(root,'fixture-methods.jsonl'))?readFileSync(join(root,'fixture-methods.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x).method):[];
test('a pending transport discovered under the gateway lock exits before spawning the host',{timeout:15000},async()=>{
 const root=profile(),runtime=join(root,'runtime'),homer=join(resources,'homer'),manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json')));
 const {IngressJournal}=await import(pathToFileURL(join(homer,'scripts/dev-ingress.mjs')).href),journal=new IngressJournal(runtime,'synthetic-binding');
 journal.store({requestId:'old-transport',text:'Synthetic'});journal.close();
 const {runDev}=await import(pathToFileURL(join(homer,'scripts/dev.mjs')).href),input=new PassThrough(),output=new Writable({write(_data,_enc,done){done();}});
 const build={directory:homer,hash:manifest.sourceHash,manifest:manifest.manifest,schema:manifest.schema,toolsHash:manifest.toolsHash,boundary:'synthetic-binding',config:{runtime,pauseOldDesktopWork:true},thread:'synthetic'};
 const previous=process.exitCode;
 try{
  const result=await runDev({root:homer,input,output,webPort:0,fixedBuild:build,fixedUi:build,fallbackUi:build,desktop:{onEvent(){}}});
  assert.equal(result.noHostStarted,true);assert.equal(result.startupError,'desktop_transport_review_required');
  assert.equal(existsSync(join(runtime,'gateway/cli.lock')),false);
  const check=new DatabaseSync(join(runtime,'gateway/transport.sqlite'),{readOnly:true});try{assert.equal(check.prepare("SELECT count(*) n FROM transport_requests WHERE state='pending'").get().n,1);}finally{check.close();}
 }finally{process.exitCode=previous;input.destroy();}
});
test('Finder requests reach the existing message attachment owner and missing authorization cannot launch Finder',{timeout:20000},async()=>{
 const root=profile({loggedIn:true}),run=launch(root);
 try{
  const url=await run.url();await stateWhen(url,s=>s.upgrade.phase==='running');
  const response=await request(url,'/api/media/message-missing/asset-00000000-0000-4000-8000-000000000001/1/reveal',{});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'media_scope_denied');
  assert.equal((await request(url,'/api/files/result-synthetic-missing/reveal',{})).status,404);
 }finally{await run.stop();}
});
test('desktop unopened account stays read-only and cannot restore deleted login endpoints',{timeout:30000},async()=>{
 const root=profile(),run=launch(root);
 try{
  const url=await run.url();assert.equal((await fetch(url)).status,200);
  const s=await stateWhen(url,s=>s.upgrade.phase==='management'&&s.upgrade.code==='desktop_account_required');
  assert.equal(s.threadId,'');assert.equal(s.upgrade.accepting,false);
  assert.equal((await request(url,'/api/capabilities')).status,404);
  assert.equal((await request(url,'/api/capabilities',{action:'account_login',approve:true})).status,404);
  assert.equal((await request(url,'/api/messages',{requestId:'synthetic-blocked',text:'synthetic'})).status,409);
  const db=new DatabaseSync(join(root,'runtime/gateway/transport.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) n FROM transport_requests').get().n,0);}finally{db.close();}
  assert.equal(methods(root).includes('thread/start'),false);
  await run.stop();
 }finally{if(run.child.exitCode===null)run.child.stdin.end('{"kind":"quit"}\n');}
});
test('packaged current history, queue, upload and same-thread restart retain synthetic data',{timeout:45000},async()=>{
 const root=profile({loggedIn:true});let run=launch(root);
 try{
  const url=await run.url(),s=await stateWhen(url,s=>s.upgrade.phase==='running');
  assert.equal(s.threadId,'synthetic-desktop-main');
  const history=await (await request(url,'/api/history/state')).json();assert.equal(history.history.protocol,3);assert.equal(history.threadId,s.threadId);
  assert.equal((await request(url,'/api/capabilities')).status,404);
  assert.equal((await fetch(url+'/api/state',{headers:{Origin:'https://example.invalid'}})).status,403);
  const sent=await request(url,'/api/messages',{requestId:'synthetic-conversation',text:'synthetic retained request'});
  assert.equal(sent.status,202,await sent.text());
  await stateWhen(url,s=>s.messages.some(m=>m.role==='assistant'&&m.requestId==='synthetic-conversation'&&m.status==='completed'&&m.text.includes('隔离测试答复')));
  const upload=await fetch(url+'/api/uploads',{method:'POST',headers:{Origin:url,'X-Homer-Desktop-Access':runtimeAccess.get(new URL(url).origin),'Content-Type':'application/octet-stream','X-Homer-Thread':s.threadId,'X-Homer-Request':'synthetic-draft','X-Homer-Upload':'synthetic-upload','X-Homer-Filename':encodeURIComponent('synthetic.txt')},body:Buffer.from('synthetic attachment')});
  assert.equal(upload.status,201,await upload.text());
  const second=launch(root);assert.equal((await second.exited).code,1);assert.ok(second.events.some(e=>e.code==='desktop_owner_conflict'));
  await run.stop();writeFileSync(join(root,'workspace/synthetic-retained'),'unchanged');
  const db=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});
  let before;
  try{before=db.prepare("SELECT id,text FROM conversation_messages WHERE requestId='synthetic-conversation' ORDER BY id").all();assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);}finally{db.close();}
  run=launch(root);const next=await stateWhen(await run.url(),s=>s.upgrade.phase==='running');assert.equal(next.threadId,s.threadId);
  assert.equal(readFileSync(join(root,'workspace/synthetic-retained'),'utf8'),'unchanged');
  const after=new DatabaseSync(join(root,'runtime/homer.sqlite'),{readOnly:true});try{assert.deepEqual(after.prepare("SELECT id,text FROM conversation_messages WHERE requestId='synthetic-conversation' ORDER BY id").all(),before);}finally{after.close();}
  assert.equal(methods(root).filter(m=>m==='thread/start').length,1);assert.ok(methods(root).includes('thread/resume'));await run.stop();
 }finally{if(run.child.exitCode===null)run.child.stdin.end('{"kind":"quit"}\n');}
});

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function externalInventory(path){
 const stat=lstatSync(path);
 return {mode:stat.mode,entries:stat.isDirectory()?readdirSync(path).sort().map(name=>[name,externalInventory(join(path,name))]):digest(readFileSync(path,'utf8'))};
}
test('sealed runtime rejects nested gateway/database/lock escapes before first SQLite or owner access',{timeout:30000},async()=>{
 const manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json')));
 for(const name of ['runtime/gateway','runtime/homer.sqlite','runtime/gateway/transport.sqlite','runtime/gateway/cli.lock','codex/desktop-owner.json']){
  const root=profile({loggedIn:true});prepareDesktopProfile(root,manifest,{test:true});
  const external=mkdtempSync(join(parent,'external-'));chmodSync(external,0o755);writeFileSync(join(external,'sentinel'),'unchanged',{mode:0o644});
  const path=join(root,name);mkdirSync(resolve(path,'..'),{recursive:true});
  symlinkSync(name==='runtime/gateway'?external:join(external,'sentinel'),path);
  const before=externalInventory(external),run=launch(root);
  assert.equal((await run.exited).code,1,JSON.stringify(run.events));
  assert.ok(run.events.some(e=>e.code==='desktop_control_path_invalid'),JSON.stringify(run.events));
  assert.deepEqual(externalInventory(external),before,'external contents and modes must be unchanged');
  assert.equal(existsSync(join(root,'runtime/cli.lock')),false);
  assert.equal(run.events.some(e=>e.kind==='url'),false);
 }
});
async function adoptedFixture({effort='high'}={}){
 // Seed a real package-owned synthetic profile, then arrange only these fake
 // files in the exact historical Homer layout. No production data is read.
 const seed=profile({loggedIn:true}),first=launch(seed);
 try{await stateWhen(await first.url(),s=>s.upgrade.phase==='running');}finally{await first.stop();}
 const base=mkdtempSync(join(parent,'adoption-')),shell=join(base,'Application Support/Homer Desktop'),original=join(base,'Application Support/Homer'),privateRoot=join(base,'project/.codex/private');
 for(const p of [shell,original,privateRoot,join(shell,'host-home'),join(shell,'tmp')])mkdirSync(p,{recursive:true,mode:0o700});
 const paths={runtime:join(privateRoot,'runtime-local-subscription'),workspace:join(privateRoot,'workspace'),codexHome:join(original,'codex')};
 for(const name of ['runtime','workspace','codex'])renameSync(join(seed,name),paths[name==='codex'?'codexHome':name]);
 for(const p of [shell,original]){
  writeFileSync(join(p,'.homer-desktop-test-profile'),'{"format":1}');writeFileSync(join(p,'fixture-control.json'),'{"loggedIn":true}');
 }
 copyFileSync(resolve('tests/fixtures/desktop-app-server.mjs'),join(shell,'fixture-codex.mjs'));chmodSync(join(shell,'fixture-codex.mjs'),0o700);
 const config={workspace:'workspace',runtime:'runtime-local-subscription',codexHome:paths.codexHome,codexBin:join(seed,'fixture-codex.mjs'),model:'synthetic',effort,requiresOpenaiAuth:true,mainTimeoutMs:600000};
 const source=join(privateRoot,'local-chatgpt.config.json');writeFileSync(source,JSON.stringify(config),{mode:0o600});
 writeFileSync(join(shell,'desktop-adoption.json'),JSON.stringify({format:1,test:true,sourceConfig:source,sha256:digest(readFileSync(source,'utf8'))}),{mode:0o600});
 const db=new DatabaseSync(join(paths.runtime,'homer.sqlite'));let toolsHash;
 try{
  db.prepare("UPDATE meta SET value=? WHERE key='binding'").run(digest({workspace:paths.workspace,codexHome:paths.codexHome,requiresOpenaiAuth:true}));
  toolsHash=db.prepare("SELECT value FROM meta WHERE key='mainToolsHash'").get().value;assert.match(toolsHash,/^[a-f0-9]{64}$/);
  db.prepare("INSERT INTO meta(key,value) VALUES('publicMainNodeSeq:v1','99') ON CONFLICT(key) DO UPDATE SET value='99'").run();
  db.prepare('INSERT INTO meta VALUES(?,?)').run('publicMainNode:v1:adoption-unknown',JSON.stringify({id:'adoption-unknown',threadId:'synthetic-desktop-main',seq:99,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'synthetic-unknown-reply',state:'working',status:'running',turnIds:['synthetic-prior-turn'],items:[{id:'synthetic-old-command',kind:'tool',seq:1,revision:1,label:'运行命令',category:'command',status:'running'}],completedItemIds:[],itemPhases:{}}));
 }finally{db.close();}
 const gateway=new DatabaseSync(join(paths.runtime,'gateway/transport.sqlite'));
 const oldBinding=digest([paths.runtime,paths.workspace,config.codexBin,paths.codexHome,undefined,undefined,true]);
 try{
  gateway.prepare("UPDATE transport_meta SET value=? WHERE key='binding'").run(oldBinding);
  gateway.prepare("INSERT INTO transport_requests(id,payload,hash,state,error) VALUES(?,?,?,?,?)").run('synthetic-rejected','','synthetic-hash','rejected','synthetic-error');
 }finally{gateway.close();}
 return {shell,original,paths,source,oldBinding,config,toolsHash,dbPath:join(paths.runtime,'homer.sqlite'),gatewayPath:join(paths.runtime,'gateway/transport.sqlite')};
}
async function refused(run,code){
 for(let i=0;i<500&&!run.events.some(e=>e.kind==='error')&&run.child.exitCode===null&&!run.events.some(e=>e.kind==='url');i++)await wait(20);
 if(run.child.exitCode===null&&!run.events.some(e=>e.kind==='error'))await run.stop();
 assert.ok(run.events.some(e=>e.kind==='error'&&e.code===code),JSON.stringify(run.events));
 assert.equal((await run.exited).code,1);
}
test('review refusal preserves an unowned active Worker and releases the desktop owner',{timeout:60000},async()=>{
 const f=await adoptedFixture();adoptGateway(f);
 const fromBundle=path=>import(pathToFileURL(join(resources,'homer/dist',path)).href);
 const [{Store},{Files},{RecursiveTasks},{ConversationHistory},{MainInputs}]=await Promise.all(['store.js','files.js','recursive-tasks.js','web-history.js','recursive-main-inputs.js'].map(fromBundle));
 const store=new Store(f.dbPath);
 let runId;
 try{
  const tasks=new RecursiveTasks(store,new Files(f.paths.workspace)),history=new ConversationHistory(store.db),inputs=new MainInputs(tasks,history);
  const threadId=store.meta('mainThread'),sourceRequestId='synthetic-worker-owner';
  store.db.prepare("UPDATE meta SET value=json_set(value,'$.state','worked','$.status','unknown') WHERE key='publicMainNode:v1:adoption-unknown'").run();
  inputs.accept({requestId:sourceRequestId,text:'Synthetic unowned work'});const source=inputs.claim();inputs.finish(source.messageId,source.revision,'completed');
  const actor={agentId:store.meta('mainAgentId'),threadId,sourceRequestId};
  runId=tasks.workerOpen(actor,{operationId:'synthetic-worker-open',text:'Inspect current work',workingDirectory:f.paths.workspace,authority:{sourceRequestId,description:'Synthetic test work'}}).runId;
  const run=tasks.claim(runId);tasks.bind(run.id,run.epoch,'worker-owner-thread','worker-owner-turn');
 }finally{store.close();}
 const blocked=launch(f.shell);await refused(blocked,'desktop_run_review_required');
 assert.ok(blocked.events.some(event=>event.kind==='startup_refused'));
 assert.equal(existsSync(join(f.paths.codexHome,'desktop-owner.json')),false);
 assert.equal(existsSync(join(f.paths.runtime,'cli.lock')),false);
 const reviewed=new DatabaseSync(f.dbPath);
 try{
  assert.equal(reviewed.prepare('SELECT status FROM runs WHERE id=?').get(runId).status,'running');
  reviewed.prepare("UPDATE runs SET checkpointJson=? WHERE id=?").run('{"workerExitConfirmed":1}',runId);
 }finally{reviewed.close();}
 const run=launch(f.shell);
 try{await stateWhen(await run.url(),s=>s.upgrade.phase==='running');await run.stop();}finally{if(run.child.exitCode===null)run.child.stdin.end('{"kind":"quit"}\n');}
});
function adoptGateway(f){
 const db=new DatabaseSync(f.gatewayPath),before=db.prepare('SELECT * FROM transport_requests ORDER BY seq').all(),meta=db.prepare("SELECT * FROM transport_meta WHERE key<>'binding' ORDER BY key").all();
 try{
  const target=desktopBoundary({...f.paths,requiresOpenaiAuth:true},'0.163.0');
  assert.equal(db.prepare("UPDATE transport_meta SET value=? WHERE key='binding' AND value=?").run(target,f.oldBinding).changes,1);
  assert.deepEqual(db.prepare('SELECT * FROM transport_requests ORDER BY seq').all(),before);
  assert.deepEqual(db.prepare("SELECT * FROM transport_meta WHERE key<>'binding' ORDER BY key").all(),meta);
 }finally{db.close();}
}
test('adoption requires reviewed gateway CAS, then original owner retains current schema facts and unknown work',{timeout:45000},async()=>{
 const f=await adoptedFixture(),before=readFileSync(f.source),blocked=launch(f.shell);
 await refused(blocked,'desktop_adoption_gateway_review_required');
 assert.ok(blocked.events.some(e=>e.kind==='startup_refused'));
 assert.equal(existsSync(join(f.paths.codexHome,'desktop-owner.json')),false);
 adoptGateway(f);let run=launch(f.shell);
 try{
  const s=await stateWhen(await run.url(),s=>s.upgrade.phase==='running');assert.equal(s.threadId,'synthetic-desktop-main');
  const db=new DatabaseSync(f.dbPath,{readOnly:true});
  try{
   assert.equal(db.prepare("SELECT value FROM meta WHERE key='recursiveSchemaVersion'").get().value,'6');
   assert.equal(db.prepare("SELECT value FROM meta WHERE key='mainToolsHash'").get().value,f.toolsHash);
   const node=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='publicMainNode:v1:adoption-unknown'").get().value);
   assert.equal(node.status,'running');assert.equal(node.items[0].status,'running');
   assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close();}
  await run.stop();run=launch(f.shell);assert.equal((await stateWhen(await run.url(),s=>s.upgrade.phase==='running')).threadId,s.threadId);await run.stop();
  assert.deepEqual(readFileSync(f.source),before);assert.equal(existsSync(join(f.shell,'runtime')),false);assert.equal(existsSync(join(f.shell,'codex')),false);
  const calls=methods(f.original);assert.equal(calls.filter(m=>m==='thread/start').length,0);assert.equal(calls.filter(m=>m==='turn/start').length,0);assert.ok(calls.includes('thread/resume'));
  const gateway=new DatabaseSync(f.gatewayPath,{readOnly:true});try{assert.equal(gateway.prepare("SELECT count(*) n FROM transport_requests WHERE state='rejected'").get().n,1);}finally{gateway.close();}
 }finally{if(run.child.exitCode===null)run.child.stdin.end('{"kind":"quit"}\n');}
});
test('manual Token pipe is refused before any adopted history or account is modified',{timeout:15000},async()=>{
 const f=await adoptedFixture({effort:'high'});adoptGateway(f);
 const before=readFileSync(f.dbPath),config=readFileSync(f.source),run=launch(f.shell,'manual-token');
 assert.equal((await run.exited).code,1);assert.equal(run.events.some(e=>e.kind==='url'),false);
 assert.deepEqual(readFileSync(f.dbPath),before);assert.deepEqual(readFileSync(f.source),config);
 assert.equal(methods(f.original).includes('thread/start'),false);
});
for(const effort of ['high','max'])test(`daily website uses max and preserves original ${effort} config, thread and unknown work on native rollback`,{timeout:60000},async()=>{
 // Website roles use max; retain the original source effort for native rollback.
 const f=await adoptedFixture({effort}),originalConfig=readFileSync(f.source);adoptGateway(f);
 writeFileSync(join(f.original,'fixture-control.json'),JSON.stringify({loggedIn:true,deepseekSmoke:true}));
 const before=new DatabaseSync(f.dbPath,{readOnly:true}),old=before.prepare("SELECT value FROM meta WHERE key='publicMainNode:v1:adoption-unknown'").get().value;before.close();
 let run=launch(f.shell,true);
 try{
  const url=await run.url(),state=await stateWhen(url,s=>s.upgrade.phase==='running');
  assert.equal(state.threadId,'synthetic-desktop-main');
  assert.equal((await request(url,'/api/messages',{requestId:'synthetic-daily-new',text:'synthetic new'})).status,202);
  await stateWhen(url,()=>methods(f.original).includes('turn/start'));
  for(let i=0;i<500;i++){const db=new DatabaseSync(f.dbPath,{readOnly:true});const row=db.prepare("SELECT status FROM conversation_messages WHERE requestId='synthetic-daily-new' AND role='assistant'").get();db.close();if(row?.status==='completed')break;if(i===499)throw Error('synthetic_reply_timeout');await wait(20);}
  writeFileSync(join(f.paths.workspace,'synthetic.md'),'Synthetic daily material');
  assert.equal((await request(url,'/api/messages',{requestId:'synthetic-daily-worker',text:'dispatch-synthetic'})).status,202);
  const delivered=await stateWhen(url,s=>s.artifacts?.some(file=>file.title==='hello.md'));
  const file=delivered.artifacts.find(file=>file.title==='hello.md');
  const downloaded=await request(url,'/api/media/'+file.messageId+'/'+file.assetId+'/'+file.revision);
  assert.equal(downloaded.status,200);assert.equal(await downloaded.text(),'DeepSeek Worker 已运行（离线合成）');
  assert.equal(downloaded.headers.get('x-homer-artifact-hash'),file.sha256);
  await run.stop();
  const models=readFileSync(join(f.original,'fixture-models.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  for(const worker of [false,true])assert.ok(models.some(model=>model.worker===worker&&model.model==='deepseek-flash'&&model.effort==='max'&&model.serviceTier===null&&model.keyPresent));
  const turnCount=methods(f.original).filter(x=>x==='turn/start').length;
  run=launch(f.shell);assert.equal((await stateWhen(await run.url(),s=>s.upgrade.phase==='running')).threadId,state.threadId);await run.stop();
  const after=new DatabaseSync(f.dbPath,{readOnly:true});try{assert.equal(after.prepare("SELECT value FROM meta WHERE key='publicMainNode:v1:adoption-unknown'").get().value,old);}finally{after.close();}
  assert.deepEqual(readFileSync(f.source),originalConfig);
  assert.equal(methods(f.original).filter(x=>x==='turn/start').length,turnCount);
 }finally{if(run.child.exitCode===null)run.child.stdin.end('{"kind":"quit"}\n');}
});
for(const kind of ['active','unknown'])test(`adoption refuses ${kind} original ownership without deleting its records`,{timeout:30000},async()=>{
 const f=await adoptedFixture();adoptGateway(f);
 const db=new DatabaseSync(f.dbPath),lease=JSON.stringify({pid:kind==='active'?process.pid:0,identity:'synthetic-owner'});
 try{db.prepare("INSERT INTO meta(key,value) VALUES('lease:main',?)").run(lease);}finally{db.close();}
 const run=launch(f.shell);await refused(run,'desktop_adoption_owner_unknown');
 assert.equal(existsSync(join(f.paths.codexHome,'desktop-owner.json')),false);
 const verify=new DatabaseSync(f.dbPath,{readOnly:true});try{assert.equal(verify.prepare("SELECT value FROM meta WHERE key='lease:main'").get().value,lease);}finally{verify.close();}
 assert.equal(methods(f.original).includes('thread/resume'),false);
});

test('unsupported schema5 adoption is refused before engine launch or database mutation',{timeout:45000},async()=>{
 const f=await adoptedFixture();adoptGateway(f);
 const db=new DatabaseSync(f.dbPath);db.prepare("UPDATE meta SET value='5' WHERE key='recursiveSchemaVersion'").run();db.close();
 const before=readFileSync(f.dbPath),run=launch(f.shell);
 await refused(run,'desktop_schema_incompatible');
 assert.deepEqual(readFileSync(f.dbPath),before);assert.equal(existsSync(join(f.paths.codexHome,'desktop-owner.json')),false);
});
