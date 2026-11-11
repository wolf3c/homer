import {commitSyntheticMessage} from './fixtures/synthetic-message.js';
// Real production UI and HTTP transport, synthetic owners and a nonexecuting fake engine.
// Never import service/config/native-account/engine, never read product runtime.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import { resolve, join } from 'node:path';
import { historyFixture, syntheticRoot } from './web-history-loading-fixture.js';
import { WebHistoryPages } from '../src/web-history-pages.js';
import {Files} from '../src/files.js';
import {WorkerProgressStore} from '../src/worker-progress.js';
import {MediaStore} from '../src/media-store.js';
import { homerWebBridge } from '../src/web-homer.js';
import { createWebServer } from '../src/web-server.js';
const destination=resolve(syntheticRoot);
export async function fixture(total, mode, media = false, stableRecent = false) {
    const f = historyFixture(total,160,stableRecent), reader = new WebHistoryPages(f.history, f.processes, f.inputs);
    const listeners = new Set();
    let server;
    const submitted = [], stopped = [], mediaRequests = [];
    mkdirSync(destination,{recursive:true});
    const connectionDirectory=mkdtempSync(join(destination,'synthetic-connection-'));
    const mediaOwner=new MediaStore(f.store.db,join(connectionDirectory,'media'));
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64');
    function addUserMedia(n,bytes=png){
        const key='fixture-user-'+n;
        const ref=mediaOwner.snapshot(key,{filename:'synthetic-image.png',kind:'image',mime:'image/png',bytes});
        f.store.db.prepare('INSERT INTO conversation_attachments VALUES(?,?)').run('user-'+n,JSON.stringify([ref]));
        mediaOwner.pinAttachment(ref,'user-'+n);mediaOwner.abandonOperation(key);
    }
    if(media)for(let n=Math.max(0,total-40);n<total;n++)addUserMedia(n);
    const attach=(text,files,task)=>commitSyntheticMessage({...f,media:mediaOwner},task?.threadId??'synthetic-history',text,files,undefined,task);
    const fakeEngine={invocations:0,turn(){this.invocations++;throw Error('synthetic_engine_forbidden');}};
    const files=new Files(resolve(syntheticRoot+'/unused-workspace')),workerProgress=new WorkerProgressStore();
    const host = { ...f, files, workerProgress, engine:fakeEngine, webReadEpoch: 'synthetic-browser-epoch', webHistoryPages: () => reader, registerWebSurface() { }, onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }, media: mediaOwner, conversationControlState: () => ({ isRunning: false, activeMessageId: null }), submitMessage(input) { submitted.push(input.requestId); const receipt = f.inputs.accept(input); server?.publish(); return receipt; }, snapshot() { throw Error('full_snapshot_forbidden'); }, conversationState() { throw Error('full_conversation_forbidden'); }, stopMain(id) { stopped.push(id); return {}; } };
    host.readWorkerExecution=(selector,before)=>{const scope=f.tasks.executionReadScope({agentId:f.store.meta('mainAgentId')},selector,f.store.meta('mainThread')??'');return workerProgress.execution(selector,scope.version,before);};
    host.readWorkerCall=(selector,callKey)=>{const scope=f.tasks.executionReadScope({agentId:f.store.meta('mainAgentId')},selector,f.store.meta('mainThread')??'');if(!/^[a-f0-9]{64}$/.test(callKey))throw Error('execution_call_unavailable');return workerProgress.call(selector,scope.version,callKey);};
    const bridge = homerWebBridge(host, { draftUpload: false });
    host.attachmentMessage=input=>{
        const message=f.history.message(input.messageId);
        if(message?.threadId!==f.store.meta('mainThread')||message.audience!=='user'||message.revokedAt!=null||!message.attachments?.some(ref=>ref.assetId===input.assetId&&ref.revision===input.revision))throw Error('media_scope_denied');
        return message;
    };
    host.readAttachment=async input=>{
        mediaRequests.push(input.assetId);const message=host.attachmentMessage(input);
        if(media&&message.role==='user')await new Promise(done=>setTimeout(done,300));
        const {asset,bytes}=mediaOwner.readAttachment(input);
        return {filename:asset.filename,mime:asset.mime,sha256:asset.hash,data:bytes.toString('base64')};
    };
    server = await createWebServer({ bridge, connectionDirectory, port: 0, uiDirectory: process.env.HISTORY_FOLLOWUP_BUILD??join(destination, 'browser-' + mode), logoPath: resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png') });
    assert.notEqual(new URL(server.url).port, '4780');
    const remove = f.store.db.onChange(() => { for (const listener of listeners)
        listener(); });
    return { ...f, files, workerProgress, fakeEngine, reader, bridge, server, attach, addUserMedia, submitted, stopped, mediaRequests, close: async () => { assert.equal(fakeEngine.invocations,0);remove(); try{await server.close();}finally{f.close();rmSync(connectionDirectory,{recursive:true,force:true});} } };
}
