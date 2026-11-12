import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildSync} from 'esbuild';

test('an isolated Electron process acquires real system/display blockers and releases them on shutdown',async t=>{
 assert.ok(['darwin','win32'].includes(process.platform),'requires an actual macOS/Windows desktop');
 const parent=resolve('.codex/scratch/power-implementation/electron');mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'case-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['profile','home','tmp'])mkdirSync(join(directory,name));
 buildSync({entryPoints:['src/desktop-power.ts'],outfile:join(directory,'power.mjs'),bundle:true,platform:'node',format:'esm',target:'es2023',logLevel:'silent'});
 const entry=join(directory,'main.mjs');
 writeFileSync(entry,`import {app,powerSaveBlocker} from 'electron';
import assert from 'node:assert/strict';
import {DesktopPowerCoordinator,POWER_DEFAULTS} from './power.mjs';
app.setPath('userData',${JSON.stringify(join(directory,'profile'))});
app.whenReady().then(async()=>{
 app.dock?.hide();
 const ids=[];
 const power=new DesktopPowerCoordinator({blocker:{start:type=>{const id=powerSaveBlocker.start(type);ids.push({id,type});return id;},stop:id=>powerSaveBlocker.stop(id)},wake:{status:async()=>({supported:false,authorization:'unavailable'}),authorize:async()=>({supported:false,authorization:'unavailable'}),list:async()=>[],schedule:async event=>event,cancel:async()=>{},close:async()=>{}},eventId:()=> 'a'.repeat(32),check:async()=>{}});
 const facts={runtimeAvailable:true,executing:true,displayRequired:false,nextScheduledAt:null,channels:[]};
 await power.updateFacts(facts);assert.equal(ids.at(-1).type,'prevent-app-suspension');assert.equal(powerSaveBlocker.isStarted(ids.at(-1).id),true);
 await power.updateFacts({...facts,displayRequired:true});assert.equal(ids.at(-1).type,'prevent-display-sleep');assert.equal(powerSaveBlocker.isStarted(ids.at(-1).id),true);assert.equal(powerSaveBlocker.isStarted(ids[0].id),false);
 await power.setPreferences({...POWER_DEFAULTS,keepAwake:true});await power.updateFacts({...facts,executing:false});assert.equal(power.state().protection,'system');assert.equal(powerSaveBlocker.isStarted(ids.at(-1).id),true);
 await power.close();assert.equal(ids.every(({id})=>!powerSaveBlocker.isStarted(id)),true);
 console.log(JSON.stringify({powerAcceptance:true,checks:7,platform:process.platform,electron:process.versions.electron}));app.quit();
}).catch(()=>{console.error('power_electron_acceptance_failed');app.exit(1);});
`);
 const executable=createRequire(import.meta.url)('electron');
 const environment={PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:join(directory,'home'),TMPDIR:join(directory,'tmp'),USERPROFILE:join(directory,'home'),TEMP:join(directory,'tmp'),TMP:join(directory,'tmp'),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,APPDATA:join(directory,'profile'),LOCALAPPDATA:join(directory,'profile')}:{})};
 const result=await promisify(execFile)(executable,[entry],{cwd:directory,env:environment,timeout:45000,maxBuffer:65536});
 const receipt=result.stdout.trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.powerAcceptance===true);
 assert.equal(receipt?.checks,7);assert.equal(receipt?.platform,process.platform);assert.ok(receipt?.electron);
});
