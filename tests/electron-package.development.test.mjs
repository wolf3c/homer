import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('builder rejects a maintenance toolchain that differs from its committed lock',{
 skip:process.version!=='v22.22.0'||process.platform!=='darwin'||process.arch!=='arm64',
},()=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'toolchain-')),modules=join(root,'maintenance/node_modules/typescript');mkdirSync(modules,{recursive:true});
 writeFileSync(join(modules,'package.json'),JSON.stringify({name:'typescript',version:'0.0.0'}));
 const sha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 assert.throws(()=>execFileSync(process.execPath,['scripts/build-desktop.mjs','--source-sha',sha,'--maintenance',join(root,'maintenance'),'--scratch',join(root,'output'),'--prepare-candidate'],{stdio:'pipe'}),
  error=>error.stderr.toString().includes('desktop_toolchain_lock_mismatch:typescript'));
 assert.equal(existsSync(join(root,'output/payload')),false);
});

test('packaged UI includes the reviewed annotation runtime and full required notices',{skip:!process.env.HOMER_TEST_APP},()=>{
 const resources=join(resolve(process.env.HOMER_TEST_APP),'Contents/Resources/homer/dist');
 const runtime=readFileSync(join(resources,'preview-annotation/runtime.js'),'utf8');
 assert.ok(runtime.length>1000);
 const notices=readFileSync(join(resources,'web/assets/task-status-NOTICES.txt'),'utf8');
 assert.ok(notices.includes(readFileSync('ui/vendor/assistant-ui/LICENSE-annotorious','utf8')));
 assert.ok(notices.includes('PolyForm Shield License 1.0.0'));
 assert.ok(notices.includes('Copyright (c) 2026 Benji Taylor'));
 assert.ok(notices.includes('You may not use the Software to provide a product or service that competes'));
});
