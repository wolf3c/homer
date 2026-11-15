// Opt-in real Main model, synthetic history/Worker callbacks. One business turn per case.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {isAbsolute,join,resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
import type {Config} from '../src/config.js';
import {assertMailboxMain,mailboxModelCase,mailboxModelProfile,mailboxExpectedStatus,mailboxModelTrace,type MailboxModelScenario} from './fixtures/mailbox-model-case.js';

if(process.env.HOMER_MAILBOX_MODEL_TEST!=='1')throw Error('mailbox_model_acceptance_requires_explicit_opt_in');
if(process.platform!=='darwin')throw Error('mailbox_model_acceptance_requires_macos');
const binary=process.env.HOMER_TEST_CODEX_BIN,model=process.env.HOMER_MAILBOX_TEST_MODEL,baseUrl=process.env.HOMER_MAILBOX_TEST_BASE_URL;
const authKind=process.env.HOMER_MAILBOX_TEST_AUTH_KIND??'api',accountId=process.env.HOMER_MAILBOX_TEST_CHATGPT_ACCOUNT_ID;
if(!['api','chatgpt-external'].includes(authKind)||!binary||!isAbsolute(binary)||!model||!process.env.HOMER_MAILBOX_TEST_TOKEN||
 (authKind==='api'?!baseUrl:!accountId||!!baseUrl))throw Error('mailbox_model_acceptance_requires_isolated_provider');
if(baseUrl){const provider=new URL(baseUrl);if(provider.protocol!=='https:'||provider.username||provider.password||provider.search||provider.hash)throw Error('mailbox_model_acceptance_provider_invalid');}
const version=spawnSync(binary,['--version'],{encoding:'utf8'});assert.equal(version.status,0,'fixed native binary unavailable');assert.equal(version.stdout.trim(),'codex-cli 0.163.0');

