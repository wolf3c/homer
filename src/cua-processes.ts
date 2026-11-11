import {execFile,execFileSync,spawn} from 'node:child_process';
import {lstatSync,readFileSync,readdirSync,readlinkSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {leaseOwnerGone,processIdentity} from './processes.js';

export const CUA_SESSION_PREFIX='homer-cua-';
export const WINDOWS_CUA_HELPER='runtime/cua/homer-cua-windows.exe';
const run=promisify(execFile);
const windowsEnvironment=()=>{
 const {SystemRoot,APPDATA,LOCALAPPDATA,USERPROFILE,TEMP,TMP}=process.env;
 return {SystemRoot,PATH:join(SystemRoot!,'System32'),APPDATA,LOCALAPPDATA,USERPROFILE,TEMP,TMP};
};
export const runCuaWindows=(helper:string,args:string[])=>run(helper,args,{timeout:3000,maxBuffer:2048,windowsHide:true,env:windowsEnvironment()});

export function holdCuaWindowsJob(helper:string,dir:string){
 const child=spawn(helper,['hold',dir],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:windowsEnvironment()});
 const lines=createInterface({input:child.stdout});
 child.stdin.on('error',()=>{});
 let stopped=false;
 const exited=new Promise<number|null>(resolve=>{child.once('close',resolve);child.once('error',()=>resolve(null));});
 const ready=new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('cua_driver_unavailable'));},3000);
  const finish=(line?:string)=>{
   clearTimeout(timer);
   if(line==='ready')resolve();else reject(Error('cua_driver_unavailable'));
  };
  lines.on('line',line=>{if(line==='stopped')stopped=true;else finish(line);});
  void exited.then(()=>finish());
 });
 return {ready,async stop(){
  child.stdin.end('q');
  let timer:NodeJS.Timeout|undefined;
  try{
   return await Promise.race([exited.then(code=>code===0&&stopped),new Promise<boolean>(resolve=>{timer=setTimeout(()=>{child.kill();resolve(false);},2800);})]);
  }finally{clearTimeout(timer);}
 }};
}
const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const generation=new RegExp('^'+uuid+'$');
type ProcessRow={pid:number;group:number;command:string};
const processRows=(output:string)=>output.trim().split('\n').flatMap(line=>{
 const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
 return match?[{pid:Number(match[1]),group:Number(match[2]),command:match[3]!}]:[];
});
export function ownedCuaProcesses(dir:string,output:string){
 const rows=processRows(output);
 const driverPrefix=join(dir,'cua-driver')+' __private-worker --generation ';
 const profile=' --user-data-dir='+join(dir,'profile');
 return {
  driver:rows.filter(row=>row.pid>1&&row.command.startsWith(driverPrefix)&&generation.test(row.command.slice(driverPrefix.length))),
  chrome:rows.filter(row=>{
   const at=row.command.indexOf(profile);
   return row.pid>1&&row.group>1&&at>0&&/^( |$)/.test(row.command.slice(at+profile.length))&&
    /\/Google Chrome\.app\/Contents\/(?:MacOS\/Google Chrome|Frameworks\/[^\n]+?\/MacOS\/Google Chrome Helper(?: \([^)]+\))?) /.test(row.command.slice(0,at+1));
  }),
 };
}

const columns=['-o','pid=,pgid=,command='];
const ps=(selection:string[])=>execFileSync('/bin/ps',['-ww',...selection,...columns],{encoding:'utf8',timeout:2000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']});
const owned=(dir:string)=>ownedCuaProcesses(dir,ps(['-U',String(process.getuid!())]));
function stop(row:ProcessRow,executables:string[],group=false,signal:NodeJS.Signals='SIGKILL'){
 const identity=processIdentity(row.pid);
 if(!identity||!executables.some(path=>identity.endsWith(' '+path)))return;
 try{
  const [now]=processRows(ps(['-p',String(row.pid)]));
  if(now?.group===row.group&&now.command===row.command&&processIdentity(row.pid)===identity)
   process.kill(group?-row.group:row.pid,signal);
 }catch{}
}

export function pinCuaChrome(dir:string,pid:number){
 if(!owned(dir).chrome.some(row=>row.pid===pid&&row.group===pid))throw Error('cua_isolated_browser_unconfirmed');
 writeFileSync(join(dir,'chrome-pid'),String(pid),{flag:'wx',mode:0o600});
}

const pidGone=(pid:number)=>{
 try{process.kill(pid,0);return false;}
 catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
};
export async function reclaimCuaSession(dir:string,driverPid?:number,windowsHelper?:string,job?:ReturnType<typeof holdCuaWindowsJob>){
 const info=lstatSync(dir,{throwIfNoEntry:false});
 if(windowsHelper){
  if(info&&(!info.isDirectory()||realpathSync(dir)!==dir))return false;
  if(!await job?.stop()){
   const {stdout}=await runCuaWindows(windowsHelper,['stop',dir]);
   if(stdout.trim()!=='stopped')return false;
  }
  if(info)rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  return true;
 }
 if(!info)return true;
 if(!info.isDirectory()||info.uid!==process.getuid!()||(info.mode&0o077)!==0)return false;
 const pin=join(dir,'chrome-pid'),pinInfo=lstatSync(pin,{throwIfNoEntry:false});
 if(pinInfo&&(!pinInfo.isFile()||pinInfo.nlink!==1||pinInfo.uid!==info.uid||(pinInfo.mode&0o077)!==0))return false;
 const pinned=pinInfo?Number(readFileSync(pin,'utf8')):undefined;
 if(pinned!==undefined&&(!Number.isSafeInteger(pinned)||pinned<=1))return false;
 const groups=new Set<number>(pinned===undefined?[]:[pinned]);
 const terminating=new Map<number,number>();
 // Stop the private driver before the final Chrome scan so it cannot launch another process.
 for(let attempt=0;attempt<30;attempt++){
  const {driver,chrome}=owned(dir);
  for(const row of chrome)groups.add(row.group);
  if(driver.length){
   const link=join(dir,'cua-driver'),binary=readlinkSync(link);
   for(const row of driver)stop(row,[link,binary]);
  }
  else{
   if(!chrome.length&&[...groups].every(leaseOwnerGone)&&(driverPid===undefined||pidGone(driverPid))){rmSync(dir,{recursive:true});return true;}
   const byGroup=new Map<number,ProcessRow>();
   for(const row of chrome)if(!byGroup.has(row.group)||row.pid===row.group)byGroup.set(row.group,row);
   for(const row of byGroup.values()){
    const sent=terminating.get(row.group);
    if(sent===undefined||Date.now()-sent>=700)stop(row,[row.command.split(' --',1)[0]!],true,sent===undefined?'SIGTERM':'SIGKILL');
    if(sent===undefined)terminating.set(row.group,Date.now());
   }
  }
  await delay(60);
 }
 return false;
}

export async function recoverCuaSessions(runtime:string,windowsHelper?:string){
 for(const name of readdirSync(runtime))if(/^homer-cua-[a-zA-Z0-9]{6}$/.test(name)&&!await reclaimCuaSession(join(runtime,name),undefined,windowsHelper).catch(()=>false))
  throw Error('cua_stop_unconfirmed');
}
