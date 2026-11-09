import {randomBytes} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as wait} from 'node:timers/promises';
import {assertWindowsPrivate} from '../scripts/windows-security.mjs';
import type {ChannelAdapter,ChannelAddress,ChannelHealth,ChannelPacket,ChannelPlugin} from './channel-plugin.js';
import {writeChannelConfig} from './channel-config.js';
import {MEDIA_POLICY} from './media-policy.js';
import {WechatIlink,WechatRejected,wechatCredential,wechatMessageId,wechatSessionExpired,wechatValue,type WechatCredential} from './wechat-ilink.js';
export {authorizeWechat} from './wechat-ilink.js';

export type WechatAccount=WechatCredential & {accountKey:string;cursor:string;contextToken?:string;contextTime?:number};
const maxConfigBytes=256*1024;
const accountKeyPattern=/^wx-[a-zA-Z0-9_-]{22}$/;
const validAccountKey=(value:unknown):value is string=>typeof value==='string'&&accountKeyPattern.test(value);
const validCursor=(value:unknown):value is string=>value===''||wechatValue(value,16384);
const configFile=(runtime:string)=>join(runtime,'wechat.json');

function assertPrivate(path:string,stat:ReturnType<typeof fstatSync>){
  if(!stat.isFile()||stat.nlink!==1)throw Error('wechat_config_permissions');
  if(process.platform==='win32'){
    try{assertWindowsPrivate(path);}catch{throw Error('wechat_config_permissions');}
    const current=lstatSync(path);
    if(!current.isFile()||stat.ino!==current.ino||stat.dev!==current.dev)throw Error('wechat_config_permissions');
  }else if((Number(stat.mode)&0o777)!==0o600||stat.uid!==process.getuid?.())throw Error('wechat_config_permissions');
}

export function readWechatAccounts(runtime:string):WechatAccount[]{
  const path=configFile(runtime),original=lstatSync(path,{throwIfNoEntry:false});
  if(!original)return [];
  if(!original.isFile())throw Error('wechat_config_permissions');
  let fd:number;
  try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch{throw Error('wechat_config_unreadable');}
  try{
    const stat=fstatSync(fd);
    if(stat.ino!==original.ino||stat.dev!==original.dev)throw Error('wechat_config_permissions');
    assertPrivate(path,stat);
    const bytes=Buffer.alloc(maxConfigBytes+1);
    let size=0;
    while(size<bytes.length){
      const count=readSync(fd,bytes,size,bytes.length-size,null);
      if(!count)break;
      size+=count;
    }
    if(size>maxConfigBytes)throw Error('wechat_config_invalid');
    let values:unknown;
    try{values=JSON.parse(bytes.toString('utf8',0,size));}catch{throw Error('wechat_config_invalid');}
    if(!Array.isArray(values))throw Error('wechat_config_invalid');
    const accounts=values.map((value):WechatAccount=>{
      const credential=wechatCredential(value);
      const {accountKey,cursor,contextToken,contextTime}=value;
      if(!validAccountKey(accountKey)||!validCursor(cursor)||
        (contextToken!==undefined&&!wechatValue(contextToken,8192))||
        (contextTime!==undefined&&(!Number.isSafeInteger(contextTime)||contextTime<=0||contextToken===undefined)))
        throw Error('wechat_config_invalid');
      return {...credential,accountKey,cursor,contextToken,contextTime};
    });
    if(['botId','ownerId','accountKey'].some(key=>new Set(accounts.map(a=>a[key as 'botId'|'ownerId'|'accountKey'])).size!==accounts.length))
      throw Error('wechat_config_invalid');
    return accounts;
  }finally{closeSync(fd);}
}

// Management and the live adapter share the existing Homer runtime lock.
export function writeWechatAccounts(runtime:string,accounts:readonly WechatAccount[]){
  writeChannelConfig(runtime,'wechat.json',accounts,maxConfigBytes);
}

