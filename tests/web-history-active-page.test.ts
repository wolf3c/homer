import {test} from 'node:test';import assert from 'node:assert/strict';
import {ActiveReadPage} from '../ui/active-read-page.js';
const version={threadId:'synthetic',readEpoch:'epoch',revision:1};
test('one selected owner page survives recent SSE, fences slow reads and replaces exact changed identities',()=>{
 const page=new ActiveReadPage<{id:string;state:string}>(),first={id:'first',state:'pending'},edited={id:'second',state:'pending'};
 page.snapshot(version,[first],80);const request=page.begin(80)!;
 assert.equal(page.begin(80),undefined,'same-direction reads share one flight');
 assert.equal(page.complete(request,{...version,items:[edited],after:160}),true);page.finish(request);
 page.snapshot({...version,revision:2},[first],80);assert.equal(page.items[0],edited);assert.equal(page.cursor,80);assert.equal(page.checking,true);
 const slow=page.begin()!;page.snapshot({...version,revision:3},[first],80);
 assert.equal(page.complete(slow,{...version,revision:2,items:[],after:null}),false);page.finish(slow);assert.equal(page.items[0],edited);assert.equal(page.needsRead,true);
 const fresh=page.begin()!;assert.equal(page.complete(fresh,{...version,revision:3,items:[{id:'third',state:'pending'}],after:null}),true);page.finish(fresh);
 assert.deepEqual(page.items.map(i=>i.id),['third'],'the owner removes expired/cancelled identities and supplies current ordering');assert.equal(page.checking,false);
 const old=page.begin()!;page.snapshot({...version,readEpoch:'new'},[first],80);assert.equal(page.complete(old,{...version,revision:4,items:[edited],after:null}),false);page.finish(old);assert.equal(page.cursor,0);assert.deepEqual(page.items,[first]);
 const wrong=page.begin(80)!;assert.equal(page.complete(wrong,{...version,readEpoch:'new',threadId:'other',items:[edited],after:null}),false);
 page.snapshot({...version,threadId:'new-thread',readEpoch:'new'},[first],80);assert.equal(page.cursor,0);assert.equal(page.complete(wrong,{...version,readEpoch:'new',items:[edited],after:null}),false);
 const paused=page.begin()!;page.invalidate();assert.equal(page.complete(paused,{...version,threadId:'new-thread',readEpoch:'new',items:[edited],after:null}),false);
});
