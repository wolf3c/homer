import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {CommittedDatabase} from '../src/committed-database.js';
import {Schedules, SCHEDULE_SCHEMA, type ScheduleDelivery} from '../src/schedules.js';

const at = (value:string) => Date.parse(value);
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));
function fixture(initial='2026-11-12T00:00:00Z',path=':memory:') {
  const db=new CommittedDatabase(path);
  db.exec(SCHEDULE_SCHEMA);
  db.exec('CREATE TABLE IF NOT EXISTS inbox(deliveryId TEXT PRIMARY KEY,messageId TEXT NOT NULL,scheduledAt INTEGER NOT NULL,text TEXT NOT NULL,sourceRef TEXT NOT NULL)');
  let now=at(initial), changed=0;
  const timers=new Map<object,{fn:()=>void;delay:number}>();
  const transaction=<T>(fn:()=>T):T=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const enqueue=(input:ScheduleDelivery)=>{
    const existing=db.prepare('SELECT messageId FROM inbox WHERE deliveryId=?').get(input.deliveryId);
    if(existing)return String(existing.messageId);
    const messageId='message:'+input.deliveryId;
    db.prepare('INSERT INTO inbox VALUES(?,?,?,?,?)').run(input.deliveryId,messageId,input.scheduledAt,input.text,input.sourceRef);
    return messageId;
  };
  const options={transaction,enqueue,changed:()=>{changed++;},now:()=>now,clock:{
    setTimeout(fn:()=>void,delay:number){const timer={};timers.set(timer,{fn,delay});return timer;},
    clearTimeout(timer:unknown){timers.delete(timer as object);},
  }};
  let schedules=new Schedules(db,options);
  return {db,timers,transaction,options,get schedules(){return schedules;},get changed(){return changed;},
    advance(value:string){now=at(value);},
    restart(){schedules.close();schedules=new Schedules(db,options);schedules.start();},
    inbox(){return db.prepare('SELECT * FROM inbox ORDER BY rowid').all();},
    fire(){const entry=timers.entries().next().value;assert.ok(entry);timers.delete(entry[0]);entry[1].fn();},
    close(){schedules.close();db.close();},
  };
}

test('one-time schedules normalize offset ISO and publish changes only after commit',async()=>{
  const f=fixture();try{
    const schedule=f.transaction(()=>f.schedules.create({text:'Keep this\nmessage',trigger:{at:'2026-11-13T09:00:00+08:00'},sourceRef:'opaque source'}));
    assert.ok('at' in schedule.trigger);assert.equal(schedule.trigger.at,'2026-11-13T01:00:00.000Z');
    assert.equal(schedule.nextFireAt,at('2026-11-13T01:00:00Z'));assert.equal(schedule.revision,1);
    assert.equal(f.changed,0);await flush();assert.equal(f.changed,1);
    assert.throws(()=>f.transaction(()=>{f.schedules.create({text:'Rollback',trigger:{at:'2026-11-14T00:00:00Z'},sourceRef:'other'});throw Error('rollback');}),/rollback/);
    await flush();assert.equal(f.changed,1);assert.equal(f.schedules.list().length,1);
    assert.equal(f.schedules.nearestFireAt(),schedule.nextFireAt);
  }finally{f.close();}
});

test('time and message trust boundaries reject invalid inputs without saving rules',()=>{
  const f=fixture();try{
    for(const trigger of [
      {at:'2026-11-11T00:00:00Z'}, {at:'2026-11-12T00:00:00Z'}, {at:'2026-11-13T01:00:00'},
      {at:'2027-02-29T01:00:00Z'}, {at:'2026-11-13T24:00:00Z'},
      {cron:'0 0 9 * * *',timeZone:'UTC'}, {cron:'0 0 * * *',timeZone:'Invalid/Zone'},
      {cron:'0 0 31 2 *',timeZone:'UTC'}, {cron:'@daily',timeZone:'UTC'},
    ])assert.throws(()=>f.transaction(()=>f.schedules.create({text:'Message',trigger,sourceRef:'source'})),/schedule_/);
    for(const text of ['', '   ', 'a'.repeat(16001)])assert.throws(()=>f.transaction(()=>f.schedules.create({text,trigger:{at:'2026-11-13T00:00:00Z'},sourceRef:'source'})),/schedule_text_invalid/);
    assert.equal(f.schedules.list().length,0);
  }finally{f.close();}
});

