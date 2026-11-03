// All sessions, indexes and fake model requests are newly synthetic. No real HOME.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { importSelectedRollout } from './native-thread-import.mjs';
const { MAIN_TOOLS } = await import('../dist/tools.js');
const root = resolve('.codex/scratch/native-thread-home-preview');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'synthetic-')), a = join(dir, 'home-a'), b = join(dir, 'home-b'), cwd = join(dir, 'workspace');
for (const p of [a, b, cwd])
    mkdirSync(p, { recursive: true });
const bin = resolve(process.argv[2] ?? '.codex/private/engines/codex-0.163.0/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'), sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
let seq = 0, modelRequests = 0;
const server = createServer(async (req, res) => { let raw = ''; for await (const c of req)
    raw += c; if (req.url !== '/v1/responses') {
    res.writeHead(404);
    res.end();
    return;
} const data = JSON.parse(raw), id = 'synthetic-' + ++modelRequests, item = { id: 'message-' + id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic boundary response only.', annotations: [] }] }, response = { id, object: 'response', model: data.model, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; res.setHeader('Content-Type', 'text/event-stream'); for (const e of [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Synthetic boundary response only.' }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }])
    res.write('event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n'); res.end(); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const toml = v => Array.isArray(v) ? '[' + v.map(toml).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.entries(v).map(([k, v]) => JSON.stringify(k) + '=' + toml(v)).join(',') + '}' : JSON.stringify(v);
async function start(home) { mkdirSync(join(home, 'host-home'), { recursive: true, mode: 0o700 }); const settings = { model: 'gpt-6.1-sol', model_provider: 'synthetic_boundary', 'model_providers.synthetic_boundary': { name: 'Synthetic loopback only', base_url: origin + '/v1', wire_api: 'responses', requires_openai_auth: false, supports_websockets: false }, sqlite_home: home, log_dir: join(home, 'log'), cli_auth_credentials_store: 'file', 'features.memories': false, 'memories.generate_memories': false, 'memories.use_memories': false, 'features.shell_tool': false, 'features.shell_snapshot': false, 'features.apps': false, 'features.plugins': false, 'features.hooks': false, 'features.multi_agent': false, 'features.multi_agent_v2': false, 'features.browser_use': false, 'features.computer_use': false, 'features.image_generation': false, 'analytics.enabled': false, 'feedback.enabled': false, web_search: 'disabled' }; const child = spawn(bin, ['app-server', '--stdio', ...Object.entries(settings).flatMap(([k, v]) => ['-c', k + '=' + toml(v)])], { cwd, env: { HOME: join(home, 'host-home'), CODEX_HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } }); child.stderr.resume(); const pending = new Map(), events = []; let exited = false; child.on('exit', () => { exited = true; for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error('synthetic_native_exit'));
} pending.clear(); }); createInterface({ input: child.stdout }).on('line', line => { const m = JSON.parse(line); const p = pending.get(m.id); if (p) {
    clearTimeout(p.timer);
    pending.delete(m.id);
    m.error ? p.reject(Object.assign(Error('native_rpc_rejected'), { code: m.error.code, detail: m.error.message })) : p.resolve(m.result);
}
else
    events.push(m); }); const rpc = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('synthetic_rpc_timeout')); }, 10000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }); const init = await rpc('initialize', { clientInfo: { name: 'homer-synthetic-home-boundary', version: '1' }, capabilities: { experimentalApi: true } }); if (!init.userAgent.includes('/0.163.0 ') || resolve(init.codexHome) !== home)
    throw Error('fixed_version_or_home_mismatch'); child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); return { rpc, events, async close() { child.kill('SIGTERM'); for (let i = 0; i < 50 && !exited; i++)
        await new Promise(r => setTimeout(r, 20)); if (!exited)
        throw Error('synthetic_shutdown_unconfirmed'); } }; }
