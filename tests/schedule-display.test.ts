import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {CommittedDatabase} from '../src/committed-database.js';
import {Schedules,SCHEDULE_SCHEMA} from '../src/schedules.js';
import {readScheduleDisplay} from '../src/schedule-display.js';
function fixture(){
 const db=new CommittedDatabase(':memory:');db.exec(SCHEDULE_SCHEMA+`;CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('mainAgentId','main');CREATE TABLE operations(id TEXT,actorAgentId TEXT,scopeId TEXT,kind TEXT,state TEXT,responseJson TEXT);CREATE TABLE agent_messages(id TEXT,senderAgentId TEXT,recipientAgentId TEXT,kind TEXT,operationKey TEXT,payloadJson TEXT);`);
 const now=Date.parse('2026-11-17T10:30:00+08:00'),schedules=new Schedules(db,{transaction:fn=>fn(),enqueue:()=>{throw Error('read_must_not_enqueue');},now:()=>now});
 const scope={threadId:'thread',readEpoch:'epoch',validateSource:(ref:string)=>{if(ref==='denied')throw Error('schedule_scope_denied');if(ref==='outage')throw Error('disk_failure');}};
 const create=(ref='main')=>schedules.create({text:'整理简报。完整说明\n'.repeat(50),trigger:{at:'2026-11-18T09:00:00+08:00'},sourceRef:ref});
 const read=(input:any={readEpoch:'epoch',view:'list'})=>readScheduleDisplay(db,schedules,input,scope,now);
 return {db,schedules,scope,create,read,close(){schedules.close();db.close();}};
}
test('user read lists all authorized creators, filters before pagination, hides private fields and writes nothing',()=>{
 const f=fixture();try{
 const main=f.create(),worker=f.create('worker');f.create('denied');
 const changes=f.db.prepare('SELECT total_changes() n').get()!.n;
 const first=f.read({readEpoch:'epoch',view:'list',limit:1});assert.ok('items' in first);assert.equal(first.items.length,1);assert.equal(first.nextOffset,1);
 const second=f.read({readEpoch:'epoch',view:'list',limit:1,offset:1});assert.ok('items' in second);assert.equal(second.nextOffset,null);assert.deepEqual(new Set([...first.items,...second.items].map(x=>x.scheduleId)),new Set([main.id,worker.id]));
 assert.equal('text' in first.items[0]!,false);assert.equal('sourceRef' in first.items[0]!,false);
 const detail=f.read({readEpoch:'epoch',view:'detail',scheduleId:main.id});assert.ok('item' in detail);assert.equal(detail.item.text,main.text);
 assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n,changes);
 }finally{f.close();}
});
test('disabled is not cancelled, only the current confirmed revision proves cancellation; deliveries mean inbox only',()=>{
 const f=fixture();try{const a=f.create(),b=f.create(),c=f.create();
 f.schedules.cancel({scheduleId:a.id,expectedRevision:1});f.schedules.cancel({scheduleId:b.id,expectedRevision:1});f.schedules.cancel({scheduleId:c.id,expectedRevision:1});
 const op=f.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)');
 op.run('cancel-a','main','schedules','schedule_cancel','confirmed',JSON.stringify({scheduleId:a.id,revision:1}));
 op.run('cancel-b','main','schedules','schedule_cancel','confirmed',JSON.stringify({scheduleId:b.id,revision:2}));
 op.run('delivery','host','scheduled-deliveries','schedule_delivery','confirmed',JSON.stringify({messageId:'inbox'}));
 f.db.prepare('INSERT INTO agent_messages VALUES(?,?,?,?,?,?)').run('inbox','host','main','scheduled_message','delivery',JSON.stringify({threadId:'thread',scheduleId:c.id,scheduledAt:1}));
 const r=f.read();assert.ok('items' in r);const map=new Map(r.items.map(x=>[x.scheduleId,x]));assert.equal(map.get(a.id)!.status,'已停用');assert.equal(map.get(b.id)!.status,'已取消后续投递');assert.equal(map.get(c.id)!.status,'已停用');assert.match(map.get(c.id)!.note,/收件箱/);assert.doesNotMatch(map.get(c.id)!.note,/工作已完成/);
 }finally{f.close();}
});
test('future, overdue, quarantine, missing times and denied details retain honest states; failures do not become empty lists',()=>{
 const f=fixture();try{const future=f.create(),due=f.create(),bad=f.create(),missing=f.create(),hidden=f.create('denied');
 f.db.prepare('UPDATE schedules SET nextFireAt=1 WHERE id=?').run(due.id);f.db.prepare("UPDATE schedules SET errorCode='schedule_cron_invalid',nextFireAt=NULL WHERE id=?").run(bad.id);f.db.prepare('UPDATE schedules SET trigger=?,nextFireAt=1 WHERE id=?').run(JSON.stringify({cron:'invalid',timeZone:'Invalid/Zone'}),bad.id);f.db.prepare('UPDATE schedules SET nextFireAt=NULL WHERE id=?').run(missing.id);
 const r=f.read();assert.ok('items' in r);const map=new Map(r.items.map(x=>[x.scheduleId,x.status]));assert.equal(map.get(future.id),'已启用');assert.equal(map.get(due.id),'到期待投递');assert.equal(map.get(bad.id),'规则异常');assert.equal(map.get(missing.id),'状态待核对');
 assert.throws(()=>f.read({readEpoch:'epoch',view:'detail',scheduleId:hidden.id}),/schedule_unavailable/);
 assert.throws(()=>f.read({readEpoch:'other',view:'list'}),/history_epoch_changed/);assert.throws(()=>f.read({readEpoch:'epoch',view:'list',owner:'other'}),/schedule_query_invalid/);assert.throws(()=>f.read({readEpoch:'epoch',view:'list',limit:101}),/schedule_query_invalid/);
 f.create('outage');assert.throws(()=>f.read(),/disk_failure/);
 }finally{f.close();}
});


test('SpecSheet keeps the pinned official rendering source with only local import paths',()=>{
 const source=readFileSync(new URL('../ui/vendor/assistant-ui/spec-sheet.tsx',import.meta.url),'utf8').replace('"../task-status/utils"','"@/lib/utils"').replace('"./range"','"../utils/range"');
 assert.equal(createHash('sha256').update(source).digest('hex'),'0ab461c178f93d65f2fe858867381a7fe0cc7b167f7c4b8e7fe2fa2e917d9c31');
});
