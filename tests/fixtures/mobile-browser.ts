// Real Homer/WebBridge with an injected synthetic engine; no account or model calls.
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {Homer} from '../../src/service.js';
import {homerWebBridge} from '../../src/web-homer.js';
import {createMobileGateway} from '../../src/mobile-gateway.js';
export async function mobileBrowserFixture({signalOrigin,uiDirectory,base}:{signalOrigin:string;uiDirectory:string;base:string}){
 const directory=resolve(mkdtempSync(join(base,'browser-'))),runtime=join(directory,'runtime');mkdirSync(runtime);
 const turns:string[]=[];
 class Engine extends EventEmitter{
  threadId='synthetic-mobile-main';async start(){return this.threadId;}
  async turn(text:string){turns.push(text);return {status:'completed',text:'合成主端回复'};}
  async close(){return true;}async interrupt(){return true;}
 }
 const app=new Homer({runtime,workspace:join(directory,'workspace'),codexHome:join(directory,'empty-home'),nativeCodexHome:join(directory,'empty-home'),codexBin:'/usr/bin/false',requiresOpenaiAuth:false,model:'synthetic-only',stopGraceMs:100},async()=>{},()=>new Engine());
 try{
  await app.start();
  const bridge=homerWebBridge(app,{});
  const gateway=await createMobileGateway({bridge,port:0,signalOrigin,databasePath:join(runtime,'homer.sqlite'),uiDirectory:resolve(uiDirectory),logoPath:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
  return {...gateway,app,turns,history:app.history,inputs:app.inputs,async close(){await gateway.close();await app.close();rmSync(directory,{recursive:true,force:true});}};
 }catch(error){await app.close();rmSync(directory,{recursive:true,force:true});throw error;}
}
