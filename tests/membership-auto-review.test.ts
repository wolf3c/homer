import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMemberSelection, memberCatalogPath, memberRuntimeConfig, resolveMemberSelection} from '../src/member-models.js';

const defaults = {main:{model:'gpt-6.1-terra',effort:'medium'},worker:{model:'gpt-6.1-terra',effort:'high'}};
test('both member roles must select listed models and supported efforts', () => {
  const swapped = {main:defaults.worker,worker:defaults.main};
  assert.deepEqual(resolveMemberSelection(swapped),swapped);
  for(const bad of [null,{}, {...swapped,models:[]}, {...swapped,worker:{...swapped.worker,baseUrl:'https://elsewhere.invalid'}},
    {...swapped,worker:{model:'deepseek-flash',effort:'medium'}},{...swapped,worker:{model:'unknown',effort:'high'}},
    {...swapped,worker:{model:'gpt-6.1-terra',effort:'unknown'}}]) {
    assert.equal(isMemberSelection(bad),false);
    assert.deepEqual(resolveMemberSelection(bad),defaults);
  }
  assert.ok(isMemberSelection(resolveMemberSelection(null)));
});
test('native membership catalog supplies actor context, Code Mode and the selectable low-effort reviewer',()=>{
  const {models} = JSON.parse(readFileSync(memberCatalogPath,'utf8'));
  const actor = models.find((entry:{slug:string})=>entry.slug===defaults.main.model);
  const reviewer = models.find((entry:{slug:string})=>entry.slug===actor.auto_review_model_override);
  assert.equal(actor.tool_mode,'code_mode_only');
  assert.equal(reviewer.slug,'gpt-6-luna');
  assert.equal(reviewer.visibility,'list');
  assert.equal(reviewer.tool_mode,'code_mode_only');
  assert.ok(reviewer.supported_reasoning_levels.some((entry:{effort:string})=>entry.effort==='low'));
  const {main,worker} = memberRuntimeConfig(defaults,'https://gateway.invalid');
  assert.equal(main.context.contextWindow,actor.context_window);
  assert.equal(worker.context.autoCompactTokenLimit,actor.auto_compact_token_limit);
  assert.equal(main.baseUrl,'https://gateway.invalid/v1');
});

test('membership selection follows the AMH Responses catalog for both roles',()=>{
  const standard=['low','medium','high','xhigh','max'];
  const groups=[
    {models:['gpt-6-luna','gpt-6-sol','gpt-6.1-terra'],efforts:['none',...standard]},
    {models:['gpt-6-astra','gpt-6.1-sol','gpt-6.2-sol','gpt-6.2-astra'],efforts:standard},
    {models:['deepseek-flash'],efforts:['none','low','high','max']},
  ];
  const catalog=JSON.parse(readFileSync(memberCatalogPath,'utf8')).models;
  assert.deepEqual(catalog.map((entry:{slug:string})=>entry.slug).sort(),groups.flatMap(group=>group.models).sort());
  for(const {models,efforts} of groups)for(const model of models){
    const entry=catalog.find((item:{slug:string})=>item.slug===model);
    assert.deepEqual(entry.supported_reasoning_levels.map((item:{effort:string})=>item.effort),efforts);
    assert.equal(entry.default_reasoning_level,model==='deepseek-flash'?'high':'medium');
    assert.equal(entry.max_context_window,model==='deepseek-flash'?1048576:1050000);
    assert.deepEqual(entry.input_modalities,['text','image']);
    assert.equal(entry.tool_mode,model==='deepseek-flash'?null:'code_mode_only');
    assert.equal(entry.auto_review_model_override,'gpt-6-luna');
    for(const effort of efforts)assert.ok(isMemberSelection({main:{model,effort},worker:{model,effort}}));
    assert.equal(isMemberSelection({main:{model,effort:'ultra'},worker:defaults.worker}),false);
  }
});
