import {closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {EnvHttpProxyAgent} from 'undici';
import {assertWindowsPrivate} from '../scripts/windows-security.mjs';
import {codexProxyEnvironment} from './engine.js';
import {writeChannelConfig} from './channel-config.js';
import type {ChannelAdapter, ChannelAddress, ChannelHealth, ChannelPacket, ChannelPlugin} from './channel-plugin.js';

const tokenPattern=/^[1-9]\d{0,15}:[A-Za-z0-9_-]{10,128}$/;
const positiveId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
export type TelegramAccount={token:string;userId:number;chatId:number};
type Bot=TelegramAccount & {username?:string};
const maxConfigBytes=32*1024;
type Message={message_id?:number;date?:number;text?:string;message_thread_id?:number;is_topic_message?:boolean;
  chat?:{id:number;type:string};from?:{id:number;is_bot:boolean;username?:string}};
type Update={update_id:number;message?:Message};

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
  private readonly bots=new Map<string,Bot>();

  constructor(bots:unknown,private readonly http:typeof fetch){
    for(const bot of parseTelegramAccounts(bots))this.bots.set(telegramBotId(bot.token),bot);
  }

  private health=new Map<string,ChannelHealth>();
  connectionState(accountKey:string):ChannelHealth{return this.health.get(accountKey)??'checking';}

  applyBindings(plugin:ChannelPlugin){
    plugin.configureBindings(this.id,Array.from(this.bots,([accountKey,{userId,chatId}])=>({
      adapterId:this.id,accountKey,senderKey:String(userId),conversationKey:String(chatId),
    })));
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

  async connect(...[address,receive,signal,boundAt]:Parameters<NonNullable<ChannelAdapter['connect']>>){
    const bot=this.bot(address);
    if(!bot)throw Error('telegram_binding_invalid');
    let offset:number|undefined,verified=false;
    while(!signal.aborted){
      try{
        if(!verified){
          const me=await verifyTelegramBot(bot.token,signal,this.http);
          if(signal.aborted)return;
          bot.username=username(me.label===me.id?undefined:me.label);
          verified=true;
        }
        if(signal.aborted)return;
        const updates=await request<Update[]>(this.http,bot.token,'getUpdates',{offset,timeout:25,allowed_updates:['message']},
          AbortSignal.any([signal,AbortSignal.timeout(35_000)]));
        if(!Array.isArray(updates)||updates.some(update=>!positiveId(update?.update_id)||update.update_id>=Number.MAX_SAFE_INTEGER))
          throw Error('telegram_updates_invalid');
        this.health.set(address.accountKey,'ready');
        if(!updates.length)offset=undefined;
        for(const {update_id:id,message} of updates.sort((a,b)=>a.update_id-b.update_id)){
          if(signal.aborted)return;
          if(message&&positiveId(message.message_id)&&positiveId(message.date)&&message.date*1000>=boundAt&&
            message.chat?.type==='private'&&message.chat.id===bot.chatId&&message.from?.is_bot===false&&message.from.id===bot.userId&&
            message.message_thread_id===undefined&&!message.is_topic_message&&typeof message.text==='string'&&message.text.trim()){
            try{receive({senderKey:address.senderKey,conversationKey:address.conversationKey,eventId:`${id}:${message.message_id}`,text:message.text});}
            catch(error){if(!(error instanceof Error)||error.message!=='channel_event_conflict')throw error;}
          }
          offset=Math.max(offset??0,id+1);
        }
      }catch(error){
        if(signal.aborted)return;
        const rejected=error instanceof TelegramRejected?error.status:undefined;
        const invalid=[401,403,404].includes(rejected??0)||error instanceof Error&&error.message==='telegram_bot_identity_invalid';
        this.health.set(address.accountKey,invalid?'reauthorize':'offline');
        if(invalid||rejected===409)throw error;
        const seconds=error instanceof TelegramRejected?error.retryAfter:5;
        await wait(Math.min(seconds,3600)*1000,undefined,{signal}).catch(()=>{});
      }
    }
  }

  async send({address,part}:ChannelPacket,signal:AbortSignal):ReturnType<ChannelAdapter['send']>{
    const bot=this.bot(address);
    if(!bot||signal.aborted)return {state:'failed'};
    const chat_id=address.conversationKey;
    let body:object,method='sendMessage';
    if(part.kind==='text'&&part.text.length<=4096){
      body={chat_id,text:part.text,link_preview_options:{is_disabled:true}};
    }else{
      // One network effect per outbox part, even for text above Telegram's limit.
      const bytes=part.kind==='attachment'?Buffer.from(part.data,'base64'):Buffer.from(part.text);
      if(!bytes.length||bytes.length>50_000_000)return {state:'failed'};
      method='sendDocument';
      const form=new FormData();
      form.set('chat_id',chat_id);
      form.set('document',new Blob([new Uint8Array(bytes)],{type:part.kind==='attachment'?part.mime:'text/plain'}),
        part.kind==='attachment'?part.filename:'homer-reply.txt');
      body=form;
    }
    try{
      const sent=await request<Message>(this.http,bot.token,method,body,signal);
      return positiveId(sent?.message_id)&&sent.chat?.id===bot.chatId&&String(sent.from?.id)===address.accountKey
        ?{state:'sent',receipt:String(sent.message_id)}:{state:'unknown'};
    }catch(error){return {state:error instanceof TelegramRejected?'failed':'unknown'};}
  }
}

export function readTelegramAccounts(runtime:string):TelegramAccount[]{
  const path=join(runtime,'telegram.json');
  const original=lstatSync(path,{throwIfNoEntry:false});
  if(!original)return [];
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
    let value:unknown;
    try{value=JSON.parse(bytes.toString('utf8',0,size));}catch{throw Error('telegram_config_invalid');}
    return parseTelegramAccounts(value);
  }finally{closeSync(fd);}
}


export function writeTelegramAccounts(runtime:string,accounts:readonly TelegramAccount[]){
  writeChannelConfig(runtime,'telegram.json',parseTelegramAccounts(accounts),maxConfigBytes);
}

export function telegramChannel(runtime:string,http?:typeof fetch){
  const accounts=readTelegramAccounts(runtime);
  return accounts.length||existsSync(join(runtime,'telegram.json'))||existsSync(join(runtime,'channels.sqlite'))
    ?new TelegramChannel(accounts,http??(accounts.length?network():fetch)):undefined;
}
