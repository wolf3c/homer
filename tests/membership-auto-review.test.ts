import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMemberSelection, memberCatalogPath, memberRuntimeConfig, resolveMemberSelection} from '../src/member-models.js';

const defaults = {main:{model:'gpt-6.1-terra',effort:'medium'},worker:{model:'gpt-6.1-terra',effort:'high'}};
test('both member roles must select listed models and supported efforts', () => {
  const swapped = {main:defaults.worker,worker:defaults.main};
  assert.deepEqual(resolveMemberSelection(swapped),swapped);
  for(const bad of [null,{}, {...swapped,models:[]}, {...swapped,worker:{...swapped.worker,baseUrl:'https://elsewhere.invalid'}},
    {...swapped,worker:{model:'gpt-6-luna',effort:'low'}},{...swapped,worker:{model:'unknown',effort:'high'}},
    {...swapped,worker:{model:'gpt-6.1-terra',effort:'unknown'}}]) {
    assert.equal(isMemberSelection(bad),false);
    assert.deepEqual(resolveMemberSelection(bad),defaults);
  }
  assert.ok(isMemberSelection(resolveMemberSelection(null)));
});
test('native membership catalog supplies actor context, Code Mode and the hidden low-effort reviewer',()=>{
  const {models} = JSON.parse(readFileSync(memberCatalogPath,'utf8'));
  const actor = models.find((entry:{slug:string})=>entry.slug===defaults.main.model);
  const reviewer = models.find((entry:{slug:string})=>entry.slug===actor.auto_review_model_override);
  assert.equal(actor.tool_mode,'code_mode_only');
  assert.equal(reviewer.slug,'gpt-6-luna');
  assert.equal(reviewer.visibility,'hide');
  assert.equal(reviewer.tool_mode,'code_mode_only');
  assert.ok(reviewer.supported_reasoning_levels.some((entry:{effort:string})=>entry.effort==='low'));
  const {main,worker} = memberRuntimeConfig(defaults,'https://gateway.invalid');
  assert.equal(main.context.contextWindow,actor.context_window);
  assert.equal(worker.context.autoCompactTokenLimit,actor.auto_compact_token_limit);
  assert.equal(main.baseUrl,'https://gateway.invalid/v1');
});
