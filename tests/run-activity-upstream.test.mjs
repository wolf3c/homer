import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL('../ui/vendor/assistant-ui/'+name,import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
test('Run Activity stays pinned to upstream with only the host utility import adapted',()=>{
 const original=read('run-activity.tsx').replace('"../task-status/utils"','"@/lib/utils"');
 assert.equal(hash(original),'1b838ae6054c2c45535701af231291436e77da1d6215a2c2a80a313de5aaeace');
});
test('official Collapsible is unmodified and uses the authorized exact Base UI dependency',()=>{
 assert.equal(hash(read('collapsible-root.tsx')),'6d3e6d9a776ac9db13448606627c2ef51e5605cacb2f805379ada9b58abe4565');
 const manifest=JSON.parse(readFileSync(new URL('../ui/package.json',import.meta.url),'utf8'));
 assert.equal(manifest.dependencies['@base-ui/react'],'1.8.0');
});
