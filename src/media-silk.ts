import {decode,getDuration,isSilk} from 'silk-wasm';
// Expendable process: hostile codec input cannot block the service event loop.
const chunks:Buffer[]=[];let size=0;
try{
 for await(const chunk of process.stdin){size+=chunk.length;if(size>20*1024*1024)throw Error('media_size_limit');chunks.push(Buffer.from(chunk));}
 const bytes=Buffer.concat(chunks),mode=process.argv[2];
 if(mode!=='decode')throw Error('media_codec_mode_denied');
 if(!isSilk(bytes)||getDuration(bytes)>60000)throw Error('media_audio_duration_limit');
 const result=await decode(bytes,16000);if(result.duration>60000||result.data.length>1920000)throw Error('media_audio_duration_limit');
 process.stdout.write(result.data);
}catch{process.exitCode=1;}
