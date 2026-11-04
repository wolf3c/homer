import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {userInfo} from 'node:os';
const {profileOverrides}=await import(process.env.HOMER_TEST_ENGINE_MODULE);
test('isolating desktop HOME retains actual user browser denies and explicit browser protections',()=>{
 const parent=resolve('.codex/scratch/macos-desktop-application/browser-boundary');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-'));
 for(const name of ['runtime','workspace','codex','isolated-home','custom-browser'])mkdirSync(join(root,name));
 const cfg={appData:root,nativeCodexHome:join(root,'codex'),codexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexBin:'/usr/bin/false',controlBrowserData:[join(root,'custom-browser')]};
 const previous=process.env.HOME;process.env.HOME=join(root,'isolated-home');
 try{
  const rules=profileOverrides(cfg,{cwd:cfg.workspace,readRoots:[cfg.workspace],tools:[],nativeTools:'main',nativeCapabilities:true}).filesystem;
  for(const path of ['Library/Application Support/Google/Chrome','Library/Safari','Library/Cookies'])assert.equal(rules[join(userInfo().homedir,path)],'deny');
  assert.equal(rules[join(root,'custom-browser')],'deny');assert.equal(rules[cfg.runtime],'deny');assert.equal(rules[cfg.codexHome],'deny');
  assert.equal(rules[join(cfg.codexHome,'skills')],'write');assert.equal(rules[join(cfg.codexHome,'skills/.system')],'read');
 }finally{if(previous===undefined)delete process.env.HOME;else process.env.HOME=previous;}
});

test('Windows retains real user AppData browser denies with an isolated HOME',()=>{
 const parent=resolve('.codex/scratch/windows-nsis-implementation/browser-boundary');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'synthetic-'));
 for(const name of ['runtime','workspace','codex'])mkdirSync(join(root,name));
 const cfg={appData:root,nativeCodexHome:join(root,'codex'),codexHome:join(root,'codex'),runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexBin:'/usr/bin/false'};
 const platform=Object.getOwnPropertyDescriptor(process,'platform'),oldLocal=process.env.LOCALAPPDATA,oldRoaming=process.env.APPDATA;
 try{
  Object.defineProperty(process,'platform',{value:'win32'});process.env.LOCALAPPDATA=join(root,'redirected-local');process.env.APPDATA=join(root,'redirected-roaming');
  const rules=profileOverrides(cfg,{cwd:cfg.workspace,readRoots:[cfg.workspace],tools:[],nativeTools:'main',nativeCapabilities:true}).filesystem;
  for(const path of [join(process.env.LOCALAPPDATA,'Google/Chrome'),join(process.env.LOCALAPPDATA,'Microsoft/Edge'),join(process.env.LOCALAPPDATA,'BraveSoftware'),join(process.env.APPDATA,'Mozilla/Firefox'),join(userInfo().homedir,'AppData/Local/Google/Chrome')])assert.equal(rules[path],'deny');
  assert.equal(rules[cfg.runtime],'deny');assert.equal(rules[cfg.codexHome],'deny');
 }finally{Object.defineProperty(process,'platform',platform);if(oldLocal===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=oldLocal;if(oldRoaming===undefined)delete process.env.APPDATA;else process.env.APPDATA=oldRoaming;}
});
