import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import forgeConfig from '../packaging/electron/forge.config.mjs';

test('macOS packaging embeds and inventories the two power binaries and launchd property list',async t=>{
 const scratch=resolve('.codex/scratch/power-implementation/package-tests');mkdirSync(scratch,{recursive:true});
 const root=mkdtempSync(join(scratch,'case-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const payload=join(root,'payload'),buildPath=join(root,'output'),bundle=join(buildPath,'Homer.app');
 mkdirSync(payload);mkdirSync(join(bundle,'Contents/MacOS'),{recursive:true});mkdirSync(join(bundle,'Contents/Resources'),{recursive:true});
 for(const name of ['node','homer-image-decoder','homer-window-capture','homer-power-client','homer-power-helper','app.homer.desktop.power.plist'])writeFileSync(join(payload,name),'synthetic '+name);
 const config=forgeConfig({payload,metadata:{format:2,arch:'arm64',powerWake:1}});
 await config.packagerConfig.afterCopyExtraResources[0]({buildPath});
 for(const name of ['homer-power-client','homer-power-helper'])assert.equal(readFileSync(join(bundle,'Contents/MacOS',name),'utf8'),'synthetic '+name);
 const plist='Contents/Library/LaunchDaemons/app.homer.desktop.power.plist';assert.ok(existsSync(join(bundle,plist)));
 const manifest=JSON.parse(readFileSync(join(bundle,'Contents/Resources/desktop-manifest.json'),'utf8'));
 for(const path of ['Contents/MacOS/homer-power-client','Contents/MacOS/homer-power-helper',plist])assert.ok(manifest.codeFiles.some(file=>file.path===path&&/^[a-f0-9]{64}$/.test(file.sha256)));
});
