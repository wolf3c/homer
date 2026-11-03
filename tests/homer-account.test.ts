import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,symlinkSync,rmSync,statSync,realpathSync,existsSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as account from '../src/homer-account.js';
const boundary={gatewayOrigin:'https://gateway.example.invalid'};
const runtimeConfig=()=>({main:{baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false},worker:{baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false}});
const credentials=()=>({subject:'user_a',modelToken:'synthetic-key',config:runtimeConfig()});
const api=account as any;
for(const value of [{subject:'user_a',token:'synthetic-key',config:runtimeConfig()},{subject:'user_a',config:runtimeConfig()}])test('runtime-config filename migration preserves private connection and attribution '+('token' in value?'connected':'disconnected')+' website',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-rename-'))),old=join(dir,'deepseek.json'),file=join(dir,'runtime-config.json');
 try{
  const bytes=JSON.stringify(value)+'\n';writeFileSync(old,bytes,{mode:0o600});
  assert.deepEqual(api.readHomerConnection(file,boundary),value);
  assert.equal(readFileSync(file,'utf8'),bytes);assert.equal(existsSync(old),false);assert.equal(statSync(file).mode&0o777,0o600);
  assert.deepEqual(api.readHomerConnection(file,boundary),value);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('filename migration refuses unsafe source, conflict and write failure without losing credentials',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-rename-refuse-'))),old=join(dir,'deepseek.json'),file=join(dir,'runtime-config.json');
 try{
  writeFileSync(old,JSON.stringify({token:'synthetic-old',subject:'user_a',config:runtimeConfig()}),{mode:0o644});
  assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);assert.equal(existsSync(file),false);
  chmodSync(old,0o600);symlinkSync(old,file);
  assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);rmSync(file);
  writeFileSync(file,'{"token":"synthetic-new"}',{mode:0o600});
  assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);assert.equal(readFileSync(old,'utf8'),JSON.stringify({token:'synthetic-old',subject:'user_a',config:runtimeConfig()}));assert.equal(readFileSync(file,'utf8'),'{"token":"synthetic-new"}');rmSync(file);
  chmodSync(dir,0o500);assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_WRITE_FAILED/);assert.equal(existsSync(old),true);assert.equal(existsSync(file),false);
 }finally{chmodSync(dir,0o700);rmSync(dir,{recursive:true,force:true});}
});
test('interrupted filename migration finishes the same private file and clears legacy staging',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-rename-retry-'))),old=join(dir,'deepseek.json'),file=join(dir,'runtime-config.json');
 try{
  writeFileSync(old,JSON.stringify({token:'synthetic-old',subject:'user_a',config:runtimeConfig()}),{mode:0o600});linkSync(old,file);writeFileSync(join(dir,'.deepseek.json.pending'),'synthetic-staging',{mode:0o600});
  assert.deepEqual(api.readHomerConnection(file,boundary),{token:'synthetic-old',subject:'user_a',config:runtimeConfig()});assert.equal(existsSync(old),false);assert.equal(existsSync(join(dir,'.deepseek.json.pending')),false);
  api.saveHomerConnection(file,credentials(),boundary);assert.equal(existsSync(join(dir,'.runtime-config.json.pending')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('filename migration reports inaccessible directory as a credential file error',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-rename-access-'))),file=join(dir,'runtime-config.json');
 try{
  writeFileSync(join(dir,'deepseek.json'),JSON.stringify({token:'synthetic-old',subject:'user_a',config:runtimeConfig()}),{mode:0o600});chmodSync(dir,0o000);
  assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);
 }finally{chmodSync(dir,0o700);rmSync(dir,{recursive:true,force:true});}
});
test('filename migration preserves corrupt or symlinked legacy source without adopting it',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-rename-source-'))),old=join(dir,'deepseek.json'),file=join(dir,'runtime-config.json'),other=join(dir,'other.json');
 try{
  writeFileSync(old,'{invalid-json',{mode:0o600});assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);assert.equal(readFileSync(old,'utf8'),'{invalid-json');assert.equal(existsSync(file),false);rmSync(old);
  writeFileSync(other,'{"token":"synthetic-other"}',{mode:0o600});symlinkSync(other,old);
  assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);assert.equal(readFileSync(other,'utf8'),'{"token":"synthetic-other"}');assert.equal(existsSync(file),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unsafe legacy staging blocks filename migration without removing the original Key',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-rename-staging-'))),old=join(dir,'deepseek.json'),file=join(dir,'runtime-config.json');
 try{
  writeFileSync(old,JSON.stringify({token:'synthetic-old',subject:'user_a',config:runtimeConfig()}),{mode:0o600});symlinkSync(old,join(dir,'.deepseek.json.pending'));
  assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_WRITE_FAILED/);assert.equal(readFileSync(old,'utf8'),JSON.stringify({token:'synthetic-old',subject:'user_a',config:runtimeConfig()}));assert.equal(existsSync(file),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('legacy Token survives filename migration byte for byte without a new login',()=>{
 for(const name of ['runtime-config.json','deepseek.json']){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-manual-retired-'))),old=join(dir,name),file=join(dir,'runtime-config.json');
  try{
   const bytes=JSON.stringify({token:'synthetic-development-key'});writeFileSync(old,bytes,{mode:0o600});
   const inode=statSync(old).ino;
   assert.deepEqual(api.readHomerConnection(file,boundary),{token:'synthetic-development-key'});
   assert.equal(readFileSync(file,'utf8'),bytes);assert.equal(statSync(file).ino,inode);
   if(name==='deepseek.json')assert.equal(existsSync(old),false);
   api.disconnectHomerConnection(file,boundary);assert.equal(api.readHomerConnection(file,boundary),null);
   api.saveHomerConnection(file,credentials(),boundary);
   assert.equal(api.readHomerConnection(file,boundary).subject,'user_a');
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
test('runtime-config connection validates exact fields, origins, roles and pinned subject',()=>{
 assert.deepEqual(api.validateHomerCredentials(credentials(),boundary),credentials());
 for(const changed of [{grantRef:'old'},{modelBaseUrl:'https://other.invalid/v1'},{modelToken:'bad\nkey'},{accountRef:'old-account'},{aliases:{main:'other',worker:'homer-worker'}}])assert.throws(()=>api.validateHomerCredentials({...credentials(),...changed},boundary));
 assert.throws(()=>api.validateHomerCredentials(credentials(),{...boundary,subject:'other'}),/ACCOUNT_MISMATCH/);
});
test('private atomic website file replaces a legacy Token; disconnect retains website attribution',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-account-'))),file=join(dir,'runtime-config.json');
 try{
  assert.equal(api.readHomerConnection(file,boundary),null);
  writeFileSync(file,JSON.stringify({token:'synthetic-old'}),{mode:0o600});
  assert.deepEqual(api.readHomerConnection(file,boundary),{token:'synthetic-old'});
  api.saveHomerConnection(file,credentials(),boundary);
  assert.deepEqual(api.readHomerConnection(file,boundary),{subject:'user_a',config:runtimeConfig(),token:'synthetic-key'});
  assert.equal(statSync(file).mode&0o777,0o600);
  const old=readFileSync(file,'utf8');
  assert.throws(()=>api.saveHomerConnection(file,{...credentials(),subject:'other'},boundary),/ACCOUNT_MISMATCH/);
  assert.equal(readFileSync(file,'utf8'),old);
  api.disconnectHomerConnection(file,boundary);
  const cleared=api.readHomerConnection(file,boundary);assert.equal(cleared.token,undefined);assert.equal(cleared.subject,'user_a');
  assert.throws(()=>api.saveHomerConnection(file,{...credentials(),subject:'other'},boundary),/ACCOUNT_MISMATCH/);
  writeFileSync(file,'{"token":null,"subject":"user_a","accountRef":"account_a","modelBaseUrl":"https://gateway.example.invalid/v1","aliases":{"main":"homer-main","worker":"homer-worker"}}');assert.throws(()=>api.readHomerConnection(file,boundary));
  chmodSync(file,0o644);assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);
  assert.throws(()=>api.saveHomerConnection(file,credentials(),boundary),/CONNECTION_FILE_INVALID/);
  chmodSync(file,0o600);symlinkSync(file,join(dir,'link'));assert.throws(()=>api.readHomerConnection(join(dir,'link'),boundary));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
function attempt(){let now=0;const a=new account.HomerAuthorizationAttempt({websiteOrigin:'https://website.example.invalid',redirectUri:'http://127.0.0.1:43123/homer/oauth/callback',now:()=>now});const u=new URL(a.authorizationUrl);return {a,u,setNow:(v:number)=>now=v,callback:(extra='')=>({method:'GET',host:'127.0.0.1:43123',target:'/homer/oauth/callback?code='+Buffer.alloc(32,1).toString('base64url')+'&state='+u.searchParams.get('state')+extra})};}
test('PKCE uses /homer and six fields, remains valid during purchase, consumes callback once',()=>{
 const {a,u,setNow,callback}=attempt();assert.equal(u.pathname,'/homer');assert.equal([...u.searchParams].length,6);
 setNow(29*60000);const exchange=a.acceptCallback(callback());assert.equal(exchange.clientId,'homer-desktop');
 assert.equal(createHash('sha256').update(exchange.codeVerifier).digest('base64url'),u.searchParams.get('code_challenge'));
 assert.throws(()=>a.acceptCallback(callback()));a.assertActive();a.cancel();assert.throws(()=>a.assertActive());
});
test('callback rejects wrong Host, state, absolute target, duplicates, cancellation and deadline',()=>{
 for(const mutate of [(c:any)=>({...c,host:'other'}),(c:any)=>({...c,target:c.target.replace('state=','state=wrong')}),(c:any)=>({...c,target:'http://evil.invalid'+c.target}),(c:any)=>({...c,target:c.target+'&code=extra'})]){const f=attempt();assert.throws(()=>f.a.acceptCallback(mutate(f.callback())));}
 const f=attempt();f.setNow(30*60000);assert.throws(()=>f.a.acceptCallback(f.callback()));
 const g=attempt();g.a.cancel();assert.throws(()=>g.a.acceptCallback(g.callback()));
});
test('native finite Token quota ignores any shared user wallet and preserves zero',()=>{
 const usage={code:true,data:{total_available:200,total_used:50,unlimited_quota:false,user_quota:{total_available:900000,total_used:999999}}};
 const status={success:true,data:{quota_per_unit:100,quota_display_type:'CUSTOM',custom_currency_symbol:'积分',custom_currency_exchange_rate:3}};
 assert.deepEqual(api.parseHomerWallet(usage,status),{available:6,used:1.5,unit:'积分'});
 assert.deepEqual(api.parseHomerWallet(usage,{success:false}),{available:200,used:50,unit:'原生额度'});
 assert.deepEqual(api.parseHomerWallet({code:true,data:{total_available:0,total_used:0,unlimited_quota:false}},status),{available:0,used:0,unit:'积分'});
 for(const data of [{user_quota:{total_available:200,total_used:50}},{total_available:0},{total_available:1,total_used:2},{total_available:0,total_used:2,unlimited_quota:true},{total_available:-1,total_used:2,unlimited_quota:false},{total_available:1.5,total_used:2,unlimited_quota:false},{total_available:Number.MAX_SAFE_INTEGER+1,total_used:2,unlimited_quota:false}])assert.throws(()=>api.parseHomerWallet({code:true,data},status));
 assert.throws(()=>api.parseHomerWallet({code:false,data:usage.data},status));
});

import {createServer} from 'node:http';
async function localServer(handler:import('node:http').RequestListener){
 const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as import('node:net').AddressInfo;
 return {origin:'http://127.0.0.1:'+address.port,close:()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());})};
}
test('real loopback performs exact exchange once; invalid callback cannot write, cancel during exchange ignores late success',async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-flow-'))),file=join(dir,'runtime-config.json');let posts=0,release:()=>void=()=>{};
 let hold=false;
 const website=await localServer(async(req,res)=>{
  assert.equal(req.url,'/api/homer/v1/token');assert.equal(req.method,'POST');posts++;
  let text='';for await(const chunk of req)text+=chunk;
  const body=JSON.parse(text);assert.deepEqual(Object.keys(body).sort(),['clientId','code','codeVerifier','grantType','redirectUri'].sort());
  assert.equal(body.codeVerifier.length,43);
  if(hold)await new Promise<void>(r=>release=r);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(credentials()));
 });
 try{
  const controller=new AbortController();let callbackUrl='',accepted=0;
  const connected=api.authorizeHomerConnection({...boundary,websiteOrigin:website.origin,allowSyntheticLoopback:true,file,signal:controller.signal,onCallback:()=>{accepted++;},openBrowser:async(raw:string)=>{
   const url=new URL(raw);callbackUrl=url.searchParams.get('redirect_uri')!;const state=url.searchParams.get('state');
   assert.equal((await fetch(callbackUrl+'?code='+Buffer.alloc(32,1).toString('base64url')+'&state=wrong')).status,400);
   assert.equal(accepted,0);
   assert.equal(api.readHomerConnection(file,boundary),null);
   assert.equal((await fetch(callbackUrl+'?code='+Buffer.alloc(32,1).toString('base64url')+'&state='+state)).status,200);
  }});
  await connected;assert.equal(accepted,1);assert.equal(posts,1);assert.equal(api.readHomerConnection(file,boundary).token,'synthetic-key');
  await assert.rejects(fetch(callbackUrl));
  hold=true;const cancel=new AbortController();let sent:()=>void=()=>{};const requested=new Promise<void>(r=>sent=r);
  const late=api.authorizeHomerConnection({...boundary,websiteOrigin:website.origin,allowSyntheticLoopback:true,file,signal:cancel.signal,openBrowser:async(raw:string)=>{
   const url=new URL(raw);await fetch(url.searchParams.get('redirect_uri')+'?code='+Buffer.alloc(32,2).toString('base64url')+'&state='+url.searchParams.get('state'));sent();
  }});
  await requested;while(posts<2)await new Promise(r=>setImmediate(r));cancel.abort();await assert.rejects(late,/CONNECTION_CANCELLED/);release();
  assert.equal(api.readHomerConnection(file,boundary).token,'synthetic-key');assert.equal(posts,2);
 }finally{release();await website.close();rmSync(dir,{recursive:true,force:true});}
});
test('native queries use exact origin paths, send Token only to usage, and refuse redirects',async()=>{
 let redirect=false;const seen:string[]=[];
 const gateway=await localServer((req,res)=>{
  seen.push(req.url!);
  if(req.url==='/api/status'){assert.equal(req.headers.authorization,undefined);res.end(JSON.stringify({success:false}));return;}
  assert.equal(req.url,'/api/usage/token/');assert.equal(req.headers.authorization,'Bearer synthetic-key');
  if(redirect){res.writeHead(302,{Location:'/leak'});res.end();return;}
  res.end(JSON.stringify({code:true,data:{total_available:10,total_used:2,unlimited_quota:false}}));
 });
 try{
  const b={gatewayOrigin:gateway.origin,allowSyntheticLoopback:true};
  assert.deepEqual(await api.queryHomerWallet({subject:'user_a',token:'synthetic-key'},b),{available:10,used:2,unit:'原生额度'});
  redirect=true;await assert.rejects(api.queryHomerWallet({subject:'user_a',token:'synthetic-key'},b));assert.equal(seen.includes('/leak'),false);
 }finally{await gateway.close();}
});
test('failed atomic replacement preserves old credential; private interrupted staging is recoverable',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-write-'))),file=join(dir,'runtime-config.json'),staging=join(dir,'.runtime-config.json.pending');
 try{
  writeFileSync(file,'{"token":"old-key"}',{mode:0o600});
  symlinkSync(file,staging);assert.throws(()=>api.saveHomerConnection(file,credentials(),boundary),/CONNECTION_WRITE_FAILED/);
  assert.equal(readFileSync(file,'utf8'),'{"token":"old-key"}');
  rmSync(staging);writeFileSync(staging,'interrupted-secret',{mode:0o600});api.saveHomerConnection(file,credentials(),boundary);
  assert.equal(api.readHomerConnection(file,boundary).token,'synthetic-key');assert.equal(statSync(file).mode&0o777,0o600);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('legacy credential queries only its configured gateway personal Token quota',async()=>{
 const paths:string[]=[];const gateway=await localServer((req,res)=>{
  paths.push(req.url!);if(req.url==='/api/usage/token/')assert.equal(req.headers.authorization,'Bearer synthetic-legacy');
  res.end(JSON.stringify(req.url==='/api/usage/token/'?{code:true,data:{unlimited_quota:false,total_available:9,total_used:2,user_quota:999999}}:{}));
 });
 try{assert.deepEqual(await api.queryHomerWallet({token:'synthetic-legacy'}, {gatewayOrigin:gateway.origin,allowSyntheticLoopback:true}),{available:9,used:2,unit:'原生额度'});assert.deepEqual(paths.sort(),['/api/status','/api/usage/token/']);}finally{await gateway.close();}
});
test('disconnect clears a private crash staging Key even when final is legacy or absent, but refuses foreign staging',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-disconnect-'))),file=join(dir,'runtime-config.json'),staging=join(dir,'.runtime-config.json.pending');
 try{
  for(const legacy of [true,false]){
   if(legacy)writeFileSync(file,'{"token":"old-key"}',{mode:0o600});
   writeFileSync(staging,'{"token":"interrupted-key"}',{mode:0o600});api.disconnectHomerConnection(file,boundary);
   assert.throws(()=>statSync(staging),{code:'ENOENT'});assert.equal(api.readHomerConnection(file,boundary),null);
  }
  writeFileSync(file,'{"token":"keep-key"}',{mode:0o600});symlinkSync(file,staging);
  assert.throws(()=>api.disconnectHomerConnection(file,boundary),/CONNECTION_WRITE_FAILED/);assert.equal(readFileSync(file,'utf8'),'{"token":"keep-key"}');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('runtime configuration validates every role independently without defaults or arbitrary destinations',()=>{
 assert.deepEqual(api.validateHomerRuntimeConfig(runtimeConfig(),boundary),runtimeConfig());
 for(const role of ['main','worker'])for(const change of [
  {baseUrl:'https://evil.invalid/v1'},{baseUrl:boundary.gatewayOrigin+'/v1?key=x'},
  {baseUrl:boundary.gatewayOrigin+'/v1#fragment'},{model:'unknown'},{effort:'medium'},
  {fast:true},{extra:'not-supported'},{model:undefined},
 ])assert.throws(()=>api.validateHomerRuntimeConfig({...runtimeConfig(),[role]:{...runtimeConfig()[role],...change}},boundary));
 assert.throws(()=>api.validateHomerRuntimeConfig({main:runtimeConfig().main},boundary));
});
test('public configuration GET sends no secret, bypasses cache, rejects redirects and invalid payloads',async()=>{
 let mode='good';const seen=[];
 const website=await localServer((req,res)=>{
  seen.push(req.url);assert.equal(req.method,'GET');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
  if(mode==='redirect'){res.writeHead(302,{Location:'/leak'});res.end();return;}
  if(mode==='missing'){res.writeHead(503);res.end('{}');return;}
  res.end(JSON.stringify(mode==='invalid'?{main:runtimeConfig().main}:runtimeConfig()));
 });
 try{
  const options={...boundary,websiteOrigin:website.origin,allowSyntheticLoopback:true};
  assert.deepEqual(await api.queryHomerRuntimeConfig(options),runtimeConfig());
  for(mode of ['redirect','missing','invalid'])await assert.rejects(api.queryHomerRuntimeConfig(options));
  assert.equal(seen.includes('/leak'),false);assert.ok(seen.every(p=>p==='/api/homer/v1/config'));
 }finally{await website.close();}
});
test('old website file keeps its only credential until a validated configuration is saved',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-migrate-'))),file=join(dir,'runtime-config.json');
 const old={token:'synthetic-old',subject:'user_a',accountRef:'account_a',modelBaseUrl:boundary.gatewayOrigin+'/v1',aliases:{main:'homer-main',worker:'homer-worker'}};
 try{
  writeFileSync(file,JSON.stringify(old),{mode:0o600});assert.deepEqual(api.readHomerConnection(file,boundary),{token:old.token,subject:old.subject,modelBaseUrl:old.modelBaseUrl,aliases:old.aliases});
  const bytes=readFileSync(file,'utf8');
  assert.throws(()=>api.saveHomerRuntimeConfig(file,{main:{}},boundary));assert.equal(readFileSync(file,'utf8'),bytes);
  const saved=api.saveHomerRuntimeConfig(file,runtimeConfig(),boundary);
  assert.deepEqual(saved,{token:old.token,subject:old.subject,config:runtimeConfig()});
  assert.deepEqual(api.readHomerConnection(file,boundary),saved);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('old website accountRef is read only compatibility; rewrites retain subject and remove obsolete reference',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-old-identity-'))),file=join(dir,'runtime-config.json');
 try{
  writeFileSync(file,JSON.stringify({token:'synthetic-key',subject:'user_a',accountRef:'old-gateway-account',config:runtimeConfig()}),{mode:0o600});
  assert.deepEqual(api.readHomerConnection(file,boundary),{token:'synthetic-key',subject:'user_a',config:runtimeConfig()});
  assert.throws(()=>api.saveHomerConnection(file,{...credentials(),subject:'other'},boundary),/ACCOUNT_MISMATCH/);
  api.saveHomerRuntimeConfig(file,runtimeConfig(),boundary);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(file,'utf8')),'accountRef'),false);
  api.disconnectHomerConnection(file,boundary);
  assert.deepEqual(api.readHomerConnection(file,boundary),{subject:'user_a',config:runtimeConfig()});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('disconnecting an old alias connection removes Token and accountRef while retaining readable subject',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-old-alias-disconnect-'))),file=join(dir,'runtime-config.json');
 try{
  writeFileSync(file,JSON.stringify({token:'synthetic-key',subject:'user_a',accountRef:'old-account',modelBaseUrl:boundary.gatewayOrigin+'/v1',aliases:{main:'homer-main',worker:'homer-worker'}}),{mode:0o600});
  api.disconnectHomerConnection(file,boundary);
  const saved=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(Object.hasOwn(saved,'token'),false);
  assert.equal(Object.hasOwn(saved,'accountRef'),false);
  assert.equal(saved.subject,'user_a');
  assert.deepEqual(api.readHomerConnection(file,boundary),saved);
  assert.throws(()=>api.saveHomerConnection(file,{...credentials(),subject:'other'},boundary),/ACCOUNT_MISMATCH/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
