import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,chmodSync,symlinkSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import * as profile from '../scripts/desktop-profile.mjs';
const parent=resolve('.codex/scratch/macos-desktop-application/adoption-unit-tests');mkdirSync(parent,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const version={schema:'synthetic-schema',codex:'0.163.0'};
function fixture(){
 const root=mkdtempSync(join(parent,'synthetic-')),desktop=join(root,'Application Support/Homer Desktop'),original=join(root,'Application Support/Homer'),privateRoot=join(root,'project/.codex/private');
 const paths={root:desktop,appData:original,nativeCodexHome:join(original,'codex'),codexHome:join(original,'codex'),runtime:join(privateRoot,'runtime-local-subscription'),workspace:join(privateRoot,'workspace')};
 for(const p of Object.values(paths))mkdirSync(p,{recursive:true,mode:0o700});
 const source=join(privateRoot,'local-chatgpt.config.json'),config={workspace:'workspace',runtime:'runtime-local-subscription',codexHome:paths.codexHome,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:true};
 writeFileSync(source,JSON.stringify(config),{mode:0o600});
 const descriptor=join(desktop,'desktop-adoption.json'),record={format:1,test:true,sourceConfig:source,sha256:sha(readFileSync(source))};
 writeFileSync(descriptor,JSON.stringify(record),{mode:0o600});writeFileSync(join(desktop,'.homer-desktop-test-profile'),'{"format":1}');
 return {root,desktop,paths,source,config,descriptor,record,saveConfig(){writeFileSync(source,JSON.stringify(config));record.sha256=sha(readFileSync(source));writeFileSync(descriptor,JSON.stringify(record));}};
}
test('explicit private adoption retains exact original account, runtime and workspace paths',()=>{
 const f=fixture(),before=readFileSync(f.source),p=profile.prepareDesktopProfile(f.desktop,version,{test:true});
 for(const name of ['runtime','workspace','codexHome'])assert.equal(p[name],f.paths[name]);
 assert.equal(p.adoption.sourceConfig,f.source);assert.deepEqual(readFileSync(f.source),before);
 assert.equal(existsSync(join(f.desktop,'runtime')),false);assert.equal(existsSync(join(f.desktop,'codex')),false);
});
test('adoption refuses edited source configuration before creating an owner or profile marker',()=>{
 const f=fixture();writeFileSync(f.source,JSON.stringify({...f.config,model:'changed'}));
 assert.throws(()=>profile.prepareDesktopProfile(f.desktop,version,{test:true}),/desktop_adoption_source_changed/);
 assert.equal(existsSync(join(f.desktop,'desktop-profile.json')),false);assert.equal(existsSync(join(f.paths.codexHome,'desktop-owner.json')),false);
});
test('adoption cannot substitute another account home, an arbitrary workspace or a source symlink',()=>{
 for(const field of ['codexHome','workspace']){
  const f=fixture();f.config[field]=f.root;f.saveConfig();
  assert.throws(()=>profile.prepareDesktopProfile(f.desktop,version,{test:true}),/desktop_adoption_paths_invalid/);
 }
 const f=fixture(),linked=join(f.root,'linked.config.json');symlinkSync(f.source,linked);f.record.sourceConfig=linked;writeFileSync(f.descriptor,JSON.stringify(f.record));
 assert.throws(()=>profile.prepareDesktopProfile(f.desktop,version,{test:true}),/desktop_adoption_source_invalid/);
});
test('adoption requires a private same-mode descriptor and cannot turn a test profile into production',()=>{
 const f=fixture();chmodSync(f.descriptor,0o644);
 assert.throws(()=>profile.prepareDesktopProfile(f.desktop,version,{test:true}),/desktop_adoption_private_file_required/);
 chmodSync(f.descriptor,0o600);
 assert.throws(()=>profile.prepareDesktopProfile(f.desktop,version),/desktop_profile_mode_mismatch/);
});
test('old leases go only to existing owner recovery; missing PID never confirms tool side effects',()=>{
 const leases=[{key:'lease:main',value:JSON.stringify({pid:99999999,identity:'synthetic-prior-owner'})}];
 const before=JSON.stringify(leases);
 assert.deepEqual(profile.assertDesktopAdoptionLeasesRecoverable(leases,()=>false),{count:1,recovery:'existing-homer-start',sideEffectsConfirmed:false});
 assert.throws(()=>profile.assertDesktopAdoptionLeasesRecoverable(leases,()=>true),/desktop_adoption_owner_active/);
 assert.throws(()=>profile.assertDesktopAdoptionLeasesRecoverable(leases,()=>undefined),/desktop_adoption_owner_unknown/);
 assert.throws(()=>profile.assertDesktopAdoptionLeasesRecoverable([{key:'lease:main',value:'{}'}],()=>false),/desktop_adoption_owner_unknown/);
 assert.equal(JSON.stringify(leases),before);
});

function inventory(root){
 const stat=lstatSync(root);
 return {mode:stat.mode,entries:stat.isDirectory()?readdirSync(root).sort().map(name=>[name,inventory(join(root,name))]):sha(readFileSync(root))};
}
for(const adopted of [false,true])test(`${adopted?'adopted':'dedicated'} profile rejects nested control escapes before first access`,()=>{
 const controls=[['runtime','gateway','directory'],['runtime','homer.sqlite','file'],['runtime','homer.sqlite-wal','file'],['runtime','homer.sqlite-shm','file'],['runtime','homer.sqlite-journal','file'],['runtime','cli.lock','file'],['runtime','gateway/transport.sqlite','file'],['runtime','gateway/transport.sqlite-journal','file'],['runtime','gateway/cli.lock','file'],['codexHome','desktop-owner.json','file']];
 for(const [base,name,type] of controls)for(const fault of ['symlink','dangling','wrong-type']){
  const f=fixture(),desktop=adopted?f.desktop:join(f.root,'dedicated');
  if(!adopted){mkdirSync(desktop);writeFileSync(join(desktop,'.homer-desktop-test-profile'),'{"format":1}');}
  const paths=profile.prepareDesktopProfile(desktop,version,{test:true});
  const external=join(f.root,'external');mkdirSync(external,{mode:0o755});writeFileSync(join(external,'sentinel'),'unchanged',{mode:0o644});
  const target=type==='directory'?external:join(external,'sentinel'),path=join(paths[base],name);
  mkdirSync(resolve(path,'..'),{recursive:true});
  if(fault==='wrong-type'){if(type==='file')mkdirSync(path);else writeFileSync(path,'not a directory');}
  else symlinkSync(fault==='dangling'?join(external,'missing'):target,path);
  const before=inventory(external);
  assert.throws(()=>profile.prepareDesktopProfile(desktop,version,{test:true}),/desktop_control_path_invalid/,`${base}/${name}: ${fault}`);
  assert.deepEqual(inventory(external),before,`${base}/${name} must not create, write or chmod outside data`);
 }
});
