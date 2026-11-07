// Real isolated SQLite and public tool adapter; no engine, model or channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {RecursiveTasks, type Actor} from '../src/recursive-tasks.js';
import {RecursiveTools, RECURSIVE_TOOLS, toolOperationId, validateToolArguments} from '../src/recursive-tools.js';
import {fixture as hostFixture, until} from './fixtures/worker-chat-host.js';

function fixture() {
  const base = resolve('.codex/scratch/chat-architecture-implementation-20261105');
  mkdirSync(base, {recursive: true});
  const dir = mkdtempSync(join(base, 'tools-')), path = join(dir, 'synthetic.sqlite');
  const store = new Store(path), tasks = new RecursiveTasks(store, new Files(join(dir, 'workspace')));
  tasks.migrate();
  store.setMeta('mainAgentId', 'main:tools'); store.setMeta('mainThread', 'thread:main');
  store.startRequest('source:tools', 'synthetic');
  const actor: Actor = {agentId: 'main:tools', threadId: 'thread:main', turnId: 'turn:main', sourceRequestId: 'source:tools', inputMessageId: 'input:tools'};
  const stopped: Record<string, unknown>[] = []; let authorityReads = 0, wakes = 0;
  const effects = {
    rootAuthority: (a: Actor) => { authorityReads++; return {sourceRequestId: a.sourceRequestId!, description: 'Only investigate the synthetic project'}; },
    rootWorkingDirectory: () => tasks.files.workspace,
    wake: () => { wakes++; },
    stop: async (receipt: Record<string, unknown>) => { stopped.push(receipt); return receipt; },
    steer: async (receipt: Record<string, unknown>) => receipt,
  };
  const tools = new RecursiveTools(tasks, effects);
  const create = async () => tasks.createTask(actor,{operationId:'setup',goal:'Investigate without edits',
    authority:{sourceRequestId:actor.sourceRequestId!,description:'Only investigate the synthetic project'}});
  const counts = () => ['tasks', 'runs', 'operations'].map(table => Number(store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n));
  return {dir, path, store, tasks, actor, effects, tools, create, stopped, counts, reads: () => ({authorityReads, wakes}), close() {store.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('v1 to v2 archival inspection separates readable source history from current dispatch authority', async () => {
  const f = hostFixture(), errors: string[] = [], followups: string[] = [];
  const initial = 'Inspect the original synthetic report.', revised = 'Inspect only the revised synthetic report.';
  let taskId = '', checked = false;
  try {
    f.setScript(async (main, text) => {
      try {
        if (text === initial) taskId = (await main.call('task_create', {goal: initial})).taskId;
        else if (text === revised) {
          await assert.rejects(main.call('task_update', {taskId, goal: revised, sourceRequestIds: ['source:initial', 'source:revised']}), /invalid_tool_arguments/);
          await main.call('task_update', {taskId, goal: revised});
          await main.call('task_update', {taskId, action: 'settle', outcome: 'succeeded'});
        } else if (text === 'Archive the completed synthetic review.') {
          assert.equal((await main.call('archive_work', {taskId})).state, 'archived');
        } else if (text.includes('"kind":"task_archived"')) {
          const details = await main.call('work_inspect', {taskId});
          assert.equal(details.task.historyState, 'archived');
          assert.equal(details.version.version, 2);
          assert.equal(details.version.sourceRequestId, 'source:revised');
          assert.deepEqual(details.version.authority, f.app.tasks.authority(taskId, 2));
          assert.deepEqual([details.version.authority.sourceRequestId, ...(details.version.authority.sourceRequestIds ?? [])], ['source:revised']);
          assert.deepEqual(new Set(details.sourceHistoryIds), new Set(['source:initial', 'source:revised']));
          assert.equal(Object.hasOwn(details, 'sourceRequestIds'), false);
          assert.equal(Object.hasOwn(details.version, 'authorityJson'), false);
          assert.equal(typeof f.app.tasks.version(taskId, 2).authorityJson, 'string', 'storage contract is unchanged');
          for (const [sourceRequestId, expected] of [['source:initial', initial], ['source:revised', revised]]) {
            const original = await main.call('work_inspect', {taskId, sourceRequestId});
            assert.equal(original.source.text, expected);
            assert.deepEqual(original.version.authority, details.version.authority);
            assert.deepEqual(original.sourceHistoryIds, details.sourceHistoryIds);
            assert.equal(Object.hasOwn(original, 'sourceRequestIds'), false);
            assert.equal(Object.hasOwn(original.version, 'authorityJson'), false);
          }
          await assert.rejects(main.call('work_inspect', {taskId, sourceRequestId: 'source:unrelated'}), /task_authority_source_denied/);
          const counts = () => ['tasks', 'runs', 'operations'].map(table => Number(f.app.store.db.prepare('SELECT count(*) n FROM ' + table).get()!.n));
          for (const sourceRequestIds of [['source:initial'], ['source:initial', 'source:revised'], ['source:revised'], ['source:unrelated'], ['source:archive']]) {
            const before = counts();
            await assert.rejects(main.call('task_create', {goal: 'Inspect remaining synthetic facts', sourceRequestIds}), /invalid_tool_arguments/);
            assert.deepEqual(counts(), before, 'rejected source selection cannot create work');
          }
          const followup = await main.call('worker_open', {message: 'Read remaining facts within the revised source only'});
          followups.push(followup.taskId);
          checked = true;
        }
        return {status: 'completed', text: 'Synthetic review recorded.'};
      } catch (error) {errors.push(String(error)); throw error;}
    });
    await f.app.start();
    await f.app.message('Unrelated synthetic request.', 'source:unrelated');
    await f.app.message(initial, 'source:initial');
    await f.app.message(revised, 'source:revised');
    await f.app.message('Archive the completed synthetic review.', 'source:archive');
    await until(() => checked || errors.length > 0);
    assert.deepEqual(errors, []);
    await until(() => f.engines.filter(engine => engine.options.role === 'worker' && engine.finish).length === 1);
    assert.equal(f.app.tasks.task(taskId).historyState, 'archived');
    assert.equal(f.app.tasks.runs(taskId).length, 0);
    assert.equal(followups.length, 1);
    for (const id of followups) {
      const authority = f.app.tasks.authority(id, 1);
      assert.deepEqual(new Set([authority.sourceRequestId, ...(authority.sourceRequestIds ?? [])]), new Set(['source:revised']));
      assert.equal(f.app.tasks.runs(id).length, 1);
    }
    for (const worker of f.engines.filter(engine => engine.options.role === 'worker')) worker.finish!({status: 'completed', text: 'Synthetic revised-scope observation.'});
    await f.app.idle();
    assert.deepEqual(errors, []);
  } finally {await f.close();}
});

test('record-only and first-dispatch tools have separate effects', async () => {
  const f = fixture(); try {
    const root = await f.tools.call(f.actor,'task_create',{goal:'Possible later work'},'create') as {taskId:string};
    assert.equal(f.tasks.task(root.taskId).notes,'');
    assert.equal(f.tasks.runs().length,0);
    assert.equal(f.tasks.version(root.taskId,1).authorityJson,null);
    assert.deepEqual(f.reads(),{authorityReads:0,wakes:1});
    await assert.rejects(f.tools.call(f.actor,'worker_open',{taskId:root.taskId,message:'Run uncommissioned work'},'blocked'),/source_denied/);
    const args={message:'Read the build files'};
    const opened=await f.tools.call(f.actor,'worker_open',args,'open') as {taskId:string;workerId:string;runId:string};
    assert.notEqual(opened.taskId,root.taskId);
    assert.equal(opened.workerId,opened.runId);
    assert.equal(f.tasks.run(opened.runId).workingDirectory,f.tasks.files.workspace);
    assert.deepEqual(await f.tools.call(f.actor,'worker_open',args,'open'),opened);
    assert.equal(f.tasks.runs().length,1);
  } finally {f.close();}
});

test('worker tool receives only exact attachment selectors and does not re-prepare on replay',async()=>{
 const f=fixture();try{
  const ref={assetId:'asset-00000000-0000-0000-0000-000000000001',revision:1};
  let prepared=0;
  const tools=new RecursiveTools(f.tasks,{...f.effects,prepareAttachments:(actor,key,inputs,scope)=>{
   prepared++;
   assert.equal(actor.agentId,f.actor.agentId);
   assert.deepEqual(inputs,[ref]);
   assert.equal(f.tasks.operation(key).operationId,scope.operationId);
   assert.ok(scope.messageId.startsWith('message-'));
   return [ref];
  }});
  const args={message:'Read selected source',attachments:[ref]};
  const opened=await tools.call(f.actor,'worker_open',args,'open');
  assert.deepEqual(await tools.call(f.actor,'worker_open',args,'open'),opened);
  const before=f.counts();
  for(const selector of [{path:'/tmp/example',...ref},{assetId:ref.assetId},{revision:1},{}]){
   await assert.rejects(tools.call(f.actor,'worker_open',{...args,attachments:[selector]},'invalid'),/invalid_attachments/);
  }
  assert.deepEqual(f.counts(),before);
  assert.equal(prepared,1);
 }finally{f.close();}
});

test('forged host fields, malformed collections and missing native identity fail before side effects', async () => {
  const f = fixture(); try {
    const before = f.counts();
    for (const extra of [{operationId: 'forged'}, {version: 9}, {epoch: 9}, {expectedTaskRevision: 9}, {agentId: 'host'}, {contract: {goal: 'forged'}}]) {
      await assert.rejects(f.tools.call(f.actor, 'task_create', {goal: 'Synthetic', ...extra}, 'forged'), /invalid_tool_arguments/);
    }
    await assert.rejects(f.tools.call(f.actor, 'worker_open', {taskId: 'any', message: 'Synthetic', resultIds: {}}, 'bad-array'), /invalid_tool_arguments/);
    await assert.rejects(f.tools.call(f.actor, 'task_create', {goal: 'Synthetic'}), /tool_call_identity_required/);
    await assert.rejects(f.tools.call({...f.actor, turnId: undefined}, 'task_create', {goal: 'Synthetic'}, 'missing-turn'), /tool_call_identity_required/);
    assert.deepEqual(f.counts(), before); assert.deepEqual(f.reads(), {authorityReads: 0, wakes: 0});
  } finally {f.close();}
});

test('Workers cannot invoke task or business session management before argument interpretation', async () => {
  const f = fixture(); try {
    const before = f.counts();
    for (const name of RECURSIVE_TOOLS.map(tool => tool.name)) await assert.rejects(f.tools.call({...f.actor, runId: 'run:forged'}, name, {}, 'forged'), /task_main_required/);
    assert.deepEqual(f.counts(), before); assert.deepEqual(f.reads(), {authorityReads: 0, wakes: 0});
  } finally {f.close();}
});

test('native-call replay returns one open receipt; another call with identical text is a distinct session', async () => {
  const f = fixture(); try {
    const root = await f.create(), args = {taskId: root.taskId, message: 'Read the same files'};
    const opened = await f.tools.call(f.actor, 'worker_open', args, 'open') as any;
    const replacement = new RecursiveTools(f.tasks, f.effects);
    assert.deepEqual(await replacement.call(f.actor, 'worker_open', args, 'open'), opened);
    await assert.rejects(replacement.call(f.actor, 'worker_open', {...args, message: 'Different assignment'}, 'open'), /operation_payload_conflict/);
    assert.equal(f.tasks.workers(root.taskId).length, 1);
    const prior = f.tasks.operationsForInput(f.actor, 'input:tools').find(op => op.kind === 'worker_open')!;
    assert.deepEqual(prior.response, opened); assert.equal(prior.details.threadId, 'thread:main');
    await replacement.call(f.actor, 'worker_open', args, 'independent-open');
    assert.equal(f.tasks.workers(root.taskId).length, 2);
  } finally {f.close();}
});

test('a retried notes edit uses the original native receipt after the hidden revision advances', async () => {
  const f = fixture(); try {
    const root = await f.create(), args = {taskId: root.taskId, notes: 'Check both reports'};
    const edited = await f.tools.call(f.actor, 'task_update', args, 'notes');
    assert.deepEqual(await f.tools.call(f.actor, 'task_update', args, 'notes'), edited);
    assert.equal(f.tasks.task(root.taskId).revision, 2);
    await assert.rejects(f.tools.call(f.actor, 'task_update', {...args, notes: 'Different'}, 'notes'), /operation_payload_conflict/);
    assert.equal(f.tasks.task(root.taskId).notes, 'Check both reports');
  } finally {f.close();}
});

test('changing requirements invokes the host stop effect for all affected in-flight sessions', async () => {
  const f = fixture(); try {
    const root = await f.create();
    const a = await f.tools.call(f.actor, 'worker_open', {taskId:root.taskId,message: 'Inspect page'}, 'page') as any;
    const b = await f.tools.call(f.actor, 'worker_open', {taskId:root.taskId,message: 'Inspect build'}, 'build') as any;
    for (const opened of [a, b]) {const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:' + run.id, 'turn:' + run.id);}
    await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, goal: 'Stop the old investigation; only explain existing evidence'}, 'changed-goal');
    assert.equal(f.stopped.length, 1);
    assert.deepEqual(new Set(f.stopped[0]!.targets as string[]), new Set([a.runId, b.runId]));
    assert.ok(f.tasks.run(a.runId).stopRequestedAt); assert.ok(f.tasks.run(b.runId).stopRequestedAt);
    assert.equal(f.tasks.task(root.taskId).controlState, 'stopping');
  } finally {f.close();}
});

test('task controls reject mixed edits and accept settlement with an outcome and optional notes', async () => {
  const f = fixture(); try {
    const root = await f.create(), before = f.counts();
    for (const args of [
      {action: 'pause', goal: 'also change'},
      {action: 'settle'},
      {action: 'settle', outcome: 'succeeded', reason: 'User asked to settle'},
      {outcome: 'succeeded'},
      {sourceRequestIds: ['source:tools'], notes: 'no goal'},
    ]) await assert.rejects(f.tools.call(f.actor, 'task_update', {taskId: root.taskId, ...args}, 'invalid'), /invalid_tool_arguments/);
    assert.deepEqual(f.counts(), before);
    const paused = await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, action: 'pause'}, 'pause') as any;
    assert.equal(paused.state, 'paused'); assert.equal(f.stopped.length, 1);
    await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, action: 'resume'}, 'resume');
    assert.equal(f.tasks.task(root.taskId).state, 'open');
    const notes = 'Only the available evidence was reviewed';
    await f.tools.call(f.actor, 'task_update', {taskId: root.taskId, action: 'settle', outcome: 'partial', notes}, 'settle');
    const settled = f.tasks.task(root.taskId);
    assert.equal(settled.state, 'settled');
    assert.equal(settled.outcome, 'partial');
    assert.equal(settled.notes, notes);
  } finally {f.close();}
});

