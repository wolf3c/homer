import {test} from 'node:test';import assert from 'node:assert/strict';
import {HistoryWindow} from '../ui/history-window.js';
import type {HistoryPage} from '../src/web-history-pages.js';
const page=(n:number,revision=1):HistoryPage=>({protocol:3 as const,threadId:'t',revision,units:['u'+n],messages:[{id:'u'+n,threadId:'t',requestId:null,role:'assistant' as const,text:'合成'+n,status:'completed' as const,createdAt:n}],queue:[],before:'before'+n,after:'after'+n,orderWarning:undefined});
const state=(n:number,revision=1)=>({threadId:'t',messages:page(n).messages,isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'},history:{protocol:3 as const,readEpoch:'epoch',page:page(n,revision),moreQueue:null,moreInteractions:null}});
const rangePage=(a:number,b:number,revision=1)=>({...page(a,revision),units:Array.from({length:b-a+1},(_,i)=>'u'+(a+i)),messages:Array.from({length:b-a+1},(_,i)=>page(a+i).messages[0]!),after:'after'+b});
test('snapshot and detached range expose each public message identity only once',()=>{
 const cache=new HistoryWindow(),initial=state(10),latest={...initial.messages[0]!,text:'updated'};
 initial.messages.push(latest);cache.snapshot(initial);assert.deepEqual(cache.messages,[latest]);
 const around=page(2),updated={...around.messages[0]!,text:'updated around'};around.messages.push(updated);
 cache.add(around,'epoch','around');assert.equal(cache.archived,true);assert.deepEqual(cache.messages,[updated]);
});
test('a page newer than the snapshot must also include its known later continuation',async()=>{
 for(const emptyLast of [false,true]){
  const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');let calls=0;
  const complete=await cache.fillTail(async()=>{calls++;return calls===1?rangePage(3,12,2):emptyLast?{...page(12,2),units:[],messages:[],after:null}:{...rangePage(13,15,2),after:null};},()=>true,()=>{});
  assert.equal(complete,true);assert.equal(calls,2);assert.equal(cache.archived,false);assert.equal(cache.messages.at(-1)?.id,emptyLast?'u12':'u15');
 }
});
test('late suffix responses cannot change a cancelled, replaced or reset range',async()=>{
 for(const mode of ['cancel','around','epoch']){
  const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');let active=true,release!:(value:ReturnType<typeof page>)=>void;
  const filling=cache.fillTail(()=>new Promise(done=>{release=done;}),()=>active,()=>assert.fail('late response published'));
  if(mode==='cancel')active=false;
  if(mode==='around')cache.add(page(1),'epoch','around');
  if(mode==='epoch')cache.reset('new-epoch','t');
  const expected=cache.messages.map(m=>m.id);release(page(3));assert.equal(await filling,false);assert.deepEqual(cache.messages.map(m=>m.id),expected);
 }
});
test('repeated suffix boundaries and permission errors stop after one read',async()=>{
 for(const denied of [false,true]){
  const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');let calls=0;
  await assert.rejects(cache.fillTail(async()=>{calls++;if(denied)throw Error('history_scope_denied');return page(2);},()=>true,()=>assert.fail('unadvanced page published')),denied?/history_scope_denied/:/history_cursor_invalid/);
  assert.equal(calls,1);assert.equal(cache.archived,true);assert.deepEqual(cache.messages.map(m=>m.id),['u2']);
 }
});
test('an empty or terminal page cannot hide a known disconnected latest snapshot',async()=>{
 for(const empty of [true,false]){
  const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');let calls=0;
  await assert.rejects(cache.fillTail(async()=>{calls++;return {...page(3),units:empty?[]:['u3'],messages:empty?[]:page(3).messages,after:null};},()=>true,()=>{}),/history_cursor_invalid/);
  assert.equal(calls,1);assert.equal(cache.archived,true);assert.equal(cache.recent?.messages[0]?.id,'u10');assert.ok(!cache.messages.some(m=>m.id==='u10'));
 }
});
test('automatic suffix fill uses bounded batches and never joins across a gap',async()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');let calls=0,published=0;
 const batches=[rangePage(3,5),rangePage(6,8),rangePage(9,10)];
 assert.equal(await cache.fillTail(async request=>{assert.equal(request.limit,80);assert.equal(request.after,'after'+[2,5,8][calls]);return batches[calls++]!;},()=>true,()=>{published++;assert.equal(cache.archived,calls<3);}),true);
 assert.equal(calls,3);assert.equal(published,3);assert.deepEqual(cache.messages.map(m=>m.id),Array.from({length:9},(_,i)=>'u'+(i+2)));
});
test('a disjoint recent snapshot resolves its last loaded unit before filling forward',async()=>{
 const cache=new HistoryWindow(),initial=state(10);initial.history.page.after=null;cache.snapshot(initial);cache.snapshot(state(20,2));let calls=0;
 assert.equal(await cache.fillTail(async request=>{calls++;if(calls===1){assert.deepEqual(request,{around:'u10',limit:1});return page(10,2);}assert.deepEqual(request,{after:'after10',limit:80});return rangePage(11,20,2);},()=>true,()=>{}),true);
 assert.equal(calls,2);assert.deepEqual(cache.messages.map(m=>m.id),Array.from({length:11},(_,i)=>'u'+(i+10)));
});
test('recent snapshots retain the loaded suffix, reuse stable messages and reject slow page/epoch',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));const original=cache.messages[0];cache.snapshot(state(10));assert.equal(cache.messages[0],original);
 assert.equal(cache.add(page(9),'epoch','before'),true);cache.snapshot(state(11,2));assert.ok(cache.messages.some(m=>m.id==='u9'));assert.equal(cache.stale,true);
 assert.equal(cache.add(page(8,1),'epoch','before'),false);assert.equal(cache.add(page(8,2),'old-epoch','before'),false);
 for(const n of [8,7,6,5,4])cache.add(page(n,2),'epoch','before');assert.equal(cache.archived,true);assert.deepEqual(cache.messages.map(m=>m.id),['u4','u5','u6','u7','u8','u9','u10']);
 cache.add(page(11,2),'epoch','after');assert.equal(cache.archived,false);assert.deepEqual(cache.messages.map(m=>m.id),['u4','u5','u6','u7','u8','u9','u10','u11']);
 cache.latest();assert.deepEqual(cache.messages.map(m=>m.id),['u11']);
});
test('around detaches range and prepending preserves pinned records without eviction',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');assert.deepEqual(cache.messages.map(m=>m.id),['u2']);
 for(const n of [1,0,-1])cache.add(page(n),'epoch','before');assert.equal(cache.add(page(-2),'epoch','before',new Set(['u2'])),true);assert.deepEqual(cache.messages.map(m=>m.id),['u-2','u-1','u0','u1','u2']);
 cache.snapshot({...state(10),history:{...state(10).history,readEpoch:'new'}});assert.equal(cache.pages.length,0);
});

