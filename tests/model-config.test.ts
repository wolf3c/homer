import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fork,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {loadConfig,effectiveModelConfig,type Config} from '../src/config.js';
import {deepseekProfile} from '../src/deepseek-model.js';
import {CodexEngine,type EngineOptions} from '../src/engine.js';

const scratch=resolve('.codex/scratch/homer-main-medium-20261027/model-config-tests');
test('daily desktop uses website roles only and has no model endpoint before login',()=>{
 const original={workspace:'/synthetic/work',runtime:'/synthetic/runtime',codexHome:'/synthetic/codex',codexBin:'/synthetic/codex-bin',model:'original-model',baseUrl:'https://old.invalid/v1',requiresOpenaiAuth:true,stopGraceMs:3000,desktopResources:{bundleRoot:'/synthetic/app',manifestSha256:'a'.repeat(64)},dailyDeepSeek:true,pauseOldDesktopWork:true} as Config;
 const inactive=effectiveModelConfig(original);
 assert.equal(inactive.baseUrl,undefined);
 assert.equal(inactive.keyEnv,'HOMER_DEEPSEEK_TOKEN');assert.equal(inactive.requiresOpenaiAuth,false);
 assert.equal(original.baseUrl,'https://old.invalid/v1');assert.equal(original.requiresOpenaiAuth,true);
 assert.throws(()=>effectiveModelConfig({...original,desktopResources:undefined}),/daily_deepseek_desktop_required/);
 const role={baseUrl:'https://models.super-tree.com/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false} as const;
 const effective=effectiveModelConfig({...original,desktopConnection:{main:role,worker:role}});
 assert.equal(effective.workspace,original.workspace);assert.equal(effective.codexHome,original.codexHome);
 assert.equal(effective.model,'deepseek-flash');assert.equal(effective.effort,'max');assert.equal(effective.fast,false);
 assert.equal(effective.baseUrl,'https://models.super-tree.com/v1');
});
mkdirSync(scratch,{recursive:true});
function fixture(){
  const dir=mkdtempSync(join(scratch,'case-'));
  const raw={appData:join(dir,'data'),nativeCodexHome:join(dir,'home'),codexBin:process.execPath,workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'home')};
  for(const path of [raw.workspace,raw.runtime,raw.codexHome])mkdirSync(path);
  const path=join(dir,'config.json');
  return {dir,raw,read(extra:Record<string,unknown>={}){writeFileSync(path,JSON.stringify({...raw,...extra}));return loadConfig(path);},close(){rmSync(dir,{recursive:true,force:true});}};
}

