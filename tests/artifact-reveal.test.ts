// Requirements-derived synthetic records; no real model, account, or user files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './recursive-fixture.js';
import {syntheticFile} from './recursive-publication-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';
import type {Homer} from '../src/service.js';
import {revealPublishedArtifact} from '../src/artifact-reveal.js';
import {createWebServer} from '../src/web-server.js';

function publicationFixture(){
 const f=fixture(),app={...f,registerChannelCapabilities(){},onStateChange:(listener:()=>void)=>f.store.db.onChange(()=>listener())} as unknown as Homer;
 const filename='synthetic-reveal.html',bytes=Buffer.from('<h1>Synthetic reveal</h1>');
 const published=syntheticFile(app,'user-synthetic',filename,bytes.toString(),[],true);
 f.source('synthetic-unpublished');
 const hidden=syntheticFile(app,'synthetic-unpublished','hidden.md');
 const run=published.run,checked=f.tasks.readResult({agentId:f.store.meta('mainAgentId')!},published.resultId),path=checked.file!.path;
 const sourcePath=(checked.payload.workspaceSource as {path:string}).path;
 let deliveryId:string;
 return {...f,run,bytes,staged:{resultId:published.resultId,path,sourcePath},hidden,
  bridge:homerWebBridge(app,{draftUpload:false,nativeCapabilities:false}),
  publish(){const delivery=published.publish();deliveryId=delivery.id;f.tasks.markDelivery(deliveryId,'recorded');return delivery;},
  revoke(){f.tasks.markDelivery(deliveryId,'revoked');},
 };
}

test('reveal requires the exact published ID and launches only a checked registered file',async()=>{
 const f=publicationFixture();const calls:unknown[]=[];
 const options={platform:'darwin',launch:async(command:string,args:string[])=>{calls.push([command,args]);}};
 try{
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/artifact_not_authorized/);
  f.publish();
  for(const id of [f.hidden.resultId!,'result-unknown','run-any','../../etc/passwd','result-x;open','/etc/hosts'])
   await assert.rejects(()=>revealPublishedArtifact(f.tasks,id,options),/artifact_not_authorized/);
  assert.equal(calls.length,0);
  assert.deepEqual(await revealPublishedArtifact(f.tasks,f.staged.resultId!,options),{target:'source',device:'homer-host'});
  assert.deepEqual(calls,[['/usr/bin/open',['-R',f.staged.sourcePath]]]);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,{...options,platform:'linux'}),/artifact_reveal_unsupported/);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,{...options,launch:async()=>{throw Error('private path');}}),/artifact_reveal_failed/);
  const sha256=f.files.resultBytes(f.files.prepareRun(f.run.taskId,f.run.id),f.staged.path).sha256;
  f.store.db.prepare('UPDATE results SET sha256=NULL WHERE id=?').run(f.staged.resultId!);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/artifact_version_unknown/);
  f.store.db.prepare('UPDATE results SET sha256=? WHERE id=?').run(sha256,f.staged.resultId!);
  writeFileSync(f.staged.path,'same name, different version');
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/result_hash_mismatch/);
  unlinkSync(f.staged.path);symlinkSync('/etc/hosts',f.staged.path);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/symlink_denied/);
  unlinkSync(f.staged.path);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/material_missing/);
  f.revoke();await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/artifact_not_authorized/);
  assert.equal(calls.length,1);
 }finally{f.close();}
});

test('workspace provenance selects the recorded original, never a same-name copy or fallback',async()=>{
 // Exercise persisted provenance validation independently of its creation during adoption.
 const f=publicationFixture();const calls:string[][]=[];
 try{
  f.publish();const dir=f.files.prepareRun(f.run.taskId,f.run.id),path=join(dir,'original.html');
  writeFileSync(path,f.bytes);
  const provenance={path,sha256:f.files.resultBytes(dir,path).sha256};
  const payload=(source:unknown)=>f.store.db.prepare('UPDATE results SET payloadJson=? WHERE id=?').run(JSON.stringify({workspaceSource:source}),f.staged.resultId!);
  payload(provenance);
  const options={platform:'darwin',launch:async(_command:string,args:string[])=>{calls.push(args);}};
  assert.equal((await revealPublishedArtifact(f.tasks,f.staged.resultId!,options)).target,'source');
  assert.deepEqual(calls,[['-R',path]]);
  writeFileSync(path,'changed source');
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/artifact_source_changed/);
  unlinkSync(path);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/material_missing/);
  for(const denied of ['/etc/hosts',join(dir,'../foreign/file.html'),join(dir,'.codex/auth.json')]){
   payload({...provenance,path:denied});
   await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options));
  }
  payload(null);await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/artifact_source_invalid/);
  assert.equal(calls.length,1);
  payload(provenance);symlinkSync('/etc/hosts',path);
  await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/symlink_denied/);
 }finally{f.close();}
});

test('HTTP reveal is explicit same-origin POST with empty body and opaque result ID',async()=>{
 const f=publicationFixture();let calls=0;
 f.bridge.revealArtifact=async()=>{calls++;return {target:'published',device:'homer-host'};};
 const server=await createWebServer({bridge:f.bridge,port:0});
 try{
  const path=server.url+'/api/files/'+f.staged.resultId+'/reveal';
  const post=(value:unknown,origin=server.url)=>fetch(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
  assert.equal((await fetch(path)).status,404);
  assert.equal((await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await post({},'http://foreign.invalid')).status,403);
  for(const value of [{path:'/etc/hosts'},{filename:'secret'},[],null])assert.equal((await post(value)).status,409);
  assert.equal(calls,0);const response=await post({});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{target:'published',device:'homer-host'});assert.equal(calls,1);
 }finally{await server.close();f.close();}
});

test('reveal fails clearly for corrupt provenance and verifies each distinct file only once',async()=>{
 const f=publicationFixture();let calls=0;
 const options={platform:'darwin',launch:async()=>{calls++;}};
 try{
  f.publish();
  const payload=(value:string)=>f.store.db.prepare('UPDATE results SET payloadJson=? WHERE id=?').run(value,f.staged.resultId!);
  for(const invalid of ['null','[]','"invalid"','{broken']){
   payload(invalid);
   await assert.rejects(()=>revealPublishedArtifact(f.tasks,f.staged.resultId!,options),/artifact_source_invalid/);
  }
  const sha256=f.files.verify(f.files.prepareRun(f.run.taskId,f.run.id),f.staged.path).sha256;
  payload(JSON.stringify({workspaceSource:{path:f.staged.path,sha256}}));
  const verify=f.files.verify.bind(f.files),verified:string[]=[];
  f.files.verify=(dir,path)=>{verified.push(path);return verify(dir,path);};
  assert.equal((await revealPublishedArtifact(f.tasks,f.staged.resultId!,options)).target,'source');
  assert.deepEqual(verified,[f.staged.path]);
  assert.equal(calls,1);
 }finally{f.close();}
});
