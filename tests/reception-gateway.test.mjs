import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,cpSync,symlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {syntheticUserFetch} from './web-user-connection.mjs';
import {fixtureBuildEnvironment,fixtureBuildEvidence} from './fixtures/dev-build-trace.mjs';
import {waitForDevCondition} from './fixtures/dev-condition.mjs';
import {PassThrough,Writable} from 'node:stream';
import {runDev} from '../scripts/dev.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+45000;while(!await check()){if(Date.now()>end)throw Error('synthetic_gateway_timeout');await delay(10);}}
for(const json of [true,false])test('real gateway: SSE sees mutations without stdout dependence/polling, idle/no-client stay cheap, reconnect restores latest'+(json?'':' (plain terminal, 300 deltas)'), {timeout:90000},async t=>{
 const root=resolve('.'),parent=join(root,'.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'gateway-'));
 for(const name of ['src','scripts','prompts','assets','ui','package.json','package-lock.json','tsconfig.json'])cpSync(join(root,name),join(base,name),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path)});
 symlinkSync(join(root,'node_modules'),join(base,'node_modules'),'dir');for(const dir of ['runtime','home','workspace'])mkdirSync(join(base,dir),{recursive:true});
 cpSync(join(root,'tests/fixtures/reception-app-server.mjs'),join(base,'synthetic-engine.mjs'));
 const config=join(base,'synthetic.config.json');writeFileSync(config,JSON.stringify({workspace:'workspace',runtime:'runtime',codexHome:join(base,'home'),nativeCodexHome:join(base,'home'),codexBin:join(base,'synthetic-engine.mjs'),model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100}));
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const url='http://127.0.0.1:'+port,fetch=syntheticUserFetch();
 const child=spawn(process.execPath,[join(base,'scripts/dev.mjs'),'--web','--port',String(port),'--config',config,...(json?['--json']:[])],{cwd:base,env:fixtureBuildEnvironment(base),stdio:['pipe','pipe','pipe']});
 const progress=[],snapshots=[];let partial='',exited=false;child.stdout.on('data',data=>{partial+=data;const lines=partial.split('\n');partial=lines.pop();for(const line of lines)try{progress.push(JSON.parse(line));}catch{if(!json&&line.startsWith('状态：'))progress.push({type:'progress',text:line.slice(3)});}});child.stderr.resume();child.on('exit',()=>exited=true);
 const readers=[];
 async function connect(){const controller=new AbortController();const response=await fetch(url+'/api/history/events',{signal:controller.signal});const reader=response.body.getReader();let buffer='';const reading=(async()=>{try{for(;;){const {done,value}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.includes('event: state'))snapshots.push(JSON.parse(frame.match(/^data: (.*)$/m)[1]));}}}catch{}})();const close=async()=>{controller.abort();await reading;};readers.push(close);return close;}
 const post=(path,input)=>fetch(url+path,{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify(input)});
 async function buildCount(){const start=progress.length;child.stdin.write('/timings\n');let report;await until(()=>{for(const entry of progress.slice(start))try{const value=JSON.parse(entry.text);if(value.capacity===512)report=value;}catch{}return !!report;});return report.records.filter(record=>record.phase==='state_history').length;}
 try{
  await waitForDevCondition(async()=>{try{return (await(await fetch(url+'/api/history/state')).json()).upgrade?.phase==='running';}catch{return false;}},{signal:t.signal,events:progress,exited:()=>exited});
  await connect();await until(()=>snapshots.length>0);await delay(250);
  const idle=await buildCount();await delay(400);assert.equal(await buildCount(),idle,'unchanged connected pages must not rebuild');
  const first=await post('/api/messages',{requestId:'synthetic-hold',text:'synthetic:hold'+(json?'':' synthetic:delta-count=300')});assert.equal(first.status,202);const receipt=await first.json();
  await until(()=>snapshots.at(-1)?.generation?.messageId===receipt.replyId);
  for(const requestId of ['synthetic-edit','synthetic-cancel'])assert.equal((await post('/api/messages',{requestId,text:'Synthetic queued'})).status,202);
  assert.equal((await post('/api/messages/edit',{requestId:'synthetic-edit',operationId:'synthetic-edit-op',expectedRevision:0,input:{requestId:'synthetic-edit',text:'Synthetic corrected'}})).status,200);
  await until(()=>snapshots.at(-1)?.queue.some(item=>item.input.requestId==='synthetic-cancel'&&item.state==='queued')&&snapshots.at(-1).queue.some(item=>item.input.requestId==='synthetic-edit'&&item.input.text==='Synthetic corrected'));
  const beforeCancel=snapshots.length;
  assert.equal((await post('/api/messages/cancel',{requestId:'synthetic-cancel',operationId:'synthetic-cancel-op',expectedRevision:0})).status,200);
  await until(()=>snapshots.length>beforeCancel&&!snapshots.at(-1).queue.some(item=>item.input.requestId==='synthetic-cancel')&&snapshots.at(-1).queue.some(item=>item.input.requestId==='synthetic-edit'&&item.input.text==='Synthetic corrected'&&item.state==='queued'));
  const cancelled=await(await post('/api/history/receipts',{requestIds:['synthetic-cancel']})).json();assert.deepEqual(cancelled.statuses.map(item=>[item.requestId,item.state]),[['synthetic-cancel','cancelled']]);
  assert.equal((await post('/api/stop',{messageId:receipt.replyId})).status,202);
  await until(()=>snapshots.at(-1)?.messages.some(item=>item.role==='user'&&item.requestId==='synthetic-edit'&&item.inputState==='completed'));
  const settled=snapshots.at(-1);assert.equal(settled.queue.length,0);
  assert.equal(settled.messages.find(item=>item.role==='user'&&item.requestId==='synthetic-edit').text,'Synthetic corrected');
  assert.equal(settled.messages.find(item=>item.role==='user'&&item.requestId==='synthetic-hold').inputState,'interrupted');
  assert.equal(settled.messages.find(message=>message.process?.replyMessageId===receipt.replyId).process.status,'interrupted');
  const message=snapshots.at(-1).messages.find(item=>item.role==='assistant'&&item.status==='completed');
  assert.equal((await post('/api/messages/feedback',{messageId:message.id,value:'up'})).status,200);
  await until(()=>snapshots.at(-1)?.messages.some(item=>item.id===message.id&&item.feedback==='up'));
  for(const close of readers.splice(0))await close();await delay(200);
  const disconnected=await buildCount();assert.equal((await post('/api/messages',{requestId:'synthetic-offline',text:'Synthetic accepted with no page'})).status,202);await delay(500);assert.equal(await buildCount(),disconnected,'no client must mean no background snapshot');
  await connect();await until(()=>snapshots.at(-1)?.messages.some(item=>item.role==='user'&&item.requestId==='synthetic-offline'&&item.inputState==='completed'));
  assert.equal(snapshots.at(-1).queue.length,0);
 }finally{for(const close of readers)await close();child.kill('SIGINT');await until(()=>exited);t.diagnostic(JSON.stringify({fixture:'reception-gateway',buildStages:fixtureBuildEvidence(base)}));rmSync(base,{recursive:true,force:true});}
});

