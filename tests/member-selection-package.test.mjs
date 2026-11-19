// Explicit macOS acceptance with two loopback preparation builds and yezi2's real PKCE/config handlers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {existsSync,linkSync,unlinkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {_electron} from 'playwright-core';

const candidate=process.env.HOMER_TEST_APP,legacy=process.env.HOMER_TEST_V1_APP,siteModule=process.env.HOMER_TEST_CONFIG_SITE_MODULE;
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const manifest=bundle=>read(join(bundle,'Contents/Resources/desktop-manifest.json'));
const terra='gpt-6.1-terra';
const defaults={main:{model:terra,effort:'medium'},worker:{model:terra,effort:'high'}};
const alternate={main:{model:terra,effort:'high'},worker:{model:terra,effort:'medium'}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){
 const end=Date.now()+45000;
 while(Date.now()<end){const value=await check();if(value)return value;await sleep(100);}
 throw Error('Timed out waiting for '+label);
}
const close=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
const listen=(server,origin)=>new Promise((resolve,reject)=>server.once('error',reject).listen(Number(new URL(origin).port),'127.0.0.1',resolve));
async function body(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);}

// Classify the actor from its own user input. Using the observed model or effort would hide swapped roles.
function gatewayScenario(label,selection,review,profile,catalog){
 const workspace=join(profile,'workspace');
 const seen=new Set();let requests=0,workerOpened=false,reviewRequested=false,searches=0;
 const reply=data=>{
  assert.ok(++requests<=25,'unexpected request loop');
  const user=JSON.stringify(data.input?.findLast(item=>item.role==='user')?.content??[]);
  const reviewer=data.text?.format?.type==='json_schema';
  const role=reviewer?'review':user.includes('worker-case-'+label)&&!user.includes('内部协作输入')?'worker':'main';
  const expected=role==='review'?{model:'gpt-6-luna',effort:'low'}:selection[role];
  assert.equal(data.model,expected.model,role+' model');assert.equal(data.reasoning?.effort,expected.effort,role+' effort');
  if(catalog&&role!=='review'&&!seen.has(role)){
   const db=new DatabaseSync(join(profile,'runtime/homer.sqlite'),{readOnly:true});
   try{
    const sql=role==='main'?"select value from meta where key='lease:main'":"select m.value from meta m join runs r on m.key='lease:'||r.id where r.status='running'";
    const {pid}=JSON.parse(db.prepare(sql).get().value);
    const command=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
    assert.ok(command.includes('model_catalog_json='+JSON.stringify(catalog)),role+' native process uses the packaged catalog');
   }finally{db.close();}
  }
  seen.add(role);
  const id='resp_'+requests;
  const answer=text=>({type:'message',id:'msg_'+id,role:'assistant',content:[{type:'output_text',text,annotations:[]}]});
  const exec=input=>({type:'custom_tool_call',id:'tool_'+id,call_id:'call_'+id,name:'exec',input});
  let item;
  if(reviewer){assert.ok(reviewRequested);item=answer(JSON.stringify({outcome:'allow',rationale:'Authorized synthetic marker in the isolated workspace'}));}
  else if(role==='worker'&&review&&!reviewRequested){
   reviewRequested=true;
   item=exec('text(await tools.exec_command('+JSON.stringify({cmd:'printf approved > approved.txt',workdir:workspace,sandbox_permissions:'require_escalated',justification:'Write an authorized synthetic approval marker in the isolated workspace.'})+'));');
  }else if(role==='worker')item=answer('worker-return-'+label);
  else if(review!==null&&!workerOpened&&user.includes('main-case-'+label)){
   const tools=[...(data.tools??[]),...(data.input??[]).filter(i=>i.type==='additional_tools').flatMap(i=>i.tools??[])].flatMap(t=>t.tools??[t]);
   assert.ok(tools.some(t=>t.type==='custom'&&t.name==='exec'&&t.format?.syntax==='lark'),'Main has Code Mode');
   workerOpened=true;
   item=exec((review?'text(await tools.mcp__homer_interactions__web_search({query:"synthetic membership lookup"})); ':'')+'text(await tools.worker_open('+JSON.stringify({message:'worker-case-'+label+' Write the approved.txt synthetic marker only when requested, then report your result.',title:'Membership acceptance',workingDirectory:workspace})+'));');
  }else item=answer('main-return-'+label);
  const response={id,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:3,output_tokens:1,total_tokens:4}};
  return [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 };
 return {reply,seen,get searches(){return searches;},recordSearch(){searches++;},};
}

