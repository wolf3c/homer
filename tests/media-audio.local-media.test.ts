import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audioPcm,transcribeAudio,pcmWav} from '../src/media-audio.js';
const legacySilk=readFileSync(new URL('./fixtures/synthetic-legacy-voice.silk',import.meta.url));
test('legacy SILK decodes to non-silent WAV without a synthesizer',async()=>{
 const pcm=await audioPcm(legacySilk,'audio/silk');
 assert.ok(pcm.length>32000&&pcm.some(byte=>byte!==0));
 const wav=pcmWav(pcm);
 assert.equal(wav.subarray(0,4).toString(),'RIFF');
 assert.equal(wav.readUInt32LE(40),pcm.length);
});
test('local ASR hears unique words from an existing SILK attachment',async()=>{
 const recognized=await transcribeAudio(await audioPcm(legacySilk,'audio/silk'));
 assert.match(recognized.text.toLowerCase(),/purple/);assert.match(recognized.text.toLowerCase(),/seven|742|7/);
});
test('ILINK-AUDIO-02 unknown raw audio is explicitly unsupported and cannot be presented as understood',async()=>{
 await assert.rejects(audioPcm(Buffer.alloc(1024),'application/octet-stream'),/media_audio_encoding_unsupported/);
});
