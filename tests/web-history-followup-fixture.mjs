// Real production UI and HTTP transport, synthetic owners and a nonexecuting fake engine.
// Never import service/config/native-account/engine, never read product runtime.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import { resolve, join } from 'node:path';
import { historyFixture, syntheticRoot } from './web-history-loading-fixture.js';
import { WebHistoryPages } from '../src/web-history-pages.js';
import {Files} from '../src/files.js';
import {WorkerProgressStore} from '../src/worker-progress.js';
import {dirname} from 'node:path';
import {isUtf8} from 'node:buffer';
import { projectConversation } from '../src/conversation-projection.js';
import { homerWebBridge } from '../src/web-homer.js';
import { createWebServer } from '../src/web-server.js';
const destination=resolve(syntheticRoot);
export async function fixture(total, mode, media = false, stableRecent = false) {
    const f = historyFixture(total,160,stableRecent), reader = mode === 'after' ? new WebHistoryPages(f.history, f.processes, f.inputs) : undefined;
    const listeners = new Set();
    let server;
    const submitted = [], stopped = [], mediaRequests = [];
    if (media)
        for (let n = total - 40; n < total; n++) {
            const assetId = 'asset-00000000-0000-4000-8000-' + String(n).padStart(12, '0');
            f.store.db.prepare('INSERT INTO conversation_attachments VALUES(?,?)').run('request-' + n, JSON.stringify([{ assetId, revision: 1 }]));
        }
    const mediaOwner = { view(ref) { return { ...ref, kind: 'image', state: 'ready', mime: 'image/png', size: 68, filename: 'synthetic-image.png', error: null }; } };
    const fakeEngine={invocations:0,turn(){this.invocations++;throw Error('synthetic_engine_forbidden');}};
    const files=new Files(resolve(syntheticRoot+'/unused-workspace')),workerProgress=new WorkerProgressStore();
    const host = { ...f, files, engine:fakeEngine, webReadEpoch: 'synthetic-browser-epoch', webHistoryPages: () => reader, registerChannelCapabilities() { }, onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }, media: mediaOwner, conversationControlState: () => ({ isRunning: false, activeMessageId: null }), submitMessage(input) { submitted.push(input.requestId); const receipt = f.inputs.accept(input); server?.publish(); return receipt; }, snapshot() { throw Error('full_snapshot_forbidden'); }, conversationState() { throw Error('full_conversation_forbidden'); }, stopMain(id) { stopped.push(id); return {}; } };
    host.readWorkerExecution=(selector,before)=>{const scope=f.tasks.executionReadScope({agentId:f.store.meta('mainAgentId')},selector,f.store.meta('mainThread')??'');return workerProgress.execution(selector,scope.version,before);};
    host.readWorkerCall=(selector,callKey)=>{const scope=f.tasks.executionReadScope({agentId:f.store.meta('mainAgentId')},selector,f.store.meta('mainThread')??'');if(!/^[a-f0-9]{64}$/.test(callKey))throw Error('execution_call_unavailable');return workerProgress.call(selector,scope.version,callKey);};
    const bridge = homerWebBridge(host, { nativeCapabilities: false, draftUpload: false });
    // The synthetic host has no service instance; retain the same published-file checks.
    host.previewArtifact=id=>{
        const verified=id.startsWith('result-')?f.tasks.publishedResult(id):f.tasks.publishedArtifact(id);
        if(!verified)throw Error('artifact_not_authorized');
        const file=files.resultBytes(dirname(verified.path),verified.path);
        if(file.sha256!==verified.sha256)throw Error('result_hash_mismatch');
        const filename=verified.filename,mime=file.mime==='application/octet-stream'&&/\.html?$/i.test(filename)&&isUtf8(file.data)?'text/html; charset=utf-8':file.mime;
        return {filename,content:verified.content,data:file.data.toString('base64'),mime,sha256:file.sha256};
    };
    if (mode === 'before')
        bridge.state = async () => {
            const history = f.history.list('synthetic-history').map(message => ({ ...message, ...(message.attachments ? { media: message.attachments.map(mediaOwner.view) } : {}) })), nodes = f.processes.list('synthetic-history');
            return { threadId: 'synthetic-history', ...projectConversation(history, nodes, f.inputs.list()), processNodes: nodes, acceptedRequestIds: f.history.acceptedRequestIds('synthetic-history'), conversationView: 2, isRunning: false, activeMessageId: null, work: [], interactions: [], upgrade: { phase: 'running', accepting: true } };
        };
    bridge.wechat = { state: async () => ({ enabled: false, bound: false, status: 'disconnected' }) };
    bridge.media = { read: async (input) => { mediaRequests.push(input.assetId); const message = f.history.byIds('synthetic-history', [input.messageId])[0]; if (!message?.attachments?.some(ref => ref.assetId === input.assetId && ref.revision === input.revision))
            throw Error('media_scope_denied'); await new Promise(done => setTimeout(done, 300)); return { filename: 'synthetic-image.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=' }; } };
    // Older committed servers use a per-launch connection file. Keep even
    // that synthetic state in this task's scratch, never the default private root.
    mkdirSync(destination,{recursive:true});
    const connectionDirectory=mkdtempSync(join(destination,'synthetic-connection-'));
    server = await createWebServer({ bridge, connectionDirectory, port: 0, uiDirectory: process.env.HISTORY_FOLLOWUP_BUILD??join(destination, 'browser-' + mode), logoPath: resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png') });
    assert.notEqual(new URL(server.url).port, '4780');
    const remove = f.store.db.onChange(() => { for (const listener of listeners)
        listener(); });
    return { ...f, files, workerProgress, fakeEngine, reader, bridge, server, submitted, stopped, mediaRequests, close: async () => { assert.equal(fakeEngine.invocations,0);remove(); try{await server.close();}finally{f.close();rmSync(connectionDirectory,{recursive:true,force:true});} } };
}
