// Instrument only the offline host fixture's existing channel boundaries.
// Real channel methods run first, and no account/network is configured.
import {HomerWechat} from '../../dist/channels/wechat-homer.js';
import {TelegramHomerBridge} from '../../dist/channels/telegram-homer-bridge.js';
for(const [owner,method,channel] of [[HomerWechat.prototype,'onMessage','wechat'],[TelegramHomerBridge.prototype,'handleMessage','telegram']]){
 const original=owner[method];
 owner[method]=async function(message){
  const result=await original.call(this,message);
  if(message.requestId?.startsWith('synthetic-delta-')||message.sourceRequestId?.startsWith('synthetic-delta-'))
   process.send?.({kind:'synthetic_channel_observed',channel,type:message.type,requestId:message.requestId??message.sourceRequestId});
  if(channel==='telegram'&&message.type==='main_start'&&message.sourceRequestId==='synthetic-delta-0'){
   await new Promise(resolve=>{
    const release=value=>{if(value?.kind==='synthetic_release_start'){process.off('message',release);resolve();}};
    process.on('message',release);process.send?.({kind:'synthetic_start_blocked'});
   });
  }
  return result;
 };
}
