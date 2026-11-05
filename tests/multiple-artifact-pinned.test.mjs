// No engine, config migration or real runtime: only the reviewed schema-owner gate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store,STORE_SCHEMA_VERSION} from '../src/store.ts';
import {Files} from '../src/files.ts';
import {RecursiveTasks} from '../src/recursive-tasks.ts';
import {preparePinned} from '../scripts/pinned-build.mjs';
test('pinned database requires its exact current storage schema owner',()=>{
 const parent=resolve('.codex/scratch/multiple-artifact-implementation');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'pinned-')),path=join(dir,'synthetic.sqlite'),store=new Store(path);
 try{
  new RecursiveTasks(store,new Files(join(dir,'workspace'))).migrate();store.setMeta('mainThread','synthetic-thread');store.close();mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist/pending-items.js'),"export const PENDING_SCHEMA_VERSION='1';");writeFileSync(join(dir,'config.json'),JSON.stringify({workspace:'workspace',runtime:'runtime'}));
  const args={directory:dir,configPath:join(dir,'config.json'),snapshot:path,thread:'synthetic-thread',manifestPath:join(dir,'manifest.json')};
  for(const version of['4','999']){writeFileSync(join(dir,'dist/store.js'),`export const STORE_SCHEMA_VERSION='${version}';`);assert.throws(()=>preparePinned(args),/pinned_schema_unsupported/);}
  writeFileSync(join(dir,'dist/store.js'),`export const STORE_SCHEMA_VERSION='${STORE_SCHEMA_VERSION}';`);
  // This deliberately incomplete build must proceed past ABI validation and fail
  // on its absent dependencies, never create a runnable/approved manifest.
  assert.throws(()=>preparePinned(args),error=>error.code==='ENOENT'&&!error.message.includes('pinned_schema_unsupported'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
