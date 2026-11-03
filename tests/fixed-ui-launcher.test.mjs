import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fork,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
let port;
import {createHash} from 'node:crypto';
import {preparePinned} from '../scripts/pinned-build.mjs';
import {prepareFixedUi} from '../scripts/fixed-ui-launcher.mjs';
import {freezeFixedUiInputs} from '../scripts/prepare-fixed-ui-entry.mjs';
import {sourceSnapshot} from '../scripts/dev-build.mjs';
const root=resolve('.'),build=resolve(process.env.HOMER_PINNED_TEST_BUILD??'.');
const baseUi=resolve(process.env.HOMER_FIXED_TEST_BASE_UI??build),patchUi=resolve(process.env.HOMER_FIXED_TEST_PATCH_UI??build);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('fixed_test_timeout');await delay(20);}}
async function fixture(){
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const parent=resolve('.codex/scratch/native-capabilities-implementation');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'fixed-entry-test-'));
 for(const path of ['runtime','workspace/materials','workspace/outputs','home'])mkdirSync(join(dir,path),{recursive:true});
 const config=join(dir,'synthetic.config.json');writeFileSync(config,JSON.stringify({runtime:'runtime',workspace:'workspace',codexHome:join(dir,'home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100}));
 const env={PATH:process.env.PATH,HOME:join(dir,'home'),HOMER_PINNED_TEST_TARGET:build,NODE_OPTIONS:'--import='+pathToFileURL(resolve('tests/fixtures/fixed-ui-synthetic-preload.mjs')).href};
 const {loadConfig}=await import(pathToFileURL(join(build,'dist/config.js'))),{Store}=await import(pathToFileURL(join(build,'dist/store.js'))),{MAIN_TOOLS}=await import(pathToFileURL(join(build,'dist/tools.js')));
 const store=new Store(join(dir,'runtime/homer.sqlite'));store.setMeta('mainThread','synthetic-pinned-main');store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex'));store.close();
 const seed=fork(join(build,'dist/dev-host.js'),[],{env,execArgv:[],stdio:['ignore','ignore','pipe','ipc']});let ready=false,errors='';const exit=once(seed,'exit');seed.stderr.on('data',x=>errors+=x);seed.on('message',m=>{if(m.kind==='output')seed.send({kind:'written',id:m.id});if(m.kind==='ready')ready=true;});seed.send({kind:'init',config:loadConfig(config),thread:'synthetic-pinned-main'});
 try{await until(()=>ready||seed.exitCode!==null);assert.equal(ready,true,errors);}finally{if(seed.connected)seed.send({kind:'stop'});}assert.deepEqual(await exit,[0,null]);
 const pin=join(dir,'pinned.json');preparePinned({directory:build,configPath:config,snapshot:join(dir,'runtime/homer.sqlite'),thread:'synthetic-pinned-main',manifestPath:pin});
 const frozen=freezeFixedUiInputs({baseline:baseUi,patch:patchUi}),manifest=join(dir,'fixed.json');
 const {uiHash}=await import('../scripts/dev-build.mjs');
 const m=prepareFixedUi({pinnedManifest:pin,...frozen,manifestPath:manifest,expectedVersion:sourceSnapshot(build,config).hash.slice(0,12),expectedBaseUi:uiHash(sourceSnapshot(baseUi)),expectedPatchUi:uiHash(sourceSnapshot(patchUi))});
 const entry=join(frozen.entryDirectory,'fixed-ui-launcher.mjs');
 function launch(flags=[]){const p=spawn(process.execPath,[entry,'run',manifest,config,String(port),'--json',...flags],{env,stdio:['pipe','pipe','pipe']});let stderr='',stdout='';const records=[];p.stderr.on('data',x=>stderr+=x);p.stdout.on('data',x=>{stdout+=x;for(;;){const at=stdout.indexOf('\n');if(at<0)break;records.push(JSON.parse(stdout.slice(0,at)));stdout=stdout.slice(at+1);}});return {p,records,exit:once(p,'exit'),get errors(){return stderr;}};}
 return {dir,manifest,m,frozen,launch,Store};
}
async function state(){try{return await fetch('http://127.0.0.1:'+port+'/api/state').then(r=>r.ok?r.json():null);}catch{return null;}}
async function ready(p){await until(async()=>p.p.exitCode!==null||(p.records.some(x=>x.type==='progress'&&x.text.includes('已生效'))&&!!await state()));assert.equal(p.p.exitCode,null,p.errors);}
async function stop(p){if(p.p.exitCode===null)p.p.kill('SIGTERM');assert.deepEqual(await p.exit,[0,null],p.errors);}
test('fixed real host serves sealed icon UI, preserves queue/thread, stops and resumes with old UI rollback',{timeout:60000,skip:!process.env.HOMER_PINNED_TEST_BUILD||!process.env.HOMER_FIXED_TEST_BASE_UI||!process.env.HOMER_FIXED_TEST_PATCH_UI},async()=>{
 const f=await fixture();let p=f.launch();
 try{
  await ready(p);let s=await state();assert.equal(s.threadId,'synthetic-pinned-main');assert.equal(s.upgrade.uiVersion,f.m.patch.uiHash);
  const html=await fetch('http://127.0.0.1:'+port+'/').then(r=>r.text());assert.ok(html.includes('/ui/'+f.m.patch.uiHash+'/'));
  const accepted=await fetch('http://127.0.0.1:'+port+'/api/messages',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:'+port},body:JSON.stringify({requestId:'synthetic-fixed-input',text:'Synthetic held reply'})});assert.equal(accepted.status,202,await accepted.text());
  await until(async()=>!!(await state())?.activeMessageId);s=await state();
  const stopped=await fetch('http://127.0.0.1:'+port+'/api/stop',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:'+port},body:JSON.stringify({messageId:s.activeMessageId})});assert.equal(stopped.status,202,await stopped.text());
  await until(async()=>!(await state())?.isRunning);
  await stop(p);assert.equal(existsSync(join(f.dir,'runtime/cli.lock')),false);assert.equal(existsSync(join(f.dir,'runtime/gateway/cli.lock')),false);
  p=f.launch(['--baseline-ui']);await ready(p);s=await state();assert.equal(s.threadId,'synthetic-pinned-main');assert.equal(s.upgrade.uiVersion,f.m.baseline.uiHash);
  p.p.stdin.end();await delay(150);assert.equal(p.p.exitCode,null,'web survives terminal EOF');await stop(p);
  p=f.launch();await ready(p);assert.equal((await state()).upgrade.uiVersion,f.m.patch.uiHash);await stop(p);
 }finally{if(p.p.exitCode===null)await stop(p);}
});
test('fixed entry refuses source/resource/entry tampering and runtime locks before a child starts',{timeout:60000,skip:!process.env.HOMER_PINNED_TEST_BUILD||!process.env.HOMER_FIXED_TEST_BASE_UI||!process.env.HOMER_FIXED_TEST_PATCH_UI},async()=>{
 const f=await fixture();
 for(const path of [join(f.frozen.patch,'ui/homer-styles.css'),join(f.frozen.patch,'dist/web/index.html'),join(f.frozen.entryDirectory,'dev.mjs')]){
  const bytes=readFileSync(path);appendFileSync(path,'\n/* synthetic tamper */');const p=f.launch();assert.deepEqual(await p.exit,[1,null]);assert.match(p.errors,/fixed_ui_changed|fixed_entry_changed/);assert.equal(existsSync(join(f.dir,'runtime/cli.lock')),false);if(path.includes('/patch/')){const rollback=f.launch(['--baseline-ui']);await ready(rollback);assert.equal((await state()).upgrade.uiVersion,f.m.baseline.uiHash);await stop(rollback);}writeFileSync(path,bytes);
 }
 writeFileSync(join(f.dir,'runtime/cli.lock'),'synthetic');let p=f.launch();assert.deepEqual(await p.exit,[1,null]);assert.match(p.errors,/pinned_runtime_lock_present/);unlinkSync(join(f.dir,'runtime/cli.lock'));
 const occupied=createServer();await new Promise(r=>occupied.listen(port,'127.0.0.1',r));p=f.launch();assert.deepEqual(await p.exit,[1,null]);await new Promise(r=>occupied.close(r));assert.equal(existsSync(join(f.dir,'runtime/gateway/cli.lock')),false);
 writeFileSync(join(f.dir,'runtime/fail-start'),'1');p=f.launch();await until(()=>p.p.exitCode!==null);assert.equal(p.p.exitCode,1);assert.equal(existsSync(join(f.dir,'runtime/gateway/cli.lock')),false);
 unlinkSync(join(f.dir,'runtime/fail-start'));p=f.launch(['--baseline-ui']);await ready(p);await stop(p);
});