test('packaged membership selects both actors, dispatches Code Mode, obtains native approval and preserves V1 threads',{
 skip:!candidate||!legacy||!siteModule,timeout:720000,
},async t=>{
 const {startHomerConfigSite}=await import(siteModule);
 const origins=manifest(candidate).account;
 for(const bundle of [candidate,legacy]){assert.equal(manifest(bundle).preparation,true);assert.deepEqual(manifest(bundle).account,origins);}
 for(const origin of Object.values(origins)){const url=new URL(origin);assert.equal(url.origin,origin);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');}
 const root=mkdtempSync(resolve('.codex/scratch/member-v2-'));
 const fresh=name=>{const p=join(root,name);mkdirSync(p,{mode:0o700});for(const name of ['host-home','tmp'])mkdirSync(join(p,name),{mode:0o700});writeFileSync(join(p,'.homer-desktop-test-profile'),'{"format":1}');return p;};
 const profile=fresh('upgrade'),loginProfile=fresh('login');let active,scenario,providerError,delayConfig=false,failAuth=false;
 const http=[];
 const full=selection=>Object.fromEntries(Object.entries(selection).map(([role,value])=>[role,{...value,fast:false,baseUrl:origins.gatewayOrigin+'/v1',context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'},capabilities:{inputModalities:['text','image'],reasoningEfforts:['medium','high'],webSearch:false,toolSearch:true}}]));
 const settings={clientConfigVersion:2,clientConfig:full(alternate)};
 const site=await startHomerConfigSite({settings,deliverToken:async subject=>{if(failAuth)throw Object.assign(Error('UNAUTHORIZED'),{error:'UNAUTHORIZED'});return {subject,modelToken:'sk-synthetic-member'};}});
 const website=createServer(async(req,res)=>{
  try{
   assert.ok(['/api/homer/v1/config','/api/homer/v1/token'].includes(req.url));
   const record={method:req.method,version:req.headers['x-homer-config-version']??'1'};http.push(record);
   if(delayConfig&&req.method==='GET')return; // Leave the GET pending so the actual client's deadline expires.
   const headers={'content-type':'application/json'};for(const key of ['x-homer-config-version','x-homer-config-features'])if(req.headers[key])headers[key]=req.headers[key];
   const upstream=await fetch(site.origin+req.url,{method:req.method,headers,...(req.method==='POST'?{body:await body(req)}:{})});
   const payload=await upstream.json(),config=req.method==='POST'?payload.config:payload;
   Object.assign(record,{status:upstream.status,shape:config===null?'null':config?.main?.baseUrl?'v1':config?.main?.model?'v2':'error'});
   res.writeHead(upstream.status,{'content-type':'application/json'}).end(JSON.stringify(payload));
  }catch(error){providerError??=error;res.writeHead(500).end();}
 });
 const gateway=createServer(async(req,res)=>{
  try{
   if(req.url==='/v1/responses'){
    assert.equal(req.headers.authorization,'Bearer sk-synthetic-member');const data=JSON.parse(await body(req));
    if(data.client_metadata?.['x-openai-subagent']==='memory_consolidation'){res.writeHead(403).end('{}');return;}
    const events=scenario.reply(data);
    res.writeHead(200,{'content-type':'text/event-stream'}).end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));return;
   }
   res.setHeader('content-type','application/json');
   if(req.url==='/v1/tools/search'){assert.equal(req.headers.authorization,'Bearer sk-synthetic-member');scenario.recordSearch();res.end('{"results":[]}');return;}
   if(req.url==='/api/status'){res.end('{"success":true,"data":{"quota_per_unit":100}}');return;}
   if(req.url==='/api/usage/token/'){res.end('{"code":true,"data":{"total_available":100,"total_used":0,"unlimited_quota":false,"expires_at":0}}');return;}
   res.writeHead(404).end('{}');
  }catch(error){providerError??=error;res.writeHead(500).end();}
 });
 async function start(bundle,p){
  if(existsSync(join(p,'codex'))&&!existsSync(join(p,'codex/config.toml')))writeFileSync(join(p,'codex/config.toml'),'openai_base_url = '+JSON.stringify(origins.gatewayOrigin+'/local-disabled')+'\nsandbox_mode = "workspace-write"\n[analytics]\nenabled=false\n[features]\nplugins=false\n[memories]\ngenerate_memories=false\nuse_memories=false\n');
  const resources=join(bundle,'Contents/Resources'),binary=join(resources,'runtime/codex/vendor',process.arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin','bin/codex');
  assert.equal(execFileSync(binary,['--version'],{env:{HOME:join(p,'host-home'),CODEX_HOME:join(p,'tmp'),PATH:'/usr/bin:/bin'},encoding:'utf8'}).trim(),'codex-cli 0.171.0-alpha.7');
  // Use the bundled executable inode directly so native process ownership survives startup and shutdown.
  for(const [name,target] of [['fixture-codex.mjs',binary],['codex-code-mode-host',join(binary,'../codex-code-mode-host')]]){
   const file=join(p,name);if(existsSync(file))unlinkSync(file);linkSync(target,file);
  }
  active=await _electron.launch({executablePath:join(bundle,'Contents/MacOS/Homer'),args:['--test-profile',p,'--deepseek-daily'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(p,'host-home'),TMPDIR:join(p,'tmp'),LANG:'zh_CN.UTF-8'},timeout:45000});
  const page=await active.firstWindow();await page.waitForURL('http://127.0.0.1:*/**',{timeout:45000});
  assert.equal(await active.evaluate(({app})=>app.getPath('userData')),join(p,'host-home/electron'));
  return page;
 }
 async function stop(){
  if(!active)return;
  const instance=active;active=undefined;
  if(!instance.windows().length)return;
  await instance.evaluate(({dialog,app})=>{dialog.showMessageBox=async()=>({response:1});app.relaunch=()=>{};});
  const closed=instance.waitForEvent('close',{timeout:25000});await instance.evaluate(({app})=>{setImmediate(()=>app.quit());});await closed;
 }
 const account=page=>page.evaluate(()=>window.homerDesktopAccount.state());
 const state=page=>page.evaluate(async()=>(await fetch('/api/history/state')).json());
 async function login(bundle,p,success){
  t.diagnostic('Starting '+(bundle===legacy?'V1':'V2')+' login');const page=await start(bundle,p);await until(async()=>(await state(page)).upgrade.code==='desktop_account_required','disconnected');
  await active.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.syntheticAuthorize=url;};});
  await page.evaluate(()=>window.homerDesktopAccount.connect());
  const authorize=await until(()=>active.evaluate(()=>globalThis.syntheticAuthorize),'browser authorization');assert.equal(new URL(authorize).origin,origins.websiteOrigin);
  const callback=await site.authorize(authorize);assert.equal(new URL(callback).hostname,'127.0.0.1');await fetch(callback);
  const status=await until(async()=>{const s=await account(page);return !s.pending&&(s.connection==='website'||s.error)&&s;},'PKCE completion');
  if(success){assert.equal(status.websiteReady,true);assert.equal(status.needsRestart,true);}else{assert.equal(status.websiteReady,false);assert.ok(status.error);assert.equal(existsSync(join(p,'runtime-config.json')),false);}
  await stop();
 }
 let thread;
 async function run(bundle,p,label,selection,review){
  t.diagnostic('Starting '+label);scenario=gatewayScenario(label,selection,review,p,bundle===candidate?join(bundle,'Contents/Resources/homer/assets/membership/models.json'):undefined);const before=http.length;
  const page=await start(bundle,p);const current=await until(async()=>{if(providerError)throw providerError;const s=await state(page);if(s.upgrade.code)throw Error(label+' desktop startup '+s.upgrade.phase+' '+s.upgrade.code);return s.upgrade.phase==='running'&&s.threadId&&s;},'ready '+label);
  const status=await account(page);assert.equal(status.websiteReady,true);assert.equal(status.active,'website');
  if(p===profile){if(thread)assert.equal(current.threadId,thread);else thread=current.threadId;}
  const sent=await page.evaluate(async label=>(await fetch('/api/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'request-'+label,text:'main-case-'+label})})).status,label);assert.ok(sent>=200&&sent<300,'submit status '+sent);
  const db=new DatabaseSync(join(p,'runtime/homer.sqlite'),{readOnly:true});
  try{
   await until(()=>{
    if(providerError)throw providerError;
    const replied=db.prepare("select 1 from conversation_messages where role='assistant' and status='completed' and text=?").get('main-return-'+label);
    const worker=review===null||db.prepare("select 1 from agent_messages a join runs r on a.senderRunId=r.id where a.kind='worker_reply' and r.status='succeeded' and json_extract(a.payloadJson,'$.text')=?").get('worker-return-'+label);
    return replied&&worker;
   },'turns '+label);
   if(review!==null)await until(()=>db.prepare("select 1 from agent_messages a join agent_receipts r on a.id=r.messageId join meta m on m.key glob 'publicMainNode:v1:*' join json_each(m.value,'$.sourceMessageIds') src on src.value=a.id where a.kind='worker_reply' and r.state in ('received','processed') and json_extract(a.payloadJson,'$.text')=? and json_extract(m.value,'$.state')='worked' and json_extract(m.value,'$.status')='completed'").get('worker-return-'+label),'Main received the Worker result');
  }finally{db.close();}
  assert.deepEqual([...scenario.seen].sort(),review===null?['main']:review?['main','review','worker']:['main','worker']);
  if(review){assert.equal(readFileSync(join(p,'workspace/approved.txt'),'utf8'),'approved');assert.equal(scenario.searches,1);}
  if(bundle===candidate)assert.equal(http.length-before,1,'one startup GET and no message refresh');assert.equal(http.at(-1).method,'GET');
  await stop();t.diagnostic(label+' passed '+[...scenario.seen].join(','));
 }
 try{
  await listen(gateway,origins.gatewayOrigin);await listen(website,origins.websiteOrigin);
  await login(legacy,profile,true);assert.deepEqual(http.at(-1),{method:'POST',version:'1',status:200,shape:'v1'});
  await run(legacy,profile,'v1-original',alternate,null);const original=read(join(profile,'runtime-config.json'));assert.ok(original.config);
  settings.clientConfig=full(defaults);await run(candidate,profile,'defaults',defaults,true);
  assert.deepEqual(read(join(profile,'runtime-config.json')),{subject:original.subject,token:original.token});
  settings.clientConfig=full(alternate);await run(candidate,profile,'alternate',alternate,false);
  settings.clientConfigVersion=1;await run(candidate,profile,'complete-v1',defaults,false);assert.equal(http.at(-1).shape,'v1');
  settings.clientConfigVersion=2;settings.clientConfig.worker.model='invalid-member';await run(candidate,profile,'invalid-worker',defaults,false);
  delayConfig=true;await run(candidate,profile,'get-timeout',defaults,false);delayConfig=false;
  settings.clientConfig=full(alternate);await run(legacy,profile,'v1-downgrade',alternate,null);
  assert.deepEqual(http.at(-1),{method:'GET',version:'1',status:200,shape:'v1'});
  assert.deepEqual(read(join(profile,'runtime-config.json')).config,original.config);
  failAuth=true;await login(candidate,loginProfile,false);assert.equal(http.at(-1).status,401);failAuth=false;
  const loginOK=fresh('valid');await login(candidate,loginOK,true);assert.deepEqual(http.at(-1),{method:'POST',version:'2',status:200,shape:'v2'});
  settings.clientConfig=undefined;await login(candidate,loginProfile,true);assert.deepEqual(http.at(-1),{method:'POST',version:'2',status:200,shape:'null'});
  await run(candidate,loginProfile,'null-selection',defaults,false);
 }finally{try{await stop();}finally{await Promise.all([close(website),close(gateway),site.close()]);rmSync(root,{recursive:true,force:true});}}
});
