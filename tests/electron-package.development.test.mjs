import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('builder refuses missing website origins before preparing any source or payload',{
 skip:process.version!=='v22.22.0'||process.platform!=='darwin'||process.arch!=='arm64',
},()=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'account-'));
 for(const args of [[],['--website-origin','https://super-tree.com'],['--gateway-origin','https://models.super-tree.com']]){
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-desktop.mjs','--scratch',join(root,'output'),...args],{stdio:'pipe'}),
   error=>error.stderr.toString().includes('desktop_account_origins_required'));
  assert.equal(existsSync(join(root,'output')),false);
 }
});
test('builder rejects a maintenance toolchain that differs from its committed lock',{
 skip:process.version!=='v22.22.0'||process.platform!=='darwin'||process.arch!=='arm64',
},()=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'toolchain-')),modules=join(root,'maintenance/node_modules/typescript');mkdirSync(modules,{recursive:true});
 writeFileSync(join(modules,'package.json'),JSON.stringify({name:'typescript',version:'0.0.0'}));
 const sha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 assert.throws(()=>execFileSync(process.execPath,['scripts/build-desktop.mjs','--source-sha',sha,'--maintenance',join(root,'maintenance'),'--scratch',join(root,'output'),'--prepare-candidate','--website-origin','https://super-tree.com','--gateway-origin','https://models.super-tree.com'],{stdio:'pipe'}),
  error=>error.stderr.toString().includes('desktop_toolchain_lock_mismatch:typescript'));
 assert.equal(existsSync(join(root,'output/payload')),false);
});

test('packaged App contains both website connection origins',{skip:!process.env.HOMER_TEST_APP},()=>{
 const {account,preparation}=JSON.parse(readFileSync(join(resolve(process.env.HOMER_TEST_APP),'Contents/Resources/desktop-manifest.json'),'utf8'));
 assert.ok(account,'packaged website connection origins are required');
 assert.deepEqual(Object.keys(account).sort(),['gatewayOrigin','websiteOrigin']);
 for(const origin of Object.values(account)){
  const url=new URL(origin);assert.equal(url.origin,origin);assert.ok(url.protocol==='https:'||preparation&&url.protocol==='http:'&&url.hostname==='127.0.0.1');assert.equal(url.username,'');assert.equal(url.password,'');
 }
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

 test('formal packaging requires a signed committed candidate and keeps the local mode',async()=>{
 const {default:forgeConfig}=await import('../packaging/electron/forge.config.mjs');
 const base={payload:'/synthetic/payload',metadata:{version:'0.1.1',build:1,publishable:true},icon:'/synthetic/icon'};
 const local=forgeConfig(base);assert.equal(local.packagerConfig.osxSign.identity,'-');
 for(const distribution of [{},{identity:'-',keychainProfile:'fixture'},{identity:'A'.repeat(40)}])assert.throws(()=>forgeConfig({...base,distribution}),/desktop_distribution/);
 const distribution={identity:'A'.repeat(40),keychainProfile:'fixture',releaseTag:'v0.1.1'};
 const metadata={...base.metadata,arch:'arm64',minimumMacOS:'27.0',appId:'app.homer.desktop',releaseChannel:'stable'};
 assert.throws(()=>forgeConfig({...base,metadata:{...metadata,preparation:true},distribution}),/desktop_distribution/);
 const formal=forgeConfig({...base,metadata,distribution});assert.equal(formal.packagerConfig.osxSign.identity,distribution.identity);
 assert.equal(formal.packagerConfig.osxSign.optionsForFile('/synthetic').hardenedRuntime,true);
 assert.equal(formal.packagerConfig.osxSign.ignore('/app/Contents/Resources/runtime/codex'),true);
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'signing-'));
 const font=join(dir,'font.ttf');writeFileSync(font,Buffer.from([0,1,0,0]));assert.equal(formal.packagerConfig.osxSign.ignore(font),true);
 assert.equal(formal.packagerConfig.osxSign.ignore(process.execPath),false);
 });
