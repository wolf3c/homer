import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, statSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fork} from 'node:child_process';
import {IngressJournal} from '../scripts/dev-ingress.mjs';
import {syntheticHost} from '../scripts/recursive-synthetic-host.ts';
const parent=resolve('.codex/scratch/seamless-update');mkdirSync(parent,{recursive:true});
const runtime=()=>mkdtempSync(join(parent,'transport-'));

test('desktop recovery fence refuses pending transport without changing its stored receipt',()=>{
 const journal=new IngressJournal(runtime(),'synthetic-binding');
 try{
  journal.assertNoPending();
  journal.store({requestId:'old-pending',text:'Synthetic'});
  const before=journal.db.prepare('SELECT * FROM transport_requests').all();
  assert.throws(()=>journal.assertNoPending(),/desktop_transport_review_required/);
  assert.deepEqual(journal.db.prepare('SELECT * FROM transport_requests').all(),before);
 }finally{journal.close();}
});

test('transport commit survives an actual writer crash and retains FIFO, identity and private permissions', async()=>{
 const dir=runtime();
 const child=fork(resolve('tests/fixtures/transport-crash-writer.mjs'),[dir],{stdio:['ignore','ignore','ignore','ipc']});
 await new Promise((accept,reject)=>{child.once('message',accept);child.once('error',reject);child.once('exit',code=>{if(code!==null)reject(Error('writer_exited_before_receipt'));});});
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
 const journal=new IngressJournal(dir,'synthetic-binding');
 try{
  assert.deepEqual(journal.pending().map(r=>r.id),['crash-first','crash-second']);
  assert.equal(journal.store({requestId:'crash-first',text:'Synthetic one'}).accepted,false);
  assert.equal(journal.pending().length,2);
  assert.throws(()=>journal.store({requestId:'crash-first',text:'Changed'}),/request_id_conflict/);
  assert.equal(statSync(journal.path).mode&0o777,0o600);
  assert.equal(statSync(join(dir,'gateway')).mode&0o777,0o700);
 }finally{journal.close();}
});

test('lost business ack retries the original atomic queue receipt without executing twice',async()=>{
 const fixture=syntheticHost(false,true);await fixture.app.start();
 const journal=new IngressJournal(fixture.app.config.runtime,'synthetic-binding');
 const input={requestId:'lost-business-ack',text:'Synthetic single turn'};
 try{
  journal.bindContract('synthetic-contract');journal.bindThread(fixture.app.store.meta('mainThread'));
  journal.store(input);const first=fixture.app.submitMessage(input);
  await fixture.app.idle();
  journal.close(); // Crash after business commit, before clearing transport.
  const recovered=new IngressJournal(fixture.app.config.runtime,'synthetic-binding');
  try{
   const second=fixture.app.submitMessage(recovered.pending()[0].input);
   assert.equal(second.fresh,false);assert.equal(second.replyId,first.replyId);
   recovered.acknowledge(input.requestId);assert.deepEqual(recovered.pending(),[]);
   assert.equal(fixture.app.inputs.list().length,1);assert.equal(fixture.seen.filter(t=>t==='Synthetic single turn').length,1);
   assert.equal(fixture.app.store.db.prepare('SELECT count(*) n FROM conversation_inputs').get().n,1);
  }finally{recovered.close();}
 }finally{await fixture.close();}
});

test('rejection clears protected payload; only an explicit retry may resubmit to the business authority',()=>{
 const journal=new IngressJournal(runtime(),'synthetic-binding');
 try{
  const input={requestId:'bad-quote',text:'Synthetic rejected text'};
  journal.store(input);journal.reject(input.requestId,'quote_source_mismatch');
  assert.deepEqual(journal.pending(),[]);assert.deepEqual(journal.rejected(),[{requestId:input.requestId,error:'quote_source_mismatch'}]);
  assert.equal(readFileSync(journal.path).includes(Buffer.from(input.text)),false);
  journal.store(input);assert.equal(journal.pending().length,1);
  assert.throws(()=>journal.store({...input,text:'Changed'}),/request_id_conflict/);
  journal.reject(input.requestId,'request_id_conflict');
  journal.store({...input,text:'Original business payload'});assert.equal(journal.pending()[0].input.text,'Original business payload');
 }finally{journal.close();}
});

test('pending input fences connection, thread, unknown transport schema and unreviewed schema/tools changes',()=>{
 const dir=runtime(),journal=new IngressJournal(dir,'binding-one');
 journal.bindThread('thread-one');journal.bindContract('contract-one');journal.store({requestId:'review-required',text:'Synthetic'});
 assert.throws(()=>journal.bindThread('thread-two'),/gateway_thread_conflict/);
 assert.throws(()=>journal.bindContract('contract-two'),/gateway_pending_contract_review_required/);
 journal.close();
 assert.throws(()=>new IngressJournal(dir,'binding-two'),/gateway_binding_conflict/);
 const db=new DatabaseSync(join(dir,'gateway/transport.sqlite'));db.exec('PRAGMA user_version=99');db.close();
 assert.throws(()=>new IngressJournal(dir,'binding-one'),/gateway_schema_unsupported/);
});
