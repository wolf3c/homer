// Hold only the first synthetic input so the second one is queued deterministically.
import {Homer} from '../../dist/service.js';
const original=Homer.prototype.emit;
Homer.prototype.emit=async function(message){
 if(message.type==='main_start'&&message.sourceRequestId==='synthetic-delta-0'){
  await new Promise(resolve=>{
   const release=value=>{if(value?.kind==='synthetic_release_start'){process.off('message',release);resolve();}};
   process.on('message',release);process.send?.({kind:'synthetic_start_blocked'});
  });
 }
 return original.call(this,message);
};
