import {createHash} from 'node:crypto';
// Opt-in real 163 -> owners' running isolated AMH -> scripted local upstream.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexEngine,codexVersion} from '../src/engine.ts';
import {readHomerConnection} from '../src/homer-account.ts';

const gateway=process.env.HOMER_TEST_GATEWAY_ORIGIN??'http://127.0.0.1:3182';
const binary=process.env.HOMER_TEST_CODEX,file=process.env.HOMER_TEST_CONNECTION,disabled=process.env.HOMER_TEST_EXPECT_DISABLED==='1';
test('website-delivered synthetic Key runs real Codex main and Worker through AMH',{skip:!binary||!file||disabled,timeout:60000},async t=>{
 assert.ok(resolve(file).includes('/.codex/scratch/account-mvp/three-projects/'));assert.ok(file.endsWith('/runtime-config.json')||file.endsWith('/deepseek.json'));// Historical synthetic profiles retain their original path.
 const connection=readHomerConnection(resolve(file),{gatewayOrigin:gateway,allowSyntheticLoopback:true});
 assert.ok(connection?.subject&&connection.token);assert.equal(codexVersion(binary),'codex-cli 0.163.0');
 const bundle=resolve(binary).split('/Contents/')[0];assert.ok(bundle.endsWith('.app'),'use the pinned packaged engine');
 const desktopResources={bundleRoot:bundle,manifestSha256:createHash('sha256').update(readFileSync(join(bundle,'Contents/Resources/desktop-manifest.json'))).digest('hex')};
 const parent=resolve('.codex/scratch/account-mvp/gateway-native');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-'));for(const part of ['runtime','workspace','codex'])mkdirSync(join(root,part),{mode:0o700});
 const keys=['HOMER_DEEPSEEK_TOKEN','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{HOMER_DEEPSEEK_TOKEN:connection.token,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1'});
 try{
  for(const role of ['main','worker']){
   const engine=new CodexEngine({appData:root,runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:binary,model:connection.config[role].model,baseUrl:connection.config[role].baseUrl,keyEnv:'HOMER_DEEPSEEK_TOKEN',effort:'max',fast:false,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources,desktopConnection:connection.config,requiresOpenaiAuth:false,stopGraceMs:3000},{role,cwd:join(root,'workspace'),readRoots:[],instructions:'Synthetic scripted local acceptance only.',tools:[],nativeTools:role,onInteraction:async()=>({status:'denied',decision:{action:'deny',reason:'synthetic_unexpected_approval'}})},async()=>{throw Error('unexpected_host_tool');});
   try{
    await engine.start();const result=await engine.turn('Synthetic local '+role+' file acceptance.');assert.equal(result.status,'completed');
    assert.equal(readFileSync(join(root,'workspace',role+'.md'),'utf8'),'native-'+role);
   }finally{assert.equal(await engine.close(),true);}
  }
  t.diagnostic(JSON.stringify({synthetic:true,real163:true,actualAmh:true,scriptedUpstream:true,roles:['main','worker'],filesDelivered:true}));
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('disabled synthetic Key cannot start a new Responses request',{skip:!file||!disabled,timeout:10000},async()=>{
 assert.ok(resolve(file).includes('/.codex/scratch/account-mvp/three-projects/'));assert.ok(file.endsWith('/runtime-config.json')||file.endsWith('/deepseek.json'));// Historical synthetic profiles retain their original path.
 const connection=readHomerConnection(resolve(file),{gatewayOrigin:gateway,allowSyntheticLoopback:true});assert.ok(connection?.token);
 const result=await fetch(connection.config.main.baseUrl+'/responses',{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify({model:connection.config.main.model,input:'Synthetic disabled-key canary.',stream:true,reasoning:{effort:connection.config.main.effort}}),redirect:'error',signal:AbortSignal.timeout(5000)});
 try{assert.ok([401,403].includes(result.status),'native authentication must reject before model execution');}finally{await result.body?.cancel();}
});
