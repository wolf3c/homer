import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
export async function openBrowser(dir,{mockKeychain=false}={}){
 const profile=mkdtempSync(join(dir,'profile-'));
 const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,
  '--disable-background-networking','--disable-component-update','--disable-default-apps',
  '--disable-sync','--no-first-run','--no-default-browser-check',
  ...(mockKeychain?['--use-mock-keychain']:[]),
  '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,Translate','about:blank',
 ],{stdio:['ignore','ignore','pipe']});
 let stderr='',tail='',status=null,forced=false,watchdog=false,spawnError='',closeError='';
 child.stderr.on('data',data=>{
  const text=String(data);watchdog=watchdog||(tail+text).includes('Teardown watchdog expired');
  tail=(tail+text).slice(-64);stderr+=text.slice(0,Math.max(0,65536-stderr.length));
 });
 const exit=new Promise(done=>{
  child.once('exit',(code,signal)=>{status={code,signal};done();});
  child.once('error',error=>{spawnError=String(error);if(child.pid===undefined){status={code:null,signal:null};done();}});
 });
 async function waitExit(ms){
  if(status)return true;let timer;
  const confirmed=await Promise.race([exit.then(()=>true),new Promise(done=>{timer=setTimeout(()=>done(false),ms);})]);
  clearTimeout(timer);return confirmed;
 }
 function record(){
  writeFileSync(join(dir,'chrome.log'),stderr);
  return {pid:child.pid,profile,mockKeychain,confirmed:status===null?false:true,...status,forced,watchdog,spawnError,closeError};
 }
 async function finish(browser){
  void (async()=>{try{const session=await browser.newBrowserCDPSession();await session.send('Browser.close');}catch(error){closeError=String(error);}})();
  if(await waitExit(20000)===false){forced=true;child.kill('SIGTERM');await waitExit(5000);}
  return record();
 }
 try{
  const active=join(profile,'DevToolsActivePort'),deadline=Date.now()+25000;
  while(Date.now()<deadline&&status===null&&existsSync(active)===false)await pause(40);
  if(existsSync(active)===false)throw Error('isolated_chrome_start_failed');
  const [port,path]=readFileSync(active,'utf8').trim().split('\n');
  const browser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+path,{timeout:15000});
  return {browser,finish:()=>finish(browser)};
 }catch(error){
  if(status===null){forced=true;child.kill('SIGTERM');await waitExit(5000);}
  writeFileSync(join(dir,'launch-failure.json'),JSON.stringify({error:String(error),...record()},null,2));
  throw error;
 }
}
