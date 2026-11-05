import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,chmodSync,symlinkSync,rmSync,statSync,realpathSync,existsSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as account from '../src/homer-account.js';
const boundary={gatewayOrigin:'https://gateway.example.invalid'};
const runtimeConfig=()=>({main:{baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}});
const credentials=()=>({subject:'user_a',modelToken:'synthetic-key',config:runtimeConfig()});
const api=account as any;
test('membership accepts gateway model IDs, protocol efforts and explicit capabilities without brand rules',()=>{
 const capabilities={inputModalities:['text'],reasoningEfforts:['low','high'],webSearch:false,toolSearch:true};
 for(const model of ['Qwen/Qwen3-custom','vendor/future-model:latest','deepseek-flash','gpt-next'])for(const effort of ['low','medium','high','xhigh','max','ultra','vendor_adaptive',null]){
  const role={...runtimeConfig().main,model,effort};
  assert.deepEqual(api.validateHomerRuntimeConfig({main:role,worker:role},boundary),{main:role,worker:role});
 }
 const role={...runtimeConfig().main,model:'Qwen/Qwen3-custom',effort:'high',capabilities};
 const checked=api.validateHomerRuntimeConfig({main:role,worker:role},boundary);
 checked.main.capabilities.inputModalities.push('image');assert.deepEqual(capabilities.inputModalities,['text']);assert.deepEqual(checked.worker.capabilities.inputModalities,['text']);
 for(const change of [{model:''},{model:'a\nb'},{model:'x'.repeat(257)},{effort:''},{effort:'bad effort'},{effort:undefined},{fast:'false'},
  {capabilities:{...capabilities,extra:true}},{capabilities:{...capabilities,inputModalities:[]}},{capabilities:{...capabilities,inputModalities:['text','text']}},
  {capabilities:{...capabilities,reasoningEfforts:['']}},{capabilities:{...capabilities,reasoningEfforts:['low']}},{capabilities:{...capabilities,webSearch:'false'}},
  {capabilities:{...capabilities,toolSearch:undefined}},{capabilities:null}])assert.throws(()=>api.validateHomerRuntimeConfig({main:role,worker:{...role,...change}},boundary));
 const plain={...role,effort:null,capabilities:{...capabilities,reasoningEfforts:[]}};
 assert.deepEqual(api.validateHomerRuntimeConfig({main:plain,worker:plain},boundary),{main:plain,worker:plain});
});
test('membership rejects Fast independently for each role with or without capabilities',()=>{
 for(const name of ['main','worker'])for(const capabilities of [undefined,{inputModalities:['text'],reasoningEfforts:['max'],webSearch:false,toolSearch:false}]){
  const config=runtimeConfig();
  assert.throws(()=>api.validateHomerRuntimeConfig({...config,[name]:{...config[name as 'main'|'worker'],fast:true,...(capabilities?{capabilities}:{})}},boundary),/INVALID_REQUEST/);
 }
});
test('Terra membership accepts provider-neutral context and high effort without DeepSeek fields',()=>{
 const role={baseUrl:boundary.gatewayOrigin+'/v1',model:'gpt-6.1-terra',effort:'high',fast:false,context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'}};
 const config={main:structuredClone(role),worker:structuredClone(role)};
 const checked=api.validateHomerRuntimeConfig(config,boundary);assert.deepEqual(checked,config);
 checked.worker.context.contextWindow=100000;assert.equal(config.worker.context.contextWindow,272000);
 for(const change of [{effort:''},{model:''},{context:undefined},{deepseek:role.context}])assert.throws(()=>api.validateHomerRuntimeConfig({...config,worker:{...role,...change}},boundary));
});
test('maximum-sized advertised model metadata saves without losing a long existing Token',()=>{
 const parent=join(process.cwd(),'.codex/scratch/generic-membership-20261104');mkdirSync(parent,{recursive:true});
 const dir=realpathSync(mkdtempSync(join(parent,'large-'))),file=join(dir,'runtime-config.json');
 const efforts=Array.from({length:32},(_,i)=>String(i).padStart(2,'0')+'x'.repeat(62));
 const role={...runtimeConfig().main,model:'x'.repeat(256),effort:efforts[0],capabilities:{inputModalities:['text'],reasoningEfforts:efforts,webSearch:false,toolSearch:false}};
 try{api.saveHomerConnection(file,{...credentials(),modelToken:'x'.repeat(4096),config:{main:role,worker:role}},boundary);assert.equal(api.readHomerConnection(file,boundary).token.length,4096);
  const tooLarge=readFileSync(file,'utf8')+' '.repeat(32768);writeFileSync(file,tooLarge,{mode:0o600});assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);assert.equal(readFileSync(file,'utf8'),tooLarge);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('old five-field DeepSeek cache preserves credentials for Terra configuration refresh',()=>{
 const parent=join(process.cwd(),'.codex/scratch/membership-terra');mkdirSync(parent,{recursive:true});
 const dir=realpathSync(mkdtempSync(join(parent,'legacy-'))),file=join(dir,'runtime-config.json');
 const role={baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false,deepseek:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'}};
 const bytes=JSON.stringify({subject:'user_a',token:'synthetic-retained',config:{main:role,worker:role}});
 try{
  writeFileSync(file,bytes,{mode:0o600});
  assert.deepEqual(api.readHomerConnection(file,boundary),{subject:'user_a',token:'synthetic-retained'});assert.equal(readFileSync(file,'utf8'),bytes);
  const next={baseUrl:role.baseUrl,model:'gpt-6.1-terra',effort:'high',fast:false,context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'}};
  const saved=api.saveHomerRuntimeConfig(file,{main:next,worker:next},boundary);
  assert.equal(saved.token,'synthetic-retained');assert.deepEqual(saved.config,{main:next,worker:next});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
for(const [label,data,expected] of [
 ['zero',{total_available:0,total_used:0,unlimited_quota:false,expires_at:0},'engine_quota_insufficient'],
 ['positive',{total_available:10,total_used:0,unlimited_quota:false,expires_at:0},'engine_authentication_failed'],
 ['expired zero',{total_available:0,total_used:0,unlimited_quota:false,expires_at:1},'engine_authentication_failed'],
 ['future expiry',{total_available:0,total_used:0,unlimited_quota:false,expires_at:4102444800},'engine_quota_insufficient'],
 ['missing expiry',{total_available:0,total_used:0,unlimited_quota:false},'engine_account_status_unconfirmed'],
 ['invalid balance',{total_available:-1,total_used:0,unlimited_quota:false,expires_at:0},'engine_account_status_unconfirmed'],
 ['unlimited',{total_available:0,total_used:0,unlimited_quota:true,expires_at:0},'engine_account_status_unconfirmed'],
] as const)test('failed model authentication checks fresh native usage: '+label,async()=>{
 const seen:string[]=[];const gateway=await localServer((req,res)=>{seen.push(req.url!);assert.equal(req.headers.authorization,'Bearer synthetic-key');res.end(JSON.stringify({code:true,data}));});
 try{assert.equal(await api.queryHomerTokenFailure('synthetic-key',{gatewayOrigin:gateway.origin,allowSyntheticLoopback:true}),expected);assert.deepEqual(seen,['/api/usage/token/']);}finally{await gateway.close();}
});
for(const status of [401,403,500,302])test('failed model usage status '+status+' never invents zero credit or follows redirects',async()=>{
 const seen:string[]=[];const gateway=await localServer((req,res)=>{seen.push(req.url!);res.writeHead(status,{Location:'/leak'});res.end('{}');});
 try{assert.equal(await api.queryHomerTokenFailure('synthetic-key',{gatewayOrigin:gateway.origin,allowSyntheticLoopback:true}),status===401||status===403?'engine_authentication_failed':'engine_account_status_unconfirmed');assert.deepEqual(seen,['/api/usage/token/']);}finally{await gateway.close();}
});
for(const status of [401,403])for(const body of [null,'Unauthorized','x'.repeat(65537)])test('failed model authentication retains HTTP '+status+' without requiring a JSON error body: '+(body?.length??0),async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(body,{status}));
 assert.equal(await api.queryHomerTokenFailure('synthetic-key',boundary),'engine_authentication_failed');
});
test('failed model usage checks are bounded and never expose transport diagnostics',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:RequestInfo|URL,init?:RequestInit)=>{calls++;assert.equal(init?.redirect,'error');assert.ok(init?.signal);throw Error('PRIVATE_TOKEN_DIAGNOSTICS');});
 assert.equal(await api.queryHomerTokenFailure('synthetic-key',boundary),'engine_account_status_unconfirmed');assert.equal(calls,1);
});
test('failed model usage check stops after its five second deadline',async t=>{
 t.mock.method(globalThis,'fetch',async(_url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})));
 const keepAlive=setInterval(()=>{},1000),started=Date.now();
 try{assert.equal(await api.queryHomerTokenFailure('synthetic-key',boundary),'engine_account_status_unconfirmed');assert.ok(Date.now()-started<7000);}finally{clearInterval(keepAlive);}
});
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
test('manual Token files cannot connect or migrate; website authorization replaces only after validation',()=>{
 for(const name of ['runtime-config.json','deepseek.json']){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-manual-retired-'))),old=join(dir,name),file=join(dir,'runtime-config.json');
  try{
   const bytes=JSON.stringify({token:'synthetic-development-key'});writeFileSync(old,bytes,{mode:0o600});
   assert.equal(api.readHomerConnection(file,boundary),null);
   assert.equal(readFileSync(old,'utf8'),bytes);
   assert.throws(()=>api.saveHomerConnection(file,{...credentials(),modelToken:'invalid\nkey'},boundary));
   assert.equal(readFileSync(old,'utf8'),bytes);
   api.saveHomerConnection(file,credentials(),boundary);
   assert.equal(api.readHomerConnection(file,boundary).subject,'user_a');
   if(name==='deepseek.json')assert.equal(readFileSync(old,'utf8'),bytes);
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
  assert.equal(api.readHomerConnection(file,boundary),null);
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
  const controller=new AbortController();let callbackUrl='',accepted=0,browser:Promise<void>|undefined;
  const connected=api.authorizeHomerConnection({...boundary,websiteOrigin:website.origin,allowSyntheticLoopback:true,file,signal:controller.signal,onCallback:()=>{accepted++;},openBrowser:(raw:string)=>browser=(async()=>{
   const url=new URL(raw);callbackUrl=url.searchParams.get('redirect_uri')!;const state=url.searchParams.get('state');
   assert.equal((await fetch(callbackUrl+'?code='+Buffer.alloc(32,1).toString('base64url')+'&state=wrong')).status,400);
   assert.equal(accepted,0);
   assert.equal(api.readHomerConnection(file,boundary),null);
   const response=await fetch(callbackUrl+'?code='+Buffer.alloc(32,1).toString('base64url')+'&state='+state);
   assert.equal(response.status,200);
   assert.equal(await response.text(),'授权请求已收到，请返回 Homer 查看连接结果。此页面可以关闭。');
  })()});
  await connected;await browser;assert.equal(accepted,1);assert.equal(posts,1);assert.equal(api.readHomerConnection(file,boundary).token,'synthetic-key');
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
  res.end(JSON.stringify({code:true,data:{total_available:10,total_used:2,unlimited_quota:false,expires_at:0}}));
 });
 try{
  const b={gatewayOrigin:gateway.origin,allowSyntheticLoopback:true};
  assert.deepEqual(await api.queryHomerWallet({subject:'user_a',token:'synthetic-key'},b),{available:10,used:2,unit:'原生额度',expiresAt:0});
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
test('manual Token cannot query a wallet without a website account',async()=>{
 const paths:string[]=[];const gateway=await localServer((req,res)=>{paths.push(req.url!);res.end('{}');});
 try{await assert.rejects(api.queryHomerWallet({token:'synthetic-development-key'},{gatewayOrigin:gateway.origin,allowSyntheticLoopback:true}),/NOT_CONNECTED/);assert.deepEqual(paths,[]);}finally{await gateway.close();}
});
test('disconnect preserves retired Token files and clears private staging even when final is absent, but refuses foreign staging',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'homer-disconnect-'))),file=join(dir,'runtime-config.json'),staging=join(dir,'.runtime-config.json.pending');
 try{
  for(const legacy of [true,false]){
   if(legacy)writeFileSync(file,'{"token":"old-key"}',{mode:0o600});
   writeFileSync(staging,'{"token":"interrupted-key"}',{mode:0o600});api.disconnectHomerConnection(file,boundary);
   assert.throws(()=>statSync(staging),{code:'ENOENT'});assert.equal(api.readHomerConnection(file,boundary),null);
   if(legacy){assert.equal(readFileSync(file,'utf8'),'{"token":"old-key"}');rmSync(file);}
   else assert.equal(existsSync(file),false);
  }
  writeFileSync(file,'{"token":"keep-key"}',{mode:0o600});symlinkSync(file,staging);
  assert.throws(()=>api.disconnectHomerConnection(file,boundary),/CONNECTION_WRITE_FAILED/);assert.equal(readFileSync(file,'utf8'),'{"token":"keep-key"}');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('runtime configuration validates every role independently without defaults or arbitrary destinations',()=>{
 assert.deepEqual(api.validateHomerRuntimeConfig(runtimeConfig(),boundary),runtimeConfig());
 for(const name of ['main','worker'] as const)for(const effort of ['low','high','max']){
  const config={...runtimeConfig(),[name]:{...runtimeConfig()[name],effort}};
  assert.deepEqual(api.validateHomerRuntimeConfig(config,boundary),config);
 }
 for(const role of ['main','worker'] as const)for(const change of [
  {baseUrl:'https://evil.invalid/v1'},{baseUrl:boundary.gatewayOrigin+'/v1?key=x'},
  {baseUrl:boundary.gatewayOrigin+'/v1#fragment'},{model:''},{effort:12},
  {effort:'bad effort'},{effort:''},{effort:undefined},{effort:['high']},
  {fast:null},{extra:'not-supported'},{model:undefined},
 ])assert.throws(()=>api.validateHomerRuntimeConfig({...runtimeConfig(),[role]:{...runtimeConfig()[role],...change}},boundary));
 assert.throws(()=>api.validateHomerRuntimeConfig({main:runtimeConfig().main},boundary));
});
test('membership context delivery is required, bounded and copied independently per role',()=>{
 const config=runtimeConfig() as any;
 for(const role of ['main','worker'])config[role].context={contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'};
 const checked=api.validateHomerRuntimeConfig(config,boundary);
 assert.deepEqual(checked,config);
 checked.main.context.contextWindow=600000;
 assert.equal(config.main.context.contextWindow,512000);
 for(const role of ['main','worker'])for(const context of [undefined,null,{},
  {contextWindow:512000,autoCompactTokenLimit:460801,autoCompactTokenLimitScope:'total'},
  {contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'body_after_prefix'},
  {contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total',extra:true},
  {contextWindow:1048577,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},
  {contextWindow:512000,autoCompactTokenLimit:0,autoCompactTokenLimitScope:'total'}
 ])assert.throws(()=>api.validateHomerRuntimeConfig({...config,[role]:{...config[role],context}},boundary));
});
for(const filename of ['runtime-config.json','deepseek.json'])for(const connected of [true,false])test('old four-field membership cache retains identity for refresh: '+filename+' '+connected,()=>{
 const parent=join(process.cwd(),'.codex/scratch/membership-context-cache');
 mkdirSync(parent,{recursive:true});
 const dir=realpathSync(mkdtempSync(join(parent,'read-'))),file=join(dir,'runtime-config.json');
 const role={baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false};
 const old={subject:'user_a',accountRef:'old-account',config:{main:role,worker:role},...(connected?{token:'synthetic-key'}:{})};
 try{
  const bytes=JSON.stringify(old);writeFileSync(join(dir,filename),bytes,{mode:0o600});
  assert.deepEqual(api.readHomerConnection(file,boundary),{subject:'user_a',...(connected?{token:'synthetic-key'}:{})});
  assert.equal(readFileSync(file,'utf8'),bytes);
  assert.throws(()=>api.validateHomerRuntimeConfig(old.config,boundary));
  assert.throws(()=>api.saveHomerConnection(file,{...credentials(),subject:'other'},boundary),/ACCOUNT_MISMATCH/);
  if(connected){
   assert.throws(()=>api.saveHomerRuntimeConfig(file,{...runtimeConfig(),worker:role},boundary));
   assert.equal(readFileSync(file,'utf8'),bytes);
   api.saveHomerRuntimeConfig(file,runtimeConfig(),boundary);
   assert.deepEqual(api.readHomerConnection(file,boundary),{subject:'user_a',token:'synthetic-key',config:runtimeConfig()});
  }else assert.throws(()=>api.saveHomerRuntimeConfig(file,runtimeConfig(),boundary),/NOT_CONNECTED/);
  // Explicit disconnect must remain readable and keep account attribution.
  api.disconnectHomerConnection(file,boundary);
  assert.equal(api.readHomerConnection(file,boundary).subject,'user_a');
  assert.equal(api.readHomerConnection(file,boundary).token,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('old membership cache recovery rejects malformed roles and unsafe credentials',()=>{
 const parent=join(process.cwd(),'.codex/scratch/membership-context-cache');mkdirSync(parent,{recursive:true});
 const dir=realpathSync(mkdtempSync(join(parent,'invalid-'))),file=join(dir,'runtime-config.json');
 const role={baseUrl:boundary.gatewayOrigin+'/v1',model:'deepseek-flash',effort:'max',fast:false};
 const old={subject:'user_a',token:'synthetic-key',config:{main:role,worker:role}};
 try{
  for(const value of [
   {...old,token:'bad\nkey'},{...old,subject:''},
   ...[{baseUrl:'https://other.invalid/v1'},{fast:true},{extra:true},{deepseek:null},{model:'other'},{effort:'xhigh'}].map(change=>({...old,config:{main:role,worker:{...role,...change}}})),
   {...old,config:{main:role,worker:runtimeConfig().worker}},
  ]){const bytes=JSON.stringify(value);writeFileSync(file,bytes,{mode:0o600});assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);assert.equal(readFileSync(file,'utf8'),bytes);}
  writeFileSync(file,JSON.stringify(old),{mode:0o600});
  assert.throws(()=>api.readHomerConnection(file,{...boundary,subject:'other'}),/CONNECTION_FILE_INVALID/);
  chmodSync(file,0o644);assert.throws(()=>api.readHomerConnection(file,boundary),/CONNECTION_FILE_INVALID/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('public configuration GET sends no secret, bypasses cache, rejects redirects and invalid payloads',async()=>{
 let mode='good';const seen:(string|undefined)[]=[];
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

for(const [name,expires,expected] of [['no expiry',0,null],['future',4102444800,null],['expired',1,'TOKEN_UNAVAILABLE'],['missing',undefined,'USAGE_UNAVAILABLE'],['invalid',-1,'USAGE_UNAVAILABLE']] as const)test('wallet query verifies credential expiry before offering purchase: '+name,async()=>{
 const gateway=await localServer((req,res)=>res.end(JSON.stringify(req.url==='/api/status'?{success:false}:{code:true,data:{total_available:0,total_used:0,unlimited_quota:false,expires_at:expires}})));
 try{const result=api.queryHomerWallet({subject:'synthetic-user',token:'synthetic-key'},{gatewayOrigin:gateway.origin,allowSyntheticLoopback:true});if(expected)await assert.rejects(result,new RegExp(expected));else{const wallet=await result;assert.equal(wallet.available,0);assert.equal(wallet.expiresAt,expires);}}finally{await gateway.close();}
});
