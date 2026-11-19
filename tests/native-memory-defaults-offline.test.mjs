import './fixtures/synthetic-home.mjs';
// Opt-in pinned binary check: fresh synthetic HOME and scripted loopback responses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,copyFileSync,writeFileSync,readFileSync,rmSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {CodexEngine} from '../src/engine.ts';

const binary=process.env.HOMER_OFFLINE_CODEX_BIN;
test('fixed native engine uses its default membership memory models and preserves memory modes and notes',{
 skip:binary?false:'Set HOMER_OFFLINE_CODEX_BIN to the pinned 0.171.0-alpha.7 binary; never uses a real account or model.',
 timeout:120000,
},async(t)=>{
 const parent=resolve('.codex/scratch/main-memory-extraction-20261030');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'native-')),home=join(root,'codex'),workspace=join(root,'workspace'),runtime=join(root,'runtime');
 const bundleRoot=join(root,'Synthetic.app'),mac=join(bundleRoot,'Contents/MacOS'),resources=join(bundleRoot,'Contents/Resources');
 for(const dir of [home,workspace,runtime,mac,resources])mkdirSync(dir,{recursive:true,mode:0o700});
 const originalExecPath=process.execPath,tokenBefore=process.env.HOMER_DEEPSEEK_TOKEN;
 copyFileSync(originalExecPath,join(mac,'node'),constants.COPYFILE_FICLONE);
 writeFileSync(join(mac,'homer-image-decoder'),'synthetic helper; never executed');
 writeFileSync(join(mac,'homer-window-capture'),'synthetic capture helper; never executed');
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 const manifest=JSON.stringify({format:2,node:'22.22.0',codex:'0.171.0-alpha.7',codeFiles:['Contents/MacOS/homer-image-decoder','Contents/MacOS/homer-window-capture','Contents/MacOS/node'].map(path=>({path,sha256:hash(join(bundleRoot,path))}))});
 writeFileSync(join(resources,'desktop-manifest.json'),manifest);
 const configPath=join(home,'config.toml'),notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});
 writeFileSync(configPath,'[memories]\nuse_memories = true\n');
 const withdrawal=join(notes,'2026-10-30T00-00-00-synthetic-withdrawal.md');
 writeFileSync(withdrawal,'Synthetic preference withdrawn. Do not use or reconstruct it.\n');
 const preserved=[configPath,withdrawal].map(path=>[path,hash(path)]);
 const syntheticToken='synthetic-offline-no-real-account';
 const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
  const data=JSON.parse(body),extraction=!!data.text?.format?.schema?.properties?.raw_memory;
  const kind=extraction?'extraction':req.headers['x-openai-memgen-request']==='true'?'consolidation':'turn';
  requests.push({kind,model:data.model,effort:data.reasoning?.effort,authenticated:req.headers.authorization===`Bearer ${syntheticToken}`});
  const reply=extraction?JSON.stringify({raw_memory:null,rollout_summary:'Synthetic extraction completed.',rollout_slug:'synthetic-memory'}):'Synthetic offline response; no real model.';
  const response={id:'synthetic-'+requests.length,object:'response',model:data.model,status:'completed',output:[{id:'synthetic-message-'+requests.length,type:'message',role:'assistant',content:[{type:'output_text',text:reply,annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.setHeader('Content-Type','text/event-stream');
  for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item:response.output[0]},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
  res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connection={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'gpt-6.1-sol',context:{contextWindow:272000,autoCompactTokenLimit:244800,autoCompactTokenLimitScope:'total'},capabilities:{inputModalities:['text'],reasoningEfforts:['low','medium','high'],webSearch:false,toolSearch:false},effort:'high',fast:false};
 const config={appData:root,workspace,runtime,codexHome:home,nativeCodexHome:home,codexBin:resolve(binary),...connection,desktopModelSource:'website',desktopConnection:{main:connection,worker:connection},requiresOpenaiAuth:false,keyEnv:'HOMER_DEEPSEEK_TOKEN',stopGraceMs:1000,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot,manifestSha256:createHash('sha256').update(manifest).digest('hex')}};
 const mode=thread=>{
  const db=new DatabaseSync(join(home,'state_5.sqlite'),{readOnly:true});
  try{return db.prepare('SELECT memory_mode FROM threads WHERE id = ?').get(thread)?.memory_mode;}
  finally{db.close();}
 };
 async function start(role,threadId,controlOnly=false,expectedMemoryRequest){
  const engine=new CodexEngine(config,{role,threadId,controlOnly,cwd:workspace,readRoots:[],instructions:'Synthetic offline metadata check.',tools:[],nativeTools:role??'main'},async()=>{throw Error('no_tools_allowed');});
  const abort=()=>{void engine.close();};t.signal.addEventListener('abort',abort,{once:true});
  try{
   const id=await engine.start();
   const actual=(await engine.request('config/read',{})).config;
   assert.equal(actual.model_provider,'homer');
   assert.equal(actual.model_providers.homer.base_url,connection.baseUrl,'provider must remain on scripted loopback before any turn');
   const effective=actual.memories;
   if(controlOnly){
    assert.notEqual(actual.features.memories,true);
    assert.equal(id,'');assert.equal(engine.threadId,undefined);
    await engine.request('account/read',{refreshToken:false});
   }else{
    assert.equal(effective.extract_model??null,null);assert.equal(effective.consolidation_model??null,null);
   }
   if(!threadId&&!controlOnly)assert.equal((await engine.turn('Synthetic metadata persistence only.')).status,'completed');
   if(expectedMemoryRequest){
    const matches=request=>request.kind===expectedMemoryRequest.kind;
    const deadline=Date.now()+10000;
    while(!requests.some(matches)&&Date.now()<deadline)await delay(20);
    assert.deepEqual(requests.find(matches),{...expectedMemoryRequest,authenticated:true});
   }
   for(const [path,before] of preserved)assert.equal(hash(path),before);
   return id;
  }finally{t.signal.removeEventListener('abort',abort);assert.equal(await engine.close(),true);}
 }
 try{
  process.execPath=join(mac,'node');process.env.HOMER_DEEPSEEK_TOKEN=syntheticToken;
  const main=await start('main',undefined,false,{kind:'consolidation',model:'gpt-6.1-terra',effort:'medium'});assert.equal(mode(main),'enabled');
  assert.equal(await start('main',main),main);assert.equal(mode(main),'enabled');
  const worker=await start('worker');assert.equal(mode(worker),'disabled');
  assert.equal(await start('main',worker),worker);assert.equal(mode(worker),'disabled');
  assert.equal(await start('worker',main),main);assert.equal(mode(main),'enabled');
  const beforeControl=requests.length;
  assert.equal(await start(undefined,undefined,true),'');
  assert.equal(requests.length,beforeControl);
  // Age only the synthetic Main rollout past Codex's native idle threshold.
  const db=new DatabaseSync(join(home,'state_5.sqlite')),older=Date.now()-48*3600000;
  try{assert.equal(db.prepare('UPDATE threads SET updated_at_ms=?,recency_at_ms=?,tokens_used=4096 WHERE id=?').run(older,older,main).changes,1);}
  finally{db.close();}
  await start('main',undefined,false,{kind:'extraction',model:'gpt-6-luna',effort:'low'});
  assert.ok(requests.some(request=>request.kind==='turn'&&request.model===connection.model&&request.authenticated));
 }finally{
  process.execPath=originalExecPath;
  if(tokenBefore===undefined)delete process.env.HOMER_DEEPSEEK_TOKEN;else process.env.HOMER_DEEPSEEK_TOKEN=tokenBefore;
  await new Promise(resolve=>server.close(resolve));
  rmSync(root,{recursive:true,force:true});
 }
});
