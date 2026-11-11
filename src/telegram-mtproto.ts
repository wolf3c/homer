import {setTimeout as wait} from 'node:timers/promises';
import {Api,errors,helpers,Logger,TelegramClient,utils} from 'teleproto';
import {MemorySession} from 'teleproto/sessions';
import type {TelegramContextMessage} from './telegram-context.js';

export type TelegramApiCredentials={api_id:number;api_hash:string};
export type TelegramUpstream={
  read:(chatId:number,messageId:number,signal:AbortSignal)=>Promise<TelegramContextMessage|undefined>;
  close:()=>Promise<void>;
};

export function connectTelegramUpstream({api_id,api_hash}:TelegramApiCredentials,token:string,signal:AbortSignal):TelegramUpstream{
  const session=new MemorySession();
  const logger=new Logger();
  logger.handler=()=>{};
  const client=new TelegramClient(session,api_id,api_hash,{
    baseLogger:logger,catchUp:false,timeout:6,connectionRetries:2,floodSleepThreshold:10,
  });
  let ready=false,blockedUntil=0,closing:Promise<void>|undefined,startTimeout:NodeJS.Timeout|undefined;
  const rateLimited=(error:unknown)=>{
    if(!(error instanceof errors.FloodWaitError)||!Number.isSafeInteger(error.seconds)||error.seconds<=0)return false;
    blockedUntil=Math.max(blockedUntil,Date.now()+error.seconds*1000);
    return true;
  };
  const close=()=>{
    clearTimeout(startTimeout);
    signal.removeEventListener('abort',close);
    return closing??=client.destroy().catch(()=>{});
  };
  const start=()=>{
    blockedUntil=0;
    const timeout=startTimeout=setTimeout(close,25_000);
    timeout.unref();
    void client.start({botAuthToken:token}).then(async()=>{
      if(closing)return;
      const me=await client.getMe();
      if(!me.bot||me.id.toString()!==token.split(':',1)[0])throw Error('telegram_mtproto_identity_invalid');
      ready=true;
    }).catch(error=>{if(!rateLimited(error))return close();}).finally(()=>clearTimeout(timeout));
  };
  if(signal.aborted)void close();
  else{
    signal.addEventListener('abort',close,{once:true});
    start();
  }

  return {close,read:async(chatId,messageId,deadline)=>{
    if(closing||deadline.aborted||Date.now()<blockedUntil)return;
    if(!ready&&blockedUntil)start();
    // The SDK's string prefix is not the Bot API's numeric offset for every channel ID.
    const channel=chatId<-1_000_000_000_000
      ?new Api.PeerChannel({channelId:helpers.returnBigInt(-chatId-1_000_000_000_000)}):undefined;
    const sameChat=(peer:Api.TypePeer)=>channel
      ?peer instanceof Api.PeerChannel&&peer.channelId.equals(channel.channelId)
      :peer instanceof Api.PeerChat&&peer.chatId.equals(-chatId);
    const ids=[new Api.InputMessageID({id:messageId})],options={abortSignal:deadline,maxRetryCount:0,floodSleepThreshold:0};
    let result:Api.messages.TypeMessages|undefined;
    try{
      while(!closing&&!deadline.aborted&&Date.now()>=blockedUntil){
        if(ready&&!channel){
          result=await client.invoke(new Api.messages.GetMessages({id:ids}),undefined,options);
          break;
        }
        if(ready&&channel){
          // Bot API gives the group ID. The MTProto update supplies this session's access hash.
          let peer:Api.TypeInputPeer|undefined;
          try{peer=session.getInputEntity(channel);}catch{/* The matching push can arrive after the Bot API update. */}
          if(peer instanceof Api.InputPeerChannel&&peer.channelId.equals(channel.channelId)){
            result=await client.invoke(new Api.channels.GetMessages({channel:utils.getInputChannel(peer),id:ids}),undefined,options);
            break;
          }
        }
        await wait(100,undefined,{signal:deadline});
      }
    }catch(error){
      if(rateLimited(error))return;
      throw error;
    }
    if(!result||!('messages' in result)||closing||deadline.aborted)return;
    const message=result.messages.find(candidate=>candidate.id===messageId);
    if(!(message instanceof Api.Message||message instanceof Api.MessageService)||!sameChat(message.peerId))return;
    const reply=message.replyTo;
    const replyTo=reply&&(!reply.replyToPeerId||sameChat(reply.replyToPeerId))?reply.replyToMsgId:undefined;
    const sender=message.fromId;
    const author=sender instanceof Api.PeerUser?result.users.find(user=>user.id.equals(sender.userId)):undefined;
    return {id:message.id,replyTo,text:message.message?.slice(0,4096),author:author?utils.getDisplayName(author).slice(0,128):undefined};
  }};
}
