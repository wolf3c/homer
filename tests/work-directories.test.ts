import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {listWorkDirectories} from '../src/work-directories.js';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';

async function fixture(t:any){
 const parent=resolve('.codex/scratch/work-directories');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'case-')),home=join(root,'user');await mkdir(home);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=async(path:string)=>{const p=join(home,path);await mkdir(p,{recursive:true});return p;};
 const mark=async(path:string,name='AGENTS.md')=>{const p=await dir(path);await writeFile(join(p,name),'private body never returned');return p;};
 const facts={home,folders:[join(home,'Documents'),join(home,'Desktop'),join(home,'Downloads')]};
 return {root,home,dir,mark,facts};
}

test('directory discovery finds five markers deeply and returns only first-level locations',async t=>{
 const f=await fixture(t);
 await f.mark('Projects/atlas/services/payments','AGENTS.override.md');await f.mark('Projects/studio','TEAM_GUIDE.md');
 await f.dir('Projects/with-codex/.codex');await f.dir('Projects/with-agents/.agents');await f.mark('Documents/customer/contracts');
 await f.mark('Projects/no-marker','README.md');
 const result=await listWorkDirectories(f.facts,[]);
 assert.equal(result.complete,true);
 assert.equal(result.directoryReference,`${join(f.home,'Documents')}/\n└── customer/\n\n${join(f.home,'Projects')}/\n├── atlas/\n├── studio/\n├── with-agents/\n└── with-codex/`);
 assert.doesNotMatch(JSON.stringify(result),/private body|payments|AGENTS|TEAM_GUIDE|README/);
});

test('default scan prunes app data, dependencies, hidden work and marker internals but permits an explicit excluded root',async t=>{
 const f=await fixture(t);
 for(const path of ['Library/App/work','AppData/work','.hidden/work','Projects/repo/node_modules/pkg','Projects/repo/.git/work','Projects/repo/dist/pkg','Projects/repo/.codex/scratch/work'])await f.mark(path);
 await f.mark('Projects/repo/ignored-but-useful');
 const extra=await f.mark('Library/explicit/nested');
 await symlink(join(f.home,'Library'),join(f.home,'alias'),process.platform==='win32'?'junction':'dir');
 const result=await listWorkDirectories(f.facts,[extra]);
 assert.equal(result.complete,true);assert.match(result.directoryReference,/Projects/);assert.match(result.directoryReference,/repo/);assert.match(result.directoryReference,/Library\/explicit\/nested/);
 assert.doesNotMatch(result.directoryReference.replaceAll(f.home,''),/alias|AppData|node_modules|\.hidden|scratch/);
});

test('directory names cannot forge tree lines and references have no business size cap',async t=>{
 const f=await fixture(t);await f.mark(process.platform==='win32'?'Projects/normal name':'Projects/normal\n└── forged\tname');await f.mark(process.platform==='win32'?'Projects/literal-name':'Projects/literal\\u000a');
 for(let i=0;i<80;i++)await f.mark('Projects/'+String(i).padStart(3,'0')+'-long-project-name');
 const result=await listWorkDirectories(f.facts,[]);
 assert.equal(result.complete,true);assert.ok(result.directoryReference.length>1024);
 assert.equal(result.directoryReference.split('\n').length,83);
 if(process.platform!=='win32'){
  assert.match(result.directoryReference,/normal\\u000a└── forged\\u0009name/);
  assert.ok(result.directoryReference.includes('literal\\\\u000a/'),'a literal backslash must not look like an escaped control character');
 }
});

test('complete empty search is distinct from failed or expired discovery',async t=>{
 const f=await fixture(t);await f.dir('Projects/empty');
 assert.deepEqual(await listWorkDirectories(f.facts,[]),{directoryReference:'',complete:true});
 await assert.rejects(listWorkDirectories(f.facts,[],{isCurrent:()=>false}),/work_directories_incomplete/);
 await assert.rejects(listWorkDirectories({home:join(f.root,'missing'),folders:[]},[]),/work_directories_unavailable/);
 const good=await f.mark('Projects/good');
 const partial=await listWorkDirectories(f.facts,[join(f.root,'missing')]);
 assert.equal(partial.complete,false);assert.match(partial.directoryReference,/good/);assert.ok(partial.issues?.length);
 let active=true;const stopped=listWorkDirectories(f.facts,[good],{isCurrent:()=>active});active=false;
 await assert.rejects(stopped,/work_directories_incomplete/);
 await assert.rejects(listWorkDirectories(f.facts,[],{deadline:Date.now()-1}),/work_directories_incomplete/);
});

test('a volume skipped during default traversal remains searchable as an explicit root',async t=>{
 const f=await fixture(t),volume=await f.mark('Projects/mounted');
 const original=fs.lstat;
 t.mock.method(fs,'lstat',async(path:Parameters<typeof fs.lstat>[0])=>{
  const info=await original(path);
  return path===volume?Object.assign(info,{dev:info.dev+1}):info;
 });syncBuiltinESMExports();
 try{
  const result=await listWorkDirectories(f.facts,[volume]);
  assert.equal(result.complete,true);assert.match(result.directoryReference,/mounted/);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

test('a replaced explicit directory reports an incomplete search rather than a complete empty result',async t=>{
 const f=await fixture(t),stale=join(f.root,'stale');await writeFile(stale,'no longer a directory');
 await assert.rejects(listWorkDirectories(f.facts,[stale]),/work_directories_unavailable/);
 await f.mark('Projects/good');const result=await listWorkDirectories(f.facts,[stale]);
 assert.equal(result.complete,false);assert.match(result.directoryReference,/good/);assert.ok(result.issues?.length);
});

test('a default home entry cannot redirect the search when it changes to a symbolic link',async t=>{
 const f=await fixture(t),entry=await f.dir('Projects'),outside=join(f.root,'outside');await mkdir(outside);await writeFile(join(outside,'AGENTS.md'),'not in the default scope');
 const original=fs.realpath;
 t.mock.method(fs,'realpath',async(...args:Parameters<typeof fs.realpath>)=>args[0]===entry?outside:original(...args));syncBuiltinESMExports();
 try{assert.deepEqual(await listWorkDirectories(f.facts,[]),{directoryReference:'',complete:true});}
 finally{t.mock.restoreAll();syncBuiltinESMExports();}
});
