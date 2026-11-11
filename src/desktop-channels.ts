import {randomBytes,randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import type {ChannelHealth,ChannelStatus} from './channel-plugin.js';
import {acquireLock} from './processes.js';
import {pairTelegramBot,readTelegramAccounts,telegramBotId,verifyTelegramBot,writeTelegramAccounts,type TelegramAccount} from './telegram-channel.js';
import {authorizeWechat,prepareWechatAccount,readWechatAccounts,writeWechatAccounts,type WechatAccount} from './wechat-channel.js';
import {dingtalkCredentials,pairDingtalkBot,readDingtalkAccounts,verifyDingtalkCredentials,writeDingtalkAccounts,type DingtalkAccount,type DingtalkCredentials} from './dingtalk-channel.js';

export type DesktopChannel='wechat'|'telegram'|'dingtalk';
export type DesktopChannelStart={channel:DesktopChannel;target?:string;token?:string;credentials?:DingtalkCredentials};
type ChangeKind='add'|'renew'|'remove';
type Change<T>={kind:ChangeKind;key:string;label:string;before?:T;after?:T};
type FlowView={
  id:string; channel:DesktopChannel; phase:'starting'|'scan'|'scanned'|'code'|'pair'|'confirm'|'error';
  target?:string;qr?:string;command?:string;label?:string;peer?:string;error?:string;
};
type Flow={view:FlowView;abort:AbortController;code?:(value:string)=>void;stage?:()=>void;deadline?:number};
export type DesktopChannelState={
  bindings:ChannelStatus[]; pending:{channel:DesktopChannel;kind:ChangeKind;key:string;label:string}[];
  flow?:FlowView; busy:boolean; stopped:boolean; readError:boolean;
  result?:{saved:string[];failed:DesktopChannel[]};
};

const telegramKey=(account:TelegramAccount)=>telegramBotId(account.token);
const wechatKey=(account:WechatAccount)=>account.accountKey;
const wechatIdentity=({accountKey,botId,ownerId,botToken,baseUrl}:WechatAccount)=>[accountKey,botId,ownerId,botToken,baseUrl];
const telegramIdentity=({token,userId,chatId}:TelegramAccount)=>[token,userId,chatId];
const dingtalkKey=(account:DingtalkAccount)=>account.accountKey;
const errorCodes=new Set(['wechat_qr_expired','wechat_verify_code_invalid','wechat_unbind_before_replacing_account',
  'telegram_pair_conflict','telegram_token_unchanged','telegram_token_invalid','telegram_bot_identity_invalid','channel_binding_conflict','channel_wrong_account',
  'dingtalk_credentials_invalid','dingtalk_stream_conflict','dingtalk_secret_unchanged']);
const labels={wechat:'微信',telegram:'Telegram',dingtalk:'钉钉'};

function applyChanges<T>(accounts:T[],changes:Map<string,Change<T>>,keyOf:(account:T)=>string,
  identity:(account:T)=>unknown,merge:(next:T,prior:T|undefined)=>T,validate?:(accounts:T[])=>void){
  const next=new Map(accounts.map(account=>[keyOf(account),account]));
  for(const {key,before,after} of changes.values()){
    const actual=next.get(key);
    if(JSON.stringify(actual&&identity(actual))!==JSON.stringify(before&&identity(before)))throw Error('channel_binding_changed');
    if(after)next.set(key,merge(after,actual));
    else next.delete(key);
  }
  const result=[...next.values()];
  validate?.(result);
  return result;
}

export class DesktopChannels {
  private wechat=new Map<string,Change<WechatAccount>>();
  private telegram=new Map<string,Change<TelegramAccount>>();
  private dingtalk=new Map<string,Change<DingtalkAccount>>();
  private flow?:Flow;
  constructor(private runtime:string,private http?:typeof fetch,private dingtalkSocket?:Parameters<typeof pairDingtalkBot>[5]){}

  configured():ChannelStatus[]{
    const row=(adapterId:DesktopChannel,accountKey:string):ChannelStatus=>({
      adapterId,accountKey,label:accountKey,state:'checking' as ChannelHealth,failed:0,unknown:0,
    });
    return [...readWechatAccounts(this.runtime).map(account=>row('wechat',account.accountKey)),
      ...readTelegramAccounts(this.runtime).map(account=>row('telegram',telegramKey(account))),
      ...readDingtalkAccounts(this.runtime).map(account=>row('dingtalk',account.accountKey))];
  }

  snapshot(){
    const pending=<T>(channel:DesktopChannel,changes:Map<string,Change<T>>)=>[...changes.values()]
      .map(({kind,key,label})=>({channel,kind,key,label}));
    return {pending:[...pending('wechat',this.wechat),...pending('telegram',this.telegram),...pending('dingtalk',this.dingtalk)],
      flow:this.flow&&{...this.flow.view}};
  }

  start(channel:DesktopChannel,target?:string,token?:string,credentials?:DingtalkCredentials){
    if(this.flow)throw Error('channel_flow_busy');
    if(channel!=='wechat'&&channel!=='telegram'&&channel!=='dingtalk')throw Error('channel_input_invalid');
    if(target!==undefined&&(typeof target!=='string'||!target))throw Error('channel_input_invalid');
    const flow:Flow={view:{id:randomUUID(),channel,target,phase:'starting'},abort:new AbortController()};
    this.flow=flow;
    const run=channel==='wechat'?this.authorizeWechat(flow):channel==='telegram'?this.authorizeTelegram(flow,token):
      this.authorizeDingtalk(flow,credentials);
    void run.catch(error=>{
      if(this.flow!==flow||flow.abort.signal.aborted)return;
      const message=error instanceof Error?error.message:'';
      const code=error instanceof Error&&error.name==='TimeoutError'?'channel_auth_timeout':
        errorCodes.has(message)?message:'channel_auth_failed';
      flow.view={id:flow.view.id,channel,target,phase:'error',error:code};
      flow.code=undefined;
      flow.stage=undefined;
    });
    return flow.view.id;
  }

  cancel(id?:string){
    if(!this.flow||(id!==undefined&&this.flow.view.id!==id))return;
    this.flow.abort.abort();
    this.flow=undefined;
  }

  code(id:string,value:string){
    const flow=this.flow;
    if(!flow||flow.view.id!==id||!flow.code||typeof value!=='string'||!/^\d{4,12}$/.test(value))throw Error('channel_code_invalid');
    const accept=flow.code;
    flow.code=undefined;
    flow.view.phase='scanned';
    accept(value);
  }

  confirm(id:string){
    const flow=this.flow;
    if(!flow||flow.view.id!==id||!flow.stage)throw Error('channel_confirmation_invalid');
    if(!flow.deadline||Date.now()>=flow.deadline){
      flow.view.phase='error';
      flow.view.error='channel_auth_timeout';
      flow.stage=undefined;
      throw Error('channel_auth_timeout');
    }
    flow.stage();
    this.cancel(id);
  }

  remove(channel:DesktopChannel,key:string,label:string){
    if(channel==='wechat'){
      const before=readWechatAccounts(this.runtime).find(account=>account.accountKey===key);
      if(!before||this.wechat.has(key))throw Error('channel_binding_conflict');
      this.wechat.set(key,{key,label:key,before,kind:'remove'});
    }else if(channel==='telegram'){
      const before=readTelegramAccounts(this.runtime).find(account=>telegramKey(account)===key);
      if(!before||this.telegram.has(key))throw Error('channel_binding_conflict');
      this.telegram.set(key,{key,label,before,kind:'remove'});
    }else if(channel==='dingtalk'){
      const before=readDingtalkAccounts(this.runtime).find(account=>account.accountKey===key);
      if(!before||this.dingtalk.has(key))throw Error('channel_binding_conflict');
      this.dingtalk.set(key,{key,label:key,before,kind:'remove'});
    }else throw Error('channel_input_invalid');
  }

  undo(channel:DesktopChannel,key:string){
    if(channel==='wechat')this.wechat.delete(key);
    else if(channel==='telegram')this.telegram.delete(key);
    else if(channel==='dingtalk')this.dingtalk.delete(key);
    else throw Error('channel_input_invalid');
  }

  discard(){this.wechat.clear();this.telegram.clear();this.dingtalk.clear();}

  apply(){
    const saved:string[]=[];
    const failed:DesktopChannel[]=[];
    if(!this.wechat.size&&!this.telegram.size&&!this.dingtalk.size)return {saved,failed};
    const unlock=acquireLock(this.runtime);
    try{
      const write=<T>(channel:DesktopChannel,changes:Map<string,Change<T>>,run:()=>void)=>{
        if(!changes.size)return;
        try{run();}catch{failed.push(channel);return;}
        for(const {label} of changes.values())saved.push(labels[channel]+'@'+label);
        changes.clear();
      };
      write('wechat',this.wechat,()=>writeWechatAccounts(this.runtime,
        applyChanges(readWechatAccounts(this.runtime),this.wechat,wechatKey,wechatIdentity,(next,prior)=>
          prior&&prior.baseUrl===next.baseUrl?{...next,cursor:prior.cursor}:next,accounts=>{
            for(const id of ['botId','ownerId'] as const)
              if(new Set(accounts.map(account=>account[id])).size!==accounts.length)throw Error('channel_binding_conflict');
          })));
      write('telegram',this.telegram,()=>writeTelegramAccounts(this.runtime,
        applyChanges(readTelegramAccounts(this.runtime),this.telegram,telegramKey,telegramIdentity,next=>next)));
      write('dingtalk',this.dingtalk,()=>writeDingtalkAccounts(this.runtime,
        applyChanges(readDingtalkAccounts(this.runtime),this.dingtalk,dingtalkKey,account=>account,next=>next)));
      return {saved,failed};
    }finally{unlock();}
  }

  private async authorizeWechat(flow:Flow){
    const {target}=flow.view;
    const accounts=readWechatAccounts(this.runtime);
    const prior=accounts.find(account=>account.accountKey===target);
    if(target&&(!prior||this.wechat.has(target)))throw Error('channel_binding_conflict');
    const signal=flow.abort.signal;
    const credential=await authorizeWechat({
      showQr:async url=>{
        const qr=await QRCode.toDataURL(url,{width:280,margin:2});
        signal.throwIfAborted();
        Object.assign(flow.view,{qr,phase:'scan'});
      },
      scanned:()=>{flow.view.phase='scanned';},
      verifyCode:challenge=>new Promise((resolve,reject)=>{
        challenge.throwIfAborted();
        const cancel=()=>reject(challenge.reason);
        challenge.addEventListener('abort',cancel,{once:true});
        flow.view.phase='code';
        flow.code=value=>{challenge.removeEventListener('abort',cancel);resolve(value);};
      }),
    },this.http,signal);
    signal.throwIfAborted();
    const matches=(account:WechatAccount)=>account.botId===credential.botId||account.ownerId===credential.ownerId;
    if(!prior&&(accounts.some(matches)||[...this.wechat.values()].some(change=>change.after&&matches(change.after))))
      throw Error('channel_binding_conflict');
    const after=prepareWechatAccount(credential,prior);
    this.wechat.set(after.accountKey,{key:after.accountKey,label:after.accountKey,before:prior,after,kind:prior?'renew':'add'});
    this.cancel(flow.view.id);
  }

  private async authorizeTelegram(flow:Flow,token:unknown){
    const key=telegramBotId(token);
    if(typeof token!=='string')throw Error('telegram_token_invalid');
    const {target}=flow.view;
    const before=readTelegramAccounts(this.runtime).find(account=>telegramKey(account)===key);
    if(target&&target!==key)throw Error('channel_wrong_account');
    if(!!target!==!!before||this.telegram.has(key))throw Error('channel_binding_conflict');
    if(before?.token===token)throw Error('telegram_token_unchanged');
    flow.deadline=Date.now()+300_000;
    const signal=AbortSignal.any([flow.abort.signal,AbortSignal.timeout(300_000)]);
    const bot=await verifyTelegramBot(token,signal,this.http);
    signal.throwIfAborted();
    let after:TelegramAccount,peer:string;
    if(before){
      after={...before,token};
      peer=String(before.chatId);
    }else{
      const command='/start homer_'+randomBytes(16).toString('base64url');
      Object.assign(flow.view,{phase:'pair',command,label:bot.label});
      ({account:after,peer}=await pairTelegramBot(token,command,signal,this.http));
    }
    signal.throwIfAborted();
    flow.stage=()=>{this.telegram.set(key,{key,label:bot.label,before,after,kind:before?'renew':'add'});};
    Object.assign(flow.view,{phase:'confirm',label:bot.label,peer,command:undefined});
  }

  private async authorizeDingtalk(flow:Flow,value:unknown){
    const credentials=dingtalkCredentials(value);
    const {target}=flow.view;
    const before=readDingtalkAccounts(this.runtime).find(account=>account.appKey===credentials.appKey);
    if(target&&before?.accountKey!==target)throw Error('channel_wrong_account');
    if(before?.appSecret===credentials.appSecret)throw Error('dingtalk_secret_unchanged');
    if((!target&&before)||[...this.dingtalk.values()].some(change=>change.after?.appKey===credentials.appKey||change.key===target))
      throw Error('channel_binding_conflict');
    flow.deadline=Date.now()+300_000;
    const signal=AbortSignal.any([flow.abort.signal,AbortSignal.timeout(300_000)]);
    await verifyDingtalkCredentials(credentials,signal,this.http);
    let after:DingtalkAccount;
    if(before)after={...before,...credentials};
    else{
      const command='HOMER-DT-'+randomBytes(16).toString('hex');
      after=await pairDingtalkBot(credentials,command,signal,()=>{
        Object.assign(flow.view,{phase:'pair',command});
      },this.http,this.dingtalkSocket);
    }
    signal.throwIfAborted();
    const key=after.accountKey;
    flow.stage=()=>{this.dingtalk.set(key,{key,label:key,before,after,kind:before?'renew':'add'});};
    const peer=after.userId.length>4?'••••'+after.userId.slice(-4):'••••';
    Object.assign(flow.view,{phase:'confirm',command:undefined,label:key,peer});
  }

}
