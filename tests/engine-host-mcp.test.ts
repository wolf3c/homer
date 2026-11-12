import assert from 'node:assert/strict';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {test} from 'node:test';
import {CodexEngine} from '../src/engine.js';
import type {Config} from '../src/config.js';

const config:Config={workspace:process.cwd(),runtime:process.cwd()+'/.codex/scratch/host-call-evidence',codexHome:process.cwd()+'/.codex/scratch/host-call-evidence/home',codexBin:process.execPath,model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:20};

for(const role of ['main','worker'] as const)test(`${role} publishes exact live homer_interactions starts for native call authentication`,async()=>{
  const engine=new CodexEngine(config,{role,nativeTools:role,cwd:process.cwd(),readRoots:[],instructions:'synthetic',tools:[]},async()=>({}));
  engine.threadId='thread';
  const receive=(message:unknown)=>engine['receive'](JSON.stringify(message));
  engine['send']=(message:any)=>{
    if(message.method==='config/read')void receive({id:message.id,result:{config:{},layers:[]}});
    if(message.method==='turn/start')void receive({id:message.id,result:{turn:{id:'turn'}}});
    if(message.method==='thread/backgroundTerminals/list')void receive({id:message.id,result:{data:[]}});
  };
  const starts:unknown[]=[],processes:unknown[]=[];
  engine.on('hostMcpToolStarted',call=>starts.push(call));engine.on('nativeProcess',item=>processes.push(item));
  const item=(tool:string,extra:Record<string,unknown>={})=>({id:tool,type:'mcpToolCall',server:'homer_interactions',tool,arguments:{scheduleId:'schedule-a'},...extra});
  const event=(value:unknown,extra:Record<string,unknown>={})=>receive({method:'item/started',params:{threadId:'thread',turnId:'turn',item:value,...extra}});
  try{
    await event(item('before-turn'));
    const work=engine.turn('Synthetic schedule instruction');void work.catch(()=>{});await yieldTurn();
    for(const tool of ['schedule_create','schedule_list','schedule_update','schedule_cancel'])await event(item(tool));
    assert.deepEqual(starts,['schedule_create','schedule_list','schedule_update','schedule_cancel'].map(tool=>({threadId:'thread',turnId:'turn',itemId:tool,tool,arguments:{scheduleId:'schedule-a'}})));
    assert.equal(processes.length,role==='worker'?4:0,'Worker keeps its existing public native activity projection');
    await event(item('wrong-thread'),{threadId:'another-thread'});
    await event(item('wrong-turn'),{turnId:'another-turn'});
    await event(item('other-server',{server:'untrusted_server'}));
    await event(item('not-an-mcp-call',{type:'dynamicToolCall'}));
    await event(item('invalid-id',{id:3}));
    await receive({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});await work;
    await event(item('after-turn'));
    assert.equal(starts.length,4);
  }finally{await engine.close();}
});
