import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {edits,verifyVendor,patched,hash} from '../scripts/patch-preview-agentation.mjs';
const root=new URL('../ui/vendor/agentation-3.1.2/',import.meta.url);
test('approved Agentation patch has exact locked inputs, reversible outputs and unchanged license',()=>{
 verifyVendor();
 const statistics=JSON.parse(readFileSync(new URL('patch-statistics.json',root)));
 assert.equal(hash(readFileSync(new URL('index.mjs',root))),statistics.patchedEsmSha256);
 assert.equal(hash(readFileSync(new URL('index.d.ts',root))),statistics.patchedTypesSha256);
 for(const name of Object.keys(edits)){
  const original=readFileSync(new URL('upstream/'+name,root),'utf8');
  let output=readFileSync(new URL(name,root),'utf8');
  assert.equal(patched(name,original),output);
  for(const [before,after] of [...edits[name]].reverse())output=output.replaceAll(after,before);
  assert.equal(output,original);
  assert.throws(()=>patched(name,original+original),/exact unique patch anchor/);
 }
 assert.match(readFileSync(new URL('LICENSE',root),'utf8'),/PolyForm Shield License 1.0.0/);
});
