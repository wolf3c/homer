import {useCallback,useEffect,useRef,useState} from 'react';
import {connectionFetch} from './web-connection-client';
import type {WechatManagedState,WechatManagedLogin} from '../src/channels/wechat-management';
import type {TelegramManagedState} from '../src/channels/telegram-management';

// Older hosts omit this capability. Missing evidence must keep activation paused.
type RecoveryBoundary={mode:'new_messages_only';clockVerified:boolean;reviewRequired:boolean};
type States={wechat:WechatManagedState&{recovery?:RecoveryBoundary};telegram:TelegramManagedState&{recovery?:RecoveryBoundary}};
export type Channel=keyof States;
const labels:Record<string,string>={unconfigured:'尚未授权',connecting:'正在连接',reconnecting:'正在重连',connected:'收发已开启',disabled:'收发已暂停',invalid:'凭据需要核对',error:'连接异常',review_required:'收发已暂停',offline:'收发已暂停',online:'收发已开启',conflict:'其他接收实例冲突',unauthorized:'凭据不可用',network_retry:'网络重连中',presentation_degraded:'消息呈现需要核对',send_uncertain:'有发送结果未确认',send_failed:'有消息发送失败',host_uncertain:'主任务回执未确认'};
const explanations:Record<string,string>={
 settings_unavailable:'连接状态暂不可用，请重新检查。',settings_invalid_response:'连接状态暂不可用，请重新检查。',
 settings_result_unconfirmed:'操作结果未确认，请先检查当前状态，勿重复提交。',settings_request_timeout:'操作超时，结果未确认，请先检查当前状态，勿重复提交。',
 web_receipt_unconfirmed:'操作结果未确认，请先检查当前状态，勿重复提交。',
 web_method_denied:'连接管理暂不可用，请稍后重新检查。',desktop_chat_not_ready:'本地服务尚未就绪，请稍后重新检查。',service_upgrading:'服务正在更新，请稍后重新检查。',
 wechat_owner_mismatch:'扫码账号与已绑定账号不一致，请使用原账号。',wechat_login_not_active:'二维码已失效，请重新扫码。',wechat_history_review_required:'新旧消息边界尚未确认，继续暂停。',
 wechat_history_key_unavailable:'历史解密密钥尚未安全保留，未删除原连接。',wechat_history_key_invalid:'历史解密密钥尚未安全保留，未删除原连接。',
 telegram_existing_webhook:'此 Bot 已有 webhook，请先在原服务核实归属。',telegram_consumer_already_running:'同一个 Bot 已有接收实例，请先核实归属。',
 telegram_pairing_expired:'配对码已过期，请重新生成。',telegram_pairing_mismatch:'候选账号已变化，请重新核对。',telegram_invalid_token:'Token 格式不正确，请重新输入。',
 telegram_unbind_previous_bot_first:'请先核实旧 Bot 的绑定与历史保留，再更换 Bot。',telegram_not_configured:'请先保存专用 Bot 的 Token。',
 telegram_keychain_unavailable:'系统钥匙串保存或核验未完成，请检查钥匙串权限。',telegram_keychain_invalid:'钥匙串凭据核验失败，请重新核对。',
 telegram_unauthorized:'Telegram 未接受此凭据，请在 BotFather 核对。',telegram_uncertain:'验证结果未确认，请先核对当前状态，勿重复提交。',
 telegram_rate_limited:'Telegram 暂时限流，请稍后再试。',telegram_rejected:'Telegram 拒绝请求，请核对 Bot 设置。',
};
const uncertain=new Set(['settings_result_unconfirmed','settings_request_timeout','web_receipt_unconfirmed','telegram_uncertain']);
export const channelError=(error:unknown)=>explanations[error instanceof Error?error.message:'']??explanations.settings_unavailable;
export const channelLabel=(state:States[Channel]|undefined)=>state&&Object.hasOwn(labels,state.status)?labels[state.status]:'状态暂不可用';
export function canStartChannel(state:States[Channel]|undefined){
 const recovery=state?.recovery;
 return !!state&&state.status!=='review_required'&&Object.hasOwn(labels,state.status)&&recovery?.mode==='new_messages_only'&&recovery.clockVerified===true&&recovery.reviewRequired===false;
}
function isState<K extends Channel>(channel:K,value:unknown):value is States[K]{
 if(!value||typeof value!=='object')return false;
 const s=value as Record<string,unknown>;
 return typeof s.status==='string'&&Object.hasOwn(labels,s.status)&&typeof s.enabled==='boolean'&&typeof s.bound==='boolean'&&(channel!=='telegram'||typeof s.configured==='boolean');
}
export async function channelRequest<T>(channel:Channel,path='',input?:object):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('settings_request_timeout'));controller.abort();},path==='/configure'?95000:path==='/login/poll'?95000:input===undefined?8000:40000);});
 const request=(async()=>{
  let response:Response,value:unknown;
  try{response=await connectionFetch('/api/channels/'+channel+path,{signal:controller.signal,cache:'no-store',...(input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})});value=await response.json();}
  catch{throw Error(input===undefined?'settings_unavailable':'settings_result_unconfirmed');}
  if(!response.ok){const code=(value as {error?:unknown})?.error;throw Error(typeof code==='string'&&Object.hasOwn(explanations,code)?code:input===undefined?'settings_unavailable':'settings_result_unconfirmed');}
  return value as T;
 })();
 try{return await Promise.race([request,deadline]);}finally{clearTimeout(timer);}
}

