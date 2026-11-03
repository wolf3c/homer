import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL('../ui/vendor/assistant-ui/'+name,import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
test('standalone Sources retains its pinned complete implementation with declared adaptations only',()=>{
 const source=read('sources.tsx').replace('import "./sources.css";\n\n','').replace('"../task-status/utils"','"@/lib/utils"').replace('"./href"','"../utils/href"')
  .replace('  id?: string | undefined;\n','').replace('<span>引用与链接</span>','<span>Sources</span>')
  .replaceAll('source.id ?? `${source.url ?? source.domain ?? source.title}-${index}`','`${source.url ?? source.domain ?? source.title}-${index}`')
  .replaceAll('\n                  data-source-id={source.id}','').replace('（在新标签页打开）','(opens in a new tab)')
  .replace('import { collapsePanel, mono, paper }','import { collapsePanel, fieldInteractive, mono, paper }')
  .replace('// Exact consumed export from pinned surfaces.tsx; keep other CSS builds unchanged.\nconst fieldInteractive =\n  "bg-foreground/[0.04] transition-colors hover:bg-foreground/[0.07] forced-colors:border dark:bg-foreground/[0.06] dark:hover:bg-foreground/[0.09]";\n\n','');
 assert.equal(hash(source),'c280153e36f1a110f1c3edded3b2f27ad42def391413aa055ede9ac886e354b8');
 assert.equal(hash(read('href.ts')),'3a8038d038b1918ae3f58a61dcd30933633131dda341eb5bea5b6a650b31a912');
});