test('raw replies remain readable and legacy publication entry points reject calls', async () => {
  const f = fixture(); try {
    const root = await f.create(), opened = await f.tools.call(f.actor, 'worker_open', {taskId:root.taskId,message: 'Inspect'}, 'open') as any;
    const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:worker', 'turn:worker');
    const body = 'First paragraph.\n\n' + '证据'.repeat(15000);
    f.tasks.endSegment(run.id, run.epoch, {status: 'completed', text: body, messages: [{itemId: 'native:reply', phase: 'final_answer', text: body}]}, true);
    const reply = f.tasks.inbox(f.actor).find(message => message.kind === 'worker_reply')!;
    const page = await f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId, messageId: reply.id}) as any;
    assert.ok(page.messages[0].text === body.slice(0, 24000), 'first chunk keeps original text'); assert.equal(page.messages[0].nextOffset, 24000);
    const tail = await f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId, messageId: reply.id, offset: 24000}) as any;
    assert.ok(page.messages[0].text + tail.messages[0].text === body, 'chunks preserve the complete original');
    assert.equal(f.tasks.task(root.taskId).state,'open');
    const before=f.counts();
    for(const name of ['accept_result','publish_delivery','read_material','pending_add','write_markdown']){
      await assert.rejects(f.tools.call(f.actor,name,{},'obsolete'),/tool_denied/);
    }
    assert.deepEqual(f.counts(),before);
    await assert.rejects(f.tools.call(f.actor,'work_inspect',{taskId:root.taskId,resultId:'removed'}),/invalid_tool_arguments/);
    await assert.rejects(f.tools.call(f.actor, 'work_inspect', {taskId: root.taskId, sourceRequestId: 'source:foreign'}), /task_authority_source_denied/);
  } finally {f.close();}
});

