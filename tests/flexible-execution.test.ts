import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chatFixture} from './task-chat-fixture.js';
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

test('task and conversation directories persist without relocating earlier executions',()=>{
 const f=chatFixture();try{
 const a=join(f.dir,'project-a'),b=join(f.dir,'project-b');mkdirSync(a);mkdirSync(b);
 const task=f.tasks.createTask(f.actor,{operationId:'cwd-a',goal:'Inspect A',workingDirectory:a,authority:f.authority});
 const worker=f.tasks.workerOpen(f.actor,{operationId:'worker-a',taskId:task.taskId,text:'Inspect files'}),run=f.start(worker.workerId);
 assert.equal(f.tasks.workingDirectory(run.id),a);
 const taskB=f.tasks.createTask(f.actor,{operationId:'cwd-b',goal:'Inspect B',workingDirectory:b,authority:f.authority});
 assert.equal(f.tasks.version(taskB.taskId,1).workingDirectory,b);assert.equal(f.tasks.workingDirectory(run.id),a);
 f.tasks.endSegment(run.id,run.epoch,{status:'completed',text:'A inspected'},true);const followup=f.tasks.workerSend(f.actor,{operationId:'again',workerId:worker.workerId,text:'Explain A'});
 assert.equal(f.tasks.workingDirectory(followup.runId!),a);assert.equal(f.tasks.run(followup.runId!).threadId,run.threadId);assert.equal(f.store.meta('recursiveSchemaVersion'),'6');
 }finally{f.close();}
});

test('native execution protects the executable bundle as read-only across project directories',()=>{
 const parent=resolve('.codex/scratch/final-adoption-review-20261019');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'executable-profile-'));
 const bundle=join(root,'installed-codex'),bin=join(bundle,'vendor/triple/bin/codex');mkdirSync(join(bundle,'vendor/triple/bin'),{recursive:true});
 writeFileSync(join(bundle,'package.json'),JSON.stringify({name:'@openai/codex-darwin-arm64'}));writeFileSync(bin,'synthetic binary');
 const config={appData:root,codexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:root,codexBin:bin} as Config;
 for(const role of ['main','worker'] as const){const profile=profileOverrides(config,{cwd:root,readRoots:[],instructions:'',tools:[],nativeTools:role});assert.equal(profile.filesystem[process.execPath],'read');assert.equal(profile.filesystem[bundle],'read');assert.equal(profile.filesystem[bin],'read');assert.equal(profile.filesystem[':root'],'write');}
});
