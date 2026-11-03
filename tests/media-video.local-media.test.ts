import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ffmpegPath,mediaProcess} from '../src/media-decode.js';
import {analyzeVideo,videoThumbnail} from '../src/media-video.js';
test('ILINK-VIDEO-001 actual MP4 decode produces six timed frames with explicit coverage',async()=>{
 assert.ok(ffmpegPath);
 const video=await mediaProcess(ffmpegPath,['-v','error','-f','lavfi','-i','color=c=blue:s=320x160:r=10:d=1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],Buffer.alloc(0),1024*1024);
 const result=await analyzeVideo(video);assert.equal(result.frames.length,6);
 const thumbnail=await videoThumbnail(video);assert.equal(thumbnail.width,320);assert.equal(thumbnail.height,160);assert.ok(thumbnail.bytes.length<=512*1024);
 for(const frame of result.frames){assert.equal(frame.mime,'image/png');assert.equal(frame.width,320);assert.equal(frame.height,160);assert.ok(frame.bytes.length>0);}
 assert.deepEqual(result.extraction.audio,{state:'absent'});assert.equal(result.extraction.frameTimesMs[0],0);assert.ok(result.extraction.frameTimesMs.at(-1)!<=1000);assert.match(result.extraction.coverage,/6帧/);
 await assert.rejects(analyzeVideo(video,AbortSignal.abort()),/media_decode_cancelled/);
});
