import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fixture,main,contract} from './recursive-fixture.js';
import {profileOverrides,type EngineOptions} from '../src/engine.js';
import type {Config} from '../src/config.js';

test('ordinary native execution opens project and network while protecting precise runtime paths',()=>{
 const root=resolve('.codex/scratch/flexible-execution-review/profile');mkdirSync(root,{recursive:true});
 const config={appData:root,codexHome:join(root,'codex'),runtime:join(root,'.codex/private/runtime'),workspace:root,codexBin:'/usr/bin/false'} as Config;
 const options:EngineOptions={cwd:root,readRoots:[root],instructions:'',tools:[],nativeTools:'worker'};
 const p=profileOverrides(config,options);
 assert.equal(p.filesystem[':root'],'write');assert.equal(p.network.enabled,true);
 assert.equal(p.filesystem[config.runtime],'deny');assert.equal(p.filesystem[config.codexHome],'deny');
 assert.notEqual(p.filesystem[root],'deny');
});

test('task directories persist per contract and delegation inherits without relocating earlier runs',()=>{
 const f=fixture();try{
 const a=join(f.dir,'project-a'),b=join(f.dir,'project-b');mkdirSync(a);mkdirSync(b);
 const root=f.tasks.createRoot(main,{operationId:'cwd-root',title:'A',contract:{...contract('aggregate'),workingDirectory:a},authority:f.tasks.authority(f.root.taskId,1)});
 const child=f.tasks.delegate(main,{operationId:'cwd-child',taskId:root.taskId,version:1,expectedTaskRevision:f.tasks.task(root.taskId).revision,contract:contract(),dependencies:[]});
 assert.equal(f.tasks.contract(child.taskId,1).workingDirectory,a);
 const rootB=f.tasks.createRoot(main,{operationId:'cwd-root-b',title:'B',contract:{...contract('aggregate'),workingDirectory:b},authority:f.tasks.authority(f.root.taskId,1)});
 assert.equal(f.tasks.contract(rootB.taskId,1).workingDirectory,b);
 assert.equal(f.tasks.contract(child.taskId,f.tasks.run(child.runId!).contractVersion).workingDirectory,a);
 assert.equal(f.store.meta('recursiveSchemaVersion'),'4');
 }finally{f.close();}
});

test('native execution protects the executable bundle as read-only across project directories',()=>{
 const parent=resolve('.codex/scratch/final-adoption-review-20261019');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'executable-profile-'));
 const bundle=join(root,'installed-codex'),bin=join(bundle,'vendor/triple/bin/codex');mkdirSync(join(bundle,'vendor/triple/bin'),{recursive:true});
 writeFileSync(join(bundle,'package.json'),JSON.stringify({name:'@openai/codex-darwin-arm64'}));writeFileSync(bin,'synthetic binary');
 const config={appData:root,codexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:root,codexBin:bin} as Config;
 for(const role of ['main','worker'] as const){const profile=profileOverrides(config,{cwd:root,readRoots:[],instructions:'',tools:[],nativeTools:role});assert.equal(profile.filesystem[process.execPath],'read');assert.equal(profile.filesystem[bundle],'read');assert.equal(profile.filesystem[bin],'read');assert.equal(profile.filesystem[':root'],'write');}
});