for(const scenario of ['approval-recovery','expired','unknown-operation'] as MailboxModelScenario[])test('real Main mailbox decision: '+scenario,{timeout:120000},async t=>{
 const repo=resolve('.');assert.equal(realpathSync(repo),repo);assert.equal(lstatSync(repo).mode&0o022,0);
 const codexDir=join(repo,'.codex'),privateDir=join(codexDir,'private'),parent=join(privateDir,'mailbox-model');
 assert.equal(spawnSync('git',['check-ignore','-q','--',privateDir]).status,0);
 for(const path of [codexDir,privateDir,parent]){
  if(!existsSync(path))mkdirSync(path,{mode:0o700});
  const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(realpathSync(path),path);assert.equal(stat.mode&(path===codexDir?0o022:0o077),0);
 }
 const root=mkdtempSync(join(parent,'case-')),workspace=join(root,'workspace'),runtime=join(root,'runtime'),codexHome=join(root,'codex');
 for(const path of [workspace,runtime,codexHome])mkdirSync(path,{mode:0o700});
 writeFileSync(join(workspace,'.mailbox-test-root'),'synthetic only\n');
 writeFileSync(join(codexHome,'config.toml'),mailboxModelProfile(workspace),{mode:0o600});
 const config:Config={workspace,runtime,codexHome,nativeCodexHome:codexHome,codexBin:binary!,model:model!,baseUrl:authKind==='api'?baseUrl:undefined,keyEnv:authKind==='api'?'HOMER_MAILBOX_TEST_TOKEN':undefined,requiresOpenaiAuth:authKind!=='api',effort:process.env.HOMER_MAILBOX_TEST_EFFORT??'low',serviceTier:null,fast:false,stopGraceMs:1000};
 const nativeForbidden:string[]=[];
 let turns=0,nativeAcceptedTurns=0,nativeIsolation=false,passed=false,status='not_started',app:Homer|undefined,fixture:ReturnType<typeof mailboxModelCase>|undefined,trace:ReturnType<typeof mailboxModelTrace>|undefined;
 let postconditions:undefined|{tasks:number;workers:number;operationUnchanged:boolean;operationState:string;upgradeSafe:boolean};
 try{
  app=new Homer(config,async()=>{},(options,handler)=>{
   assertMailboxMain(options);
   const engine=new CodexEngine(config,options,handler);
   if(authKind==='chatgpt-external'){
    const request=engine.request.bind(engine);let authenticated=false;
    engine.request=async(method,params)=>{
     if(!authenticated&&method==='config/read'){
      const login=await request('account/login/start',{type:'chatgptAuthTokens',accessToken:process.env.HOMER_MAILBOX_TEST_TOKEN,chatgptAccountId:accountId,chatgptPlanType:null});
      assert.equal(login.type,'chatgptAuthTokens');assert.equal((await request('account/read',{refreshToken:false})).account?.type,'chatgpt');authenticated=true;
     }
     return request(method,params);
    };
   }
   engine.on('nativeProcess',event=>{if(['command','fileChange'].includes(event.category))nativeForbidden.push(event.category);});
   const turn=engine.turn.bind(engine);engine.turn=async(text,options)=>{assert.equal(++turns,1,'no second model turn or retry');return turn(text,{...options,onStarted:(id,timing)=>{nativeAcceptedTurns++;options?.onStarted?.(id,timing);}});};
   return engine;
  },[],async()=>({home:workspace,folders:[]}));
  t.after(async()=>{
   const delivered=fixture?.delivered()??0;
   if(fixture)status=app!.processes.list(fixture.threadId).find(item=>item.id!=='synthetic-failed-coordination')?.status??status;
   const receiptState=fixture?.notices()[0]?.state,interactionState=fixture?.interactionId?app!.interactions.inspect(fixture.interactionId).state:undefined;
   fixture?.end();let ownersClosed=false;
   try{await app?.close({requireAllOwnersConfirmed:true});ownersClosed=true;rmSync(root,{recursive:true,force:true});}
   finally{t.diagnostic(JSON.stringify({scenario,passed,turns,nativeAcceptedTurns,...trace,forbidden:[...nativeForbidden,...(trace?.forbidden??[])],status,delivered,receiptState,interactionState,postconditions,nativeIsolation,ownersClosed}));}
  });
  await app.start();
  const effective=await app['main']!.request!('config/read',{includeLayers:true});
  assert.equal(effective.config.default_permissions,'mailbox_model');assert.equal(effective.config.permissions.mailbox_model.network.enabled,false);
  assert.equal(effective.config.permissions.mailbox_model.filesystem[':root'],'deny');assert.equal(effective.config.permissions.mailbox_model.filesystem[workspace],'read');
  const readProbe=join(workspace,'isolation.txt'),outsideProbe=join(root,'outside.txt'),writeProbe=join(workspace,'blocked-write.txt');
  writeFileSync(readProbe,'synthetic-readable');writeFileSync(outsideProbe,'synthetic-outside');
  const exec=(command:string[])=>app!['main']!.request!('command/exec',{command,cwd:workspace,timeoutMs:5000,outputBytesCap:1024});
  const read=await exec(['/bin/cat',readProbe]);assert.equal(read.exitCode,0);assert.equal(read.stdout,'synthetic-readable');
  const outside=await exec(['/bin/cat',outsideProbe]);assert.notEqual(outside.exitCode,0);assert.ok(!outside.stdout.includes('synthetic-outside'));
  assert.notEqual((await exec(['/usr/bin/touch',writeProbe])).exitCode,0);assert.equal(existsSync(writeProbe),false);nativeIsolation=true;
  fixture=mailboxModelCase(app,scenario,workspace);
  trace=mailboxModelTrace(app,fixture.task.taskId,fixture.worker.operationKey);
  // Observe the real dispatch owner; do not prune tools or replace host authorization.
  const activity=app['mainActivity'].bind(app);
  app['mainActivity']=(tool,work,args)=>trace!.observe(tool,()=>activity(tool,work,args),args);
  if(fixture.recovery)await app.message(fixture.recovery.text,fixture.recovery.requestId);
  else app['scheduleInputs']();
  await app.idle();
  const original=app.tasks.operation(fixture.worker.operationKey);
  postconditions={tasks:app.tasks.tasks().length,workers:app.tasks.runs(fixture.task.taskId).length,operationUnchanged:isDeepStrictEqual(original,fixture.originalOperation),operationState:original.state,upgradeSafe:app.upgradeStatus().safe};
  const calls=trace.tools;
  assert.equal(turns,1);assert.equal(nativeAcceptedTurns,1);assert.deepEqual(nativeForbidden,[]);trace.assertSafe();
  assert.equal(fixture.notices().length,1);assert.equal(fixture.notices()[0]!.state,'received');
  assert.equal(app.tasks.tasks().length,1);assert.equal(app.tasks.runs(fixture.task.taskId).length,1);
  const nodes=app.processes.list(fixture.threadId),node=nodes.find(item=>item.id!=='synthetic-failed-coordination')!;
  status=node?.status??'missing_process';
  assert.equal(node.state,'worked');assert.equal(node.status,mailboxExpectedStatus(scenario));
  if(scenario==='approval-recovery'){
   assert.ok(calls.includes('inspect_interaction'));assert.ok(calls.indexOf('respond_interaction')>calls.indexOf('inspect_interaction'));
   const interaction=app.interactions.inspect(fixture.interactionId!);assert.equal(interaction.state,'approved');assert.equal(fixture.delivered(),1);assert.ok(interaction.deliveredAt);
   assert.deepEqual(fixture.grant(),{scope:'turn',permissions:{fileSystem:{read:[workspace],write:null}}});
   assert.equal(node.sourceKind,'user');assert.equal(nodes.find(item=>item.id==='synthetic-failed-coordination')!.status,'failed');assert.deepEqual(fixture.notices(),fixture.originalNotices);
  }else if(scenario==='expired'){
   assert.ok(calls.includes('inspect_interaction'));assert.ok(!calls.includes('respond_interaction'));assert.equal(fixture.delivered(),0);
   assert.equal(app.interactions.inspect(fixture.interactionId!).state,'expired');
  }else{
   assert.ok(trace.originalReceiptRead,'the original operation receipt must actually be inspected');
   assert.ok(postconditions.operationUnchanged);assert.equal(postconditions.operationState,'uncertain');assert.equal(postconditions.upgradeSafe,false);
  }
  passed=true;
 }finally{if(!app)rmSync(root,{recursive:true,force:true});}
});
