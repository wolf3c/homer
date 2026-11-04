import {syntheticUserFetch} from './web-user-connection.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,writeFileSync,appendFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {seamlessFixture} from '../scripts/seamless-synthetic-fixture.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,timeout=45000){const end=Date.now()+timeout;while(!await check()){if(Date.now()>end)throw Error('gateway_fixture_timeout');await delay(30);}}

// Real launcher + business processes + SQLite + HTTP, injected EngineLike only.
// codexBin=/usr/bin/false, independent empty home, no credentials or channels.
test('gateway accepts Web/CLI during handoff, survives crash and reconciles a lost commit ack exactly once',{timeout:150000},async()=>{
 const {base,configPath:config}=seamlessFixture();const fetch=syntheticUserFetch();
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const url=`http://127.0.0.1:${port}`,events=[],children=[];
 function launch(){
  const child=spawn(process.execPath,[join(base,'scripts/dev.mjs'),'--web','--port',String(port),'--config',config,'--json'],{cwd:base,stdio:['pipe','pipe','pipe']});children.push(child);let text='';
  child.stdout.on('data',data=>{text+=data;const lines=text.split('\n');text=lines.pop();for(const line of lines)try{events.push(JSON.parse(line));}catch{}});
  child.stderr.on('data',()=>{});return child;
 }
 const state=async()=>{try{return await(await fetch(url+'/api/state')).json();}catch{return undefined;}};
 const post=async input=>{const r=await fetch(url+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify(input)});return {status:r.status,value:await r.json()};};
 const query=sql=>{const db=new DatabaseSync(join(base,'runtime/homer.sqlite'));try{return db.prepare(sql).all();}finally{db.close();}};
 const lock=()=>JSON.parse(readFileSync(join(base,'runtime/cli.lock'))).pid;
 let launcher=launch(),gatewayCrashPid;
 try{
  await until(async()=>(await state())?.upgrade?.phase==='running');
  const original=await state(),oldPid=lock();
  await post({requestId:'initial-main',text:'hold-main'});await until(()=>existsSync(join(base,'runtime/main-running')));
  writeFileSync(join(base,'runtime/hold-resume'),'1');
  appendFileSync(join(base,'prompts/main.md'),'\n<!-- Synthetic handoff -->\n');await until(()=>events.some(e=>e.text?.includes('等待安全边界')));
  assert.equal(lock(),oldPid);
  writeFileSync(join(base,'runtime/release-main'),'1');await until(()=>existsSync(join(base,'runtime/resume-waiting')));
  const waiting=await state();assert.notEqual(waiting.upgrade.phase,'running');assert.equal(waiting.upgrade.accepting,true);
  const inputs=Array.from({length:8},(_,i)=>({requestId:'window-'+i,text:'Synthetic '+i}));
  const results=await Promise.all(inputs.flatMap(input=>[post(input),post(input)]));
  for(const r of results){assert.equal(r.status,202);assert.equal(r.value.transportState,'stored');assert.equal(r.value.accepted,false);}
  assert.equal((await post({...inputs[0],text:'conflict'})).status,409);
  launcher.stdin.write('Synthetic CLI in handoff\n');await until(async()=>(await state())?.upgrade?.transportPending?.length===9);
  // SSE remains live and carries a full reconnectable state while child restores.
  const response=await fetch(url+'/api/events');const reader=response.body.getReader();const event=await reader.read();assert.match(Buffer.from(event.value).toString(),/event: state/);await reader.cancel();
  gatewayCrashPid=lock();const exited=new Promise(r=>launcher.once('exit',r));launcher.kill('SIGKILL');await exited;
  // Startup stop intentionally waits for a known owner; release only this synthetic gate.
  writeFileSync(join(base,'runtime/release-resume'),'1');
  await until(()=>{try{process.kill(gatewayCrashPid,0);return false;}catch{return true;}});
  launcher=launch();await until(async()=>(await state())?.upgrade?.phase==='running');
  await until(()=>query('SELECT * FROM conversation_inputs').length===10);
  await until(async()=>(await state())?.queue.every(r=>r.state==='completed'));
  assert.equal((await state()).threadId,original.threadId);
  for(const input of inputs){const r=await post(input);assert.equal(r.status,202);assert.equal(r.value.fresh,false);}
  assert.equal((await post({...inputs[0],text:'Changed after business acceptance'})).status,409);
  assert.equal((await post(inputs[0])).value.fresh,false,'transport rejection must not override original business identity');
  assert.equal(query('SELECT count(*) n FROM requests')[0].n,10);
  assert.equal(query('SELECT count(*) n FROM conversation_inputs')[0].n,10);
  await until(async()=>(await state())?.upgrade?.transportPending?.length===0);
  assert.throws(()=>process.kill(gatewayCrashPid,0));
  // A dead business owner never restarts itself or replays unknown execution.
  // The stable endpoint stays available for durable ordinary input.
  const failedOwner=lock();process.kill(failedOwner,'SIGKILL');
  await until(async()=>(await state())?.upgrade?.phase==='recovery_required');
  const held=await post({requestId:'after-owner-crash',text:'Synthetic after owner failure'});
  assert.equal(held.status,202);assert.equal(held.value.accepted,false);
  assert.equal(query('SELECT count(*) n FROM conversation_inputs')[0].n,10);
  const end=new Promise(r=>launcher.once('exit',r));launcher.kill('SIGINT');await end;
  launcher=launch();await until(async()=>(await state())?.upgrade?.phase==='running');
  await until(()=>query('SELECT count(*) n FROM conversation_inputs')[0].n===11);
  await until(async()=>(await state())?.queue.every(row=>row.state==='completed'));
  const proof={synthetic:true,codexBin:'/usr/bin/false',threadPreserved:true,concurrentWebPosts:16,distinctWebInputs:8,cliInputs:1,transportCrashRecovery:true,requestsBeforeOwnerFailure:10,requestsAfterExplicitRecovery:11,ownerCrashRetainedGateway:true,sseDuringHandoff:true};
  writeFileSync(join(base,'verified-checks.json'),JSON.stringify(proof,null,2));
 }finally{
  for(const child of children){if(child.exitCode===null&&child.signalCode===null){let timer;const end=new Promise(r=>child.once('exit',r));child.kill('SIGINT');await Promise.race([end,new Promise(r=>{timer=setTimeout(r,10000);})]);clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}}
  if(existsSync(join(base,'runtime/hold-resume')))unlinkSync(join(base,'runtime/hold-resume'));
  writeFileSync(join(base,'launcher-events.json'),JSON.stringify(events,null,2));
 }
});
