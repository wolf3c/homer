import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ffmpegPath,mediaProcess,imageThumbnail,modelImage} from '../src/media-decode.js';
import {imageDimensions} from '../src/media-policy.js';

test('ILINK-THUMB-01 actual local image decoder produces bounded pixels without enlarging small inputs',async()=>{
 assert.ok(ffmpegPath,'local ffmpeg is required for the implemented decoder');
 const png=await mediaProcess(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=1280x640','-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],Buffer.alloc(0),512*1024);
 const thumb=await imageThumbnail(png,'image/png');assert.deepEqual(imageDimensions(thumb.bytes,thumb.mime),{width:320,height:160});assert.ok(thumb.bytes.length<=512*1024);
 const again=await imageThumbnail(thumb.bytes,'image/png');assert.equal(again.width,320);assert.equal(again.height,160);
 const model=await modelImage(png,'image/png');assert.equal(model.width,1280);assert.equal(model.height,640);
});

test('ILINK-THUMB-02 cancelled or invalid image work fails before producing a thumbnail',async()=>{
 await assert.rejects(imageThumbnail(Buffer.alloc(0),'image/png',AbortSignal.abort()),/media_decode_cancelled/);
 await assert.rejects(imageThumbnail(Buffer.from('not pixels'),'image/png'),/media_decode_failed/);
});
