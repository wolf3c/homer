import {closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {EnvHttpProxyAgent} from 'undici';
import {assertWindowsPrivate} from '../scripts/windows-security.mjs';
import {codexProxyEnvironment} from './engine.js';
import {writeChannelConfig} from './channel-config.js';
import type {ChannelAdapter, ChannelAddress, ChannelHealth, ChannelPacket, ChannelPlugin} from './channel-plugin.js';
import {telegramReplyContext,type TelegramContextMessage} from './telegram-context.js';
import type {TelegramApiCredentials,TelegramUpstream} from './telegram-mtproto.js';

const tokenPattern=/^[1-9]\d{0,15}:[A-Za-z0-9_-]{10,128}$/;
const positiveId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
export type TelegramAccount={token:string;userId:number;chatId:number};
type Bot=TelegramAccount & {username?:string};
const maxConfigBytes=32*1024;
type Chat={id:number;type:string;title?:string};
type User={id:number;is_bot:boolean;username?:string;first_name?:string;last_name?:string};
type Message={message_id?:number;date?:number;text?:string;caption?:string;message_thread_id?:number;is_topic_message?:boolean;
  chat?:Chat;from?:User;sender_chat?:Chat;forward_origin?:unknown;
  entities?:{type:string;offset:number;length:number}[];reply_to_message?:Omit<Message,'reply_to_message'>};
type Member={user:User;status:string;is_member?:boolean};
type Update={update_id:number;message?:Message;my_chat_member?:{
  chat:Chat;from:User;date:number;old_chat_member:Member;new_chat_member:Member;
}};
const groupChat=(chat:Chat|undefined):chat is Chat=>
  !!chat&&(chat.type==='group'||chat.type==='supergroup')&&Number.isSafeInteger(chat.id)&&chat.id<0;
const inGroup=(member:Member|undefined)=>!!member&&(
  member.status==='member'||member.status==='administrator'||member.status==='creator'||
  (member.status==='restricted'&&member.is_member===true));

function groupQuestion(message:Message,username:string|undefined,botId:string){
  const {text,entities,from}=message;
  if(typeof text!=='string'||from?.is_bot!==false||!positiveId(from.id)||
    message.sender_chat||message.forward_origin)return;
  const reply=message.reply_to_message;
  const repliesToBot=reply?.from?.is_bot===true&&String(reply.from.id)===botId;
  const tag=username?'@'+username.toLowerCase():'';
  const mentions=tag&&Array.isArray(entities)?entities.filter(entity=>
    entity?.type==='mention'&&Number.isSafeInteger(entity.offset)&&entity.offset>=0&&
    entity.length===tag.length&&text.slice(entity.offset,entity.offset+entity.length).toLowerCase()===tag):[];
  if(!mentions.length&&!repliesToBot)return;
  let question=text;
  for(const offset of [...new Set(mentions.map(mention=>mention.offset))].sort((a,b)=>b-a)){
    question=question.slice(0,offset)+question.slice(offset+tag.length);
  }
  return question.trim()||undefined;
}

function contextMessage(message:Message|undefined):TelegramContextMessage|undefined{
  if(!positiveId(message?.message_id))return;
  const text=message.text??message.caption;
  const author=message.sender_chat?.title??[message.from?.first_name,message.from?.last_name].filter(name=>typeof name==='string').join(' ');
  const replyTo=message.reply_to_message?.message_id;
  return {id:message.message_id,...(positiveId(replyTo)?{replyTo}:{}),
    ...(typeof text==='string'?{text:text.slice(0,4096)}:{}),...(typeof author==='string'&&author?{author:author.slice(0,128)}:{})};
}

class TelegramRejected extends Error {
  constructor(readonly status:number,readonly retryAfter:number){super('telegram_api_rejected');}
}

function network():typeof fetch {
  const env=codexProxyEnvironment();
  const http=env.http_proxy??env.HTTP_PROXY,https=env.https_proxy??env.HTTPS_PROXY;
  if(!http&&!https)return fetch;
  const dispatcher=new EnvHttpProxyAgent({httpProxy:http,httpsProxy:https,noProxy:env.no_proxy??env.NO_PROXY});
  return (url,init)=>fetch(url,{...init,dispatcher} as RequestInit);
}

async function request<T>(http:typeof fetch,token:string,method:string,body:FormData|object,signal:AbortSignal):Promise<T>{
  const form=body instanceof FormData;
  let status:number,result:{ok?:boolean;error_code?:number;result?:T;parameters?:{retry_after?:number}}|null;
  try{
    const response=await http('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',redirect:'error',signal,body:form?body:JSON.stringify(body),
      ...(form?{}:{headers:{'content-type':'application/json'}}),
    });
    status=response.status;
    result=await response.json();
  }catch{throw Error('telegram_api_unavailable');}
  if(status>=400&&status<500&&result?.ok===false&&result.error_code===status)
    throw new TelegramRejected(status,positiveId(result.parameters?.retry_after)?result.parameters.retry_after:5);
  if(status!==200||result?.ok!==true||result.result===undefined)throw Error('telegram_api_unavailable');
  return result.result;
}

