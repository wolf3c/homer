import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import forgeConfig,* as packaging from '../packaging/electron/forge.config.mjs';
import {createHash} from 'node:crypto';
test('final resource inventory includes bytes changed by native addon signing',()=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'signed-addon-')),bundle=join(root,'Homer.app'),resources=join(bundle,'Contents/Resources');
 mkdirSync(resources,{recursive:true});mkdirSync(join(bundle,'Contents/MacOS'));
 for(const name of ['node','homer-image-decoder'])writeFileSync(join(bundle,'Contents/MacOS',name),'synthetic-helper');
 const addon=join(resources,'synthetic.node');writeFileSync(addon,'synthetic-original');
 assert.equal(typeof packaging.writeDesktopManifest,'function');
 packaging.writeDesktopManifest(bundle,{format:2});writeFileSync(addon,'synthetic-signed-bytes');
 packaging.writeDesktopManifest(bundle,{format:2});
 const manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json')));
 assert.deepEqual(manifest.files,[{path:'synthetic.node',sha256:createHash('sha256').update('synthetic-signed-bytes').digest('hex')}]);
});

test('Forge places existing helpers in the app and inventories its finalized ASAR before signing',async()=>{
 const parent=resolve('.codex/scratch/electron-package-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-')),payload=join(root,'payload'),bundle=join(root,'packager/Homer.app');
 mkdirSync(payload);mkdirSync(join(bundle,'Contents/Resources'),{recursive:true});mkdirSync(join(bundle,'Contents/MacOS'));
 for(const name of ['node','homer-image-decoder'])writeFileSync(join(payload,name),'synthetic-'+name);
 writeFileSync(join(bundle,'Contents/Resources/app.asar'),'synthetic-asar');
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
