import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chatFixture} from './task-chat-fixture.js';
import {nativeExecutableRoots} from '../src/engine.js';
import type {Config} from '../src/config.js';

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

test('host file operations identify the actual executable bundle',()=>{
 const parent=resolve('.codex/scratch/final-adoption-review-20261019');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'executable-profile-'));
 const bundle=join(root,'installed-codex'),bin=join(bundle,'vendor/triple/bin/codex');mkdirSync(join(bundle,'vendor/triple/bin'),{recursive:true});
 writeFileSync(join(bundle,'package.json'),JSON.stringify({name:'@openai/codex-darwin-arm64'}));writeFileSync(bin,'synthetic binary');
 const config={appData:root,codexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:root,codexBin:bin} as Config;
 assert.deepEqual(nativeExecutableRoots(config),[process.execPath,bin,bundle]);
});