async function turn(peer, id, label) { const before = peer.events.length; const result = await peer.rpc('turn/start', { threadId: id, input: [{ type: 'text', text: label, text_elements: [] }] }); for (let i = 0; i < 200; i++) {
    if (peer.events.slice(before).some(e => e.method === 'turn/completed' && e.params.turn.id === result.turn.id))
        return;
    await new Promise(r => setTimeout(r, 20));
} throw Error('synthetic_turn_timeout'); }
const receipt = { syntheticOnly: true, realAccount: false, realModel: false, realSessionsOpened: false };
let peer;
try {
    peer = await start(a);
    const created = await peer.rpc('thread/start', { model: 'gpt-6.1-sol', modelProvider: 'synthetic_boundary', cwd, approvalPolicy: 'never', sandbox: 'read-only', environments: [], config: { mcp_servers: {} }, dynamicTools: MAIN_TOOLS }), id = created.thread.id;
    await turn(peer, id, 'Synthetic HOME boundary marker A only.');
    const read = await peer.rpc('thread/read', { threadId: id, includeTurns: false }), path = read.thread.path;
    receipt.sourceRolloutInHomeA = path.startsWith(a + '/');
    const originalHash = sha(path);
    await peer.close();
    peer = await start(b);
    try {
        await peer.rpc('thread/resume', { threadId: id, cwd, approvalPolicy: 'never', sandbox: 'read-only', environments: [] });
        receipt.threadIdOnlyUnexpectedlyResumed = true;
    }
    catch (e) {
        receipt.threadIdOnlyRejected = true;
        receipt.threadIdOnlyErrorCode = e.code;
    }
    await peer.close();
    peer = await start(b);
    try {
        const resumed = await peer.rpc('thread/resume', { threadId: id, path, cwd, approvalPolicy: 'never', sandbox: 'read-only', environments: [] });
        receipt.crossHomePathResumeAccepted = true;
        receipt.crossHomePathUsesHomeA = resumed.thread.path?.startsWith(a + '/');
    }
    catch (e) {
        receipt.crossHomePathResumeRejected = true;
        receipt.crossHomePathErrorCode = e.code;
    }
    await peer.close();
    peer = undefined;
    const sourceHash = sha(path), destination = join(b, relative(a, path));
    const backupDirectory=join(dir,'selected-rollout-backup');mkdirSync(backupDirectory,{mode:0o700});
    const importedFile=importSelectedRollout({sourceHome:a,destinationHome:b,threadId:id,backupDirectory,expectedToolsHash:createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex')});
    receipt.onlySyntheticSelectedRolloutCopied=importedFile.selectedFilesCopied===1&&!importedFile.authOrOtherSessionsCopied;
    receipt.maintainedImportHelperValidated=true;
    peer = await start(b);
    const imported = await peer.rpc('thread/resume', { threadId: id, cwd, approvalPolicy: 'never', sandbox: 'read-only' });
    receipt.selectedRolloutImportKeepsId = imported.thread.id === id;
    receipt.importRolloutInsideHomeB = imported.thread.path?.startsWith(b + '/');
    await turn(peer, id, 'Synthetic isolated selected-rollout continuation only.');
    await peer.close();
    peer = undefined;
    receipt.originalSyntheticSourceUnchanged = sha(path) === sourceHash;
    const meta = readFileSync(destination, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)).find(x => x.type === 'session_meta');
    receipt.originalFiveToolsHashPreserved = createHash('sha256').update(JSON.stringify(meta.payload.dynamic_tools)).digest('hex') === createHash('sha256').update(JSON.stringify(MAIN_TOOLS)).digest('hex');
    peer = await start(b);
    const restart = await peer.rpc('thread/resume', { threadId: id, cwd, approvalPolicy: 'never', sandbox: 'read-only' });
    receipt.restartByIdSucceeded = restart.thread.id === id;
    receipt.restartRolloutInsideHomeB = restart.thread.path?.startsWith(b + '/');
    for (const key of ['sourceRolloutInHomeA', 'threadIdOnlyRejected', 'crossHomePathResumeRejected', 'onlySyntheticSelectedRolloutCopied', 'selectedRolloutImportKeepsId', 'importRolloutInsideHomeB', 'originalSyntheticSourceUnchanged', 'originalFiveToolsHashPreserved', 'restartByIdSucceeded', 'restartRolloutInsideHomeB'])
        assert.equal(receipt[key], true, key);
    receipt.success = true;
    receipt.modelRequests = modelRequests;
    receipt.authCopyPerformed = false;
    receipt.realMigrationPerformed = false;
}
catch (e) {
    receipt.error = e.message;
    receipt.nativeErrorCode = e.code;
    receipt.syntheticNativeErrorDetail = e.detail;
    process.exitCode = 1;
}
finally {
    await peer?.close();
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    writeFileSync(join(root, 'synthetic-home-boundary-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
}
