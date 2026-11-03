import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';
import {fixture} from './web-service-fixture.js';
import {syntheticFile} from './recursive-publication-fixture.js';
import {previewCollection} from './web-preview-collection-fixture.js';

test('image region references verify original uploaded bytes and reach the main queue',async t=>{
 if(!ffmpegPath){t.skip('local_image_decoder_unavailable');return;}
 const f=fixture();
 try{
  await f.app.start();await f.app.message('Synthetic image source','preview-image-source');await f.app.idle();
  const bytes=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=24x12','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
  const published=syntheticFile(f.app,'preview-image-source','Synthetic.png',bytes,[],true);published.publish();
  const file=f.app.previewArtifact(published.resultId),requestId='preview-image';
  const asset=await f.app.uploadAttachment({threadId:'synthetic-main',requestId,uploadId:'preview-image-upload',filename:'Synthetic.png',data:bytes.toString('base64')});
  const reference={kind:'image' as const,source:{kind:'artifact' as const,id:published.resultId,sha256:file.sha256,title:file.filename},width:24,height:12,region:{x:2,y:3,width:4,height:5},comment:'Adjust this region',image:{assetId:asset.assetId,revision:asset.revision}};
  f.app.submitMessage({requestId,text:'',attachments:[reference.image],resourceReference:reference});await f.app.idle();
  assert.match(f.inputs.at(-1)!,/Adjust this region/);assert.match(f.inputs.at(-1)!,/"x":2,"y":3,"width":4,"height":5/);
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.requestId===requestId&&m.role==='user')?.resourceReference,reference);
  const forged=await f.app.uploadAttachment({threadId:'synthetic-main',requestId:'preview-image-forged',uploadId:'preview-image-forged-upload',filename:'different.txt',data:Buffer.from('different synthetic bytes').toString('base64')});
  assert.throws(()=>f.app.submitMessage({requestId:'preview-image-forged',text:'',attachments:[forged],resourceReference:{...reference,image:{assetId:forged.assetId,revision:forged.revision}}}),/preview_source_mismatch/);
 }finally{await f.app.close();}
});

test('image multi-region batches verify original pixels and attachment scope and send every note with native image',async()=>{
 if(!ffmpegPath)return;
 const f=fixture();
 try{
  await f.app.start();await f.app.message('Synthetic multi image source','multi-image-source');await f.app.idle();
  const bytes=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=240x120','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
  const published=syntheticFile(f.app,'multi-image-source','Source-hidden.png',bytes,[],true);published.publish();
  const file=f.app.previewArtifact(published.resultId),requestId='multi-image-request';
  const asset=await f.app.uploadAttachment({threadId:'synthetic-main',requestId,uploadId:'multi-image-upload',filename:file.filename,data:bytes.toString('base64')});
  const reference={kind:'image' as const,source:{kind:'artifact' as const,id:published.resultId,sha256:file.sha256,title:file.filename},width:240,height:120,image:{assetId:asset.assetId,revision:asset.revision},annotations:[
   {id:'first',region:{x:2,y:3,width:40,height:30},comment:'第一处要求'},
   {id:'second',region:{x:80,y:3,width:40,height:30},comment:'第二处修改\n保持换行'},
   {id:'third',region:{x:160,y:50,width:40,height:30},comment:'第三处要求'},
  ]};
  const input={requestId,text:'整体要求',attachments:[reference.image],resourceReference:reference};
  let imageReads=0;const image=f.app.media.image.bind(f.app.media);
  f.app.media.image=(requestId,ref)=>{imageReads++;return image(requestId,ref);};
  for(let badIndex=0;badIndex<3;badIndex++)assert.throws(()=>f.app.submitMessage({...input,resourceReference:{...reference,annotations:reference.annotations.map((n,i)=>i===badIndex?{...n,region:{...n.region,x:239}}:n)}}),/invalid_resource_reference/);
  assert.throws(()=>f.app.submitMessage({...input,resourceReference:{...reference,width:241}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({...input,resourceReference:{...reference,source:{...reference.source,sha256:'b'.repeat(64)}}}),/preview_source_mismatch/);
  assert.throws(()=>f.app.submitMessage({...input,requestId:'foreign-request'}),/media_scope_denied|media_source_required/);
  f.app.store.db.prepare('UPDATE media_assets SET bindingId=? WHERE id=?').run('web:other-thread',asset.assetId);
  assert.throws(()=>f.app.submitMessage(input),/media_scope_denied|media_source_required/);
  f.app.store.db.prepare('UPDATE media_assets SET bindingId=? WHERE id=?').run('web:synthetic-main',asset.assetId);
  const forged=await f.app.uploadAttachment({threadId:'synthetic-main',requestId,uploadId:'multi-wrong-image',filename:'Other.txt',data:Buffer.from('not image bytes').toString('base64')});
  assert.throws(()=>f.app.submitMessage({...input,attachments:[forged],resourceReference:{...reference,image:{assetId:forged.assetId,revision:forged.revision}}}),/preview_source_mismatch/);
  assert.equal(imageReads,0,'size validation uses prepared metadata, not full image bytes');
  const accepted=f.app.submitMessage(input);assert.equal(accepted.fresh,true);await f.app.idle();
  assert.equal(imageReads,1,'original image bytes are read once for the native model input');
  const context=f.inputs.at(-1)!;for(const n of reference.annotations){assert.ok(context.includes(n.id));assert.ok(context.includes(n.comment.replace('\n','\\n')));assert.ok(context.includes(JSON.stringify(n.region)));}
  assert.equal(f.nativeImages.at(-1)!.length,1);assert.ok(f.nativeImages.at(-1)![0]!.url.startsWith('data:image/png;base64,'));
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.role==='user'&&m.requestId===requestId)?.resourceReference,reference);
  const before=f.inputs.length;f.app.previewArtifact=()=>{throw Error('synthetic_source_unavailable');};
  assert.equal(f.app.submitMessage(input).fresh,false);await f.app.idle();assert.equal(f.inputs.length,before);
  assert.throws(()=>f.app.submitMessage({...input,resourceReference:{...reference,annotations:reference.annotations.slice(0,2)}}),/request_id_conflict/);
 }finally{await f.app.close();}
});