test('a snapshot evicting the reading pin retains the old recent page and merges same ID updates',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));const original=cache.recent;
 const next=state(11,2);next.messages.unshift({...page(10).messages[0]!,text:'continued'});next.history.page.units.unshift('u10');
 cache.snapshot(next,new Set(['u10']));assert.equal(cache.archived,false);
 cache.snapshot(state(12,3),new Set(['u10']));assert.equal(cache.archived,true);assert.ok(cache.pages.includes(original!)||cache.pages.some(p=>p.messages.some(m=>m.id==='u10')));
 assert.equal(cache.messages.find(m=>m.id==='u10')?.text,'continued');assert.ok(!cache.messages.some(m=>m.id==='u12'));assert.ok(cache.pages.length<=4);
 cache.latest();assert.deepEqual(cache.messages.map(m=>m.id),['u12']);
});
test('retained page receives overlapping updates and exact around refresh replaces its cursor',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));cache.snapshot(state(11,2),new Set(['u10']));
 const next=state(12,3);next.messages.push({...page(10).messages[0]!,text:'same ID changed'});cache.snapshot(next,new Set(['u10']));
 assert.equal(cache.messages.find(m=>m.id==='u10')?.text,'same ID changed');
 cache.updateExisting({...page(10,3),before:'new-before',after:'new-after'},'epoch');assert.equal(cache.before,'new-before');assert.equal(cache.after,'new-after');
});

test('a disjoint snapshot preserves a pin in the live tail after prepending older pages',()=>{
 const cache=new HistoryWindow();const initial=state(10);initial.messages.push(...page(11).messages);initial.history.page.units.push('u11');cache.snapshot(initial);cache.add(page(9),'epoch','before');
 const overlap=state(11,2);overlap.messages.push(...page(12).messages);overlap.history.page.units.push('u12');cache.snapshot(overlap,new Set(['u12']));assert.ok(cache.messages.some(m=>m.id==='u12'));
 cache.snapshot(state(20,3),new Set(['u12']));assert.ok(cache.messages.some(m=>m.id==='u12'));assert.equal(cache.archived,true);assert.ok(cache.pages.length<=4);
});

test('a fully pinned suffix accepts snapshots without dropping loaded messages',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));for(const n of [9,8,7])cache.add(page(n),'epoch','before');assert.equal(cache.messages.length,4);
 const previous=cache.recent,next=state(11,2);next.messages.push(...page(10).messages);next.history.page.units.push('u10');cache.snapshot(next);const current=cache.recent;
 const pins=new Set([...cache.pages.flatMap(p=>p.messages.map(m=>m.id)),'u11']);assert.equal(cache.snapshot(state(12,3),pins),true);assert.notEqual(cache.recent,current);assert.notEqual(cache.recent,previous);assert.ok(cache.messages.some(m=>m.id==='u7'));assert.ok(cache.messages.some(m=>m.id==='u11'));assert.equal(cache.archived,true);
});
