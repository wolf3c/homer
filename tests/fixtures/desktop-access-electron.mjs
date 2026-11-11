// Run only by the explicit desktop access and Windows capture tests.
import * as electron from 'electron';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';

const argument=process.argv.findIndex(value=>/[\\/]desktop-access-electron\.mjs$/.test(value));
const [directory,compiled,captureUrl]=process.argv.slice(argument+1),root=resolve(import.meta.dirname,'../..');
const resources=captureUrl?compiled:undefined;
electron.app.setPath('userData',join(directory,'electron'));
electron.app.setPath('sessionData',join(directory,'electron'));
async function shellEntry(){
 const shell=resources?join(resources,'app.asar'):join(root,'packaging/electron');
 const source=readFileSync(join(shell,'main.mjs'),'utf8');
 const boundary=source.indexOf('\ntry{\n if(!app.isPackaged');if(boundary<0)throw Error('desktop_fixture_startup_boundary_changed');
 // Keep the packaged shell's window, capture and session guards.
 const entryFile=join(directory,'entry-under-test.mjs');
 let entrySource=source.slice(0,boundary).replace(/from '\.\.\/homer\/([^']+)'/g,(_match,path)=>
  "from '"+pathToFileURL(resources?join(resources,'homer',path):path.startsWith('dist/')?join(compiled,path.slice(5)):join(root,path)).href+"'");
 if(resources)entrySource=entrySource.replace('const resources=process.resourcesPath','const resources='+JSON.stringify(resources));
 writeFileSync(entryFile,entrySource+`
export function bind(url,key){origin=url;desktopAccessToken=key;createWindow();return window;}
export function reopen(){const old=window;createWindow();old.destroy();return window;}
export function capture(profile){registerDesktopCapture(profile);}
export function captureReady(){return !!captureSubscriber&&currentCapture(captureSubscriber);}
export function captureBytes(){return capturePanel?.result?.png;}
export function closeCapture(){allowQuit=true;cancelDesktopCapture();window.destroy();}
`);
 for(const name of resources?['preload.cjs','capture-panel-preload.cjs']:['preload.cjs'])
  writeFileSync(join(directory,name),readFileSync(join(shell,name)));
 return import(pathToFileURL(entryFile).href);
}
electron.app.whenReady().then(async()=>{
 if(captureUrl){
  const entry=await shellEntry();
  const url=new URL(captureUrl);
  if(url.origin!==captureUrl||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port)throw Error('desktop_capture_fixture_origin');
  entry.capture(directory);
  const window=entry.bind(captureUrl,randomBytes(32).toString('hex'));
  await window.loadURL(captureUrl+'/');
  globalThis.desktopAccessFixture={
   async waitForCapture(){
    for(let attempt=0;attempt<120;attempt++){
     if(entry.captureReady())return;
     await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('synthetic_capture_scope_not_ready');
   },
   captureDigest:()=>createHash('sha256').update(entry.captureBytes()).digest('hex'),
   close:()=>entry.closeCapture(),
  };
  return;
 }
 const {createWebServer}=await import(pathToFileURL(join(compiled,'web-server.js')).href);
 const ui=join(directory,'ui');mkdirSync(join(ui,'assets'),{recursive:true});
 writeFileSync(join(ui,'index.html'),'<!doctype html><title>Offline desktop access</title><h1>离线桌面访问验证</h1><button id="state">读取状态</button><output id="result"></output><script src="/assets/fixture.js"></script>');
 writeFileSync(join(ui,'assets/fixture.js'),"document.querySelector('button').onclick=async()=>{document.querySelector('output').textContent=String((await fetch('/api/history/state')).status)}");
 let token=randomBytes(32).toString('hex'),web;
 const open=()=>createWebServer({port:0,desktopAccessToken:token,uiDirectory:ui,bridge:{
  history:{state:async()=>({threadId:'synthetic-electron',messages:[],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}})},
  submit:async()=>({}),stop:async()=>{},respond:async()=>{},
  media:{upload:async()=>({}),read:async({messageId,assetId,revision})=>{
   if(messageId!=='synthetic'||revision!==1)throw Error('media_scope_denied');
   if(assetId==='asset-11111111-1111-4111-8111-111111111111')return {filename:'synthetic.png',mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHHkAAAAASUVORK5CYII='};
   if(assetId==='asset-22222222-2222-4222-8222-222222222222')return {filename:'synthetic.txt',mime:'text/plain',data:Buffer.from('synthetic artifact').toString('base64')};
   throw Error('media_scope_denied');
  }},
 }});
 web=await open();
 const entry=await shellEntry();let window=entry.bind(web.url,token);await window.loadURL(web.url+'/');
 globalThis.desktopAccessFixture={
  url:()=>web.url,
  async reopen(){window=entry.reopen();await window.loadURL(web.url+'/');},
  async restart(){const previous=token;await web.close();token=randomBytes(32).toString('hex');web=await open();const response=await fetch(web.url+'/api/history/state',{headers:{'X-Homer-Desktop-Access':previous}});await response.arrayBuffer();window.destroy();window=entry.bind(web.url,token);await window.loadURL(web.url+'/');return response.status;},
  async close(){await web.close();window.destroy();},
 };
}).catch(error=>{console.error('synthetic_desktop_access_fixture_failed',error.message);electron.app.exit(1);});
