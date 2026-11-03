import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const result=buildSync({entryPoints:['ui/execution-usage.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
const module={exports:{}};
Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const render=props=>renderToStaticMarkup(React.createElement(module.exports.ExecutionUsage,props));
const usage={costStatus:'estimated',estimatedCostCny:0.025,inputTokens:10000,cachedInputTokens:8000,outputTokens:500,consecutiveCompactions:1};

test('per-turn estimate labels cache as included and never presents an estimate as a supplier bill',()=>{
 const html=render({usage,stale:false});
 assert.match(html,/本轮估算 ¥0\.0250/);assert.match(html,/输入 10,000/);assert.match(html,/含缓存 8,000/);assert.match(html,/输出 500/);
 assert.match(html,/已观测用量/);assert.match(html,/压缩 1 次/);
 assert.doesNotMatch(html,/实付|账单|已停止/);
});
test('unknown cost stays unknown; stale guard evidence does not claim confirmed stopping',()=>{
 const html=render({usage:{...usage,costStatus:'unavailable',estimatedCostCny:null,inputTokens:null,cachedInputTokens:null,outputTokens:null,stopReason:'engine_compaction_loop'},stale:true});
 assert.match(html,/上次记录/);assert.match(html,/费用暂不可估算/);assert.match(html,/已请求停止：连续压缩未取得新结果/);
 assert.doesNotMatch(html,/¥0|输入 0|已停止/);
 assert.match(render({usage:{...usage,stopReason:'engine_cost_limit_reached'}}),/已请求停止：达到本轮费用阈值/);
 assert.equal(render({}), '');
});
