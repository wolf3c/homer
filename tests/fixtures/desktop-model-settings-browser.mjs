// Actual desktop settings with a synthetic desktop bridge. No accounts or model requests.
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {memberModelSettings,resolveMemberSelection} from '../../src/member-models.ts';
import {CHATGPT_MODEL_DEFAULTS,chatgptModelConfig,modelRowEdit,validateChatGPTModel,validateChatGPTSelection} from '../../src/model-config.ts';

export async function desktopModelSettingsBrowser(){
 const parent=resolve('.codex/scratch/chatgpt-model-implementation-20261111');mkdirSync(parent,{recursive:true});
 const scratch=mkdtempSync(join(parent,'browser-'));
 const catalog=[
  {model:'gpt-6.1-terra',displayName:'GPT-6.1 Terra',defaultReasoningEffort:'high',supportedReasoningEfforts:['low','medium','high','xhigh'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:[{id:'priority',name:'Fast'}]},
  {model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',defaultReasoningEffort:'medium',supportedReasoningEfforts:['low','medium','high','xhigh'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:[{id:'priority',name:'Fast'},{id:'ultrafast',name:'Ultrafast'}]},
  {model:'synthetic-standard',displayName:'示例标准模型',defaultReasoningEffort:'medium',supportedReasoningEfforts:['medium','high'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:[]},
  {model:'synthetic-basic',displayName:'示例无思考模型',defaultReasoningEffort:'none',supportedReasoningEfforts:[],serviceTiers:[]},
 ];
 let current=chatgptModelConfig(),calls=0,revoked=false,saveFailed=false;const reads=new Map();
 const memberDefaults=resolveMemberSelection(null);
 const memberOverrides={main:memberDefaults.main,worker:{model:'retired-member-model',effort:'high'}};
 const memberSettings=()=>({...memberModelSettings(memberDefaults,memberOverrides),revision:1});
 const result=await build({stdin:{contents:`
 import React,{useEffect,useRef} from 'react';import {createRoot} from 'react-dom/client';
 import {DesktopSettings} from './ui/desktop-permissions.tsx';import './ui/homer-styles.css';
 const query=location.search,scenario=new URLSearchParams(query).get('scenario'),listeners=new Set();let accountReads=0;
 const account={supported:true,configured:scenario==='member',source:['member','website','cancel'].includes(scenario)?'website':'codex',connection:scenario==='member'?'website':'disconnected',active:scenario==='member'?'website':'disconnected',memberRevision:1,wallet:{available:0,used:0,unit:'积分'},pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 const read=async path=>{const response=await fetch(path+query);if(!response.ok)throw Error('synthetic_bridge_failure');return response.json();};
 window.homerDesktopAccount={state:async()=>scenario==='account-error'&&accountReads++===1?{...account,native:undefined,nativeError:'Codex 登录状态未能确认，请重试。'}:account,onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},nativeModels:()=>read('/fixture/models'),memberModels:()=>read('/fixture/member'),applyMemberModel:async change=>{
  const response=await fetch('/fixture/member'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)});
  if(!response.ok)throw Error('chatgpt_model_save_failed');
  return response.json();
 },applyCodex:async roles=>{
  if(scenario==='account-error'){for(const fn of listeners)fn();throw Error('synthetic_account_read_failure');}
  const response=await fetch('/fixture/apply'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(roles)});const value=await response.json();if(!response.ok)throw Error(value.error);document.getElementById('fixture-note').textContent=value.note;if(scenario!=='cancel')account.source='codex';for(const fn of listeners)fn();return account;
 }};
 function App(){const ref=useRef(null);useEffect(()=>ref.current?.openAccount(),[]);return <DesktopSettings ref={ref}/>;}
 createRoot(document.getElementById('app')).render(<App/>);
 `,resolveDir:resolve('.'),sourcefile:'desktop-model-settings-browser.tsx',loader:'tsx'},bundle:true,write:false,outfile:join(scratch,'app.js'),format:'iife',platform:'browser',jsx:'automatic',minify:true,loader:{'.png':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});
 const js=result.outputFiles.find(file=>file.path.endsWith('.js')).contents,css=result.outputFiles.find(file=>file.path.endsWith('.css')).contents;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),scenario=url.searchParams.get('scenario')??'default';
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/fixture/member'){
   if(req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)return json({error:'chatgpt_model_config_invalid'},400);}
    try{
     const edit=modelRowEdit(JSON.parse(body).edit);
     if(!edit)return json({error:'chatgpt_model_config_invalid'},400);
     if(edit.selection)memberOverrides[edit.role]={model:edit.selection.model,effort:edit.selection.effort};
     else delete memberOverrides[edit.role];
    }catch{return json({error:'chatgpt_model_config_invalid'},400);}
   }
   return json(memberSettings());
  }
  if(url.pathname==='/fixture/models'){
   const count=(reads.get(scenario)??0)+1;reads.set(scenario,count);
   const selected=structuredClone(current);if(scenario==='missing')selected.main.model='saved-unavailable';
   if(scenario==='failure'&&count===1)return json({current:selected,defaults:CHATGPT_MODEL_DEFAULTS,error:'native_models_unconfirmed'});
   const models=scenario==='stale-apply'&&revoked?catalog.map(model=>({...model,serviceTiers:[]})):scenario==='plus'?catalog.map(model=>({...model,serviceTiers:model.serviceTiers.filter(tier=>tier.id!=='ultrafast')})):catalog;
   return json({current:selected,defaults:CHATGPT_MODEL_DEFAULTS,models});
  }
  if(url.pathname==='/fixture/apply'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)return json({error:'invalid_synthetic_selection'},400);}
   if(scenario==='stale-apply'){revoked=true;return json({error:'chatgpt_model_selection_unavailable'},400);}
   if(scenario==='save-failure'&&!saveFailed){saveFailed=true;return json({error:'chatgpt_model_save_failed'},400);}
   try{
    const roles=JSON.parse(body),edit=modelRowEdit(roles);
    if(edit){
     const selection=edit.selection?validateChatGPTModel(edit.role,edit.selection,catalog)??CHATGPT_MODEL_DEFAULTS[edit.role]:CHATGPT_MODEL_DEFAULTS[edit.role];
     current={...current,[edit.role]:selection};
    }else{
     validateChatGPTSelection(roles,catalog);
     if(scenario!=='cancel')current=chatgptModelConfig(roles);
    }
    calls++;return json({note:(scenario==='cancel'?'模拟取消，草稿保留':'模拟保存成功')+' · '+calls+' 次'});}catch{return json({error:'chatgpt_model_config_invalid'},400);}
  }
  if(url.pathname==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(js);}
  if(url.pathname==='/app.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(css);}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(url.pathname!=='/'){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Homer 实际模型设置 · 隔离验证</title><link rel="stylesheet" href="/app.css"><div id="app"></div><output id="fixture-note" style="position:fixed;bottom:8px;left:12px;color:#67645f;font:12px system-ui">实际设置组件 · 合成桌面桥 · 无真实账号或模型调用</output><script src="/app.js"></script></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port+'/',close:async()=>{await new Promise(resolve=>server.close(resolve));rmSync(scratch,{recursive:true,force:true});}};
}
if(process.argv.includes('--serve')){const fixture=await desktopModelSettingsBrowser();console.log(fixture.url);process.once('SIGINT',async()=>{await fixture.close();process.exit(0);});}
