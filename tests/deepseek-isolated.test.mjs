import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkStartup,createSession,launchSpec,readToken} from '../scripts/deepseek-isolated.mjs';

test('isolated DeepSeek sessions have distinct private homes and public-only configuration',()=>{
  const sessions=[createSession(),createSession()];
  try {
    assert.notEqual(sessions[0].directory,sessions[1].directory);
    for(const session of sessions){
      const config=JSON.parse(readFileSync(session.configPath,'utf8'));
      assert.equal(config.model,'deepseek-flash');
      assert.equal(config.effort,'high');assert.equal(config.fast,false);
      assert.equal(config.baseUrl,'https://models.super-tree.com/v1');
      assert.equal(config.requiresOpenaiAuth,false);
      assert.equal(config.codexHome,config.nativeCodexHome);
      assert.notEqual(config.runtime,join(config.appData,'runtime'));
      for(const path of [session.directory,config.workspace,config.runtime,config.codexHome,session.home]){
        assert.ok(path.startsWith(session.directory));
        assert.equal(statSync(path).mode&0o777,0o700);
      }
      assert.equal(statSync(session.configPath).mode&0o777,0o600);
      const native=readFileSync(join(config.codexHome,'config.toml'),'utf8');
      assert.match(native,/generate_memories = false/);
      assert.match(native,/use_memories = false/);
    }
  } finally {for(const session of sessions)rmSync(session.directory,{recursive:true,force:true});}
});

test('only the child environment receives the token; ambient overrides are not inherited',()=>{
  const session=createSession(),sentinel='SYNTHETIC_TOKEN_DO_NOT_USE';
  try{
    process.env.HOMER_MODEL='ambient-wrong-model';process.env.UNRELATED_SYNTHETIC_SECRET='ambient-secret';
    const spec=launchSpec(session,sentinel);
    assert.equal(spec.env.HOMER_DEEPSEEK_TOKEN,sentinel);
    assert.equal(spec.env.HOMER_MODEL,undefined);
    assert.equal(spec.env.UNRELATED_SYNTHETIC_SECRET,undefined);
    assert.equal(spec.env.HOME,session.home);
    assert.equal(spec.cwd,session.config.workspace);
    assert.equal(JSON.stringify(spec.args).includes(sentinel),false);
    assert.equal(readFileSync(session.configPath,'utf8').includes(sentinel),false);
    assert.equal(process.env.HOMER_DEEPSEEK_TOKEN,undefined);
    assert.ok(spec.args.includes('--config'));
  } finally {delete process.env.HOMER_MODEL;delete process.env.UNRELATED_SYNTHETIC_SECRET;rmSync(session.directory,{recursive:true,force:true});}
});

test('empty, multiline and oversized tokens are rejected without echoing input',()=>{
  for(const token of ['', 'with space', 'line\nsecret', 'bad\x1bsecret','x'.repeat(4097)]){
    assert.throws(()=>launchSpec({},token),{message:'deepseek_token_invalid'});
  }
});

test('token input refuses redirected stdin before asking for a secret',async()=>{
  await assert.rejects(readToken({isTTY:false},{}),{message:'deepseek_personal_terminal_required'});
});

test('startup check reports an unconfirmed engine shutdown as a failure',async()=>{
  await assert.rejects(checkStartup({async start(){},async close(){return false;}}),{message:'deepseek_engine_stop_unconfirmed'});
});

for(const action of ['enter','cancel','SIGINT','SIGTERM'])test(`real terminal hides input and restores echo after ${action}`,()=>{
  const code=`import {readToken} from ${JSON.stringify(new URL('../scripts/deepseek-isolated.mjs',import.meta.url).href)};
    try {const value=await readToken();console.log(value==='SYNTHETIC_TERMINAL_CANARY'?'accepted':'wrong');}
    catch(error){console.log(error.message==='deepseek_token_cancelled'?'cancelled':'wrong');}`;
  const python=`import os,pty,select,signal,subprocess,sys,termios,time
master,slave=pty.openpty()
before=termios.tcgetattr(slave)
p=subprocess.Popen([sys.argv[1],'--input-type=module','-e',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,env={'PATH':'/usr/bin:/bin'})
output=b''
deadline=time.monotonic()+15
sent=False
try:
 while time.monotonic()<deadline:
  if select.select([master],[],[],0.1)[0]:
   output+=os.read(master,65536)
  if not sent and 'Ctrl-C'.encode() in output:
   assert not (termios.tcgetattr(slave)[3]&termios.ECHO), 'echo_on_during_input'
   os.write(master,b'SYNTHETIC_TERMINAL_CANARY'+(b'\\r' if sys.argv[3]=='enter' else b'\\x03' if sys.argv[3]=='cancel' else b''))
   if sys.argv[3].startswith('SIG'): p.send_signal(getattr(signal,sys.argv[3]))
   sent=True
  if p.poll() is not None:
   while select.select([master],[],[],0)[0]:
    output+=os.read(master,65536)
   break
 assert p.poll()==0, 'terminal_child_failed_or_timed_out'
 assert b'SYNTHETIC_TERMINAL_CANARY' not in output, 'input_echoed'
 assert (b'accepted' if sys.argv[3]=='enter' else b'cancelled') in output, 'result_missing'
 assert bool(termios.tcgetattr(slave)[3]&termios.ECHO)==bool(before[3]&termios.ECHO), 'echo_not_restored'
 print('terminal_check_passed')
finally:
 if p.poll() is None: p.kill();p.wait()
 os.close(master);os.close(slave)
`;
  const result=spawnSync('/usr/bin/python3',['-c',python,process.execPath,code,action],{encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/terminal_check_passed/);
});

test('SIGINT directed only at the launcher gracefully stops its child',async()=>{
  const module=new URL('../scripts/deepseek-isolated.mjs',import.meta.url).href;
  const childSource=`const timer=setTimeout(()=>process.exit(5),5000);
    process.once('SIGTERM',()=>{clearTimeout(timer);console.log('child_stopped');});console.log('child_ready');`;
  const source=`import {runChild} from ${JSON.stringify(module)};
    const code=await runChild({bin:process.execPath,args:['-e',${JSON.stringify(childSource)}],cwd:process.cwd(),env:{PATH:'/usr/bin:/bin'}});
    console.log('parent_done_'+code);process.exitCode=code;`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});
  let output='',sent=false;
  child.stdout.on('data',data=>{output+=data.toString();if(!sent&&output.includes('child_ready')){sent=true;child.kill('SIGINT');}});
  const code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',accept);});
  assert.equal(code,0);assert.match(output,/child_stopped/);assert.match(output,/parent_done_0/);
});