test('worker_read selects and pages one original native public item through the model interface', async () => {
  const f = fixture(); try {
    await f.create();
    const opened = await f.tools.call(f.actor, 'worker_open', {message: 'Inspect exact public items'}, 'open') as any;
    const run = f.tasks.claim(opened.runId)!; f.tasks.bind(run.id, run.epoch, 'thread:worker', 'turn:worker');
    const body = '原始公开证据'.repeat(6000);
    f.tasks.endSegment(run.id, run.epoch, {status: 'completed', text: 'Aggregate reply', messages: [
      {itemId: 'native:note', phase: 'commentary', text: 'Earlier public note'},
      {itemId: 'native:report', phase: 'final_answer', text: body},
    ]}, true);
    const reply = f.tasks.inbox(f.actor).find(message => message.kind === 'worker_reply')!;
    const query = {workerId: opened.workerId, messageId: reply.id, itemId: 'native:report'};
    const page = await f.tools.call(f.actor, 'worker_read', query) as any;
    assert.equal(page.messages[0].itemId, 'native:report');assert.equal(page.messages[0].text, body.slice(0, 24000));
    assert.equal(page.messages[0].nextOffset, 24000);
    const tail = await f.tools.call(f.actor, 'worker_read', {...query, offset: page.messages[0].nextOffset}) as any;
    assert.equal(page.messages[0].text + tail.messages[0].text, body);assert.equal(tail.messages[0].nextOffset, null);
    const note = await f.tools.call(f.actor, 'worker_read', {...query, itemId: 'native:note'}) as any;
    assert.equal(note.messages[0].text, 'Earlier public note');
    await assert.rejects(f.tools.call(f.actor, 'worker_read', {...query, itemId: 'native:missing'}), /message_not_found/);
    await assert.rejects(f.tools.call(f.actor, 'worker_read', {workerId: opened.workerId, itemId: 'native:report'}), /worker_query_invalid/);
  } finally {f.close();}
});

