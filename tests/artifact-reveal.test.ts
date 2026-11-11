// Exercise actual message and byte checks with a fake Finder dispatcher.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';
import {revealAttachmentFile} from '../src/artifact-reveal.js';
import {createWebServer} from '../src/web-server.js';

test('reveal requires a current message grant and verifies the original or retained snapshot',async()=>{
 const f=htmlAttachmentFixture(),calls:string[][]=[];
 const options={platform:'darwin',launch:async(command:string,args:string[])=>{calls.push([command,...args]);}};
 try{
  assert.throws(()=>f.app.revealAttachment({messageId:f.replyId,...f.hidden}),/media_scope_denied/);
  const sent=f.send(),reveal=()=>f.app.revealAttachment(sent);
  for(const selector of [{...sent,messageId:'foreign-message'},{...sent,...f.hidden},{...sent,revision:2}])
   assert.throws(()=>f.app.revealAttachment(selector));
  assert.equal(calls.length,0);
  assert.deepEqual(await revealAttachmentFile(reveal(),options),{target:'source',device:'homer-host'});
  assert.deepEqual(calls,[['/usr/bin/open','-R',f.original]]);
  await assert.rejects(()=>revealAttachmentFile(reveal(),{...options,platform:'linux'}),/artifact_reveal_unsupported/);
  await assert.rejects(()=>revealAttachmentFile(reveal(),{...options,launch:async()=>{throw Error('private path');}}),/artifact_reveal_failed/);
  writeFileSync(f.original,'same name, different version');
  assert.deepEqual(reveal(),{path:sent.path,target:'snapshot'});
  unlinkSync(f.original);
  assert.deepEqual(reveal(),{path:sent.path,target:'snapshot'});
  symlinkSync(f.protectedFile,f.original);
  assert.deepEqual(reveal(),{path:sent.path,target:'snapshot'});
  const op=f.media.asset(sent).originOperationKey!;
  const update=f.store.db.prepare('UPDATE operations SET detailsJson=? WHERE id=?');
  for(const inputs of [null,[],['invalid'],[{path:f.protectedFile}]]){
   update.run(JSON.stringify({inputs,sources:[null]}),op);
   assert.deepEqual(reveal(),{path:sent.path,target:'snapshot'});
  }
  unlinkSync(sent.path);
  symlinkSync(f.protectedFile,sent.path);
  assert.throws(reveal,/media_file_denied/);
  unlinkSync(sent.path);
  assert.throws(reveal);
  f.history.revokeMessage(f.threadId,sent.messageId);
  assert.throws(reveal,/media_scope_denied/);
  assert.equal(calls.length,1);
 }finally{f.close();}
});

test('HTTP reveal requires same-origin POST, empty body and the exact attachment selector',async()=>{
 const f=htmlAttachmentFixture(),sent=f.send();
 const calls:string[][]=[];
 f.bridge.media!.reveal=async input=>revealAttachmentFile(f.app.revealAttachment(input),{
  platform:'darwin',launch:async(command,args)=>{calls.push([command,...args]);},
 });
 const server=await createWebServer({bridge:f.bridge,port:0});
 try{
  const path=server.url+'/api/media/'+sent.messageId+'/'+sent.assetId+'/'+sent.revision+'/reveal';
  const post=(value:unknown,origin=server.url)=>fetch(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
  assert.equal((await fetch(path)).status,404);
  assert.equal((await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await post({},'http://foreign.invalid')).status,403);
  for(const value of [{path:f.protectedFile},{filename:'secret'},[],null])assert.equal((await post(value)).status,409);
  assert.equal(calls.length,0);
  const response=await post({});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{target:'source',device:'homer-host'});
  assert.deepEqual(calls,[['/usr/bin/open','-R',f.original]]);
  f.history.revokeMessage(f.threadId,sent.messageId);
  assert.equal((await post({})).status,409);
  assert.equal(calls.length,1);
 }finally{await server.close();f.close();}
});
