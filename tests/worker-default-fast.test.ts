// Synthetic configuration + actual app-server protocol; no model/account access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createConnection} from 'node:net';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {loadConfig} from '../src/config.js';
import {CodexEngine,type EngineLike,type EngineOptions,type ToolCall,type TurnResult} from '../src/engine.js';
import {Homer} from '../src/service.js';

const scratch=resolve('.codex/scratch/homer-main-medium-20261027/worker-test-runs');
mkdirSync(scratch,{recursive:true});
function fixture(){
  const dir=mkdtempSync(join(scratch,'case-'));
  const raw={codexBin:process.execPath,appData:join(dir,'data'),workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),codexHome:join(dir,'home')};
  for(const path of [raw.workspace,raw.runtime,raw.codexHome])mkdirSync(path);
  return {dir,raw,read(extra:Record<string,unknown>={}){const path=join(dir,'config.json');writeFileSync(path,JSON.stringify({...raw,...extra}));return loadConfig(path);},close(){rmSync(dir,{recursive:true,force:true});}};
}
const envKeys=['HOMER_MODEL','HOMER_EFFORT','HOMER_FAST','HOMER_CODEX_BIN','HOMER_CODEX_HOME','HOMER_DATA_HOME','HOMER_NATIVE_CODEX_HOME','HOMER_CODEX_BASE_URL','HOMER_CODEX_KEY_ENV'];
async function cleanEnvironment(work:()=>Promise<void>){
  const saved=envKeys.map(key=>[key,process.env[key]] as const);
  try{for(const key of envKeys)delete process.env[key];await work();}
  finally{for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

for(const role of ['main','worker'] as const)for(const native of [false,true])for(const resume of [false,true]){
  for(const override of ['default','local-true','local-false','env-true','env-false'] as const){
    test(`${role} ${native?'native':'legacy'} ${resume?'resume':'new'} ${override} preserves model/effort and requests the effective tier on every turn`,()=>cleanEnvironment(async()=>{
      const f=fixture();let engine:CodexEngine|undefined;
      try{
        const local=override.startsWith('local-')?override==='local-true':override.startsWith('env-')?override!=='env-true':undefined;
        if(override.startsWith('env-'))process.env.HOMER_FAST=String(override==='env-true');
        const config=f.read({codexBin:resolve('tests/fixtures/model-settings-app-server.mjs'),nativeCodexHome:f.raw.codexHome,requiresOpenaiAuth:false,stopGraceMs:100,...(local===undefined?{}:{fast:local})});
        const effective=override==='default'||override.endsWith('true');
        const options:EngineOptions={role,cwd:config.workspace,readRoots:[],instructions:'Synthetic Fast contract',tools:[],...(native?{nativeTools:role,nativeCapabilities:true}:{}),...(resume?{threadId:'synthetic-model-thread'}:{})};
        engine=new CodexEngine(config,options,async()=>({}));
        await engine.start();
        for(let i=0;i<2;i++){
          const result=JSON.parse((await engine.turn('Synthetic protocol check')).text);
          assert.equal(result.threadMethod,resume?'thread/resume':'thread/start');
          assert.equal(result.threadServiceTier,effective?'priority':null);
          assert.equal(result.turnServiceTier,effective?'priority':null);
          assert.equal(result.model,'gpt-6.1-sol');assert.equal(result.effort,role==='worker'?'high':'medium');
        }
      }finally{await engine?.close();f.close();}
    }));
  }
}

test('unspecified Fast remains distinguishable from an explicit main/Worker override after configuration loading',()=>cleanEnvironment(async()=>{
  const f=fixture();try{
    assert.equal(f.read().fast,undefined);
    for(const fast of [true,false])assert.equal(f.read({fast}).fast,fast);
    for(const invalid of ['false',0,null])assert.throws(()=>f.read({fast:invalid}),/invalid_fast/);
    for(const invalid of ['','TRUE','1']){process.env.HOMER_FAST=invalid;assert.throws(()=>f.read(),/invalid_fast/);}
  }finally{f.close();}
}));

type ModelsStatus={configured:{fast:boolean;model:string;effort:string;effortListed:boolean}};
// Call the actual bound capability endpoint while the caller's turn is live.
async function capabilityModels(options:EngineOptions):Promise<ModelsStatus>{
  const mcp=options.interactionMcp!,path=mcp.args.find(arg=>arg.endsWith('.sock'));
  assert.ok(path,'Host supplied a bound MCP socket');
  return new Promise((done,reject)=>{
    assert.equal(mcp.cwd,process.cwd()); // Preserve the host's short relative Unix-socket path.
    const socket=createConnection(path);let buffer='';
    const fail=(error:Error)=>{socket.destroy();reject(error);};
    socket.setTimeout(3000,()=>fail(Error('synthetic_capability_timeout')));
    socket.on('error',fail);socket.setEncoding('utf8');
    socket.on('connect',()=>socket.write(JSON.stringify({tool:'capabilities',arguments:{action:'models'}})+'\n'));
    socket.on('data',chunk=>{
      buffer+=chunk;if(!buffer.includes('\n'))return;
      try{const message=JSON.parse(buffer);socket.end();if(message.error)fail(Error(message.error));else done(message.result);}catch(error){fail(error as Error);}
    });
  });
}

for(const effortOverride of ['default','local-low','env-high'] as const)for(const override of ['default','local-true','local-false','env-true','env-false'] as const)test(`peer and main-coordinated child Workers preserve Fast ${override} and effort ${effortOverride}; capability.models matches every execution`,()=>cleanEnvironment(async()=>{
  const f=fixture(),options:EngineOptions[]=[],models=new Map<EngineOptions,ModelsStatus>(),capabilityErrors:Error[]=[];
  const contract=(goal:string)=>({goal,inputs:[],resultKind:'structured',acceptance:{criteria:[{id:'facts',required:true,description:'Synthetic only'}]}});
  let sequence=0;
  class Peer extends EventEmitter implements EngineLike{
    threadId='synthetic-role-'+ ++sequence;turnId?:string;release?:(value:TurnResult)=>void;
    constructor(readonly opts:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();options.push(opts);}
    async start(){return this.threadId;}
    async call(tool:string,args:unknown):Promise<any>{return this.tool({threadId:this.threadId,turnId:this.turnId!,callId:'synthetic-call-'+ ++sequence,tool,arguments:args});}
    async delegate(parentTaskId:string|null,goal:string,executorKind='worker'){
      const parent=parentTaskId?await this.call('work_inspect',{taskId:parentTaskId,runId:null,resultId:null}):null;
      return this.call('task_delegate',{operationId:'synthetic-op-'+ ++sequence,parentTaskId,parentVersion:parent?.task.headVersion??null,expectedTaskRevision:parent?.task.revision??null,title:parentTaskId?null:'Synthetic root',executorKind,contract:contract(goal),dependencies:[]});
    }
    async turn(text:string,on?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId='synthetic-turn-'+ ++sequence;on?.onStarted?.(this.turnId);
      try{models.set(this.opts,await capabilityModels(this.opts));}catch(error){capabilityErrors.push(error as Error);throw error;}
      if(this.opts.tools.some(t=>t.name==='read_material')){
        return new Promise(resolve=>{this.release=resolve;});
      }
      if(text==='synthetic:start'){
        await this.delegate(null,'parent');await this.delegate(null,'peer');
        const root=await this.delegate(null,'root','main');await this.delegate(root.taskId,'child');
      }
      return {status:'completed',text:'Synthetic accepted'};
    }
    async interrupt(){this.release?.({status:'interrupted',text:''});return true;}
    async close(){await this.interrupt();return true;}
  }
  const local=override==='default'?undefined:override.startsWith('env-')?override!=='env-true':override==='local-true';
  if(override.startsWith('env-'))process.env.HOMER_FAST=String(override==='env-true');
  if(effortOverride==='env-high')process.env.HOMER_EFFORT='high';
  const config=f.read({requiresOpenaiAuth:false,stopGraceMs:100,...(local===undefined?{}:{fast:local}),...(effortOverride==='default'?{}:{effort:'low'})});
  const app=new Homer(config,async()=>{},(o,h)=>new Peer(o,h));
  app['nativeRpc']=async(method:string)=>{assert.equal(method,'model/list');return {data:[{id:config.model,model:config.model,supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'},{reasoningEffort:'low'}]}]};};
  try{
    await app.start();await app.message('synthetic:start','synthetic-fast-source');
    const end=Date.now()+4000;
    while(models.size<4){if(Date.now()>end)throw capabilityErrors[0]??Error('synthetic_worker_timeout:'+models.size+':'+options.length);await new Promise(r=>setTimeout(r,5));}
    const workers=options.filter(o=>o.tools.some(t=>t.name==='read_material'));
    assert.equal(workers.length,3);for(const worker of workers)assert.equal(worker.role,'worker');
    assert.equal(app.tasks.tasks().filter(t=>!!t.parentTaskId).length,1);
    assert.equal(options[0]!.role,undefined);
    const userModels=await app.manageCapabilities({action:'models'},'user') as ModelsStatus;
    assert.deepEqual(userModels.configured,models.get(options[0]!)!.configured);
    // Compare main + peer and main-coordinated child Workers' actual model DTOs with actual startup/turn parameters.
    for(const execution of [options[0]!,...workers]){
      const effective=override==='default'||override.endsWith('true');
      const configured=models.get(execution)!.configured;
      assert.equal(configured.fast,effective);
      assert.equal(configured.model,'gpt-6.1-sol');assert.equal(configured.effort,effortOverride==='env-high'?'high':effortOverride==='local-low'?'low':execution.role==='worker'?'high':'medium');
      assert.equal(configured.effortListed,true);
      const engine=new CodexEngine({...config,codexBin:resolve('tests/fixtures/model-settings-app-server.mjs')},{...execution,interactionMcp:undefined},async()=>({}));
      try{await engine.start();const result=JSON.parse((await engine.turn('Synthetic captured execution options')).text);assert.equal(result.threadServiceTier,configured.fast?'priority':null);assert.equal(result.turnServiceTier,configured.fast?'priority':null);assert.equal(result.model,configured.model);assert.equal(result.effort,configured.effort);}finally{await engine.close();}
    }
  }finally{await app.close();f.close();}
}));
