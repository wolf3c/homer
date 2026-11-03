import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareDesktopSource,DESKTOP_CANDIDATE_PATHS} from '../scripts/desktop-source.mjs';
const root=resolve('.'),parent=join(root,'.codex/scratch/desktop-integration-20261023/source-tests');mkdirSync(parent,{recursive:true});
// This historical committed tree deliberately lacks desktop support.
const sourceSha='3c5461180575aa90f9430f35152f444530185913';
test('source SHA must be complete and extraction cannot overwrite an existing stage',()=>{
 const stage=join(mkdtempSync(join(parent,'invalid-')),'stage');
 assert.throws(()=>prepareDesktopSource({root,sourceSha:'main',stage}),/desktop_full_git_sha_required/);
 mkdirSync(stage);assert.throws(()=>prepareDesktopSource({root,sourceSha,stage}),/desktop_fresh_source_stage_required/);
});
test('normal input cannot silently package the uncommitted desktop integration',()=>{
 const stage=join(mkdtempSync(join(parent,'normal-')),'stage');
 assert.throws(()=>prepareDesktopSource({root,sourceSha,stage}),/desktop_build_entry_not_committed/);
});
test('explicit preparation overlays only desktop owners and retains exact committed business tree',()=>{
 const out=mkdtempSync(join(parent,'preparation-')),stage=join(out,'stage');
 const provenance=prepareDesktopSource({root,sourceSha,stage,prepareCandidate:true});
 assert.equal(provenance.gitSha,sourceSha);assert.equal(provenance.preparation,true);assert.equal(provenance.publishable,false);
 assert.deepEqual(provenance.candidateInputs.map(x=>x.path),DESKTOP_CANDIDATE_PATHS);
 for(const path of ['src/recursive-tasks.ts','src/web-history.ts','src/web-contract.ts','ui/task-status.tsx']){
  assert.deepEqual(readFileSync(join(stage,path)),execFileSync('/usr/bin/git',['show',sourceSha+':'+path]));
 }
 // Every selected source must match both the input bytes and its recorded hash.
 for(const input of provenance.candidateInputs){
  const bytes=readFileSync(join(stage,input.path));assert.deepEqual(bytes,readFileSync(join(root,input.path)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sha256);
 }
 assert.equal(existsSync(join(stage,'.codex/private')),false);
 assert.equal(JSON.parse(readFileSync(join(out,'source-provenance.json'))).publishable,false);
});
test('Electron preparation removes the retired Swift shell from the current committed tree',()=>{
 const sourceSha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const out=mkdtempSync(join(parent,'electron-')),stage=join(out,'stage');
 const provenance=prepareDesktopSource({root,sourceSha,stage,prepareCandidate:true});
 assert.equal(provenance.removedInputs.length,7);
 for(const path of provenance.removedInputs)assert.equal(existsSync(join(stage,path)),false);
 for(const path of ['src/tools.ts','ui/homer-app.tsx','packaging/macos/ImageDecoder.swift']){
  assert.deepEqual(readFileSync(join(stage,path)),execFileSync('/usr/bin/git',['show',sourceSha+':'+path]));
 }
 for(const path of ['src/service.ts','src/config.ts','src/engine.ts','src/recursive-main-inputs.ts'])assert.deepEqual(readFileSync(join(stage,path)),readFileSync(join(root,path)));
});
test('local working-tree build freezes current product inputs without private data or deleted sources',()=>{
 const sourceSha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const stage=join(mkdtempSync(join(parent,'local-')),'stage');
 const provenance=prepareDesktopSource({root,sourceSha,stage,localWorkingTree:true});
 assert.equal(provenance.localWorkingTree,true);assert.equal(provenance.preparation,true);assert.equal(provenance.publishable,false);
 for(const path of ['src/native-history-bridge.ts','src/engine.ts','ui/homer-app.tsx','packaging/electron/main.mjs'])assert.deepEqual(readFileSync(join(stage,path)),readFileSync(join(root,path)));
 for(const path of ['src/memory.ts','.codex/private','.codex/scratch','node_modules','docs','tests'])assert.equal(existsSync(join(stage,path)),false);
 for(const input of provenance.candidateInputs)assert.equal(createHash('sha256').update(readFileSync(join(stage,input.path))).digest('hex'),input.sha256);
 assert.throws(()=>prepareDesktopSource({root,sourceSha,stage:stage+'-invalid',localWorkingTree:true,prepareCandidate:true}),/desktop_source_mode_conflict/);
});
