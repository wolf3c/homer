import test from 'node:test';
import assert from 'node:assert/strict';
import * as display from '../ui/process-presentation.js';
import type {ProcessNode,ProcessItem} from '../src/main-process.js';
import {activitySummaryText} from '../src/message-quote.js';
const node:ProcessNode={id:'p',threadId:'thread',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'m',state:'working',status:'running',turnIds:['old','turn'],items:[]};
const observation={connected:true,serviceRunning:true,threadId:'thread',generationTurnId:'turn',mainActivity:{processId:'p',source:'user' as const,turnId:'turn',stage:'native' as const}};
const tool=(id:string,seq:number,patch:object={}):ProcessItem=>({id,seq,revision:1,kind:'tool',category:'command',threadId:'thread',turnId:'turn',label:'运行命令',status:'running',content:{input:{state:'recorded',value:{command:'pnpm test --token SECRET /private/file'}},output:{state:'pending'}},...patch});
test('activity previews retain only the first readable Markdown line with a bounded title',()=>{
 for(const [input,want]of [['\n# **核查源码**\n后续说明','核查源码'],['\n> [核查源码](https://example.invalid/private)\n后续说明','核查源码'],['```text\n核查源码\n后续说明\n```','核查源码'],['\n\n',''],['\n'+ '长'.repeat(100),'长'.repeat(80)+'…']])assert.equal(activitySummaryText(input!),want);
});
test('activity titles bound Markdown input before parsing a large commentary body',()=>{
 assert.equal(activitySummaryText(' '.repeat(4096)+'OUTSIDE_PREVIEW_BUDGET'),'');
 assert.equal(activitySummaryText('核查源码。\n'+'**进度说明** '.repeat(32768)),'核查源码。');
});
test('compact action selects exact live call, latest revision, concurrent fallback and terminal status',()=>{
 const summary=(items:ProcessItem[],o=observation)=>display.compactProcessAction({...node,items},o);
 assert.equal(summary([tool('a',1),tool('b',2,{content:undefined})]),'运行命令');
 assert.equal(summary([tool('a',1),tool('b',2),tool('b',2,{revision:2,status:'completed'})]),'运行 pnpm test');
 assert.equal(summary([tool('b',2),tool('b',2,{revision:2,status:'failed'})]),'处理中');
 assert.equal(summary([tool('old',5,{turnId:'old'}),tool('a',1)]),'运行 pnpm test');
 assert.equal(summary([tool('wrong-thread',5,{threadId:'other'})]),'处理中');
 assert.equal(summary([tool('a',1)],{...observation,generationTurnId:'old'}),'状态待确认');
 assert.equal(summary([tool('a',1)],{...observation,connected:false}),'状态待确认');
 assert.equal(summary([{id:'worker',seq:9,revision:1,kind:'workerEvent',eventKey:'worker'}]),'处理中');
});
test('current tools, readable summaries and public commentary have ordered fallbacks',()=>{
 const commentary:ProcessItem={id:'c',seq:3,revision:1,kind:'commentary',turnId:'turn',itemId:'c',phase:'commentary',text:'**我会先核查源码。**\n后续说明'};
 const o={...observation,mainActivity:{...observation.mainActivity,summary:'准备只读诊断'}};
 assert.equal(display.compactProcessAction({...node,items:[commentary]},observation),'我会先核查源码。');
 assert.equal(display.compactProcessAction({...node,items:[commentary]},o),'准备只读诊断');
 assert.equal(display.compactProcessAction({...node,items:[commentary,tool('read',4,{category:'readFiles',label:'读取文件'})]},o),'读取文件');
 assert.equal(display.compactProcessAction({...node,items:[commentary,tool('done',4,{status:'completed'})]},o),'准备只读诊断');
 assert.equal(display.compactProcessAction({...node,items:[commentary,{...commentary,revision:2,text:'新进度'}]},observation),'新进度');
 for(const patch of [{turnId:'old'},{phase:'analysis'},{phase:'final_answer'},{itemId:undefined},{turnId:undefined},{text:'   '}])
  assert.equal(display.compactProcessAction({...node,items:[{...commentary,...patch}]},observation),'处理中');
 assert.equal(display.compactProcessAction({...node,items:[{...commentary,text:'长'.repeat(100)}]},observation),'长'.repeat(80)+'…');
 assert.equal(display.compactProcessAction(node,{...o,connected:false}),'状态待确认');
 assert.equal(display.compactProcessAction({...node,state:'worked',status:'completed'},o),'已结束');
});
test('command summary exposes only approved executable and subcommand, never arguments or wrapper bodies',()=>{
 for(const [command,want] of [['pnpm test --token SECRET /private/file','运行 pnpm test'],['/usr/bin/git status --porcelain','运行 git status'],['TOKEN=SECRET pnpm test','运行命令'],['pnpm test && curl SECRET','运行命令'],['node -e "SECRET"','运行 node'],['/private/SECRET arg','运行命令'],['functions.exec({cmd:"pnpm test"})','运行命令']]){
  const item=tool('a',1,{content:{input:{state:'recorded',value:{command}},output:{state:'pending'}}});
  assert.equal(display.compactProcessAction({...node,items:[item]},observation),want);
 }
 for(const state of ['hidden','not-recorded','truncated'])assert.equal(display.compactProcessAction({...node,items:[tool('a',1,{content:{input:{state,value:{command:'pnpm test'}},output:{state:'pending'}}})]},observation),'运行命令');
});
