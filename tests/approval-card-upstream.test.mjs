import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL('../ui/vendor/assistant-ui/'+name,import.meta.url),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
test('ApprovalCard retains pinned upstream DOM, geometry and states with explicit host-only adaptations',()=>{
 let s=read('approval-card.tsx').replace('"../task-status/utils"','"@/lib/utils"').replace('\nimport "./approval-card.css";','');
 s=s.replace('  disabled = false,\n','').replace('  subtitle: ReactNode;','  subtitle: string;').replace('  disabled?: boolean | undefined;\n','').replaceAll('                disabled={disabled}\n','').replace('            {statusLabel && <span role="status" className="text-muted-foreground text-xs">{statusLabel}</span>}\n','');
 s=s.replace('  reviewDetails,\n','').replace('  | "reviewDetails"\n','').replace('  reviewDetails?: ReactNode;\n','').replace('  description?: ReactNode;','  description?: string | undefined;').replace('      {reviewDetails}\n\n','');
 assert.equal(hash(s),'a6b9797c48a965d629af628b8e8a9a4102ce9c6d7b2ca2f9ead75676223dcdef');
 assert.equal(hash(read('receipt-focus.ts').replace('import { useLayoutEffect as useIsomorphicLayoutEffect } from "react";','import { useIsomorphicLayoutEffect } from "../utils/useIsomorphicLayoutEffect";')),'0be780a30c042bbb41b6c0621d76ef8506ebe92011ebf36cd5d9e77fb7fd6ec0');
 assert.equal(hash(read('LICENSE')),'eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275');
});
