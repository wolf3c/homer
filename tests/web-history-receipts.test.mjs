import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {IngressJournal} from '../scripts/dev-ingress.mjs';
test('gateway receipt lookup uses exact identities, never scans payloads or resubmits missing requests',()=>{
 const root=resolve('.codex/scratch/web-history-loading-implementation');mkdirSync(root,{recursive:true});
 const directory=mkdtempSync(join(root,'receipt-test-')),journal=new IngressJournal(directory,'synthetic-receipt-binding');
 try{
  journal.store({requestId:'stored',text:'Synthetic original payload'});journal.store({requestId:'rejected',text:'Synthetic rejected payload'});journal.reject('rejected','synthetic_rejection');
  const prepare=journal.db.prepare.bind(journal.db),before=prepare('SELECT * FROM transport_requests ORDER BY seq').all();
  journal.pending=()=>{throw Error('full_journal_forbidden');};journal.store=()=>{throw Error('resubmit_forbidden');};
  journal.db.prepare=sql=>{assert.equal(sql,'SELECT id,state,error FROM transport_requests WHERE id=?');return prepare(sql);};
  assert.deepEqual(journal.receipts(['stored','rejected','missing']),[{requestId:'stored',state:'gateway_stored'},{requestId:'rejected',state:'rejected',error:'synthetic_rejection'}]);
  assert.deepEqual(journal.receipts([]),[]);assert.throws(()=>journal.receipts(Array(81).fill('stored')),/receipt_ids_invalid/);
  assert.deepEqual(prepare('SELECT * FROM transport_requests ORDER BY seq').all(),before);
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
