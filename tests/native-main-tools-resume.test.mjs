import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const {MAIN_TOOLS}=await import(new URL('./tools.js',process.env.HOMER_TEST_SERVICE_MODULE));
const {RECURSIVE_TOOLS}=await import(new URL('./recursive-tools.js',process.env.HOMER_TEST_SERVICE_MODULE));
const tools=[...MAIN_TOOLS,...RECURSIVE_TOOLS];
const toolsHash=createHash('sha256').update(JSON.stringify(tools)).digest('hex');
test('fixed native engine resumes the exact complete current tools without replacing definitions or calling a model',{timeout:45000},async()=>{
 const bin=process.env.HOMER_TEST_CODEX_BIN;assert.ok(bin?.startsWith('/'),'explicit bundled engine required');
 const parent=resolve('.codex/scratch/macos-desktop-application/native-tools-resume');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-')),home=join(root,'codex');
 for(const name of ['codex','host-home','tmp','workspace'])mkdirSync(join(root,name),{mode:0o700});
 const calls=[];
 function peer(){
  const settings={approval_policy:'on-request',web_search:'disabled','features.shell_tool':false,'features.plugins':false,'features.apps':false,'features.memories':false,'memories.generate_memories':false,'memories.use_memories':false,'features.skip_host_skill_discovery':true,'analytics.enabled':false,'feedback.enabled':false,model_provider:'synthetic_boundary','model_providers.synthetic_boundary':{name:'Synthetic local boundary',base_url:'http://127.0.0.1:9/v1',wire_api:'responses',supports_websockets:false,requires_openai_auth:false}};
  const toml=value=>value&&typeof value==='object'&&!Array.isArray(value)?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(value);
  const child=spawn(bin,['app-server','--stdio',...Object.entries(settings).flatMap(([k,v])=>['-c',k+'='+toml(v)])],{cwd:join(root,'workspace'),env:{HOME:join(root,'host-home'),CODEX_HOME:home,TMPDIR:join(root,'tmp'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},stdio:['pipe','pipe','pipe']});
  child.stderr.resume();const pending=new Map();let seq=0;
  const exited=new Promise(done=>child.once('exit',(code,signal)=>done({code,signal})));
  createInterface({input:child.stdout}).on('line',line=>{
   const m=JSON.parse(line),p=pending.get(m.id);
   if(p&&!m.method){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('synthetic_native_rpc_failed:'+m.error.code)):p.resolve(m.result);}
  });
  return {async request(method,params){calls.push(method);return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('synthetic_native_timeout:'+method));},12000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});},async init(){await this.request('initialize',{clientInfo:{name:'homer-tools-resume-synthetic',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized","params":{}}\n');},async close(){child.kill('SIGTERM');let timer;await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic_native_stop_unconfirmed')),5000);})]).finally(()=>clearTimeout(timer));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('synthetic_native_closed'));}pending.clear();}};
 }
 let first=peer(),second;
 const metadata=path=>{assert.ok(path.startsWith(home+'/'));return readFileSync(path,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)).find(x=>x.type==='session_meta').payload;};
 try{
  await first.init();
  const created=await first.request('thread/start',{model:'gpt-6.1-sol',modelProvider:'synthetic_boundary',cwd:join(root,'workspace'),approvalPolicy:'on-request',sandbox:'read-only',environments:[],config:{mcp_servers:{}},dynamicTools:tools});
  const thread=created.thread.id;await first.request('thread/memoryMode/set',{threadId:thread,mode:'disabled'});
  await first.request('thread/inject_items',{threadId:thread,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic tool resume marker. No model execution.'}]}]});
  const before=await first.request('thread/read',{threadId:thread,includeTurns:true});assert.deepEqual(metadata(before.thread.path).dynamic_tools,tools);
  assert.equal(createHash('sha256').update(JSON.stringify(metadata(before.thread.path).dynamic_tools)).digest('hex'),toolsHash);
  await first.close();first=undefined;second=peer();await second.init();
  const resumed=await second.request('thread/resume',{threadId:thread,excludeTurns:true,cwd:join(root,'workspace'),approvalPolicy:'on-request'});assert.equal(resumed.thread.id,thread);
  const after=await second.request('thread/read',{threadId:thread,includeTurns:true});assert.deepEqual(metadata(after.thread.path).dynamic_tools,tools);
  assert.equal(createHash('sha256').update(JSON.stringify(metadata(after.thread.path).dynamic_tools)).digest('hex'),toolsHash);
  assert.equal(calls.filter(x=>x==='thread/start').length,1);assert.equal(calls.includes('turn/start'),false);
 }finally{await first?.close();await second?.close();rmSync(root,{recursive:true,force:true});}
});
