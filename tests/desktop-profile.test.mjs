import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,symlinkSync,lstatSync,chmodSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import * as desktopProfile from '../scripts/desktop-profile.mjs';
import {prepareDesktopProfile,acquireDesktopOwner,assertDesktopControlPaths,readDesktopModelSource,saveDesktopModelSource} from '../scripts/desktop-profile.mjs';

const parent=resolve('.codex/scratch/macos-desktop-application/profile-unit-tests');mkdirSync(parent,{recursive:true});
const make=()=>mkdtempSync(join(parent,'synthetic-'));
const version={format:1,schema:'synthetic-schema',codex:'0.163.0'};
test('model source retains the existing profile and validates without changing credentials',()=>{
 const root=make();prepareDesktopProfile(root,version,{initialize:true});
 const marker=join(root,'desktop-profile.json'),before=JSON.parse(readFileSync(marker));
 assert.equal(readDesktopModelSource(root,'website'),'website');assert.equal(readDesktopModelSource(root,'codex'),'codex');
 const auth=join(root,'codex/auth.json');writeFileSync(auth,'synthetic-existing-auth',{mode:0o600});
 for(const source of ['codex','website']){saveDesktopModelSource(root,source);assert.equal(readDesktopModelSource(root,'website'),source);assert.deepEqual(JSON.parse(readFileSync(marker)),{...before,modelSource:source});}
 assert.equal(readFileSync(auth,'utf8'),'synthetic-existing-auth');
 assert.throws(()=>saveDesktopModelSource(root,'other'),/desktop_model_source_invalid/);
 writeFileSync(marker+'.pending','retain',{mode:0o600});assert.throws(()=>saveDesktopModelSource(root,'codex'));assert.equal(readDesktopModelSource(root,'website'),'website');assert.equal(readFileSync(marker+'.pending','utf8'),'retain');
});
test('capture shortcut is profile-local and restoring defaults removes its override',()=>{
 const root=make();prepareDesktopProfile(root,version,{initialize:true});
 const marker=join(root,'desktop-profile.json'),before=JSON.parse(readFileSync(marker));
 assert.equal(desktopProfile.readDesktopCaptureShortcut(root),undefined);
 desktopProfile.saveDesktopCaptureShortcut(root,'Control+Shift+A');
 saveDesktopModelSource(root,'codex');
 prepareDesktopProfile(root,version);
 assert.equal(desktopProfile.readDesktopCaptureShortcut(root),'Control+Shift+A');
 assert.deepEqual(JSON.parse(readFileSync(marker)),{...before,modelSource:'codex',captureShortcut:'Control+Shift+A'});
 writeFileSync(marker+'.pending','retain',{mode:0o600});
 assert.throws(()=>desktopProfile.saveDesktopCaptureShortcut(root,undefined));
 assert.equal(desktopProfile.readDesktopCaptureShortcut(root),'Control+Shift+A');
 assert.equal(readFileSync(marker+'.pending','utf8'),'retain');
 rmSync(marker+'.pending');
 desktopProfile.saveDesktopCaptureShortcut(root,undefined);
 assert.deepEqual(JSON.parse(readFileSync(marker)),{...before,modelSource:'codex'});
});
test('desktop refuses an unmarked existing directory without mutating it',()=>{
 const root=make();writeFileSync(join(root,'sentinel'),'untouched');
 assert.throws(()=>prepareDesktopProfile(root,version),/desktop_data_unrecognized/);
 assert.equal(readFileSync(join(root,'sentinel'),'utf8'),'untouched');assert.equal(existsSync(join(root,'runtime')),false);
});
test('desktop explicitly creates and reuses only its own compatible profile',()=>{
 const root=make();writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
 const first=prepareDesktopProfile(root,version);writeFileSync(join(first.runtime,'synthetic-history'),'retained');
 const marker=readFileSync(join(root,'desktop-profile.json'));
 const second=prepareDesktopProfile(root,{...version,schema:'new-source-hash'});
 assert.equal(first.runtime,second.runtime);
 assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
 assert.equal(readFileSync(join(second.runtime,'synthetic-history'),'utf8'),'retained');
});
test('codexHome ownership refuses same-home copies and never clears a stale owner',()=>{
 const root=make();const release=acquireDesktopOwner(root,()=> 'synthetic-identity',root);
 assert.throws(()=>acquireDesktopOwner(root,()=> 'another-identity',root),/desktop_owner_conflict/);release();
 writeFileSync(join(root,'desktop-owner.json'),'{"pid":99999999,"identity":"synthetic-stale"}');
 assert.throws(()=>acquireDesktopOwner(root,()=> 'new-owner',root),/desktop_owner_conflict/);assert.equal(JSON.parse(readFileSync(join(root,'desktop-owner.json'))).pid,99999999);
});
test('owner release refuses a replaced symbolic link and retains both ownership evidence and external file',()=>{
 const root=make(),external=make(),file=join(root,'desktop-owner.json'),target=join(external,'sentinel');
 const release=acquireDesktopOwner(root,()=> 'synthetic-owner',root);
 renameSync(file,join(root,'retained-owner.json'));writeFileSync(target,'unchanged',{mode:0o644});symlinkSync(target,file);
 const before=lstatSync(target).mode;
 assert.throws(release,/desktop_control_path_invalid/);
 assert.equal(readFileSync(target,'utf8'),'unchanged');assert.equal(lstatSync(target).mode,before);
 assert.equal(lstatSync(file).isSymbolicLink(),true);assert.equal(existsSync(join(root,'retained-owner.json')),true);
});
test('Electron cache cannot be redirected outside its profile through a symbolic link',()=>{
 const root=make(),external=make();writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
 const paths=prepareDesktopProfile(root,version);
 symlinkSync(external,join(root,'host-home/electron'));
 assert.throws(()=>assertDesktopControlPaths({...paths,root}),/desktop_control_path_invalid/);
 assert.equal(lstatSync(join(root,'host-home/electron')).isSymbolicLink(),true);
});

