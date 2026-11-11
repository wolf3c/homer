import {randomBytes} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import WebSocket from 'ws';
import {assertWindowsPrivate} from '../scripts/windows-security.mjs';
import {writeChannelConfig} from './channel-config.js';
import type {ChannelAdapter,ChannelAddress,ChannelHealth,ChannelPacket,ChannelPlugin} from './channel-plugin.js';

export type DingtalkCredentials={appKey:string;appSecret:string};
export type DingtalkAccount=DingtalkCredentials & {accountKey:string;corpId:string;userId:string;conversationId:string};
type DirectMessage=Pick<DingtalkAccount,'corpId'|'userId'|'conversationId'> & {eventId:string;text:string;createdAt:number};
type Socket=(url:URL)=>WebSocket;
type Token={value:string;expiresAt:number};

const configName='dingtalk.json';
const configLimit=256*1024;
const fileLimit=20_000_000;
const topic='/v1.0/im/bot/messages/get';
const api='https://api.dingtalk.com';
const legacy='https://oapi.dingtalk.com';
const accountKeyPattern=/^dt-[A-Za-z0-9_-]{22}$/;
const validKey=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\s\p{Cc}\p{Cf}]/u.test(value);
const accountKey=(value:unknown):value is string=>typeof value==='string'&&accountKeyPattern.test(value);

export function dingtalkCredentials(value:unknown):DingtalkCredentials{
  const {appKey,appSecret}=(value??{}) as Partial<DingtalkCredentials>;
  if(typeof appKey!=='string'||!/^ding[A-Za-z0-9_-]{8,100}$/.test(appKey)||
    typeof appSecret!=='string'||!/^[A-Za-z0-9_+/=-]{12,200}$/.test(appSecret))throw Error('dingtalk_credentials_invalid');
  return {appKey,appSecret};
}

function checkedAccounts(value:unknown):DingtalkAccount[]{
  if(!Array.isArray(value))throw Error('dingtalk_config_invalid');
  const accounts=value.map(row=>{
    const credentials=dingtalkCredentials(row);
    const {accountKey:key,corpId,userId,conversationId}=row;
    if(!accountKey(key)||![corpId,userId,conversationId].every(value=>validKey(value)))throw Error('dingtalk_config_invalid');
    return {...credentials,accountKey:key,corpId,userId,conversationId};
  });
  if(new Set(accounts.map(a=>a.accountKey)).size!==accounts.length||
    new Set(accounts.map(a=>a.appKey)).size!==accounts.length)throw Error('dingtalk_config_invalid');
  return accounts;
}

export function readDingtalkAccounts(runtime:string):DingtalkAccount[]{
  const path=join(runtime,configName),original=lstatSync(path,{throwIfNoEntry:false});
  if(!original)return [];
  if(!original.isFile())throw Error('dingtalk_config_permissions');
  let fd:number;
  try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch{throw Error('dingtalk_config_unreadable');}
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||stat.ino!==original.ino||stat.dev!==original.dev)throw Error('dingtalk_config_permissions');
    if(process.platform==='win32'){
      try{assertWindowsPrivate(path);}catch{throw Error('dingtalk_config_permissions');}
      const current=lstatSync(path);
      if(!current.isFile()||stat.ino!==current.ino||stat.dev!==current.dev)throw Error('dingtalk_config_permissions');
    }else if((stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.())throw Error('dingtalk_config_permissions');
    const bytes=Buffer.alloc(configLimit+1);
    let size=0;
    while(size<bytes.length){
      const count=readSync(fd,bytes,size,bytes.length-size,null);
      if(!count)break;
      size+=count;
    }
    if(size>configLimit)throw Error('dingtalk_config_invalid');
    try{return checkedAccounts(JSON.parse(bytes.toString('utf8',0,size)));}catch{throw Error('dingtalk_config_invalid');}
  }finally{closeSync(fd);}
}

export function writeDingtalkAccounts(runtime:string,accounts:readonly DingtalkAccount[]){
  writeChannelConfig(runtime,configName,checkedAccounts(accounts),configLimit);
}

class DingtalkRejected extends Error{
  constructor(readonly status:number,readonly code:unknown){super('dingtalk_api_rejected');}
  get credentialsInvalid(){
    return ['invalidClientIdOrSecret','invalidAppKey','invalidAppSecret','invalidClientId','invalidClientSecret',
      'invalidParameter.appKey','invalidParameter.appSecret','invalidParameter.clientId','invalidParameter.clientSecret',33001,33002].includes(this.code as string|number);
  }
}

