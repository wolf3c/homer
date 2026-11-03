import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument} from '../src/media-documents.js';
test('ILINK-FILE-01 UTF-8 text preserves actual source without an optional reader',async()=>{
 const a=await extractDocument(Buffer.from('独有内容：海豚 314159'),'report.txt');assert.match(a.text,/海豚 314159/);assert.match(a.coverage,/全文/);
});
