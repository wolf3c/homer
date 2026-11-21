#!/usr/bin/env node
// Offline native-protocol fixture. All files, prompts and accounts are synthetic.
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync,readFileSync,appendFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.argv.includes('--version')){console.log('codex-cli 0.171.0-alpha.7');process.exit(0);}
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
const modelProvider=settings.model_provider??'openai';
const mcp=settings['mcp_servers.homer_interactions'];
const worker=mcp?.args?.includes('worker')===true;let sequence=0;
function tool(name,args) {
  const id='tool-'+ ++sequence;
  const item={id,type:'mcpToolCall',server:'homer_interactions',tool:name,arguments:args};
  send({method:'item/started',params:{threadId:thread,turnId:turn,item}});
  const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{callId:id,'x-codex-turn-metadata':{turn_id:turn}}}};
  const {result}=JSON.parse(execFileSync(mcp.command,mcp.args,{cwd:mcp.cwd,input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:5000}));
  send({method:'item/completed',params:{threadId:thread,turnId:turn,item:{...item,status:result.isError?'failed':'completed'}}});
  if(result.isError)throw Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}
const complete=text=>{
 send({method:'item/completed',params:{threadId:thread,turnId:turn,item:{id:'synthetic-answer-'+turn,type:'agentMessage',phase:'final_answer',text}}});
 send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'completed'}}});
};
let thread,turn;
const trace=method=>appendFileSync(join(dirname(home),'fixture-methods.jsonl'),JSON.stringify({method,pid:process.pid})+'\n');
process.on('SIGTERM',()=>{if(state().refuseStop)return;process.exit(0);});
createInterface({input:process.stdin}).on('line',line=>{void receive(JSON.parse(line));});
async function receive(m){
  if(!m.method)return;
  trace(m.method);if(m.id===undefined)return;
  const reply=result=>send({id:m.id,result});
  if(m.method==='initialize')return reply({userAgent:'desktop-synthetic/0.171.0-alpha.7',codexHome:home});
  if(m.method==='config/read')return reply({config:{...Object.fromEntries(['model','model_catalog_json','model_context_window','model_auto_compact_token_limit','model_auto_compact_token_limit_scope','web_search','project_root_markers'].map(name=>[name,settings[name]])),features:{memories:true},memories:{dedicated_tools:true,generate_memories:settings['memories.generate_memories'],extract_model:settings['memories.extract_model'],consolidation_model:settings['memories.consolidation_model']},mcp_servers:mcp?{homer_interactions:mcp}:{}},layers:[{name:{type:'sessionFlags'},config:{mcp_servers:mcp?{homer_interactions:mcp}:{}}},{name:{type:'user',file:join(home,'config.toml')},version:'synthetic-config-1',config:{}}]});
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
  if(m.method==='thread/read')return reply({thread:{id:m.params.threadId,modelProvider,...(m.params.includeTurns?{turns:[]}: {})}});
  if(m.method==='thread/start'||m.method==='thread/resume'){
    if(state().failThread)return send({id:m.id,error:{code:-32000,message:'synthetic thread failure'}});
    thread=m.params.threadId??(worker?'synthetic-desktop-worker-'+process.pid:'synthetic-desktop-main');
    return reply({thread:{id:thread,modelProvider},modelProvider,activePermissionProfile:{id:'homer'},approvalPolicy:m.params.approvalPolicy??'on-request',approvalsReviewer:m.params.approvalsReviewer??'user'});
  }
  if(m.method==='mcpServerStatus/list')return reply({data:mcp?[{name:'homer_interactions',tools:Object.fromEntries(mcp.enabled_tools.map(name=>[name,{}]))}]:[]});
  if(m.method==='thread/backgroundTerminals/list')return reply({data:[]});
  if(m.method==='turn/start'){
    if(state().deepseekSmoke)appendFileSync(join(dirname(home),'fixture-models.jsonl'),JSON.stringify({worker,model:settings.model,effort:m.params.effort,serviceTier:m.params.serviceTier,provider:settings['model_providers.homer'],keyPresent:!!process.env.HOMER_DEEPSEEK_TOKEN})+'\n');
    if(state().crashOnTurn){process.exit(70);return;}
    turn='synthetic-turn-'+m.id;reply({turn:{id:turn,status:'inProgress'}});
    send({method:'turn/started',params:{threadId:thread,turn:{id:turn,status:'inProgress'}}});
    if(state().holdTurn)return;
    if(state().toolUpgrade){
      const text=m.params.input.map(item=>item.text??'').join('');
      if(!worker&&text.startsWith('[内部协作输入')){complete('Report received.');return;}
      const listing={jsonrpc:'2.0',id:1,method:'tools/list'};
      const {result}=JSON.parse(execFileSync(mcp.command,mcp.args,{cwd:mcp.cwd,input:JSON.stringify(listing)+'\n',encoding:'utf8',timeout:5000}));
      const names=result.tools.map(tool=>tool.name),required=result.tools.find(tool=>tool.name==='work_directory').inputSchema.required;
      tool('work_directory',Object.fromEntries(required.map(key=>[key,null])));
      appendFileSync(join(dirname(home),'upgrade.jsonl'),JSON.stringify({thread,worker,required,added:names.includes('upgrade_probe'),removed:!names.includes('schedule_cancel')})+'\n');
      if(!worker){
        if(text==='dispatch-synthetic'){
          const {taskId}=tool('task_create',{title:'Synthetic upgrade',goal:'Continue the same synthetic assignment.'});
          const {workerId}=tool('worker_open',{taskId});
          writeFileSync(join(dirname(home),'fixture-worker-id'),workerId);
        }else{
          const needsAttachments=result.tools.find(tool=>tool.name==='worker_message').inputSchema.required.includes('attachments');
          const receipt=tool('worker_message',{workerId:readFileSync(join(dirname(home),'fixture-worker-id'),'utf8'),message:'Continue the original assignment.',...(needsAttachments?{attachments:[]}: {})});
          if(receipt.route!=='followup')throw Error('synthetic_worker_followup_failed');
        }
      }
      complete('Upgrade observed.');return;
    }
    if(state().deepseekSmoke){
      const text=m.params.input.map(i=>i.text??'').join('');
      const input=text.startsWith('[内部协作输入')?JSON.parse(text.split('\n')[1]):undefined;
      if(worker){
        if(!readFileSync(join(m.params.cwd,'synthetic.md'),'utf8').trim())throw Error('synthetic_input_missing');
        const path=join(m.params.cwd,'hello.md');writeFileSync(path,'DeepSeek Worker 已运行（离线合成）');
        complete('离线合成 Worker 已写入文件。\n'+path);return;
      }
      if(text==='dispatch-synthetic'){
        const {taskId}=await tool('task_create',{title:'制作离线合成文件',goal:'读取工作目录中的 synthetic.md，制作离线合成文件。'});
      await tool('worker_open',{taskId});
        complete('已派发离线合成 Worker。');return;
      }
      if(input?.kind==='worker_reply'){
        const reply=await tool('worker_read',{workerId:input.workerId,messageId:input.messageId}),path=reply.messages[0].text.trim().split('\n').at(-1);
        if(readFileSync(path,'utf8')!=='DeepSeek Worker 已运行（离线合成）')throw Error('synthetic_attachment_mismatch');
        await tool('task_update',{taskId:input.taskId,notes:'Checked the Worker report.'});
        complete(`离线合成文件已发送。 [hello.md](${pathToFileURL(path).href})`);return;
      }
    }
    complete('这是隔离测试答复；没有调用真实模型。');return;
  }
  if(m.method==='turn/interrupt'){
    reply({});send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'interrupted'}}});return;
  }
  return reply({data:[]});
}
