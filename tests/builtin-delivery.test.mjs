import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { seedBuiltinSkills, builtinEnvironment } from '../scripts/builtin-bootstrap.mjs';
import { inventory, verifyBuiltinResources, buildBuiltinResources } from '../scripts/builtin-build.mjs';

const base=resolve('.codex/scratch/builtin-capabilities-implementation/lifecycle');
mkdirSync(base,{recursive:true});
function fixture(){const root=mkdtempSync(join(base,'case-')),resources=join(root,'release'),home=join(root,'Homer/codex');mkdirSync(join(resources,'skills/homer-example'),{recursive:true});writeFileSync(join(resources,'skills/homer-example/SKILL.md'),'---\nname: homer-example\ndescription: Synthetic lifecycle fixture\n---\nOriginal');return {root,resources,home};}
test('cold seed, repeat, user modification, upgrade, and removal preserve user content',()=>{
 const {root,resources,home}=fixture();
 assert.equal(seedBuiltinSkills(resources,home).created.length,1);
 assert.equal(seedBuiltinSkills(resources,home).created.length,0);
 const file=join(home,'skills/homer-example/SKILL.md');writeFileSync(file,'User edit');
 writeFileSync(join(resources,'skills/homer-example/SKILL.md'),'Updated bundled method');
 assert.equal(seedBuiltinSkills(resources,home).alreadySeeded,true);
 assert.equal(readFileSync(file,'utf8'),'User edit');
 rmSync(join(home,'skills/homer-example'),{recursive:true});
 assert.equal(seedBuiltinSkills(resources,home).alreadySeeded,true);
 assert.equal(existsSync(file),false,'native removal must not silently reinstall');
 assert.equal(existsSync(join(root,'Homer/workspace')),false);
});
test('reject linked destination and source without following outside data',()=>{
 const {root,resources,home}=fixture();mkdirSync(home,{recursive:true});mkdirSync(join(root,'outside'));symlinkSync(join(root,'outside'),join(home,'skills'));
 assert.throws(()=>seedBuiltinSkills(resources,home),/symlink/);
 assert.equal(existsSync(join(root,'outside/homer-example')),false);
});
test('runtime environment uses release dependencies and only Homer-owned cache paths',()=>{
 const {resources,home}=fixture();const env=builtinEnvironment(resources,home);
 assert.equal(env.HOMER_BUILTIN_ROOT,resources);
 assert.equal(env.PYTHONNOUSERSITE,'1');assert.equal(env.PYTHONDONTWRITEBYTECODE,'1');
 assert.equal(env.PLAYWRIGHT_BROWSERS_PATH,join(resources,'browsers'));
 assert.equal(env.HOME,join(home,'host-home'));
 assert.ok(!('OPENAI_API_KEY' in env));
});
test('corruption and failed replacement leave old resources and user work intact',async()=>{
 const {root,resources,home}=fixture();
 const manifest={schema:1,platform:`${process.platform}-${process.arch}`,bytes:0,files:inventory(resources)};
 writeFileSync(join(resources,'resource-manifest.json'),JSON.stringify(manifest));
 verifyBuiltinResources(resources);
 seedBuiltinSkills(resources,home);
 const userFile=join(root,'Homer/result.txt');writeFileSync(userFile,'User result');
 const cache=join(root,'empty-download-cache');mkdirSync(cache);
 await assert.rejects(buildBuiltinResources(cache,join(root,'replacement')));
 verifyBuiltinResources(resources);assert.equal(readFileSync(userFile,'utf8'),'User result');
 writeFileSync(join(resources,'skills/homer-example/SKILL.md'),'Corrupted release');
 assert.throws(()=>verifyBuiltinResources(resources),/integrity_mismatch/);
 rmSync(resources,{recursive:true});
 assert.equal(readFileSync(userFile,'utf8'),'User result');
 assert.equal(existsSync(join(home,'skills/homer-example/SKILL.md')),true);
});
