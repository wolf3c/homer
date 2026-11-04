import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {seedFirstLaunchSkills} from '../src/first-launch.ts';

const script='.codex/skills/homer-feedback/scripts/submit-feedback.mjs';
const report={title:'文件打开失败',body:'用户描述：点击打开后没有响应。期望：打开文件。复现与版本：未知。'};
function run(input,scenario='success',{configured=true,installed=false,splitUtf8=false}={}){
 const base=resolve('.codex/scratch/homer-feedback');mkdirSync(base,{recursive:true});
 const dir=mkdtempSync(join(base,'isolated-'));
 try{
  let sourcePath=resolve(script);
  if(installed){seedFirstLaunchSkills(join(dir,'codex'));sourcePath=join(dir,'codex/skills/homer-feedback/scripts/submit-feedback.mjs');assert.equal(readFileSync(sourcePath,'utf8'),readFileSync(script,'utf8'));}
  let source=readFileSync(sourcePath,'utf8');
  source=source.replace(/^const ENDPOINT = .*;$/m,`const ENDPOINT = ${JSON.stringify(configured?'https://feedback.example/api/user-feedback':'')};`)
   .replace(/^const PROJECT_KEY = .*;$/m,`const PROJECT_KEY = ${JSON.stringify(configured?'tm_proj_synthetic':'')};`);
  const path=installed?sourcePath:join(dir,'submit.mjs');writeFileSync(path,source);
  const preload=`${splitUtf8?`const {Readable}=await import('node:stream');const bytes=Buffer.from(${JSON.stringify(JSON.stringify(input))});const split=bytes.findIndex(byte=>byte>127)+1;Object.defineProperty(process,'stdin',{value:Readable.from([bytes.subarray(0,split),bytes.subarray(split)])});`:''}
  globalThis.fetch=async(url,options)=>{
   process.stderr.write(JSON.stringify({url,options:{...options,signal:undefined},aborted:options.signal.aborted})+'\\n');
   if(${JSON.stringify(scenario)}==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
   if(${JSON.stringify(scenario)}==='body_timeout')return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});}}));
   if(${JSON.stringify(scenario)}==='network')throw Error('PRIVATE DETAIL');
   const results={success:[202,{ok:true,userFeedbackId:'feedback-test'}],rejected:[400,{error:'PRIVATE DETAIL'}],business:[202,{ok:false,userFeedbackId:'wrong'}],missing:[202,{ok:true}],empty:[202,{ok:true,userFeedbackId:' '}],ignored:[202,{ok:true,userFeedbackId:'wrong',ignored:true}],wrongType:[202,{ok:true,userFeedbackId:123}],queued:[202,{ok:true,accepted:true}],redirect:[302,{}],invalid:[202,'not json'],server:[500,{}]};
   const [status,body]=results[${JSON.stringify(scenario)}];
   return new Response(typeof body==='string'?body:JSON.stringify(body),{status});
  };AbortSignal.timeout=(ms)=>{if(ms!==15000)throw Error('wrong timeout');const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new DOMException('PRIVATE DETAIL','TimeoutError')),50);if(!['timeout','body_timeout'].includes(${JSON.stringify(scenario)}))timer.unref();return controller.signal;};`;
  const result=spawnSync(process.execPath,['--preserve-symlinks-main','--import','data:text/javascript,'+encodeURIComponent(preload),path],{input:typeof input==='string'?input:JSON.stringify(input),encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}});
  assert.ifError(result.error);
  const calls=result.stderr.trim()?result.stderr.trim().split('\n').map(line=>JSON.parse(line)):[];
  assert.ok(!result.stdout.includes('PRIVATE DETAIL'));
  return {status:result.status,result:JSON.parse(result.stdout),calls};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('installed feedback Skill sends one scoped report and returns a server receipt',()=>{
 const first=run(report,'success',{installed:true}),second=run(report);
 assert.equal(first.status,0);assert.deepEqual(first.result,{ok:true,userFeedbackId:'feedback-test'});assert.equal(first.calls.length,1);
 const call=first.calls[0],body=JSON.parse(call.options.body);
 assert.equal(call.url,'https://feedback.example/api/user-feedback');assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');assert.equal(call.aborted,false);
 assert.deepEqual(body.message,{kind:'issue',...report});assert.equal(body.projectKey,'tm_proj_synthetic');assert.deepEqual(body.source,{type:'server_app',key:'homer',label:'Homer'});
 assert.equal(body.platform,'server');assert.equal(body.path,'/feedback');assert.ok(Number.isFinite(Date.parse(body.occurredAt)));
 assert.ok(body.sessionId);assert.notEqual(body.sessionId,JSON.parse(second.calls[0].options.body).sessionId);
 assert.deepEqual(Object.keys(body).sort(),['message','occurredAt','path','platform','projectKey','sessionId','source'].sort());
});

test('UTF-8 input split inside a Chinese character preserves the report',()=>{
 const result=run(report,'success',{splitUtf8:true});assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.calls[0].options.body).message,{kind:'issue',...report});
});

test('reports at both size limits are accepted without truncation',()=>{
 const boundary={title:'题'.repeat(160),body:'文'.repeat(4000)};
 const result=run(boundary);assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.calls[0].options.body).message,{kind:'issue',...boundary});
});

test('invalid input and missing project configuration never send',()=>{
 for(const input of ['{',null,[],{}, {...report,title:' '},{...report,body:''},{...report,title:123},{...report,title:'x'.repeat(161)},{...report,body:'x'.repeat(4001)},{...report,url:'https://evil.example'},{...report,attachments:[]},' '.repeat(40000)]){
  const result=run(input);assert.equal(result.status,1);assert.equal(result.calls.length,0);assert.equal(result.result.ok,false);
 }
 const result=run(report,'success',{configured:false});assert.equal(result.status,1);assert.equal(result.calls.length,0);assert.equal(result.result.error,'not_configured');
});

test('obvious private material is rejected locally without echoing it',()=>{
 for(const body of ['Bearer abcdefghijklmn','sk-abcdefghijklmnop','https://example.com/path?a=private','user@example.com','Authorization: private','-----BEGIN PRIVATE KEY-----','api_key=private']){
  const result=run({...report,body});assert.equal(result.status,1);assert.equal(result.calls.length,0);assert.equal(result.result.error,'sensitive_content');assert.ok(!JSON.stringify(result.result).includes(body));
 }
});

test('failed or ambiguous responses never report delivery or retry',()=>{
 for(const scenario of ['rejected','business','missing','empty','ignored','wrongType','queued','redirect','invalid','server','timeout','body_timeout','network']){
  const result=run(report,scenario);assert.equal(result.status,1);assert.equal(result.calls.length,1);assert.equal(result.result.ok,false);assert.equal(result.result.userFeedbackId,undefined);
  assert.equal(result.result.error,['rejected','business','redirect'].includes(scenario)?'submission_rejected':'delivery_unconfirmed');
 }
});