async function request(http:typeof fetch,url:string|URL,signal:AbortSignal,init:RequestInit={}){
  signal.throwIfAborted();
  const response=await http(url,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15_000)])});
  if(response.status>=500||response.status===408)throw Error('dingtalk_response_unknown');
  const body=await response.json().catch(()=>undefined);
  if(!response.ok||(body?.errcode!==undefined&&body.errcode!==0))throw new DingtalkRejected(response.status,body?.code??body?.errcode);
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('dingtalk_response_invalid');
  return body;
}

function post(http:typeof fetch,url:string,signal:AbortSignal,payload:object,token?:string){
  return request(http,url,signal,{method:'POST',headers:{'content-type':'application/json',
    ...(token?{'x-acs-dingtalk-access-token':token}:{})},body:JSON.stringify(payload)});
}

async function accessToken(credentials:DingtalkCredentials,signal:AbortSignal,http:typeof fetch,old=false):Promise<Token>{
  const {appKey,appSecret}=credentials;
  const url=new URL('/gettoken',legacy);
  url.search=new URLSearchParams({appkey:appKey,appsecret:appSecret}).toString();
  const body=old?await request(http,url,signal):await post(http,api+'/v1.0/oauth2/accessToken',signal,{appKey,appSecret});
  const value=old?body.access_token:body.accessToken;
  const seconds=old?body.expires_in:body.expireIn;
  if(!validKey(value,8192))throw Error('dingtalk_response_invalid');
  return {value,expiresAt:Date.now()+Math.max(0,(Number.isFinite(seconds)?seconds:0)-60)*1000};
}

export async function verifyDingtalkCredentials(credentials:DingtalkCredentials,signal:AbortSignal,http:typeof fetch=fetch){
  try{await accessToken(credentials,signal,http);}
  catch(error){if(error instanceof DingtalkRejected&&error.credentialsInvalid)throw Error('dingtalk_credentials_invalid');throw error;}
}

function directMessage(value:unknown,appKey:string):DirectMessage|undefined{
  if(!value||typeof value!=='object')return;
  const msg=value as Record<string,unknown>;
  const {senderCorpId:corpId,senderStaffId:userId,conversationId,msgId:eventId,createAt:createdAt}=msg;
  const text=(msg.text as {content?:unknown}|undefined)?.content;
  if(String(msg.conversationType)!=='1'||msg.msgtype!=='text'||msg.robotCode!==appKey||
    !validKey(corpId)||corpId!==msg.chatbotCorpId||!validKey(userId)||!validKey(conversationId)||!validKey(eventId)||
    typeof createdAt!=='number'||!Number.isSafeInteger(createdAt)||createdAt<=0||
    typeof text!=='string'||!text.trim()||text.length>16_000)return;
  return {corpId,userId,conversationId,eventId,text,createdAt};
}

const socketOptions={handshakeTimeout:15_000,closeTimeout:1_000,maxPayload:256*1024,perMessageDeflate:false};
const openSocket:Socket=url=>new WebSocket(url,socketOptions);

