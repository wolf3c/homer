import assert from 'node:assert/strict';
import {fixture} from './web-service-fixture.js';
import {syntheticFile} from './recursive-publication-fixture.js';

export async function previewCollection(bytes?:Buffer){
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
  if(bytes){
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
}