for(const stage of ['startup','shutdown'])for(const signal of ['SIGINT','SIGTERM'])
test(`startup check drains exactly once after ${signal} during ${stage}`,async()=>{
  const source=`import assert from 'node:assert/strict';
    import {checkStartup} from ${JSON.stringify(new URL('../scripts/deepseek-isolated.mjs',import.meta.url).href)};
    let closed=0,rejectStart,timer;
    const engine={start(){return new Promise((accept,reject)=>{rejectStart=reject;timer=setTimeout(accept,200);console.log('startup_ready');});},
      async close(){closed++;clearTimeout(timer);rejectStart(Error('engine_closed'));console.log('shutdown_ready');await new Promise(r=>setTimeout(r,200));return true;}};
    assert.equal(await checkStartup(engine),false);assert.equal(closed,1);console.log('check_cancelled_and_closed');`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});
  let output='',sent=false;
  child.stdout.on('data',data=>{output+=data.toString();if(!sent&&output.includes(stage+'_ready')){sent=true;child.kill(signal);}});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
  try{
    const code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',accept);});
    assert.equal(code,0);assert.match(output,/check_cancelled_and_closed/);
  }finally{clearTimeout(timeout);}
});

test('startup check can cancel a native request that never responds',async()=>{
  const source=`import assert from 'node:assert/strict';
    import {checkStartup} from ${JSON.stringify(new URL('../scripts/deepseek-isolated.mjs',import.meta.url).href)};
    let rejectStart,closed=0;
    const alive=setInterval(()=>{},1000);
    const engine={start(){return new Promise((_accept,reject)=>{rejectStart=reject;console.log('stalled_ready');});},
      async close(){closed++;rejectStart(Error('engine_closed'));clearInterval(alive);return true;}};
    assert.equal(await checkStartup(engine),false);assert.equal(closed,1);console.log('stalled_check_cancelled');`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});
  let output='',sent=false;
  child.stdout.on('data',data=>{output+=data.toString();if(!sent&&output.includes('stalled_ready')){sent=true;child.kill('SIGTERM');}});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
  try{
    const code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',accept);});
    assert.equal(code,0);assert.match(output,/stalled_check_cancelled/);
  }finally{clearTimeout(timeout);}
});

for(const role of ['main','worker'])test(`${role} transmits deepseek-flash, high and no Fast on consecutive synthetic turns`,()=>{
  const session=createSession();
  const source=`import assert from 'node:assert/strict';
    import {CodexEngine} from ${JSON.stringify(new URL('../src/engine.ts',import.meta.url).href)};
    import {loadConfig} from ${JSON.stringify(new URL('../src/config.ts',import.meta.url).href)};
    const config={...loadConfig(process.argv[1]),codexBin:${JSON.stringify(fileURLToPath(new URL('./fixtures/model-settings-app-server.mjs',import.meta.url)))},stopGraceMs:100};
    const engine=new CodexEngine(config,{role:${JSON.stringify(role)},cwd:config.workspace,readRoots:[],instructions:'Synthetic model configuration check',tools:[]},async()=>({}));
    try{await engine.start();for(let i=0;i<2;i++){
      const result=JSON.parse((await engine.turn('Synthetic turn')).text);
      assert.equal(result.model,'deepseek-flash');assert.equal(result.effort,'high');
      assert.equal(result.threadServiceTier,null);assert.equal(result.turnServiceTier,null);
    }}finally{await engine.close();}`;
  try{
    const {cwd,env}=launchSpec(session,'SYNTHETIC_ONLY');
    const result=spawnSync(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),
      '--input-type=module','-e',source,session.configPath],{cwd,env,encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr);
  }finally{rmSync(session.directory,{recursive:true,force:true});}
});
