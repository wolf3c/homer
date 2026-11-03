import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument} from '../src/media-documents.js';
test('ILINK-FILE-01 UTF-16 text preserves actual source and rejects executable bytes',async()=>{
 const b=await extractDocument(Buffer.concat([Buffer.from([255,254]),Buffer.from('表格内容','utf16le')]),'utf16.txt');assert.match(b.text,/表格内容/);
 await assert.rejects(extractDocument(Buffer.from([0x4d,0x5a,0,0]),'pretend.txt'),/document_unsupported/);
});
test('ILINK-FILE-02 local PDF and Office readers return pages/cells without network or macros',async()=>{
 const fixtures=await import('./fixtures/media-document-fixtures.js');
 for(const [filename,bytes,expected]of await fixtures.documents()){
  const result=await extractDocument(bytes,filename);assert.match(result.text,expected);assert.ok(result.coverage);assert.ok(result.sourceHash.length===64);
 }
});
test('ILINK-FILE-001 encrypted/scan-only/macro/archive inputs keep explicit parsing boundaries',async()=>{
 const {documentBoundaries}=await import('./fixtures/media-document-fixtures.js');
 for(const [filename,bytes,expected] of documentBoundaries()){
  if(expected==='empty_text_layer'){
   const result=await extractDocument(bytes,filename);assert.equal(result.text,'');assert.ok(result.limitations.some(s=>s.includes('不能宣称已读懂')));
  }else await assert.rejects(extractDocument(bytes,filename),error=>error instanceof Error&&error.message===expected);
 }
});
