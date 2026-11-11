import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,copyFileSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareDesktopSource,DESKTOP_CANDIDATE_PATHS} from '../scripts/desktop-source.mjs';
const root=resolve('.'),parent=join(root,'.codex/scratch/desktop-integration-20261023/source-tests');mkdirSync(parent,{recursive:true});
// Construct the old tree locally so the test does not depend on private Git history.
const fixtureRoot=mkdtempSync(join(parent,'source-repo-'));
const businessPaths=['src/recursive-tasks.ts','src/web-history.ts','src/web-contract.ts','ui/task-status.tsx'];
const cuaWorker='src/desktop-cua-driver.ts';
for(const path of new Set([...DESKTOP_CANDIDATE_PATHS,...businessPaths,cuaWorker])){
 const target=join(fixtureRoot,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,path),target);
}
const git=(...args)=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Homer test','-c','user.email=homer-test@example.invalid',...args],{cwd:fixtureRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','-q');
// The committed tree predates this desktop entry; the working copy has it.
rmSync(join(fixtureRoot,'packaging/electron/main.mjs'));
rmSync(join(fixtureRoot,cuaWorker));
git('add','-f','--all');git('commit','-qm','Synthetic source before desktop integration');
const sourceSha=git('rev-parse','HEAD');
copyFileSync(join(root,'packaging/electron/main.mjs'),join(fixtureRoot,'packaging/electron/main.mjs'));
copyFileSync(join(root,cuaWorker),join(fixtureRoot,cuaWorker));
const fixtureParent=join(fixtureRoot,'.codex/scratch/source-tests');mkdirSync(fixtureParent,{recursive:true});
after(()=>rmSync(fixtureRoot,{recursive:true,force:true}));
test('source SHA must be complete and extraction cannot overwrite an existing stage',()=>{
 const stage=join(mkdtempSync(join(fixtureParent,'invalid-')),'stage');
 assert.throws(()=>prepareDesktopSource({root:fixtureRoot,sourceSha:'main',stage}),/desktop_full_git_sha_required/);
 mkdirSync(stage);assert.throws(()=>prepareDesktopSource({root:fixtureRoot,sourceSha,stage}),/desktop_fresh_source_stage_required/);
});
test('normal input cannot silently package the uncommitted desktop integration',()=>{
 const stage=join(mkdtempSync(join(fixtureParent,'normal-')),'stage');
 assert.throws(()=>prepareDesktopSource({root:fixtureRoot,sourceSha,stage}),/desktop_build_entry_not_committed/);
});
test('explicit preparation overlays only desktop owners and retains exact committed business tree',()=>{
 const out=mkdtempSync(join(fixtureParent,'preparation-')),stage=join(out,'stage');
 const provenance=prepareDesktopSource({root:fixtureRoot,sourceSha,stage,prepareCandidate:true});
 assert.equal(provenance.gitSha,sourceSha);assert.equal(provenance.preparation,true);assert.equal(provenance.publishable,false);
 assert.deepEqual(provenance.candidateInputs.map(x=>x.path),DESKTOP_CANDIDATE_PATHS);
 assert.deepEqual(readFileSync(join(stage,cuaWorker)),readFileSync(join(fixtureRoot,cuaWorker)));
 for(const path of ['src/recursive-tasks.ts','src/web-history.ts','src/web-contract.ts','ui/task-status.tsx']){
  assert.deepEqual(readFileSync(join(stage,path)),execFileSync('/usr/bin/git',['show',sourceSha+':'+path],{cwd:fixtureRoot}));
 }
 // Every selected source must match both the input bytes and its recorded hash.
 for(const input of provenance.candidateInputs){
  const bytes=readFileSync(join(stage,input.path));assert.deepEqual(bytes,readFileSync(join(fixtureRoot,input.path)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sha256);
 }
 assert.equal(existsSync(join(stage,'.codex/private')),false);
 assert.equal(JSON.parse(readFileSync(join(out,'source-provenance.json'))).publishable,false);
});
test('Electron preparation removes retired shells and manual Token entries from the committed tree',t=>{
 const sourceSha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const out=mkdtempSync(join(parent,'electron-')),stage=join(out,'stage');let completed=false;t.after(()=>{if(completed)rmSync(out,{recursive:true,force:true});});
 const provenance=prepareDesktopSource({root,sourceSha,stage,prepareCandidate:true});
 assert.equal(provenance.removedInputs.length,10);
 for(const path of ['scripts/desktop-deepseek.mjs','scripts/deepseek-desktop.mjs','tests/desktop-deepseek.test.mjs'])assert.ok(provenance.removedInputs.includes(path));
 for(const path of provenance.removedInputs)assert.equal(existsSync(join(stage,path)),false);
 for(const path of ['src/tools.ts','ui/homer-app.tsx','packaging/macos/ImageDecoder.swift']){
  assert.deepEqual(readFileSync(join(stage,path)),execFileSync('/usr/bin/git',['show',sourceSha+':'+path]));
 }
 for(const path of ['src/service.ts','src/config.ts','src/engine.ts','src/recursive-main-inputs.ts'])assert.deepEqual(readFileSync(join(stage,path)),readFileSync(join(root,path)));
 completed=true;
});
test('local working-tree build freezes current product inputs without private data or deleted sources',t=>{
 const sourceSha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const out=mkdtempSync(join(parent,'local-')),stage=join(out,'stage');let completed=false;t.after(()=>{if(completed)rmSync(out,{recursive:true,force:true});});
 const provenance=prepareDesktopSource({root,sourceSha,stage,localWorkingTree:true});
 assert.equal(provenance.localWorkingTree,true);assert.equal(provenance.preparation,true);assert.equal(provenance.publishable,false);
 for(const path of ['src/native-history-bridge.ts','src/engine.ts','ui/homer-app.tsx','packaging/electron/main.mjs'])assert.deepEqual(readFileSync(join(stage,path)),readFileSync(join(root,path)));
 for(const path of ['src/memory.ts','.codex/private','.codex/scratch','node_modules','docs','tests'])assert.equal(existsSync(join(stage,path)),false);
 for(const input of provenance.candidateInputs)assert.equal(createHash('sha256').update(readFileSync(join(stage,input.path))).digest('hex'),input.sha256);
 assert.throws(()=>prepareDesktopSource({root,sourceSha,stage:stage+'-invalid',localWorkingTree:true,prepareCandidate:true}),/desktop_source_mode_conflict/);
 completed=true;
});
