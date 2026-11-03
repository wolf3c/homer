import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaProcess} from '../src/media-decode.js';
test('ILINK-VIDEO-03 decoder subprocess has a finite output, timeout, cancellation and private environment',async()=>{
 process.env.HOMER_SYNTHETIC_DECODER_SECRET='synthetic-only';
 try{assert.equal((await mediaProcess(process.execPath,['-e',"process.stdout.write(process.env.HOMER_SYNTHETIC_DECODER_SECRET??'absent')"],Buffer.alloc(0),1024)).toString(),'absent');}finally{delete process.env.HOMER_SYNTHETIC_DECODER_SECRET;}
 await assert.rejects(mediaProcess(process.execPath,['-e','process.stdout.write(Buffer.alloc(4096))'],Buffer.alloc(0),32),/media_decode_size_limit/);
 await assert.rejects(mediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],Buffer.alloc(0),32,undefined,20),/media_decode_timeout/);
 const abort=new AbortController(),job=mediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],Buffer.alloc(0),32,abort.signal);abort.abort();await assert.rejects(job,/media_decode_cancelled/);
});