test('revision guards update and cancel while re-enabling computes future time',()=>{
  const f=fixture();try{
    const first=f.transaction(()=>f.schedules.create({text:'Daily',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'},sourceRef:'source'}));
    assert.equal(first.nextFireAt,at('2026-11-12T01:00:00Z'));
    assert.throws(()=>f.transaction(()=>f.schedules.update({scheduleId:first.id,expectedRevision:1})),/schedule_empty_update/);
    const cancelled=f.transaction(()=>f.schedules.cancel({scheduleId:first.id,expectedRevision:1}));
    assert.equal(cancelled.enabled,false);assert.equal(cancelled.nextFireAt,null);assert.equal(cancelled.revision,2);
    assert.throws(()=>f.transaction(()=>f.schedules.update({scheduleId:first.id,expectedRevision:1,text:'Stale'})),/schedule_revision_conflict/);
    f.advance('2026-11-15T05:00:00Z');
    const resumed=f.transaction(()=>f.schedules.update({scheduleId:first.id,expectedRevision:2,enabled:true}));
    assert.equal(resumed.nextFireAt,at('2026-11-16T01:00:00Z'));assert.equal(resumed.revision,3);
    const once=f.transaction(()=>f.schedules.create({text:'Once',trigger:{at:'2026-11-16T00:00:00Z'},sourceRef:'source'}));
    const off=f.transaction(()=>f.schedules.cancel({scheduleId:once.id,expectedRevision:1}));
    f.advance('2026-11-17T00:00:00Z');
    assert.throws(()=>f.transaction(()=>f.schedules.update({scheduleId:once.id,expectedRevision:off.revision,enabled:true})),/schedule_time_past/);
    assert.equal(f.schedules.get(once.id).enabled,false);
  }finally{f.close();}
});

test('due one-time input commits with cursor once and leaves source opaque',()=>{
  const f=fixture();try{
    const schedule=f.transaction(()=>f.schedules.create({text:'Deliver to Homer',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'unchanged opaque source'}));
    f.advance('2026-11-12T00:01:00Z');f.schedules.check();f.schedules.check();
    assert.equal(f.inbox().length,1);assert.equal(f.inbox()[0]!.text,'Deliver to Homer');assert.equal(f.inbox()[0]!.sourceRef,'unchanged opaque source');
    assert.equal(f.inbox()[0]!.scheduledAt,at('2026-11-12T00:01:00Z'));
    assert.equal(f.schedules.get(schedule.id).enabled,false);assert.equal(f.schedules.get(schedule.id).revision,2);
    assert.equal(f.schedules.nearestFireAt(),null);
  }finally{f.close();}
});

test('restart catches only the latest missed recurring time and never replays accepted input',()=>{
  const f=fixture();try{
    const daily=f.transaction(()=>f.schedules.create({text:'Daily',trigger:{cron:'0 9 * * *',timeZone:'Asia/Shanghai'},sourceRef:'source'}));
    f.advance('2026-11-16T03:00:00Z');f.restart();
    assert.equal(f.inbox().length,1);assert.equal(f.inbox()[0]!.scheduledAt,at('2026-11-16T01:00:00Z'));
    assert.equal(f.schedules.get(daily.id).nextFireAt,at('2026-11-17T01:00:00Z'));assert.equal(f.schedules.get(daily.id).enabled,true);
    f.restart();f.schedules.check();assert.equal(f.inbox().length,1);
    f.advance('2026-11-17T01:00:00Z');f.schedules.check();assert.equal(f.inbox().length,2);assert.equal(f.inbox()[1]!.scheduledAt,at('2026-11-17T01:00:00Z'));
    f.advance('2026-11-16T01:00:00Z');f.restart();assert.equal(f.inbox().length,2);assert.equal(f.schedules.get(daily.id).nextFireAt,at('2026-11-18T01:00:00Z'));
  }finally{f.close();}
});

test('calendar, day-or-week and daylight-saving boundaries follow pinned Croner dates',()=>{
  const cases:[string,string,string,string][]=[
    ['2027-01-01T00:00:00Z','0 0 29 2 *','UTC','2028-02-29T00:00:00Z'],
    ['2026-11-12T00:00:00Z','0 9 * * MON','Asia/Shanghai','2026-11-16T01:00:00Z'],
    ['2026-11-12T00:00:00Z','0 0 1 * MON','UTC','2026-11-16T00:00:00Z'],
    ['2026-03-08T06:00:00Z','30 2 * * *','America/New_York','2026-03-08T07:00:00Z'],
    ['2026-11-01T04:00:00Z','30 1 * * *','America/New_York','2026-11-01T05:30:00Z'],
    ['2026-11-01T05:30:00Z','30 1 * * *','America/New_York','2026-11-02T06:30:00Z'],
    ['2026-11-01T05:45:00Z','*/30 * * * *','America/New_York','2026-11-01T06:00:00Z'],
  ];
  for(const [now,cron,timeZone,next] of cases){const f=fixture(now);try{
    const schedule=f.transaction(()=>f.schedules.create({text:'Calendar',trigger:{cron,timeZone},sourceRef:'source'}));
    assert.equal(schedule.nextFireAt,at(next),`${cron}, ${now}`);
  }finally{f.close();}}
});

test('corrupt rules are isolated at startup without delivery or blocking healthy rules',async()=>{
  const f=fixture();try{
    const broken=f.transaction(()=>f.schedules.create({text:'Broken',trigger:{cron:'0 9 * * *',timeZone:'UTC'},sourceRef:'broken-source'}));
    const healthy=f.transaction(()=>f.schedules.create({text:'Healthy',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    f.db.prepare('UPDATE schedules SET trigger=? WHERE id=?').run('0 0 31 2 *',broken.id);
    f.schedules.start();const isolated=f.schedules.get(broken.id);
    assert.equal(isolated.enabled,true);assert.equal(isolated.nextFireAt,null);assert.equal(isolated.errorCode,'schedule_no_next_time');assert.equal(isolated.revision,2);
    assert.equal(f.schedules.nearestFireAt(),healthy.nextFireAt);assert.equal(f.inbox().length,0);
    await flush();assert.ok(f.changed>0);
    f.advance('2026-11-12T00:01:00Z');f.schedules.check();assert.equal(f.inbox().length,1);
    const fixed=f.transaction(()=>f.schedules.update({scheduleId:broken.id,expectedRevision:2,trigger:{cron:'0 10 * * *',timeZone:'UTC'}}));
    assert.equal(fixed.errorCode,null);assert.equal(fixed.nextFireAt,at('2026-11-12T10:00:00Z'));
  }finally{f.close();}
});

test('failed inbox append and failed COMMIT both roll back cursor and message together',()=>{
  for(const failure of ['append','commit'] as const){const f=fixture();try{
    const originalEnqueue=f.options.enqueue,originalTransaction=f.options.transaction;
    const schedule=f.transaction(()=>f.schedules.create({text:'Atomic',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    if(failure==='append')f.options.enqueue=input=>{originalEnqueue(input);throw Error('append failure after insert');};
    else {
      f.db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE commit_guard(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)');
      f.options.transaction=fn=>originalTransaction(()=>{const result=fn();f.db.exec('INSERT INTO commit_guard VALUES(1)');return result;});
    }
    f.advance('2026-11-12T00:01:00Z');assert.doesNotThrow(()=>f.schedules.check());
    assert.equal(f.inbox().length,0);assert.equal(f.schedules.get(schedule.id).revision,1);assert.equal(f.schedules.get(schedule.id).nextFireAt,at('2026-11-12T00:01:00Z'));
    f.options.enqueue=originalEnqueue;f.options.transaction=originalTransaction;f.schedules.check();f.restart();
    assert.equal(f.inbox().length,1);assert.equal(f.schedules.get(schedule.id).revision,2);
  }finally{f.close();}}
});

test('capacity refusal is bounded and rotates past a full batch of rejected rules',async()=>{
  const f=fixture();try{
    const schedules=f.transaction(()=>Array.from({length:40},(_,index)=>f.schedules.create({text:'Message '+index,trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}))).sort((a,b)=>a.id.localeCompare(b.id));
    const rejected=new Set(schedules.slice(0,32).map(schedule=>schedule.id)),enqueue=f.options.enqueue;
    let attempts=0;f.options.enqueue=input=>{attempts++;if(rejected.has(input.scheduleId))throw Error('inbox_capacity');return enqueue(input);};
    f.schedules.start();await flush();f.advance('2026-11-12T00:01:00Z');f.schedules.check();
    assert.equal(attempts,32);assert.equal(f.inbox().length,0);assert.equal(f.timers.size,1);assert.ok([...f.timers.values()][0]!.delay>=1000);
    f.schedules.check();assert.equal(f.inbox().length,8);assert.ok(attempts<=64);
    assert.equal(f.schedules.get(schedules[0]!.id).revision,1);
    const cancelled=f.transaction(()=>f.schedules.cancel({scheduleId:schedules[0]!.id,expectedRevision:1}));assert.equal(cancelled.enabled,false);
    f.options.enqueue=enqueue;f.schedules.check();f.schedules.check();assert.equal(f.inbox().length,39);
    await flush();assert.equal(f.timers.size,0);
  }finally{f.close();}
});

test('empty idle hosts do not poll and close removes the single timer and observer',async()=>{
  const f=fixture();try{
    f.schedules.start();await flush();assert.equal(f.timers.size,0);
    f.transaction(()=>f.schedules.create({text:'Future',trigger:{at:'2026-11-13T00:00:00Z'},sourceRef:'source'}));
    await flush();assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0]!.delay,60000);
    f.schedules.check();f.schedules.check();assert.equal(f.timers.size,1);
    f.schedules.close();const changed=f.changed;assert.equal(f.timers.size,0);
    f.db.prepare('UPDATE schedules SET text=?').run('After close');await flush();assert.equal(f.changed,changed);
  }finally{f.close();}
});

test('future wake candidates bypass overdue cursors without changing delivery facts',()=>{
  const f=fixture();try{
    const once=f.transaction(()=>f.schedules.create({text:'Past once',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    const recurring=f.transaction(()=>f.schedules.create({text:'Recurring',trigger:{cron:'*/5 * * * *',timeZone:'UTC'},sourceRef:'source'}));
    const sooner=f.transaction(()=>f.schedules.create({text:'Sooner',trigger:{at:'2026-11-12T00:07:00Z'},sourceRef:'source'}));
    f.advance('2026-11-12T00:06:00Z');const before=[once,recurring,sooner].map(s=>f.schedules.get(s.id));
    assert.equal(f.schedules.nearestFireAt(),once.nextFireAt);
    assert.equal(f.schedules.nearestFutureFireAt(),sooner.nextFireAt);
    assert.deepEqual(before.map(s=>f.schedules.get(s.id)),before);assert.equal(f.inbox().length,0);
    f.transaction(()=>f.schedules.cancel({scheduleId:sooner.id,expectedRevision:1}));
    assert.equal(f.schedules.nearestFutureFireAt(),at('2026-11-12T00:10:00Z'));
    f.db.prepare('UPDATE schedules SET trigger=? WHERE id=?').run('broken',recurring.id);
    assert.equal(f.schedules.nearestFutureFireAt(),null);assert.equal(f.schedules.get(recurring.id).revision,1);
  }finally{f.close();}
});

test('early wake, clock jumps and repeated callbacks never deliver early or duplicate',async()=>{
  const f=fixture();try{
    f.transaction(()=>f.schedules.create({text:'Minute',trigger:{cron:'* * * * *',timeZone:'UTC'},sourceRef:'source'}));
    f.schedules.start();await flush();
    f.advance('2026-11-12T00:00:30Z');f.fire();assert.equal(f.inbox().length,0);assert.equal(f.timers.size,1);
    f.advance('2026-11-12T00:03:59.999Z');f.fire();assert.equal(f.inbox().length,1);assert.equal(f.inbox()[0]!.scheduledAt,at('2026-11-12T00:03:00Z'));
    f.advance('2026-11-12T00:04:00Z');f.fire();assert.equal(f.inbox().length,2);assert.equal(f.inbox()[1]!.scheduledAt,at('2026-11-12T00:04:00Z'));
    f.advance('2026-11-12T00:01:00Z');f.schedules.check();f.fire();assert.equal(f.inbox().length,2);assert.ok([...f.timers.values()][0]!.delay<=60000);
  }finally{f.close();}
});

test('shared storage failure retains all rules and recovers through a bounded timer',async()=>{
  const f=fixture();try{
    const original=f.options.transaction;
    const first=f.transaction(()=>f.schedules.create({text:'Storage',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    f.schedules.start();await flush();f.advance('2026-11-12T00:01:00Z');
    f.options.transaction=()=>{throw Error('SQLITE_BUSY');};f.fire();
    assert.equal(f.schedules.get(first.id).errorCode,null);assert.equal(f.schedules.get(first.id).revision,1);assert.equal(f.inbox().length,0);
    assert.equal(f.timers.size,1);assert.ok([...f.timers.values()][0]!.delay>=1000);
    f.options.transaction=original;f.fire();assert.equal(f.inbox().length,1);assert.equal(f.schedules.get(first.id).enabled,false);
    await flush();assert.equal(f.timers.size,0);
  }finally{f.close();}
});

test('reentrant checks and a concurrent revision update cannot append a stale delivery',()=>{
  const f=fixture();try{
    const originalEnqueue=f.options.enqueue,originalTransaction=f.options.transaction;
    const first=f.transaction(()=>f.schedules.create({text:'Old text',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    f.advance('2026-11-12T00:01:00Z');let race=true;
    f.options.transaction=fn=>{
      if(race){race=false;originalTransaction(()=>f.schedules.update({scheduleId:first.id,expectedRevision:1,text:'New text',trigger:{at:'2026-11-12T00:02:00Z'}}));}
      return originalTransaction(fn);
    };
    f.schedules.check();assert.equal(f.inbox().length,0);assert.equal(f.schedules.get(first.id).revision,2);
    f.options.transaction=originalTransaction;f.options.enqueue=input=>{f.schedules.check();return originalEnqueue(input);};
    f.advance('2026-11-12T00:02:00Z');f.schedules.check();assert.equal(f.inbox().length,1);assert.equal(f.inbox()[0]!.text,'New text');
  }finally{f.close();}
});

test('a committed delivery survives reopening SQLite after the wake-up response is lost',()=>{
  const scratch=join(process.cwd(),'.codex/scratch');mkdirSync(scratch,{recursive:true});
  const dir=mkdtempSync(join(scratch,'schedules-restart-')),path=join(dir,'isolated.sqlite');let f=fixture(undefined,path);
  try{
    const first=f.transaction(()=>f.schedules.create({text:'Committed before crash',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    const original=f.options.transaction;f.options.transaction=fn=>{original(fn);throw Error('process exits after COMMIT, before wake');};
    f.advance('2026-11-12T00:01:00Z');f.schedules.check();const messageId=f.inbox()[0]!.messageId;
    f.close();f=fixture('2026-11-13T00:00:00Z',path);f.schedules.start();f.schedules.check();
    assert.equal(f.inbox().length,1);assert.equal(f.inbox()[0]!.messageId,messageId);assert.equal(f.schedules.get(first.id).revision,2);
  }finally{f.close();rmSync(dir,{recursive:true,force:true});}
});

test('ongoing minute delivery retains accepted messages and resumes latest after capacity refusal',()=>{
  const f=fixture();try{
    const first=f.transaction(()=>f.schedules.create({text:'Every minute',trigger:{cron:'* * * * *',timeZone:'UTC'},sourceRef:'source'}));
    const original=f.options.enqueue;let capacity=3;
    f.options.enqueue=input=>{if(f.inbox().length>=capacity)throw Error('inbox_capacity');return original(input);};
    for(const minute of ['01','02','03','04','05']){f.advance('2026-11-12T00:'+minute+':00Z');f.schedules.check();}
    const accepted=f.inbox();assert.equal(accepted.length,3);assert.equal(f.schedules.get(first.id).nextFireAt,at('2026-11-12T00:04:00Z'));assert.equal(f.schedules.get(first.id).revision,4);
    assert.equal(f.schedules.list({enabled:true}).length,1);capacity=4;f.schedules.check();
    assert.deepEqual(f.inbox().slice(0,3),accepted);assert.equal(f.inbox()[3]!.scheduledAt,at('2026-11-12T00:05:00Z'));assert.equal(f.schedules.get(first.id).nextFireAt,at('2026-11-12T00:06:00Z'));
  }finally{f.close();}
});

test('corrupt due rules can be cancelled and invalid no-future replacement is rejected while disabled',()=>{
  const f=fixture();try{
    const first=f.transaction(()=>f.schedules.create({text:'Will corrupt',trigger:{at:'2026-11-12T00:01:00Z'},sourceRef:'source'}));
    f.db.prepare('UPDATE schedules SET trigger=? WHERE id=?').run('invalid',first.id);
    f.advance('2026-11-12T00:01:00Z');f.schedules.check();
    assert.equal(f.schedules.get(first.id).errorCode,'schedule_time_invalid');assert.equal(f.inbox().length,0);
    const disabled=f.transaction(()=>f.schedules.cancel({scheduleId:first.id,expectedRevision:2}));assert.equal(disabled.enabled,false);
    assert.throws(()=>f.transaction(()=>f.schedules.update({scheduleId:first.id,expectedRevision:3,trigger:{cron:'0 0 31 2 *',timeZone:'UTC'}})),/schedule_no_next_time/);
    assert.equal(f.schedules.get(first.id).revision,3);assert.equal(f.schedules.get(first.id).errorCode,'schedule_time_invalid');
  }finally{f.close();}
});
