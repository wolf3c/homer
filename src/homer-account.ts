import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,openSync,fstatSync,closeSync,realpathSync,writeFileSync,fsyncSync,renameSync,unlinkSync,linkSync,constants,lstatSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';

import {assertWindowsPrivate} from '../scripts/windows-security.mjs';
import {validateContextTuning} from './model-context.js';
import {validateModelCapabilities,type ModelCapabilities} from './model-catalog.js';
import {validReasoningEffort} from './model-config.js';

export type HomerRoleConfig = {baseUrl:string;model:string;effort:string|null;fast:false;capabilities?:ModelCapabilities;context:{contextWindow:number;autoCompactTokenLimit:number;autoCompactTokenLimitScope:'total'}};
export type HomerRuntimeConfig = {main:HomerRoleConfig;worker:HomerRoleConfig};

export type HomerCredentials = {
  subject: string;
  modelToken: string;
  config: HomerRuntimeConfig;
};

export type HomerCredentialBoundary = {
  gatewayOrigin: string;
  subject?: string;
  allowSyntheticLoopback?: boolean;
};

function invalid(): never { throw new Error('INVALID_REQUEST'); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) invalid();
}

function base64url(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) &&
    value.length === Math.ceil(bytes * 8 / 6) &&
    Buffer.from(value, 'base64url').length === bytes && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function allowedOrigin(origin: string, synthetic = false) {
  let url: URL;
  try { url = new URL(origin); } catch { return invalid(); }
  if (url.origin !== origin || url.username || url.password ||
    !(url.protocol === 'https:' || synthetic && url.protocol === 'http:' && url.hostname === '127.0.0.1')) invalid();
}

function validateHomerRoleConfig(input:unknown,boundary:HomerCredentialBoundary):HomerRoleConfig {
    const value=record(input);fields(value,['baseUrl','model','effort','fast','context',...(Object.hasOwn(value,'capabilities')?['capabilities']:[])]);
    if(value.baseUrl!==boundary.gatewayOrigin+'/v1'||typeof value.model!=='string'||!/^[\x21-\x7e]{1,256}$/.test(value.model)||(value.effort!==null&&!validReasoningEffort(value.effort))||value.fast!==false)invalid();
    const tuning=record(value.context);fields(tuning,['contextWindow','autoCompactTokenLimit','autoCompactTokenLimitScope']);
    if(tuning.autoCompactTokenLimitScope!=='total'||!Number.isInteger(tuning.contextWindow)||!Number.isInteger(tuning.autoCompactTokenLimit))invalid();
    let context;
    try{context=validateContextTuning(tuning);}catch{invalid();}
    let capabilities;
    try{if(Object.hasOwn(value,'capabilities'))capabilities=validateModelCapabilities(value.capabilities,value.effort as string|null);}catch{invalid();}
    return {baseUrl:value.baseUrl,model:value.model,effort:value.effort as string|null,fast:value.fast,...(capabilities?{capabilities}:{}),context:{...context,autoCompactTokenLimitScope:'total'}};
}
export function validateHomerRuntimeConfig(input:unknown,boundary:HomerCredentialBoundary):HomerRuntimeConfig {
  allowedOrigin(boundary.gatewayOrigin,boundary.allowSyntheticLoopback);
  const value=record(input);fields(value,['main','worker']);
  return {main:validateHomerRoleConfig(value.main,boundary),worker:validateHomerRoleConfig(value.worker,boundary)};
}
function validateIdentity(value:Record<string,unknown>,boundary:HomerCredentialBoundary) {
  if(typeof value.subject!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.subject)||
    typeof value.modelToken!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(value.modelToken))invalid();
  if(boundary.subject!==undefined&&boundary.subject!==value.subject)throw Error('ACCOUNT_MISMATCH');
  return {subject:value.subject,modelToken:value.modelToken};
}
// Trusted host only: never return this object through the UI bridge or log it.
export function validateHomerCredentials(input: unknown, boundary: HomerCredentialBoundary): HomerCredentials {
  const value=record(input);fields(value,['subject','modelToken','config']);
  return {...validateIdentity(value,boundary),config:validateHomerRuntimeConfig(value.config,boundary)};
}

