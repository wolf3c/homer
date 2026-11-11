#!/usr/bin/env node
// Offline protocol peer for reception/IPC acceptance. No account or network.
import {createInterface} from 'node:readline';
import {join} from 'node:path';
if(process.argv.includes('--version')){console.log('codex-cli 0.163.0');process.exit(0);}
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const argument=process.argv.find(value=>value.startsWith('mcp_servers.homer_interactions='));
const trusted=argument?JSON.parse(argument.slice(argument.indexOf('=')+1).replace(/("(?:[^"\\]|\\.)*")=/g,'$1:')):undefined;
let thread='synthetic-reception-main',turn,sequence=0,generation=0;
const event=(method,params)=>send({method,params:{threadId:thread,turnId:turn,...params}});
createInterface({input:process.stdin}).on('line',line=>void receive(JSON.parse(line)));
async function receive(message){
 if(message.method==='initialize')send({id:message.id,result:{userAgent:'synthetic-reception/0.163.0',codexHome:process.env.CODEX_HOME}});
 if (message.method === 'model/list') send({id:message.id,result:{data:[]}}); // Synthetic peer reports no tier catalog; dedicated Fast tests cover advertised priority.
 if(message.method==='config/read')send({id:message.id,result:{config:{features:{memories:true},memories:{dedicated_tools:true},mcp_servers:trusted?{homer_interactions:trusted}:{}},layers:[{name:{type:'user',file:join(process.env.CODEX_HOME,'config.toml')},version:'synthetic-config',config:{}}]}});
 if(message.method==='mcpServerStatus/list')send({id:message.id,result:{data:[{name:'homer_interactions',tools:Object.fromEntries((trusted?.enabled_tools??[]).map(name=>[name,{}]))}]}});
 if(message.method==='environment/info')send({id:message.id,result:{shell:'/bin/zsh'}});
 if(message.method==='thread/backgroundTerminals/list')send({id:message.id,result:{data:[]}});
 if(message.method==='config/mcpServer/reload')send({id:message.id,result:{}});
 if(message.method==='skills/list')send({id:message.id,result:{data:[]}});
 if(message.method==='thread/memoryMode/set')send({id:message.id,result:{}});
 if(['thread/start','thread/resume'].includes(message.method)){
  thread=message.params.threadId??thread;send({id:message.id,result:{thread:{id:thread},activePermissionProfile:{id:'homer'},approvalPolicy:message.params.approvalPolicy??'never'}});
 }
 if(message.method==='turn/start'){
  turn='synthetic-native-'+ ++sequence;const own=++generation;
  send({id:message.id,result:{turn:{id:turn,status:'inProgress'}}});event('turn/started',{turn:{id:turn}});
  event('item/started',{item:{id:'commentary',type:'agentMessage',phase:'commentary',text:''}});
  const burst=Number(message.params.input.map(item=>item.text??'').join('\n').match(/synthetic:delta-count=(\d+)/)?.[1]??0);
  const deltas=burst>0?Array.from({length:Math.min(burst,500)},(_,i)=>`Synthetic-${i};`):['Synthetic ','public ','progress'];
  for(const delta of deltas){
   if(own!==generation)return;event('item/agentMessage/delta',{itemId:'commentary',delta});if(!burst)await new Promise(resolve=>setTimeout(resolve,40));
  }
  if(message.params.input.some(item=>item.text?.includes('synthetic:hold')))return;
  if(own!==generation)return;
  event('item/completed',{item:{id:'commentary',type:'agentMessage',phase:'commentary',text:deltas.join('')}});
  event('thread/tokenUsage/updated',{tokenUsage:{last:{totalTokens:10},total:{totalTokens:10}}});
  event('item/completed',{item:{id:'final',type:'agentMessage',phase:'final_answer',text:'Synthetic final answer'}});
  event('turn/completed',{turn:{id:turn,status:'completed'}});
 }
 if(message.method==='turn/interrupt'){
  generation++;send({id:message.id,result:{}});event('turn/completed',{turn:{id:turn,status:'interrupted'}});
 }
}
