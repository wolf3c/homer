import test from 'node:test';
import assert from 'node:assert/strict';
import {linearPlanIndex} from '../src/task-status.js';

test('linear plan conversion preserves parallel and ambiguous plan semantics',()=>{
 assert.equal(linearPlanIndex([{step:'done',status:'completed'},{step:'active',status:'inProgress'},{step:'next',status:'pending'}]),1);
 assert.equal(linearPlanIndex([{step:'a',status:'inProgress'},{step:'b',status:'inProgress'}]),null);
 assert.equal(linearPlanIndex([]),null);assert.equal(linearPlanIndex([{step:'a',status:'completed'}]),1);
});