const username=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_]{1,32}$/.test(value)?value:undefined;
export function telegramBotId(token:unknown):string {
  if(typeof token!=='string'||!tokenPattern.test(token))throw Error('telegram_token_invalid');
  const id=token.split(':',1)[0]!;
  if(!positiveId(Number(id)))throw Error('telegram_token_invalid');
  return id;
}

export async function verifyTelegramBot(token:string,signal:AbortSignal,http=network()){
  const id=telegramBotId(token);
  const me=await request<{id:number;is_bot:boolean;username?:string}>(http,token,'getMe',{},AbortSignal.any([signal,AbortSignal.timeout(10_000)]));
  if(String(me?.id)!==id||me.is_bot!==true)throw Error('telegram_bot_identity_invalid');
  return {id,label:username(me.username)??id};
}

export async function pairTelegramBot(token:string,command:string,signal:AbortSignal,http=network()){
  try{
    const webhook=await request<{url:string}>(http,token,'getWebhookInfo',{},AbortSignal.any([signal,AbortSignal.timeout(10_000)]));
    if(webhook?.url!=='')throw Error('telegram_pair_conflict');
    let offset:number|undefined;
    while(!signal.aborted){
      const updates=await request<Update[]>(http,token,'getUpdates',{offset,timeout:10,allowed_updates:['message']},
        AbortSignal.any([signal,AbortSignal.timeout(15_000)]));
      if(!Array.isArray(updates)||updates.some(update=>!positiveId(update?.update_id)||update.update_id>=Number.MAX_SAFE_INTEGER))
        throw Error('telegram_updates_invalid');
      for(const {update_id,message} of updates.sort((a,b)=>a.update_id-b.update_id)){
        if(message?.text===command&&message.chat?.type==='private'&&positiveId(message.chat.id)&&
          message.from?.id===message.chat.id&&message.from.is_bot===false&&
          message.message_thread_id===undefined&&!message.is_topic_message){
          const peer=username(message.from.username);
          return {account:{token,userId:message.from.id,chatId:message.chat.id},peer:peer?'@'+peer:String(message.from.id)};
        }
        offset=Math.max(offset??0,update_id+1);
      }
      await wait(250,undefined,{signal});
    }
    throw signal.reason;
  }catch(error){
    if(error instanceof TelegramRejected&&error.status===409)throw Error('telegram_pair_conflict');
    throw error;
  }
}

function parseTelegramAccounts(value:unknown):TelegramAccount[]{
  if(!Array.isArray(value))throw Error('telegram_config_invalid');
  const seen=new Set<string>();
  return value.map(bot=>{
    if(!bot||!positiveId(bot.userId)||!positiveId(bot.chatId))throw Error('telegram_config_invalid');
    let id:string;
    try{id=telegramBotId(bot.token);}catch{throw Error('telegram_config_invalid');}
    if(seen.has(id))throw Error('telegram_config_invalid');
    seen.add(id);
    return {token:bot.token,userId:bot.userId,chatId:bot.chatId};
  });
}

