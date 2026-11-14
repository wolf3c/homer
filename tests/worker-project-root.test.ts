import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,symlink,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {prepareWorkerProjectRoot} from '../src/worker-project-root.js';

async function fixture(t:any){
 const parent=resolve('.codex/scratch/worker-project-root');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(join(parent,'case-')),home=join(root,'user'),cwd=join(home,'customer/contracts/current');await mkdir(cwd,{recursive:true});
 t.after(()=>rm(root,{recursive:true,force:true}));return {root,home,cwd,marker:join(home,'.homer-project-root')};
}
test('no-Git work prepares a home fallback and preserves configured markers plus Git',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await prepareWorkerProjectRoot(f.cwd,f.home,['.custom']),['.custom','.git','.homer-project-root']);
 assert.equal(await readFile(f.marker,'utf8'),'');
 await writeFile(f.marker,'existing user contents');await prepareWorkerProjectRoot(f.cwd,f.home,null);
 assert.equal(await readFile(f.marker,'utf8'),'existing user contents');
});
test('nearer Git or configured roots need no home write even with a conflicting fallback',async t=>{
 for(const marker of ['.git','.custom']){
  const f=await fixture(t);await mkdir(f.marker);await writeFile(join(f.home,'customer',marker),'root');
  assert.deepEqual(await prepareWorkerProjectRoot(f.cwd,f.home,['.custom']),['.custom','.git','.homer-project-root']);
  assert.equal((await lstat(f.marker)).isDirectory(),true);
 }
});
test('fallback rejects symlink and directory conflicts without altering their targets',async t=>{
 for(const kind of ['symlink','directory']){
  const f=await fixture(t),target=join(f.root,'sentinel'),link=join(f.root,'link-target');await writeFile(target,'untouched');await mkdir(link);
  if(kind==='symlink')await symlink(process.platform==='win32'?link:target,f.marker,process.platform==='win32'?'junction':'file');else await mkdir(f.marker);
  await assert.rejects(prepareWorkerProjectRoot(f.cwd,f.home,undefined),/worker_project_root_unavailable/);
  assert.equal(await readFile(target,'utf8'),'untouched');
 }
});
test('outside-home work and invalid configuration do not create a fallback',async t=>{
 const f=await fixture(t);await prepareWorkerProjectRoot(f.root,f.home,undefined);
 await assert.rejects(lstat(f.marker),{code:'ENOENT'});
 await assert.rejects(prepareWorkerProjectRoot(f.cwd,f.home,'invalid'),/worker_project_root_config_invalid/);
 await assert.rejects(lstat(f.marker),{code:'ENOENT'});
});

test('a marker beneath a regular file is absent and does not block a valid Git root',async t=>{
 const f=await fixture(t);await mkdir(f.marker);await writeFile(join(f.cwd,'.custom'),'not a directory');await writeFile(join(f.cwd,'.git'),'root');
 assert.deepEqual(await prepareWorkerProjectRoot(f.cwd,f.home,['.custom/nested']),['.custom/nested','.git','.homer-project-root']);
 assert.equal((await lstat(f.marker)).isDirectory(),true);
});
