import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Homer} from '../src/service.js';
import {synthesizeVoice} from '../src/media-audio.js';

function source(data:Buffer,mime:string,artifact:string,changed=false){
 const host=Object.create(Homer.prototype) as any;let reads=0;
 const hash=createHash('sha256').update(data).digest('hex');
 Object.assign(host,{store:{run:()=>({artifact,matterId:'synthetic-matter'})},files:{
  prepareRun:()=> 'synthetic-result-directory',
  resultBytes:()=>({data,mime,sha256:changed&&reads++?'changed-source':hash}),
 }});
 return {hash,read:()=>host.resultTextSource('synthetic-run')};
}
test('accepted-result source uses actual decoded document bytes and rechecks original hash',async()=>{
 const bytes=Buffer.from('本项目文档使用 Markdown。'),s=source(bytes,'text/plain','source.txt');
 assert.deepEqual(await s.read(),{content:bytes.toString(),hash:s.hash});
 await assert.rejects(source(bytes,'text/plain','source.txt',true).read(),/artifact_changed/);
});
test('accepted voice result provides actual local ASR text tied to the original SILK hash',async()=>{
 const voice=await synthesizeVoice('The secret animal is a purple otter.');
 const s=source(voice.bytes,'audio/silk','spoken.silk'),recognized=await s.read();
 assert.ok(recognized,'voice result must provide an actual text source');
 assert.match(recognized.content.toLowerCase(),/purple/);assert.equal(recognized.hash,s.hash);
});
