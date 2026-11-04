// No engine, config migration or real runtime: only the reviewed schema-owner gate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.ts';
import {preparePinned} from '../scripts/pinned-build.mjs';
test('pinned schema3 database refuses schema2 owner and unknown ABI, while exact schema3 owner passes the ABI gate',()=>{
 const parent=resolve('.codex/scratch/multiple-artifact-implementation');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'pinned-')),path=join(dir,'synthetic.sqlite'),store=new Store(path);
 try{
  store.setMeta('mainThread','synthetic-thread');store.setMeta('recursiveSchemaVersion','3');store.close();mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'config.json'),JSON.stringify({workspace:'workspace',runtime:'runtime'}));
  const args={directory:dir,configPath:join(dir,'config.json'),snapshot:path,thread:'synthetic-thread',manifestPath:join(dir,'manifest.json')};
  for(const version of['2','999']){writeFileSync(join(dir,'dist/recursive-tasks.js'),`export const RECURSIVE_SCHEMA_VERSION='${version}';`);assert.throws(()=>preparePinned(args),/pinned_schema_unsupported/);}
  writeFileSync(join(dir,'dist/recursive-tasks.js'),"export const RECURSIVE_SCHEMA_VERSION='3';");
  // This deliberately incomplete build must proceed past ABI validation and fail
  // on its absent dependencies, never create a runnable/approved manifest.
  assert.throws(()=>preparePinned(args),error=>error.code==='ENOENT'&&!error.message.includes('pinned_schema_unsupported'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
