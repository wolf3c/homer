import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,symlinkSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
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
test('desktop refuses an unmarked existing directory without mutating it',()=>{
 const root=make();writeFileSync(join(root,'sentinel'),'untouched');
 assert.throws(()=>prepareDesktopProfile(root,version),/desktop_data_unrecognized/);
 assert.equal(readFileSync(join(root,'sentinel'),'utf8'),'untouched');assert.equal(existsSync(join(root,'runtime')),false);
});
test('desktop explicitly creates and reuses only its own compatible profile',()=>{
 const root=make();writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
 const first=prepareDesktopProfile(root,version);writeFileSync(join(first.runtime,'synthetic-history'),'retained');
 const second=prepareDesktopProfile(root,version);assert.equal(first.runtime,second.runtime);assert.equal(readFileSync(join(second.runtime,'synthetic-history'),'utf8'),'retained');
 assert.throws(()=>prepareDesktopProfile(root,{...version,schema:'future'}),/desktop_schema_incompatible/);
 assert.equal(readFileSync(join(second.runtime,'synthetic-history'),'utf8'),'retained');
});
test('codexHome ownership refuses same-home copies and never clears a stale owner',()=>{
 const root=make();const release=acquireDesktopOwner(root,()=> 'synthetic-identity');
 assert.throws(()=>acquireDesktopOwner(root,()=> 'another-identity'),/desktop_owner_conflict/);release();
 writeFileSync(join(root,'desktop-owner.json'),'{"pid":99999999,"identity":"synthetic-stale"}');
 assert.throws(()=>acquireDesktopOwner(root,()=> 'new-owner'),/desktop_owner_conflict/);assert.equal(JSON.parse(readFileSync(join(root,'desktop-owner.json'))).pid,99999999);
});
test('owner release refuses a replaced symbolic link and retains both ownership evidence and external file',()=>{
 const root=make(),external=make(),file=join(root,'desktop-owner.json'),target=join(external,'sentinel');
 const release=acquireDesktopOwner(root,()=> 'synthetic-owner');
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

const legacySchema='330bffbdd54e1e883c23c834886febe0dec84ea51f78a71de04d5821c2c91ebd',currentSchema='e416b530bdd99bc6508b60dafeb9796d29a153ca0c2e01677733047ba45053d2';
test('reviewed build109 schema admits the exact older marker without rewriting it',()=>{
 const root=make();writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
 prepareDesktopProfile(root,{...version,schema:legacySchema});const before=readFileSync(join(root,'desktop-profile.json'));
 const target={...version,schema:'a333c3408e6d0b397c3763f16605f19f9caf6baaa1968250b37c55356f64bfaa'};
 prepareDesktopProfile(root,target);assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),before);
 assert.throws(()=>prepareDesktopProfile(root,{...target,codex:'0.164.0'}),/desktop_schema_incompatible/);
});
test('reviewed build122 behavior-only schema retains the original profile and history',()=>{
 const root=make();writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');
 const paths=prepareDesktopProfile(root,{...version,schema:legacySchema});
 const marker=readFileSync(join(root,'desktop-profile.json'));
 writeFileSync(join(paths.runtime,'synthetic-history'),'retained');
 const target={...version,schema:'88cd1139adadeb8ad99cacdb40c00a28a5c245c5092bd795fbcc04c09bcc2143'};
 assert.equal(prepareDesktopProfile(root,target).runtime,paths.runtime);
 assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
 assert.equal(readFileSync(join(paths.runtime,'synthetic-history'),'utf8'),'retained');
 assert.equal(prepareDesktopProfile(root,{...version,schema:legacySchema}).runtime,paths.runtime);
 for(const rejected of [{...target,schema:'unreviewed'},{...target,codex:'0.164.0'}]){
  assert.throws(()=>prepareDesktopProfile(root,rejected),/desktop_schema_incompatible/);
 }
 assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
});
test('exact reviewed additive schema starts without rewriting its legacy profile or history',()=>{
 const root=make(),legacy={...version,schema:legacySchema},current={...version,schema:currentSchema};
 writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');const paths=prepareDesktopProfile(root,legacy);
 const marker=readFileSync(join(root,'desktop-profile.json'));writeFileSync(join(paths.runtime,'synthetic-history'),'retained');
 assert.equal(prepareDesktopProfile(root,current).runtime,paths.runtime);
 assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
 assert.equal(readFileSync(join(paths.runtime,'synthetic-history'),'utf8'),'retained');
 assert.equal(prepareDesktopProfile(root,legacy).runtime,paths.runtime,'legacy manifest still passes profile admission');
 for(const target of [{...current,schema:'unknown'},{...current,codex:'0.164.0'}])assert.throws(()=>prepareDesktopProfile(root,target),/desktop_schema_incompatible/);
 assert.throws(()=>prepareDesktopProfile(root,current,{test:true}),/desktop_profile_mode_mismatch/);
 assert.deepEqual(readFileSync(join(root,'desktop-profile.json')),marker);
});
test('reviewed compatibility is directional and does not accept an arbitrary old schema',()=>{
 for(const [from,to]of [[currentSchema,legacySchema],['unknown',currentSchema]]){
  const root=make();writeFileSync(join(root,'.homer-desktop-new'),'{"format":1}');prepareDesktopProfile(root,{...version,schema:from});
  assert.throws(()=>prepareDesktopProfile(root,{...version,schema:to}),/desktop_schema_incompatible/);
 }
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