export function prepareWechatAccount(credential:WechatCredential,prior?:WechatAccount):WechatAccount{
  const checked=wechatCredential(credential);
  if(prior&&(prior.botId!==checked.botId||prior.ownerId!==checked.ownerId))throw Error('wechat_unbind_before_replacing_account');
  return {...checked,accountKey:prior?.accountKey??'wx-'+randomBytes(16).toString('base64url'),
    cursor:prior?.baseUrl===checked.baseUrl?prior.cursor:''};
}

export function bindWechat(runtime:string,credential:WechatCredential){
  const checked=wechatCredential(credential),accounts=readWechatAccounts(runtime);
  const prior=accounts.find(a=>a.botId===checked.botId||a.ownerId===checked.ownerId);
  const account=prepareWechatAccount(checked,prior);
  writeWechatAccounts(runtime,prior?accounts.map(a=>a===prior?account:a):[...accounts,account]);
  return account.accountKey;
}
export function unbindWechat(runtime:string,accountKey:string){
  const accounts=readWechatAccounts(runtime),next=accounts.filter(a=>a.accountKey!==accountKey);
  if(next.length===accounts.length)throw Error('wechat_account_not_found');
  writeWechatAccounts(runtime,next);
}
export function wechatStatus(runtime:string){
  const accounts=readWechatAccounts(runtime);
  const result=new Map(accounts.map(({accountKey})=>[accountKey,{accountKey,failed:0,unknown:0}]));
  const file=join(runtime,'channels.sqlite');
  if(!result.size||!existsSync(file))return [...result.values()];
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const counts=db.prepare(`SELECT b.accountKey,o.state,COUNT(*) AS total FROM channel_outbox o JOIN channel_bindings b ON o.bindingId=b.id
      WHERE b.adapterId='wechat' AND o.state IN ('failed','unknown') GROUP BY b.accountKey,o.state`).all();
    for(const {accountKey,state,total} of counts){
      const item=result.get(String(accountKey));
      if(item&&(state==='failed'||state==='unknown'))item[state]=Number(total);
    }
  }finally{db.close();}
  return [...result.values()];
}

function inbound(value:unknown,account:WechatAccount,boundAt:number){
  if(!value||typeof value!=='object')return;
  const msg=value as Record<string,unknown>;
  if(msg.message_type!==1||msg.group_id||msg.from_user_id!==account.ownerId||
    (msg.to_user_id!==undefined&&msg.to_user_id!==''&&msg.to_user_id!==account.botId)||
    !wechatMessageId(msg.message_id)||!wechatValue(msg.context_token,8192)||
    typeof msg.create_time_ms!=='number'||!Number.isSafeInteger(msg.create_time_ms)||msg.create_time_ms<boundAt||
    !Array.isArray(msg.item_list)||!msg.item_list.length||
    !msg.item_list.every(item=>item?.type===1&&typeof item.text_item?.text==='string'))return;
  const text=msg.item_list.map(item=>item.text_item.text).join('\n');
  if(!text.trim()||text.length>16000)return;
  return {eventId:msg.message_id,text,contextToken:msg.context_token,time:msg.create_time_ms};
}

export class WechatChannel implements ChannelAdapter{
  readonly id='wechat';
  private accounts:WechatAccount[]=[];
  private health=new Map<string,ChannelHealth>();
  private api:WechatIlink;
  constructor(private runtime:string,http:typeof fetch=fetch){this.api=new WechatIlink(http);}
  accountLabel(accountKey:string){return validAccountKey(accountKey)?accountKey:undefined;}

  connectionState(accountKey:string):ChannelHealth {
    const health=this.health.get(accountKey)??'checking';
    if(health!=='ready')return health;
    return this.accounts.find(account=>account.accountKey===accountKey)?.contextToken?'ready':'setup';
  }

  applyBindings(plugin:ChannelPlugin){
    this.accounts=readWechatAccounts(this.runtime);
    plugin.configureBindings(this.id,this.accounts.map(({accountKey,ownerId})=>({
      adapterId:this.id,accountKey,senderKey:ownerId,conversationKey:ownerId
    })));
  }

