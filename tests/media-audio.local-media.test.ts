import {test} from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeVoice,audioPcm,transcribeAudio,pcmWav} from '../src/media-audio.js';
test('ILINK-AUDIO-01 local TTS creates real SILK, decoder creates playable WAV and local ASR hears unique words',async()=>{
 const voice=await synthesizeVoice('The secret animal is a purple otter. The number is seven four two.');
 assert.match(voice.bytes.subarray(0,16).toString(),/SILK_V3/);assert.ok(voice.duration>1000);
 const pcm=await audioPcm(voice.bytes,'audio/silk');assert.equal(pcmWav(pcm).subarray(0,4).toString(),'RIFF');
 const recognized=await transcribeAudio(pcm);assert.match(recognized.text.toLowerCase(),/purple/);assert.match(recognized.text.toLowerCase(),/seven|742|7/);
});
test('ILINK-AUDIO-02 unknown raw audio is explicitly unsupported and cannot be presented as understood',async()=>{
 await assert.rejects(audioPcm(Buffer.alloc(1024),'application/octet-stream'),/media_audio_encoding_unsupported/);
});