test('real gateway: stdout callback backpressure preserves the written fence and exposes the same output ID in host/gateway timing', {timeout:90000},async t=>{
 const root=resolve('.'),parent=join(root,'.codex/scratch/main-agent-reception-optimization');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'gateway-tail-'));
 for(const name of ['src','scripts','prompts','assets','ui','package.json','package-lock.json','tsconfig.json'])cpSync(join(root,name),join(base,name),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path)});
 symlinkSync(join(root,'node_modules'),join(base,'node_modules'),'dir');for(const dir of ['runtime','home','workspace'])mkdirSync(join(base,dir),{recursive:true});
 cpSync(join(root,'tests/fixtures/reception-app-server.mjs'),join(base,'synthetic-engine.mjs'));
 const config=join(base,'synthetic.config.json');writeFileSync(config,JSON.stringify({workspace:'workspace',runtime:'runtime',codexHome:join(base,'home'),nativeCodexHome:join(base,'home'),codexBin:join(base,'synthetic-engine.mjs'),model:'synthetic-only',requiresOpenaiAuth:false,stopGraceMs:100}));
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const url='http://127.0.0.1:'+port,fetch=syntheticUserFetch(),input=new PassThrough(),events=[];
 let releaseWrite,blocked=false,report,finished=false;
 const output=new Writable({write(chunk,_encoding,callback){
  const message=JSON.parse(String(chunk));
  if(message.type==='progress'){events.push(message);try{const value=JSON.parse(message.text);if(value?.capacity===512)report=value;}catch{}}
  if(message.type==='reply'&&message.requestId==='synthetic-stdout-0'){blocked=true;let released=false;releaseWrite=()=>{if(!released){released=true;callback();}};return;}
  callback();
 }});
 const done=runDev({root:base,configPath:config,json:true,webPort:port,input,output}).finally(()=>finished=true);
 const state=async()=>{try{return await(await fetch(url+'/api/history/state')).json();}catch{return undefined;}};
 try{
  await waitForDevCondition(async()=>(await state())?.upgrade?.phase==='running',{signal:t.signal,events,exited:()=>finished});
  for(let i=0;i<6;i++)assert.equal((await fetch(url+'/api/messages',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'synthetic-stdout-'+i,text:'Synthetic stdout input '+i})})).status,202);
  await until(()=>blocked);
  const waiting=await state();assert.deepEqual(waiting.queue.map(item=>[item.input.requestId,item.state]),Array.from({length:5},(_,i)=>['synthetic-stdout-'+(i+1),'queued']));
  assert.equal(waiting.messages.find(item=>item.role==='user'&&item.requestId==='synthetic-stdout-0').inputState,'completed');
  assert.equal(waiting.messages.find(message=>message.process).process.state,'worked');assert.equal(waiting.activeMessageId,null);
  releaseWrite();await until(async()=>{const s=await state();return s?.messages.filter(item=>item.role==='user'&&item.inputState==='completed').length===6;});
  assert.equal((await state()).queue.length,0);
  input.write('/timings\n');await until(()=>!!report);
  const host=report.records.filter(row=>row.requestId==='synthetic-stdout-0'),started=host.find(row=>row.phase==='output_ipc_start');assert.ok(started);
  const gateway=report.gatewayOutput.filter(row=>row.outputId===started.outputId);assert.deepEqual(gateway.map(row=>row.phase),['output_write_start','output_write_end']);
  assert.ok(host.some(row=>row.phase==='output_ipc_ack'&&row.outputId===started.outputId));assert.ok(host.some(row=>row.phase==='reply_delivery_end'));
  assert.ok(!JSON.stringify(report).includes('Synthetic stdout input'));
 }finally{releaseWrite?.();input.write('/quit\n');await done;input.destroy();output.destroy();rmSync(base,{recursive:true,force:true});}
});
