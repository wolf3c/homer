import { WorkerInteractions, type InteractionInput, type InteractionResolution } from './worker-interactions.js';
import { ConversationHistory, conversationInput, type ConversationInput, type ConversationAcceptance } from './web-history.js';
import { nativeResponse, type InteractionDecision } from './worker-interaction-protocol.js';
import type { NativeRequest } from './worker-native-requests.js';
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
function authorizationReview(request: NativeRequest) {
    const p = request.details as any;
    const lines = ['确认本次操作：'];
    if (request.method === 'mcpServer/elicitation/request') {
        const meta = p._meta;
        lines.push('服务：' + mcpDisplay(p.serverName), mcpDisplay(p.message));
        if (meta.tool_title) lines.push('工具：' + mcpDisplay(meta.tool_title));
        if (meta.connector_name) lines.push('来源：' + mcpDisplay(meta.connector_name));
        const display = meta.tool_params_display;
        if (display?.length) for (const entry of display)
            lines.push(mcpDisplay(entry.display_name) + '：' + mcpDisplay(entry.value, entry.name + ' ' + entry.display_name));
        else if (Object.hasOwn(meta, 'tool_params')) lines.push('操作参数：' + mcpDisplay(meta.tool_params));
        else lines.push('原请求未提供参数。');
    }
    else if (request.method === 'item/permissions/requestApproval') {
        const permission = p.permissions ?? {};
        if (permission.network?.enabled === true)
            lines.push('请求当前回复轮次的网络访问。');
        const fs = permission.fileSystem ?? {};
        for (const [key, label] of [['read', '读取'], ['write', '写入']] as const)
            for (const path of fs[key] ?? [])
                lines.push(label + '：' + path);
        for (const entry of fs.entries ?? [])
            lines.push((entry.access === 'read' ? '读取' : '写入') + '：' + entry.path.path);
    }
    else if (request.method === 'item/commandExecution/requestApproval') {
        if (p.command)
            lines.push(p.command);
        if (p.cwd)
            lines.push('工作目录：' + p.cwd);
        if (p.networkApprovalContext)
            lines.push('网络目标：' + p.networkApprovalContext.protocol + ' / ' + p.networkApprovalContext.host);
    }
    else {
        for (const change of p.operation?.changes ?? [])
            lines.push('文件：' + change.path + (change.kind?.move_path ? ' → ' + change.kind.move_path : '') + '\n' + (change.diff ?? ''));
        if (p.grantRoot)
            lines.push('此请求要求跨轮次的目录权限；当前入口不能批准，请拒绝并缩小范围。');
    }
    if (p.reason)
        lines.push('请求说明：' + p.reason);
    return lines.join('\n');
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
        return this.openReview(review.requestId,'authorization',{method:review.method??'homer_capability_operation',operation:review.details},review.question,review.reason??'仅批准所示安装或配置；不批准额外登录、费用、外发、系统权限或自动重试。取消或本轮结束后失效。',scope);
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
        const question = request.kind === 'authorization' ? authorizationReview(request) : questions?.length === 1 ? questions[0]!.question + (questions[0]!.options?.length ? '\n可选：' + questions[0]!.options!.map(o => o.label).join('、') : '') : '请补充本轮所需的信息。';
        if (!question.trim() || question.length > 4000) throw Error('native_approval_review_too_large');
        // The full command is already in the review, and the live callback holds its native request.
        const params = command ? undefined : ordinary ? {
            mode: request.details.mode, serverName: mcpDisplay(request.details.serverName),
            message: mcpDisplay(request.details.message), requestedSchema: {type: 'object', properties: {}},
            _meta: {codex_approval_kind: 'mcp_tool_call'},
        } : request.details;
        const reason = request.kind==='question'?'答复交给荷马继续处理，不授予操作权限。':request.method === 'item/permissions/requestApproval' ? ((request.details.permissions as any)?.network?.enabled === true ? '网络许可覆盖当前回复轮次的网络访问，不限单一站点；本轮结束即失效。' : '文件许可仅当前回复轮次有效，本轮结束即失效。') : '仅授权当前请求；不授予永久权限或自动重试。';
        return this.openReview(request.requestId,request.kind,{method:request.method,params},question,reason,scope,decision=>{
            nativeResponse(request,decision);
            const changes=(request.details.operation as {changes?:unknown}|undefined)?.changes;
            if (decision.action === 'approve' && request.method === 'item/fileChange/requestApproval' &&
                (!Array.isArray(changes)||!changes.length))
                throw Error('interaction_approval_unavailable');
        });
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
