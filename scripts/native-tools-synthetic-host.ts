// UI acceptance only: real Homer/Web/SQLite/native config; scripted main turn.
import { EventEmitter } from 'node:events';
import { accessSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Homer } from '../src/service.js';
import { type EngineOptions, type TurnResult } from '../src/engine.js';
import { nativeToolChoices, type NativeToolChoices } from '../src/native-tool-settings.js';
import { createWebServer } from '../src/web-server.js';
import { homerWebBridge } from '../src/web-homer.js';
const bin = process.argv[2];
if (!bin?.endsWith('/codex'))
    throw Error('fixed_native_binary_required');
const uiDirectory=resolve(process.env.HISTORY_FOLLOWUP_BUILD??'dist/web');accessSync(join(uiDirectory,'index.html'));
const root = resolve('.codex/scratch/native-tools-browser');
mkdirSync(root, { recursive: true });
const data = mkdtempSync(join(root, 'synthetic-'));
const config = { appData: data, nativeCodexHome: join(data, 'codex'), codexHome: join(data, 'codex'), codexBin: resolve(bin), workspace: join(data, 'workspace'), runtime: join(data, 'runtime'), model: 'gpt-6.1-sol', effort: 'medium' as const, requiresOpenaiAuth: false, timeoutMs: 3000, mainTimeoutMs: 120000, stopGraceMs: 1000 };
for (const dir of [config.workspace, config.runtime, config.codexHome])
    mkdirSync(dir, { recursive: true });
let seq = 0, web: Awaited<ReturnType<typeof createWebServer>> | undefined;
class ScriptedMain extends EventEmitter {
    threadId = 'synthetic-native-browser-thread';
    turnId?: string;
    resumable = true;
    activeToolSettings: NativeToolChoices = nativeToolChoices({});
    nativeBusy = false;
    private stop?: () => void;
    constructor(private options: EngineOptions) { super(); }
    async start() { return this.threadId; }
    async refreshCapabilities() { const state = await app.capabilityState(); this.activeToolSettings = state.toolSettings; return { pending: false }; }
    async turn(text: string, options?: {
        onStarted?: (id: string) => void;
    }): Promise<TurnResult> {
        this.turnId = 'synthetic-ui-turn-' + ++seq;
        options?.onStarted?.(this.turnId);
        let stop!: () => void;
        const interrupted = new Promise<TurnResult>(r => stop = () => r({ status: 'interrupted', text: '' }));
        this.stop = stop;
        const action = async (): Promise<TurnResult> => {
            if (text.includes('等待停止'))
                return new Promise<TurnResult>(() => { });
            if (!text.includes('申请'))
                return { status: 'completed', text: '这是合成界面验收入口。发送“申请项目读取”或“申请网络”验证本轮审批；“等待停止”验证停止图标。未调用真实模型、账号或外部服务。' };
            const requestId = 1000 + seq, permissions = text.includes('网络') ? { network: { enabled: true } } : { fileSystem: { read: [join(data, 'synthetic-project')], write: null } };
            let result;try{result = await this.options.onInteraction!({ requestId, threadId: this.threadId, turnId: this.turnId!, itemId: 'synthetic-permission-' + seq, method: 'item/permissions/requestApproval', kind: 'authorization', details: { threadId: this.threadId, turnId: this.turnId, itemId: 'synthetic-permission-' + seq, permissions, reason: '合成界面验证；此夹具不会实际访问网络或外部项目。' } });}catch(error){if(error instanceof Error&&error.message==='interaction_network_scope_unavailable')return {status:'completed',text:'原生整轮网络许可尚不能隔离宿主控制入口，当前不能批准。可以使用已明确授权的MCP连接。'};throw error;}
            this.emit('interactionDelivered', requestId);
            return { status: 'completed', text: result.status === 'approved' ? '合成本轮范围已批准；没有执行真实外部操作。' : '合成本轮请求已拒绝。' };
        };
        try {
            const result=await Promise.race([action(), interrupted]);
            if(result.status==='completed')this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,itemId:'synthetic-final-'+seq,phase:'final_answer',text:result.text,completed:true});
            return result;
        }
        finally {
            this.stop = undefined;
        }
    }
    async interrupt() { this.stop?.(); return false; }
    async close() { this.stop?.(); return true; }
}
const app = new Homer(config, async () => { await web?.publish(); }, (options: EngineOptions) => new ScriptedMain(options));
await app.start();
web = await createWebServer({ bridge: homerWebBridge(app), port: 4802, uiDirectory, logoPath: resolve('assets/branding/homer-hippo-cool-icon-256.png') });

const receipt = { url: web.url, data, pid: process.pid, synthetic: true, realModel: false, realAccount: false, realOutbound: false };
writeFileSync(join(root, 'synthetic-browser-location.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, async () => { await web?.close(); await app.close(); process.exit(0); });
