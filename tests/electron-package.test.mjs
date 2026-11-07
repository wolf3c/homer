import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import forgeConfig,* as packaging from '../packaging/electron/forge.config.mjs';
import {DESKTOP_CANDIDATE_PATHS} from '../scripts/desktop-source.mjs';
import {createHash} from 'node:crypto';
test('final resource inventory includes bytes changed by native addon signing',t=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'signed-addon-')),bundle=join(root,'Homer.app'),resources=join(bundle,'Contents/Resources');t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(resources,{recursive:true});mkdirSync(join(bundle,'Contents/MacOS'));
 for(const name of ['node','homer-image-decoder'])writeFileSync(join(bundle,'Contents/MacOS',name),'synthetic-helper');
 const addon=join(resources,'synthetic.node');writeFileSync(addon,'synthetic-original');
 assert.equal(typeof packaging.writeDesktopManifest,'function');
 packaging.writeDesktopManifest(bundle,{format:2});writeFileSync(addon,'synthetic-signed-bytes');
 packaging.writeDesktopManifest(bundle,{format:2});
 const manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json')));
 assert.deepEqual(manifest.files,[{path:'synthetic.node',sha256:createHash('sha256').update('synthetic-signed-bytes').digest('hex')}]);
});

test('Forge places existing helpers in the app and inventories its finalized ASAR before signing',async(t)=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-')),payload=join(root,'payload'),bundle=join(root,'packager/Homer.app');t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(payload);mkdirSync(join(bundle,'Contents/Resources'),{recursive:true});mkdirSync(join(bundle,'Contents/MacOS'));
 for(const name of ['node','homer-image-decoder'])writeFileSync(join(payload,name),'synthetic-'+name);
 writeFileSync(join(bundle,'Contents/Resources/app.asar'),'synthetic-asar');
 writeFileSync(join(bundle,'Contents/MacOS/Homer'),Buffer.from('cffaedfe07000001030000000200000000000000000000000000000000000000','hex'));
 const config=forgeConfig({payload,metadata:{format:2,preparation:true,publishable:false,electron:'45.0.0'},icon:''});
 await config.packagerConfig.afterCopyExtraResources[0]({buildPath:join(root,'packager')});
 for(const name of ['node','homer-image-decoder'])assert.equal(readFileSync(join(bundle,'Contents/MacOS',name),'utf8'),'synthetic-'+name);
 const manifest=JSON.parse(readFileSync(join(bundle,'Contents/Resources/desktop-manifest.json')));
 assert.equal(manifest.files[0].path,'app.asar');assert.equal(manifest.codeFiles.length,2);assert.equal(manifest.publishable,false);
 assert.equal(existsSync(join(root,'packager/Contents')),false);
 assert.equal(config.packagerConfig.osxSign.continueOnError,false);
 assert.equal(config.packagerConfig.osxSign.ignore(join(bundle,'Contents/MacOS/node')),true);
 assert.equal(config.packagerConfig.osxSign.ignore(join(bundle,'Contents/MacOS/Homer')),false);
});

for(const arch of ['arm64','x64'])test('formal '+arch+' configuration uses an immutable tag and finalizes native Forge JSON only',async(t)=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'update-'+arch+'-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const metadata={version:'0.2.0',build:200,appId:'app.homer.desktop',releaseChannel:'stable',publishable:true,preparation:false,arch,minimumMacOS:'14.0'};
 const distribution={identity:'a'.repeat(40),keychainProfile:'synthetic',releaseTag:'v0.2.0'};
 const config=forgeConfig({payload:root,metadata,icon:'',distribution});
 assert.equal(config.packagerConfig.appBundleId,'app.homer.desktop');assert.equal(config.packagerConfig.extendInfo.LSMinimumSystemVersion,'14.0');
 const maker=config.makers[0].config;
 assert.equal(maker.macUpdateManifestBaseUrl,'https://github.com/wolf3c/homer/releases/download/v0.2.0');
 const zip=join(root,`Homer-darwin-${arch}-0.2.0.zip`),feed=join(root,'RELEASES.json');writeFileSync(zip,'synthetic-zip');
 writeFileSync(feed,JSON.stringify({currentRelease:'0.2.0',releases:[{version:'0.1.0',updateTo:{version:'0.1.0',url:'https://old.invalid'}},{version:'0.2.0',updateTo:{version:'0.2.0',name:'Homer v0.2.0',notes:'ignored',pub_date:'2026-11-04T00:00:00.000Z',url:'https://wrong.invalid'}}]}));
 const results=[{platform:'darwin',arch,artifacts:[zip,feed]}];assert.equal(await config.hooks.postMake({},results),results);
 const parsed=JSON.parse(readFileSync(feed));assert.equal(parsed.currentRelease,'0.2.0');assert.equal(parsed.releases.length,1);
 assert.deepEqual(parsed.releases[0].updateTo,{version:'0.2.0',name:'0.2.0',pub_date:'2026-11-04T00:00:00.000Z',url:`https://github.com/wolf3c/homer/releases/download/v0.2.0/Homer-darwin-${arch}-0.2.0.zip`});
 await assert.rejects(()=>config.hooks.postMake({},[{platform:'darwin',arch:'unknown',artifacts:[zip,feed]}]),/desktop_update_artifacts_invalid/);
});
test('candidate config never generates a stable feed; formal config requires frozen identity, tag and architecture',()=>{
 const candidate=forgeConfig({payload:'/fixture',metadata:{preparation:true,publishable:false},icon:''});assert.equal(candidate.makers[0].config.macUpdateManifestBaseUrl,undefined);assert.equal(candidate.packagerConfig.appBundleId,'app.homer.desktop.candidate');
 const metadata={version:'0.2.0',build:200,appId:'app.homer.desktop',releaseChannel:'stable',publishable:true,preparation:false,arch:'arm64',minimumMacOS:'27.0'},distribution={identity:'a'.repeat(40),keychainProfile:'synthetic',releaseTag:'v0.2.0'};
 for(const extra of [{appId:'wrong'},{arch:'ia32'},{releaseChannel:'qa'},{version:'0.2.0-beta'}])assert.throws(()=>forgeConfig({payload:'/fixture',metadata:{...metadata,...extra},distribution}),/desktop_distribution_inputs_required/);
 for(const releaseTag of [undefined,'latest','a/b',''])assert.throws(()=>forgeConfig({payload:'/fixture',metadata,distribution:{...distribution,releaseTag}}),/desktop_distribution_inputs_required/);
 assert.throws(()=>forgeConfig({payload:'/fixture',metadata}),/desktop_distribution_inputs_required/);
});