export class TelegramChannel implements ChannelAdapter {
  readonly id='telegram';
  readonly offlineReplayMs=24*60*60_000;
  private readonly bots=new Map<string,Bot>();
  private groups?:ReturnType<ChannelPlugin['telegramGroups']>;

  constructor(bots:unknown,private readonly http:typeof fetch,
    private readonly openUpstream?:(token:string,signal:AbortSignal)=>TelegramUpstream|Promise<TelegramUpstream|undefined>){
    for(const bot of parseTelegramAccounts(bots))this.bots.set(telegramBotId(bot.token),bot);
  }

  private health=new Map<string,ChannelHealth>();
  connectionState(accountKey:string):ChannelHealth{return this.health.get(accountKey)??'checking';}

  applyBindings(plugin:ChannelPlugin){
    plugin.configureBindings(this.id,Array.from(this.bots,([accountKey,{userId,chatId}])=>({
      adapterId:this.id,accountKey,senderKey:String(userId),conversationKey:String(chatId),
    })));
    if(this.bots.size)this.groups=plugin.telegramGroups();
  }

  accountLabel(accountKey:string):string|undefined {
    const username=this.bots.get(accountKey)?.username;
    if(username){
      const normalized=username.toLowerCase();
      const duplicate=[...this.bots].some(([id,bot])=>id!==accountKey&&bot.username?.toLowerCase()===normalized);
      if(!duplicate)return username;
    }
    if(positiveId(Number(accountKey))&&String(Number(accountKey))===accountKey)return accountKey;
  }

  private bot(address:Readonly<ChannelAddress>){
    const bot=this.bots.get(address.accountKey);
    if(address.adapterId===this.id&&bot&&address.senderKey===String(bot.userId)&&address.conversationKey===String(bot.chatId))return bot;
  }

