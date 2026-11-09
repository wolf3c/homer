import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {sourceSnapshot,backendHash,supportedChange} from '../scripts/dev-build.mjs';
const base=resolve('.codex/scratch/first-launch-distribution');mkdirSync(base,{recursive:true});
test('package inventory carries every preinstalled Skill',()=>{
 const packageFiles=JSON.parse(readFileSync('package.json','utf8')).files;
 for(const name of ['homer-tool-management','homer-feedback','homer-archive-review'])assert.ok(packageFiles.includes('.codex/skills/'+name),name);
});
test('development release snapshots carry the complete Skills and edits invalidate the backend build',()=>{
 const snapshot=sourceSnapshot(process.cwd()),names=[...snapshot.files.keys()].filter(p=>p.startsWith('.codex/skills/'));assert.equal(names.length,12);assert.ok(snapshot.files.has('.codex/skills/homer-feedback/scripts/submit-feedback.mjs'));assert.ok(snapshot.files.has('.codex/skills/homer-archive-review/SKILL.md'));const hash=backendHash(snapshot),path='.codex/skills/homer-tool-management/SKILL.md';snapshot.files.set(path,Buffer.from(String(snapshot.files.get(path))+'\nSynthetic changed instruction.'));assert.notEqual(backendHash(snapshot),hash);assert.equal(supportedChange(process.cwd(),path),true);assert.equal(supportedChange(process.cwd(),'.codex/private/unrelated'),false);
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
