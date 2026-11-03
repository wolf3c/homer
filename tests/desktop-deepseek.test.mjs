import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,symlinkSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {prepareDesktopProfile} from '../scripts/desktop-profile.mjs';
import {createDeepSeekProfile,assertDeepSeekProfile,prepareDeepSeekProfile,deepSeekConfig,promptDeepSeekToken,validateDeepSeekToken} from '../scripts/desktop-deepseek.mjs';
const parent=resolve('.codex/scratch/desktop-deepseek/unit');mkdirSync(parent,{recursive:true});
const fresh=()=>mkdtempSync(join(parent,'synthetic-'));
const version={schema:'synthetic-schema',codex:'0.163.0'};
test('dedicated profile needs a fresh private directory, refuses adoption and keeps existing conversation data',()=>{
 const root=join(fresh(),'profile');createDeepSeekProfile(root);
 assertDeepSeekProfile(root);
 const paths=prepareDeepSeekProfile(root,version);
 writeFileSync(join(paths.workspace,'retained.md'),'retained');
 assertDeepSeekProfile(root);prepareDeepSeekProfile(root,version);
 assert.equal(readFileSync(join(paths.workspace,'retained.md'),'utf8'),'retained');
 assert.throws(()=>createDeepSeekProfile(root),/EEXIST/);
 writeFileSync(join(root,'desktop-adoption.json'),'{}');
 assert.throws(()=>assertDeepSeekProfile(root),/deepseek_profile_invalid/);
});
test('unmarked, public and symlinked profiles cannot receive a credential',()=>{
 assert.throws(()=>assertDeepSeekProfile(fresh()),/deepseek_profile_invalid/);
 const root=join(fresh(),'profile');createDeepSeekProfile(root);chmodSync(root,0o755);
 assert.throws(()=>assertDeepSeekProfile(root),/deepseek_profile_invalid/);
 chmodSync(root,0o700);const link=join(fresh(),'link');symlinkSync(root,link);
 assert.throws(()=>assertDeepSeekProfile(link),/deepseek_profile_invalid/);
});
test('fixed config is shared by both roles, disables automatic first launch and contains only a credential name',()=>{
 const root=join(fresh(),'profile');createDeepSeekProfile(root);
 const paths=prepareDeepSeekProfile(root,version),config=deepSeekConfig(paths);
 assert.equal(config.model,'deepseek-flash');assert.equal(config.effort,'high');assert.equal(config.fast,false);
 assert.equal(config.baseUrl,'https://models.super-tree.com/v1');assert.equal(config.requiresOpenaiAuth,false);
 assert.equal(config.keyEnv,'HOMER_DEEPSEEK_TOKEN');assert.equal(config.nativeCodexHome,config.codexHome);
 assert.notEqual(config.runtime,join(config.appData,'runtime'));
 assert.equal(readFileSync(join(paths.codexHome,'config.toml'),'utf8'),'[memories]\ngenerate_memories = false\nuse_memories = false\n');
});
test('adopted connection preserves the original app and native home while selecting DeepSeek',()=>{
 const paths={root:'/synthetic/desktop',runtime:'/synthetic/runtime',workspace:'/synthetic/workspace',codexHome:'/synthetic/app/codex',adoption:{appData:'/synthetic/app',nativeCodexHome:'/synthetic/app/codex'}};
 const config=deepSeekConfig(paths);
 assert.equal(config.appData,'/synthetic/app');
 assert.equal(config.nativeCodexHome,'/synthetic/app/codex');
 assert.equal(config.codexHome,'/synthetic/app/codex');
 assert.equal(config.runtime,'/synthetic/runtime');
 assert.equal(config.workspace,'/synthetic/workspace');
 assert.equal(config.model,'deepseek-flash');
 assert.equal(config.effort,'high');
 assert.equal(config.fast,false);
});
test('native hidden prompt uses constant argv and returns its answer through a private pipe only',async()=>{
 const canary='synthetic-private-token',calls=[];
 const token=await promptDeepSeekToken({execFile:(bin,args,options,done)=>{
  calls.push({bin,args,options});done(null,canary+'\n','');
 }});
 assert.equal(token,canary);assert.equal(calls[0].bin,'/usr/bin/osascript');
 assert.match(calls[0].args.join(' '),/with hidden answer/);
 assert.equal(JSON.stringify(calls).includes(canary),false);
 assert.equal(calls[0].options.maxBuffer,8192);
});
test('cancel, timeout, abort and malformed output never expose native error details or a partial secret',async()=>{
 for(const failure of [{code:1}, {code:'ABORT_ERR'}, {killed:true}]){
  await assert.rejects(promptDeepSeekToken({execFile:(_b,_a,_o,done)=>done(Object.assign(Error('synthetic-private-token'),failure),'partial-private-token','private')}),e=>e.message==='deepseek_token_input_cancelled');
 }
 for(const value of ['', 'a\nb',' space','x'.repeat(4097),'秘密'])assert.throws(()=>validateDeepSeekToken(value),/deepseek_token_invalid/);
 assert.equal(validateDeepSeekToken('synthetic-token'),'synthetic-token');
});
test('profile metadata never contains a credential or touches any other directory',()=>{
 const root=join(fresh(),'profile');createDeepSeekProfile(root);
 assert.deepEqual(readdirSync(root).sort(),['.homer-desktop-deepseek','.homer-desktop-new','app-data']);
 assert.equal(JSON.parse(readFileSync(join(root,'.homer-desktop-deepseek'))).format,1);
});
test('interrupted preparation still seeds memory-off settings on retry',()=>{
 const root=join(fresh(),'profile');createDeepSeekProfile(root);
 const paths=prepareDesktopProfile(root,version); // Crash before DeepSeek seed.
 prepareDeepSeekProfile(root,version);
 assert.equal(readFileSync(join(paths.codexHome,'config.toml'),'utf8'),'[memories]\ngenerate_memories = false\nuse_memories = false\n');
});
