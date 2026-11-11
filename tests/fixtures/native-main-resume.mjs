import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {isAbsolute,join,resolve,sep} from 'node:path';

const serviceModule=process.env.HOMER_TEST_SERVICE_MODULE;
assert.ok(serviceModule?.startsWith('file://'),'explicit compiled Homer service module required');
const {MAIN_TOOLS}=await import(new URL('./tools.js',serviceModule));
const {RECURSIVE_TOOLS}=await import(new URL('./recursive-tools.js',serviceModule));
export const tools=[...MAIN_TOOLS,...RECURSIVE_TOOLS];
export function fixture(t) {
 const bin=process.env.HOMER_TEST_CODEX_BIN;
 assert.ok(bin&&isAbsolute(bin),'explicit bundled engine required');
 const parent=resolve('.codex/scratch/macos-desktop-application/native-tools-resume');
 mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-'));
 for(const name of ['codex','host-home','tmp','workspace'])mkdirSync(join(root,name),{mode:0o700});
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return {bin,root,home:join(root,'codex'),cwd:join(root,'workspace'),calls:[]};
}

export function peer({root,home,cwd,calls},bin,baseUrl='http://127.0.0.1:9/v1') {
 assert.ok(isAbsolute(bin),'explicit engine path required');
 const settings={approval_policy:'on-request',web_search:'disabled','features.shell_tool':false,
  'features.plugins':false,'features.apps':false,'features.memories':false,'memories.generate_memories':false,
  'memories.use_memories':false,'features.skip_host_skill_discovery':true,'analytics.enabled':false,'feedback.enabled':false,
  model_provider:'synthetic_boundary','model_providers.synthetic_boundary':{
   name:'Synthetic local boundary',base_url:baseUrl,wire_api:'responses',supports_websockets:false,requires_openai_auth:false,
  },
 };
 const toml=value=>value&&typeof value==='object'&&!Array.isArray(value)
  ?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}'
  :JSON.stringify(value);
 const hostHome=join(root,'host-home'),temp=join(root,'tmp');
 const child=spawn(bin,['app-server','--stdio',...Object.entries(settings).flatMap(([k,v])=>['-c',k+'='+toml(v)])],{
  cwd,env:{HOME:hostHome,CODEX_HOME:home,TMPDIR:temp,...(process.platform==='win32'
   ?{USERPROFILE:hostHome,TEMP:temp,TMP:temp,SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}
   :{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'})},
  stdio:['pipe','pipe','pipe'],
 });
 child.stderr.resume();
 const pending=new Map(),events=[];
 let seq=0,failure;
 function fail(error){
  failure??=error;
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(failure);}
  pending.clear();
 }
 child.once('error',fail);
 child.stdin.on('error',fail);
 const exited=new Promise(done=>child.once('close',(code,signal)=>{
  fail(Error('synthetic_native_closed'));
  done({code,signal});
 }));
 createInterface({input:child.stdout}).on('line',line=>{
  const m=JSON.parse(line),p=pending.get(m.id);
  if(p&&!m.method){
   pending.delete(m.id);
   clearTimeout(p.timer);
   m.error?p.reject(Error('synthetic_native_rpc_failed:'+m.error.code)):p.resolve(m.result);
  }else if(m.method)events.push(m);
 });
 return {
  events,
  request(method,params){
   if(failure)return Promise.reject(failure);
   calls.push(method);
   return new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('synthetic_native_timeout:'+method));},12000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
   });
  },
  async init(){
   const initialized=await this.request('initialize',{clientInfo:{name:'homer-tools-resume-synthetic',version:'1'},capabilities:{experimentalApi:true}});
   assert.equal(resolve(initialized.codexHome),home);
   child.stdin.write('{"method":"initialized","params":{}}\n');
  },
  async close(){
   child.stdin.end();
   const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
   const {code,signal}=await exited.finally(()=>clearTimeout(timer));
   assert.equal(code,0,signal?'native app-server exit: '+signal:failure.message);
  },
 };
}

export function metadata({home},path){
 assert.ok(path.startsWith(home+sep));
 const lines=readFileSync(path,'utf8').split('\n');
 for(const line of lines){
  if(!line)continue;
  const item=JSON.parse(line);
  if(item.type==='session_meta')return item.payload;
 }
 assert.fail('native rollout missing session metadata');
}
