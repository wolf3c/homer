import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../ui/vendor/assistant-ui/',import.meta.url);
const source=JSON.parse(readFileSync(new URL('model-selector-SOURCE.json',root),'utf8'));
for(const [name,expected]of Object.entries(source.canonicalSha256))test('fixed official '+name+' retains its default component structure and styles',()=>{
 let text=readFileSync(new URL(name+(name==='model-selection'?'.ts':'.tsx'),root),'utf8')
  .replace('\n\nimport "./model-selector.css";','')
  .replace('"../task-status/utils"','"@/lib/utils"')
  .replaceAll('"./model-selection"','"../utils/model-selection"')
  .replace('"./popover"','"@/components/ui/popover"')
  .replace('"./command"','"@/components/ui/command"')
  .replace('没有匹配的模型。','No models found.')
  .replace('        data-slot="model-selector-positioner"\n','')
  .replace('        style={{ zIndex: 102 }}\n','');
 assert.equal(createHash('sha256').update(text).digest('hex'),expected);
});
