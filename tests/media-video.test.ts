import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeVideo} from '../src/media-video.js';

test('ILINK-VIDEO-004 arbitrary playlists and oversized header claims are not accepted as native MP4',async()=>{
 await assert.rejects(analyzeVideo(Buffer.from('#EXTM3U\nhttp://127.0.0.1/private')),/media_video_invalid/);
});
