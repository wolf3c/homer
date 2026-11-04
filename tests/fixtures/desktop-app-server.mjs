#!/usr/bin/env node
// Offline native-protocol fixture. All files, prompts and accounts are synthetic.
import {createInterface} from 'node:readline';
import {existsSync,readFileSync,appendFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
if(process.argv.includes('--version')){console.log('codex-cli 0.163.0');process.exit(0);}
const home=process.env.CODEX_HOME;
if(!home||!existsSync(join(dirname(home),'.homer-desktop-test-profile')))process.exit(80);
mkdirSync(home,{recursive:true});
const statePath=join(dirname(home),'fixture-control.json');
const state=()=>existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const settings=Object.fromEntries(process.argv.flatMap((arg,i)=>{
  if(process.argv[i-1]!=='-c')return [];const at=arg.indexOf('=');let value=arg.slice(at+1);
  try{value=JSON.parse(value.replace(/("(?:[^"\\]|\\.)*")=/g,'$1:'));}catch{}
  return [[arg.slice(0,at),value]];
}));
const mcp=settings['mcp_servers.homer_interactions'];
const worker=mcp?.args?.at(-1)==='worker',pending=new Map();let sequence=0;
const tool=(name,args)=>new Promise(accept=>{const id='synthetic-tool-'+ ++sequence;pending.set(id,accept);send({id,method:'item/tool/call',params:{threadId:thread,turnId:turn,callId:id,tool:name,arguments:args}});});
const complete=text=>{
 send({method:'item/completed',params:{threadId:thread,turnId:turn,item:{id:'synthetic-answer-'+turn,type:'agentMessage',phase:'final_answer',text}}});
 send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'completed'}}});
};
let thread,turn;
const trace=method=>appendFileSync(join(dirname(home),'fixture-methods.jsonl'),JSON.stringify({method,pid:process.pid})+'\n');
process.on('SIGTERM',()=>{if(state().refuseStop)return;process.exit(0);});
createInterface({input:process.stdin}).on('line',line=>{void receive(JSON.parse(line));});
async function receive(m){
  if(!m.method){const accept=pending.get(m.id);if(accept){pending.delete(m.id);accept(m.result);}return;}
  trace(m.method);if(m.id===undefined)return;
  const reply=result=>send({id:m.id,result});
  if(m.method==='initialize')return reply({userAgent:'desktop-synthetic/0.163.0',codexHome:home});
  if(m.method==='config/read')return reply({config:{...Object.fromEntries(['model','model_catalog_json','model_context_window','model_auto_compact_token_limit','model_auto_compact_token_limit_scope','web_search'].map(name=>[name,settings[name]])),features:{memories:true},memories:{dedicated_tools:true,generate_memories:settings['memories.generate_memories'],extract_model:settings['memories.extract_model'],consolidation_model:settings['memories.consolidation_model']},mcp_servers:mcp?{homer_interactions:mcp}:{}},layers:[{name:{type:'sessionFlags'},config:{mcp_servers:mcp?{homer_interactions:mcp}:{}}},{name:{type:'user',file:join(home,'config.toml')},version:'synthetic-config-1',config:{}}]});
  if(m.method==='account/read'){
    if(state().offline)return send({id:m.id,error:{code:-32000,message:'synthetic offline'}});
    return reply({account:state().loggedIn?{type:'chatgpt',email:'synthetic@example.invalid',planType:'synthetic'}:null});
  }
  if(m.method==='account/login/start')return reply({type:'chatgpt',loginId:'synthetic-login',authUrl:'https://example.invalid/homer-login'});
  if(m.method==='account/login/cancel')return reply({status:'canceled'});
  if(m.method==='account/logout'){writeFileSync(statePath,JSON.stringify({...state(),loggedIn:false}));return reply({});}
  if(m.method==='skills/list'){
    const skills=join(home,'skills');return reply({data:[{skills:existsSync(skills)?readdirSync(skills).filter(name=>!name.startsWith('.')).map(name=>({name,path:join(skills,name,'SKILL.md'),enabled:true,description:'合成初始化技能'})):[],errors:[]}]});
  }
  if(m.method==='environment/info')return reply({shell:'/bin/zsh'});
  if(m.method==='model/list')return reply({data:settings.model_catalog_json?[{id:settings.model,model:settings.model,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','high','max'].map(reasoningEffort=>({reasoningEffort}))}]:[]});
  if(m.method==='thread/start'||m.method==='thread/resume'){
    if(state().failThread)return send({id:m.id,error:{code:-32000,message:'synthetic thread failure'}});
    thread=m.params.threadId??(worker?'synthetic-desktop-worker-'+process.pid:'synthetic-desktop-main');
    return reply({thread:{id:thread},activePermissionProfile:{id:'homer'},approvalPolicy:'on-request'});
  }
  if(m.method==='mcpServerStatus/list')return reply({data:mcp?[{name:'homer_interactions',tools:Object.fromEntries(mcp.enabled_tools.map(name=>[name,{}]))}]:[]});
  if(m.method==='thread/backgroundTerminals/list')return reply({data:[]});
  if(m.method==='turn/start'){
    if(state().deepseekSmoke)appendFileSync(join(dirname(home),'fixture-models.jsonl'),JSON.stringify({worker,model:settings.model,effort:m.params.effort,serviceTier:m.params.serviceTier,provider:settings['model_providers.homer'],keyPresent:!!process.env.HOMER_DEEPSEEK_TOKEN})+'\n');
    if(state().crashOnTurn){process.exit(70);return;}
    turn='synthetic-turn-'+m.id;reply({turn:{id:turn,status:'inProgress'}});
    send({method:'turn/started',params:{threadId:thread,turn:{id:turn,status:'inProgress'}}});
    if(state().holdTurn)return;
    if(state().deepseekSmoke){
      const text=m.params.input.map(i=>i.text??'').join('');
      if(worker){await tool('read_material',{});await tool('write_markdown',{filename:'hello.md',content:'DeepSeek Worker 已运行（离线合成）'});complete('离线合成 Worker 已写入文件。');return;}
      if(text==='dispatch-synthetic'){await tool('dispatch_work',{title:'DeepSeek 合成 Worker',goal:'离线合成文件',material:'synthetic.md',matterId:null});complete('已派发离线合成 Worker。');return;}
      if(text.startsWith('[执行结果待审阅]')){const runId=text.match(/runId=([\w-]+)/)[1];await tool('inspect_run',{runId});await tool('review_artifact',{runId,accepted:true,summary:'已核对合成文件',reason:'离线合成材料一致'});complete('已核对离线合成 Worker 文件。');return;}
      if(text.startsWith('[执行结果待交付]')){await tool('list_work',{});complete('离线合成文件已交付。');return;}
    }
    complete('这是隔离测试答复；没有调用真实模型。');return;
  }
  if(m.method==='turn/interrupt'){
    reply({});send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'interrupted'}}});return;
  }
  return reply({data:[]});
}