test('a different engine or mode cannot mutate a recognized profile',()=>{
 const root=make(),paths=prepareDesktopProfile(root,version,{initialize:true});
 const marker=readFileSync(join(root,'desktop-profile.json'));writeFileSync(join(paths.runtime,'history'),'keep');
 assert.throws(()=>prepareDesktopProfile(root,{...version,codex:'0.164.0'}),/desktop_schema_incompatible/);
 assert.throws(()=>prepareDesktopProfile(root,version,{test:true}),/desktop_profile_mode_mismatch/);
 assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
 assert.equal(readFileSync(join(paths.runtime,'history'),'utf8'),'keep');
});
test('first-install opt-in initializes only absent or empty paths and reuses recognized history',()=>{
 const root=join(make(),'new');
 const first=prepareDesktopProfile(root,version,{initialize:true});
 writeFileSync(join(first.runtime,'history'),'keep');
 assert.equal(prepareDesktopProfile(root,version,{initialize:true}).runtime,first.runtime);
 assert.equal(readFileSync(join(first.runtime,'history'),'utf8'),'keep');
 const unknown=make();writeFileSync(join(unknown,'sentinel'),'keep');
 assert.throws(()=>prepareDesktopProfile(unknown,version,{initialize:true}),/desktop_data_unrecognized/);
 assert.equal(existsSync(join(unknown,'desktop-profile.json')),false);
 const linked=join(make(),'linked');symlinkSync(root,linked);assert.throws(()=>prepareDesktopProfile(linked,version,{initialize:true}));
});

