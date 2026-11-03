import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Config} from './config.js';
// A serialization adapter, not an MCP schema. The native strict loader owns
// supported fields, types and transport semantics, including nested options.
function toml(value:unknown):string {
 if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(toml).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}';
 throw Error('capability_mcp_native_invalid');
}
// No model, thread, MCP connection or credentials: EOF closes the native
// app-server after its eager strict config load. Secrets stay off argv/logs.
export async function validateNativeMcpConfig(config:Config,name:string,server:Record<string,unknown>){
 const root=join(config.codexHome,'homer-control');mkdirSync(root,{recursive:true,mode:0o700});
 const home=mkdtempSync(join(root,'mcp-validation-')),hostHome=join(home,'host-home');
 try{
  mkdirSync(hostHome,{mode:0o700});
  writeFileSync(join(home,'config.toml'),'mcp_servers='+toml({[name]:server})+'\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n',{mode:0o600,flag:'wx'});
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(config.codexBin,['app-server','--strict-config','--stdio'],{cwd:hostHome,env:{HOME:hostHome,CODEX_HOME:home,PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG},stdio:['ignore','ignore','ignore'],detached:true});
   let expired=false,killTimer:NodeJS.Timeout|undefined;
   const kill=(signal:NodeJS.Signals)=>{if(child.pid&&child.exitCode===null)try{process.kill(-child.pid,signal);}catch{}};
   const timer=setTimeout(()=>{expired=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);},10000);
   const clear=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);};
   child.on('error',()=>{clear();reject(Error('capability_mcp_validation_unavailable'));});
   child.on('close',code=>{clear();if(code!==0||expired)reject(Error(expired?'capability_mcp_validation_timeout':'capability_mcp_native_invalid'));else resolve();});
  });
 }finally{rmSync(home,{recursive:true,force:true});}
}
// Display projection only. Never use this object as a replacement config.
// Omit argv too: native programs often receive credentials in arguments.
export function publicMcpServer(server:Record<string,any>){
 return { ...(typeof server.command==='string'?{command:server.command}:{}),...(typeof server.url==='string'?{url:server.url}:{}),enabled:server.enabled!==false,...(Array.isArray(server.enabled_tools)?{enabled_tools:server.enabled_tools}:{}),hasArgs:Array.isArray(server.args)&&server.args.length>0,hasAdvancedConfig:Object.keys(server).some(k=>!['command','url','args','enabled','enabled_tools'].includes(k))};
}
// Native diagnostics can contain rejected headers or environment values.
// Catalog tools remain native; error bodies/resources never enter management JSON.
export function publicMcpCatalog(response:any){
 return {data:(response.data??[]).map((s:any)=>({name:s.name,runtimeStatus:s.runtimeStatus,authStatus:s.authStatus,tools:s.tools??{},toolsError:s.toolsError?'capability_mcp_catalog_failed':null})),nextCursor:response.nextCursor??null};
}
