import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../ui/process-presentation.ts';
import {ProcessNodeView,ProcessMessageContent} from './helpers/process-ui-loader.mjs';
import {withDom,React,visibleText} from './helpers/process-dom.mjs';
import {historyFixture} from './web-history-loading-fixture.ts';
const h=React.createElement;
const tools=Array.from({length:8},(_,i)=>({id:'call-'+i,revision:1,seq:i+1,kind:'tool',category:'host',label:i===5?'核对成果':'检查资料',status:'completed'}));
const worker={id:'worker:task-a',seq:9,revision:1,kind:'worker',taskId:'task-a',version:1,taskRevision:4,runId:'run-a',runRevision:3,epoch:1,runStatus:'succeeded',state:'settled',controlState:'normal',resultState:'accepted',outcome:'partial',phase:'ended',stopRequested:false,label:'核对材料与交付范围'};
const node={id:'reading-one',threadId:'synthetic-reading',messageId:'reading-one',sourceKind:'worker',sourceMessageIds:[],seq:1,revision:1,turnIds:['internal-turn'],state:'worked',status:'failed',items:[...tools,worker]};
const observation={connected:true,serviceRunning:true,threadId:node.threadId};

test('eight distinct missing-turn returns preserve every original call, without losing identities, order or revisions',()=>{
 const result=presentation.projectProcessItems([...tools,{...tools[0],revision:2},worker]);
 assert.deepEqual(result.items.map(t=>t.id),[...tools,worker].map(t=>t.id));assert.equal(result.items[0].revision,2);
});

test('failed, denied, blocked and uncertain facts stay in lazy headers without expanding ordinary successful history',()=>{
 const f=historyFixture(1);try{const raw=JSON.parse(f.store.meta('publicMainNode:v1:node-0'));raw.items=[...tools,...['failed','declined','blocked','unknown','interrupted'].map((status,i)=>({...tools[0],id:'risk-'+i,status}))];f.store.setMeta('publicMainNode:v1:node-0',JSON.stringify(raw));const header=f.processes.headers(['node-0'])[0];assert.equal(header.details,'unloaded');assert.equal(header.items.length,0);assert.equal(header.toolStatusCounts,undefined);}finally{f.close();}
});


test('Worker snapshots and public progress retain their exact positions without grouping calls',()=>{
 const interleaved=[tools[0],worker,...tools.slice(1)];assert.deepEqual(presentation.projectProcessItems(interleaved).items.map(t=>t.id),interleaved.map(t=>t.id));
 const progress={id:'public-progress',kind:'commentary',seq:3,revision:1,phase:'commentary',text:'公开进展'};const items=presentation.projectProcessItems([tools[0],progress,...tools.slice(1)]).items;assert.equal(items.length,9);assert.equal(items[1].text,'公开进展');
});

test('lazy history remains bounded without unused tool counts even with many ordinary calls',()=>{
 const f=historyFixture(1);try{const key='publicMainNode:v1:node-0',raw=JSON.parse(f.store.meta(key));raw.items=[...Array.from({length:2000},(_,i)=>({...tools[0],id:'bulk-'+i})),{...tools[0],id:'bulk-0',revision:2,status:'failed'}];f.store.setMeta(key,JSON.stringify(raw));const header=f.processes.headers(['node-0'])[0];assert.equal(header.toolStatusCounts,undefined);assert.equal(header.items.length,0);assert.ok(JSON.stringify(header).length<2000);}finally{f.close();}
});
