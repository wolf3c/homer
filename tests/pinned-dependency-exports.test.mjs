import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {dependencyIdentity} from '../scripts/pinned-build.mjs';

test('dependency inventory includes locked packages without exported entry points',()=>{
 const root=mkdtempSync(resolve('.codex/scratch/pinned-exports-'));
 try{
  const modules=join(root,'node_modules'),pkg=join(modules,'@fixture','native');mkdirSync(pkg,{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({dependencies:{'@fixture/native':'1.0.0'}}));
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/@fixture/native':{version:'1.0.0'}}}));
  writeFileSync(join(modules,'.package-lock.json'),'{}');
  writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'@fixture/native',version:'1.0.0',exports:{'./native.node':'./native.node'}}));
  writeFileSync(join(pkg,'native.node'),'synthetic');
  assert.equal(dependencyIdentity(root).packages[0].name,'@fixture/native');
 }finally{rmSync(root,{recursive:true,force:true});}
});
