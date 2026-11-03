import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {IngressJournal} from '../scripts/dev-ingress.mjs';
const root=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/annotation-composer-sync-implementation-20261025/transport');
const refs=[{kind:'text',source:{kind:'artifact',id:'result-synthetic',sha256:'a'.repeat(64),title:'Synthetic.txt'},annotations:[{id:'one',text:'Source',comment:'User intent'}]}];
test('journal retains plural and unknown fields byte-for-byte and never rebinds a pending contract',()=>{
 mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'journal-')),journal=new IngressJournal(directory,'synthetic-binding');
 try{
  journal.bindContract('original-contract');journal.bindThread('synthetic-thread');
  const input={requestId:'unknown-receipt',text:'Body',resourceReferences:refs,futureField:{order:[3,1,2],escaped:'line\nquote"'}};
  journal.store(input);const payload=journal.db.prepare('SELECT payload FROM transport_requests WHERE id=?').get(input.requestId).payload;
  assert.equal(payload,JSON.stringify(input));assert.deepEqual(journal.pending()[0].input,input);
  assert.throws(()=>journal.bindContract('new-contract'),/gateway_pending_contract_review_required/);
  assert.throws(()=>journal.store({...input,resourceReferences:[]}),/request_id_conflict/);
  journal.store(input);assert.equal(journal.db.prepare('SELECT payload FROM transport_requests WHERE id=?').get(input.requestId).payload,payload);
  assert.deepEqual(journal.pending()[0].input,input);
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
test('gateway enforces exactly 96KiB in UTF-8 bytes without truncation',()=>{
 mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'bytes-')),journal=new IngressJournal(directory,'synthetic-binding');
 try{
  const input={requestId:'bytes',text:''},overhead=Buffer.byteLength(JSON.stringify(input));
  input.text='x'.repeat(96*1024-overhead);journal.store(input);
  assert.equal(Buffer.byteLength(JSON.stringify(journal.pending()[0].input)),96*1024);
  assert.throws(()=>journal.store({requestId:'too-large',text:'中'.repeat(32768)}),/request_too_large/);
  assert.throws(()=>journal.store({...input,text:input.text+'x'}),/request_too_large/);
  assert.equal(journal.pending().length,1);
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
