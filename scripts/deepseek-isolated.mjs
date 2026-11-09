// Local BYOK experiment. No credential files, login, install or daily-service changes.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,mkdirSync,mkdtempSync,writeFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';

const root=fileURLToPath(new URL('../',import.meta.url));
const codexSha='8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31';
const loader=join(root,'node_modules/tsx/dist/loader.mjs');
let codexBin;
function fixedEngine(){
  if(!codexBin){
    const common=execFileSync('/usr/bin/git',['rev-parse','--path-format=absolute','--git-common-dir'],
      {cwd:root,env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:10000}).trim();
    codexBin=join(dirname(common),'.codex/private/engines/codex-0.163.0/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
  }
  return codexBin;
}

export function createSession(){
  const parent=join(root,'.codex/scratch/homer-deepseek-smoke');
  mkdirSync(parent,{recursive:true,mode:0o700});
  const directory=realpathSync(mkdtempSync(join(parent,'session-')));
  const home=join(directory,'host-home');
  const config={appData:join(directory,'app-data'),workspace:join(directory,'workspace'),
    runtime:join(directory,'runtime-isolated'),codexHome:join(directory,'codex'),
    nativeCodexHome:join(directory,'codex'),codexBin:fixedEngine(),model:'deepseek-flash',effort:'high',fast:false,
    baseUrl:'https://models.super-tree.com/v1',keyEnv:'HOMER_DEEPSEEK_TOKEN',requiresOpenaiAuth:false};
  for(const path of [home,config.appData,config.workspace,config.runtime,config.codexHome,join(directory,'tmp')])
    mkdirSync(path,{mode:0o700});
  writeFileSync(join(config.codexHome,'config.toml'),
    '[memories]\ngenerate_memories = false\nuse_memories = false\n',{mode:0o600});
  const configPath=join(directory,'homer.config.json');
  writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  return {directory,home,config,configPath};
}

function environment(session){
  return {PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:session.home,
    CODEX_HOME:session.config.codexHome,TMPDIR:join(session.directory,'tmp'),LANG:'en_US.UTF-8'};
}

export function launchSpec(session,token){
  if(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token))throw Error('deepseek_token_invalid');
  return {bin:process.execPath,args:['--disable-warning=ExperimentalWarning','--import',loader,
    join(root,'src/cli.ts'),'--config',session.configPath],cwd:session.config.workspace,
    env:{...environment(session),HOMER_DEEPSEEK_TOKEN:token}};
}

export async function readToken(input=process.stdin,output=process.stdout){
  if(!input.isTTY||!output.isTTY)throw Error('deepseek_personal_terminal_required');
  // Readline controls terminal echo; all redraws go to a discarded stream.
  const muted=new Writable({write(_chunk,_encoding,done){done();}});
  const rl=createInterface({input,output:muted,terminal:true,historySize:0});
  let cancel;
  try{
    return await new Promise((accept,reject)=>{
      cancel=()=>reject(Error('deepseek_token_cancelled'));
      rl.once('SIGINT',cancel);rl.once('close',cancel);
      process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      output.write('粘贴 AMH Token 后按回车（输入不显示；Ctrl-C 取消）：');
      rl.question('',accept);
    });
  }finally{
    if(cancel){process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
    rl.close();input.pause();muted.end();output.write('\n');
  }
}

async function verifyRuntime(session){
  if(!/^22\./.test(process.versions.node))throw Error('deepseek_node22_required');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(session.config.codexBin))hash.update(chunk);
  if(hash.digest('hex')!==codexSha)
    throw Error('deepseek_codex_binary_changed');
  const result=spawnSync(session.config.codexBin,['--version'],{env:environment(session),cwd:session.home,encoding:'utf8',timeout:15000});
  if(result.status!==0||result.stdout.trim()!=='codex-cli 0.163.0')throw Error('deepseek_codex163_required');
}

export async function runChild(spec){
  return await new Promise((accept,reject)=>{
    const child=spawn(spec.bin,spec.args,{cwd:spec.cwd,env:spec.env,stdio:'inherit'});
    // Translate parent SIGINT to SIGTERM: terminal Ctrl-C already sends SIGINT
    // to the child. Its two handlers share an idempotent stop; a second SIGINT
    // could instead terminate it before its asynchronous cleanup completes.
    const interrupt=()=>child.kill('SIGTERM');
    const terminate=()=>child.kill('SIGTERM');
    process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
    child.once('error',()=>{cleanup();reject(Error('deepseek_child_start_failed'));});
    child.once('close',(code,signal)=>{cleanup();accept(code??(signal?1:0));});
    function cleanup(){process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
  });
}

export async function checkStartup(engine){
  let interrupted=false,closing;
  const close=()=>closing??=Promise.resolve().then(()=>engine.close());
  const stop=()=>{interrupted=true;void close().catch(()=>{});};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  // CodexEngine owns its child synchronously and close rejects pending RPCs.
  // Do not pass Homer here: its asynchronous startup can create later owners.
  try{await engine.start();}
  catch(error){if(!interrupted)throw error;}
  finally{
    try{if(await close()===false)throw Error('deepseek_engine_stop_unconfirmed');}
    finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
  return !interrupted;
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length>1||args.length===1&&args[0]!=='--check')throw Error('deepseek_usage_no_token_arguments');
  if(!args.length&&(!process.stdin.isTTY||!process.stdout.isTTY))throw Error('deepseek_personal_terminal_required');
  const session=createSession();await verifyRuntime(session);
  console.log('隔离目录：'+session.directory);
  console.log('主 Agent / Worker：deepseek-flash · high · Fast 关闭 · Codex 0.163.0');
  if(args[0]==='--check'){
    // Fixed local native protocol; no Homer model turn or real key.
    const source=`import {loadConfig} from ${JSON.stringify(pathToFileURL(join(root,'src/config.ts')).href)};
      import {CodexEngine} from ${JSON.stringify(pathToFileURL(join(root,'src/engine.ts')).href)};
      import {checkStartup} from ${JSON.stringify(import.meta.url)};
      const config=loadConfig(process.argv[1]);
      const engine=new CodexEngine(config,{cwd:config.workspace,readRoots:[],instructions:'Local startup check; no model turn.',tools:[],controlOnly:true},async()=>{throw Error('no_model_tools');});
      if(await checkStartup(engine))console.log('固定引擎本机协议检查通过；未提交模型轮次。');else process.exitCode=130;`;
    process.exitCode=await runChild({bin:process.execPath,args:['--disable-warning=ExperimentalWarning','--import',loader,
      '--input-type=module','-e',source,session.configPath],cwd:session.config.workspace,env:environment(session)});
    return;
  }
  console.log('本入口不保存 Token；退出后下次需重新输入。启动后输入普通消息才发起计费调用。');
  let token=await readToken();
  const spec=launchSpec(session,token);token='';
  console.log('输入 /quit 退出；/status 查看当前隔离实例。测试数据保留在上述目录。');
  try{process.exitCode=await runChild(spec);}
  finally{delete spec.env.HOMER_DEEPSEEK_TOKEN;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    const code=error instanceof Error&&/^deepseek_[a-z0-9_]+$/.test(error.message)?error.message:'deepseek_start_failed';
    console.error('隔离启动未完成：'+code+'。请检查 Node 22、固定引擎、依赖或终端输入。');process.exitCode=1;
  });
}