export type HomerAuthorizationOptions = {
  websiteOrigin: string;
  redirectUri: string;
  now: () => number;
  allowSyntheticLoopback?: boolean;
};
export type HomerCallback = {method: string; host: string; target: string};
export type HomerCodeExchange = {
  grantType: 'authorization_code'; clientId: 'homer-desktop';
  code: string; codeVerifier: string; redirectUri: string;
};

// In-memory operation only. The host must acquire the listener before opening its URL.
export class HomerAuthorizationAttempt {
  private state = randomBytes(32).toString('base64url');
  private verifier = randomBytes(32).toString('base64url');
  private active = true;
  private consumed = false;
  private readonly deadline: number;
  private readonly now: () => number;
  private readonly websiteOrigin: string;
  private readonly redirectUri: string;
  private readonly callbackHost: string;

  constructor(options: HomerAuthorizationOptions) {
    allowedOrigin(options.websiteOrigin, options.allowSyntheticLoopback);
    const match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/homer\/oauth\/callback$/.exec(options.redirectUri);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) invalid();
    this.websiteOrigin = options.websiteOrigin;
    this.redirectUri = options.redirectUri;
    this.callbackHost = new URL(options.redirectUri).host;
    this.now = options.now;
    const now = this.now();
    if (!Number.isFinite(now)) invalid();
    this.deadline = now + 30 * 60000;
  }

  // Host-internal only; the public account API must never expose this URL.
  get authorizationUrl(): string {
    this.assertActive();
    if (this.consumed) throw new Error('UNAUTHORIZED');
    const query = new URLSearchParams({
      client_id: 'homer-desktop', response_type: 'code', redirect_uri: this.redirectUri,
      state: this.state, code_challenge: createHash('sha256').update(this.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return this.websiteOrigin + '/homer?' + query;
  }

  // Call again after every asynchronous wait, before storing secrets or committing.
  assertActive(): void {
    const now = this.now();
    if (!Number.isFinite(now) || now >= this.deadline) this.cancel();
    if (!this.active) throw new Error('UNAUTHORIZED');
  }

  cancel(): void {
    this.active = false;
    this.state = '';
    this.verifier = '';
  }

  acceptCallback(callback: HomerCallback): HomerCodeExchange {
    this.assertActive();
    if (this.consumed) throw new Error('UNAUTHORIZED');
    if (callback.method !== 'GET' || callback.host !== this.callbackHost ||
      !callback.target.startsWith('/homer/oauth/callback?') || callback.target.split('?')[0] !== '/homer/oauth/callback' || callback.target.includes('#')) invalid();
    const query = new URL(callback.target, this.redirectUri).searchParams;
    const names = [...query.keys()];
    if (names.length !== 2 || new Set(names).size !== names.length || !query.has('state') ||
      !(query.has('code') !== query.has('error'))) invalid();
    if (query.get('state') !== this.state) throw new Error('UNAUTHORIZED');
    if (query.has('error')) {
      if (query.get('error') !== 'access_denied') invalid();
      this.cancel();
      throw new Error('UNAUTHORIZED');
    }
    const code = query.get('code');
    if (!base64url(code, 32)) invalid();
    this.consumed = true;
    const codeVerifier = this.verifier;
    this.verifier = '';
    this.state = '';
    return {grantType: 'authorization_code', clientId: 'homer-desktop', code, codeVerifier, redirectUri: this.redirectUri};
  }
}

// Missing config retains credentials for startup refresh; legacy fields are read-only.
export type HomerConnection = {token?:string;subject:string;config?:HomerRuntimeConfig;modelBaseUrl?:string;aliases?:{main:'homer-main';worker:'homer-worker'}};
export type HomerWallet = {available:number;used:number;unit:string};

function migrateConnectionFilename(file:string,boundary:HomerCredentialBoundary):void {
  if(basename(file)!=='runtime-config.json')return;
  const legacy=join(dirname(resolve(file)),'deepseek.json'),old=lstatSync(legacy,{throwIfNoEntry:false});
  if(!old)return;
  if(!readHomerConnection(legacy,boundary))return;
  const current=lstatSync(file,{throwIfNoEntry:false});
  // Two independent files are ambiguous; only finish our interrupted hard-link move.
  if(current&&(current.dev!==old.dev||current.ino!==old.ino||!current.isFile()))throw Error('CONNECTION_FILE_INVALID');
  let directory:number|undefined;
  try{
    const parent=dirname(resolve(file)),stat=lstatSync(parent);
    if(realpathSync(parent)!==parent||!stat.isDirectory()||(process.platform==='win32'?(assertWindowsPrivate(parent),false):stat.uid!==process.getuid!()||(stat.mode&0o022)!==0))throw Error();
    clearConnectionStaging(legacy);
    // link is atomic and refuses an existing destination; never overwrite a Key.
    if(process.platform!=='win32')directory=openSync(parent,constants.O_RDONLY|constants.O_NOFOLLOW);
    if(!current)linkSync(legacy,file);
    if(directory!==undefined)fsyncSync(directory); // Persist the new name before removing the only old name.
    unlinkSync(legacy);if(directory!==undefined)fsyncSync(directory);
  }catch{throw Error('CONNECTION_WRITE_FAILED');}
  finally{if(directory!==undefined)closeSync(directory);}
}
// The sole credential file is also the attribution after a local disconnect.
export function readHomerConnection(file:string,boundary:HomerCredentialBoundary):HomerConnection|null {
  let fd:number|undefined;
  try {
    migrateConnectionFilename(file,boundary);
    const stat=lstatSync(file,{throwIfNoEntry:false});
    if(!stat)return null;
    if(realpathSync(file)!==resolve(file))throw Error();
    fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const opened=fstatSync(fd);
    if(!opened.isFile()||(process.platform==='win32'?(assertWindowsPrivate(file),opened.ino!==stat.ino||opened.dev!==stat.dev):opened.uid!==process.getuid!()||(opened.mode&0o077)!==0)||opened.size>32768)throw Error();
    const value=record(JSON.parse(readFileSync(fd,'utf8')));
    if(Object.keys(value).length===1&&Object.hasOwn(value,'token')){
      // Retired development data stays untouched until website authorization succeeds.
      return null;
    }
    const metadataFields=['subject',...(Object.hasOwn(value,'config')?['config']:Object.hasOwn(value,'modelBaseUrl')||Object.hasOwn(value,'aliases')?['modelBaseUrl','aliases']:[]),...(Object.hasOwn(value,'accountRef')?['accountRef']:[])];
    if(Object.hasOwn(value,'accountRef')&&(typeof value.accountRef!=='string'||!/^[\x21-\x7e]{1,256}$/.test(value.accountRef)))throw Error();
    fields(value,Object.hasOwn(value,'token')?['token',...metadataFields]:metadataFields);
    const {token,accountRef:_,...metadata}=value;
    if(Object.hasOwn(value,'token')&&(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token)))throw Error();
    if(!Object.hasOwn(value,'config')){
      allowedOrigin(boundary.gatewayOrigin,boundary.allowSyntheticLoopback);
      validateIdentity({...metadata,modelToken:token??'disconnected'},boundary);
      if(Object.hasOwn(metadata,'aliases')){
        const aliases=record(metadata.aliases);fields(aliases,['main','worker']);
        if(metadata.modelBaseUrl!==boundary.gatewayOrigin+'/v1'||aliases.main!=='homer-main'||aliases.worker!=='homer-worker')invalid();
      }
      return {...metadata,...(token===undefined?{}:{token})} as HomerConnection;
    }
    const config=record(metadata.config);fields(config,['main','worker']);
    if(['main','worker'].every(name=>!Object.hasOwn(record(config[name]),'context'))){
      // Recover only the old local contract; never pass its model settings to an engine.
      allowedOrigin(boundary.gatewayOrigin,boundary.allowSyntheticLoopback);
      const {subject,modelToken}=validateIdentity({...metadata,modelToken:token??'disconnected'},boundary);
      for(const name of ['main','worker']){
        const role=record(config[name]),hasTuning=Object.hasOwn(role,'deepseek');fields(role,['baseUrl','model','effort','fast',...(hasTuning?['deepseek']:[])]);
        if(role.baseUrl!==boundary.gatewayOrigin+'/v1'||role.model!=='deepseek-flash'||!['low','high','max'].includes(role.effort as string)||role.fast!==false)invalid();
        if(hasTuning){const {deepseek,...legacy}=role;validateHomerRoleConfig({...legacy,context:deepseek},boundary);}
      }
      return {subject,...(token===undefined?{}:{token:modelToken})};
    }
    const checked=validateHomerCredentials({...metadata,modelToken:token??'disconnected'},boundary);
    const {modelToken,...connection}=checked;
    return {...connection,...(token===undefined?{}:{token:modelToken})};
  }catch(error){
    if(error instanceof Error&&error.message==='CONNECTION_WRITE_FAILED')throw error;
    throw Error('CONNECTION_FILE_INVALID');
  }
  finally{if(fd!==undefined)closeSync(fd);}
}
function clearConnectionStaging(file:string):string {
  const path=join(dirname(resolve(file)),'.'+basename(file)+'.pending');
  try{
    const stat=lstatSync(path,{throwIfNoEntry:false});
    if(stat){
      if(!stat.isFile()||(process.platform==='win32'?(assertWindowsPrivate(path),false):stat.uid!==process.getuid!()||(stat.mode&0o077)!==0)||realpathSync(path)!==path)throw Error();
      unlinkSync(path);
    }
    return path;
  }catch{throw Error('CONNECTION_WRITE_FAILED');}
}
function writeConnection(file:string,value:HomerConnection) {
  const parent=dirname(resolve(file));
  let temporary:string|undefined,fd:number|undefined,created=false;
  try {
    const content=JSON.stringify(value)+'\n';
    if(Buffer.byteLength(content)>32768)throw Error();
    const stat=lstatSync(parent);
    if(realpathSync(parent)!==parent||!stat.isDirectory()||(process.platform==='win32'?(assertWindowsPrivate(parent),false):stat.uid!==process.getuid!()||(stat.mode&0o022)!==0))throw Error();
    temporary=clearConnectionStaging(file);
    fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
    writeFileSync(fd,content);fsyncSync(fd);closeSync(fd);fd=undefined;
    renameSync(temporary,file);temporary=undefined;
  }catch{throw Error('CONNECTION_WRITE_FAILED');}
  finally{if(fd!==undefined)closeSync(fd);if(temporary&&created)try{unlinkSync(temporary);}catch{}}
}
export function saveHomerConnection(file:string,input:unknown,boundary:HomerCredentialBoundary):HomerConnection {
  const previous=readHomerConnection(file,boundary);
  const {modelToken,...metadata}=validateHomerCredentials(input,{...boundary,subject:previous?.subject??boundary.subject});
  const value={...metadata,token:modelToken};writeConnection(file,value);return value;
}
export function saveHomerRuntimeConfig(file:string,input:unknown,boundary:HomerCredentialBoundary):HomerConnection {
  const config=validateHomerRuntimeConfig(input,boundary),previous=readHomerConnection(file,boundary);
  if(!previous?.subject||!previous.token)throw Error('NOT_CONNECTED');
  return saveHomerConnection(file,{subject:previous.subject,modelToken:previous.token,config},boundary);
}
export function disconnectHomerConnection(file:string,boundary:HomerCredentialBoundary):void {
  const previous=readHomerConnection(file,boundary);
  if(!previous){clearConnectionStaging(file);return;}
  const {token:_,...metadata}=previous;
  writeConnection(file,metadata);
}
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function parseHomerWallet(usage:unknown,status:unknown):HomerWallet {
  const response=record(usage),quota=record(response.data);
  // The native user_quota field belongs to the shared service wallet, never this user.
  if(response.code!==true||quota.unlimited_quota!==false||
    !number(quota.total_available)||!Number.isSafeInteger(quota.total_available)||
    !number(quota.total_used)||!Number.isSafeInteger(quota.total_used))throw Error('USAGE_UNAVAILABLE');
  let factor=1,unit='原生额度';
  try{
    const wrapper=record(status),display=record(wrapper.data);
    if(wrapper.success!==true||!number(display.quota_per_unit)||display.quota_per_unit===0)throw Error();
    switch(display.quota_display_type){
      case 'USD':factor=1/display.quota_per_unit;unit='USD';break;
      case 'CNY':if(!number(display.usd_exchange_rate)||display.usd_exchange_rate===0)throw Error();factor=display.usd_exchange_rate/display.quota_per_unit;unit='CNY';break;
      case 'CUSTOM':if(!number(display.custom_currency_exchange_rate)||display.custom_currency_exchange_rate===0||typeof display.custom_currency_symbol!=='string'||!display.custom_currency_symbol||display.custom_currency_symbol.length>32||/[\x00-\x1f\x7f]/.test(display.custom_currency_symbol))throw Error();factor=display.custom_currency_exchange_rate/display.quota_per_unit;unit=display.custom_currency_symbol;break;
      case 'TOKENS':break;
      default:throw Error();
    }
    if(!Number.isFinite(factor)||!Number.isFinite(quota.total_available*factor)||!Number.isFinite(quota.total_used*factor))throw Error();
  }catch{factor=1;unit='原生额度';}
  return {available:quota.total_available*factor,used:quota.total_used*factor,unit};
}
async function jsonRequest(url:string,options:RequestInit,authenticationStatus=false):Promise<{status:number;body:unknown}> {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.any([options.signal??new AbortController().signal,AbortSignal.timeout(20000)])});
  if(authenticationStatus&&(response.status===401||response.status===403)){
    void response.body?.cancel().catch(()=>{});
    return {status:response.status,body:null};
  }
  const reader=response.body?.getReader();if(!reader)throw Error('UNAVAILABLE');
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)throw Error('UNAVAILABLE');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  try{return {status:response.status,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};}catch{throw Error('UNAVAILABLE');}
}
export async function queryHomerRuntimeConfig(options:HomerCredentialBoundary&{websiteOrigin:string},signal?:AbortSignal):Promise<HomerRuntimeConfig> {
  allowedOrigin(options.websiteOrigin,options.allowSyntheticLoopback);
  const response=await jsonRequest(options.websiteOrigin+'/api/homer/v1/config',{signal,cache:'no-store'});
  if(response.status!==200)throw Error('UNAVAILABLE');
  return validateHomerRuntimeConfig(response.body,options);
}
export async function queryHomerWallet(connection:HomerConnection,boundary:HomerCredentialBoundary,signal?:AbortSignal):Promise<HomerWallet&{expiresAt:number}> {
  allowedOrigin(boundary.gatewayOrigin,boundary.allowSyntheticLoopback);
  if(!connection.subject||!connection.token)throw Error('NOT_CONNECTED');
  const [usage,status]=await Promise.all([
    jsonRequest(boundary.gatewayOrigin+'/api/usage/token/',{signal,headers:{Authorization:'Bearer '+connection.token}}),
    jsonRequest(boundary.gatewayOrigin+'/api/status',{signal}).catch(()=>null),
  ]);
  if(usage.status!==200)throw Error(usage.status===401||usage.status===403?'TOKEN_UNAVAILABLE':'USAGE_UNAVAILABLE');
  const expires=record(record(usage.body).data).expires_at;
  if(!number(expires)||!Number.isSafeInteger(expires))throw Error('USAGE_UNAVAILABLE');
  if(expires!==0&&expires<=Date.now()/1000)throw Error('TOKEN_UNAVAILABLE');
  try{return {...parseHomerWallet(usage.body,status?.status===200?status.body:null),expiresAt:expires};}catch{throw Error('USAGE_UNAVAILABLE');}
}