function crashedOwner(t){
 const root=make(),codexHome=join(root,'codex'),runtime=join(root,'old-runtime');t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const path of [codexHome,runtime,join(runtime,'gateway')])mkdirSync(path,{recursive:true,mode:0o700});
 const owner={format:1,pid:910001,identity:'old-desktop',runtime},file=join(codexHome,'desktop-owner.json'),database=join(runtime,'homer.sqlite');
 writeFileSync(file,JSON.stringify(owner),{mode:0o600});
 for(const [path,pid]of [[join(runtime,'cli.lock'),910002],[join(runtime,'gateway/cli.lock'),910003]])writeFileSync(path,JSON.stringify({pid,identity:'old-'+pid}),{mode:0o600});
 const db=new DatabaseSync(database);try{db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE retained(state TEXT); INSERT INTO retained VALUES(\'unknown\')');db.prepare('INSERT INTO meta VALUES(?,?)').run('lease:main',JSON.stringify({pid:910004,identity:'old-native'}));}finally{db.close();}chmodSync(database,0o644);
 const files=[file,join(runtime,'cli.lock'),join(runtime,'gateway/cli.lock'),database],snapshot=()=>files.map(path=>readFileSync(path));
 return {root,codexHome,runtime,owner,file,database,files,snapshot};
}
test('desktop owner records its exact runtime and refuses a second runtime sharing the home',t=>{
 const root=make();t.after(()=>rmSync(root,{recursive:true,force:true}));
 const runtime=join(root,'runtime-a'),other=join(root,'runtime-b');for(const path of [runtime,other])mkdirSync(path,{mode:0o700});
 const release=acquireDesktopOwner(root,()=> 'current-owner',runtime);
 try{assert.equal(JSON.parse(readFileSync(join(root,'desktop-owner.json'))).runtime,runtime);assert.throws(()=>acquireDesktopOwner(root,()=> 'another-owner',other),/desktop_owner_conflict/);}finally{release();}
});
test('proven dead desktop, runtime, gateway and native owners release only the original home owner',t=>{
 const f=crashedOwner(t),before=f.snapshot(),checked=[];
 desktopProfile.recoverDesktopOwner(f.codexHome,()=>undefined,pid=>{checked.push(pid);return true;});
 assert.deepEqual(checked,[910001,910002,910003,910004]);assert.equal(existsSync(f.file),false);
 for(let i=1;i<f.files.length;i++)assert.deepEqual(readFileSync(f.files[i]),before[i]);
});
for(const [name,pid,identity]of [['desktop',910001,'old-desktop'],['runtime',910002,'old-910002'],['gateway',910003,'old-910003'],['native',910004,'old-native'],['reused PID',910001,'different-process'],['unknown group',910004,undefined]])test('desktop recovery refuses '+name+' without changing evidence',t=>{
 const f=crashedOwner(t),before=f.snapshot();
 assert.throws(()=>desktopProfile.recoverDesktopOwner(f.codexHome,current=>current===pid?identity:undefined,current=>current!==pid),/desktop_owner/);
 assert.deepEqual(f.snapshot(),before);
});
for(const invalid of ['missing runtime','relative runtime','bad owner','bad runtime lock','bad lease','missing database','public owner','symlink database'])test('desktop recovery refuses '+invalid+' without clearing evidence',t=>{
 const f=crashedOwner(t);
 if(invalid==='missing runtime'){const {runtime,...old}=f.owner;writeFileSync(f.file,JSON.stringify(old));}
 if(invalid==='relative runtime')writeFileSync(f.file,JSON.stringify({...f.owner,runtime:'old-runtime'}));
 if(invalid==='bad owner')writeFileSync(f.file,'{');
 if(invalid==='bad runtime lock')writeFileSync(join(f.runtime,'cli.lock'),'{}');
 if(invalid==='bad lease'){const db=new DatabaseSync(f.database);try{db.prepare('UPDATE meta SET value=?').run('{}');}finally{db.close();}}
 if(invalid==='missing database')renameSync(f.database,f.database+'.retained');
 if(invalid==='public owner')chmodSync(f.file,0o644);
 if(invalid==='symlink database'){renameSync(f.database,f.database+'.retained');symlinkSync(f.database+'.retained',f.database);}
 const owner=readFileSync(f.file),lock=readFileSync(join(f.runtime,'cli.lock'));
 assert.throws(()=>desktopProfile.recoverDesktopOwner(f.codexHome,()=>undefined,()=>true));
 assert.deepEqual(readFileSync(f.file),owner);assert.deepEqual(readFileSync(join(f.runtime,'cli.lock')),lock);
});
test('desktop recovery refuses a replacement owner even when its bytes are identical',t=>{
 const f=crashedOwner(t),bytes=readFileSync(f.file);let replaced=false;
 assert.throws(()=>desktopProfile.recoverDesktopOwner(f.codexHome,()=>{if(!replaced){replaced=true;renameSync(f.file,f.file+'.retained');writeFileSync(f.file,bytes,{mode:0o600});}return undefined;},()=>true),/desktop_owner_recovery_unconfirmed/);
 assert.equal(replaced,true);assert.deepEqual(readFileSync(f.file),bytes);assert.deepEqual(readFileSync(f.file+'.retained'),bytes);
});
test('desktop recovery refuses changed runtime lock or lease evidence before unlink',t=>{
 for(const target of ['lock','lease']){
  const f=crashedOwner(t),owner=readFileSync(f.file);let changed=false;
  assert.throws(()=>desktopProfile.recoverDesktopOwner(f.codexHome,pid=>{
   if(pid===910004&&!changed){changed=true;if(target==='lock')writeFileSync(join(f.runtime,'cli.lock'),JSON.stringify({pid:910005,identity:'new-owner'}));
    else{const db=new DatabaseSync(f.database);try{db.prepare('INSERT INTO meta VALUES(?,?)').run('lease:new',JSON.stringify({pid:910005,identity:'new-owner'}));}finally{db.close();}}}
   return undefined;
  },()=>true),/desktop_owner_recovery_unconfirmed/);
  assert.equal(changed,true);assert.deepEqual(readFileSync(f.file),owner);
 }
});
test('a direct runtime winning wx after recovery retains its owner on a later conflict',t=>{
 const f=crashedOwner(t);desktopProfile.recoverDesktopOwner(f.codexHome,()=>undefined,()=>true);
 const release=acquireDesktopOwner(f.codexHome,()=> 'direct-runtime',f.runtime),owner=readFileSync(f.file);
 try{assert.throws(()=>acquireDesktopOwner(f.codexHome,()=> 'electron-runtime',f.root),/desktop_owner_conflict/);assert.deepEqual(readFileSync(f.file),owner);}finally{release();}
});
test('desktop recovery refuses an exited leader whose Unix process group still has a writer',{skip:process.platform==='win32',timeout:10000},async t=>{
 const {processIdentity,leaseOwnerGone}=await import('../src/processes.ts'),f=crashedOwner(t);
 const child=spawn(process.execPath,['-e',"const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000);"],{detached:true,stdio:['ignore','pipe','ignore']});
 try{
  const [bytes]=await once(child.stdout,'data'),writer=Number(String(bytes).trim()),identity=processIdentity(child.pid);assert.ok(identity);assert.ok(writer>1);
  writeFileSync(f.file,JSON.stringify({...f.owner,pid:child.pid,identity}));const before=f.snapshot();
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  process.kill(writer,0);assert.equal(leaseOwnerGone(child.pid),false);
  assert.throws(()=>desktopProfile.recoverDesktopOwner(f.codexHome,processIdentity,leaseOwnerGone),/desktop_owner_unknown/);assert.deepEqual(f.snapshot(),before);
 }finally{try{process.kill(-child.pid,'SIGKILL');}catch{}}
});