  async connect(...[address,receive,signal,boundAt,bindingId]:Parameters<NonNullable<ChannelAdapter['connect']>>){
    const bot=this.bot(address);
    if(!bot)throw Error('telegram_binding_invalid');
    this.health.set(address.accountKey,'checking');
    const groups=bindingId&&this.groups||undefined;
    const recent=new Map<number,Map<number|null,TelegramContextMessage[]>>();
    let upstream:TelegramUpstream|undefined;
    if(groups&&this.openUpstream)try{upstream=await this.openUpstream(bot.token,signal);}
    catch{console.warn('telegram_mtproto_unavailable');}
    let offset:number|undefined,verified=false,caughtUp=!groups;
    try{
      while(!signal.aborted){
        try{
          if(!verified){
            const me=await verifyTelegramBot(bot.token,signal,this.http);
            if(signal.aborted)return;
            bot.username=username(me.label===me.id?undefined:me.label);
            verified=true;
          }
          if(signal.aborted)return;
          const polledAt=Date.now();
          const updates=await request<Update[]>(this.http,bot.token,'getUpdates',{offset,timeout:caughtUp?25:0,limit:100,
            allowed_updates:groups?['message','my_chat_member']:['message']},
            AbortSignal.any([signal,AbortSignal.timeout(caughtUp?35_000:10_000)]));
          if(!Array.isArray(updates)||updates.some(update=>!positiveId(update?.update_id)||update.update_id>=Number.MAX_SAFE_INTEGER))
            throw Error('telegram_updates_invalid');
          this.health.set(address.accountKey,'ready');
          if(groups&&bindingId){
            const full=updates.length===100;
            const expired=groups.polled(bindingId,full);
            if(expired)recent.clear();
            if(full||expired)caughtUp=false;
          }
          if(!updates.length)offset=undefined;
          for(const {update_id:id,message,my_chat_member:change} of updates.sort((a,b)=>a.update_id-b.update_id)){
            if(signal.aborted)return;
            if(message&&positiveId(message.message_id)&&positiveId(message.date)&&message.date*1000>=boundAt&&
              message.chat?.type==='private'&&message.chat.id===bot.chatId&&message.from?.is_bot===false&&message.from.id===bot.userId&&
              message.message_thread_id===undefined&&!message.is_topic_message&&typeof message.text==='string'&&message.text.trim()){
              try{receive({senderKey:address.senderKey,conversationKey:address.conversationKey,eventId:`${id}:${message.message_id}`,text:message.text});}
              catch(error){if(!(error instanceof Error)||error.message!=='channel_event_conflict')throw error;}
            }
            if(groups&&bindingId){
              if(change&&groupChat(change.chat)&&positiveId(change.date)&&change.date*1000>=boundAt&&
                String(change.new_chat_member?.user?.id)===address.accountKey){
                const wasMember=inGroup(change.old_chat_member),isMember=inGroup(change.new_chat_member);
                if(wasMember&&!isMember&&groups.membership(bindingId,change.chat.id,false,change.date,id))recent.delete(change.chat.id);
                if(!wasMember&&isMember){
                  const addedByOwner=change.from?.id===bot.userId&&change.from.is_bot===false;
                  if(groups.membership(bindingId,change.chat.id,addedByOwner,change.date,id))recent.delete(change.chat.id);
                }
              }
              if(message&&groupChat(message.chat)&&positiveId(message.message_id)&&
                positiveId(message.date)&&message.date*1000>=boundAt){
                const chatId=message.chat.id,thread=message.is_topic_message?message.message_thread_id:undefined;
                const topic=positiveId(thread)&&thread!==1?thread:null;
                const question=groupQuestion(message,bot.username,address.accountKey);
                const quote=question?contextMessage(message.reply_to_message):undefined;
                let background:(()=>Promise<readonly TelegramContextMessage[]>)|undefined=quote?.text?.trim()?async()=>[quote]:undefined;
                const read=upstream?.read;
                if(read&&groups.changeId(bindingId,chatId,message.date,id)!==undefined){
                  const current=contextMessage(message)!;
                  const topics=recent.get(chatId)??new Map<number|null,TelegramContextMessage[]>();
                  const window=topics.get(topic)??[];
                  if(question){
                    background=()=>{
                      const deadline=AbortSignal.any([signal,AbortSignal.timeout(6000)]);
                      return telegramReplyContext(window,current,quote,parent=>deadline.aborted
                        ?Promise.resolve(undefined):read(chatId,parent,deadline));
                    };
                  }
                  topics.set(topic,[...window.filter(entry=>entry.id!==current.id),current].sort((a,b)=>a.id-b.id).slice(-10));
                  recent.set(chatId,topics);
                }
                if(question){
                  try{groups.submit(bindingId,chatId,message.date,id,message.message_id,topic,question,background);}
                  catch(error){if(!(error instanceof Error)||error.message!=='channel_event_conflict')throw error;}
                }
              }
            }
            offset=Math.max(offset??0,id+1);
          }
          if(groups&&bindingId&&updates.length<100){
            groups.caughtUp(bindingId,polledAt);
            caughtUp=true;
          }
        }catch(error){
          if(signal.aborted)return;
          if(groups&&bindingId){
            caughtUp=false;
            groups.disconnected(bindingId);
          }
          const rejected=error instanceof TelegramRejected?error.status:undefined;
          const invalid=[401,403,404].includes(rejected??0)||error instanceof Error&&error.message==='telegram_bot_identity_invalid';
          this.health.set(address.accountKey,invalid?'reauthorize':'offline');
          if(invalid||rejected===409)throw error;
          const seconds=error instanceof TelegramRejected?error.retryAfter:5;
          await wait(Math.min(seconds,3600)*1000,undefined,{signal}).catch(()=>{});
        }
      }
    }finally{await upstream?.close();}
  }

