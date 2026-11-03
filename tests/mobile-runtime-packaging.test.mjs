import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {copyRuntimeDependencies,freezeToolchain} from '../scripts/trusted-build.mjs';

test('sealed Homer dependencies can load the actual WebRTC native binary',()=>{
 const parent=resolve('.codex/scratch/mobile-webrtc');mkdirSync(parent,{recursive:true});
 const runtime=mkdtempSync(join(parent,'sealed-dependencies-'));
 try{
  assert.ok(freezeToolchain(resolve('.'),runtime).startsWith(runtime+'/trusted-builds/'));
  const modules=copyRuntimeDependencies(resolve('.'),runtime);
  const require=createRequire(join(modules,'../probe.cjs'));
  const identity=JSON.parse(readFileSync(join(modules,'.dependency-identity.json'),'utf8'));
  const binaries=identity.packages.filter(item=>item.name.startsWith('@node-datachannel/'));
  assert.ok(binaries.length>0,'sealed dependencies must include the installed native platform package');
  for(const binary of binaries)assert.ok(require.resolve(join(modules,binary.name)).startsWith(modules+'/'));
  // Resolve inside the sealed tree, without the development node_modules fallback.
  const rtc=require(join(modules,'node-datachannel'));
  assert.equal(typeof rtc.PeerConnection,'function');
  const peer=new rtc.PeerConnection('packaged-runtime',{iceServers:[]});peer.close();rtc.cleanup();
 }finally{rmSync(runtime,{recursive:true,force:true});}
});
