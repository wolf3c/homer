import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MainProcessHistory} from '../src/main-process.js';
import {CodexEngine} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {progressLabel} from '../src/main-progress.js';

test('a Worker question has a durable public source before any output, without exposing its internal text',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 try{
  const history=new MainProcessHistory(db),source={id:'question',threadId:'thread',sourceKind:'worker' as const,sourceMessageIds:['notice'],messageId:'question'};
  history.start(source,'turn',undefined,'处理 Worker 提问：保持历史消息阅读位置');
  history.agent('question',{turnId:'turn',itemId:'private',phase:'commentary',text:'PRIVATE_BODY',completed:true});
  history.start(source,'turn',undefined,'重复说明');history.start(source,'continued',undefined,'改名');
  const node=history.exact('question')!;
  assert.deepEqual(node.items.map(i=>i.kind==='commentary'?i.text:''),['处理 Worker 提问：保持历史消息阅读位置']);
  assert.equal(node.items[0]?.id,'question:source');assert.equal(node.final,undefined);
  assert.doesNotMatch(JSON.stringify(node),/PRIVATE_BODY|重复说明|改名/);
 }finally{db.close();}
});

test('source labels use the exact Worker version and fixed templates, never the question or raw queue text',()=>{
 const app:any=Object.create(Homer.prototype);
 app.interactions={inspect:()=>({kind:'question',runId:'run'})};
 app.tasks={run:(id:string)=>{assert.equal(id,'run');return {taskId:'task',contractVersion:2};},contract:(id:string,version:number)=>{assert.equal(id,'task');assert.equal(version,2);return {presentation:{title:'原任务名称'}};}};
 const context={event:true,interactionId:'interaction',workerMessages:[{taskId:'task',taskVersion:2,kind:'interaction_required',payload:{text:'PRIVATE_BODY'}}]};
 assert.equal(app.mainSourceText(context),'处理 Worker 提问：原任务名称');
 app.interactions.inspect=()=>({kind:'authorization',runId:'run'});
 assert.equal(app.mainSourceText(context),'处理 Worker 操作确认：原任务名称');
 assert.equal(app.mainSourceText({...context,interactionId:undefined,workerMessages:[{...context.workerMessages[0],kind:'result_ready'}]}),'处理 Worker 结果回传：原任务名称');
 assert.equal(app.mainSourceText({...context,workerMessages:undefined}),'处理 Worker 操作确认：原任务名称');
 assert.equal(app.mainSourceText({...context,workerMessages:[{...context.workerMessages[0],taskVersion:99}]}),'处理 Worker 操作确认：原任务名称');
 assert.equal(app.mainSourceText({...context,interactionId:undefined,workerMessages:[...context.workerMessages,context.workerMessages[0]]}),'处理 Worker 协作消息');
 assert.equal(app.mainSourceText({event:true,sourceEventId:'review:run'}),'核对 Worker 成果');
 assert.equal(app.mainSourceText({event:true,sourceEventId:'delivery:run'}),'整理 Worker 交付');
 app.tasks.contract=()=>({presentation:{title:'/private/path'}});
 assert.equal(app.mainSourceText(context),'处理 Worker 操作确认');
 app.tasks.contract=()=>{throw Error('display_record_missing');};
 assert.equal(app.mainSourceText(context),'处理 Worker 操作确认');
 assert.equal(app.mainSourceText({event:false}),'处理你的消息');
});

