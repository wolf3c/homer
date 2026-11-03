import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,statSync,symlinkSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {deepseekProfile,deepseekCatalog,materializeDeepSeekCatalog} from '../src/deepseek-model.js';
const config={model:'deepseek-flash',baseUrl:'http://127.0.0.1:9999/v1'};
test('DeepSeek profile has conservative defaults and explicit supported efforts',()=>{
 assert.deepEqual(deepseekProfile(config),{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total',effort:'high',fast:false});
 assert.equal(deepseekProfile({...config,effort:'low'})?.effort,'low');
 assert.throws(()=>deepseekProfile({...config,effort:'medium'}),/invalid_deepseek_effort/);
 assert.equal(deepseekProfile({...config,baseUrl:'https://api.openai.com/v1'}),undefined);
 assert.equal(deepseekProfile({...config,model:'other'}),undefined);
});
test('total compaction defaults match pinned 90 percent capacity without a silent clamp',()=>{
 for(const contextWindow of [32768,100000,272000,1048576]){
  const capacity=Math.floor(contextWindow*.9);
  assert.equal(deepseekProfile({...config,deepseek:{contextWindow}})?.autoCompactTokenLimit,Math.min(250000,capacity));
  assert.equal(deepseekProfile({...config,deepseek:{contextWindow,autoCompactTokenLimit:capacity}})?.autoCompactTokenLimit,capacity);
  assert.throws(()=>deepseekProfile({...config,deepseek:{contextWindow,autoCompactTokenLimit:capacity+1}}),/invalid_deepseek_auto_compact_token_limit/);
 }
 assert.throws(()=>deepseekProfile({...config,deepseek:{autoCompactTokenLimit:250000}}),/invalid_deepseek_auto_compact_token_limit/);
});
test('body_after_prefix retains separate growth limit below 95 percent',()=>{
 assert.equal(deepseekProfile({...config,deepseek:{autoCompactTokenLimitScope:'body_after_prefix'}})?.autoCompactTokenLimit,250000);
 assert.equal(deepseekProfile({...config,deepseek:{autoCompactTokenLimitScope:'body_after_prefix',autoCompactTokenLimit:258399}})?.autoCompactTokenLimit,258399);
 assert.throws(()=>deepseekProfile({...config,deepseek:{autoCompactTokenLimitScope:'body_after_prefix',autoCompactTokenLimit:258400}}),/invalid_deepseek_auto_compact_token_limit/);
});
test('runtime tuning rejects unknown keys and invalid compaction boundaries',()=>{
 for(const deepseek of [{contextWindow:32767},{contextWindow:1048577},{contextWindow:null},{autoCompactTokenLimit:258400},{autoCompactTokenLimit:0},{autoCompactTokenLimitScope:'bad'},{unknown:1},null])
  assert.throws(()=>deepseekProfile({...config,deepseek} as any),/invalid_deepseek/);
 assert.equal(deepseekProfile({...config,deepseek:{contextWindow:1048576,autoCompactTokenLimit:900000,autoCompactTokenLimitScope:'body_after_prefix'}})?.contextWindow,1048576);
});
test('catalog materialization is deterministic, private and refuses symlink targets',()=>{
 const parent=resolve('.codex/scratch/deepseek-adaptation-20261028/catalog-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-'));
 try{
  const path=materializeDeepSeekCatalog(root);assert.equal(materializeDeepSeekCatalog(root),path);
  assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),deepseekCatalog);assert.equal(statSync(path).mode&0o777,0o600);
  rmSync(path);symlinkSync(join(root,'outside'),path);assert.throws(()=>materializeDeepSeekCatalog(root),/invalid_deepseek_catalog_file/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('versioned catalog declares pinned native tool and modality capabilities',()=>{
 const model=deepseekCatalog.models[0]!;
 assert.equal(model.supports_search_tool,true);assert.equal(model.tool_mode,null);
 assert.equal(model.max_context_window,1048576);assert.equal(model.effective_context_window_percent,95);
 assert.deepEqual(model.input_modalities,['text','image']);assert.equal(model.multi_agent_version,'v2');
});

test('retired website aliases are absent from execution profiles and the pinned catalog',()=>{
 for(const model of ['homer-main','homer-worker'])assert.equal(deepseekProfile({...config,model,effort:'max',fast:false}),undefined);
 assert.deepEqual(deepseekCatalog.models.map(model=>model.slug),['deepseek-flash']);
});
