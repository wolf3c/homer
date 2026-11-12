import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,copyFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

function fixture(t){
 const parent=resolve('.codex/scratch/test-suites');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-'));
 for(const name of ['scripts','tests','home','tmp','codex'])mkdirSync(join(root,name));
 copyFileSync(resolve('scripts/test.mjs'),join(root,'scripts/test.mjs'));
 mkdirSync(join(root,'tests/fixtures'));
 // The runner loads this only for core; specialist fixtures must remain untouched.
 const proxyFixture=resolve('tests/fixtures/core-system-proxy.mjs');
 copyFileSync(proxyFixture,join(root,'tests/fixtures/core-system-proxy.mjs'));
 symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(name,body)=>writeFileSync(join(root,'tests',name),body);
 put('core.test.mjs',"import {test} from 'node:test';test('core contract',()=>{});");
 put('audio.local-media.test.ts',"import {test} from 'node:test';const value:number=1;test('local audio acceptance',()=>{if(value!==1)throw Error('fixture');});");
 // A desktop fixture must never be reached through either source suite.
 put('electron-desktop.test.mjs',"throw Error('desktop_test_must_require_explicit_artifacts');");
 const run=(...args)=>spawnSync(process.execPath,['scripts/test.mjs',...args,'--test-reporter=tap'],{cwd:root,encoding:'utf8',timeout:20000,env:{PATH:process.env.PATH,HOME:join(root,'home'),TMPDIR:join(root,'tmp'),CODEX_HOME:join(root,'codex'),HOMER_TEST_APP:'/synthetic/Homer.app',HOMER_TEST_CODEX:'/synthetic/codex',HOMER_TEST_CODEX_BIN:'/synthetic/codex',HOMER_OFFLINE_CODEX_BIN:'/synthetic/codex',HOMER_TEST_CONNECTION:'/synthetic/connection.json',HOMER_TEST_SYNTHETIC_LOGIN:'/synthetic/login.json',...(process.env.NODE_OPTIONS?{NODE_OPTIONS:process.env.NODE_OPTIONS}:{})}});
 return {root,put,run};
}

test('default suite keeps core checks and explicitly reports local media as unverified',t=>{
 const f=fixture(t);
 f.put('audio.local-media.test.ts',"import {test} from 'node:test';test('local audio acceptance',()=>{throw Error('synthetic_tool_unavailable');});");
 const result=f.run();
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/core contract/);assert.doesNotMatch(result.stdout,/local audio acceptance|SKIP/);
 assert.match(result.stderr,/local.media.*not.run.*unverified/i);assert.match(result.stderr,/npm run test:local-media/);
});

test('explicit local media suite runs its real test bodies and propagates failures without skips',t=>{
 const f=fixture(t),passed=f.run('--local-media');
 assert.equal(passed.status,0,passed.stdout+passed.stderr);
 assert.match(passed.stdout,/local audio acceptance/);assert.doesNotMatch(passed.stdout,/core contract|SKIP/);
 f.put('audio.local-media.test.ts',"import {test} from 'node:test';test('local audio acceptance',()=>{throw Error('synthetic_tool_unavailable');});");
 const failed=f.run('--local-media');
 assert.equal(failed.status,1,failed.stdout+failed.stderr);assert.match(failed.stdout,/synthetic_tool_unavailable/);
 assert.doesNotMatch(failed.stdout,/SKIP/);assert.match(failed.stderr,/unverified/i);
});

test('empty optional suite fails explicitly and desktop acceptance still requires supplied artifacts',t=>{
 const f=fixture(t);rmSync(join(f.root,'tests/audio.local-media.test.ts'));
 const empty=f.run('--local-media');assert.notEqual(empty.status,0);assert.match(empty.stderr,/test_suite_empty/);
 const desktop=f.run('--desktop');assert.notEqual(desktop.status,0);assert.match(desktop.stderr,/desktop_acceptance_requires_explicit_file_url/);
});

