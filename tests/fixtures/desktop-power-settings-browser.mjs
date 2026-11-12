// Actual settings Dialog and controls, with in-memory power state only.
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {build} from 'esbuild';

export async function desktopPowerSettingsBrowser(){
 const result=await build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {DesktopSettings} from './ui/desktop-permissions.tsx';import './ui/homer-styles.css';
 const scenario=new URLSearchParams(location.search).get('scenario'),listeners=new Set();let reads=0,updates=0,authorizations=0;
 let current={supported:true,preferences:{keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15},runtimeAvailable:scenario!=='unavailable',protection:scenario==='scheduled'?'system':'none',channels:scenario==='scheduled'?['Telegram']:[],wake:scenario==='unavailable'?{supported:false,authorization:'unavailable',status:'unavailable',nextAt:null}:scenario==='scheduled'?{supported:true,authorization:'authorized',status:'scheduled',nextAt:Date.now()+900000}:{supported:true,authorization:'required',status:'authorization-required',nextAt:null}};
 const counters=()=>document.getElementById('fixture-note').textContent='合成桥 · 读取 '+reads+' · 保存 '+updates+' · 授权 '+authorizations;
 window.homerDesktopPower={onChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},state:async()=>{reads++;counters();if(scenario==='read-failure'&&reads===1)throw Error('synthetic_read_failure');return structuredClone(current);},update:async patch=>{updates++;counters();if(scenario==='save-failure'&&updates===1)throw Error('synthetic_save_failure');current={...current,preferences:{...current.preferences,...patch}};listeners.forEach(fn=>fn());return structuredClone(current);},authorize:async()=>{authorizations++;counters();if(scenario==='auth-failure'&&authorizations===1)throw Error('synthetic_authorization_failure');current={...current,wake:{...current.wake,authorization:'denied'}};return structuredClone(current);}};
 createRoot(document.getElementById('app')).render(<main><DesktopSettings/><p>实际桌面设置组件 · 合成电源桥 · 不修改系统设置</p></main>);
 `,resolveDir:resolve('.'),sourcefile:'desktop-power-settings-browser.tsx',loader:'tsx'},bundle:true,write:false,outfile:resolve('.codex/scratch/power-settings-ui/browser-app.js'),format:'iife',platform:'browser',jsx:'automatic',minify:true,loader:{'.png':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});
 const js=result.outputFiles.find(file=>file.path.endsWith('.js')).contents,css=result.outputFiles.find(file=>file.path.endsWith('.css')).contents;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(js);}
  if(url.pathname==='/app.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(css);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(url.pathname!=='/'){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homer 电源设置 · 隔离验证</title><link rel="stylesheet" href="/app.css"><div id="app"></div><output id="fixture-note" style="position:fixed;bottom:8px;left:12px;color:#67645f;font:12px system-ui">合成电源桥</output><script src="/app.js"></script></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port+'/',close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv.includes('--serve')){
 const fixture=await desktopPowerSettingsBrowser();console.log(fixture.url);
 process.once('SIGINT',async()=>{await fixture.close();process.exit(0);});
}
