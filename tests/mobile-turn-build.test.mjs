import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gatewayFingerprint,buildUiCandidate,dependencyHash} from '../scripts/dev-build.mjs';

test('TURN owner or account validator edits require stable gateway restart before UI adoption',async()=>{
 for(const path of ['src/mobile-turn.ts','src/homer-account.ts']){
  const first={files:new Map([['package.json',Buffer.from('{}')],[path,Buffer.from('old')],['ui/protocol.json',Buffer.from('{"version":1}')]])};
  const baseline={deps:dependencyHash(first),webProtocol:1,gatewayHash:gatewayFingerprint(first)};
  const next={files:new Map(first.files)};next.files.set(path,Buffer.from('new'));
  await assert.rejects(buildUiCandidate('/unused','/unused',next,baseline),/dev_gateway_changed_restart_required/);
 }
});

// The candidate must carry the same gateway restart boundary as the tested source.
test('TURN desktop candidate includes the gateway fingerprint owner',async()=>{
 const {DESKTOP_CANDIDATE_PATHS}=await import('../scripts/desktop-source.mjs');
 assert.ok(DESKTOP_CANDIDATE_PATHS.includes('scripts/dev-build.mjs'));
});

test('desktop account grants TURN independently of model source without Codex model credentials',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
 const {chatgptModelConfig}=await import('../src/model-config.ts');
 const DEEPSEEK_KEY_ENV='HOMER_DEEPSEEK_TOKEN';
 const source=readFileSync(new URL('../scripts/desktop-runtime.mjs',import.meta.url),'utf8');
 const begin=source.indexOf(' if(daily&&modelSource==='),end=source.indexOf(' const database=',begin);
 assert.ok(begin>0&&end>begin);
 const config={main:{model:'deepseek-flash'},worker:{model:'deepseek-flash'}};
 for(const modelSource of ['website','codex'])for(const loggedIn of [true,false]){
  const env={},context={chatgptModelConfig,readDesktopChatGPTConfig:()=>undefined,profile:'/synthetic',daily:true,modelSource,connection:loggedIn?{token:'synthetic-token',subject:'synthetic-user',config}:null,process:{env},DEEPSEEK_KEY_ENV,manifest:{account:{gatewayOrigin:'https://example.invalid'}},test:true,paths:{root:"/synthetic"},config:{},result:null};
  runInNewContext(source.slice(begin,end)+';result={mobileTurnAccount,config,connection};',context);
  assert.equal(context.result.mobileTurnAccount?.token,loggedIn?'synthetic-token':undefined);
  assert.equal(env[DEEPSEEK_KEY_ENV],modelSource==='website'&&loggedIn?'synthetic-token':undefined);
  assert.equal(context.result.config.desktopConnection,modelSource==='website'&&loggedIn?config:undefined);
  assert.equal(context.result.connection,undefined);
 }
});
