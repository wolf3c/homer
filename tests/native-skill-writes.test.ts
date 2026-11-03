import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {profileOverrides} from '../src/engine.js';
import {MainNativeApprovals} from '../src/main-native-approvals.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {ConversationHistory} from '../src/web-history.js';
import type {Config} from '../src/config.js';
import type {NativeRequest} from '../src/worker-native-requests.js';
const scratch=resolve('.codex/scratch/native-system-skills-implementation');

test('only native-capable main and worker open user skills; system, plugins and remaining HOME stay protected',()=>{
 mkdirSync(scratch,{recursive:true});const root=mkdtempSync(join(scratch,'skill-profile-'));
 try{
  const config={codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),runtime:join(root,'runtime'),codexBin:'/usr/bin/false'} as Config;
  for(const nativeTools of ['main','worker'] as const)for(const nativeCapabilities of [true,false]){
   const p=profileOverrides(config,{cwd:join(root,'project'),readRoots:[],instructions:'',tools:[],nativeTools,nativeCapabilities});
   assert.equal(p.filesystem[config.codexHome],'deny');
   assert.equal(p.filesystem[config.runtime],'deny');
   assert.equal(p.filesystem[join(config.codexHome,'plugins')],'read');
   assert.equal(p.filesystem[join(config.codexHome,'skills')],nativeCapabilities?'write':'read');
   if(nativeCapabilities)assert.equal(p.filesystem[join(config.codexHome,'skills/.system')],'read');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('complete skill paths require a real user card; protected, symlink and ancestor requests stay denied for main and worker',async()=>{
 mkdirSync(scratch,{recursive:true});const root=mkdtempSync(join(scratch,'skill-approval-')),home=join(root,'codex'),skills=join(home,'skills'),system=join(skills,'.system'),runtime=join(root,'runtime');
 for(const dir of [system,runtime,join(root,'outside')])mkdirSync(dir,{recursive:true});
 symlinkSync(join(root,'outside'),join(skills,'escape'));
 symlinkSync(join(home,'auth.json'),join(skills,'dangling'));
 symlinkSync(system,join(skills,'system-alias'));
 symlinkSync(skills,join(root,'skill-alias'));
 const db=new DatabaseSync(':memory:'),interactions=new WorkerInteractions(db),history=new ConversationHistory(db),approvals=new MainNativeApprovals(interactions,history);
 let n=0;
 try{
  for(const role of ['main','worker']){
   const scope={threadId:role,turnId:'turn',generationId:role,sourceRequestId:'source',userText:'Synthetic full skill request',isCurrent:()=>true,protectedRoots:[home,system,runtime,join(home,'plugins')],skillWriteRoot:skills,historyThreadId:'main'};
   const request=(details:Record<string,unknown>,method='item/fileChange/requestApproval'):NativeRequest=>({method,threadId:role,turnId:'turn',requestId:++n,itemId:'synthetic-file-'+n,kind:'authorization',details});
   for(const file of ['SKILL.md','scripts/run.py','references/guide.md','assets/template.txt','agents/openai.yaml']){
    const opened=approvals.open(request({operation:{changes:[{path:join(skills,'synthetic-package',file),kind:{type:'add'},diff:'+synthetic'}]}}),scope);
    assert.throws(()=>interactions.respond(opened.id,{action:'approve',reason:'forged model'},{userMessageId:'forged'}),/main_native_user_decision_required/);
    approvals.respond(opened.id,{requestId:'user-'+n,text:'允许本次操作'});
    assert.equal((await opened.response).status,'approved');
   }
   const grant=approvals.open(request({permissions:{fileSystem:{write:[join(skills,'synthetic-package')]}}},'item/permissions/requestApproval'),scope);
   approvals.respond(grant.id,{requestId:'user-'+n,text:'允许本次操作'});assert.equal((await grant.response).status,'approved');
   const rejected=[skills,home,root,system,join(system,'new/SKILL.md'),join(home,'auth.json'),join(home,'config.toml'),join(home,'plugins/new'),runtime,join(skills,'../auth.json'),join(skills,'escape/file'),join(skills,'dangling'),join(skills,'system-alias/file'),join(root,'skill-alias/new/SKILL.md')];
   if(existsSync(join(skills,'.SYSTEM')))rejected.push(join(skills,'.SYSTEM/new/SKILL.md'));
   if(existsSync(join(root,'CODEX')))rejected.push(join(root,'CODEX/config.toml'));
   for(const path of rejected){
    const opened=approvals.open(request({permissions:{fileSystem:{write:[path]}}},'item/permissions/requestApproval'),scope);
    assert.throws(()=>approvals.respond(opened.id,{requestId:'user-'+n,text:'允许本次操作'}),/interaction_capability_denied/,'deny '+path);
    assert.equal(interactions.inspect(opened.id).state,'pending_user');
    approvals.respond(opened.id,{requestId:'deny-'+n,text:'拒绝本次操作'});assert.equal((await opened.response).status,'denied');
   }
   const move=approvals.open(request({operation:{changes:[{path:join(skills,'synthetic-package/SKILL.md'),kind:{type:'move',move_path:join(home,'config.toml')}}]}}),scope);
   assert.throws(()=>approvals.respond(move.id,{requestId:'move-'+n,text:'允许本次操作'}),/interaction_capability_denied/);
   approvals.respond(move.id,{requestId:'deny-move-'+n,text:'拒绝本次操作'});await move.response;
   const deny=approvals.open(request({operation:{changes:[{path:join(skills,'synthetic-package/SKILL.md'),kind:{type:'update'}}]}}),scope);
   approvals.respond(deny.id,{requestId:'explicit-deny-'+n,text:'拒绝本次操作'});assert.equal((await deny.response).status,'denied');
  }
  assert.ok(history.list('main').some(m=>m.role==='user'));assert.equal(history.list('worker').length,0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('opening user skills never overrides protected ancestors or linked native layout',()=>{
 mkdirSync(scratch,{recursive:true});const root=mkdtempSync(join(scratch,'skill-overlap-'));
 try{
  const home=join(root,'codex'),runtime=join(root,'runtime'),bundle=join(root,'engine'),bin=join(bundle,'bin/codex');
  mkdirSync(join(bundle,'bin'),{recursive:true});
  writeFileSync(join(bundle,'package.json'),JSON.stringify({name:'@openai/codex'}));writeFileSync(bin,'synthetic executable');
  const base={codexHome:home,nativeCodexHome:home,runtime,codexBin:'/usr/bin/false'} as Config;
  const options={cwd:scratch,readRoots:[],instructions:'',tools:[],nativeCapabilities:true,nativeTools:'main' as const};
  for(const config of [{...base,runtime:root},{...base,codexHome:join(bundle,'codex'),nativeCodexHome:join(bundle,'codex'),codexBin:bin},{...base,controlBrowserData:[root]}]){
   assert.throws(()=>profileOverrides(config,options),/engine_native_skills_path_protected/);
  }
  mkdirSync(home);mkdirSync(runtime);symlinkSync(runtime,join(home,'skills'));
  assert.throws(()=>profileOverrides(base,options),/engine_native_skills_path_protected/);
  rmSync(join(home,'skills'));mkdirSync(join(home,'skills'));symlinkSync(runtime,join(home,'skills/.system'));
  assert.throws(()=>profileOverrides(base,options),/engine_native_skills_path_protected/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
