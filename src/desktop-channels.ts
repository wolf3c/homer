import {randomBytes,randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import type {ChannelHealth,ChannelStatus} from './channel-plugin.js';
import {pairTelegramBot,readTelegramAccounts,telegramBotId,verifyTelegramBot,writeTelegramAccounts,type TelegramAccount} from './telegram-channel.js';
import {authorizeWechat,prepareWechatAccount,readWechatAccounts,writeWechatAccounts,type WechatAccount} from './wechat-channel.js';
import {dingtalkCredentials,pairDingtalkBot,readDingtalkAccounts,verifyDingtalkCredentials,writeDingtalkAccounts,type DingtalkAccount,type DingtalkCredentials} from './dingtalk-channel.js';

export type DesktopChannel='wechat'|'telegram'|'dingtalk';
export type DesktopChannelStart={id?:string;channel:DesktopChannel;target?:string;token?:string;credentials?:DingtalkCredentials};
type ChangeKind='add'|'renew'|'remove';
type Change<T>={kind:ChangeKind;key:string;label:string;before?:T;after?:T};
type FlowView={
  id:string; channel:DesktopChannel; phase:'starting'|'scan'|'scanned'|'code'|'pair'|'confirm'|'applying'|'error';
  target?:string;qr?:string;command?:string;label?:string;peer?:string;error?:string;
};
type Flow={view:FlowView;abort:AbortController;code?:(value:string)=>void;stage?:()=>void;deadline?:number;commit?:Promise<void>;saved?:boolean};
export type DesktopChannelState={
  bindings:ChannelStatus[];
  flow?:FlowView; busy:boolean; stopped:boolean; readError:boolean;
  result?:{id:string;channel:DesktopChannel;saved:boolean;applied:boolean;error?:string};
};

const telegramKey=(account:TelegramAccount)=>telegramBotId(account.token);
const wechatKey=(account:WechatAccount)=>account.accountKey;
const wechatIdentity=({accountKey,botId,ownerId,botToken,baseUrl}:WechatAccount)=>[accountKey,botId,ownerId,botToken,baseUrl];
const telegramIdentity=({token,userId,chatId}:TelegramAccount)=>[token,userId,chatId];
const dingtalkKey=(account:DingtalkAccount)=>account.accountKey;
const errorCodes=new Set(['wechat_qr_expired','wechat_verify_code_invalid','wechat_unbind_before_replacing_account',
  'telegram_pair_conflict','telegram_token_unchanged','telegram_token_invalid','telegram_bot_identity_invalid','channel_binding_conflict','channel_wrong_account',
  'dingtalk_credentials_invalid','dingtalk_stream_conflict','dingtalk_secret_unchanged']);

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
  private flow?:Flow;
  private readonly authorizing=new Set<Promise<void>>();
  private closing=false;
  private result?:DesktopChannelState['result'];
  constructor(private runtime:string,private reconfigure:(channel:DesktopChannel,save:()=>void)=>Promise<void>,private http?:typeof fetch,private dingtalkSocket?:Parameters<typeof pairDingtalkBot>[5]){}

  configured():ChannelStatus[]{
    const row=(adapterId:DesktopChannel,accountKey:string):ChannelStatus=>({
      adapterId,accountKey,label:accountKey,state:'checking' as ChannelHealth,failed:0,unknown:0,
    });
    return [...readWechatAccounts(this.runtime).map(account=>row('wechat',account.accountKey)),
      ...readTelegramAccounts(this.runtime).map(account=>row('telegram',telegramKey(account))),
      ...readDingtalkAccounts(this.runtime).map(account=>row('dingtalk',account.accountKey))];
  }


  snapshot(){
    return {flow:this.flow&&{...this.flow.view},busy:!!this.flow?.commit,result:this.result};
  }

  state(bindings:ChannelStatus[]):DesktopChannelState{
    let configured:ChannelStatus[];
    try{configured=this.configured();}catch{return {...this.snapshot(),bindings,stopped:this.closing,readError:true};}
    return {...this.snapshot(),bindings:configured.map(row=>{
      const active=bindings.find(active=>active.adapterId===row.adapterId&&active.accountKey===row.accountKey)??row;
      return this.result?.saved&&this.result.error&&this.result.channel===row.adapterId?{...active,state:'offline'}:active;
    }),
      stopped:this.closing,readError:false};
  }

  manage(action:string,input:unknown,bindings:ChannelStatus[]=[]){
    if(action==='state'){if(typeof input!=='boolean')throw Error('desktop_channels_arguments');return this.state(bindings);}
    if(action==='apply'){if(input!==undefined)throw Error('desktop_channels_arguments');return this.apply();}
    if(!input||typeof input!=='object')throw Error('desktop_channels_arguments');
    const value=input as {id:string;channel:DesktopChannel;key:string;target?:string;token?:string;credentials?:DingtalkCredentials;code:string};
    if(action==='cancel'){this.cancel(value.id);return;}
    if(this.closing)throw Error('desktop_channels_unavailable');
    if(action==='start')return this.start(value.channel,value.target,value.token,value.credentials,value.id);
    if(action==='code'){this.code(value.id,value.code);return;}
    if(action==='confirm')return this.confirm(value.id);
    if(action==='remove')return this.remove(value.channel,value.key,value.key,value.id);
    throw Error('desktop_channels_arguments');
  }

  async close(){
    this.closing=true;
    const flow=this.flow;
    this.cancel();
    await Promise.allSettled([...this.authorizing,flow?.commit]);
  }
  start(channel:DesktopChannel,target?:string,token?:string,credentials?:DingtalkCredentials,id:string=randomUUID()){
    if(this.flow||this.result?.saved&&!this.result.applied)throw Error('channel_flow_busy');
    if(this.closing)throw Error('desktop_channels_unavailable');
    if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))throw Error('channel_input_invalid');
    if(channel!=='wechat'&&channel!=='telegram'&&channel!=='dingtalk')throw Error('channel_input_invalid');
    if(target!==undefined&&(typeof target!=='string'||!target))throw Error('channel_input_invalid');
    this.result=undefined;
    const flow:Flow={view:{id,channel,target,phase:'starting'},abort:new AbortController()};
    this.flow=flow;
    const run=channel==='wechat'?this.authorizeWechat(flow):channel==='telegram'?this.authorizeTelegram(flow,token):
      this.authorizeDingtalk(flow,credentials);
    const pending:Promise<void>=run.catch(error=>{
      if(this.flow!==flow||flow.abort.signal.aborted)return;
      const message=error instanceof Error?error.message:'';
      const code=error instanceof Error&&error.name==='TimeoutError'?'channel_auth_timeout':
        errorCodes.has(message)?message:'channel_auth_failed';
      flow.view={id:flow.view.id,channel,target,phase:'error',error:code};
      flow.code=undefined;
      flow.stage=undefined;
    }).finally(()=>{this.authorizing.delete(pending);});
    this.authorizing.add(pending);
    return flow.view.id;
  }

  cancel(id?:string){
    if(!this.flow||(id!==undefined&&this.flow.view.id!==id))return;
    if(this.flow.commit||this.flow.saved&&!this.closing)return;
    this.flow.abort.abort();
    if(!this.flow.saved)this.result=undefined;
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
    if(flow.commit)return flow.view.id;
    if(!flow.deadline||Date.now()>=flow.deadline){
      flow.view.phase='error';
      flow.view.error='channel_auth_timeout';
      flow.stage=undefined;
      throw Error('channel_auth_timeout');
    }
    flow.deadline=undefined;
    return this.commit(flow);
  }


  remove(channel:DesktopChannel,key:string,_label:string,id:string=randomUUID()){
    if(this.flow||this.result?.saved&&!this.result.applied)throw Error('channel_flow_busy');
    if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id)||typeof key!=='string'||!key)throw Error('channel_input_invalid');
    const flow:Flow={view:{id,channel,phase:'applying'},abort:new AbortController()};
    if(channel==='wechat'){
      const before=readWechatAccounts(this.runtime).find(account=>account.accountKey===key);
      if(!before)throw Error('channel_binding_conflict');
      flow.stage=()=>writeWechatAccounts(this.runtime,applyChanges(readWechatAccounts(this.runtime),new Map([[key,{key,label:key,before,kind:'remove'}]]),wechatKey,wechatIdentity,next=>next));
    }else if(channel==='telegram'){
      const before=readTelegramAccounts(this.runtime).find(account=>telegramKey(account)===key);
      if(!before)throw Error('channel_binding_conflict');
      flow.stage=()=>writeTelegramAccounts(this.runtime,applyChanges(readTelegramAccounts(this.runtime),new Map([[key,{key,label:key,before,kind:'remove'}]]),telegramKey,telegramIdentity,next=>next));
    }else if(channel==='dingtalk'){
      const before=readDingtalkAccounts(this.runtime).find(account=>account.accountKey===key);
      if(!before)throw Error('channel_binding_conflict');
      flow.stage=()=>writeDingtalkAccounts(this.runtime,applyChanges(readDingtalkAccounts(this.runtime),new Map([[key,{key,label:key,before,kind:'remove'}]]),dingtalkKey,account=>account,next=>next));
    }else throw Error('channel_input_invalid');
    this.flow=flow;
    return this.commit(flow);
  }

  apply(){
    if(!this.flow?.stage||this.flow.commit||this.flow.view.phase!=='error')throw Error('desktop_channels_unavailable');
    return this.commit(this.flow);
  }

  private commit(flow:Flow){
    flow.view.phase='applying';flow.view.error=undefined;
    const result={id:flow.view.id,channel:flow.view.channel,saved:!!flow.saved,applied:false,error:undefined as string|undefined};
    this.result=result;
    flow.commit=Promise.resolve().then(()=>this.reconfigure(flow.view.channel,()=>{
      if(!flow.saved){flow.stage!();flow.saved=true;result.saved=true;}
    })).then(()=>{
      result.applied=true;flow.stage=undefined;
      if(this.flow===flow)this.flow=undefined;
    },()=>{
      result.error=flow.saved?'channel_apply_failed':'channel_save_failed';
      flow.view.phase='error';flow.view.error=result.error;
    }).finally(()=>{flow.commit=undefined;});
    return flow.view.id;
  }

  private async authorizeWechat(flow:Flow){
    const {target}=flow.view;
    const accounts=readWechatAccounts(this.runtime);
    const prior=accounts.find(account=>account.accountKey===target);
    if(target&&!prior)throw Error('channel_binding_conflict');
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
    if(!prior&&accounts.some(matches))
      throw Error('channel_binding_conflict');
    const after=prepareWechatAccount(credential,prior);
    const key=after.accountKey;
    flow.stage=()=>writeWechatAccounts(this.runtime,applyChanges(readWechatAccounts(this.runtime),
      new Map([[key,{key,label:key,before:prior,after,kind:prior?'renew':'add'}]]),wechatKey,wechatIdentity,
      (next,latest)=>latest&&latest.baseUrl===next.baseUrl?{...next,cursor:latest.cursor}:next,accounts=>{
        for(const field of ['botId','ownerId'] as const)if(new Set(accounts.map(account=>account[field])).size!==accounts.length)throw Error('channel_binding_conflict');
      }));
    this.commit(flow);
  }

  private async authorizeTelegram(flow:Flow,token:unknown){
    const key=telegramBotId(token);
    if(typeof token!=='string')throw Error('telegram_token_invalid');
    const {target}=flow.view;
    const before=readTelegramAccounts(this.runtime).find(account=>telegramKey(account)===key);
    if(target&&target!==key)throw Error('channel_wrong_account');
    if(!!target!==!!before)throw Error('channel_binding_conflict');
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
    flow.stage=()=>writeTelegramAccounts(this.runtime,applyChanges(readTelegramAccounts(this.runtime),
      new Map([[key,{key,label:bot.label,before,after,kind:before?'renew':'add'}]]),telegramKey,telegramIdentity,next=>next));
    Object.assign(flow.view,{phase:'confirm',label:bot.label,peer,command:undefined});
  }

  private async authorizeDingtalk(flow:Flow,value:unknown){
    const credentials=dingtalkCredentials(value);
    const {target}=flow.view;
    const before=readDingtalkAccounts(this.runtime).find(account=>account.appKey===credentials.appKey);
    if(target&&before?.accountKey!==target)throw Error('channel_wrong_account');
    if(before?.appSecret===credentials.appSecret)throw Error('dingtalk_secret_unchanged');
    if(!target&&before)
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
    flow.stage=()=>writeDingtalkAccounts(this.runtime,applyChanges(readDingtalkAccounts(this.runtime),
      new Map([[key,{key,label:key,before,after,kind:before?'renew':'add'}]]),dingtalkKey,account=>account,next=>next));
    const peer=after.userId.length>4?'••••'+after.userId.slice(-4):'••••';
    Object.assign(flow.view,{phase:'confirm',command:undefined,label:key,peer});
  }

}
