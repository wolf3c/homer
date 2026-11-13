import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {constants} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

export function screenIsLocked(output){
 const users=output.split('\n').find(line=>/"IOConsoleUsers"\s*=/.test(line));
 const locks=users?[...users.matchAll(/"CGSSessionScreenIsLocked"\s*=\s*([^,}]+)/g)].map(match=>match[1].trim()):[];
 if(!users||! /"kCGSSessionOnConsoleKey"\s*=\s*Yes/.test(users)||! /"kCGSessionLoginDoneKey"\s*=\s*Yes/.test(users)||locks.some(value=>!['Yes','No'].includes(value)))
  throw Error('screen_state_unavailable: 无法确认当前控制台状态，未启动 Xcode。');
 // macOS omits CGSSessionScreenIsLocked for an unlocked console session.
 return locks.includes('Yes');
}

async function readScreenLock(){
 if(process.platform!=='darwin')throw Error('ios_xcodebuild_requires_macos');
 let result;
 try{result=await promisify(execFile)('/usr/sbin/ioreg',['-n','Root','-d1'],{timeout:5000,maxBuffer:4*1024*1024});}
 catch{throw Error('screen_state_unavailable: 无法读取锁屏状态，未启动 Xcode。');}
 return screenIsLocked(result.stdout);
}

export async function runXcodebuild(args,{spawnProcess=spawn,readLocked=readScreenLock,signal}={}){
 if(!args.length)throw Error('用法：node scripts/ios-xcodebuild.mjs <xcodebuild 参数>');
 signal?.throwIfAborted();
 let build,buildClosed,awakeLost=false,finishing=false,credentialFailed=false,buildError=false;
 const stopped=new Set();
 function stop(child,group=false){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null||stopped.has(child))return;
  stopped.add(child);
  const kill=signal=>{
   try{if(group)process.kill(-child.pid,signal);else child.kill(signal);}
   catch(error){if(error.code!=='ESRCH')throw error;}
  };
  kill('SIGTERM');
  const timeout=setTimeout(()=>kill('SIGKILL'),2000);timeout.unref();
  child.once('close',()=>clearTimeout(timeout));
 }
 const awake=spawnProcess('/usr/bin/caffeinate',['-di','-w',String(process.pid)],{stdio:'ignore'});
 const awakeClosed=new Promise(accept=>awake.once('close',accept));
 const loseAwake=()=>{if(!finishing){awakeLost=true;stop(build,true);}};
 awake.on('error',loseAwake);awake.on('exit',loseAwake);
 const abort=()=>stop(build,true);
 signal?.addEventListener('abort',abort,{once:true});
 const check=()=>{
  signal?.throwIfAborted();
  if(awakeLost)throw Error('sleep_assertion_failed: 防休眠进程退出，已停止 Xcode。');
 };
 try{
  await once(awake,'spawn');
  let announced=false;
  while(await readLocked()){
   check();
   if(!announced){console.error('[ios-xcodebuild] Mac 已锁屏，等待解锁；尚未启动 Xcode。');announced=true;}
   await delay(1000,undefined,{signal});
  }
  check();
  // shortcut: a later manual lock is not fenced; unattended signing needs separate authentication.
  build=spawnProcess('/usr/bin/xcodebuild',args,{stdio:['inherit','pipe','pipe'],detached:true});
  buildClosed=new Promise(accept=>build.once('close',(code,signal)=>accept({code,signal})));
  build.on('error',()=>{buildError=true;});
  for(const [input,output] of [[build.stdout,process.stdout],[build.stderr,process.stderr]]){
   let tail='';
   input.on('data',chunk=>{
    output.write(chunk);
    const text=tail+chunk.toString();tail=text.slice(-4096);
    if(!credentialFailed&&/missing Xcode-(?:Username|Token)|DVTDeveloperAccountCredentialsError|err(?:KC|Sec)InteractionNotAllowed|\bFailed to Use Accounts\b|-25308\b/i.test(text)){
     credentialFailed=true;stop(build,true);
    }
   });
  }
  const result=await buildClosed;
  check();
  if(credentialFailed)throw Error('xcode_credentials_unavailable: 已停止；先解锁并检查账号及私有日志，勿自动重试或重置钥匙串。');
  if(buildError)throw Error('xcodebuild_start_failed');
  return result.signal?128+(constants.signals[result.signal]??1):result.code??1;
 }finally{
  signal?.removeEventListener('abort',abort);
  finishing=true;stop(build,true);stop(awake);
  await Promise.all([awakeClosed,buildClosed]);
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController();let interrupted=0;
 const interrupt=()=>{interrupted=130;controller.abort();};
 const terminate=()=>{interrupted=143;controller.abort();};
 process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
 try{
  if(process.platform!=='darwin')throw Error('ios_xcodebuild_requires_macos');
  process.exitCode=await runXcodebuild(process.argv.slice(2),{signal:controller.signal});
 }catch(error){console.error('[ios-xcodebuild] '+error.message);process.exitCode=interrupted||1;}
 finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
