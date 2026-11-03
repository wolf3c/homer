import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL('../ui/vendor/assistant-ui/'+name,import.meta.url),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
test('Canvas document and body retain the exact pinned official implementations',()=>{
 const source=read('canvas-split.tsx');
 const document=source.slice(source.indexOf('export function CanvasSplitDocument'),source.indexOf('// Read-only files')).trimEnd()+'\n';
 const body=source.slice(source.indexOf('export function CanvasSplitBody')).trimEnd()+'\n';
 assert.equal(hash(document),'90ad097982f5282ba45c0e7ae1a2d69215f13dc9445d489bdd143cc4d7a5e9ab');
 assert.equal(hash(body),'966f196043dfa8ea1da74e5cf6457d9cc62f7b71db96571332ba5f2733269e39');
});
test('WebPreview remains the complete official component with local imports and Chinese labels',()=>{
 const source=read('web-preview.tsx').replace('"../task-status/utils"','"@/lib/utils"')
  .replace('import { field, ghostButton, mono, paper } from "./surfaces";\nimport { ShimmerLabel } from "../task-status/surfaces";\nimport "./canvas-split.css";','import { field, ghostButton, mono, paper, ShimmerLabel } from "./surfaces";')
  .replace('重新加载预览','Reload the preview').replace('在新标签页打开预览','Open the preview in a new tab').replace('正在加载预览','Loading preview');
 assert.equal(hash(source),'aa8e24257fe85d232b578799ef175adc563ebd12a2d2851fc3acd6fe5cc9cad9');
});
