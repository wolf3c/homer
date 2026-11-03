import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { ConversationHistory } from '../src/web-history.js';
import { MainNativeApprovals } from '../src/main-native-approvals.js';
function fixture() {
    const db = new DatabaseSync(':memory:'), interactions = new WorkerInteractions(db), history = new ConversationHistory(db);
    let current = true;
    const scope = { threadId: 'main-thread', turnId: 'main-turn', generationId: 'generation-1', sourceRequestId: 'source-request', userText: 'Synthetic user request', isCurrent: () => current };
    const approvals = new MainNativeApprovals(interactions, history);
    const native = { method: 'item/commandExecution/requestApproval', threadId: scope.threadId, turnId: scope.turnId, itemId: 'command-1', kind: 'authorization' as const, requestId: 1, details: { command: 'synthetic command', availableDecisions: ['accept', 'decline'] } };
    return { db, interactions, history, scope, native, approvals, expire() { current = false; }, close() { db.close(); } };
}
test('main native approval reaches user directly and never waits for another main turn', async () => {
    const f = fixture();
    try {
        const opened = f.approvals.open(f.native, f.scope);
        const item = f.interactions.inspect(opened.id);
        assert.equal(item.state, 'pending_user');
        assert.equal(item.authority.nativeApprovals, true);
        assert.match(item.userQuestion!, /synthetic command/);
        assert.doesNotMatch(item.userQuestion!, /threadId|turnId|itemId|availableDecisions/);
        assert.throws(() => f.approvals.respond(opened.id, { requestId: 'reply-1', text: 'maybe' }), /native_approval_explicit_decision_required/);
        assert.equal(f.interactions.inspect(opened.id).state, 'pending_user');
        const receipt = f.approvals.respond(opened.id, { requestId: 'reply-1', text: '允许本次操作' });
        assert.equal(receipt.fresh, true);
        assert.equal((await opened.response).status, 'approved');
        assert.equal(f.interactions.inspect(opened.id).responseUserMessageId, 'reply-1');
        assert.equal(f.history.list('main-thread').filter(m => m.role === 'user').length, 1);
        assert.equal(f.approvals.respond(opened.id, { requestId: 'reply-1', text: '允许本次操作' }).fresh, false);
        assert.throws(() => f.approvals.respond(opened.id, { requestId: 'reply-1', text: '拒绝本次操作' }), /request_id_conflict/);
    }
    finally {
        f.close();
    }
});
test('main callbacks expire after stop and reject late user decisions', async () => {
    const f = fixture();
    try {
        const opened = f.approvals.open(f.native, f.scope);
        f.expire();
        f.approvals.end('generation-1');
        assert.equal((await opened.response).status, 'cancelled');
        assert.throws(() => f.approvals.respond(opened.id, { requestId: 'late', text: '允许本次操作' }), /interaction_not_live/);
        assert.equal(f.history.list('main-thread').length, 0);
    }
    finally {
        f.close();
    }
});
test('permissions grant only exact requested paths for one turn; no root/session grant', async () => {
    const f = fixture();
    try {
        const opened = f.approvals.open({ ...f.native, method: 'item/permissions/requestApproval', details: { permissions: { fileSystem: { read: ['/synthetic/project'], write: null } } } }, f.scope);
        f.approvals.respond(opened.id, { requestId: 'permitted', text: '允许本次操作' });
        const resolution = await opened.response;
        assert.deepEqual(resolution.decision?.permissions, { fileSystem: { read: ['/synthetic/project'], write: null } });
        const bad = f.approvals.open({ ...f.native, requestId: 2, method: 'item/fileChange/requestApproval', details: { grantRoot: '/' } }, f.scope);
        assert.throws(() => f.approvals.respond(bad.id, { requestId: 'bad', text: '允许本次操作' }), /interaction_approval_unavailable/);
        assert.equal(f.interactions.inspect(bad.id).state, 'pending_user');
        f.approvals.respond(bad.id, { requestId: 'deny', text: '拒绝本次操作' });
        assert.equal((await bad.response).status, 'denied');
    }
    finally {
        f.close();
    }
});
test('failed user receipt persistence cannot release a native action', async () => {
    const f = fixture();
    try {
        const opened = f.approvals.open(f.native, f.scope);
        assert.throws(() => f.approvals.respond(opened.id, { requestId: 'fail', text: '允许本次操作' }, { source: 'synthetic', persist() { throw Error('synthetic_persistence_failed'); } }), /synthetic_persistence_failed/);
        assert.equal(f.interactions.inspect(opened.id).state, 'pending_user');
        assert.equal(f.history.list('main-thread').length, 0);
        f.approvals.end('generation-1');
        assert.equal((await opened.response).status, 'cancelled');
    }
    finally {
        f.close();
    }
});
test('protected native storage cannot be granted through an ancestor, symlink or new child', async () => {
    const f = fixture(), root = mkdtempSync(join(tmpdir(), 'homer-approval-scope-'));
    try {
        const protectedRoot = join(root, 'native');
        mkdirSync(protectedRoot);
        symlinkSync(protectedRoot, join(root, 'alias'));
        const patch = f.approvals.open({ ...f.native, requestId: 99, method: 'item/fileChange/requestApproval', details: { operation: { changes: [{ path: join(root, 'alias', 'protected.txt'), kind: { type: 'add' }, diff: '+synthetic' }] } } }, { ...f.scope, protectedRoots: [protectedRoot] });
        assert.throws(() => f.approvals.respond(patch.id, { requestId: 'protected-patch', text: '允许本次操作' }), /interaction_capability_denied/);
        f.approvals.respond(patch.id, { requestId: 'deny-patch', text: '拒绝本次操作' });
        assert.equal((await patch.response).status, 'denied');
        for (const [index, path] of [root, join(root, 'alias', 'new-file'), join(protectedRoot, 'new-child', 'file')].entries()) {
            const opened = f.approvals.open({ ...f.native, requestId: 100 + index, method: 'item/permissions/requestApproval', details: { permissions: { fileSystem: { write: [path] } } } }, { ...f.scope, protectedRoots: [protectedRoot] });
            assert.throws(() => f.approvals.respond(opened.id, { requestId: 'protected-' + index, text: '允许本次操作' }), /interaction_capability_denied/);
            assert.equal(f.interactions.inspect(opened.id).state, 'pending_user');
            f.approvals.respond(opened.id, { requestId: 'deny-protected-' + index, text: '拒绝本次操作' });
            assert.equal((await opened.response).status, 'denied');
        }
    }
    finally {
        f.close();
        rmSync(root, { recursive: true, force: true });
    }
});
test('single native question accepts ordinary text and validates the native options', async () => { const f = fixture(); try {
    const opened = f.approvals.open({ ...f.native, method: 'item/tool/requestUserInput', kind: 'question', details: { questions: [{ id: 'choice', question: '选择本次输出格式', isOther: false, options: [{ label: '表格' }, { label: '文字' }] }] } }, f.scope);
    assert.equal(f.interactions.inspect(opened.id).userQuestion, '选择本次输出格式\n可选：表格、文字');
    assert.throws(() => f.approvals.respond(opened.id, { requestId: 'bad-answer', text: '图片' }), /interaction_answer_scope/);
    f.approvals.respond(opened.id, { requestId: 'answer', text: '表格' });
    assert.deepEqual((await opened.response).decision?.answers, { choice: ['表格'] });
}
finally {
    f.close();
} });
test('new host cannot reconstruct live callbacks or replay an old pending approval', async () => { const f = fixture(); try {
    const opened = f.approvals.open(f.native, f.scope);
    const restarted = new WorkerInteractions(f.db);
    restarted.reconcile();
    const replacement = new MainNativeApprovals(restarted, f.history);
    assert.throws(() => replacement.respond(opened.id, { requestId: 'after-restart', text: '允许本次操作' }), /interaction_not_live/);
    f.approvals.end('generation-1');
    assert.equal((await opened.response).status, 'expired');
}
finally {
    f.close();
} });
test('model-facing interaction helpers cannot approve the main agent own pending request', async () => { const f = fixture(); try {
    const opened = f.approvals.open(f.native, f.scope);
    assert.throws(() => f.interactions.respond(opened.id, { action: 'approve', reason: 'Synthetic attempted model self approval' }, { userMessageId: f.scope.sourceRequestId, userText: f.scope.userText }), /main_native_user_decision_required/);
    assert.equal(f.interactions.inspect(opened.id).state, 'pending_user');
    assert.equal(f.history.list(f.scope.threadId).length, 0);
    f.approvals.respond(opened.id, { requestId: 'real-user-decision', text: '拒绝本次操作' });
    assert.equal((await opened.response).status, 'denied');
}
finally {
    f.close();
} });

