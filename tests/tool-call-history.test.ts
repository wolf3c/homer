import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MainProcessHistory} from '../src/main-process.js';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 const history=new MainProcessHistory(db);history.start({id:'node',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'node'},'turn');
 return {db,history,tools:()=>history.exact('node')!.items.filter(i=>i.kind==='tool')};
}
test('real native receive -> process persistence captures three kinds, ignores deltas/replays and separates turns',async()=>{
 const f=fixture();try{
  const engine:any=new CodexEngine({runtime:'/synthetic',workspace:process.cwd(),codexHome:'/synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[],nativeTools:'main'},async()=>({}));
  engine.threadId='synthetic';engine.turnId='turn';engine.active={text:'',messages:[],earlyEvents:[],resolve:()=>{}};
  engine.refreshBackground=async()=>{};
  engine.on('nativeProcess',(event:any)=>f.history.native('node',event));
  const receive=(method:string,item:any,turnId='turn',threadId='synthetic')=>engine.receive(JSON.stringify({method,params:{threadId,turnId,item}}));
  for(const item of [
   {id:'cmd',type:'commandExecution',command:'echo synthetic',cwd:'/synthetic',aggregatedOutput:'synthetic stdout',exitCode:2,status:'completed'},
   {id:'mcp',type:'mcpToolCall',server:'synthetic',tool:'lookup',arguments:{query:'synthetic',token:'FICTIONAL_SECRET'},result:{content:[{text:'synthetic file body'}]},status:'completed'},
   {id:'dyn',type:'dynamicToolCall',tool:'synthetic_tool',arguments:false,contentItems:0,success:true,status:'completed'},
  ]){
   await receive('item/started',item);await receive('item/completed',item);
   const revision=f.tools().at(-1)!.revision;
   await receive('item/started',item);await receive('item/completed',item);assert.equal(f.tools().at(-1)!.revision,revision);
  }
  const rows=f.tools();assert.equal(rows.length,3);
  assert.equal(rows[0]!.status,'failed');assert.deepEqual(rows[0]!.content?.output,{state:'recorded',value:{output:'synthetic stdout',exitCode:2}});
  assert.equal(rows[1]!.content?.input.state,'recorded');assert.doesNotMatch(JSON.stringify(rows),/FICTIONAL_SECRET/);
  assert.deepEqual(rows[2]!.content?.input,{state:'recorded',value:false});assert.deepEqual(rows[2]!.content?.output,{state:'recorded',value:0});
  const revision=f.history.exact('node')!.revision;
  for(let i=0;i<100;i++)await engine.receive(JSON.stringify({method:'item/commandExecution/outputDelta',params:{threadId:'synthetic',turnId:'turn',itemId:'cmd',delta:'x'.repeat(10000)}}));
  assert.equal(f.history.exact('node')!.revision,revision,'no full snapshot write on output deltas');
  await receive('item/completed',{id:'late',type:'dynamicToolCall',tool:'synthetic',arguments:{},contentItems:null,status:'completed'},'wrong-turn');assert.equal(f.tools().length,3);
  f.history.start({id:'node',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'node'},'next');engine.turnId='next';
  await receive('item/completed',{id:'dyn',type:'dynamicToolCall',tool:'synthetic_tool',arguments:0,contentItems:null,status:'completed'},'next');assert.equal(f.tools().length,4);assert.notEqual(f.tools()[2]!.id,f.tools()[3]!.id);
  f.history.finish('node','completed','end');const header=f.history.headers(['node'])[0]!;assert.equal(header.details,'unloaded');assert.equal(header.items.filter(i=>i.kind==='tool').length,0);
  assert.equal(f.history.exact('node')!.items.filter(i=>i.kind==='tool').length,4);
 }finally{f.db.close();}
});
test('host execution boundary keeps actual args/false result/errors on the existing activity and adds no work',async()=>{
 const f=fixture();try{
  const app:any=Object.create(Homer.prototype);Object.assign(app,{processes:f.history,mainContext:{event:true,processId:'node',nativeActivity:{turnId:'turn'}},mainActor:()=>({}),tasks:{captureActivity:()=>undefined}});
  let calls=0;await app.mainActivity('inspect_interaction',async()=>{calls++;return false;},{key:'record',password:'FICTIONAL_SECRET'});
  await assert.rejects(app.mainActivity('respond_interaction',async()=>{calls++;throw Error('synthetic_failure');},{answer:'synthetic response'}),/synthetic_failure/);
  assert.equal(calls,2);assert.deepEqual(f.tools()[0]!.content?.output,{state:'recorded',value:false});assert.equal(f.tools()[0]!.toolName,'inspect_interaction');
  assert.equal(f.tools()[1]!.status,'failed');assert.match(JSON.stringify(f.tools()[1]!.content?.output),/synthetic_failure/);assert.doesNotMatch(JSON.stringify(f.tools()),/FICTIONAL_SECRET/);
 }finally{f.db.close();}
});