test('root-executed dependency preparation and pins participate in the existing source freeze guard',()=>{
 for(const path of ['scripts/prepare-desktop-dependencies.mjs','packaging/macos/dependencies-lock.json'])assert.ok(DESKTOP_CANDIDATE_PATHS.includes(path),path);
});

test('Windows config seals per-user NSIS payload without elevation helper',()=>{
 const metadata={platform:'win32',arch:'x64',version:'0.2.0',build:200,preparation:true,publishable:false};
 const config=forgeConfig({payload:'/fixture',metadata,icon:''});assert.equal(config.packagerConfig.osxSign,undefined);assert.equal(config.packagerConfig.executableName,'Homer');assert.equal(config.makers.length,0);
 const nsis=packaging.windowsInstallerConfig({metadata});assert.deepEqual(nsis.nsis,{oneClick:true,perMachine:false,packElevateHelper:false,deleteAppDataOnUninstall:false,differentialPackage:false});assert.equal(nsis.win.requestedExecutionLevel,'asInvoker');
});
test('explicit unsigned Windows release does not configure signing or automatic updates',()=>{
 const metadata={platform:'win32',arch:'x64',version:'0.2.0',build:269,preparation:false,publishable:true,appId:'app.homer.desktop',releaseChannel:'stable'};
 const distribution={unsignedWindows:true,releaseTag:'v0.2.0'};
 const forge=forgeConfig({payload:'/fixture',metadata,distribution});
 assert.equal(forge.packagerConfig.windowsSign,undefined);
 assert.ok(!forge.packagerConfig.extraResource.some(p=>p.endsWith('app-update.yml')));
 const nsis=packaging.windowsInstallerConfig({metadata,distribution});
 assert.equal(nsis.forceCodeSigning,undefined);assert.equal(nsis.win.signtoolOptions,undefined);
 assert.equal(nsis.win.verifyUpdateCodeSignature,true);
 assert.throws(()=>packaging.windowsInstallerConfig({metadata,distribution:{releaseTag:'v0.2.0'}}),/desktop_distribution_inputs_required/);
});
test('Windows resource seal refuses elevate helper and records finalized native helpers',t=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'windows-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'resources'));for(const name of ['node.exe','homer-image-decoder.mjs'])writeFileSync(join(root,'resources',name),'signed-synthetic');writeFileSync(join(root,'Homer.exe'),'signed-shell');
 packaging.writeDesktopManifest(root,{platform:'win32',format:2});const sealed=readFileSync(join(root,'resources/desktop-manifest.json'),'utf8');assert.ok(JSON.parse(sealed).files.some(f=>f.path==='node.exe'));
 writeFileSync(join(root,'resources/elevate.exe'),'injected');assert.throws(()=>packaging.writeDesktopManifest(root,{platform:'win32',format:2}),/desktop_elevation_helper_denied/);assert.equal(readFileSync(join(root,'resources/desktop-manifest.json'),'utf8'),sealed);
});

test('Windows native manifest keeps hashes and moves every installer URL to the same immutable asset',t=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'latest-')),installer=join(root,'Homer-win32-x64-0.2.0.exe');t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(installer,'signed-synthetic-installer');
 const sha512=createHash('sha512').update(readFileSync(installer)).digest('base64');const native={version:'0.2.0',files:[{url:'Homer-win32-x64-0.2.0.exe',sha512,size:readFileSync(installer).length}],path:'Homer-win32-x64-0.2.0.exe',sha512,releaseNotes:'discarded'};
 const final=packaging.windowsRelease(native,installer,{version:'0.2.0'},'v0.2.0');assert.equal(final.files[0].url,'https://github.com/wolf3c/homer/releases/download/v0.2.0/Homer-win32-x64-0.2.0.exe');assert.equal(final.path,final.files[0].url);assert.equal(final.sha512,sha512);assert.equal(final.releaseNotes,undefined);
 for(const bad of [{...final,version:'0.1.0'},{...final,sha512:'wrong'},{...final,files:[{...final.files[0],size:0}]},{...final,files:[{...final.files[0],isAdminRightsRequired:true}]}])assert.throws(()=>packaging.windowsRelease(bad,installer,{version:'0.2.0'},'v0.2.0'),/desktop_update_artifacts_invalid/);
});
test('NSIS cannot mutate an already sealed Windows payload',t=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'sealed-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'resources'));writeFileSync(join(root,'Homer.exe'),'signed-shell');writeFileSync(join(root,'resources/node.exe'),'signed-node');packaging.writeDesktopManifest(root,{format:2,platform:'win32'});packaging.assertWindowsPayload(root);
 writeFileSync(join(root,'resources/node.exe'),'mutated');assert.throws(()=>packaging.assertWindowsPayload(root),/desktop_resource_changed/);
});