// Audited ownership: optional environment settings must never activate these through npm test.
const explicitSuites={
 "desktop-codesign": ["desktop-update-codesign.test.mjs"],
 "engine": [
  "channel-native.engine.test.ts",
  "deepseek-continuation.test.ts",
  "deepseek-pinned.test.ts",
  "desktop-source-resume.test.mjs",
  "homer-account-native.test.mjs",
  "native-memory-defaults-offline.test.mjs"
 ],
 "account": [
  "homer-account-gateway.test.mjs",
  "homer-account-integration.test.mjs"
 ],
 "rtc": [
  "mobile-webrtc-runtime.test.mjs"
 ],
 "development": [
  "desktop-gateway-access.test.mjs",
  "desktop-icon.test.mjs",
  "desktop-source.test.mjs",
  "dev-gateway.test.mjs",
  "pinned-rollback.test.mjs",
  "reception-gateway.test.mjs",
  "reception-ipc.test.ts",
  "release-css-snapshot.test.mjs",
  "web-dev-host.test.mjs",
  "mobile-runtime-packaging.test.mjs",
  "mobile-ui-build.test.mjs",
  "mobile-download-focus.development.test.mjs",
  "deepseek-isolated.test.mjs",
  "dev-fixture-wait.test.mjs",
  "dev-upgrade.development.test.mjs",
  "web-feedback-host.development.test.ts",
  "electron-package.development.test.mjs",
  "first-launch-distribution.development.test.mjs",
  "prompts.development.test.ts"
 ],
 "vendor": [
  "agentation-preview-patch.test.mjs",
  "approval-card-upstream.test.mjs",
  "official-canvas-upstream.test.mjs",
  "official-sources-upstream.test.mjs",
  "official-tool-fallback-upstream.test.mjs",
  "question-flow-upstream.test.mjs",
  "run-activity-upstream.test.mjs",
  "task-status-css.vendor.test.mjs"
 ]
};

test('default core excludes every audited specialist even when connection environment is present',t=>{
 const f=fixture(t);
 for(const name of Object.values(explicitSuites).flat())f.put(name,"throw Error('specialist_must_be_explicit');");
 const result=f.run();assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/core contract/);assert.doesNotMatch(result.stdout,/specialist_must_be_explicit|SKIP/);
 for(const suite of Object.keys(explicitSuites))assert.ok(result.stderr.includes('node scripts/test.mjs --'+suite)||result.stderr.includes('test:'+suite));
});

for(const [suite,names] of Object.entries(explicitSuites))test('explicit '+suite+' selects only its audited files and forwards Node options',t=>{
 const f=fixture(t);
 f.put('core.test.mjs',"throw Error('core_must_not_run_in_specialist');");
 for(const name of Object.values(explicitSuites).flat())f.put(name,"throw Error('other_specialist_must_not_run');");
 for(const name of names)f.put(name,"import {test} from 'node:test';test('selected specialist',()=>{});test('filtered out',()=>{throw Error('filter_not_forwarded');});");
 const result=f.run('--'+suite,'--test-name-pattern=selected specialist');
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/# pass /);
 assert.doesNotMatch(result.stdout,/core_must_not_run|other_specialist_must_not_run|filter_not_forwarded/);
 assert.match(result.stderr,/skipped.*unverified/i);
 f.put(names[0],"import {test} from 'node:test';test('selected specialist',()=>{throw Error('specialist_failure');});");
 const failed=f.run('--'+suite);assert.equal(failed.status,1);assert.match(failed.stdout,/specialist_failure/);assert.match(failed.stderr,/unverified/i);
});

test('skipped prerequisite checks never get an acceptance-passed claim',t=>{
 const f=fixture(t);f.put('homer-account-native.test.mjs',"import {test} from 'node:test';test('unavailable engine',{skip:'synthetic missing prerequisite'},()=>{});");
 const result=f.run('--engine');assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/# skipped 1/);assert.match(result.stderr,/skipped.*unverified/i);
 assert.doesNotMatch(result.stderr,/acceptance passed/i);
});

