import { WorkerInteractions, type InteractionInput, type InteractionResolution } from './worker-interactions.js';
import { ConversationHistory, conversationInput, type ConversationInput, type ConversationAcceptance } from './web-history.js';
import { nativeResponse, type InteractionDecision } from './worker-interaction-protocol.js';
import type { NativeRequest } from './worker-native-requests.js';
import type { WebApproval } from './web-contract.js';
export type MainApprovalScope = {
    threadId: string;
    turnId: string;
    generationId: string;
    sourceRequestId: string;
    userText: string;
    isCurrent: () => boolean;
    historyThreadId?: string;
    worker?: Pick<InteractionInput, 'runId' | 'runEpoch' | 'taskVersion'>;
};
const ownerPrefix = 'main-native:';
export const VIDEO_APPROVAL_METHOD='homer_video_generation';
export function approvalDecision(item: Pick<InteractionInput, 'details'>, input: ConversationInput): InteractionDecision {
    if (input.questionAnswers) throw Error('interaction_response_kind');
    if (input.attachments?.length || input.quote || input.quotes || input.resourceReference || input.resourceReferences)
        throw Error('native_approval_explicit_decision_required');
    const canCancel = item.details.method === 'mcpServer/elicitation/request' && (item.details.params as any)?._meta?.codex_approval_kind === 'mcp_tool_call';
    if (!['允许本次操作', '拒绝本次操作', ...(canCancel ? ['取消本次请求'] : [])].includes(input.text))
        throw Error('native_approval_explicit_decision_required');
    return { action: input.text === '允许本次操作' ? 'approve' : input.text === '取消本次请求' ? 'cancel' : 'deny', reason: '用户通过待答卡明确决定当前请求。', ...(input.text === '允许本次操作' && item.details.method === 'item/permissions/requestApproval' ? { permissions: (item.details.params as any).permissions } : {}) };
}
// Display copy only. Raw native arguments remain in the process-owned callback.
function mcpDisplay(value: unknown, field = ''): string {
    const sensitive = (key: string) => /password|passwd|secret|token|apikey|authorization|cookie|credential|header|env|signature/.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
    const clean = (key: string, item: unknown): unknown => {
        if (sensitive(key)) return '[已隐藏凭据]';
        if (typeof item !== 'string') return item;
        return item.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]+/gi, '[已隐藏凭据]')
            .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
                try {
                    const url = new URL(raw);
                    url.username = ''; url.password = '';
                    for (const key of [...url.searchParams.keys()]) if (sensitive(key)) url.searchParams.set(key, '[已隐藏凭据]');
                    return url.toString();
                } catch { throw Error('native_approval_review_unavailable'); }
            });
    };
    const cleaned = clean(field, value);
    return typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned, clean);
}
function filePermissions(permission: any): string[] {
    const fs = permission?.fileSystem;
    const paths: string[] = [];
    for (const [key, label] of [['read', '读取'], ['write', '写入']] as const) {
        if (Array.isArray(fs?.[key]))
            for (const path of fs[key]) if (typeof path === 'string') paths.push(label + '：' + path);
    }
    if (Array.isArray(fs?.entries)) for (const entry of fs.entries) {
        const path = entry?.path;
        if (!path) continue;
        const label = entry.access === 'read' ? '读取' : entry.access === 'write' ? '写入' : entry.access === 'deny' ? '禁止访问' : '未知访问规则';
        paths.push(label + '：' + (path.path ?? path.pattern ?? JSON.stringify(path.value) ?? '未提供路径'));
    }
    return paths;
}
function fileAccess(paths: string[]) {
    return ['读取', '写入'].filter(label => paths.some(path => path.startsWith(label + '：'))).join('、');
}
function validateNativeDecision(request: NativeRequest, decision: InteractionDecision) {
    nativeResponse(request, decision);
    if (decision.action === 'approve' && request.method === 'item/fileChange/requestApproval') {
        const changes = (request.details.operation as { changes?: unknown } | undefined)?.changes;
        if (!Array.isArray(changes) || !changes.length) throw Error('interaction_approval_unavailable');
    }
}
function authorizationReview(request: NativeRequest) {
    const p = request.details as any;
    const approval: WebApproval = { title: '允许本次操作？', scope: '仅批准本次操作。' };
    const details: string[] = [], context: string[] = [];
    let legacy: string[];
    let unavailableScope: string | undefined;
    let explanation = typeof p.reason === 'string' && p.reason.trim() ? p.reason : undefined;
    approval.explanation = explanation;
    switch (request.method) {
        case 'mcpServer/elicitation/request': {
            const meta = p._meta;
            const tool = meta.tool_title || meta.tool_name;
            approval.title = meta.codex_approval_kind === 'tool_suggestion' ? '允许安装这个插件？' : '允许调用这个工具？';
            const message = mcpDisplay(p.message);
            explanation = explanation && mcpDisplay(explanation);
            approval.explanation = [message, explanation].filter(Boolean).join('\n');
            const service = '服务：' + mcpDisplay(p.serverName);
            const operation = tool && '工具：' + mcpDisplay(tool);
            const source = meta.connector_name && '来源：' + mcpDisplay(meta.connector_name);
            context.push(...[service, operation, source].filter(Boolean));
            legacy = [service, message, meta.tool_title && operation, source].filter(Boolean);
            const destination = /^(to|recipient|recipients|destination|target|channel|url)$/i;
            const display = meta.tool_params_display;
            if (display?.length) for (const entry of display) {
                const field = mcpDisplay(entry.display_name) + '：' + mcpDisplay(entry.value, entry.name + ' ' + entry.display_name);
                details.push(field);
                if (destination.test(entry.name)) context.push(field);
            }
            else if (Object.hasOwn(meta, 'tool_params')) {
                details.push('操作参数：' + mcpDisplay(meta.tool_params));
                if (meta.tool_params && typeof meta.tool_params === 'object' && !Array.isArray(meta.tool_params))
                    for (const [key, value] of Object.entries(meta.tool_params))
                        if (destination.test(key)) context.push('目标（' + key + '）：' + mcpDisplay(value, key));
            }
            else context.push('原请求未提供参数。');
            legacy.push(...(details.length ? details : ['原请求未提供参数。']));
            approval.detailLabel = '查看操作参数';
            break;
        }
        case 'item/permissions/requestApproval': {
            const network = p.permissions?.network?.enabled === true;
            approval.title = '允许本轮使用额外权限？';
            details.push(...filePermissions(p.permissions));
            const files = details.length ? '允许文件' + fileAccess(details) + '。' : '';
            approval.scope = (network ? '允许网络访问，不限单一站点。' : '') + files + '权限在本轮结束时失效。';
            legacy = network ? ['请求当前回复轮次的网络访问。', ...details] : details;
            approval.detailLabel = '查看文件权限';
            break;
        }
        case 'item/commandExecution/requestApproval': {
            const network = p.networkApprovalContext;
            approval.title = network ? '允许这次网络访问？' : p.kind === 'writeStdin' ? '允许向正在运行的命令发送输入？' : '允许执行这条命令？';
            approval.scope = network ? '仅批准本次网络访问。' : p.kind === 'writeStdin' ? '仅批准本次输入。' : '仅批准当前命令。';
            if (network) context.push('网络目标：' + network.protocol + ' / ' + network.host);
            if (p.command) details.push(p.command);
            if (p.cwd) details.push('工作目录：' + p.cwd);
            legacy = [...details, ...context];
            approval.detailLabel = p.cwd ? '查看完整命令与工作目录' : '查看完整命令';
            const paths = filePermissions(p.additionalPermissions);
            if (paths.length) {
                const grants = paths.filter(path => path.startsWith('读取：') || path.startsWith('写入：'));
                if (grants.length)
                    approval.scope += '请求为当前命令增加文件' + fileAccess(grants) + '权限（' + grants.length + ' 项）。';
                details.push(...paths);
                approval.detailLabel = '查看命令与附加权限';
            }
            if (p.additionalPermissions?.network?.enabled === true) approval.scope += '请求为当前命令启用网络访问。';
            break;
        }
        case 'item/fileChange/requestApproval': {
            const changes = Array.isArray(p.operation?.changes) ? p.operation.changes : [];
            approval.title = '允许本次文件改动？';
            for (const change of changes) {
                const path = change.path + (change.kind?.move_path ? ' → ' + change.kind.move_path : '');
                if (context.length < 3) context.push('文件：' + path);
                details.push('文件：' + path + (change.diff ? '\n' + change.diff : ''));
            }
            if (changes.length > 3) context.push('共 ' + changes.length + ' 项文件改动');
            if (p.grantRoot) {
                unavailableScope = '请求跨轮次的目录权限，当前入口无法批准。';
                legacy = [...details, unavailableScope];
            } else {
                if (!changes.length) unavailableScope = '原请求未提供可核对的文件改动，当前入口无法批准。';
                legacy = details;
            }
            approval.detailLabel = '查看完整文件改动';
            break;
        }
        default: legacy = details;
    }
    try {
        validateNativeDecision(request, { action: 'approve', reason: '核对可批准的范围', permissions: p.permissions });
    } catch {
        approval.canApprove = false;
        approval.scope = unavailableScope ?? '当前入口无法批准此请求。';
    }
    if (context.length) approval.context = context.join('\n');
    if (details.length) approval.details = details.join('\n');
    else delete approval.detailLabel;
    const question = ['确认本次操作：', ...legacy, explanation && '请求说明：' + explanation].filter(Boolean).join('\n');
    return { approval, question };
}
// Reuses the existing interaction/history owner. The legacy runId column holds
// a distinct main-generation owner key; no Task/Run or callback is reconstructed.
export class MainNativeApprovals {
    private callbacks = new Map<string | number, string>();
    private userDecisions = new Set<string>();
    constructor(private interactions: WorkerInteractions, private history: ConversationHistory) { }
    owns(id: string) { return this.interactions.inspect(id).runId.startsWith(ownerPrefix); }
    pending(generationId: string) { return this.interactions.hasPending(ownerPrefix + generationId); }
    private openReview(requestId: string | number, kind: InteractionInput['kind'], details: InteractionInput['details'], question: string, reason: string, scope: MainApprovalScope, validate?: (decision: InteractionDecision) => void) {
        let ownerId: string | undefined;
        const opened = this.interactions.open({
            ...(scope.worker ?? {runId:ownerPrefix + scope.generationId}), threadId:scope.threadId, turnId:scope.turnId, requestId, source:'native', kind,
            details:{...details,historyThreadId:scope.historyThreadId??scope.threadId,...(scope.worker?{review:question,reviewReason:reason}:{})},
            authority:{description:scope.userText.slice(0,24000)||'主对话本轮操作',sourceRequestId:scope.sourceRequestId,nativeApprovals:true}
        }, scope.isCurrent, decision => {
            if (!scope.worker && (!ownerId || !this.userDecisions.has(ownerId))) throw Error('main_native_user_decision_required');
            validate?.(decision);
        });
        ownerId = opened.id;
        if (!scope.worker) {
            this.callbacks.set(requestId, opened.id);
            this.interactions.escalate(opened.id, question, reason);
        }
        return opened;
    }
    // A Homer capability operation is a host review, not a fabricated Codex RPC.
    // Codex still owns the actual installer/configuration after the user receipt.
    openOperation(review:{requestId:string;question:string;details:Record<string,unknown>;method?:string;reason?:string},scope:MainApprovalScope){
        if(!scope.isCurrent())throw Error('interaction_not_live');
        if(!review.question.trim()||review.question.length>4000||JSON.stringify(review.details).length>64000)throw Error('capability_review_too_large');
        const reason = review.reason ?? '仅批准所示安装或配置；不批准额外登录、费用、外发、系统权限或自动重试。取消或本轮结束后失效。';
        const approval: WebApproval = { title: review.question, scope: reason };
        return this.openReview(review.requestId,'authorization',{method:review.method??'homer_capability_operation',operation:review.details,approval},review.question,reason,scope);
    }
    open(request: NativeRequest, scope: MainApprovalScope): {
        id: string;
        response: Promise<InteractionResolution>;
    } {
        if (request.threadId !== scope.threadId || request.turnId !== scope.turnId || !scope.isCurrent())
            throw Error('interaction_not_live');
        const command = request.method === 'item/commandExecution/requestApproval';
        const ordinary = request.method === 'mcpServer/elicitation/request' && (request.details._meta as any)?.codex_approval_kind === 'mcp_tool_call';
        if (!command && JSON.stringify(request.details).length > (ordinary ? 128 * 1024 : 3000))
            throw Error('native_approval_review_too_large');
        const questions = request.details.questions as {
            id: string;
            question: string;
            options?: {
                label: string;
            }[];
        }[] | undefined;
        const review = request.kind === 'authorization' ? authorizationReview(request) : undefined;
        const question = review?.question ?? (questions?.length === 1 ? questions[0]!.question + (questions[0]!.options?.length ? '\n可选：' + questions[0]!.options!.map(o => o.label).join('、') : '') : '请补充本轮所需的信息。');
        if (!question.trim() || question.length > 4000) throw Error('native_approval_review_too_large');
        // The full command is already in the review, and the live callback holds its native request.
        const params = command ? undefined : ordinary ? {
            mode: request.details.mode, serverName: mcpDisplay(request.details.serverName),
            message: mcpDisplay(request.details.message), requestedSchema: {type: 'object', properties: {}},
            _meta: {codex_approval_kind: 'mcp_tool_call'},
        } : request.details;
        const reason = request.kind==='question'?'答复交给荷马继续处理，不授予操作权限。':request.method === 'item/permissions/requestApproval' ? ((request.details.permissions as any)?.network?.enabled === true ? '网络许可覆盖当前回复轮次的网络访问，不限单一站点；本轮结束即失效。' : '文件许可仅当前回复轮次有效，本轮结束即失效。') : '仅授权当前请求；不授予永久权限或自动重试。';
        return this.openReview(request.requestId,request.kind,{method:request.method,params,...(review ? {approval:review.approval} : {})},question,reason,scope,
            decision=>validateNativeDecision(request,decision));
    }
    respond(id: string, value: ConversationInput, acceptance?: ConversationAcceptance) {
        if (!this.owns(id))
            throw Error('interaction_scope_denied');
        const input = conversationInput({ ...value, interactionId: id });
        if (input.attachments?.length || input.quote || input.quotes)
            throw Error('native_approval_explicit_decision_required');
        const item = this.interactions.inspect(id);
        let decision: InteractionDecision;
        if (item.kind === 'authorization') decision=approvalDecision(item,input);
        else {
            let answers;
            const questions = (item.details.params as any).questions;
            if(input.questionAnswers)answers=input.questionAnswers;
            else try {
                answers = JSON.parse(input.text);
            }
            catch {
                if (questions?.length !== 1)
                    throw Error('interaction_answer_scope');
                answers = { [questions[0].id]: [input.text] };
            }
            decision = { action: 'answer', reason: '用户通过待答卡补充本轮问题。', answers };
        }
        const context = { userMessageId: input.requestId, userText: input.text };
        this.userDecisions.add(id);
        try {
            const historyThreadId=typeof item.details.historyThreadId==='string'?item.details.historyThreadId:item.threadId;
            const receipt = this.history.accept(historyThreadId, input, { source: acceptance?.source ?? 'native_approval', validateFresh: () => this.interactions.validateResponse(id, decision, context), persist: acceptance?.persist });
            // Commit the actual user receipt before releasing a live native callback.
            // A host crash never recreates the callback or replays an old permission.
            if (item.responseUserMessageId !== input.requestId) {
                this.interactions.respond(id, decision, context);
                const videoReceipt=item.details.method===VIDEO_APPROVAL_METHOD&&decision.action==='approve'?(item.details.operation as {receipt:string}).receipt:undefined;
                this.history.finish(receipt.replyId, videoReceipt?`已批准本次视频生成。取回编号 ${videoReceipt}`:item.kind === 'authorization' ? (decision.action === 'approve' ? '已批准本次操作，等待执行结果。' : decision.action === 'cancel' ? '已记录取消，等待原生处理。' : '已拒绝本次操作。') : '已提交本轮补充。', 'completed');
            }
            return receipt;
        }
        finally {
            this.userDecisions.delete(id);
        }
    }
    delivered(requestId: string | number) { const id = this.callbacks.get(requestId); if (id)
        this.interactions.markDelivered(id); }
    invalidated(requestId: string | number, code: string) { const id = this.callbacks.get(requestId); if (id) {
        this.interactions.expire(id, code);
        this.callbacks.delete(requestId);
    } }
    end(generationId: string) { this.interactions.cancelRun(ownerPrefix + generationId, 'main_turn_ended'); for (const [key, id] of this.callbacks)
        if (this.interactions.inspect(id).runId === ownerPrefix + generationId)
            this.callbacks.delete(key); }
}
