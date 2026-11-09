type NativeRpc = (method: string, params: any) => Promise<any>;
type Phase='idle'|'waiting'|'unconfirmed'|'cancelled'|'failed'|'timed_out'|'cancel_unconfirmed'|'logout_unconfirmed';
type Completion={loginId?:unknown;success?:unknown;error?:unknown};
export type NativeAccountState={account:'none'|'chatgpt'|'other'|'unknown';connected:boolean;phase:Phase;loginId?:string;authUrl?:string;expiresAt?:number};
type Attempt={id?:string;authUrl?:string;expiresAt:number;completed?:boolean;early?:Completion};
// Native Codex owns OAuth, callback, credential files and refresh. This is only
// the bounded UI operation lifecycle. Nothing is persisted or sent to a model.
export class NativeAccount{
 private attempt?:Attempt;private phase:Phase='idle';private timer?:NodeJS.Timeout;
 private queue:Promise<unknown>=Promise.resolve();private closed=false;private lastId?:string;
 constructor(private rpc:NativeRpc,private options:{timeoutMs?:number}={}){}
 get pending(){return !!this.attempt;}
 private serial<T>(work:()=>Promise<T>):Promise<T>{const p=this.queue.then(work);this.queue=p.catch(()=>{});return p;}
 private clear(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.attempt=undefined;}
 completed(value:Completion){const a=this.attempt;if(!a||typeof value.loginId!=='string'||typeof value.success!=='boolean')return;if(!a.id){a.early={loginId:value.loginId,success:value.success};return;}if(value.loginId===a.id){a.completed=value.success;void this.state();}}
 disconnected(){const pending=this.pending;this.clear();if(pending)this.phase='failed';}
 private async read(refreshToken=false):Promise<NativeAccountState>{
  let account:NativeAccountState['account']='unknown';
  try{const r=await this.rpc('account/read',{refreshToken});account=r?.account===null?'none':r?.account?.type==='chatgpt'?'chatgpt':typeof r?.account?.type==='string'?'other':'unknown';}catch{}
  if(account==='chatgpt'){this.clear();if(this.phase!=='logout_unconfirmed')this.phase='idle';}
  else if(this.attempt?.completed===false){this.clear();this.phase='failed';}
  else if(this.attempt?.completed===true)this.phase='unconfirmed';
  const a=this.attempt;
  return {account,connected:account==='chatgpt',phase:this.phase,...(a?.id?{loginId:a.id,expiresAt:a.expiresAt,...(this.phase==='waiting'&&a.authUrl?{authUrl:a.authUrl}:{})}:{} )};
 }
 state(refreshToken=false){return this.serial(()=>this.read(refreshToken));}
 start(){return this.serial(async()=>{
  if(this.closed)throw Error('native_account_closed');const status=await this.read();
  if(status.connected)return status;if(status.account==='other')throw Error('native_account_other_auth_present');if(status.account==='unknown')throw Error('native_account_status_unconfirmed');
  if(this.attempt)return status;
  const a:Attempt={expiresAt:Date.now()+(this.options.timeoutMs??600000)};this.attempt=a;this.phase='waiting';
  try{const r=await this.rpc('account/login/start',{type:'chatgpt'});if(typeof r?.loginId==='string'&&r.loginId.length>0&&r.loginId.length<=200){a.id=r.loginId;this.lastId=a.id;}let u:URL;try{u=new URL(r.authUrl);}catch{throw Error('native_account_login_response_invalid');}
   if(r.type!=='chatgpt'||typeof r.loginId!=='string'||!r.loginId||r.loginId.length>200||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('native_account_login_response_invalid');
   a.authUrl=u.href;const early=a.early;if(early&&early.loginId===a.id)a.completed=early.success===true;delete a.early;
   this.timer=setTimeout(()=>{void this.serial(async()=>{if(this.attempt===a)await this.cancelCurrent('timed_out');});},Math.max(1,a.expiresAt-Date.now()));this.timer.unref();
   return await this.read();
  }catch{this.phase='failed';if(a.id)await this.cancelCurrent('cancelled');throw Error('native_account_login_start_unconfirmed');}
 });}
 private async cancelCurrent(phase:'cancelled'|'timed_out'){
  const a=this.attempt;if(!a?.id){this.clear();this.phase=phase;return this.read();}
  if(this.timer)clearTimeout(this.timer);this.timer=undefined;delete a.authUrl;
  try{const r=await this.rpc('account/login/cancel',{loginId:a.id});if(!['canceled','notFound'].includes(r?.status))throw Error('unconfirmed');this.clear();this.phase=phase;}
  catch{this.phase='cancel_unconfirmed';}
  return this.read();
 }
 cancel(loginId:unknown){return this.serial(async()=>{if(typeof loginId!=='string'||loginId!==(this.attempt?.id??this.lastId))throw Error('native_account_login_conflict');return this.attempt?this.cancelCurrent('cancelled'):this.read();});}
 logout(){return this.serial(async()=>{
  if(this.attempt){await this.cancelCurrent('cancelled');if(this.attempt)return this.read();}
  try{await this.rpc('account/logout',{});}catch{this.phase='logout_unconfirmed';return this.read();}
  const s=await this.read();this.phase=s.account==='none'?'idle':'logout_unconfirmed';return {...s,phase:this.phase};
 });}
 async close(){await this.serial(async()=>{if(this.attempt)await this.cancelCurrent('cancelled');this.closed=true;this.clear();});}
}
