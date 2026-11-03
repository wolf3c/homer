import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,symlinkSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {seedFirstLaunchSkills} from '../src/first-launch.ts';
const base=resolve('.codex/scratch/first-launch-distribution');mkdirSync(base,{recursive:true});
test('first-launch distribution copies all references and preserves an existing user directory',()=>{
 const dir=mkdtempSync(join(base,'complete-')),home=join(dir,'codex');try{seedFirstLaunchSkills(home);const target=join(home,'skills/homer-tool-management');assert.equal(readdirSync(join(target,'references')).length,8);for(const file of readdirSync(join(target,'references')))assert.equal(readFileSync(join(target,'references',file),'utf8'),readFileSync(join('.codex/skills/homer-tool-management/references',file),'utf8'));const entry=join(home,'skills/homer-initialize/SKILL.md');writeFileSync(entry,'User maintained method');seedFirstLaunchSkills(home);assert.equal(readFileSync(entry,'utf8'),'User maintained method');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('first-launch distribution refuses a linked destination and leaves outside content alone',()=>{
 const dir=mkdtempSync(join(base,'linked-')),home=join(dir,'codex'),outside=join(dir,'outside');try{mkdirSync(home);mkdirSync(outside);symlinkSync(outside,join(home,'skills'));assert.throws(()=>seedFirstLaunchSkills(home),/symlink/);assert.equal(existsSync(join(outside,'homer-initialize')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('distribution rejects dangling and populated linked Skill targets without replacing them',()=>{
 const dir=mkdtempSync(join(base,'target-links-'));
 try{for(const dangling of [false,true]){const home=join(dir,String(dangling),'codex'),outside=join(dir,String(dangling),'outside');mkdirSync(join(home,'skills'),{recursive:true});if(!dangling)mkdirSync(outside);const target=join(home,'skills/homer-initialize');symlinkSync(outside,target);assert.throws(()=>seedFirstLaunchSkills(home),/symlink/);assert.equal(lstatSync(target).isSymbolicLink(),true);if(!dangling)assert.deepEqual(readdirSync(outside),[]);}}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('distribution preserves an existing empty Skill directory without claiming it is ready',()=>{
 const dir=mkdtempSync(join(base,'existing-empty-')),home=join(dir,'codex'),target=join(home,'skills/homer-initialize');
 try{mkdirSync(target,{recursive:true});seedFirstLaunchSkills(home);assert.deepEqual(readdirSync(target),[]);assert.equal(existsSync(join(target,'SKILL.md')),false);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