test('native network requests reach the user and models cannot approve them',async()=>{
 const f=fixture();try{
  const opened=f.approvals.open({...f.native,method:'item/permissions/requestApproval',details:{permissions:{network:{enabled:true}},reason:'Synthetic public network request'}},f.scope);
  assert.equal(f.interactions.inspect(opened.id).state,'pending_user');
  assert.throws(()=>f.interactions.respond(opened.id,{action:'approve',reason:'forged model'},{userMessageId:'forged'}),/main_native_user_decision_required/);
  f.approvals.respond(opened.id,{requestId:'synthetic-human',text:'允许本次操作'});
  assert.equal((await opened.response).status,'approved');
 }finally{f.close();}
});

test('worker native approval records the real user decision in the existing main conversation',async()=>{
 const f=fixture();try{
  const scope={...f.scope,threadId:'worker-thread',turnId:'worker-turn',generationId:'worker-native:run-1',historyThreadId:'main-thread'};
  const opened=f.approvals.open({...f.native,threadId:scope.threadId,turnId:scope.turnId},scope);
  f.approvals.respond(opened.id,{requestId:'worker-user-decision',text:'拒绝本次操作'});
  assert.equal((await opened.response).status,'denied');
  assert.equal(f.history.list('main-thread').filter(m=>m.role==='user').length,1);
  assert.equal(f.history.list('worker-thread').length,0);
  assert.equal(f.interactions.inspect(opened.id).threadId,'worker-thread');
 }finally{f.close();}
});