// Exercise the user-facing startup projections with real Homer processes and
// the local protocol fixture, on both first start and same-thread restart.
const loader=createRequire(import.meta.url).resolve('tsx/esm');
const syntheticImports=['--import',new URL('./fixtures/core-system-proxy.mjs',import.meta.url).href,'--import',loader];
for(const effort of [undefined,'low'] as const)for(const entry of ['cli','dev-host'] as const){
  test(`${entry} announces effective main effort ${effort??'medium'} on new and restored startup`,async()=>{
    const f=fixture();
    const config:Config={...f.raw,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'gpt-6.1-sol',requiresOpenaiAuth:false,stopGraceMs:100,...(effort?{effort}:{})};
    const env={PATH:process.env.PATH,HOME:join(f.dir,'host-home'),LANG:'en_US.UTF-8'};
    const path=join(f.dir,'startup.json');writeFileSync(path,JSON.stringify(config));
    try{
      for(const restoring of [false,true]){
        if(entry==='cli'){
          const run=spawnSync(process.execPath,[...syntheticImports,resolve('src/cli.ts'),'--config',path,'--json','--message','Synthetic startup check'],{env,encoding:'utf8',timeout:10000});
          assert.equal(run.status,0,run.stderr+run.stdout);
          const messages=run.stdout.trim().split('\n').map(line=>JSON.parse(line));
          assert.ok(messages.some(m=>m.type==='progress'&&m.text.includes(`gpt-6.1-sol，${effort??'medium'}，Fast 请求开启`)));
          assert.ok(messages.some(m=>m.type==='progress'&&m.text.includes(restoring?'已恢复原主对话':'已建立首次主对话')));
          const actual=JSON.parse(messages.find(m=>m.type==='reply').text);
          assert.equal(actual.effort,effort??'medium');assert.equal(actual.threadMethod,restoring?'thread/resume':'thread/start');
        }else{
          const child=fork(resolve('src/dev-host.ts'),[],{execArgv:syntheticImports,env,stdio:['ignore','ignore','pipe','ipc']});
          const exited=new Promise<number|null>(accept=>child.once('exit',accept));
          let timer:ReturnType<typeof setTimeout>|undefined;
          try{
            const ready=await new Promise<any>((accept,reject)=>{
              timer=setTimeout(()=>reject(Error('synthetic_host_start_timeout')),10000);
              child.on('error',reject);
              child.on('exit',code=>reject(Error('synthetic_host_exit:'+code)));
              child.on('message',(m:any)=>{
                if(m.kind==='output')child.send({kind:'written',id:m.id});
                if(m.kind==='fatal')reject(Error(m.code));
                if(m.kind==='ready')accept(m);
              });
              child.send({kind:'init',config});
            });
            assert.equal(ready.effort,effort??'medium');assert.equal(ready.restoring,restoring);assert.equal(ready.model,config.model);
          }finally{
            if(timer)clearTimeout(timer);
            if(child.connected)child.send({kind:'stop'});
            const stopTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
            try{assert.equal(await exited,0);}finally{clearTimeout(stopTimer);}
          }
        }
      }
    }finally{f.close();}
  });
}
const envKeys=['HOMER_MODEL','HOMER_EFFORT','HOMER_FAST','HOMER_CODEX_BASE_URL','HOMER_CODEX_KEY_ENV','HOMER_CODEX_BIN','HOMER_CODEX_HOME','HOMER_DATA_HOME','HOMER_NATIVE_CODEX_HOME'];
test('DeepSeek startup rejects missing catalog metadata and closes its child before returning',async()=>{
 const f=fixture();
 const engine=new CodexEngine({...f.raw,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'deepseek-flash',baseUrl:'http://127.0.0.1:9999/v1',requiresOpenaiAuth:false,stopGraceMs:100},{cwd:f.raw.workspace,readRoots:[],instructions:'Synthetic metadata check',tools:[]},async()=>({}));
 const request=engine['request'].bind(engine);
 engine['request']=async(method:string,params:any)=>method==='model/list'?{data:[]}:request(method,params);
 try{await assert.rejects(()=>engine.start(),/engine_deepseek_catalog_mismatch/);assert.equal(engine['exited'],true);}
 finally{await engine.close();f.close();}
});
function cleanEnvironment(work:()=>void){
  const saved=envKeys.map(key=>[key,process.env[key]] as const);
  try{for(const key of envKeys)delete process.env[key];work();}
  finally{for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

test('product defaults leave effort unset for GPT 6.1 role defaults and native authentication without an API key',()=>cleanEnvironment(()=>{
  const f=fixture();try{
    const config=f.read();
    assert.equal(config.model,'gpt-6.1-sol');assert.equal(config.effort,undefined);
    assert.equal(config.fast,undefined); // Main/Worker defaults resolve at execution, after explicit overrides.
    assert.equal(config.baseUrl,undefined);assert.equal(config.keyEnv,undefined);assert.equal(config.requiresOpenaiAuth,true);
  }finally{f.close();}
}));

test('DeepSeek loaded configuration enforces the scope-specific compaction contract',()=>cleanEnvironment(()=>{
 const f=fixture();try{
  const connection={model:'deepseek-flash',baseUrl:'http://127.0.0.1:9999/v1'};
  assert.equal(deepseekProfile(f.read(connection))?.autoCompactTokenLimit,244800);
  assert.equal(deepseekProfile(f.read({...connection,deepseek:{contextWindow:100000}}))?.autoCompactTokenLimit,90000);
  assert.equal(deepseekProfile(f.read({...connection,deepseek:{autoCompactTokenLimit:244800}}))?.autoCompactTokenLimit,244800);
  assert.throws(()=>f.read({...connection,deepseek:{autoCompactTokenLimit:244801}}),/invalid_model_auto_compact_token_limit/);
  assert.equal(deepseekProfile(f.read({...connection,deepseek:{autoCompactTokenLimitScope:'body_after_prefix',autoCompactTokenLimit:250000}}))?.autoCompactTokenLimit,250000);
 }finally{f.close();}
}));

test('Fast accepts explicit booleans and environment wins over local configuration',()=>cleanEnvironment(()=>{
  const f=fixture();try{
    for(const fast of [true,false])assert.equal(f.read({fast}).fast,fast);
    process.env.HOMER_FAST='false';assert.equal(f.read({fast:true}).fast,false);
    process.env.HOMER_FAST='true';assert.equal(f.read({fast:false}).fast,true);
    for(const invalid of ['false',0,null])assert.throws(()=>f.read({fast:invalid}),/invalid_fast/);
    for(const invalid of ['','0','1','TRUE','yes']){
      process.env.HOMER_FAST=invalid;assert.throws(()=>f.read(),/invalid_fast/);
    }
  }finally{f.close();}
}));

for(const role of [undefined,'main','worker'] as const)for(const resume of [false,true])for(const fast of [undefined,true,false]){
  test(`${role} ${resume?'resume':'new'} requests Fast ${fast??'by default'} on every turn`,async()=>{
    const f=fixture();
    const config:Config={...f.raw,nativeCodexHome:f.raw.codexHome,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'gpt-6.1-sol',...(fast===undefined?{}:{fast}),requiresOpenaiAuth:false,stopGraceMs:100};
    const engine=new CodexEngine(config,{role,cwd:f.raw.workspace,readRoots:[],instructions:'Synthetic protocol fixture',tools:[],nativeTools:role,...(resume?{threadId:'synthetic-model-thread'}:{})},async()=>({}));
    try{
      await engine.start();
      for(let turn=0;turn<2;turn++){
        const result=JSON.parse((await engine.turn('Synthetic protocol check')).text);
        assert.equal(result.threadMethod,resume?'thread/resume':'thread/start');
        assert.equal(result.threadServiceTier,(fast??true)?'priority':null);
        assert.equal(result.turnServiceTier,(fast??true)?'priority':null);
        assert.equal(result.model,'gpt-6.1-sol');assert.equal(result.effort,role==='worker'?'high':'medium');
      }
    }finally{await engine.close();f.close();}
  });
}

test('a model whose native catalog explicitly excludes Fast fails before a turn',async()=>{
  const f=fixture();
  const engine=new CodexEngine({...f.raw,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-standard-only',requiresOpenaiAuth:false,stopGraceMs:100},{cwd:f.raw.workspace,readRoots:[],instructions:'Synthetic protocol fixture',tools:[]},async()=>({}));
  try{await assert.rejects(()=>engine.start(),/engine_fast_unavailable/);}finally{await engine.close();f.close();}
});

test('explicitly disabling Fast allows a standard-only model without changing its selection',async()=>{
  const f=fixture();
  const engine=new CodexEngine({...f.raw,fast:false,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),model:'synthetic-standard-only',requiresOpenaiAuth:false,stopGraceMs:100},{cwd:f.raw.workspace,readRoots:[],instructions:'Synthetic protocol fixture',tools:[]},async()=>({}));
  try{
    await engine.start();const result=JSON.parse((await engine.turn('Synthetic protocol check')).text);
    assert.equal(result.model,'synthetic-standard-only');assert.equal(result.turnServiceTier,null);
  }finally{await engine.close();f.close();}
});

test('explicit local connection and reasoning settings override product defaults',()=>cleanEnvironment(()=>{
  const f=fixture();try{
    const config=f.read({model:'explicit-model',effort:'low',baseUrl:'https://provider.example/v1',keyEnv:'SYNTHETIC_MODEL_KEY',requiresOpenaiAuth:false});
    assert.equal(config.model,'explicit-model');assert.equal(config.effort,'low');
    assert.equal(config.baseUrl,'https://provider.example/v1');assert.equal(config.keyEnv,'SYNTHETIC_MODEL_KEY');assert.equal(config.requiresOpenaiAuth,false);
    assert.equal(Object.hasOwn(config,'key'),false);
  }finally{f.close();}
}));

test('explicit environment overrides local values without changing the local authentication choice',()=>cleanEnvironment(()=>{
  const f=fixture();try{
    process.env.HOMER_MODEL='environment-model';process.env.HOMER_EFFORT='high';
    process.env.HOMER_CODEX_BASE_URL='https://environment.example/v1';process.env.HOMER_CODEX_KEY_ENV='SYNTHETIC_ENV_KEY';
    const config=f.read({model:'local-model',effort:'low',baseUrl:'https://local.example/v1',keyEnv:'SYNTHETIC_LOCAL_KEY',requiresOpenaiAuth:false});
    assert.equal(config.model,'environment-model');assert.equal(config.effort,'high');
    assert.equal(config.baseUrl,'https://environment.example/v1');assert.equal(config.keyEnv,'SYNTHETIC_ENV_KEY');assert.equal(config.requiresOpenaiAuth,false);
  }finally{f.close();}
}));

test('invalid effort, credential-bearing URLs and invalid key references retain existing validation',()=>cleanEnvironment(()=>{
  const f=fixture();try{
    for(const effort of ['unsupported','',false,0])assert.throws(()=>f.read({effort}),/invalid_effort/);
    process.env.HOMER_EFFORT='unsupported';assert.throws(()=>f.read({effort:'medium'}),/invalid_effort/);delete process.env.HOMER_EFFORT;
    assert.throws(()=>f.read({baseUrl:'https://user:password@provider.example/v1'}),/invalid_provider_url/);
    assert.throws(()=>f.read({keyEnv:'not a variable name'}),/invalid_key_env/);
  }finally{f.close();}
}));

for(const role of [undefined,'main','worker'] as const)for(const resume of [false,true])for(const effort of [undefined,'low','medium','high','xhigh','max','ultra'] as const){
  test(role+' engine '+(resume?'resume':'new')+' transmits '+(effort??'role default')+' on every turn',async()=>{
    const f=fixture();
    const config:Config={...f.raw,codexBin:resolve('tests/fixtures/mock-app-server.mjs'),model:'effort-check',...(effort?{effort}:{}),requiresOpenaiAuth:false,stopGraceMs:100};
    const options:EngineOptions={role,cwd:f.raw.workspace,readRoots:[],instructions:'Synthetic model configuration check',tools:[],...(resume?{threadId:'mock-thread'}:{})};
    const engine=new CodexEngine(config,options,async()=>({}));
    try{
      assert.equal(await engine.start(),'mock-thread');
      assert.equal((await engine.turn('first')).text,effort??(role==='worker'?'high':'medium'));
      assert.equal((await engine.turn('second')).text,effort??(role==='worker'?'high':'medium'));
    }finally{await engine.close();f.close();}
  });
}
test('website connection resolves each role without changing data and native-account binding',()=>{
 const original={workspace:'/synthetic/work',runtime:'/synthetic/runtime',codexHome:'/synthetic/codex',codexBin:'/synthetic/codex-bin',model:'original-model',requiresOpenaiAuth:true,stopGraceMs:3000,desktopResources:{bundleRoot:'/synthetic/app',manifestSha256:'a'.repeat(64)},dailyDeepSeek:true,pauseOldDesktopWork:true,desktopConnection:{main:{baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}}} as Config;
 const before=JSON.stringify(original);
 for(const role of ['main','worker'] as const){
  const effective=effectiveModelConfig(original,role);
  assert.equal(effective.model,'deepseek-flash');assert.equal(effective.baseUrl,original.desktopConnection![role].baseUrl);
  assert.equal(effective.effort,'max');assert.equal(effective.fast,false);assert.equal(effective.requiresOpenaiAuth,false);
 }
 assert.equal(JSON.stringify(original),before);
});

test('membership projections use independently delivered context settings over local tuning',()=>{
 const base={workspace:'/synthetic/work',runtime:'/synthetic/runtime',codexHome:'/synthetic/home',codexBin:'/synthetic/bin',model:'original',requiresOpenaiAuth:true,stopGraceMs:3000,desktopResources:{bundleRoot:'/synthetic/app',manifestSha256:'a'.repeat(64)},pauseOldDesktopWork:true,dailyDeepSeek:true,deepseek:{contextWindow:272000,autoCompactTokenLimit:244800}} as Config;
 const role={baseUrl:'https://gateway.example.invalid/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false} as const;
 const main={...role,context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total' as const}};
 const worker={...role,context:{contextWindow:600000,autoCompactTokenLimit:450000,autoCompactTokenLimitScope:'total' as const}};
 const config={...base,desktopConnection:{main,worker}};
 for(const name of ['main','worker'] as const){
  const effective=effectiveModelConfig(config,name);
  assert.deepEqual(effective.context,config.desktopConnection[name].context);
  assert.equal(deepseekProfile(effective),undefined);
 }
 const native=effectiveModelConfig({...config,desktopModelSource:'codex'});
 assert.equal(native.model,'gpt-6.1-terra');assert.equal(native.effort,'high');assert.equal(native.fast,true);
});
