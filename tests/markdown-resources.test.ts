import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {htmlAttachmentFixture} from './canvas-html-publication-fixture.js';
import {createWebServer} from '../src/web-server.js';
import {createWebChat} from '../src/web-chat.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');

test('image requests read live images without rereading the Markdown snapshot for each image',()=>{
 const f=htmlAttachmentFixture('report.md',Buffer.from('# large report\n'+'text\n'.repeat(200_000)));
 try{
  const sent=f.send();writeFileSync(join(dirname(f.original),'chart.png'),png);
  const read=f.media.readAttachment.bind(f.media);let snapshotReads=0;
  f.media.readAttachment=ref=>{snapshotReads++;return read(ref);};
  assert.equal(f.app.readAttachment(sent).data,f.bytes.toString('base64'));
  for(let n=0;n<10;n++)assert.equal(f.app.readAttachment({...sent,resource:'chart.png'}).data,png.toString('base64'));
  assert.equal(snapshotReads,1,'resource reads must not reread or hash the report body');
 }finally{f.close();}
});

test('Markdown resources use the saved source directory and current image bytes without image attachments',()=>{
 const f=htmlAttachmentFixture('report.md',Buffer.from('![chart](images/chart.png)'));
 try{
  const sent=f.send(),folder=dirname(f.original);mkdirSync(join(folder,'images'));
  writeFileSync(join(folder,'images/chart.png'),png);writeFileSync(join(folder,'图 表.png'),png);writeFileSync(join(folder,'100%.png'),png);writeFileSync(join(folder,'../parent.png'),png);
  const read=(resource:string)=>f.app.readAttachment({...sent,resource});
  for(const resource of ['images/chart.png','./images/chart.png','图%20表.png?size=1#part','100%25.png','../parent.png'])assert.equal(read(resource).data,png.toString('base64'));
  assert.equal(f.history.message(sent.messageId)?.attachments?.length,1);
  writeFileSync(f.original,'changed Markdown');assert.equal(Buffer.from(f.app.readAttachment(sent).data,'base64').toString(),f.bytes.toString());
  assert.equal(read('images/chart.png').mime,'image/png');unlinkSync(f.original);assert.equal(read('images/chart.png').data,png.toString('base64'));
  const changed=Buffer.concat([png,Buffer.from('changed')]);writeFileSync(join(folder,'images/chart.png'),changed);assert.equal(read('images/chart.png').data,changed.toString('base64'));
  unlinkSync(join(folder,'images/chart.png'));assert.throws(()=>read('images/chart.png'),/artifact_missing/);
  writeFileSync(join(folder,'plain.txt'),'not an image');assert.throws(()=>read('plain.txt'),/media_preview_unavailable/);
  symlinkSync(join(folder,'图 表.png'),join(folder,'linked.png'));assert.throws(()=>read('linked.png'),/artifact_path_denied/);
  for(const resource of ['/absolute.png','https://example.com/chart.png','//example.com/chart.png','file:///chart.png'])assert.throws(()=>read(resource),/media_request_invalid/);
  assert.throws(()=>f.app.readAttachment({...sent,messageId:'foreign-message',resource:'../parent.png'}),/media_scope_denied/);
  f.history.revokeMessage(f.threadId,sent.messageId);assert.throws(()=>read('../parent.png'),/media_scope_denied/);
 }finally{f.close();}
});

test('resources with no saved source never use the media snapshot directory as a base',()=>{
 const f=htmlAttachmentFixture('legacy.md',Buffer.from('![image](cached.png)'));
 try{
  const sent=f.send();writeFileSync(join(dirname(sent.path),'cached.png'),png);
  const key=f.media.asset(sent).originOperationKey!;
  f.store.db.prepare('UPDATE operations SET detailsJson=? WHERE id=?').run(JSON.stringify({inputs:[{assetId:sent.assetId,revision:sent.revision}],sources:[null]}),key);
  assert.throws(()=>f.app.readAttachment({...sent,resource:'cached.png'}),/artifact_source_unavailable/);
  assert.equal(f.app.readAttachment(sent).data,f.bytes.toString('base64'));
 }finally{f.close();}
});

test('HTTP and device media.read return the same Markdown resource bytes',async()=>{
 const f=htmlAttachmentFixture('report.md',Buffer.from('![image](../图%20表.png)')),sent=f.send();
 writeFileSync(join(dirname(f.original),'../图 表.png'),png);
 const server=await createWebServer({bridge:f.bridge,port:0});
 try{
  const resource='../图%20表.png',path='/api/media/'+sent.messageId+'/'+sent.assetId+'/'+sent.revision+'/resource/'+encodeURIComponent(resource);
  const response=await fetch(server.url+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  const chat=createWebChat(f.bridge);const value=await chat('media.read',{messageId:sent.messageId,assetId:sent.assetId,revision:sent.revision,resource}) as {data:string};assert.equal(value.data,png.toString('base64'));
  for(const input of [{resource:1},{resource:'x.png',preview:'voice'},{resource:'x.png',path:'/arbitrary'}])await assert.rejects(chat('media.read',{messageId:sent.messageId,assetId:sent.assetId,revision:sent.revision,...input}),/media_request_invalid/);
  assert.equal((await fetch(server.url+path+'?preview=voice')).status,400);
 }finally{await server.close();f.close();}
});