async function stream(credentials:DingtalkCredentials,signal:AbortSignal,http:typeof fetch,socket:Socket,
  ready:()=>void,receive:(message:DirectMessage)=>boolean|void){
  const {appKey:clientId,appSecret:clientSecret}=credentials;
  const gateway=await post(http,api+'/v1.0/gateway/connections/open',signal,{
    clientId,clientSecret,ua:'homer-dingtalk/1',subscriptions:[{type:'CALLBACK',topic}],
  });
  if(!validKey(gateway.endpoint,2048)||!validKey(gateway.ticket,4096))throw Error('dingtalk_stream_invalid');
  const url=new URL(gateway.endpoint);
  if(url.protocol!=='wss:'||url.username||url.password||url.port||
    (url.hostname!=='dingtalk.com'&&!url.hostname.endsWith('.dingtalk.com')))throw Error('dingtalk_stream_invalid');
  url.searchParams.set('ticket',gateway.ticket);
  signal.throwIfAborted();
  const ws=socket(url);
  await new Promise<void>((resolve,reject)=>{
    let finished=false,pong:ReturnType<typeof setTimeout>|undefined,heartbeat:ReturnType<typeof setInterval>|undefined;
    let failure:unknown;
    const stop=()=>ws.terminate();
    const clearPong=()=>{clearTimeout(pong);pong=undefined;};
    signal.addEventListener('abort',stop,{once:true});
    ws.on('error',()=>{failure??=Error('dingtalk_stream_offline');stop();});
    ws.once('close',()=>{
      signal.removeEventListener('abort',stop);
      clearInterval(heartbeat);
      clearPong();
      if(signal.aborted)reject(signal.reason);
      else if(finished&&!failure)resolve();
      else reject(failure??Error('dingtalk_stream_disconnected'));
    });
    ws.once('open',()=>{
      ready();
      heartbeat=setInterval(()=>{
        if(finished||ws.readyState!==WebSocket.OPEN)return;
        ws.ping();
        pong=setTimeout(stop,5_000);
      },120_000);
    });
    ws.on('pong',clearPong);
    ws.on('message',(raw,binary)=>{
      if(binary||finished||signal.aborted||ws.readyState!==WebSocket.OPEN)return;
      try{
        const frame=JSON.parse(raw.toString());
        const messageId=frame?.headers?.messageId;
        const subject=frame?.headers?.topic;
        if(frame?.type==='SYSTEM'&&subject==='disconnect'){
          failure=Error(typeof frame.data==='string'&&/conflict/i.test(frame.data)?'dingtalk_stream_conflict':'dingtalk_stream_disconnected');
          stop();
          return;
        }
        if(!validKey(messageId))return;
        const ping=frame?.type==='SYSTEM'&&subject==='ping';
        if(!ping&&(frame?.type!=='CALLBACK'||subject!==topic))return;
        if(!ping&&typeof frame.data==='string'){
          let value:unknown;
          try{value=JSON.parse(frame.data);}catch{/* Ignore malformed callback data. */}
          const message=directMessage(value,clientId);
          if(message)finished=receive(message)===true;
        }
        // A verified callback is acknowledged only after the plugin accepts it durably.
        const paired=finished;
        ws.send(JSON.stringify({code:200,headers:{messageId,contentType:'application/json'},message:'ok',
          data:ping?frame.data:'{"success":true}'}),error=>{
          if(error){failure=Error('dingtalk_stream_offline');stop();}
          else if(paired)ws.close();
        });
      }catch(error){failure=error;stop();}
    });
  });
}

export async function pairDingtalkBot(credentials:DingtalkCredentials,command:string,signal:AbortSignal,
  ready:()=>void,http:typeof fetch=fetch,socket:Socket=openSocket):Promise<DingtalkAccount>{
  let peer:Pick<DingtalkAccount,'corpId'|'userId'|'conversationId'>|undefined;
  await stream(credentials,signal,http,socket,ready,message=>{
    if(message.text.trim()!==command)return;
    const {corpId,userId,conversationId}=message;
    peer={corpId,userId,conversationId};
    return true;
  });
  signal.throwIfAborted();
  if(!peer)throw Error('dingtalk_stream_disconnected');
  return {...credentials,...peer,accountKey:'dt-'+randomBytes(16).toString('base64url')};
}

export class DingtalkChannel implements ChannelAdapter{
  readonly id='dingtalk';
  private accounts=new Map<string,DingtalkAccount>();
  private readonly health=new Map<string,ChannelHealth>();
  private readonly tokens=new Map<string,Token>();
  constructor(private runtime:string,private http:typeof fetch=fetch,private socket:Socket=openSocket){}
  accountLabel(key:string){return accountKey(key)?key:undefined;}
  connectionState(key:string):ChannelHealth{return this.health.get(key)??'checking';}

  applyBindings(plugin:ChannelPlugin){
    // Hosts apply bindings after acquiring the runtime lock.
    this.accounts=new Map(readDingtalkAccounts(this.runtime).map(account=>[account.accountKey,account]));
    plugin.configureBindings(this.id,[...this.accounts.values()].map(({accountKey,userId,conversationId})=>({
      adapterId:this.id,accountKey,senderKey:userId,conversationKey:conversationId,
    })));
  }

  private account(address:Readonly<ChannelAddress>){
    const account=this.accounts.get(address.accountKey);
    return address.adapterId===this.id&&account?.userId===address.senderKey&&account.conversationId===address.conversationKey?account:undefined;
  }