test('core substitutes only system proxy discovery; explicit suites retain their environment',t=>{
 const f=fixture(t);
 const sentinel=join(f.root,'proxy-sentinel.mjs');
 writeFileSync(sentinel,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 const original=cp.execFileSync;cp.execFileSync=function(file,args,options){
  if(file==='/usr/sbin/scutil')return options?.encoding?'HOST_PROBE':Buffer.from('HOST_PROBE');
  return original.apply(this,arguments);
 };syncBuiltinESMExports();`);
 const body=expected=>`import {test} from 'node:test';import assert from 'node:assert/strict';
 import cp,{execFileSync} from 'node:child_process';
 test('proxy boundary',()=>{
  assert.equal(execFileSync('/usr/sbin/scutil',['--proxy'],{encoding:'utf8'}),${JSON.stringify(expected)});
  const bytes=cp.execFileSync('/usr/sbin/scutil',['--proxy']);assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.toString(),${JSON.stringify(expected)});
  assert.equal(execFileSync('/usr/sbin/scutil',['--dns'],{encoding:'utf8'}),'HOST_PROBE');
  assert.equal(execFileSync(process.execPath,['-e','process.stdout.write("child-ok")'],{encoding:'utf8'}),'child-ok');
 });`;
 f.put('core.test.mjs',body('<dictionary> {\n}\n'));
 f.put('homer-account-native.test.mjs',body('HOST_PROBE'));
 for(const args of [[],['--engine']]){
  const result=spawnSync(process.execPath,['--import',sentinel,'scripts/test.mjs',...args],{
   cwd:f.root,encoding:'utf8',timeout:20000,env:{PATH:process.env.PATH,NODE_OPTIONS:'--import='+sentinel},
  });
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.doesNotMatch(result.stdout,/# skipped [1-9]/);
 }
});

for(const mode of ['core','development','direct'])test('source overrides stay explicit: '+mode,t=>{
 const f=fixture(t),source=join(f.root,'preview');mkdirSync(source);
 mkdirSync(join(source,'src'));
 for(const name of ['engine','service','src/service'])writeFileSync(join(source,name+'.mjs'),`export const source=${JSON.stringify(name)};`);
 const overrides={HOMER_MCP_ENGINE_MODULE:join(source,'engine.mjs'),HOMER_MCP_SERVICE_MODULE:join(source,'service.mjs'),HOMER_RECEPTION_SOURCE:source};
 const body=`import {test} from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {join} from 'node:path';
 const loaded=[];
 for(const [key,suffix] of [['HOMER_MCP_ENGINE_MODULE',''],['HOMER_MCP_SERVICE_MODULE',''],['HOMER_RECEPTION_SOURCE','src/service.mjs']]){
  if(process.env[key])loaded.push((await import(pathToFileURL(join(process.env[key],suffix)).href)).source);
 }
 test('selected source',()=>{
  assert.deepEqual(loaded,${JSON.stringify(mode==='core'?[]:['engine','service','src/service'])});
  assert.deepEqual(Object.fromEntries(${JSON.stringify(Object.keys(overrides))}.filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])),${JSON.stringify(mode==='core'?{}:overrides)});
  assert.equal(process.env.HOMER_SYNTHETIC_UNRELATED,'preserved');
 });`;
 f.put('core.test.mjs',body);f.put('dev-fixture-wait.test.mjs',body);
 const args=mode==='direct'?['--test','tests/core.test.mjs']:['scripts/test.mjs',...(mode==='development'?['--development']:[])];
 const result=spawnSync(process.execPath,args,{cwd:f.root,encoding:'utf8',timeout:20000,
  env:{PATH:process.env.PATH,HOME:join(f.root,'home'),TMPDIR:join(f.root,'tmp'),CODEX_HOME:join(f.root,'codex'),...overrides,HOMER_SYNTHETIC_UNRELATED:'preserved'}});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/selected source/);assert.doesNotMatch(result.stdout,/# skipped [1-9]/);
});


test('browser regressions are opt-in and require explicit synthetic paths',t=>{
 const f=fixture(t);f.put('artifact-file-list.browser.mjs',"throw Error('browser_must_not_run_in_core');");
 const core=f.run();assert.equal(core.status,0,core.stdout+core.stderr);assert.doesNotMatch(core.stdout,/browser_must_not_run_in_core/);
 const browser=f.run('--browser');assert.notEqual(browser.status,0);assert.match(browser.stderr,/browser_acceptance_requires_explicit_path: HISTORY_FOLLOWUP_BUILD/);
});


test('fixed native protocol acceptance is explicit and absent from core',t=>{
 const f=fixture(t);f.put('native-protocol.engine.test.mjs',"console.log('fixed-native-selected');");
 const core=f.run();assert.equal(core.status,0,core.stdout+core.stderr);assert.doesNotMatch(core.stdout,/fixed-native-selected/);
 const engine=f.run('--engine');assert.equal(engine.status,0,engine.stdout+engine.stderr);assert.match(engine.stdout,/fixed-native-selected/);
});
