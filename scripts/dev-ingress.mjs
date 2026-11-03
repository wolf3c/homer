// Transport recovery only. The business receipt and queue remain in homer.sqlite.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class IngressJournal {
  constructor(runtime, binding) {
    const directory = join(runtime, 'gateway');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.path = join(directory, 'transport.sqlite');
    this.db = new DatabaseSync(this.path);
    chmodSync(this.path, 0o600);
    try {
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (![0, 1].includes(version)) throw Error('gateway_schema_unsupported');
      this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS transport_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS transport_requests(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT); PRAGMA user_version=1;");
      const prior = this.db.prepare("SELECT value FROM transport_meta WHERE key='binding'").get();
      if (prior && prior.value !== binding) throw Error('gateway_binding_conflict');
      this.db.prepare("INSERT OR IGNORE INTO transport_meta VALUES('binding',?)").run(binding);
    } catch (error) { this.db.close(); throw error; }
  }
  bindContract(contract) {
    const prior = this.db.prepare("SELECT value FROM transport_meta WHERE key='contract'").get();
    if (prior && prior.value !== contract && this.pending().length) throw Error('gateway_pending_contract_review_required');
    this.db.prepare("INSERT OR REPLACE INTO transport_meta VALUES('contract',?)").run(contract);
  }
  get thread() { return this.db.prepare("SELECT value FROM transport_meta WHERE key='thread'").get()?.value; }
  bindThread(thread) {
    const prior = this.db.prepare("SELECT value FROM transport_meta WHERE key='thread'").get();
    if (prior && prior.value !== thread) throw Error('gateway_thread_conflict');
    this.db.prepare("INSERT OR IGNORE INTO transport_meta VALUES('thread',?)").run(thread);
  }
  store(input) {
    const payload = JSON.stringify(input), hash = createHash('sha256').update(payload).digest('hex');
    if (Buffer.byteLength(payload) > 96 * 1024) throw Error('request_too_large');
    const prior = this.db.prepare('SELECT hash,state,error FROM transport_requests WHERE id=?').get(input.requestId);
    if (prior?.state === 'pending' && prior.hash !== hash) throw Error('request_id_conflict');
    if (!prior || prior.state === 'rejected') {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // Rejected attempts are transport receipts, never business identity.
        // Only this explicit call retries; recovery scans pending rows only.
        if (prior) this.db.prepare('DELETE FROM transport_requests WHERE id=?').run(input.requestId);
        if (this.db.prepare('SELECT count(*) n FROM transport_requests').get().n >= 1000) throw Error('gateway_capacity_exceeded');
        this.db.prepare('INSERT INTO transport_requests(id,payload,hash) VALUES(?,?,?)').run(input.requestId, payload, hash);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    return { requestId: input.requestId, transportState: 'stored', accepted: false };
  }
  pending() { return this.db.prepare("SELECT id,payload FROM transport_requests WHERE state='pending' ORDER BY seq").all().map(row => ({ id: row.id, input: JSON.parse(row.payload) })); }
  assertNoPending() { if (this.db.prepare("SELECT 1 FROM transport_requests WHERE state='pending' LIMIT 1").get()) throw Error('desktop_transport_review_required'); }
  rejected() { return this.db.prepare("SELECT id,error FROM transport_requests WHERE state='rejected' ORDER BY seq").all().map(row => ({ requestId: row.id, error: row.error })); }
  receipts(ids) {
    if(!Array.isArray(ids)||ids.length>80||ids.some(id=>typeof id!=='string'||!/^[\w:-]{1,100}$/.test(id)))throw Error('receipt_ids_invalid');
    return ids.flatMap(id=>{const row=this.db.prepare('SELECT id,state,error FROM transport_requests WHERE id=?').get(id);return row?[{requestId:id,state:row.state==='rejected'?'rejected':'gateway_stored',...(row.error?{error:row.error}:{})}]:[];});
  }
  acknowledge(id) { this.db.prepare('DELETE FROM transport_requests WHERE id=?').run(id); }
  reject(id, error) { this.db.prepare("UPDATE transport_requests SET state='rejected',error=?,payload='' WHERE id=?").run(error, id); }
  close() { this.db.close(); }
}