test('the host activity owner records authorized call content with credentials removed and no extra work',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 try{
  const processes=new MainProcessHistory(db);processes.start({id:'node',threadId:'thread',sourceKind:'worker',sourceMessageIds:['notice'],messageId:'node'},'turn',undefined,'处理 Worker 提问');
  const app:any=Object.create(Homer.prototype);
  Object.assign(app,{processes,mainContext:{event:true,processId:'node',nativeActivity:{turnId:'turn'}},mainActor:()=>({}),tasks:{captureActivity:()=>undefined}});
  let calls=0;
  await app.mainActivity('inspect_interaction',async()=>{calls++;assert.equal(processes.exact('node')!.items.at(-1)?.kind,'tool');return {state:'pending_main'};},{question:'SYNTHETIC_BODY',password:'FICTIONAL_CREDENTIAL'});
  await assert.rejects(app.mainActivity('respond_interaction',async()=>{calls++;throw Error('synthetic_failure');},{answer:'SYNTHETIC_BODY',token:'FICTIONAL_CREDENTIAL'}),/synthetic_failure/);
  assert.equal(calls,2);
  assert.deepEqual(processes.exact('node')!.items.filter(i=>i.kind==='tool').map(i=>[i.label,i.status]),[['检查协作请求','completed'],['答复协作请求','failed']]);
  const content=processes.exact('node')!.items.filter(i=>i.kind==='tool');
  assert.deepEqual(content[0]!.content?.output,{state:'recorded',value:{state:'pending_main'}});
  assert.match(JSON.stringify(content),/SYNTHETIC_BODY/);assert.doesNotMatch(JSON.stringify(content),/FICTIONAL_CREDENTIAL/);
 }finally{db.close();}
});

test('all host calls get factual labels, including coordination and unclassified registered tools',()=>{
 assert.equal(progressLabel('inspect_interaction'),'检查协作请求');
 assert.equal(progressLabel('respond_interaction'),'答复协作请求');
 assert.equal(progressLabel('escalate_interaction'),'转交用户确认');
 assert.equal(progressLabel('agent_send'),'发送协作消息');
 assert.equal(progressLabel('inbox_ack'),'确认协作回执');
 assert.equal(progressLabel('future_tool'),'调用工具');
});

test('native tools retain authorized content but exclude reasoning, credentials and host duplicates',async()=>{
 const engine:any=new CodexEngine({workspace:process.cwd(),runtime:'/synthetic/runtime',codexHome:'/synthetic/home',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[{name:'host_dynamic'}] as any},async()=>({}));
 engine.threadId='thread';engine.turnId='turn';engine.active={text:'',earlyEvents:[],resolve:()=>{}};
 const events:any[]=[];engine.on('nativeProcess',(e:any)=>events.push(e));
 const receive=(method:string,item:any,turnId='turn')=>engine.receive(JSON.stringify({method,params:{threadId:'thread',turnId,item}}));
 for(const type of ['webSearch','imageView','imageGeneration','mcpToolCall','dynamicToolCall']){
  const item={type,id:type,server:'external',tool:'public_tool',arguments:{query:'SYNTHETIC_BODY',password:'FICTIONAL_CREDENTIAL'},result:'SYNTHETIC_BODY',path:'/synthetic',query:'SYNTHETIC_BODY',reasoning:'PRIVATE_REASONING'};
  await receive('item/started',item);await receive('item/completed',{...item,status:'completed',success:true});
 }
 await receive('item/started',{id:'host',type:'mcpToolCall',server:'homer_interactions',tool:'work_inspect'});
 await receive('item/started',{id:'dynamic',type:'dynamicToolCall',tool:'host_dynamic'});
 await receive('item/started',{id:'stale',type:'webSearch'},'stale');
 await receive('item/started',{id:'private',type:'reasoning',text:'PRIVATE_BODY'});
 await receive('item/started',{id:'unsupported',type:'constructor'});
 await receive('item/started',{id:'malformed',type:{toString:'PRIVATE_BODY'}});
 assert.equal(events.length,10);assert.equal(events.filter(e=>e.status==='completed').length,5);
 assert.doesNotMatch(JSON.stringify(events),/FICTIONAL_CREDENTIAL|PRIVATE_REASONING|reasoning/);
 assert.deepEqual(events.find(e=>e.itemId==='webSearch')?.content?.input,{state:'recorded',value:{query:'SYNTHETIC_BODY'}});
 assert.deepEqual(events.filter(e=>!e.completed).map(e=>e.category),['webSearch','imageView','imageGeneration','externalTool','externalTool']);
 await receive('item/completed',{id:'failed',type:'dynamicToolCall',tool:'public_tool',status:'completed',success:false});
 assert.equal(events.at(-1).status,'failed');
 await receive('item/completed',{id:'unknown',type:'mcpToolCall',server:'external',tool:'public_tool',status:'unexpected'});
 assert.equal(events.at(-1).status,'unknown');
});
