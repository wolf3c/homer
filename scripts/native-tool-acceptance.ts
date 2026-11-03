// Fixed native tools + new HOME + scripted loopback Responses only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleMcp } from '../tests/fixtures/native-capability-mcp.mjs';
import { CodexEngine } from '../src/engine.js';
import { NativeCapabilities } from '../src/native-capabilities.js';
import { MainNativeApprovals } from '../src/main-native-approvals.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { ConversationHistory } from '../src/web-history.js';
const root = resolve('.codex/scratch/native-tools-acceptance');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(join(root, 'trial-'));
const home = join(dir, 'codex'), workspace = join(dir, 'workspace'), outside = join(dir, 'outside'), runtime = join(dir, 'runtime');
for (const p of [home, workspace, outside, runtime])
    mkdirSync(p, { recursive: true, mode: 0o700 });
const bin = process.argv[2];
if (!bin || !bin.endsWith('/codex'))
    throw Error('fixed_native_binary_required');
const config = { appData: dir, nativeCodexHome: home, codexHome: home, codexBin: resolve(bin), workspace, runtime, baseUrl: '', model: 'gpt-6.1-sol', effort: 'medium' as const, requiresOpenaiAuth: false, timeoutMs: 1000, mainTimeoutMs: 1000, stopGraceMs: 1000 };
let activeCallId: string | undefined;
let script = '', sent = false, turn = 0, approval: 'approve' | 'deny' | 'hold' = 'deny', networkCalls = 0;
const requests: {
    toolNames: string[];
    nestedToolNames: string[];
    outputSeen: boolean;
    privateSentinelSeen: boolean;
    imageOutputSeen: boolean;
    viewUrlPresent: boolean;
    viewUrlUndefined: boolean;
    errors: string[];
    exitCodes: number[];
    inputKinds: string[];
    outputShapes: unknown[];
    viewMetadata: unknown[];
    toolMetadata: unknown[];
    ownSkillBodySeen: boolean;
    mcpEchoSeen: boolean;
}[] = [];
const server = createServer(async (req, res) => {
    if (req.url === '/network-probe') {
        networkCalls++;
        res.end('SYNTHETIC_LOOPBACK_NETWORK_OK');
        return;
    }
    if (req.url === '/mcp') {
        if (req.method === 'GET') {
            res.writeHead(405);
            res.end();
            return;
        }
        let body = '';
        for await (const c of req)
            body += c;
        const m = JSON.parse(body);
        if (m.id === undefined) {
            res.writeHead(202);
            res.end();
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: handleMcp(m) }));
        return;
    }
    if (req.url !== '/v1/responses') {
        res.writeHead(404);
        res.end();
        return;
    }
    let raw = '';
    for await (const c of req)
        raw += c;
    const data = JSON.parse(raw);
    const catalog = (data.input ?? []).filter((i: any) => i.type === 'additional_tools').flatMap((i: any) => i.tools ?? []);
    const outputs = (data.input ?? []).filter((i: any) => ['custom_tool_call_output', 'function_call_output'].includes(i.type) && i.call_id === activeCallId);
    const out = JSON.stringify(outputs);
    let imageParts = 0;
    function countImages(v: any) { if (!v || typeof v !== 'object')
        return; if (['input_image', 'image'].includes(v.type))
        imageParts++; for (const x of Object.values(v))
        if (x && typeof x === 'object')
            Array.isArray(x) ? x.forEach(countImages) : countImages(x); }
    countImages(outputs);
    requests.push({ ownSkillBodySeen: raw.includes('SYNTHETIC_NATIVE_SKILL_BODY_8K4'), mcpEchoSeen: out.includes('synthetic:SYNTHETIC_APPROVED_MCP_ECHO'), toolNames: catalog.flatMap((i: any) => i.type === 'namespace' ? (i.tools ?? []).map((t: any) => i.name + '.' + t.name) : [i.name ?? i.type]), nestedToolNames: catalog.flatMap((i: any) => i.tools ?? []).flatMap((i: any) => [...(i.description ?? '').matchAll(/### `([^`]+)`/g)].map((m: any) => m[1])), outputSeen: out.includes('exit_code'), exitCodes: [...out.matchAll(/exit_code[^0-9]*([0-9]+)/g)].map(m => Number(m[1])), privateSentinelSeen: out.includes('SYNTHETIC_PRIVATE_SENTINEL_3R7'), imageOutputSeen: imageParts > 0, viewUrlPresent: /probeViewUrlPresent.{0,10}true/.test(out), viewUrlUndefined: /probeViewUrlType.{0,10}undefined/.test(out), inputKinds: (data.input ?? []).map((x: any) => String(x.type ?? x.role)), toolMetadata: outputs.flatMap((x: any) => Array.isArray(x.output) ? x.output.filter((y: any) => y.type === 'input_text').flatMap((y: any) => { const match = y.text?.match(/\{\s*"probeNativeToolNames"[\s\S]*?\}/); if (!match)
            return []; try {
            return [JSON.parse(match[0])];
        }
        catch {
            return [];
        } }) : []), viewMetadata: outputs.flatMap((x: any) => Array.isArray(x.output) ? x.output.filter((y: any) => y.type === 'input_text').flatMap((y: any) => { const match = y.text?.match(/\{\s*"probeViewResultKeys"[\s\S]*?\}/); if (!match)
            return []; try {
            return [JSON.parse(match[0])];
        }
        catch {
            return [];
        } }) : []), outputShapes: outputs.map((x: any) => ({ type: x.type, keys: Object.keys(x), outputType: typeof x.output, outputItems: Array.isArray(x.output) ? x.output.map((y: any) => ({ type: y.type, keys: Object.keys(y) })) : null })), errors: ['image', 'Image', 'expected', 'expects', 'image_url', 'Invalid image', 'decode', 'image type', 'image format', 'data URL', 'image not', 'interaction_capability_denied', 'interaction_not_live', 'interaction_approval_unavailable', 'interaction_scope_denied', 'engine_invalid_message', 'rpc failed', 'rejected by user', 'declined', 'TypeError', 'is not a function', 'command not found', 'Failed to write', 'Sandbox', 'sandbox', 'Permission denied', 'Operation not permitted', 'code-mode host', 'Failed to', 'failed to', 'denied', 'permission', 'Permission', 'not available', 'unknown tool', 'Unknown tool', 'unavailable', 'disabled', 'exec_command', 'Operation not permitted', 'Permission denied', 'Unknown tool', 'not found', 'disabled', 'not enabled', 'code-mode host'].filter(x => out.includes(x)) });
    const call = !!script && !sent;
    sent = true;
    const seq = requests.length;
    if (call)
        activeCallId = 'synthetic-' + seq;
    const item: any = call ? { id: 'call-' + seq, type: 'custom_tool_call', namespace: 'functions', name: 'exec', call_id: 'synthetic-' + seq, input: script } : { id: 'message-' + seq, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic native tool completion.', annotations: [] }] };
    const response = { id: 'response-' + seq, object: 'response', model: config.model, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    res.setHeader('Content-Type', 'text/event-stream');
    const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, ...(call ? [] : [{ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Synthetic native tool completion.' }]), { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
    for (const e of events)
        res.write('event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n');
    res.end();
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + (server.address() as any).port;
config.baseUrl = origin + '/v1';
// Explicitly keep this synthetic provider's HTTP traffic on loopback.
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.HTTPS_PROXY = 'http://synthetic-user:synthetic-transport-secret@127.0.0.1:1';
process.env.SYNTHETIC_PARENT_PRIVATE = 'synthetic-parent-environment-secret';
const db = new DatabaseSync(':memory:'), interactions = new WorkerInteractions(db), history = new ConversationHistory(db), approvals = new MainNativeApprovals(interactions, history);
const checks: Record<string, any> = { isolatedHome: true, realModel: false, realAccount: false, realOutbound: false, directory: dir, commands: [], approvals: [] };
let engine: CodexEngine | undefined;
let heldApproval: string | undefined;
const make = (nativeTools?: 'main' | 'worker', threadId?: string, workdir = workspace) => {
    const peer = new CodexEngine(config, { cwd: workdir, readRoots: [workdir], instructions: 'Synthetic bounded native tool verification. No real account or external service.', tools: [], nativeCapabilities: true, ...(nativeTools ? { nativeTools, permissionRequests: true } : {}), threadId, onInteraction: async (request) => {
            assert.equal(request.threadId, engine!.threadId);
            assert.equal(request.turnId, engine!.turnId);
            const opened = approvals.open(request, { threadId: request.threadId, turnId: request.turnId, generationId: 'synthetic-generation-' + turn, sourceRequestId: 'synthetic-request-' + turn, userText: 'Synthetic explicit one-operation authorization fixture.', isCurrent: () => engine?.turnId === request.turnId, protectedRoots: [home, runtime] });
            checks.approvals.push({ method: request.method, decision: approval });
            if (approval === 'hold') {
                heldApproval = opened.id;
                return opened.response;
            }
            approvals.respond(opened.id, { requestId: 'synthetic-decision-' + turn, text: approval === 'approve' ? '允许本次操作' : '拒绝本次操作' });
            return opened.response;
        } }, async () => { throw Error('dynamic_tools_not_used'); });
    const nativeRequest = peer.request.bind(peer);
    peer.request = (method, params) => { if (['thread/start', 'thread/resume'].includes(method))
        checks.threadMcpNames = Object.keys((params as any).config?.mcp_servers ?? {}); return nativeRequest(method, params); };
    peer.on('interactionInvalidated', (id, code) => approvals.invalidated(id, code));
    peer.on('interactionDelivered', id => approvals.delivered(id));
    return peer;
};
async function run(name: string, code: string, options?: {
    skills: {
        name: string;
        path: string;
    }[];
}) { turn++; script = code; sent = false; activeCallId = undefined; const before = requests.length; const result = await engine!.turn('Synthetic native action ' + name, options); assert.equal(result.status, 'completed'); approvals.end('synthetic-generation-' + turn); checks.commands.push({ name, requests: requests.length - before, outputSeen: requests.slice(before).some(x => x.outputSeen), imageOutputSeen: requests.slice(before).some(x => x.imageOutputSeen), viewUrlPresent: requests.slice(before).some(x => x.viewUrlPresent), viewUrlUndefined: requests.slice(before).some(x => x.viewUrlUndefined), privateSentinelSeen: requests.slice(before).some(x => x.privateSentinelSeen), exitCodes: requests.slice(before).flatMap(x => x.exitCodes), errors: [...new Set(requests.slice(before).flatMap(x => x.errors))], viewMetadata: requests.slice(before).flatMap(x => x.viewMetadata), toolMetadata: requests.slice(before).flatMap(x => x.toolMetadata), ownSkillBodySeen: requests.slice(before).some(x => x.ownSkillBodySeen), mcpEchoSeen: requests.slice(before).some(x => x.mcpEchoSeen) }); return checks.commands.at(-1); }
const sh = (cmd: string, escalated = false) => 'text(await tools.exec_command(' + JSON.stringify({ cmd, login: false, workdir: workspace, yield_time_ms: 1000, ...(escalated ? { sandbox_permissions: 'require_escalated', justification: 'Synthetic explicit one-command approval fixture.' } : {}) }) + '));';
try {
    engine = make();
    await engine.start();
    assert.equal(engine.version, '0.163.0');
    const manager = new NativeCapabilities(home, (m, p) => engine!.request(m, p), () => true);
    let state = await manager.state();
    await assert.rejects(() => manager.manage({ action: 'tools_configure', approve: true, settings: { shell: true, viewImage: true, shellSnapshot: true, skillSearch: true, search: 'live' }, expectedVersion: state.version }, 'agent'), /capability_user_approval_required/);
    await manager.manage({ action: 'tools_configure', approve: true, settings: { shell: true, viewImage: true, shellSnapshot: true, skillSearch: true, search: 'live' }, expectedVersion: state.version }, 'user');
    await engine.close();
    engine = make('main');
    await engine.start();
    const effective = await engine.request('config/read', { includeLayers: true, cwd: workspace });
    assert.equal(effective.config.features.shell_tool, true);
    assert.equal(effective.config.features.view_image, true);
    assert.equal(effective.config.features.multi_agent, false);
    assert.equal(effective.config.features.multi_agent_v2, false);
    checks.effectiveChoiceFromNativeFile = true;
    checks.mode = process.argv.includes('--mcp-only') ? 'mcp-only' : 'full-native-tools';
    if (!process.argv.includes('--mcp-only')) {
        const cleanEnvironment = await run('shell-does-not-inherit-parent-or-transport-env', sh('test -z "$SYNTHETIC_PARENT_PRIVATE" && test -z "$HTTPS_PROXY" && printf SYNTHETIC_ENV_CLEAN'));
        assert.ok(cleanEnvironment.exitCodes.includes(0));
        checks.shellEnvironmentIsolated = true;
        const written = join(workspace, 'written.txt');
        await run('workspace-shell-write', sh('printf SYNTHETIC_WORKSPACE_WRITE > ' + JSON.stringify(written)));
        assert.equal(readFileSync(written, 'utf8'), 'SYNTHETIC_WORKSPACE_WRITE');
        checks.workspaceWrite = true;
        const patch = '*** Begin Patch\n*** Add File: ' + join(workspace, 'patched.txt') + '\n+SYNTHETIC_PATCH_OK\n*** End Patch';
        await run('workspace-native-patch', 'text(await tools.apply_patch(' + JSON.stringify(patch) + '));');
        assert.match(readFileSync(join(workspace, 'patched.txt'), 'utf8'), /SYNTHETIC_PATCH_OK/);
        checks.nativePatch = true;
        const secret = join(outside, 'synthetic-private.txt');
        writeFileSync(secret, 'SYNTHETIC_PRIVATE_SENTINEL_3R7');
        const denied = await run('outside-read-denied', sh('/bin/cat ' + JSON.stringify(secret)));
        assert.equal(denied.privateSentinelSeen, false);
        checks.outsideReadDenied = true;
        const deniedWrite = join(outside, 'not-authorized.txt');
        await run('outside-write-denied', sh('printf denied > ' + JSON.stringify(deniedWrite)));
        assert.equal(existsSync(deniedWrite), false);
        checks.outsideWriteDenied = true;
        const approved = join(outside, 'explicit-approved.txt');
        approval = 'deny';
        await run('explicit-operation-denied', sh('printf approved > ' + JSON.stringify(approved), true));
        assert.equal(existsSync(approved), false);
        assert.ok(checks.approvals.some((x: any) => x.decision === 'deny'));
        approval = 'approve';
        const commandOnly = await run('command-approved-without-filesystem-grant', sh('printf approved > ' + JSON.stringify(approved), true));
        assert.equal(existsSync(approved), false);
        assert.ok(commandOnly.exitCodes.includes(1));
        checks.commandApprovalDoesNotGrantFilesystem = true;
        const permissionScript = 'text(await tools.request_permissions(' + JSON.stringify({ permissions: { file_system: { write: [approved] } }, reason: 'Synthetic explicit exact-file access for this turn only.' }) + '));' + sh('printf approved > ' + JSON.stringify(approved));
        await run('exact-file-turn-permission', permissionScript);
        assert.equal(readFileSync(approved, 'utf8'), 'approved');
        checks.originalTurnApproval = true;
        await run('file-permission-does-not-survive-turn', sh('printf changed > ' + JSON.stringify(approved)));
        assert.equal(readFileSync(approved, 'utf8'), 'approved');
        checks.fileGrantOnlyCurrentTurn = true;
        approval = 'deny';
        await run('loopback-network-denied', sh('/usr/bin/curl --max-time 2 --noproxy ' + JSON.stringify('*') + ' ' + JSON.stringify(origin + '/network-probe')));
        assert.equal(networkCalls, 0);
        checks.networkDefaultDenied = true;
        approval = 'approve';
        await run('whole-turn-network-refused-by-host-scope', 'text(await tools.request_permissions(' + JSON.stringify({ permissions: { network: { enabled: true } }, reason: 'Synthetic loopback network access, this turn only.' }) + '));' + sh('/usr/bin/curl --max-time 2 --noproxy ' + JSON.stringify('*') + ' ' + JSON.stringify(origin + '/network-probe')));
        assert.equal(networkCalls, 0);
        checks.wholeTurnNetworkGrantRefused = true;
        approval = 'deny';
        await run('network-permission-does-not-survive-turn', sh('/usr/bin/curl --max-time 2 --noproxy ' + JSON.stringify('*') + ' ' + JSON.stringify(origin + '/network-probe')));
        assert.equal(networkCalls, 0);
        checks.networkRemainsDeniedAfterRefusal = true;
        approval='approve';
        await run('command-approval-does-not-grant-network',sh('/usr/bin/curl --max-time 2 --noproxy '+JSON.stringify('*')+' '+JSON.stringify(origin+'/network-probe'),true));
        assert.equal(networkCalls,0);checks.commandApprovalDoesNotGrantNetwork=true;approval='deny';
        writeFileSync(join(workspace, 'synthetic.png'), readFileSync(resolve('assets/branding/homer-hippo-cool-icon-256.png')));
        const image = await run('native-view-image', 'const result=await tools.view_image({path:' + JSON.stringify(join(workspace, 'synthetic.png')) + '});text({probeViewResultKeys:Object.keys(result),probeViewIsArray:Array.isArray(result),probeViewValues:Object.values(result).map(v=>typeof v),probeViewUrlType:typeof result.image_url,probeViewUrlPresent:typeof result.image_url==="string"});if(result.image_url)image(result.image_url);');
        assert.equal(image.imageOutputSeen, true);
        checks.viewImage = true;
        const outsideImage = join(outside, 'outside.png');
        writeFileSync(outsideImage, readFileSync(join(workspace, 'synthetic.png')));
        const forbiddenImage = await run('native-view-image-outside-denied', 'const r=await tools.view_image({path:' + JSON.stringify(outsideImage) + '});if(r?.image_url)image(r.image_url);');
        assert.equal(forbiddenImage.imageOutputSeen, false);
        checks.viewImageScopeDenied = true;
        const protectedFile = join(home, 'synthetic-auth.txt');
        writeFileSync(protectedFile, 'SYNTHETIC_PRIVATE_SENTINEL_3R7');
        const privateRead = await run('native-home-read-denied', sh('/bin/cat ' + JSON.stringify(protectedFile)));
        assert.equal(privateRead.privateSentinelSeen, false);
        assert.ok(privateRead.exitCodes.includes(1));
        checks.nativeHomeReadDenied = true;
        const outsidePatch = join(outside, 'outside-patch.txt');
        approval = 'deny';
        await run('native-patch-outside-denied', 'text(await tools.apply_patch(' + JSON.stringify('*** Begin Patch\n*** Add File: ' + outsidePatch + '\n+SYNTHETIC_DENIED_PATCH\n*** End Patch') + '));');
        assert.equal(existsSync(outsidePatch), false);
        checks.nativePatchScopeDenied = true;
    }
    if (!engine.resumable)
        await run('persist-synthetic-thread-before-configuration', 'text("Synthetic configured thread marker.");');
    await manager.manage({ action: 'skill_save', name: 'native-check', description: 'Synthetic own-home capability verification only.', body: 'SYNTHETIC_NATIVE_SKILL_BODY_8K4', expectedHash: null }, 'agent');
    state = await manager.state();
    await manager.manage({ action: 'mcp_save', name: 'stdio', server: { command: process.execPath, args: [resolve('tests/fixtures/native-capability-mcp.mjs')], enabled_tools: ['echo'] }, approve: true, expectedVersion: state.version }, 'user');
    state = await manager.state();
    await manager.manage({ action: 'mcp_save', name: 'http', server: { url: origin + '/mcp', enabled_tools: ['echo'] }, approve: true, expectedVersion: state.version }, 'user');
    assert.deepEqual(await engine.refreshCapabilities(), { pending: false });
    const mcpStatus = await engine.request('mcpServerStatus/list', { threadId: engine.threadId, detail: 'full', limit: 100 });
    const appliedMcp = await engine.request('config/read', { cwd: workspace, includeLayers: true });
    checks.mcpEffective = Object.keys(appliedMcp.config.mcp_servers ?? {});
    checks.nativeServerFieldNames = Object.fromEntries(appliedMcp.layers.filter((l: any) => l.name?.type === 'user').flatMap((l: any) => Object.entries(l.config.mcp_servers ?? {})).map(([n, s]: any) => [n, Object.keys(s)]));
    checks.managedMcp = (await manager.state()).servers.map((s: any) => ({ name: s.name, managed: s.managed }));
    checks.mcpStatus = mcpStatus.data.map((s: any) => ({ name: s.name, toolCount: Object.keys(s.tools ?? {}).length, status: s.runtimeStatus, error: !!s.toolsError }));
    const skillPath = join(home, 'skills/native-check/SKILL.md');
    const skillTurn = await run('native-skill-on-demand', sh('/bin/cat ' + JSON.stringify(skillPath)), { skills: [{ name: 'native-check', path: skillPath }] });
    assert.equal(skillTurn.ownSkillBodySeen, true);
    assert.ok(skillTurn.exitCodes.includes(0));
    checks.nativeSkillOnDemand = true;
    const catalogNames = requests.at(-1)!.nestedToolNames;
    const stdioName = catalogNames.find(n => n.includes('stdio') && n.endsWith('echo')), httpName = catalogNames.find(n => n.includes('http') && n.endsWith('echo'));
    checks.mcpDeclared = { stdio: !!stdioName, http: !!httpName };
    for (const [transport] of [['stdio', stdioName ?? 'mcp__stdio__echo'], ['http', httpName ?? 'mcp__http__echo']]) {
        const result = await run('native-main-mcp-' + transport, 'text({probeNativeToolNames:ALL_TOOLS.filter(t=>/stdio|http|echo/.test(t.name)||t.description?.includes("Synthetic local echo")).map(t=>t.name)});const picked=ALL_TOOLS.find(t=>t.name.includes(' + JSON.stringify(transport) + ')&&t.name.includes("echo"));if(picked)text(await tools[picked.name]({text:"SYNTHETIC_APPROVED_MCP_ECHO"}));');
        assert.equal(result.mcpEchoSeen, true);
    }
    checks.nativeMainMcpActualTools = true;
    const mainThread = engine.threadId;
    await engine.close();
    const workerDir = join(runtime, 'worker');
    mkdirSync(workerDir);
    engine = make('worker', undefined, workerDir);
    await engine.start();
    const approvalCount = checks.approvals.length;
    for (const [transport] of [['stdio', stdioName ?? 'mcp__stdio__echo'], ['http', httpName ?? 'mcp__http__echo']]) {
        const result = await run('native-worker-mcp-' + transport, 'text({probeNativeToolNames:ALL_TOOLS.filter(t=>/stdio|http|echo/.test(t.name)||t.description?.includes("Synthetic local echo")).map(t=>t.name)});const picked=ALL_TOOLS.find(t=>t.name.includes(' + JSON.stringify(transport) + ')&&t.name.includes("echo"));if(picked)text(await tools[picked.name]({text:"SYNTHETIC_APPROVED_MCP_ECHO"}));');
        assert.equal(result.mcpEchoSeen, true);
    }
    const workerSkill = await run('native-worker-own-skill', 'text(await tools.exec_command({cmd:' + JSON.stringify('/bin/cat ' + JSON.stringify(skillPath)) + ',login:false,workdir:' + JSON.stringify(workerDir) + '}));', { skills: [{ name: 'native-check', path: skillPath }] });
    assert.equal(workerSkill.ownSkillBodySeen, true);
    assert.ok(workerSkill.exitCodes.includes(0));
    assert.equal(checks.approvals.length, approvalCount);
    const workerDenied = join(workspace, 'worker-denied.txt');
    await run('worker-cannot-write-main-workspace', 'text(await tools.exec_command({cmd:' + JSON.stringify('printf denied > ' + JSON.stringify(workerDenied)) + ',login:false,workdir:' + JSON.stringify(workerDir) + '}));');
    assert.equal(existsSync(workerDenied), false);
    checks.nativeWorkerMcpAndSkills = true;
    checks.workerCannotWriteMainWorkspace = true;
    await engine.close();
    engine = make('main', mainThread);
    await engine.start();
    assert.equal(engine.threadId, mainThread);
    if (!process.argv.includes('--mcp-only')) {
        const until = async (check: () => boolean) => { for (let i = 0; i < 300; i++) {
            if (check())
                return;
            await new Promise(r => setTimeout(r, 20));
        } throw Error('synthetic_native_tool_wait_timeout'); };
        turn++;
        script = sh('/bin/sleep 5');
        sent = false;
        const interrupted = engine.turn('Synthetic stop foreground command');
        await until(() => engine!.nativeBusy);
        await engine.interrupt();
        assert.equal((await interrupted).status, 'interrupted');
        approvals.end('synthetic-generation-' + turn);
        await until(() => !engine!.nativeBusy);
        checks.nativeInterrupt = true;
        approval = 'hold';
        turn++;
        script = 'text(await tools.request_permissions('+JSON.stringify({permissions:{file_system:{read:[join(outside,"late-approved.txt")]}},reason:"Synthetic late decision must not authorize after stop."})+'));';
        sent = false;
        const held = engine.turn('Synthetic pending native approval');
        await until(() => !!heldApproval);
        await engine.interrupt();
        assert.equal((await held).status, 'interrupted');
        assert.throws(() => approvals.respond(heldApproval!, { requestId: 'synthetic-late-decision', text: '允许本次操作' }), /interaction_not_live/);
        approvals.end('synthetic-generation-' + turn);
        checks.stoppedApprovalCannotExecute = true;
        approval = 'deny';
        await run('background-shell-session', sh('/bin/sleep 3'));
        const terminals = await engine.request('thread/backgroundTerminals/list', { threadId: engine.threadId, limit: 100 });
        checks.backgroundAfterTurn = terminals.data.length;
        assert.ok(terminals.data.length > 0);
        assert.equal(engine.nativeBusy, true);
        const originalPid = engine.pid, originalThread = engine.threadId;
        state = await manager.state();
        const saved = await manager.manage({ action: 'tools_configure', approve: true, settings: { shell: true, viewImage: false, shellSnapshot: true, skillSearch: true, search: 'disabled' }, expectedVersion: state.version }, 'user');
        assert.equal(saved.application, 'safe_reconnect_required');
        assert.deepEqual(await engine.refreshCapabilities(), { pending: true });
        assert.equal(engine.pid, originalPid);
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (!engine.nativeBusy) {
                checks.backgroundNaturallyCompleted = true;
                break;
            }
        }
        assert.equal(checks.backgroundNaturallyCompleted, true);
        assert.deepEqual(await engine.refreshCapabilities(), { pending: false });
        assert.equal(engine.threadId, originalThread);
        assert.notEqual(engine.pid, originalPid);
        assert.equal(engine.activeToolSettings?.viewImage, false);
        const beforeRefresh = requests.length;
        await run('after-safe-native-reconnect', sh('printf SYNTHETIC_RECONNECTED_OK'));
        assert.ok(requests.slice(beforeRefresh).every(r => !r.nestedToolNames.includes('view_image')));
        checks.safeSameThreadReconnect = true;
        checks.backgroundPreventsReconnect = true;
        const timeoutMarker = join(workspace, 'should-not-write-after-close.txt');
        turn++;
        script = sh('/bin/sleep 3; printf late > ' + JSON.stringify(timeoutMarker));
        sent = false;
        const timed = engine.turn('Synthetic host deadline cleanup');
        const timedOutcome = timed.then(() => false, () => true);
        await until(() => engine!.nativeBusy);
        assert.equal(await engine.close(), true);
        assert.equal(await timedOutcome, true);
        const resumedThread = engine.threadId;
        engine = make('main', resumedThread);
        await engine.start();
        assert.equal(engine.threadId, resumedThread);
        await new Promise(r => setTimeout(r, 3200));
        assert.equal(existsSync(timeoutMarker), false);
        checks.hostDeadlineStopsOwnedCommand = true;
        checks.resumeAfterNativeStop = true;
    }
    checks.toolNames = [...new Set(requests.flatMap(r => r.toolNames))];
    checks.nestedToolNames = [...new Set(requests.flatMap(r => r.nestedToolNames))];
    assert.ok(![...checks.toolNames,...checks.nestedToolNames].some((name:string)=>name.includes('spawn_agent')||name.startsWith('collaboration.')), 'Homer must be the only business scheduler even when the model prefers native multi-agent');
    checks.nativeMultiAgentToolsAbsent = true;
    checks.snapshots = readdirSync(home).filter(x => /snapshot/.test(x));
    checks.thread = engine.threadId;
    checks.success = true;
}
catch (error) {
    checks.requestMetadata = requests;
    checks.error = error instanceof Error ? error.message : 'native_tool_acceptance_failed';
    process.exitCode = 1;
}
finally {
    await engine?.close();
    db.close();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    writeFileSync(join(root, process.argv.includes('--mcp-only') ? 'native-mcp-worker-acceptance-receipt.json' : 'native-tool-acceptance-receipt.json'), JSON.stringify(checks, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(checks).filter(([k]) => k !== 'requestMetadata'))));
}
