import {test} from 'node:test';
import assert from 'node:assert/strict';
import {membershipModelCatalog} from '../src/model-catalog.js';

const capabilities={inputModalities:['text'] as ('text'|'image')[],reasoningEfforts:['high'],webSearch:false,toolSearch:false};
test('membership review selects hidden Luna without altering the parent model',()=>{
 const ordinary=membershipModelCatalog('member-model','high',512000,capabilities);
 const catalog=membershipModelCatalog('member-model','high',512000,capabilities,true);
 assert.equal(catalog.models[0]!.auto_review_model_override,'gpt-6-luna');
 assert.deepEqual({...catalog.models[0],auto_review_model_override:undefined},{...ordinary.models[0],auto_review_model_override:undefined});
 const reviewer=catalog.models[1]!;
 assert.equal(reviewer.slug,'gpt-6-luna');assert.equal(reviewer.visibility,'hide');
 assert.equal(reviewer.tool_mode,'code_mode_only');assert.equal(reviewer.supported_in_api,true);
 assert.ok(reviewer.supported_reasoning_levels.some(item=>item.effort==='low'));
 assert.deepEqual(reviewer.input_modalities,['text','image']);
});
test('Luna parent remains one model with the original role settings',()=>{
 const ordinary=membershipModelCatalog('gpt-6-luna','high',512000,capabilities);
 const catalog=membershipModelCatalog('gpt-6-luna','high',512000,capabilities,true);
 assert.equal(catalog.models.length,1);
 assert.deepEqual(catalog.models[0],{...ordinary.models[0],auto_review_model_override:'gpt-6-luna'});
});
test('other catalog callers acquire no reviewer or override',()=>{
 const catalog=membershipModelCatalog('member-model','high',512000,capabilities);
 assert.equal(catalog.models.length,1);assert.equal(catalog.models[0]!.auto_review_model_override,undefined);
});