test('explicit user message requires text or attachments and binds its native operation ID',async()=>{
 const f=fixture();try{
  const ref={assetId:'asset-00000000-0000-0000-0000-000000000001',revision:1};
  const tools=new RecursiveTools(f.tasks,{...f.effects,sendUserMessage:(actor,input)=>({actor:actor.agentId,...input})});
  for(const args of [{},{text:'  '},{text:'',attachments:[]}])await assert.rejects(tools.call(f.actor,'send_user_message',args,'empty'),/invalid_message/);
  const committed=await tools.call(f.actor,'send_user_message',{attachments:[ref]},'send');
  assert.deepEqual(committed,{actor:f.actor.agentId,operationId:toolOperationId(f.actor,'send'),attachments:[ref],text:undefined,taskId:undefined});
 }finally{f.close();}
});

test('schema validation reports trusted paths without copying unknown field names or values', () => {
  const schema = RECURSIVE_TOOLS.find(tool => tool.name === 'worker_send')!.inputSchema;
  let error: unknown;
  try {validateToolArguments({workerId: 'synthetic', message: 'ok', privateSecret: 'do-not-echo'}, schema);} catch (caught) {error = caught;}
  assert.ok(error instanceof Error);
  assert.doesNotMatch(JSON.stringify(error), /privateSecret|do-not-echo/);
  assert.notEqual(toolOperationId({agentId: 'main', threadId: 'a', turnId: 'b'}, 'c'), toolOperationId({agentId: 'main', threadId: 'a', turnId: 'other'}, 'c'));
});
