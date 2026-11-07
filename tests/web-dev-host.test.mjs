import {syntheticUserFetch} from './web-user-connection.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, cpSync, symlinkSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {waitForDevCondition} from './fixtures/dev-condition.mjs';
import {fixtureBuildEnvironment,fixtureBuildEvidence} from './fixtures/dev-build-trace.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, timeout = 45000) {
  const end = Date.now() + timeout, caller=new Error().stack;
  while (!await check()) { if (Date.now() > end) throw Object.assign(new Error('web_dev_test_timeout'),{stack:caller}); await delay(50); }
}
// Requirement-derived, synthetic protocol peer. No model or production runtime.
test('Web stable host hands off immutable UI, retains accepted input/history/thread and never owns a second Homer', { timeout: 120000 }, async t => {
  const root = resolve('.'), parent = join(root, '.codex/scratch/assistant-ui'); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, 'web-dev-'));const fetch=syntheticUserFetch();
  for (const name of ['src', 'scripts', 'prompts', 'assets', 'ui', 'package.json', 'package-lock.json', 'tsconfig.json']) cpSync(join(root, name), join(base, name), { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path) });
  symlinkSync(join(root, 'node_modules'), join(base, 'node_modules'), 'dir');
  for (const name of ['home', 'runtime', 'workspace/materials']) mkdirSync(join(base, name), { recursive: true });
  const binary = join(base, 'synthetic-codex.mjs'); cpSync(join(root, 'tests/fixtures/web-browser-app-server.mjs'), binary);
  writeFileSync(binary, readFileSync(binary,'utf8').replace('slow ? 230 : 30','slow ? 10000 : 30'));
  const config = join(base, 'synthetic.config.json');
  writeFileSync(config, JSON.stringify({ appData:base, workspace: 'workspace', runtime: 'runtime', nativeCodexHome:join(base,'home'), codexBin: binary, model: 'synthetic-only', requiresOpenaiAuth: false, effort: 'medium', timeoutMs: 30000, mainTimeoutMs: 120000, stopGraceMs: 200 }));
  const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const url = `http://127.0.0.1:${port}`, events = [];
  const env={...fixtureBuildEnvironment(base),HOMER_DATA_HOME:base,HOMER_NATIVE_CODEX_HOME:join(base,'home'),HOMER_CODEX_HOME:join(base,'home'),HOMER_CODEX_BIN:binary};
  const child = spawn(process.execPath, [join(base, 'scripts/dev.mjs'), '--web', '--port', String(port), '--config', config, '--json'], { cwd: base, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let lines = '', exited = false, verified=false; const errors = [];
  child.stdout.on('data', data => { lines += data; const parts = lines.split('\n'); lines = parts.pop(); for (const line of parts) { try { events.push(JSON.parse(line)); } catch {} } });
  child.stderr.on('data', data => errors.push(String(data))); child.on('exit', () => { exited = true; });
  const state = async () => { try { return await (await fetch(url + '/api/state')).json(); } catch { return undefined; } };
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const lock = () => JSON.parse(readFileSync(join(base, 'runtime/cli.lock'), 'utf8')).pid;
  const persistedInput = requestId => {
    const db = new DatabaseSync(join(base, 'runtime/homer.sqlite'), {readOnly:true});
    try {
      const rows = db.prepare("SELECT m.id AS messageId,i.replyId,r.revision,m.payloadJson FROM agent_messages m JOIN agent_receipts r ON r.messageId=m.id JOIN conversation_inputs i ON i.requestId=json_extract(m.payloadJson,'$.requestId') WHERE m.kind='user_input' AND i.requestId=?").all(requestId);
      assert.equal(rows.length,1);
      return {...rows[0],payload:JSON.parse(rows[0].payloadJson)};
    } finally { db.close(); }
  };
  const buildReady=check=>waitForDevCondition(check,{signal:t.signal,events,exited:()=>exited});
  try {
    await buildReady(async () => (await state())?.upgrade?.phase === 'running'); assert.equal(exited, false);
    const first = await state(), pid = lock(), version = first.upgrade.version;
    const page = await (await fetch(url)).text(); assert.match(page, /homer-root/); assert.match(page, /assets\//);
    const oldAssetPaths=[...page.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map(match=>match[1]);
    assert.ok(oldAssetPaths.length>=2);const oldAssets=await Promise.all(oldAssetPaths.map(async path=>Buffer.from(await(await fetch(url+path)).arrayBuffer())));
    const primeResponse=await post('/api/messages',{requestId:'synthetic-prime',text:'合成首次完成'});assert.equal(primeResponse.status,202);const primeReceipt=await primeResponse.json();
    await until(async()=>(await state())?.messages.at(-1)?.status==='completed');
    appendFileSync(join(base, 'ui/homer-styles.css'), '\n/* synthetic UI immutable snapshot check */\n');
    await until(async()=>(await state())?.upgrade.reviewRequired===true);
    assert.equal((await state()).upgrade.uiVersion,first.upgrade.uiVersion);
    assert.equal((await globalThis.fetch(url+'/api/update/approve',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({hash:'f'.repeat(64)})})).status,409);
    const review=await(await fetch(url+'/api/update/review')).json();assert.ok(review.files.some(f=>f.path==='ui/homer-styles.css'));
    assert.equal((await post('/api/update/approve',{hash:'f'.repeat(64)})).status,409);
    // Changing ordinary staged output cannot change the in-use protected assets.
    const staged=join(base,'.codex/scratch/dev-upgrade/builds');for(const name of readdirSync(staged)){const assetPath=oldAssetPaths.find(path=>path.endsWith('.css'));if(assetPath){const file=join(staged,name,'dist/web',assetPath.replace(/^.*?\/assets\//,'assets/'));try{appendFileSync(file,'\n/* ordinary staged edit */');}catch{}}}
    for(let i=0;i<oldAssetPaths.length;i++)assert.deepEqual(Buffer.from(await(await fetch(url+oldAssetPaths[i])).arrayBuffer()),oldAssets[i]);
    assert.equal((await post('/api/update/approve',{hash:review.hash})).status,200);
    await buildReady(() => events.some(e => e.text?.includes('构建检查通过')));
    await until(async()=>(await state())?.upgrade.uiVersion!==first.upgrade.uiVersion);
    await delay(400);
    assert.equal(lock(), pid, 'UI-only adoption retains the executor');
    assert.equal((await state()).upgrade.version, version);
    assert.notEqual((await state()).upgrade.uiVersion, first.upgrade.uiVersion, 'compatible UI must activate while the original executor stays resident');
    const receipt = await (await post('/api/messages', { requestId: 'synthetic-stream', text: '持续慢速合成回答' })).json();
    const linkedProcesses=s=>s.processNodes.filter(node=>node.replyMessageId===receipt.replyId);
    await until(async () => {
      const s=await state(),publicProcess=s&&linkedProcesses(s)[0];
      return publicProcess?.state==='working'&&publicProcess.status==='running'&&publicProcess.items.some(item=>item.kind==='commentary'&&item.text.length>0)&&s.messages.some(m=>m.id===publicProcess.messageId&&m.role==='assistant'&&m.status==='running');
    });
    assert.equal(lock(), pid);
    const streaming=await state(),publicProcess=linkedProcesses(streaming)[0];
    assert.equal(linkedProcesses(streaming).length,1);
    const source=streaming.messages.filter(m=>m.requestId==='synthetic-stream'&&m.role==='user');assert.equal(source.length,1);
    assert.equal(publicProcess.sourceKind,'user');assert.deepEqual(publicProcess.sourceMessageIds,[receipt.queueMessageId]);
    const accepted=persistedInput('synthetic-stream');assert.equal(accepted.messageId,receipt.queueMessageId);assert.equal(accepted.replyId,receipt.replyId);assert.equal(accepted.payload.source,'local');
    assert.equal(source[0].inputState,'processing');assert.equal(streaming.queue.some(row=>row.messageId===receipt.queueMessageId),false,'an input with a public process is no longer presented in the waiting queue');
    assert.notEqual(publicProcess.messageId,receipt.replyId);assert.equal(streaming.messages.some(m=>m.id===receipt.replyId),false);
    assert.equal(streaming.activeMessageId,receipt.replyId);assert.equal(streaming.isRunning,true);
    appendFileSync(join(base,'ui/homer-styles.css'),'\n/* synthetic UI update during live main turn */\n');
    await until(async()=>(await state())?.upgrade.reviewRequired===true);
    const second=await(await fetch(url+'/api/update/review')).json();
    assert.equal((await post('/api/update/approve',{hash:review.hash})).status,409,'an earlier receipt cannot approve new code');
    assert.equal((await post('/api/update/approve',{hash:second.hash})).status,200);
    await until(()=>events.some(e=>e.text?.startsWith('界面 ')&&e.text.includes('等待安全边界')&&events.indexOf(e)>events.findIndex(e=>e.text?.includes('已审阅'))));
    assert.equal((await state()).upgrade.uiVersion,streaming.upgrade.uiVersion,'reviewed UI waits while the main turn is running');
    assert.equal(lock(),pid);assert.equal((await state()).activeMessageId,receipt.replyId);
    for(let i=0;i<oldAssetPaths.length;i++)assert.deepEqual(Buffer.from(await(await fetch(url+oldAssetPaths[i])).arrayBuffer()),oldAssets[i]);
    assert.equal((await post('/api/stop', { messageId: receipt.replyId })).status, 202);
    await until(async () => {
      const s=await state(),nodes=s&&linkedProcesses(s);
      return nodes?.length===1&&nodes[0].id===publicProcess.id&&nodes[0].state==='worked'&&nodes[0].status==='interrupted'&&s.messages.some(m=>m.id===publicProcess.messageId&&m.status==='interrupted')&&!s.isRunning&&s.activeMessageId===null;
    });
    await until(async()=>(await state())?.upgrade.uiVersion!==streaming.upgrade.uiVersion);
    const stoppedProcess=linkedProcesses(await state())[0];
    appendFileSync(join(base, 'prompts/main.md'), '\n<!-- synthetic business handoff after independent UI -->\n');
    await until(() => events.some(e => e.text?.includes('等待安全边界')));
    assert.equal(lock(), pid);
    await until(async () => { const s = await state(); return s?.upgrade?.phase === 'running' && s.upgrade.version !== version; });
    assert.notEqual(lock(), pid); assert.throws(() => process.kill(pid, 0),{code:'ESRCH'});
    const after = await state(); assert.equal(after.threadId, first.threadId);
    assert.deepEqual(after.messages.filter(m=>m.role==='user').map(m=>m.requestId),['synthetic-prime','synthetic-stream']);
    for(const requestId of ['synthetic-prime','synthetic-stream']){
      const users=after.messages.filter(m=>m.role==='user'&&m.requestId===requestId);assert.equal(users.length,1);
      const original=requestId==='synthetic-prime'?primeReceipt:receipt;
      const nodes=after.processNodes.filter(node=>node.sourceKind==='user'&&node.replyMessageId===original.replyId);assert.equal(nodes.length,1);assert.deepEqual(nodes[0].sourceMessageIds,[original.queueMessageId]);
      const replies=after.messages.filter(m=>m.id===nodes[0].messageId);assert.equal(replies.length,1);assert.equal(replies[0].role,'assistant');assert.equal(replies[0].requestId,requestId);
    }
    assert.deepEqual(linkedProcesses(after),[stoppedProcess],'executor replacement preserves the original stopped public process');
    assert.equal(linkedProcesses(after).length,1);assert.equal(linkedProcesses(after)[0].id,publicProcess.id);assert.equal(linkedProcesses(after)[0].status,'interrupted');
    assert.equal(after.messages.length,after.messages.filter(m=>m.role==='user').length+after.processNodes.length);
    const duplicate=await (await post('/api/messages', { requestId: 'synthetic-stream', text: '持续慢速合成回答' })).json();assert.equal(duplicate.fresh,false);assert.equal(duplicate.replyId,receipt.replyId);assert.equal(duplicate.queueMessageId,receipt.queueMessageId);assert.equal(duplicate.revision,persistedInput('synthetic-stream').revision);assert.equal(duplicate.queueState,'interrupted');
    assert.deepEqual((await state()).processNodes,after.processNodes);assert.deepEqual((await state()).messages,after.messages);
    assert.equal((await post('/api/messages', { requestId: 'synthetic-next', text: '合成继续' })).status, 202);
    await until(async () => (await state())?.messages.at(-1)?.status === 'completed');
    assert.equal((await state()).messages.filter(m => m.role === 'user').length, 3);
    assert.equal((await state()).threadId, first.threadId);
    child.stdin.end(); await delay(300); assert.equal(exited, false, 'Web mode survives terminal EOF/page closure');
    writeFileSync(join(base,'verified-checks.json'),JSON.stringify({synthetic:true,reviewRequired:true,unreviewedRetainsOld:true,stagedEditsDoNotChangeLive:true,localCallerProtectionDeferred:true,staleApprovalStatus:409,reviewedUiWaitsForIdle:true,reviewedUiPreservesExecutor:true,threadPreserved:true}));
    verified=true;
  } finally {
    if(!verified){const observed=await state();writeFileSync(join(base,'safe-failure-stages.json'),JSON.stringify({phase:observed?.upgrade?.phase,reviewRequired:observed?.upgrade?.reviewRequired,codes:events.flatMap(e=>e.type==='progress'?e.text?.match(/\b(?:dev|cli|gateway|main)_[a-z_]+\b/g)??[]:[])}));}
    if(!verified)t.diagnostic(JSON.stringify({fixture:'web-dev-host',buildStages:fixtureBuildEvidence(base)}));
    child.kill('SIGINT'); await until(() => exited, 10000).catch(() => child.kill('SIGTERM'));
    if (errors.length) writeFileSync(join(base, 'test-stderr.txt'), errors.join(''));
  }
});
