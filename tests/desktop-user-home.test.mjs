import './fixtures/synthetic-home.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Writable} from 'node:stream';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import * as desktop from '../scripts/desktop-profile.mjs';

async function launch({platform='darwin',testProfile=false,home,userProfile}={}){
 const windows=platform==='win32',bundle='/synthetic/Homer.app',resources=join(bundle,'Contents/Resources'),homer=join(resources,'homer'),profile='/synthetic/profile';
 const expectedHome=testProfile?join(profile,'host-home'):windows?'C:\\Synthetic User':'/synthetic/Real User';
 const empty=Buffer.alloc(0),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const files=windows?['Homer.exe']:['Contents/MacOS/homer-image-decoder','Contents/MacOS/homer-window-capture','Contents/MacOS/node'];
 const manifest={format:2,node:'22.22.0',codex:'0.171.0-alpha.7',arch:'arm64',files:[],codeFiles:files.map(path=>({path,sha256:sha(empty)}))};
 const events=[];let reached=false;
 const proc={argv:['node','desktop-runtime','--profile',profile,...(testProfile?['--test-profile']:[])],version:'v22.22.0',arch:'arm64',platform,
  execPath:windows?join(resources,'node.exe'):join(bundle,'Contents/MacOS/node'),cwd:()=>profile,
  env:{HOME:home??expectedHome,...(windows?{USERPROFILE:userProfile??expectedHome,SystemRoot:'C:\\Windows'}:{}),TMPDIR:join(profile,'tmp'),OPENAI_API_KEY:'SYNTHETIC_MUST_NOT_FORWARD',GIT_AUTHOR_NAME:'SYNTHETIC_MUST_NOT_FORWARD'},
  stdout:new Writable({write(bytes,_encoding,done){events.push(JSON.parse(String(bytes)));done();}})};
 const require=createRequire(import.meta.url),modules={
  'node:fs':{...require('node:fs'),realpathSync:value=>value,readdirSync:()=>[],readFileSync:path=>path===join(resources,'desktop-manifest.json')?Buffer.from(JSON.stringify(manifest)):empty},
  'node:os':{userInfo:()=>({homedir:windows?'C:\\Synthetic User':'/synthetic/Real User'})},
  './desktop-profile.mjs':{...desktop,prepareDesktopProfile(){reached=true;throw Error('synthetic_environment_ready');}},
 };
 const context=vm.createContext({process:proc,Buffer,console});
 const load=async name=>{const exports=modules[name]??require(name);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});await m.link(()=>{});await m.evaluate();return m;};
 const entry=new vm.SourceTextModule(readFileSync('scripts/desktop-runtime.mjs','utf8'),{context,initializeImportMeta:meta=>{meta.url='file://'+homer+'/scripts/desktop-runtime.mjs';},importModuleDynamically:load});
 await entry.link(load);await entry.evaluate();return {reached,events,env:proc.env,expectedHome,profile};
}

if(!vm.SourceTextModule){
 test('desktop HOME contracts run with VM modules',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{env,encoding:'utf8'});
  assert.match(output,/# fail 0/);
 });
}else{
 for(const platform of ['darwin','win32'])for(const testProfile of [false,true])test(platform+' runtime validates and retains '+(testProfile?'synthetic':'system')+' HOME through environment rebuilding',async()=>{
  const f=await launch({platform,testProfile});assert.equal(f.reached,true,JSON.stringify(f.events));assert.equal(f.env.HOME,f.expectedHome);
  assert.equal(f.env.USERPROFILE,platform==='win32'?f.expectedHome:undefined);assert.equal(f.env.TMPDIR,join(f.profile,'tmp'));
  assert.equal(f.env.OPENAI_API_KEY,undefined);assert.equal(f.env.GIT_AUTHOR_NAME,undefined);
 });
 for(const home of ['','relative-home','/synthetic/profile/host-home'])test('formal runtime rejects untrusted or missing HOME before profile access: '+JSON.stringify(home),async()=>{
  const f=await launch({home});assert.equal(f.reached,false);assert.equal(f.events.at(-1)?.code,'desktop_environment_isolation_required');
 });
 test('Windows runtime rejects a USERPROFILE inconsistent with its trusted HOME',async()=>{
  const f=await launch({platform:'win32',userProfile:'C:\\Other User'});assert.equal(f.reached,false);assert.equal(f.events.at(-1)?.code,'desktop_environment_isolation_required');
 });
}
