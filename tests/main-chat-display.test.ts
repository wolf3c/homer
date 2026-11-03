import test from 'node:test';
import assert from 'node:assert/strict';
import * as display from '../ui/process-presentation.ts';
import type {ProcessNode,ProcessItem} from '../src/main-process.js';
const node:ProcessNode={id:'p',threadId:'thread',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'m',state:'working',status:'running',turnIds:['old','turn'],items:[]};
const observation={connected:true,serviceRunning:true,threadId:'thread',generationTurnId:'turn',mainActivity:{processId:'p',source:'user' as const,turnId:'turn',stage:'native' as const}};
const tool=(id:string,seq:number,patch:object={}):ProcessItem=>({id,seq,revision:1,kind:'tool',category:'command',threadId:'thread',turnId:'turn',label:'运行命令',status:'running',content:{input:{state:'recorded',value:{command:'pnpm test --token SECRET /private/file'}},output:{state:'pending'}},...patch});
test('compact action selects exact live call, latest revision, concurrent fallback and terminal status',()=>{
 const summary=(items:ProcessItem[],o=observation)=>display.compactProcessAction({...node,items},o);
 assert.equal(summary([tool('a',1),tool('b',2,{content:undefined})]),'运行命令');
 assert.equal(summary([tool('a',1),tool('b',2),tool('b',2,{revision:2,status:'completed'})]),'运行 pnpm test');
 assert.equal(summary([tool('b',2),tool('b',2,{revision:2,status:'failed'})]),'运行 pnpm test · 失败');
 assert.equal(summary([tool('old',5,{turnId:'old'}),tool('a',1)]),'运行 pnpm test');
 assert.equal(summary([tool('wrong-thread',5,{threadId:'other'})]),'具体动作未提供');
 assert.equal(summary([tool('a',1)],{...observation,generationTurnId:'old'}),'状态待确认');
 assert.equal(summary([tool('a',1)],{...observation,connected:false}),'状态待确认');
 assert.equal(display.compactProcessAction({...node,items:[tool('a',1)]},{...observation,mainActivity:{...observation.mainActivity,stage:'finishing'}}),'运行 pnpm test · 结束状态待核实');
 assert.equal(summary([{id:'worker',seq:9,revision:1,kind:'workerEvent',eventKey:'worker'}]),'具体动作未提供');
});
test('command summary exposes only approved executable and subcommand, never arguments or wrapper bodies',()=>{
 for(const [command,want] of [['pnpm test --token SECRET /private/file','运行 pnpm test'],['/usr/bin/git status --porcelain','运行 git status'],['TOKEN=SECRET pnpm test','运行命令'],['pnpm test && curl SECRET','运行命令'],['node -e "SECRET"','运行 node'],['/private/SECRET arg','运行命令'],['functions.exec({cmd:"pnpm test"})','运行命令']]){
  const item=tool('a',1,{content:{input:{state:'recorded',value:{command}},output:{state:'pending'}}});
  assert.equal(display.compactProcessAction({...node,items:[item]},observation),want);
 }
 for(const state of ['hidden','not-recorded','truncated'])assert.equal(display.compactProcessAction({...node,items:[tool('a',1,{content:{input:{state,value:{command:'pnpm test'}},output:{state:'pending'}}})]},observation),'运行命令');
});
