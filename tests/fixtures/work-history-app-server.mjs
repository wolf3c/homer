#!/usr/bin/env node
// Protocol-only synthetic native owner. Never starts a model or reads real HOME.
import { createInterface } from 'node:readline';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home=process.env.CODEX_HOME,file=join(home,'synthetic-history.json');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const state=()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{exists:false,deletes:0};
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;let result={};const value=state();
 if(m.method==='initialize')result={userAgent:'synthetic-history/0.163.0 ',codexHome:home};
 else if(m.method==='config/read')result={config:{features:{memories:true},memories:{dedicated_tools:true},mcp_servers:{}},layers:[]};
 else if(m.method==='synthetic/seed'){writeFileSync(file,JSON.stringify({...m.params,exists:true,deletes:0}));}
 else if(m.method==='thread/read'){
  if(!value.exists||value.threadId!==m.params.threadId)return send({id:m.id,error:{code:-32600,message:'thread not found: '+m.params.threadId}});
  result={thread:{id:value.threadId,status:{type:'notLoaded'}}};
 }else if(m.method==='thread/list')result={data:[],nextCursor:null};
 else if(m.method==='thread/delete'){
  if(value.threadId!==m.params.threadId)throw Error('synthetic_wrong_thread');
  writeFileSync(file,JSON.stringify({...value,exists:false,deletes:value.deletes+1}));
  if(value.loseAck)return process.exit(0);
 }else return send({id:m.id,error:{code:-32601,message:'synthetic_unsupported'}});
 send({id:m.id,result});
});
