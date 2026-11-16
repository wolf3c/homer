#!/usr/bin/env node
// Synthetic AppServer and private native database only; no model or network.
import{createInterface}from'node:readline';
import{existsSync,readFileSync,writeFileSync,appendFileSync}from'node:fs';
import{join}from'node:path';
import{DatabaseSync}from'node:sqlite';
const home=process.env.CODEX_HOME,db=new DatabaseSync(join(home,'state_5.sqlite'));
const setting=name=>{const value=process.argv.find(arg=>arg.startsWith(name+'='));return value?JSON.parse(value.slice(name.length+1)):undefined;};
const provider=setting('model_provider')??'openai',model=setting('model');
const state=()=>JSON.parse(readFileSync(join(home,'fixture.json'),'utf8'));
const timers=new Set();let closed=false;
const send=value=>{if(!closed)process.stdout.write(JSON.stringify(value)+'\n');};
const record=(method,params)=>{const value={method,...(typeof params?.threadId==='string'?{threadId:params.threadId}:{}),...(method==='thread/memoryMode/set'?{mode:params.mode}:{})};appendFileSync(join(home,'calls.jsonl'),JSON.stringify(value)+'\n');};
const row=id=>db.prepare('SELECT * FROM threads WHERE id=?').get(id);
const thread=(value,includeTurns=false)=>({id:value.id,modelProvider:value.model_provider,...(includeTurns?{turns:[]}: {})});
const lines=createInterface({input:process.stdin});
lines.on('close',()=>{closed=true;for(const timer of timers)clearTimeout(timer);db.close();});
lines.on('line',line=>{void receive(JSON.parse(line));});
async function receive(message){
 if(message.id===undefined||!message.method)return;const params=message.params??{};record(message.method,params);let result={};
 try{
  if(message.method==='initialize')result={userAgent:'synthetic/0.171.0-alpha.7',codexHome:home};
  if(message.method==='config/read')result={config:{model_provider:provider,features:{memories:true},memories:{dedicated_tools:true},mcp_servers:{}},layers:[]};
  if(message.method==='model/list')result={data:[{id:model,model,inputModalities:['text'],serviceTiers:[]}],nextCursor:null};
  if(message.method==='thread/backgroundTerminals/list'||message.method==='skills/list')result={data:[]};
  if(message.method==='thread/read'){const options=state(),value=row(params.threadId)??(params.threadId===options.sourceId?{id:options.sourceId,model_provider:options.sourceProvider}:undefined);if(!value)throw Error('thread_not_found');result={thread:thread(value,params.includeTurns)};if(options.readFault==='provider')result.thread.modelProvider='homer';if(options.readFault==='unknown-provider')result.thread.modelProvider='unknown';if(options.readFault==='id')result.thread.id='foreign-thread';}
  if(message.method==='thread/resume')result={thread:thread(row(params.threadId)),modelProvider:provider};
  if(message.method==='thread/fork'){
   const source=row(params.threadId),options=state(),id='binding-child';
   if(options.projection!=='missing')db.prepare('INSERT INTO threads VALUES(?,?,?,?)').run(id,provider,'enabled',source.history);
   if(options.holdFork){
    writeFileSync(join(home,'fork-pending'),'1');
    while(!closed&&!existsSync(join(home,'release-fork')))await new Promise(resolve=>{const timer=setTimeout(()=>{timers.delete(timer);resolve();},5);timers.add(timer);});
    if(closed)return;
   }
   const value={id,modelProvider:provider,forkedFromId:source.id};
   if(options.fault==='thread-provider')value.modelProvider='openai';
   if(options.fault==='parent')value.forkedFromId='foreign-thread';
   if(options.fault==='same-id')value.id=source.id;
   if(options.fault==='empty-id')value.id='';
   if(options.fault==='missing-id')delete value.id;
   result={thread:value,modelProvider:options.fault==='top-provider'?'openai':provider};
  }
  if(message.method==='thread/memoryMode/set'){
   const projection=state().projection;if(projection!=='ignored')db.prepare('UPDATE threads SET memory_mode=? WHERE id=?').run(projection==='invalid'?'unknown':params.mode,params.threadId);
  }
  if(message.method==='turn/start'){
   result={turn:{id:'bound-turn',status:'inProgress'}};
   setImmediate(()=>{send({method:'item/completed',params:{threadId:params.threadId,turnId:'bound-turn',item:{id:'synthetic-answer',type:'agentMessage',text:'synthetic binding reply'}}});send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:'bound-turn',status:'completed'}}});});
  }
  send({id:message.id,result});
 }catch(error){send({id:message.id,error:{code:-32000,message:error.message}});}
}