test('preview collections validate every published source atomically and reach synthetic main with one original image',async()=>{
 const f=fixture();
 try{
  await f.app.start();await f.app.message('Synthetic collection seed','collection-seed');await f.app.idle();
  const texts=syntheticFile(f.app,'collection-seed','One.md','First excerpt',[{filename:'Two.md',content:'**Second excerpt**'}]);texts.publish();
  await f.app.message('Synthetic HTML seed','collection-html-seed');await f.app.idle();
  const html=syntheticFile(f.app,'collection-html-seed','Page.html','<!doctype html><h1>Synthetic target</h1>',[],true);html.publish();
  const published=[...texts.resultIds.map(resultId=>({resultId})),html];
  const files=published.map(p=>f.app.previewArtifact(p.resultId));
  const source=(i:number)=>({kind:'artifact' as const,id:published[i]!.resultId,sha256:files[i]!.sha256,title:files[i]!.filename});
  const refs:import('../src/preview-reference.js').ResourceReference[]=[
   {kind:'text',source:source(0),annotations:[{id:'first',text:'First excerpt',comment:'First requirement'}]},
   {kind:'text',source:source(1),annotations:[{id:'second',text:'Second excerpt',comment:'Second requirement'}]},
   {kind:'web',source:source(2),annotations:[{id:'html',element:'h1',elementPath:'h1',x:1,y:1,comment:'HTML requirement'}]},
  ];
  const requestId='collection-complete';let attachments:import('../src/media-store.js').AttachmentRef[]=[];
  if(ffmpegPath){
   const bytes=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=24x12','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),1024*1024);
   await f.app.message('Synthetic image seed','collection-image-seed');await f.app.idle();
   const image=syntheticFile(f.app,'collection-image-seed','Collection.png',bytes,[],true);image.publish();const file=f.app.previewArtifact(image.resultId);
   const asset=await f.app.uploadAttachment({threadId:'synthetic-main',requestId,uploadId:'collection-image',filename:file.filename,data:bytes.toString('base64')});
   attachments=[{assetId:asset.assetId,revision:asset.revision}];
   refs.push({kind:'image',source:{kind:'artifact',id:image.resultId,sha256:file.sha256,title:file.filename},width:24,height:12,image:attachments[0]!,annotations:[0,1,2].map(i=>({id:'image-'+i,region:{x:i*6,y:1,width:4,height:3},comment:'Image requirement '+i}))});
  }
  const input={requestId,text:'Overall requirement',resourceReferences:refs,...(attachments.length?{attachments}:{})};
  const turns=f.inputs.length;
  for(let bad=0;bad<refs.length;bad++)assert.throws(()=>f.app.submitMessage({...input,resourceReferences:refs.map((r,i)=>i===bad?{...r,source:{...r.source,sha256:'b'.repeat(64)}} as typeof r:r)}),/preview_source_mismatch/);
  assert.equal(f.inputs.length,turns);assert.equal(f.app.history.acceptedRequestIds('synthetic-main').includes(requestId),false);
  assert.equal(f.app.submitMessage(input).fresh,true);await f.app.idle();
  for(const r of refs){assert.ok(f.inputs.at(-1)!.includes(r.source.kind==='artifact'?r.source.id:r.source.sourceId));for(const n of r.annotations??[])assert.ok(f.inputs.at(-1)!.includes(n.comment));}
  assert.equal(f.nativeImages.at(-1)!.length,attachments.length?1:0);
  assert.deepEqual(f.app.history.list('synthetic-main').find(m=>m.requestId===requestId&&m.role==='user')?.resourceReferences,refs);
  const count=f.inputs.length;assert.equal(f.app.submitMessage(input).fresh,false);await f.app.idle();assert.equal(f.inputs.length,count);
  assert.throws(()=>f.app.submitMessage({...input,resourceReferences:refs.slice(1)}),/request_id_conflict/);
 }finally{await f.app.close();}
});
