import {useCallback,useEffect,useRef,useState} from 'react';

export type AccountState={supported:boolean;configured:boolean;source?:'codex'|'website';native?:{account:'none'|'chatgpt'|'other'|'unknown';connected:boolean;phase:string;pending:boolean;canReopen:boolean};nativeError?:string;websiteReady?:boolean;connection:'website'|'disconnected';active:'website'|'disconnected';pending:boolean;canReopen:boolean;needsRestart:boolean;error?:string;wallet?:{available:number;used:number;unit:string;expiresAt?:number};updatedAt?:string;walletError?:string;stale:boolean};
type AccountAction='state'|'connect'|'cancel'|'reopen'|'refresh'|'openWebsite'|'disconnect'|'restart'|'nativeConnect'|'nativeCancel'|'nativeReopen'|'applyCodex'|'applyWebsite';
type AccountBridge=Record<AccountAction,()=>Promise<AccountState>>&{onChange:(callback:()=>void)=>()=>void};
declare global{interface Window{homerDesktopAccount?:AccountBridge;}}

export const accountErrors:Record<string,string>={
 CONFIG_UNAVAILABLE:'配置同步未完成，已有有效配置会继续使用；尚未连接时请检查网络后重新打开荷马。',
 CONFIGURATION_REQUIRED:'网站连接地址尚未配置，请联系维护方。',
 INVALID_REQUEST:'连接参数不匹配，请联系维护方。',UNAUTHORIZED:'登录请求已取消、失效或被使用，请重新登录。',
 FORBIDDEN:'网站服务权限未配置，请联系维护方。',ACCOUNT_UNAVAILABLE:'账户不可用，请联系维护方核对。',
 CONFLICT:'账户归属或模型 Key 需要人工核对。',RATE_LIMITED:'请求较多，请稍后重新登录。',
 UNAVAILABLE:'登录未完成，请重新登录。',ACCOUNT_MISMATCH:'此本机资料已连接另一账号，请使用原账号登录。',
 CONNECTION_FILE_INVALID:'本机连接文件损坏或权限不正确，请保留文件并联系维护方核对。',
 CONNECTION_WRITE_FAILED:'登录信息未能保存，原文件已保留，请核对磁盘与文件权限后重新登录。',
 CONNECTION_CANCELLED:'登录已取消。',TOKEN_UNAVAILABLE:'登录凭据已失效，请重新登录；仍不可用时请联系维护方。',
 USAGE_UNAVAILABLE:'未能确认最新额度，请稍后刷新。',NOT_CONNECTED:'当前尚未登录。',
};
export function useDesktopAccount({currentSourceOnly=false,withWallet=true}:{currentSourceOnly?:boolean;withWallet?:boolean}={}){
 const bridge=window.homerDesktopAccount;
 const [state,setState]=useState<AccountState>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const live=useRef(false),request=useRef(0),running=useRef(false);
 const apply=useCallback(async(action:AccountAction='state')=>{
  if(!bridge)return;
  const id=++request.current;
  try{
   let value=await bridge[action]();
   if(action==='openWebsite'&&!value.configured)throw Error('unavailable');
   if(live.current&&id===request.current){setState(value);setNotice('');}
   if(withWallet&&action==='state'&&live.current&&id===request.current&&value.stale&&!value.walletError&&(value.active==='website'||!currentSourceOnly&&value.source==='codex'&&value.connection!=='disconnected'))value=await bridge.refresh();
   if(live.current&&id===request.current){setState(value);setNotice('');}
   return value;
  }catch{if(live.current&&id===request.current){if(action==='refresh'||action==='state')setState(value=>value?{...value,stale:true}:value);setNotice(action==='openWebsite'?'购买积分页面未能打开，请稍后重试。':'状态未能确认，请重试。');}}
 },[bridge,currentSourceOnly,withWallet]);
 useEffect(()=>{live.current=true;void apply();const dispose=bridge?.onChange(()=>{void apply();});return()=>{live.current=false;request.current++;dispose?.();};},[bridge,apply]);
 useEffect(()=>{
  const expiresAt=state?.wallet?.expiresAt;
  if(!withWallet||currentSourceOnly&&state?.source!=='website'||!expiresAt||expiresAt<=Date.now()/1000||state.stale||state.walletError)return;
  // Reconcile once at expiry; long-lived credentials respect the timer limit.
  const timer=window.setTimeout(()=>void apply(),Math.min(expiresAt*1000-Date.now(),2147483647));
  return()=>window.clearTimeout(timer);
 },[state,apply,currentSourceOnly,withWallet]);
 useEffect(()=>{
  if(currentSourceOnly||!state?.pending&&!state?.native?.pending)return;
  // The browser callback can finish while the renderer misses an invalidation.
  // Reconcile local state only while that authorization is still pending.
  let active=true,reading=false;
  const timer=window.setInterval(()=>{
   if(!active||reading)return;reading=true;
   void apply().finally(()=>{reading=false;});
  },1000);
  return()=>{active=false;window.clearInterval(timer);};
 },[state?.pending,state?.native?.pending,apply,currentSourceOnly]);
 async function run(action:AccountAction){
  if(running.current)return;running.current=true;setBusy(true);
  try{return await apply(action);}finally{running.current=false;if(live.current)setBusy(false);}
 }
 return {state,busy,notice,run};
}