  async connect(...[address,receive,signal,boundAt]:Parameters<NonNullable<ChannelAdapter['connect']>>){
    const account=this.account(address);
    if(!account)return;
    let retry=1000;
    while(!signal.aborted){
      let readyAt=0;
      try{
        await stream(account,signal,this.http,this.socket,()=>{
          this.health.set(account.accountKey,'ready');
          readyAt=Date.now();
        },message=>{
          if(message.corpId===account.corpId&&message.userId===account.userId&&
            message.conversationId===account.conversationId&&message.createdAt>=boundAt){
            const {eventId,text}=message;
            receive({eventId,text,senderKey:account.userId,conversationKey:account.conversationId});
          }
        });
      }catch(error){
        if(signal.aborted)return;
        if(error instanceof DingtalkRejected&&error.credentialsInvalid){this.health.set(account.accountKey,'reauthorize');return;}
        this.health.set(account.accountKey,'offline');
        if((error instanceof DingtalkRejected&&error.status===409)||(error instanceof Error&&error.message==='dingtalk_stream_conflict'))return;
        if(readyAt&&Date.now()-readyAt>=30_000)retry=1000;
        await wait(retry+Math.random()*250,undefined,{signal}).catch(()=>{});
        retry=Math.min(retry*2,30_000);
      }
    }
  }

  private async token(account:DingtalkAccount,signal:AbortSignal,legacyToken=false){
    const key=account.accountKey+(legacyToken?':legacy':'');
    const cached=this.tokens.get(key);
    if(cached&&cached.expiresAt>Date.now())return cached.value;
    const token=await accessToken(account,signal,this.http,legacyToken);
    this.tokens.set(key,token);
    return token.value;
  }

  async send({address,part}:ChannelPacket,signal:AbortSignal):ReturnType<ChannelAdapter['send']>{
    const account=this.account(address);
    if(!account||signal.aborted)return {state:'failed'};
    let dispatch=false;
    try{
      let msgKey='sampleText',params:object;
      if(part.kind==='text'&&Buffer.byteLength(part.text)<=2048)params={content:part.text};
      else{
        const bytes=part.kind==='attachment'?Buffer.from(part.data,'base64'):Buffer.from(part.text);
        if(!bytes.length||bytes.length>fileLimit)return {state:'failed'};
        const fileName=part.kind==='attachment'?part.filename:'homer-reply.txt';
        const fileType=/\.([a-z0-9]{1,16})$/i.exec(fileName)?.[1]?.toLowerCase()??'bin';
        const url=new URL('/media/upload',legacy);
        url.search=new URLSearchParams({access_token:await this.token(account,signal,true),type:'file'}).toString();
        const form=new FormData();
        form.set('media',new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'}),fileName);
        const uploaded=await request(this.http,url,signal,{method:'POST',body:form});
        if(uploaded.errcode!==0||!validKey(uploaded.media_id,1024))return {state:'failed'};
        msgKey='sampleFile';
        params={mediaId:uploaded.media_id,fileName,fileType};
      }
      const token=await this.token(account,signal);
      signal.throwIfAborted();
      dispatch=true;
      const result=await post(this.http,api+'/v1.0/robot/oToMessages/batchSend',signal,{
        robotCode:account.appKey,userIds:[account.userId],msgKey,msgParam:JSON.stringify(params),
      },token);
      const {invalidStaffIdList,flowControlledStaffIdList,processQueryKey}=result;
      for(const list of [invalidStaffIdList,flowControlledStaffIdList]){
        if(Array.isArray(list)&&list.includes(account.userId))return {state:'failed'};
      }
      if(result.code!==undefined||[invalidStaffIdList,flowControlledStaffIdList].some(list=>list!==undefined&&(!Array.isArray(list)||list.length))||
        !validKey(processQueryKey))return {state:'unknown'};
      return {state:'sent',receipt:processQueryKey};
    }catch(error){
      if(error instanceof DingtalkRejected){
        if(error.credentialsInvalid)this.health.set(account.accountKey,'reauthorize');
        if(error.status===401||error.code==='InvalidAuthentication')this.tokens.delete(account.accountKey);
      }
      return {state:!dispatch||error instanceof DingtalkRejected?'failed':'unknown'};
    }
  }
}

export function dingtalkChannel(runtime:string){
  return lstatSync(join(runtime,configName),{throwIfNoEntry:false})||existsSync(join(runtime,'channels.sqlite'))
    ?new DingtalkChannel(runtime):undefined;
}
