// Requirements-derived / synthetic fixtures, never production access.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store } from '../src/store.js';
import { WorkerInteractions } from '../src/worker-interactions.js';
import { Files } from '../src/files.js';
import { RecursiveTasks, type Actor, type Contract } from '../src/recursive-tasks.js';
export const main: Actor = { agentId: 'main:synthetic', sourceRequestId: 'user-synthetic' };
export const contract = (kind: Contract['resultKind'] = 'structured'): Contract => ({ goal: 'Check synthetic input without inventing dates', inputs: [{ type: 'material', id: 'sample.md' }], resultKind: kind, acceptance: { criteria: [{ id: 'facts', required: true, description: 'Preserve unknown dates' }] } });
export function fixture(scratch = '.codex/scratch/linear-conversation-timeline-review/regression-runtime') {
  mkdirSync(scratch,{recursive:true});
  const dir = mkdtempSync(join(resolve(scratch),'test-'));
  const store = new Store(join(dir, 'homer.sqlite'));
  new WorkerInteractions(store.db);
  store.startRequest('user-synthetic', 'synthetic-hash');
  const files = new Files(join(dir, 'workspace'));
  const tasks = new RecursiveTasks(store, files);
  tasks.migrate();
  store.setMeta('mainAgentId', main.agentId);
  const root = tasks.createRoot(main, { operationId: 'root', title: 'Synthetic goal', contract: contract('aggregate'), authority: { sourceRequestId: 'user-synthetic', description: 'Synthetic authorized Markdown and structured work only', materials: ['sample.md'], resultIds: [], collaborateTaskIds: [], maxActiveMs: 10000 } });
  return { dir, store, tasks, files, root, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
export function delegate(f: ReturnType<typeof fixture>, id = 'child', parent = f.root.taskId, actor = main, kind: Contract['resultKind'] = 'structured') {
  return f.tasks.delegate(actor, { operationId: id, taskId: parent, version: f.tasks.task(parent).headVersion, expectedTaskRevision: f.tasks.task(parent).revision, contract: contract(kind), dependencies: [] });
}
export function running(f: ReturnType<typeof fixture>, taskId: string): Actor {
  const t = f.tasks.task(taskId), r = f.tasks.claim(t.currentRunId!)!;
  f.tasks.bind(r.id, r.epoch, 'thread-' + r.id, 'turn-' + r.id);
  return { agentId: t.executorAgentId, runId: r.id, epoch: r.epoch, threadId: 'thread-' + r.id, turnId: 'turn-' + r.id };
}
export function complete(f: ReturnType<typeof fixture>, actor: Actor, _taskId: string, _id = 'returned') {
  return f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Checked synthetic input; date remains unknown.'},true)!;
}
export function accept(f: ReturnType<typeof fixture>, taskId: string, resultId: string, actor = main, evidence:Record<string,unknown>={facts:'Synthetic facts inspected'},children:Parameters<typeof f.tasks.review>[1]['children']=[]) {
  const inspected=f.tasks.inspect(actor,{resultId});
  for(const member of inspected.completionResultIds)f.tasks.inspect(actor,{resultId:member});
  const t = f.tasks.task(taskId);
  return f.tasks.review(actor, { operationId: 'review-' + resultId, taskId, version: t.headVersion, expectedTaskRevision: t.revision, resultId, accepted: true, outcome: 'succeeded', reason: 'Synthetic evidence inspected',evidence,children });
}
