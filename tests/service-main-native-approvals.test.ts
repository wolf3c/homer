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
    const config: Config = { workspace: join(dir, 'workspace'), runtime: join(dir, 'runtime'), codexHome: join(dir, 'codex'), nativeCodexHome: join(dir, 'codex'), codexBin: '/usr/bin/false', requiresOpenaiAuth: false, model: 'synthetic', effort: 'medium', timeoutMs: 1000, mainTimeoutMs: 2000, stopGraceMs: 100 };
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
        }): Promise<TurnResult> { turns++; this.turnId = 'synthetic-turn'; opts?.onStarted?.(this.turnId); assert.equal(options?.permissionRequests, true); assert.equal(options?.nativeTools, 'main'); const result = await options!.onInteraction!({ method: 'item/commandExecution/requestApproval', threadId: this.threadId, turnId: this.turnId, itemId: 'synthetic-command', requestId: 123, kind: 'authorization', details: { command: 'synthetic project operation', availableDecisions: ['accept', 'decline'] } }); return { status: 'completed', text: 'Synthetic result: ' + result.status }; }
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
        const state = await bridge.state();
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
        assert.equal((await bridge.state()).interactions.length, 0);
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