  async send({address,part,telegramGroup,telegramReply}:ChannelPacket,signal:AbortSignal):ReturnType<ChannelAdapter['send']>{
    const bot=this.bot(address);
    if(!bot||signal.aborted)return {state:'failed'};
    const chat_id=telegramGroup?String(telegramGroup.chatId):address.conversationKey;
    const destination={chat_id,...(telegramGroup?.topicId?{message_thread_id:telegramGroup.topicId}:{}),
      ...(telegramGroup&&telegramReply!==false?{reply_parameters:{message_id:telegramGroup.messageId}}:{})};
    let body:object,method='sendMessage';
    if(part.kind==='text'&&part.text.length<=4096){
      body={...destination,text:part.text,link_preview_options:{is_disabled:true}};
    }else{
      // One network effect per outbox part, even for text above Telegram's limit.
      const bytes=part.kind==='attachment'?Buffer.from(part.data,'base64'):Buffer.from(part.text);
      if(!bytes.length||bytes.length>50_000_000)return {state:'failed'};
      method='sendDocument';
      const form=new FormData();
      for(const [key,value] of Object.entries(destination))form.set(key,typeof value==='object'?JSON.stringify(value):String(value));
      form.set('document',new Blob([new Uint8Array(bytes)],{type:part.kind==='attachment'?part.mime:'text/plain'}),
        part.kind==='attachment'?part.filename:'homer-reply.txt');
      body=form;
    }
    try{
      const sent=await request<Message>(this.http,bot.token,method,body,signal);
      return positiveId(sent?.message_id)&&String(sent.chat?.id)===chat_id&&String(sent.from?.id)===address.accountKey
        ?{state:'sent',receipt:String(sent.message_id)}:{state:'unknown'};
    }catch(error){return {state:error instanceof TelegramRejected?'failed':'unknown'};}
  }
}

function readTelegramConfig(runtime:string,file:string):unknown{
  const path=join(runtime,file);
  const original=lstatSync(path,{throwIfNoEntry:false});
  if(!original)return;
  if(!original.isFile())throw Error('telegram_config_permissions');
  let fd:number;
  try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch{throw Error('telegram_config_unreadable');}
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||stat.ino!==original.ino||stat.dev!==original.dev)
      throw Error('telegram_config_permissions');
    if(process.platform==='win32'){
      try{assertWindowsPrivate(path);}catch{throw Error('telegram_config_permissions');}
      const current=lstatSync(path);
      if(!current.isFile()||stat.ino!==current.ino||stat.dev!==current.dev)throw Error('telegram_config_permissions');
    }else if((stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw Error('telegram_config_permissions');
    const bytes=Buffer.alloc(maxConfigBytes+1);
    let size=0;
    while(size<bytes.length){
      const count=readSync(fd,bytes,size,bytes.length-size,null);
      if(!count)break;
      size+=count;
    }
    if(size===bytes.length)throw Error('telegram_config_invalid');
    try{return JSON.parse(bytes.toString('utf8',0,size));}catch{throw Error('telegram_config_invalid');}
  }finally{closeSync(fd);}
}

export function readTelegramAccounts(runtime:string):TelegramAccount[]{
  const value=readTelegramConfig(runtime,'telegram.json');
  return value===undefined?[]:parseTelegramAccounts(value);
}

function readTelegramCredentials(runtime:string):TelegramApiCredentials|undefined{
  const value=readTelegramConfig(runtime,'telegram-mtproto.json');
  if(value===undefined)return;
  const {api_id,api_hash}=(value??{}) as Partial<TelegramApiCredentials>;
  if(!positiveId(api_id)||api_id>0x7fffffff||typeof api_hash!=='string'||!/^[a-f0-9]{32}$/i.test(api_hash))
    throw Error('telegram_mtproto_config_invalid');
  return {api_id,api_hash};
}

export function writeTelegramAccounts(runtime:string,accounts:readonly TelegramAccount[]){
  writeChannelConfig(runtime,'telegram.json',parseTelegramAccounts(accounts),maxConfigBytes);
}

export function telegramChannel(runtime:string,http?:typeof fetch){
  const accounts=readTelegramAccounts(runtime);
  let credentials:TelegramApiCredentials|undefined;
  if(accounts.length)try{credentials=readTelegramCredentials(runtime);}
  catch{console.warn('telegram_mtproto_config_unavailable');}
  const mtproto=credentials;
  return accounts.length||existsSync(join(runtime,'telegram.json'))||existsSync(join(runtime,'channels.sqlite'))
    ?new TelegramChannel(accounts,http??(accounts.length?network():fetch),mtproto?async(token,signal)=>{
      const {connectTelegramUpstream}=await import('./telegram-mtproto.js');
      if(!signal.aborted)return connectTelegramUpstream(mtproto,token,signal);
    }:undefined):undefined;
}