// Only a non-secret pending marker survives owner replacement/reload. Ordinary
// state reads cannot certify a prior mutation; there are no automatic retries.
const operationKey=(channel:Channel)=>'homer.channel-operation.'+channel;
function hasPendingOperation(channel:Channel){try{return sessionStorage.getItem(operationKey(channel))!==null;}catch{return true;}}
export function useChannelSettings<K extends Channel>(channel:K,active:boolean){
 const [state,setState]=useState<States[K]>(),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[unconfirmed,setUnconfirmed]=useState(()=>hasPendingOperation(channel)),[error,setError]=useState(()=>hasPendingOperation(channel)?explanations.settings_result_unconfirmed:'');
 const alive=useRef(true),visible=useRef(active),observed=useRef(false),revision=useRef(0),pending=useRef(false),unknown=useRef(unconfirmed),current=useRef(state),reading=useRef<number|undefined>(undefined);
 visible.current=active;current.current=state;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;revision.current++;};},[]);
 const refresh=useCallback(async()=>{
  if(pending.current||!visible.current||reading.current===revision.current)return;
  const id=++revision.current;reading.current=id;setLoading(true);
  try{const value=await channelRequest<unknown>(channel);if(!isState(channel,value))throw Error('settings_invalid_response');if(alive.current&&visible.current&&id===revision.current){observed.current=true;setState(value);if(!unknown.current)setError('');}}
  catch(e){if(alive.current&&visible.current&&id===revision.current){observed.current=false;setState(undefined);setError(channelError(e));}}
  finally{if(reading.current===id)reading.current=undefined;if(alive.current&&id===revision.current)setLoading(false);}
 },[channel]);
 useEffect(()=>{
  if(!active)return;
  observed.current=false;setState(undefined);setLoading(false);void refresh();
  const timer=setInterval(()=>{if(!document.hidden&&!unknown.current)void refresh();},5000);
  return()=>{clearInterval(timer);revision.current++;observed.current=false;};
 },[active,refresh]);
 const run=useCallback(async function run<T=States[K]>(path:string,input:object={}):Promise<T|undefined>{
  if(pending.current||unknown.current||!current.current)return;
  if(['/login','/login/poll','/reconnect','/connect','/pair','/pair/approve'].includes(path)&&!canStartChannel(current.current)){setError('新旧消息边界尚未确认，继续暂停。');return;}
  if(path==='/forget'||channel==='wechat'&&path==='/disconnect'){setError('历史保留尚未核验，暂不能解除绑定。');return;}
  pending.current=true;revision.current++;setBusy(true);setLoading(false);setError('');
  try{
   try{sessionStorage.setItem(operationKey(channel),'pending');}catch{throw Error('settings_result_unconfirmed');}
   const value=await channelRequest<unknown>(channel,path,input);
   const validState=isState(channel,value),login=value as WechatManagedLogin;
   if(channel==='wechat'&&path.startsWith('/login')){
    if(!login||typeof login.id!=='string'||!['wait','scaned','confirmed','expired','need_verifycode','verify_code_blocked','already_bound','error'].includes(login.status))throw Error('settings_result_unconfirmed');
   }else if(path==='/pair'){
    const pair=value as {code?:unknown;expiresInSeconds?:unknown};
    if(!pair||typeof pair.code!=='string'||!/^[a-f0-9]{32}$/.test(pair.code)||typeof pair.expiresInSeconds!=='number'||!Number.isSafeInteger(pair.expiresInSeconds)||pair.expiresInSeconds<=0)throw Error('settings_result_unconfirmed');
   }else if(!validState||path==='/configure'&&!(value as TelegramManagedState).configured)throw Error('settings_result_unconfirmed');
   try{sessionStorage.removeItem(operationKey(channel));}catch{throw Error('settings_result_unconfirmed');}
   if(alive.current){
    if(validState){observed.current=visible.current;setState(value);}
    else if(channel==='wechat')setState(previous=>previous?{...previous,login}:previous);
   }
   return value as T;
  }catch(e){
   let unconfirmed=e instanceof Error&&uncertain.has(e.message);
   if(!unconfirmed)try{sessionStorage.removeItem(operationKey(channel));}catch{unconfirmed=true;}
   if(alive.current){if(unconfirmed){unknown.current=true;setUnconfirmed(true);}setError(channelError(unconfirmed?Error('settings_result_unconfirmed'):e));}return;
  }
  finally{pending.current=false;if(alive.current){setBusy(false);if(channel==='wechat'&&path.startsWith('/login')&&!unknown.current)void refresh();}}
 },[channel,refresh]);
 return {state:active&&observed.current?state:undefined,loading,busy,unconfirmed,error,refresh,run};
}
export type ChannelSettings<K extends Channel>=ReturnType<typeof useChannelSettings<K>>;
