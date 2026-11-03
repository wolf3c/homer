import {test} from 'node:test';import assert from 'node:assert/strict';
import {HistoryWindow} from '../ui/history-window.js';
const page=(n:number,revision=1)=>({protocol:3 as const,threadId:'t',revision,units:['u'+n],messages:[{id:'u'+n,threadId:'t',requestId:null,role:'assistant' as const,text:'合成'+n,status:'completed' as const,createdAt:n}],queue:[],before:'before'+n,after:'after'+n,orderWarning:undefined});
const state=(n:number,revision=1)=>({threadId:'t',messages:page(n).messages,isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'},history:{protocol:3 as const,readEpoch:'epoch',page:page(n,revision),moreQueue:null,moreInteractions:null}});
test('recent snapshots retain history, reuse stable messages, reject slow page/epoch and limit cache',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));const original=cache.messages[0];cache.snapshot(state(10));assert.equal(cache.messages[0],original);
 assert.equal(cache.add(page(9),'epoch','before'),true);cache.snapshot(state(11,2));assert.ok(cache.messages.some(m=>m.id==='u9'));assert.equal(cache.stale,true);
 assert.equal(cache.add(page(8,1),'epoch','before'),false);assert.equal(cache.add(page(8,2),'old-epoch','before'),false);
 for(const n of [8,7,6,5,4])cache.add(page(n,2),'epoch','before');assert.ok(cache.pages.length<=4);assert.equal(cache.archived,true);assert.ok(!cache.messages.some(m=>m.id==='u11'));
 cache.latest();assert.deepEqual(cache.messages.map(m=>m.id),['u11']);
});
test('around explicitly detaches range and pinning refuses eviction of visible or selected records',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));cache.add(page(2),'epoch','around');assert.deepEqual(cache.messages.map(m=>m.id),['u2']);
 for(const n of [1,0,-1])cache.add(page(n),'epoch','before');assert.throws(()=>cache.add(page(-2),'epoch','before',new Set(['u2'])),/history_cache_pinned/);assert.equal(cache.pages.length,4);
 cache.snapshot({...state(10),history:{...state(10).history,readEpoch:'new'}});assert.equal(cache.pages.length,0);
});

test('a snapshot evicting the reading pin retains the old recent page and merges same ID updates',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));const original=cache.recent;
 const next=state(11,2);next.messages.push({...page(10).messages[0]!,text:'continued'});
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

test('snapshot retention stays bounded when every history page is pinned',()=>{
 const cache=new HistoryWindow();cache.snapshot(state(10));for(const n of [9,8,7])cache.add(page(n),'epoch','before');assert.equal(cache.pages.length,4);
 const previous=cache.recent,next=state(11,2);next.messages.push(...page(10).messages);next.history.page.units.push('u10');cache.snapshot(next);const current=cache.recent;
 const pins=new Set([...cache.pages.flatMap(p=>p.messages.map(m=>m.id)),'u11']);assert.equal(cache.snapshot(state(12,3),pins),false);assert.equal(cache.recent,current);assert.notEqual(cache.recent,previous);assert.equal(cache.pages.length,4);
});
