import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import * as builds from '../scripts/dev-build.mjs';
import * as trusted from '../scripts/trusted-build.mjs';
test('trusted boundary follows executable ownership; prompts remain ordinary content',()=>{
 const snapshot={files:new Map([['src/service.ts',Buffer.from('a')],['ui/app.tsx',Buffer.from('a')],['prompts/main.md',Buffer.from('a')]])};
 const original=builds.trustedHash(snapshot);
 snapshot.files.set('prompts/main.md',Buffer.from('b'));assert.equal(builds.trustedHash(snapshot),original);
 for(const name of ['src/service.ts','src/ordinary-business.ts','ui/app.tsx','assets/page.svg','package.json','tsconfig.json']){const next={files:new Map(snapshot.files)};next.files.set(name,Buffer.from('b'));assert.notEqual(builds.trustedHash(next),original);}
});
test('sealed runtime copy retains bytes after staging edits and rejects private corruption',()=>{
 const parent=resolve('.codex/scratch/flexible-execution-review');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'trusted-build-'));
 const staging=join(root,'staging'),runtime=join(root,'runtime');mkdirSync(staging,{recursive:true});
 for(const name of ['dist','assets','prompts']){mkdirSync(join(staging,name));writeFileSync(join(staging,name,'fixture.txt'),'approved');}
 writeFileSync(join(staging,'package.json'),'{"type":"module"}');writeFileSync(join(staging,'package-lock.json'),'{}');
 const dependencies=join(runtime,'dependencies');mkdirSync(dependencies,{recursive:true});
 const build=trusted.sealBuild({directory:staging,config:{runtime},hash:'a'.repeat(64)},dependencies);
 writeFileSync(join(staging,'dist/fixture.txt'),'unreviewed');
 assert.equal(readFileSync(join(build.directory,'dist/fixture.txt'),'utf8'),'approved');trusted.verifyBuild(build);
 writeFileSync(join(build.directory,'dist/fixture.txt'),'corrupt');assert.throws(()=>trusted.verifyBuild(build),/dev_trusted_build_changed/);
});
test('the private toolchain is an independent copy and repeated starts reuse its frozen bytes',()=>{
 const parent=resolve('.codex/scratch/flexible-execution-review');const root=mkdtempSync(join(parent,'toolchain-fixture-'));
 mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'package-lock.json'),'{"packages":{}}');writeFileSync(join(root,'node_modules/compiler.js'),'approved');
 const runtime=join(root,'runtime'),first=trusted.freezeToolchain(root,runtime);
 writeFileSync(join(root,'node_modules/compiler.js'),'changed outside runtime');
 assert.equal(readFileSync(join(first,'node_modules/compiler.js'),'utf8'),'approved');
 assert.equal(trusted.freezeToolchain(root,runtime),first);
});
