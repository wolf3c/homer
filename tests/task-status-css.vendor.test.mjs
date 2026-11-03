import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base=new URL('../ui/vendor/task-status/',import.meta.url);
test('official task status components retain upstream structure outside the documented semantic status inputs',()=>{
 const sources=JSON.parse(readFileSync(new URL('SOURCE-SHA256.json',base),'utf8'));
 for(const [name,expected]of Object.entries(sources)){
  let source=readFileSync(new URL(name,base),'utf8').replaceAll('./utils','@/lib/utils').replaceAll('from "./range"','from "../utils/range"').replaceAll('from "./useIsomorphicLayoutEffect"','from "../utils/useIsomorphicLayoutEffect"');
  if(name==='task-card.tsx')source=source.replace('  statusIcon,\n  statusLabel,\n','').replace('  statusIcon?: ReactNode;\n  statusLabel?: string;\n','').replace('{statusIcon ?? <TaskStateIcon state={state} />}','<TaskStateIcon state={state} />').replace('{statusLabel ?? state}','{state}');
  assert.equal(createHash('sha256').update(source).digest('hex'),expected,name);
 }
});