test('ordinary MCP summary is bounded, locally redacted and never stores raw arguments',async()=>{
 const f=fixture();try{
  const raw={target:'https://user:SENSITIVE_USERINFO@example.test/send?token=SENSITIVE_QUERY&recipient=alice',api_key:'SENSITIVE_KEY',headers:{Authorization:'SENSITIVE_HEADER'},body:'public operation',unused:'x'.repeat(5000)};
  const native={...f.native,method:'mcpServer/elicitation/request',details:{mode:'form',serverName:'arbitrary-alpha',message:'Run the proposed operation',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:raw,tool_params_display:[{name:'target',display_name:'Target',value:raw.target},{name:'api_key',display_name:'Key',value:raw.api_key},{name:'body',display_name:'Body',value:raw.body}]}}};
  const opened=f.approvals.open(native,f.scope),item=f.interactions.inspect(opened.id);
  assert.match(item.userQuestion!,/recipient=alice/);assert.match(item.userQuestion!,/public operation/);
  assert.doesNotMatch(JSON.stringify(item),/SENSITIVE_|unused|tool_params/);
  assert.equal(native.details._meta.tool_params.api_key,'SENSITIVE_KEY');
  assert.throws(()=>f.interactions.respond(opened.id,{action:'cancel',reason:'forged'},{userMessageId:'forged'}),/main_native_user_decision_required/);
  assert.throws(()=>f.approvals.respond(opened.id,{requestId:'failed-cancel',text:'取消本次请求'},{source:'test',persist(){throw Error('receipt_failed');}}),/receipt_failed/);
  assert.equal(f.interactions.inspect(opened.id).state,'pending_user');
  f.approvals.respond(opened.id,{requestId:'actual-cancel',text:'取消本次请求'});
  assert.equal((await opened.response).decision?.action,'cancel');assert.equal(f.interactions.inspect(opened.id).code,'interaction_user_cancelled');
  assert.equal(f.approvals.respond(opened.id,{requestId:'actual-cancel',text:'取消本次请求'}).fresh,false);
  f.approvals.delivered(native.requestId);assert.ok(f.interactions.inspect(opened.id).deliveredAt);
  f.approvals.end(f.scope.generationId);assert.equal(f.interactions.inspect(opened.id).code,'interaction_user_cancelled');
 }finally{f.close();}
});
test('undelivered user cancel can expire and cannot be replayed after callback loss',async()=>{
 const f=fixture();try{
  const opened=f.approvals.open({...f.native,method:'mcpServer/elicitation/request',details:{serverName:'any',message:'Run',_meta:{codex_approval_kind:'mcp_tool_call'}}},f.scope);
  f.approvals.respond(opened.id,{requestId:'cancel',text:'取消本次请求'});await opened.response;
  f.approvals.invalidated(f.native.requestId,'server_request_cleared');assert.equal(f.interactions.inspect(opened.id).state,'expired');assert.equal(f.interactions.inspect(opened.id).decision?.action,'cancel');assert.equal(f.interactions.inspect(opened.id).code,'server_request_cleared');
  assert.throws(()=>f.approvals.respond(opened.id,{requestId:'late',text:'允许本次操作'}),/interaction_not_live/);
 }finally{f.close();}
});
test('unreviewable MCP summaries fail before any pending card is persisted',()=>{
 const f=fixture();try{
  assert.throws(()=>f.approvals.open({...f.native,method:'mcpServer/elicitation/request',details:{serverName:'any',message:'Run',_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{body:'x'.repeat(5000)}}}},f.scope),/native_approval_review_too_large/);
  assert.equal(f.interactions.list().length,0);
 }finally{f.close();}
});