  private account(address:Readonly<ChannelAddress>){
    return address.adapterId===this.id&&address.conversationKey===address.senderKey
      ?this.accounts.find(a=>a.accountKey===address.accountKey&&a.ownerId===address.senderKey):undefined;
  }
  private persist(account:WechatAccount,change:Partial<Pick<WechatAccount,'cursor'|'contextToken'|'contextTime'>>){
    writeWechatAccounts(this.runtime,this.accounts.map(a=>a===account?{...a,...change}:a));
    Object.assign(account,change);
  }

  async connect(...[address,receive,signal,boundAt]:Parameters<NonNullable<ChannelAdapter['connect']>>){
    const account=this.account(address);
    if(!account)throw Error('wechat_binding_invalid');
    while(!signal.aborted&&this.health.get(account.accountKey)!=='reauthorize'){
      try{
        const result=await this.api.request(account.baseUrl,'getupdates',{get_updates_buf:account.cursor},account,signal,45_000);
        if(signal.aborted||this.health.get(account.accountKey)==='reauthorize')return;
        if((result.msgs!==undefined&&!Array.isArray(result.msgs))||
          (result.get_updates_buf!==undefined&&!validCursor(result.get_updates_buf)))throw Error('wechat_updates_invalid');
        this.health.set(account.accountKey,'ready');
        const messages=(Array.isArray(result.msgs)?result.msgs:[]).flatMap(value=>{
          const msg=inbound(value,account,boundAt);return msg?[msg]:[];
        });
        let newest:typeof messages[number]|undefined;
        for(const message of messages)if(message.time>=(newest?.time??account.contextTime??0))newest=message;
        if(newest&&(newest.contextToken!==account.contextToken||newest.time!==account.contextTime))
          this.persist(account,{contextToken:newest.contextToken,contextTime:newest.time});
        for(const {eventId,text} of messages){
          if(signal.aborted)return;
          try{receive({eventId,text,senderKey:account.ownerId,conversationKey:account.ownerId});}
          catch(error){if(!(error instanceof Error)||error.message!=='channel_event_conflict')throw error;}
        }
        const cursor=result.get_updates_buf;
        const advanced=typeof cursor==='string'&&cursor!==''&&cursor!==account.cursor;
        if(advanced)this.persist(account,{cursor});
        if(!advanced||!messages.length)await wait(250,undefined,{signal});
      }catch(error){
        if(signal.aborted||this.health.get(account.accountKey)==='reauthorize')return;
        if(wechatSessionExpired(error)){this.health.set(account.accountKey,'reauthorize');throw Error('wechat_reauthorization_required');}
        this.health.set(account.accountKey,'offline');
        await wait(5_000,undefined,{signal}).catch(()=>{});
      }
    }
  }

  async send({address,part,attemptId}:ChannelPacket,signal:AbortSignal):ReturnType<ChannelAdapter['send']>{
    const account=this.account(address);
    if(!account?.contextToken||this.health.get(account.accountKey)==='reauthorize'||signal.aborted)return {state:'failed'};
    let finalSend=false;
    try{
      const text=part.kind==='text'?part.text:undefined;
      let item:Record<string,unknown>;
      if(text!==undefined&&Buffer.byteLength(text)<=3500)item={type:1,text_item:{text}};
      else{
        const bytes=part.kind==='attachment'?Buffer.from(part.data,'base64'):Buffer.from(part.text);
        if(bytes.length>MEDIA_POLICY.fileBytes)return {state:'failed'};
        item=await this.api.file(account,part.kind==='attachment'?part.filename:'homer-reply.txt',bytes,signal);
      }
      signal.throwIfAborted();
      if(this.health.get(account.accountKey)==='reauthorize')return {state:'failed'};
      finalSend=true;
      const receipt=await this.api.send(account,account.contextToken,item,attemptId,signal);
      return {state:'sent',...(receipt?{receipt}:{})};
    }catch(error){
      if(wechatSessionExpired(error))this.health.set(account.accountKey,'reauthorize');
      return {state:!finalSend||error instanceof WechatRejected?'failed':'unknown'};
    }
  }
}

export function wechatChannel(runtime:string){
  return lstatSync(configFile(runtime),{throwIfNoEntry:false})||existsSync(join(runtime,'channels.sqlite'))
    ?new WechatChannel(runtime):undefined;
}
