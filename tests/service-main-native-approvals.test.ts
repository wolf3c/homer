import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Homer } from '../src/service.js';
import { homerWebBridge } from '../src/web-homer.js';
import type { EngineOptions, TurnResult } from '../src/engine.js';
import type { Config } from '../src/config.js';
const until = async (check: () => boolean) => { for (let i = 0; i < 300; i++) {
    if (check())
        return;
    await new Promise(r => setTimeout(r, 5));
} throw Error('synthetic_native_approval_timeout'); };
test('main native permission stays on the original turn and accepts user decision without a second model turn', async () => {
    const scratch = resolve('.codex/scratch');
    mkdirSync(scratch, { recursive: true });
    const dir = mkdtempSync(join(scratch, 'main-native-'));
    const config: Config = { workspace: join(dir, 'workspace'), runtime: join(dir, 'runtime'), codexHome: join(dir, 'codex'), nativeCodexHome: join(dir, 'codex'), codexBin: '/usr/bin/false', requiresOpenaiAuth: false, model: 'synthetic', effort: 'medium', stopGraceMs: 100 };
    for (const p of [config.workspace, config.runtime, config.codexHome])
        mkdirSync(p, { recursive: true });
    let turns = 0, options: EngineOptions | undefined;
    let peer: Fake;
    class Fake extends EventEmitter {
        nativeBusy = false;
        threadId = 'synthetic-main-thread';
        turnId?: string;
        resumable = true;
        async start() { return this.threadId; }
        async turn(_text: string, opts?: {
            onStarted?: (id: string) => void;
        }): Promise<TurnResult> { turns++; this.turnId = 'synthetic-turn'; opts?.onStarted?.(this.turnId); assert.equal(options?.nativeTools, 'main'); const result = await options!.onInteraction!({ method: 'item/commandExecution/requestApproval', threadId: this.threadId, turnId: this.turnId, itemId: 'synthetic-command', requestId: 123, kind: 'authorization', details: { command: 'synthetic project operation', availableDecisions: ['accept', 'decline'] } }); return { status: 'completed', text: 'Synthetic result: ' + result.status }; }
        async close() { return true; }
        async interrupt() { return false; }
    }
    const app = new Homer(config, async () => { }, opts => { options = opts; return peer = new Fake(); });
    try {
        await app.start();
        const checks:string[]=[];app.onStateChange(reason=>{if(reason==='user-input')checks.push(reason);});
        const bridge = homerWebBridge(app);
        app.submitMessage({ requestId: 'original-user', text: 'Synthetic authorized project operation' });
        await until(() => app.interactions.list().some(i => i.state === 'pending_user'));
        const state = await bridge.history!.state();
        const pending = state.interactions[0]!;
        assert.equal(pending.kind, 'authorization');
        assert.match(pending.question, /synthetic project operation/);
        assert.equal(app.store.runs().length, 0);
        const receipt = await bridge.respond(pending.id, { requestId: 'actual-user-decision', text: '拒绝本次操作' }) as {
            fresh: boolean;
        };
        assert.equal(receipt.fresh, true);
        assert.equal(checks.length,2,'original user send and the real approval answer both check config');
        await app.idle();
        assert.equal(turns, 1);
        assert.equal(app.store.meta('mainThread'), 'synthetic-main-thread');
        assert.equal(app.interactions.inspect(pending.id).decision?.action, 'deny');
        assert.equal(app.inputs.list().length, 1);
        assert.equal((await bridge.history!.state()).interactions.length, 0);
        assert.equal(app.upgradeStatus().safe, true);
        peer!.nativeBusy = true;
        assert.equal(app.upgradeStatus().safe, false);
        peer!.nativeBusy = false;
        assert.equal(app.upgradeStatus().safe, true);
    }
    finally {
        await app.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('preview location uses the existing approval receipt and expires without applying late choices', async () => {
    const { fixture, until: wait } = await import('./fixtures/worker-chat-host.js');
    const f = fixture();
    const deliveries: { action: string; input: Record<string, unknown> }[] = [];
    f.app.bindBrowserPreview(async (_actor, action, input) => { deliveries.push({ action, input }); });
    try {
        await f.app.start();
        const threadId = f.app.store.meta('mainThread')!;
        const bridge = homerWebBridge(f.app);
        const request = { threadId, owner: 'main:' + threadId, pageId: 'page-synthetic', origin: 'https://synthetic.invalid', permission: 'geolocation', interactive: true };
        const id = '11111111-1111-4111-a111-111111111111';
        const first = f.app.browserPermission({ ...request, id });
        await wait(() => deliveries.some(item => item.action === 'location-card'));
        const card = (await bridge.history!.state()).interactions[0]!;
        assert.equal(card.approval?.rememberLocation, true);
        const [remember, competing] = await Promise.allSettled([
            bridge.respond(card.id, { requestId: 'synthetic-remember', text: '记住此站点' }),
            bridge.respond(card.id, { requestId: 'synthetic-competing', text: '拒绝本次操作' }),
        ]);
        assert.equal(remember.status, 'fulfilled');
        assert.equal(competing.status, 'rejected');
        await first;
        assert.deepEqual(deliveries.at(-1), { action: 'location-decision', input: { id, allow: true, remember: true } });
        const saved = (await bridge.history!.state()).messages.find(message => message.interaction?.id === card.id);
        assert.match(saved?.interaction?.description ?? '', /决定已交给原网页/);
        assert.equal(f.inputs.length, 0);

        const expiredId = '22222222-2222-4222-a222-222222222222';
        const second = f.app.browserPermission({ ...request, id: expiredId });
        const expired = (await bridge.history!.state()).interactions[0]!;
        await f.app.browserPermission({ id: expiredId, expired: true });
        await second;
        await assert.rejects(
            bridge.respond(expired.id, { requestId: 'synthetic-late', text: '记住此站点' }),
            /interaction_not_live|interaction_already_resolved/,
        );
        assert.equal(deliveries.some(item => item.input.id === expiredId && item.input.allow === true), false);

        const backgroundId = '33333333-3333-4333-a333-333333333333';
        await f.app.browserPermission({ ...request, id: backgroundId, interactive: false, requestId: 'inactive-task' });
        assert.deepEqual(deliveries.at(-1), { action: 'location-decision', input: { id: backgroundId, allow: false } });
        assert.equal((await bridge.history!.state()).interactions.length, 0);
    } finally {
        await f.close();
    }
});
