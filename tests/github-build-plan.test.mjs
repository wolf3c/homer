import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planBuild} from '../scripts/github-build-plan.mjs';

const version={expectedSha:'a'.repeat(40),actualSha:'a'.repeat(40)};

test('a single requested source platform schedules only that platform',()=>{
 for(const target of ['macos-arm64','macos-x64','windows-x64','linux-x64']){
  const {include}=planBuild({...version,kind:'source',target});
  assert.deepEqual(include.map(row=>row.target),[target]);
 }
});

test('all source platforms are scheduled only when explicitly requested',()=>{
 const {include}=planBuild({...version,kind:'source',target:'all'});
 assert.deepEqual(include.map(row=>row.target),['macos-arm64','macos-x64','windows-x64','linux-x64']);
 assert.equal(new Set(include.map(row=>row.target)).size,include.length);
});

test('desktop packaging schedules the existing Mac ARM toolchain',()=>{
 const {include}=planBuild({...version,kind:'desktop',target:'macos-arm64'});
 assert.equal(include.length,1);
 assert.equal(include[0].target,'macos-arm64');
 assert.equal(include[0].platform,'darwin');
 assert.equal(include[0].arch,'arm64');
 assert.notEqual(include[0].runner,'macos-26');
});

test('desktop three schedules both Macs and Windows on native runners',()=>{
 const {include}=planBuild({...version,kind:'desktop',target:'desktop-three'});
 assert.deepEqual(include.map(x=>x.target),['macos-arm64','macos-x64','windows-x64']);
 assert.deepEqual(include.map(x=>x.runner),['xcode-27','macos-26-intel','windows-2022']);
 assert.throws(()=>planBuild({...version,kind:'source',target:'desktop-three'}),/github_build_target_invalid/);
});

test('unsupported desktop targets fail rather than run or fall back to source compilation',()=>{
 for(const target of ['linux-x64','all']){
  assert.throws(()=>planBuild({...version,kind:'desktop',target}),/github_desktop_target_not_ready/);
 }
});

test('the scheduled source must match the reviewed full commit',()=>{
 for(const expectedSha of ['', 'main','a'.repeat(7),'a'.repeat(39),'g'.repeat(40),'a'.repeat(40)+'\n']){
  assert.throws(()=>planBuild({...version,expectedSha,kind:'source',target:'windows-x64'}),/github_build_full_sha_required/);
 }
 assert.throws(()=>planBuild({...version,actualSha:'b'.repeat(40),kind:'source',target:'windows-x64'}),/github_build_source_changed/);
});

test('missing or unknown inputs cannot silently schedule a default build',()=>{
 for(const kind of [undefined,'','release','SOURCE'])assert.throws(()=>planBuild({...version,kind,target:'all'}),/github_build_kind_invalid/);
 for(const target of [undefined,'','windows','ALL','windows-x64,linux-x64'])assert.throws(()=>planBuild({...version,kind:'source',target}),/github_build_target_invalid/);
});

test('workflow entry emits one matrix for the requested source target',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/github-build-plan.mjs',import.meta.url))],{
  encoding:'utf8',env:{HOMER_BUILD_KIND:'source',HOMER_BUILD_TARGET:'windows-x64',HOMER_EXPECTED_SHA:version.expectedSha,GITHUB_SHA:version.actualSha},
 });
 assert.equal(result.status,0,result.stderr);
 assert.equal(result.stderr,'');
 assert.ok(result.stdout.startsWith('matrix='));
 assert.deepEqual(JSON.parse(result.stdout.slice('matrix='.length)).include.map(row=>row.target),['windows-x64']);
});

test('workflow entry fails without emitting a runnable matrix for unsupported desktop or changed source',()=>{
 for(const changes of [{HOMER_BUILD_TARGET:'linux-x64'},{GITHUB_SHA:'b'.repeat(40)}]){
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/github-build-plan.mjs',import.meta.url))],{
   encoding:'utf8',env:{HOMER_BUILD_KIND:'desktop',HOMER_BUILD_TARGET:'macos-arm64',HOMER_EXPECTED_SHA:version.expectedSha,GITHUB_SHA:version.actualSha,...changes},
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/github_desktop_target_not_ready|github_build_source_changed/);
 }
});