export type HomerTokenFailure = 'engine_quota_insufficient'|'engine_authentication_failed'|'engine_account_status_unconfirmed';
export async function queryHomerTokenFailure(token:string,boundary:HomerCredentialBoundary,signal?:AbortSignal):Promise<HomerTokenFailure> {
  try{
    allowedOrigin(boundary.gatewayOrigin,boundary.allowSyntheticLoopback);
    const usage=await jsonRequest(boundary.gatewayOrigin+'/api/usage/token/',{
      headers:{Authorization:'Bearer '+token},cache:'no-store',
      signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(5000)]),
    },true);
    if(usage.status===401||usage.status===403)return 'engine_authentication_failed';
    if(usage.status!==200)throw Error('USAGE_UNAVAILABLE');
    const wallet=parseHomerWallet(usage.body,null),expires=record(record(usage.body).data).expires_at;
    if(!number(expires)||!Number.isSafeInteger(expires))throw Error('USAGE_UNAVAILABLE');
    if(expires!==0&&expires<=Date.now()/1000)return 'engine_authentication_failed';
    return wallet.available===0?'engine_quota_insufficient':'engine_authentication_failed';
  }catch{return 'engine_account_status_unconfirmed';}
}

// One ephemeral listener and one exchange; the Electron owner controls single flight.
export async function authorizeHomerConnection(options:HomerCredentialBoundary&{websiteOrigin:string;file:string;signal:AbortSignal;openBrowser:(url:string)=>Promise<unknown>;onCallback?:()=>void}):Promise<HomerConnection> {
  allowedOrigin(options.websiteOrigin,options.allowSyntheticLoopback);
  allowedOrigin(options.gatewayOrigin,options.allowSyntheticLoopback);
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(30*60000)]);
  let attempt:HomerAuthorizationAttempt|undefined;
  let settle:(value:HomerCodeExchange)=>void=()=>{},fail:(error:Error)=>void=()=>{};
  const callback=new Promise<HomerCodeExchange>((accept,reject)=>{settle=accept;fail=reject;});
  // Register rejection handling before opening the browser or awaiting listen.
  void callback.catch(()=>{});
  const server=createServer((request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Content-Type','text/plain; charset=utf-8');
    try{
      if(!attempt)throw Error('UNAUTHORIZED');
      const exchange=attempt.acceptCallback({method:request.method??'',host:request.headers.host??'',target:request.url??''});
      options.onCallback?.();
      response.end('授权请求已收到，请返回 Homer 查看连接结果。此页面可以关闭。');settle(exchange);
    }catch{
      response.statusCode=400;response.end('此连接请求无效或已取消，请返回 Homer 重新连接。');
      try{attempt?.assertActive();}catch{fail(Error('UNAUTHORIZED'));}
    }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=20;
  const abort=()=>{attempt?.cancel();fail(Error('CONNECTION_CANCELLED'));server.closeAllConnections();server.close();};
  signal.addEventListener('abort',abort,{once:true});
  try{
    signal.throwIfAborted();
    await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
    signal.throwIfAborted();
    const address=server.address();if(!address||typeof address==='string')throw Error('UNAVAILABLE');
    attempt=new HomerAuthorizationAttempt({websiteOrigin:options.websiteOrigin,redirectUri:`http://127.0.0.1:${address.port}/homer/oauth/callback`,now:Date.now,allowSyntheticLoopback:options.allowSyntheticLoopback});
    await Promise.race([options.openBrowser(attempt.authorizationUrl),callback.then(()=>{})]);
    const exchange=await callback;
    attempt.assertActive();signal.throwIfAborted();
    const result=await jsonRequest(options.websiteOrigin+'/api/homer/v1/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exchange),signal});
    attempt.assertActive();signal.throwIfAborted();
    if(result.status!==200){
      let code='UNAVAILABLE';try{const error=record(record(result.body).error);if(['INVALID_REQUEST','UNAUTHORIZED','FORBIDDEN','ACCOUNT_UNAVAILABLE','CONFLICT','RATE_LIMITED','UNAVAILABLE'].includes(String(error.code)))code=String(error.code);}catch{}
      throw Error(code);
    }
    return saveHomerConnection(options.file,result.body,options);
  }catch(error){
    const code=error instanceof Error?error.message:'';
    throw Error(signal.aborted?'CONNECTION_CANCELLED':['INVALID_REQUEST','UNAUTHORIZED','FORBIDDEN','ACCOUNT_UNAVAILABLE','CONFLICT','RATE_LIMITED','UNAVAILABLE','ACCOUNT_MISMATCH','CONNECTION_FILE_INVALID','CONNECTION_WRITE_FAILED'].includes(code)?code:'UNAVAILABLE');
  }finally{
    signal.removeEventListener('abort',abort);attempt?.cancel();server.closeAllConnections();server.close();
  }
}

export function validateHomerOrigins(input:unknown,allowSyntheticLoopback=false):{websiteOrigin:string;gatewayOrigin:string} {
  const value=record(input);fields(value,['websiteOrigin','gatewayOrigin']);
  if(typeof value.websiteOrigin!=='string'||typeof value.gatewayOrigin!=='string')invalid();
  allowedOrigin(value.websiteOrigin,allowSyntheticLoopback);allowedOrigin(value.gatewayOrigin,allowSyntheticLoopback);
  return {websiteOrigin:value.websiteOrigin,gatewayOrigin:value.gatewayOrigin};
}
