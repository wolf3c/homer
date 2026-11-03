import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {sourceSnapshot,backendHash,supportedChange} from '../scripts/dev-build.mjs';
const base=resolve('.codex/scratch/first-launch-distribution');mkdirSync(base,{recursive:true});
test('development release snapshots carry the complete Skills and edits invalidate the backend build',()=>{
 const snapshot=sourceSnapshot(process.cwd()),names=[...snapshot.files.keys()].filter(p=>p.startsWith('.codex/skills/'));assert.equal(names.length,10);const hash=backendHash(snapshot),path='.codex/skills/homer-initialize/SKILL.md';snapshot.files.set(path,Buffer.from(String(snapshot.files.get(path))+'\nSynthetic changed instruction.'));assert.notEqual(backendHash(snapshot),hash);assert.equal(supportedChange(process.cwd(),path),true);assert.equal(supportedChange(process.cwd(),'.codex/private/unrelated'),false);
});
