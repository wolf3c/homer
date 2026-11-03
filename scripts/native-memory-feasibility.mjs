// Fixed 0.163.0 memory feasibility probe. All provider traffic terminates at a
// local scripted SSE fixture. Creates only new synthetic HOME/threads under scratch.
// Does not run Homer, read real auth/sessions/memory, or enable native daily memory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const root = resolve('.codex/scratch/native-memory-feasibility');
mkdirSync(root, { recursive: true, mode: 0o700 });
const dir = mkdtempSync(join(root, 'probe-')), home = join(dir, 'application-data/codex'), oshome = join(home, 'host-home'), cwd = join(dir, 'workspace');
for (const p of [home, oshome, cwd])
    mkdirSync(p, { recursive: true, mode: 0o700 });
const bin = resolve('.codex/private/engines/codex-0.163.0/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
let requests = [], child, seq = 0, thread, notifications = [], errors = [], stderr = [], issueMcpTool = false, issuedMcpTool = false, inspectNativeTools = false, inspectedNativeTools = false, nativeScript = '', nativeScriptSent=false, nativeScriptCallId='', abortedFixtureRequests=0;
const pending = new Map();
const server = createServer(async (req, res) => {
    let body = '';
    try {for await (const c of req)body += c;}catch(error){if(req.aborted&&error.code==='ECONNRESET'){abortedFixtureRequests++;return;}throw error;}
    if (req.url !== '/v1/responses') {
        res.writeHead(404);
        return res.end();
    }
    const data = JSON.parse(body), additionalTools=(data.input??[]).filter(x=>x.type==='additional_tools').flatMap(x=>x.tools??[]), toolOutputs=(data.input??[]).filter(x=>['custom_tool_call_output','function_call_output'].includes(x.type)), lastUser = JSON.stringify(data.input?.findLast(x => x.role === 'user')?.content ?? []), phase = lastUser.includes('same-process refresh') ? 'same_process' : lastUser.includes('same-thread restart') ? 'resumed' : lastUser.includes('secondary root summary') ? 'secondary_root' : lastUser.includes('inspect advertised tools') ? 'tools' : lastUser.includes('Synthetic explicit preference') ? 'initial' : 'background';
    requests.push({ path: req.url, phase, model: data.model, tools: data.tools, additionalTools, toolOutputs, hasSummaryMarker: body.includes('SYNTHETIC_NATIVE_SUMMARY_7K4'), hasUpdatedSummaryMarker: body.includes('SYNTHETIC_NATIVE_SUMMARY_UPDATED_4T8'), hasRegistryMarker: body.includes('SYNTHETIC_NATIVE_REGISTRY_9J2'), hasUserPreference: body.includes('SYNTHETIC_PREF_TEAL_6M1'), bodyKeys: Object.keys(data), inputCount: data.input?.length ?? 0, phase1: body.includes('raw_memory') || body.includes('rollout_summary'), phase2: /Memory Phase 2|Memory Consolidation|Consolidate Codex memories/i.test(body) });
    const extracting = body.includes('raw_memory') && body.includes('rollout_summary');
    const text = extracting ? JSON.stringify({ rollout_summary: 'Synthetic pipeline summary only.', rollout_slug: 'synthetic-memory-probe', raw_memory: 'SYNTHETIC_EXTRACTED_TEAL_5C: Reports use teal.' }) : 'Synthetic memory wiring response only.';
    const id = 'synthetic-' + requests.length;
    let item = { id: 'msg-' + id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
    if(nativeScript&&!nativeScriptSent){nativeScriptSent=true;nativeScriptCallId='call-'+id;item={id:'fc-'+id,type:'custom_tool_call',namespace:'functions',name:'exec',call_id:nativeScriptCallId,input:nativeScript};
    } else if (issueMcpTool && !issuedMcpTool) {
        issuedMcpTool = true;
        item = { id: 'fc-' + id, type: 'custom_tool_call', namespace:'functions', name:'exec', call_id:'call-'+id, input: `const t=ALL_TOOLS.find(x=>x.name==='mcp__synthetic__echo');if(!t)throw Error('synthetic_mcp_binding_missing');const r=await tools[t.name]({text:'synthetic-model-external-context-marker'});text(r);` };
    } else if(inspectNativeTools&&!inspectedNativeTools){ inspectedNativeTools=true;item={id:'fc-'+id,type:'custom_tool_call',namespace:'functions',name:'exec',call_id:'call-'+id,input:`text(JSON.stringify({nativeMemoryTools:ALL_TOOLS.filter(x=>/memor|ad_hoc/i.test(x.name+' '+x.description)),nativeMcpTools:ALL_TOOLS.filter(x=>x.name.startsWith('mcp__')).map(x=>x.name)}));`};
    }
    const response = { id: 'resp-' + id, object: 'response', created_at: 1, model: data.model, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    res.setHeader('Content-Type', 'text/event-stream');
    for (const event of [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, ...(item.type === 'message' ? [{ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text }] : []), { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }])
        res.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
    res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const rpc = (method, params = {}) => new Promise((accept, reject) => { const id = ++seq, t = setTimeout(() => { pending.delete(id); reject(Error('rpc_timeout:' + method)); }, 15000); pending.set(id, { accept, reject, t }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
const settings = { model: 'gpt-6.1-sol', model_provider: 'probe', 'model_providers.probe': { name: 'Synthetic loopback only', base_url: origin + '/v1', wire_api: 'responses', requires_openai_auth: false, supports_websockets: false }, sqlite_home: home, log_dir: join(home, 'log'), cli_auth_credentials_store: 'file', mcp_oauth_credentials_store: 'file', 'features.memories': true, 'memories.generate_memories': true, 'memories.use_memories': true, 'memories.dedicated_tools': true, 'memories.extract_model': 'gpt-6.1-sol', 'memories.consolidation_model': 'gpt-6.1-sol', 'memories.min_rollout_idle_hours': 1, 'memories.min_rate_limit_remaining_percent': 0, 'features.code_mode_host': true, 'features.code_mode': false, 'features.shell_tool': false, 'features.shell_snapshot': false, 'features.apps': false, 'features.plugins': false, 'features.multi_agent': false, 'features.browser_use': false, 'features.computer_use': false, 'features.hooks': false, 'features.view_image': false, 'features.image_generation': false, web_search: 'disabled', 'analytics.enabled': false, 'feedback.enabled': false, approval_policy: 'never' };
const toml = v => Array.isArray(v) ? '[' + v.map(toml).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + '=' + toml(x)).join(',') + '}' : JSON.stringify(v);
if (process.env.HOMER_PROBE_MEMORY_VERSION) {
    if (!['v1', 'v2'].includes(process.env.HOMER_PROBE_MEMORY_VERSION))
        throw Error('probe_memory_version_invalid');
    settings['memories.version'] = process.env.HOMER_PROBE_MEMORY_VERSION;
}
async function start() { child = spawn(bin, ['app-server', '--stdio', ...Object.entries(settings).flatMap(([k, v]) => ['-c', k + '=' + toml(v)])], { cwd, env: { PATH: process.env.PATH, HOME: oshome, CODEX_HOME: home, TMPDIR: process.env.TMPDIR, OPENAI_BASE_URL: origin + '/v1', RUST_LOG: 'codex_memories_write=info' } }); child.stderr.on('data', b => { if (stderr.join('').length < 12000)
    stderr.push(String(b)); }); child.on('exit', (code, signal) => { for (const p of pending.values()) {
    clearTimeout(p.t);
    p.reject(Error('isolated_native_exit:' + code + ':' + signal));
} pending.clear(); }); createInterface({ input: child.stdout }).on('line', line => { let m; try {
    m = JSON.parse(line);
}
catch {
    return;
} if (pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p.t);
    m.error ? p.reject(Object.assign(Error(m.error.message), { code: m.error.code })) : p.accept(m.result);
}
else if (m.method)
    notifications.push(m); }); const init = await rpc('initialize', { clientInfo: { name: 'homer-memory-isolated-probe', version: '1' }, capabilities: { experimentalApi: true } }); child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); if (!init.userAgent?.includes('/0.163.0 ') || resolve(init.codexHome ?? '/') !== home)
    throw Error('probe_fixed_version_or_home_mismatch'); return init; }
async function stop() { const own = child; if (!own)
    return; if (own.exitCode !== null || own.signalCode !== null) {
    child = undefined;
    return;
} const exit = new Promise(r => own.once('exit', r)); own.kill('SIGTERM'); await exit; child = undefined; for (const p of pending.values()) {
    clearTimeout(p.t);
    p.reject(Error('probe_closed'));
} pending.clear(); }
const check = { at: new Date().toISOString(), directory: dir, isolatedHome: true, realModel: false, realAccount: false, liveHomerUnchanged: true };
const waitTerminal = async (expectedThread = thread) => { const began = Date.now(); while (Date.now() - began < 10000) {
    const done = notifications.find(n => n.method === 'turn/completed' && n.params.threadId === expectedThread);
    if (done)
        return done.params.turn.status;
    await new Promise(r => setTimeout(r, 20));
} throw Error('synthetic_turn_terminal_missing'); };
try {
    const init = await start();
    check.nativeVersion = init.userAgent;
    const config = await rpc('config/read', { includeLayers: true, cwd });
    check.effectiveMemories = config.config.memories;
    check.nativeFeature = config.config.features.memories;
    check.paths = { codexHome: init.codexHome, sqlite: config.config.sqlite_home, log: config.config.log_dir };
    check.initialStatus = await rpc('memory/status', { minConsolidatedThreads: 1 });
    check.memoryFeatures = (await rpc('experimentalFeature/list', { limit: 200 })).data.filter(f => /memor/.test(f.name));
    for (const method of ['memory/list', 'memory/correct', 'memory/forget']) {
        try {
            await rpc(method, {});
            errors.push({ method, unexpectedlySupported: true });
        }
        catch (e) {
            errors.push({ method, code: e.code, unknownVariant: e.message.startsWith('Invalid request: unknown variant') });
        }
    }
    check.unsupportedItemMethods = errors;
    for (const folder of ['memories', 'memories_v2']) {
        mkdirSync(join(home, folder), { recursive: true });
        writeFileSync(join(home, folder, 'memory_summary.md'), '# Synthetic native summary\nSYNTHETIC_NATIVE_SUMMARY_7K4: Reports use teal.\n');
        writeFileSync(join(home, folder, 'MEMORY.md'), '# Synthetic registry\nSYNTHETIC_NATIVE_REGISTRY_9J2: Reports use teal.\n');
    }
    const t = await rpc('thread/start', { model: 'gpt-6.1-sol', cwd, approvalPolicy: 'never', sandbox: 'read-only', experimentalRawEvents: false, persistExtendedHistory: true, baseInstructions: 'Synthetic isolation probe. No external tools or real account.' });
    thread = t.thread.id;
    check.thread = thread;
    notifications = [];
    await rpc('turn/start', { threadId: thread, input: [{ type: 'text', text: 'Synthetic explicit preference: SYNTHETIC_PREF_TEAL_6M1. This is synthetic wiring only.' }] });
    check.firstTurn = await waitTerminal();
    check.firstRequests = requests.slice();
    check.firstThreadRead = (await rpc('thread/read', { threadId: thread, includeTurns: true })).thread.path;
    check.toolsSeen = requests.map(x => x.tools ?? []);
    for (const folder of ['memories', 'memories_v2'])
        writeFileSync(join(home, folder, 'memory_summary.md'), '# Synthetic updated summary\nSYNTHETIC_NATIVE_SUMMARY_UPDATED_4T8: Reports use amber.\n');
    notifications = [];
    await rpc('turn/start', { threadId: thread, input: [{ type: 'text', text: 'Synthetic same-process refresh check.' }] });
    check.sameProcessTurn = await waitTerminal();
    check.sameProcessUpdatedSummarySeen = requests.findLast(x => x.phase === 'same_process')?.hasUpdatedSummaryMarker;
    check.enabledResult = await rpc('thread/memoryMode/set', { threadId: thread, mode: 'enabled' });
    await stop();
    await start();
    await rpc('thread/resume', { threadId: thread, cwd, approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: 'Synthetic isolation probe. No external tools or real account.' });
    notifications = [];
    await rpc('turn/start', { threadId: thread, input: [{ type: 'text', text: 'Synthetic same-thread restart wiring check.' }] });
    check.resumedTurn = await waitTerminal();
    check.sameThreadResumed = true;
    check.updatedSummaryAfterResume = requests.findLast(x => x.phase === 'resumed')?.hasUpdatedSummaryMarker;
    check.requestsAfterResume = requests.slice();
    check.beforeResetStatus = await rpc('memory/status', { minConsolidatedThreads: 1 });
    await stop();
    // Only the new synthetic DB is backdated; this is scheduler eligibility wiring,
    // not evidence that a real preference has been extracted.
    const seeded = new DatabaseSync(join(home, 'state_5.sqlite'));
    const old = Math.floor(Date.now() / 1000) - 8 * 3600;
    seeded.prepare('UPDATE threads SET updated_at=?,updated_at_ms=?,recency_at=?,recency_at_ms=?,created_at=?,created_at_ms=?,has_user_event=1,tokens_used=4096 WHERE id=?').run(old, old * 1000, old, old * 1000, old - 120, old * 1000 - 120000, thread);
    seeded.close();
    check.syntheticEligibilityBackdated = true;
    check.requestsBeforeIdleRoot = requests.length;
    await start();
    await rpc('thread/resume', { threadId: thread, cwd, approvalPolicy: 'never', sandbox: 'read-only' });
    await new Promise(r => setTimeout(r, 800));
    check.sameRootIdleRequests = requests.length - check.requestsBeforeIdleRoot;
    await stop();
    const ageAgain = new DatabaseSync(join(home, 'state_5.sqlite'));
    ageAgain.prepare('UPDATE threads SET updated_at=?,updated_at_ms=? WHERE id=?').run(old, old * 1000, thread);
    ageAgain.close();
    await start();
    const rootB = await rpc('thread/start', { model: 'gpt-6.1-sol', cwd, approvalPolicy: 'never', sandbox: 'read-only', sessionStartSource: 'startup' });
    check.secondarySyntheticRoot = rootB.thread.id;
    notifications = [];
    await rpc('turn/start', { threadId: rootB.thread.id, input: [{ type: 'text', text: 'Synthetic secondary root summary refresh check.' }] });
    await waitTerminal(rootB.thread.id);
    check.newRootUpdatedSummarySeen = requests.findLast(x => x.phase === 'secondary_root')?.hasUpdatedSummaryMarker;
    await new Promise(r => setTimeout(r, 3000));
    check.newRootRequests = requests.length - check.requestsBeforeIdleRoot;
    await stop();
    check.schedulerDatabase = settings['memories.version'] === 'v2' ? 'memories_v2_1.sqlite' : 'memories_1.sqlite';
    const jobs = new DatabaseSync(join(home, check.schedulerDatabase), { readOnly: true });
    check.schedulerJobs = jobs.prepare('SELECT kind,status,last_error,retry_remaining FROM jobs').all();
    check.extractedRows = jobs.prepare('SELECT count(*) n FROM stage1_outputs').get().n;
    jobs.close();
    settings['mcp_servers.synthetic'] = { command: process.execPath, args: [resolve('tests/fixtures/native-capability-mcp.mjs')], enabled: true, enabled_tools: ['echo'], default_tools_approval_mode: 'approve', tools: { echo: { enabled: true, approval_mode: 'approve' } } };
    settings['memories.disable_on_external_context'] = true;
    await start();
    await rpc('thread/resume', { threadId: thread, cwd, approvalPolicy: 'never', sandbox: 'read-only' });
    check.directMcp = await rpc('mcpServer/tool/call', { threadId: thread, server: 'synthetic', tool: 'echo', arguments: { text: 'synthetic-external-context-marker' } });
    await new Promise(r => setTimeout(r, 200));
    await stop();
    const filtered = new DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true });
    check.directMcpIsNotModelContextEvidence = true;
    check.memoryModeAfterDirectMcp = filtered.prepare('SELECT memory_mode FROM threads WHERE id=?').get(thread).memory_mode;
    filtered.close();
    await start();
    await rpc('thread/resume', { threadId: thread, cwd, approvalPolicy: 'never', sandbox: 'read-only' });
    notifications = [];
    inspectNativeTools=true;
    await rpc('turn/start', { threadId: thread, input: [{ type: 'text', text: 'Synthetic inspect advertised tools only.' }] });
    check.toolCatalogTurn = await waitTerminal();
    inspectNativeTools=false;
    check.toolsWithMcp = requests.at(-1)?.additionalTools;
    check.nativeToolInspectionOutputs=requests.at(-1)?.toolOutputs;
    // Only this newly created synthetic HOME receives these explicit test notes.
    // Tool reads prove storage, not autonomous model recall or consolidation.
    const nativeMemoryTurn=async(label,script)=>{notifications=[];nativeScript=script;nativeScriptSent=false;await rpc('turn/start',{threadId:thread,input:[{type:'text',text:'Synthetic explicit memory test: '+label}]});await waitTerminal();const output=requests.at(-1)?.toolOutputs?.filter(x=>x.call_id===nativeScriptCallId)??[];nativeScript='';return output;};
    const noteName='2026-10-18T00-30-00-synthetic-save.md', correctionName='2026-10-18T00-30-01-synthetic-correct.md', forgetName='2026-10-18T00-30-02-synthetic-forget.md';
    check.adHocSaveOutput=await nativeMemoryTurn('remember reports use synthetic teal',`text(await tools.memories__add_ad_hoc_note({filename:${JSON.stringify(noteName)},note:'Synthetic explicit user request: remember reports use SYNTHETIC_NOTE_TEAL_8M.'}));text(await tools.memories__list({}));`);
    check.adHocSearchBeforeRestart=await nativeMemoryTurn('read saved synthetic preference',`text(await tools.memories__search({queries:['SYNTHETIC_NOTE_TEAL_8M']}));`);
    await stop();await start();await rpc('thread/resume',{threadId:thread,cwd,approvalPolicy:'never',sandbox:'read-only'});
    check.adHocSearchAfterRestart=await nativeMemoryTurn('recall saved synthetic preference',`text(await tools.memories__read({path:'extensions/ad_hoc/notes/'+${JSON.stringify(noteName)}}));text(await tools.memories__search({queries:['SYNTHETIC_NOTE_TEAL_8M']}));`);
    check.adHocCorrectionOutput=await nativeMemoryTurn('update report preference to synthetic amber',`text(await tools.memories__add_ad_hoc_note({filename:${JSON.stringify(correctionName)},note:'Synthetic explicit user correction: replace SYNTHETIC_NOTE_TEAL_8M with SYNTHETIC_NOTE_AMBER_9N.'}));text(await tools.memories__search({queries:['SYNTHETIC_NOTE_AMBER_9N']}));`);
    check.adHocForgetOutput=await nativeMemoryTurn('forget synthetic report color preference',`text(await tools.memories__add_ad_hoc_note({filename:${JSON.stringify(forgetName)},note:'Synthetic explicit user request: forget the report color preference, including SYNTHETIC_NOTE_TEAL_8M and SYNTHETIC_NOTE_AMBER_9N. Do not use it.'}));text(await tools.memories__search({queries:['SYNTHETIC_NOTE_TEAL_8M','SYNTHETIC_NOTE_AMBER_9N']}));`);
    const outputObjects=items=>items.flatMap(i=>i.output??[]).filter(x=>x.type==='input_text').flatMap(x=>{try{return[JSON.parse(x.text)];}catch{return[];}});
    const matches=items=>outputObjects(items).flatMap(x=>x.matches??[]);
    assert.ok(matches(check.adHocSearchBeforeRestart).some(x=>x.path.endsWith(noteName)&&x.content.includes('SYNTHETIC_NOTE_TEAL_8M')));
    assert.ok(matches(check.adHocSearchAfterRestart).some(x=>x.path.endsWith(noteName)));
    assert.ok(outputObjects(check.adHocSearchAfterRestart).some(x=>x.content?.includes('SYNTHETIC_NOTE_TEAL_8M')&&x.path?.endsWith(noteName)));
    assert.ok(matches(check.adHocCorrectionOutput).some(x=>x.path.endsWith(correctionName)&&x.content.includes('SYNTHETIC_NOTE_AMBER_9N')));
    for(const name of[noteName,correctionName,forgetName])assert.ok(matches(check.adHocForgetOutput).some(x=>x.path.endsWith(name)));
    check.adHocMemoryToolsInvoked=true;
    check.adHocToolStorageAssertionsPassed=true;
    check.forgetIsAppendOnlyNotPhysicalDeletion=true;
    notifications = [];
    issueMcpTool = true;
    await rpc('turn/start', { threadId: thread, input: [{ type: 'text', text: 'Synthetic model MCP routing test only.' }] });
    check.modelMcpTurn = await waitTerminal();
    issueMcpTool = false;
    check.modelMcpItems = notifications.filter(n => n.method === 'item/completed').map(n => n.params.item).filter(i => i.type === 'mcpToolCall').map(i => ({ type: i.type, status: i.status, server: i.server, tool: i.tool }));
    await new Promise(r => setTimeout(r, 500));
    await stop();
    const state = new DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true });
    check.memoryModeAfterModelMcp = state.prepare('SELECT memory_mode FROM threads WHERE id=?').get(thread).memory_mode;
    assert.equal(check.memoryModeAfterModelMcp,'polluted');
    assert.ok(check.modelMcpItems.some(x=>x.status==='completed'&&x.server==='synthetic'));
    check.modelMcpExternalContextFilterPassed=true;
    check.stateSchema = state.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('threads','stage1_outputs','jobs')").all();
    state.close();
    const memPath = join(home, check.schedulerDatabase);
    if (existsSync(memPath)) {
        const db = new DatabaseSync(memPath, { readOnly: true });
        check.memorySchema = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        db.close();
    }
    await start();
    check.resetResult = await rpc('memory/reset');
    check.afterResetStatus = await rpc('memory/status', { minConsolidatedThreads: 1 });
    check.updatedSummaryAfterReset = existsSync(join(home, 'memories_v2/memory_summary.md'));
    check.summaryExistsAfterReset = existsSync(join(home, 'memories/memory_summary.md'));
    check.registryExistsAfterReset = existsSync(join(home, 'memories/MEMORY.md'));
    check.rolloutExistsAfterReset = existsSync(check.firstThreadRead);
    await stop();
    check.abortedFixtureRequests=abortedFixtureRequests;
    check.requests = requests;
    check.memoryLifecycleDiagnosticsCount = stderr.join('').split('\n').filter(l => /memory (startup|stage-1)|memories startup|memory consolidation|memory.*skipping/i.test(l)).length;
    assert.equal(check.firstTurn, 'completed');
    assert.equal(check.resumedTurn, 'completed');
    assert.equal(check.sameThreadResumed, true);
    assert.ok(check.unsupportedItemMethods.every(x => x.code === -32600 && x.unknownVariant));
    assert.equal(check.sameProcessUpdatedSummarySeen, false);
    assert.equal(check.updatedSummaryAfterResume, false);
    assert.equal(check.newRootUpdatedSummarySeen, true);
    assert.equal(check.summaryExistsAfterReset, false);
    assert.equal(check.rolloutExistsAfterReset, true);
    check.protocolAndIsolationAssertionsPassed = true;
    check.realMemoryLifecycleAcceptancePassed = false;
}
catch (e) {
    check.error = { code: e.code, message: e.message };
    process.exitCode = 1;
}
finally {
    await stop();
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    writeFileSync(join(dir, 'fixed-memory-probe-receipt.json'), JSON.stringify(check, null, 2) + '\n');
    writeFileSync(join(root, 'latest-probe-location.json'), JSON.stringify({ directory: dir, receipt: join(dir, 'fixed-memory-probe-receipt.json') }, null, 2) + '\n');
    console.log(JSON.stringify({ directory: dir, nativeVersion: check.nativeVersion, firstTurn: check.firstTurn, sameThreadResumed: check.sameThreadResumed, error: check.error, requests: requests.length, effectiveMemories: check.effectiveMemories, memoryFeatures: check.memoryFeatures, toolCatalogNamespaces:check.toolsWithMcp?.map(t=>t.name??t.type),firstToolNames:requests[0]?.additionalTools?.map(t=>t.name??t.type), summaryInjected: requests.map(r => r.hasSummaryMarker), registryInjected: requests.map(r => r.hasRegistryMarker), scheduler: { database: check.schedulerDatabase, sameRootIdleRequests: check.sameRootIdleRequests, newRootRequests: check.newRootRequests, jobs: check.schedulerJobs, extractedRows: check.extractedRows }, memoryModeAfterDirectMcp: check.memoryModeAfterDirectMcp, summaryRefresh: { sameProcess: check.sameProcessUpdatedSummarySeen, resumedSameThread: check.updatedSummaryAfterResume, newSyntheticRoot: check.newRootUpdatedSummarySeen }, memoryModeAfterModelMcp:check.memoryModeAfterModelMcp,adHocToolStorageAssertionsPassed:check.adHocToolStorageAssertionsPassed,forgetIsAppendOnlyNotPhysicalDeletion:check.forgetIsAppendOnlyNotPhysicalDeletion,modelMcpExternalContextFilterPassed:check.modelMcpExternalContextFilterPassed,modelMcpExecuted: check.modelMcpItems?.length > 0, assertionsPassed: check.protocolAndIsolationAssertionsPassed, realLifecyclePassed: false, reset: { summaryExists: check.summaryExistsAfterReset, registryExists: check.registryExistsAfterReset, rolloutExists: check.rolloutExistsAfterReset } }));
}
