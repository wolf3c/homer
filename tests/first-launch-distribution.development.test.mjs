import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {sourceSnapshot,backendHash,supportedChange} from '../scripts/dev-build.mjs';
import {freezeFixedUiInputs} from '../scripts/prepare-fixed-ui-entry.mjs';
const base=resolve('.codex/scratch/first-launch-distribution');mkdirSync(base,{recursive:true});
test('package inventory carries every preinstalled Skill',()=>{
 const packageFiles=JSON.parse(readFileSync('package.json','utf8')).files;
 for(const name of ['homer-initialize','homer-tool-management','homer-feedback','homer-archive-review'])assert.ok(packageFiles.includes('.codex/skills/'+name),name);
});
test('development release snapshots carry the complete Skills and edits invalidate the backend build',()=>{
 const snapshot=sourceSnapshot(process.cwd()),names=[...snapshot.files.keys()].filter(p=>p.startsWith('.codex/skills/'));assert.equal(names.length,13);assert.ok(snapshot.files.has('.codex/skills/homer-feedback/scripts/submit-feedback.mjs'));assert.ok(snapshot.files.has('.codex/skills/homer-archive-review/SKILL.md'));const hash=backendHash(snapshot),path='.codex/skills/homer-initialize/SKILL.md';snapshot.files.set(path,Buffer.from(String(snapshot.files.get(path))+'\nSynthetic changed instruction.'));assert.notEqual(backendHash(snapshot),hash);assert.equal(supportedChange(process.cwd(),path),true);assert.equal(supportedChange(process.cwd(),'.codex/private/unrelated'),false);
});

test('fixed candidate freezing preserves the feedback Skill and script',()=>{
 const builds=resolve('.codex/scratch/dev-upgrade/builds');mkdirSync(builds,{recursive:true});
 const dir=mkdtempSync(join(builds,'ui-feedback-'));let frozen;
 try{
  cpSync('.codex/skills/homer-feedback',join(dir,'.codex/skills/homer-feedback'),{recursive:true});
  cpSync('.codex/skills/homer-archive-review',join(dir,'.codex/skills/homer-archive-review'),{recursive:true});
  symlinkSync(resolve('node_modules'),join(dir,'node_modules'),'dir');
  frozen=freezeFixedUiInputs({baseline:dir,patch:dir});
  for(const target of [frozen.baseline,frozen.patch])assert.equal(readFileSync(join(target,'.codex/skills/homer-archive-review/SKILL.md'),'utf8'),readFileSync('.codex/skills/homer-archive-review/SKILL.md','utf8'));
  for(const target of [frozen.baseline,frozen.patch])for(const file of ['SKILL.md','scripts/submit-feedback.mjs'])assert.equal(readFileSync(join(target,'.codex/skills/homer-feedback',file),'utf8'),readFileSync(join('.codex/skills/homer-feedback',file),'utf8'));
 }finally{if(frozen)rmSync(frozen.directory,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});}
});

test('Finder metadata is excluded from source identity and release snapshots without hiding Skill resources',()=>{
 const dir=mkdtempSync(join(base,'metadata-'));
 try{
  const skill=join(dir,'.codex/skills/homer-tool-management');mkdirSync(join(skill,'references'),{recursive:true});
  writeFileSync(join(skill,'SKILL.md'),'Synthetic skill');writeFileSync(join(skill,'references/guide.md'),'Synthetic reference');
  const before=sourceSnapshot(dir);mkdirSync(join(dir,'ui'),{recursive:true});
  for(const path of ['.codex/skills/homer-tool-management/.DS_Store','.codex/skills/homer-tool-management/references/.DS_Store','ui/.DS_Store']){
   writeFileSync(join(dir,path),'Synthetic Finder metadata');assert.equal(supportedChange(dir,path),false);
  }
  const after=sourceSnapshot(dir);assert.deepEqual([...after.files.keys()],[...before.files.keys()]);assert.equal(after.hash,before.hash);assert.equal(backendHash(after),backendHash(before));
  assert.equal(after.files.has('.codex/skills/homer-tool-management/references/guide.md'),true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
