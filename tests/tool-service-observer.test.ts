import {TurnExecution} from '../src/execution-limits.js';
// Requirement-derived synthetic RPC -> service -> persisted history regression.
// Extracted from the pre-existing untracked main-process suite for the E scope.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MainProcessHistory} from '../src/main-process.js';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 const history=new MainProcessHistory(db);
 return {db,history,node:()=>history.list('synthetic')[0]!};
}

test('native RPC call content flows through real service observers with credentials removed before persistence',async()=>{
 const f=fixture();try{
  const engine:any=new CodexEngine({workspace:process.cwd(),runtime:'/synthetic/runtime',codexHome:'/synthetic/home',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},async()=>({}));
  engine.threadId='synthetic';engine.turnId='turn:node';engine.active={execution:new TurnExecution({}),messages:[],earlyEvents:[],resolve:()=>{}};
  const app:any=Object.create(Homer.prototype);
  Object.assign(app,{config:{workspace:process.cwd(),runtime:'/synthetic/runtime',codexHome:'/synthetic/home'},prompts:{main:''},interactionMcp:{path:'/synthetic/socket',directory:process.cwd()},factory:()=>engine,store:{db:f.db},processes:f.history});
  app.main=app.createMain(process.cwd());
  f.history.start({id:'node',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'node'},'turn:node',{startedAtMs:100000,observedAtMs:100050});
  app.mainContext={processId:'node',nativeActivity:{turnId:'turn:node',compactions:new Map()}};
  const list=f.history.list;f.history.list=()=>{throw new Error('native observer must not enumerate process history');};
  const nodeRevision=()=>JSON.parse(String(f.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:node')!.value)).revision;
  const events:any[]=[];engine.on('nativeProcess',(event:any)=>events.push(event));
  const receive=(method:string,params:any)=>engine.receive(JSON.stringify({method,params:{threadId:'synthetic',turnId:engine.turnId,...params}}));
  const secret='FICTIONAL_TOKEN_CREDENTIAL',body='SYNTHETIC_TOOL_BODY';
  const command={id:'same',type:'commandExecution',command:'echo '+body+' token='+secret,cwd:'/synthetic/'+body,aggregatedOutput:body,arguments:secret,result:secret,reasoning:secret,commandActions:[{type:'read',path:secret,name:secret}],startedAtMs:100100};
  await receive('item/started',{item:command});
  await receive('item/commandExecution/outputDelta',{itemId:'same',delta:secret});
  await receive('item/started',{item:{id:'mcp',type:'mcpToolCall',arguments:secret,result:secret}});
  f.history.tool('node',{id:'host-mcp',label:'检查资料',phase:'start',turnId:engine.turnId});
  await receive('item/completed',{item:{...command,status:'completed',exitCode:2,completedAtMs:100500,durationMs:400}});
  const revision=nodeRevision();
  await receive('item/completed',{item:{...command,status:'completed',exitCode:0}});
  await receive('item/started',{item:command});assert.equal(nodeRevision(),revision);
  await receive('item/completed',{turnId:'stale-turn',item:{...command,status:'completed'}});
  const rejected={threadId:'synthetic',turnId:'stale-turn',itemId:'rejected',category:'command',status:'running',completed:false};
  engine.emit('nativeProcess',rejected);
  engine.emit('nativeProcess',{...rejected,threadId:'other-thread',turnId:'turn:node'});
  app.mainContext={};engine.emit('nativeProcess',{...rejected,turnId:'turn:node'});
  app.mainContext={processId:'node'};app.main={};engine.emit('nativeProcess',{...rejected,turnId:'turn:node'});app.main=engine;
  assert.equal(nodeRevision(),revision,'stale turn, foreign thread, absent context and replaced engine stay rejected without enumeration');
  const edit={id:'edit',type:'fileChange',changes:[{path:'/synthetic/a',diff:body+'\napi_key='+secret},{path:'/synthetic/a',diff:body},{path:'/synthetic/b',diff:body}],status:'inProgress',startedAtMs:null};
  await receive('item/started',{item:edit});
  await receive('item/completed',{item:{...edit,status:'declined',completedAtMs:null}});
  // A completed-before-start item is terminal in its first observed position.
  await receive('item/completed',{item:{id:'late',type:'commandExecution',status:'interrupted',command:body}});
  await receive('item/started',{item:{id:'late',type:'commandExecution',command:body}});
  await receive('turn/completed',{turn:{id:engine.turnId,status:'completed',startedAt:100,completedAt:101,durationMs:950}});
  f.history.finish('node','completed','native-terminal');
  f.history.list=list;
  const node=f.node(),tools=node.items.filter(item=>item.kind==='tool');
  assert.deepEqual(tools.map(item=>[item.category,item.status,item.invocationCount,item.fileCount]),[['readFiles','failed',1,undefined],['host','blocked',1,undefined],['fileChange','declined',1,2],['command','interrupted',1,undefined]]);
  assert.deepEqual(tools.map(item=>item.seq),[1,2,3,4]);assert.equal(tools[0]!.durationMs,400);assert.equal(tools[3]!.startedAtMs,undefined);
  assert.equal(node.startedAtMs,100000);assert.equal(node.endedAtMs,101000);assert.equal(node.durationMs,950);assert.equal(node.timingSource,'native');
  assert.ok(!JSON.stringify(events).includes(secret));assert.ok(!JSON.stringify(node).includes(secret));assert.ok(!JSON.stringify(f.db.prepare('SELECT value FROM meta').all()).includes(secret));
  assert.deepEqual(tools[0]!.content?.output,{state:'recorded',value:{output:body,exitCode:2}});
  assert.match(JSON.stringify(node),/SYNTHETIC_TOOL_BODY/);
  assert.deepEqual(new MainProcessHistory(f.db).list('synthetic'),f.history.list('synthetic'));
 }finally{f.db.close();}
});
