import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL('../ui/vendor/assistant-ui/'+name,import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
test('complete ToolFallback stays pinned with only imports, optional Chinese label and Result/Error headings adapted',()=>{
 let source=read('tool-fallback.aui.tsx');
 source=source.replace('from "../task-status/utils"','from "@/lib/utils"').replace('from "./tool-button"','from "@/components/ui/button"').replace('from "./tool-textarea"','from "@/components/ui/textarea"');
 source=source.replace('  label: hostLabel,\n','').replace('  label?: string;\n','').replace('  const label = hostLabel ?? (\n    statusType','  const label =\n    statusType').replace('          : "Used tool");','          : "Used tool";');
 source=source.replace('        结果：','        Result:').replace('const headerText = isCancelled ? "中断原因：" : "错误：";','const headerText = isCancelled ? "Cancelled reason:" : "Error:";');
 assert.equal(hash(source),'2230ad6e2a812242aa5990e58bd9a716aee8916508b805adb4c039f2b1e281ad');
 assert.equal(hash(read('LICENSE')),'eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275');
 assert.equal(hash(read('tool-textarea.tsx').replace('from "../task-status/utils"','from "@/lib/utils"')),'abab274474743d7b6d30e67848e4341c2fbd491a8a300010e5da1176c7f9624f');
});
test('Button uses only the fixed upstream base/default/outline/sm class excerpts without adding cva',()=>{
 const source=read('tool-button.tsx'),base=source.match(/const base="([^"]+)"/)[1],small=source.match(/const small="([^"]+)"/)[1],variants=JSON.parse(source.match(/const variants=(\{[^;]+\});/)[1]);
 assert.equal(hash(JSON.stringify({base,variants,small})),'c9be2dca808e3d4b2ec7365d1e737f215735da7f6a17a324b537b338baca0c4f');
 assert.doesNotMatch(source,/class-variance-authority|\bany\b/);
});
