import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ffmpegPath,mediaProcess,imageThumbnail,modelImage} from '../src/media-decode.js';
import {imageDimensions,MEDIA_POLICY} from '../src/media-policy.js';

test('ILINK-THUMB-01 actual local image decoder produces bounded pixels without enlarging small inputs',async()=>{
 assert.ok(ffmpegPath,'local ffmpeg is required for the implemented decoder');
 const png=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=1280x640','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),512*1024);
 const thumb=await imageThumbnail(png,'image/png');assert.deepEqual(imageDimensions(thumb.bytes,thumb.mime),{width:320,height:160});assert.ok(thumb.bytes.length<=512*1024);
 const again=await imageThumbnail(thumb.bytes,'image/png');assert.equal(again.width,320);assert.equal(again.height,160);
 const model=await modelImage(png,'image/png');assert.equal(model.width,1280);assert.equal(model.height,640);
});

test('ILINK-THUMB-02 cancelled or invalid image work fails before producing a thumbnail',async()=>{
 await assert.rejects(imageThumbnail(Buffer.alloc(0),'image/png',AbortSignal.abort()),/media_decode_cancelled/);
 await assert.rejects(imageThumbnail(Buffer.from('not pixels'),'image/png'),/media_decode_failed/);
});

test('model image retains 4096 source pixels while the thumbnail stays bounded at 320',async()=>{
 assert.ok(ffmpegPath);
 const png=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=4096x256','-frames:v','1','-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],Buffer.alloc(0),MEDIA_POLICY.imageBytes);
 const original=Buffer.from(png),model=await modelImage(png,'image/png'),thumb=await imageThumbnail(png,'image/png');
 assert.deepEqual(imageDimensions(model.bytes,model.mime),{width:4096,height:256});
 assert.deepEqual(imageDimensions(thumb.bytes,thumb.mime),{width:320,height:20});
 assert.deepEqual(png,original);
});

test('full-size JPEG normalization accepts a valid source whose lossless PNG exceeds 20 MiB',async()=>{
 assert.ok(ffmpegPath);
 const width=3072,height=2560,raw=Buffer.alloc(width*height*3);let seed=7;
 for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=seed>>>24;}
 const jpeg=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-i','pipe:0','-frames:v','1','-pix_fmt','yuvj444p','-q:v','2','-f','image2pipe','-vcodec','mjpeg','-threads','1','pipe:1'],raw,MEDIA_POLICY.imageBytes);
 assert.ok(jpeg.length<MEDIA_POLICY.imageBytes);
 const comment=Buffer.from('synthetic-image-metadata'),header=Buffer.from([255,254,0,0]);header.writeUInt16BE(comment.length+2,2);
 const source=Buffer.concat([jpeg.subarray(0,2),header,comment,jpeg.subarray(2)]);assert.ok(source.includes(comment));
 const model=await modelImage(source,'image/jpeg');assert.equal(model.bytes.includes(comment),false);
 assert.deepEqual(imageDimensions(model.bytes,model.mime),{width,height});
 assert.ok(model.bytes.length>MEDIA_POLICY.imageBytes,'the fixture must exercise PNG expansion beyond the source byte budget');
 // Candidate files have a separate 50 MiB intake budget; decoding must not
 // impose the ordinary 20 MiB attachment budget on an otherwise valid PNG.
 const candidate=await modelImage(model.bytes,model.mime);assert.deepEqual(imageDimensions(candidate.bytes,candidate.mime),{width,height});
});

test('model image keeps cancellation, pixel and invalid media guards',async()=>{
 await assert.rejects(modelImage(Buffer.alloc(0),'image/png',AbortSignal.abort()),/media_decode_cancelled/);
 await assert.rejects(modelImage(Buffer.from('not pixels'),'image/png'),/media_decode_failed/);
 const oversized=Buffer.alloc(24);oversized.writeUInt32BE(10000,16);oversized.writeUInt32BE(10000,20);
 await assert.rejects(modelImage(oversized,'image/png'),/media_pixel_limit/);
});

test('animated inputs retain only the first frame at source dimensions',async()=>{
 assert.ok(ffmpegPath);
 const raw=Buffer.concat([Buffer.from([255,0,0]),Buffer.from([0,0,255])]);
 const gif=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-f','rawvideo','-pixel_format','rgb24','-video_size','1x1','-i','pipe:0','-frames:v','2','-f','gif','pipe:1'],raw,1024*1024);
 const model=await modelImage(gif,'image/gif');assert.deepEqual(imageDimensions(model.bytes,model.mime),{width:1,height:1});
 const pixels=await mediaProcess(ffmpegPath,['-v','error','-filter_threads','1','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],model.bytes,1024);
 assert.deepEqual(pixels,Buffer.from([252,0,0])); // GIF's fixed palette rounds red down.
 const oversized=Buffer.from(gif);oversized.writeUInt16LE(65535,6);oversized.writeUInt16LE(65535,8);
 await assert.rejects(modelImage(oversized,'image/gif'),/media_decode_failed/);
});