test('ChatGPT roles and source save atomically and source-only changes preserve their overrides',()=>{
 const root=make();try{
  prepareDesktopProfile(root,version,{initialize:true});
  const marker=join(root,'desktop-profile.json'),auth=join(root,'codex/auth.json');
  writeFileSync(auth,'synthetic-kept-auth',{mode:0o600});
  desktopProfile.saveDesktopCaptureShortcut(root,'Control+Shift+A');
  const roles={main:{model:'custom-main',effort:'medium',serviceTier:'ultrafast'}};
  saveDesktopModelSource(root,'codex',roles);
  assert.deepEqual(JSON.parse(readFileSync(marker)).chatgpt,roles);
  saveDesktopModelSource(root,'website');assert.deepEqual(JSON.parse(readFileSync(marker)).chatgpt,roles);
  const before=readFileSync(marker,'utf8');writeFileSync(marker+'.pending','held',{mode:0o600});
  assert.throws(()=>saveDesktopModelSource(root,'codex',{}));assert.equal(readFileSync(marker,'utf8'),before);
  rmSync(marker+'.pending');saveDesktopModelSource(root,'codex',{});
  const saved=JSON.parse(readFileSync(marker));assert.equal('chatgpt' in saved,false);assert.equal(saved.captureShortcut,'Control+Shift+A');assert.equal(saved.modelSource,'codex');
  assert.equal(readFileSync(auth,'utf8'),'synthetic-kept-auth');
 }finally{rmSync(root,{recursive:true,force:true});}
});
