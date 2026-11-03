import {syntheticUserFetch} from './web-user-connection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
const root=resolve('.'),build=process.env.HOMER_PINNED_TEST_BUILD??root;
const entry=join(root,'scripts/pinned-rollback.mjs'),preload=pathToFileURL(join(root,'tests/fixtures/pinned-synthetic-preload.mjs')).href;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw Error('pinned_test_timeout');await delay(10);}}
function launch(args,env){const child=spawn(process.execPath,[entry,...args],{env,stdio:['pipe','pipe','pipe']});const records=[];let partial='',errors='';child.stdout.on('data',data=>{partial+=data;const lines=partial.split('\n');partial=lines.pop();for(const line of lines)records.push(JSON.parse(line));});child.stderr.on('data',data=>errors+=data);const exit=once(child,'exit');return {child,records,exit,get errors(){return errors;}};}
async function fixture(){
 const parent=join(root,'.codex/scratch/rollback-entry-review');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'pinned-'));
 for(const name of ['runtime','workspace/materials','workspace/outputs','home'])mkdirSync(join(base,name),{recursive:true});
 const config=join(base,'synthetic.config.json');writeFileSync(config,JSON.stringify({runtime:'runtime',workspace:'workspace',codexHome:join(base,'home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100}));
 const env={PATH:process.env.PATH,HOME:join(base,'home'),HOMER_PINNED_TEST_TARGET:build,NODE_OPTIONS:'--import='+preload};
 const {loadConfig}=await import(pathToFileURL(join(build,'dist/config.js')).href),{Store}=await import(pathToFileURL(join(build,'dist/store.js')).href);
 const {MAIN_TOOLS}=await import(pathToFileURL(join(build,'dist/tools.js')).href);
 const settings=loadConfig(config);const store=new Store(join(base,'runtime/homer.sqlite'));store.setMeta('mainThread','synthetic-pinned-main');store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex'));store.close();
 // Seed only a synthetic database through the real pinned host before sealing its schema.
 const seed=fork(join(build,'dist/dev-host.js'),[],{env,execArgv:['--disable-warning=ExperimentalWarning'],stdio:['ignore','ignore','pipe','ipc']});let ready=false,seedError='';const exit=once(seed,'exit');const seedRecords=[];
 seed.on('message',m=>{seedRecords.push(m);if(m.kind==='output')seed.send({kind:'written',id:m.id});if(m.kind==='ready')ready=true;});seed.stderr.on('data',data=>seedError+=data);seed.send({kind:'init',config:settings,thread:'synthetic-pinned-main'});
 try{await until(()=>ready||seed.exitCode!==null);assert.equal(ready,true,seedError+JSON.stringify(seedRecords));}finally{if(seed.connected)seed.send({kind:'stop'});}
 assert.deepEqual(await exit,[0,null]);
 const manifest=join(base,'pinned-manifest.json');
 const prep=launch(['prepare','--build',build,'--config',config,'--snapshot',join(base,'runtime/homer.sqlite'),'--thread','synthetic-pinned-main','--manifest',manifest],env);
 assert.deepEqual(await prep.exit,[0,null],prep.errors);
 return {base,config,manifest,env,Store,run:extra=>launch(['run','--manifest',manifest,'--config',config,...(extra??[])],env)};
}
test('pinned rollback keeps actual host IPC, original thread and durable input identity across restart',{timeout:45000},async()=>{
 const f=await fixture();let p=f.run();
 try{
  await until(()=>p.records.some(x=>x.kind==='ready')||p.child.exitCode!==null);assert.equal(p.child.exitCode,null,p.errors);
  assert.equal(p.records.find(x=>x.kind==='ready').thread,'synthetic-pinned-main');
  assert.ok(existsSync(join(f.base,'runtime/cli.lock')));
  const input={requestId:'synthetic-stable-id',text:'Synthetic input'};
  p.child.stdin.write(JSON.stringify(input)+'\n');await until(()=>p.records.some(x=>x.kind==='accepted'));
  assert.equal(p.records.find(x=>x.kind==='accepted').value.fresh,true);
  p.child.stdin.write(JSON.stringify(input)+'\n');await until(()=>p.records.filter(x=>x.kind==='accepted').length===2);
  assert.equal(p.records.filter(x=>x.kind==='accepted')[1].value.fresh,false);
  p.child.stdin.write(JSON.stringify({...input,text:'Conflicting synthetic input'})+'\n');await until(()=>p.records.some(x=>x.kind==='rejected'));
  assert.equal(p.records.find(x=>x.kind==='rejected').code,'request_id_conflict');
  p.child.kill('SIGTERM');assert.deepEqual(await p.exit,[0,null]);assert.equal(existsSync(join(f.base,'runtime/cli.lock')),false);
  p=f.run();await until(()=>p.records.some(x=>x.kind==='ready')||p.child.exitCode!==null);assert.equal(p.child.exitCode,null,p.errors);
  p.child.stdin.write(JSON.stringify(input)+'\n');await until(()=>p.records.some(x=>x.kind==='accepted'));
  assert.equal(p.records.find(x=>x.kind==='accepted').value.fresh,false);
  const db=new f.Store(join(f.base,'runtime/homer.sqlite'));assert.equal(db.db.prepare('SELECT count(*) n FROM conversation_inputs').get().n,1);assert.equal(db.db.prepare('SELECT count(*) n FROM conversation_messages').get().n,2);assert.equal(db.db.prepare('SELECT count(*) n FROM requests').get().n,1);db.close();
  p.child.stdin.end();assert.deepEqual(await p.exit,[0,null]);assert.equal(existsSync(join(f.base,'runtime/cli.lock')),false);
 }finally{if(p.child.exitCode===null)p.child.kill('SIGTERM');await p.exit;}
});
test('pinned rollback rejects lock, schema, thread and configuration mismatch before child startup',{timeout:45000},async()=>{
 const f=await fixture();
 renameSync(join(f.base,'workspace/outputs'),join(f.base,'workspace/held-outputs'));
 let p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_workspace_missing');assert.equal(existsSync(join(f.base,'workspace/outputs')),false);
 renameSync(join(f.base,'workspace/held-outputs'),join(f.base,'workspace/outputs'));
 writeFileSync(join(f.base,'runtime/cli.lock'),'synthetic lock preserved');
 p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_runtime_lock_present');assert.equal(readFileSync(join(f.base,'runtime/cli.lock'),'utf8'),'synthetic lock preserved');
 const {unlinkSync}=await import('node:fs');unlinkSync(join(f.base,'runtime/cli.lock'));
 let db=new f.Store(join(f.base,'runtime/homer.sqlite'));db.setMeta('mainThread','different-synthetic-thread');db.close();
 p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_thread_mismatch');
 db=new f.Store(join(f.base,'runtime/homer.sqlite'));db.setMeta('mainThread','synthetic-pinned-main');db.db.exec('CREATE TABLE synthetic_future_schema(id TEXT)');db.close();
 p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_schema_mismatch');
 db=new f.Store(join(f.base,'runtime/homer.sqlite'));db.setMeta('memorySchemaVersion','999');db.close();
 const future=launch(['prepare','--build',build,'--config',f.config,'--snapshot',join(f.base,'runtime/homer.sqlite'),'--thread','synthetic-pinned-main','--manifest',join(f.base,'future-manifest.json')],f.env);
 assert.deepEqual(await future.exit,[1,null]);assert.equal(future.records.at(-1).code,'pinned_schema_unsupported');
 appendFileSync(f.config,' ');p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_configuration_changed');
 assert.equal(existsSync(join(f.base,'runtime/cli.lock')),false);
});
test('pinned rollback refuses changed build files and exits on real host synthetic startup failure',{timeout:45000},async()=>{
 const f=await fixture();const manifest=JSON.parse(readFileSync(f.manifest,'utf8'));manifest.files[0].sha256='0'.repeat(64);const bad=join(f.base,'bad-manifest.json');writeFileSync(bad,JSON.stringify(manifest));
 const invalid=launch(['run','--manifest',bad,'--config',f.config],f.env);assert.deepEqual(await invalid.exit,[1,null]);assert.equal(invalid.records.at(-1).code,'pinned_build_changed');
 writeFileSync(join(f.base,'runtime/fail-start'),'1');const p=f.run();
 try{assert.deepEqual(await p.exit,[1,null]);assert.ok(p.records.some(x=>x.code==='synthetic_start_failed'));assert.equal(p.records.some(x=>x.kind==='ready'),false);assert.equal(existsSync(join(f.base,'runtime/cli.lock')),false);}
 finally{if(p.child.exitCode===null)p.child.kill('SIGTERM');await p.exit;}
});
test('pinned rollback leaves unknown leases and durable gateway inputs for explicit review',{timeout:45000},async()=>{
 const f=await fixture();let db=new f.Store(join(f.base,'runtime/homer.sqlite'));db.setMeta('lease:main','synthetic-unknown-owner');db.close();
 let p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_execution_review_required');
 db=new f.Store(join(f.base,'runtime/homer.sqlite'));db.db.prepare("DELETE FROM meta WHERE key='lease:main'").run();db.close();
 mkdirSync(join(f.base,'runtime/gateway'));
 writeFileSync(join(f.base,'runtime/gateway/cli.lock'),'synthetic gateway lock');
 p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_gateway_lock_present');
 const {unlinkSync}=await import('node:fs');unlinkSync(join(f.base,'runtime/gateway/cli.lock'));
 const {DatabaseSync}=await import('node:sqlite');const transport=new DatabaseSync(join(f.base,'runtime/gateway/transport.sqlite'));
 transport.exec("CREATE TABLE transport_requests(id TEXT PRIMARY KEY,state TEXT);INSERT INTO transport_requests VALUES('synthetic-pending','pending')");transport.close();
 p=f.run();assert.deepEqual(await p.exit,[1,null]);assert.equal(p.records.at(-1).code,'pinned_gateway_pending_review');
 assert.equal(existsSync(join(f.base,'runtime/cli.lock')),false);
});
test('pinned rollback serves the pinned HTTP assets and never restarts a failed business child',{timeout:45000},async()=>{
 const f=await fixture(),reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 let p=f.run(['--port',String(port)]);
 try{
  await until(()=>p.records.some(x=>x.kind==='ready')||p.child.exitCode!==null);assert.equal(p.child.exitCode,null,p.errors);
  const url=p.records.find(x=>x.kind==='ready').url;
  const fetch=syntheticUserFetch(join(f.base,'runtime/web-connection/connect-homer.html'));
  const page=await fetch(url);assert.equal(page.status,200);const html=await page.text();assert.match(html,/homer-root/);
  const assets=[...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map(match=>match[1]);assert.ok(assets.length>=2);
  for(const asset of assets){const response=await fetch(url+asset);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(join(build,'dist/web',asset.replace(/^\//,''))));}
  const post=()=>fetch(url+'/api/messages',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'synthetic-http-id',text:'Synthetic HTTP input'})});
  let response=await post();assert.equal(response.status,202);assert.equal((await response.json()).fresh,true);
  response=await post();assert.equal(response.status,202);assert.equal((await response.json()).fresh,false);
  assert.equal((await(await fetch(url+'/api/state')).json()).threadId,'synthetic-pinned-main');
  p.child.stdin.end();await delay(40);assert.equal(p.child.exitCode,null);
  p.child.kill('SIGTERM');assert.deepEqual(await p.exit,[0,null]);
  p=f.run();await until(()=>p.records.some(x=>x.kind==='ready')||p.child.exitCode!==null);assert.equal(p.child.exitCode,null,p.errors);
  const business=p.records.find(x=>x.kind==='ready').pid;
  process.kill(business,'SIGKILL');assert.deepEqual(await p.exit,[1,null]);
  assert.equal(p.records.filter(x=>x.kind==='ready').length,1);assert.equal(p.records.at(-1).clean,false);
  assert.equal(existsSync(join(f.base,'runtime/cli.lock')),true,'unknown failure retains the old lock for review');
 }finally{if(p.child.exitCode===null)p.child.kill('SIGTERM');await p.exit;}
});
