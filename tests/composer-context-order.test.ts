import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ContextOrder,contextKey} from '../ui/composer-context-order.ts';

test('tracks mixed insertion order, preserves edits and appends after removal',()=>{
 const o=new ContextOrder();const r=contextKey('ref','doc','1'),a=contextKey('attachment','upload-1'),q=contextKey('quote','q1');
 o.reconcile('ref',[r]);o.reconcile('attachment',[a]);o.reconcile('quote',[q]);o.reconcile('ref',[r,contextKey('ref','doc','2')]);
 assert.deepEqual(o.snapshot(),[r,a,q,contextKey('ref','doc','2')]);
 o.reconcile('ref',[contextKey('ref','doc','2')]);o.reconcile('ref',[contextKey('ref','doc','2'),r]);
 assert.deepEqual(o.snapshot(),[a,q,contextKey('ref','doc','2'),r]);
});
test('rekeys confirmed uploads, preserves stored order on restore and discards invalid stale keys',()=>{
 const o=new ContextOrder();const q=contextKey('quote','q1'),temp=contextKey('attachment','temp'),asset=contextKey('attachment','asset');
 o.reconcile('quote',[q]);o.reconcile('attachment',[temp]);o.rename(temp,asset);
 const saved=o.snapshot();const restored=new ContextOrder(saved);
 restored.reconcile('attachment',[asset]);restored.reconcile('quote',[q]);
 assert.deepEqual(restored.snapshot(),[q,asset]);
 restored.reconcile('attachment',[]);assert.deepEqual(restored.snapshot(),[q]);
});
