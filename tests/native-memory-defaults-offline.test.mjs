// Opt-in pinned binary check: fresh synthetic HOME and scripted loopback responses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,copyFileSync,writeFileSync,readFileSync,rmSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CodexEngine} from '../src/engine.ts';

const binary=process.env.HOMER_OFFLINE_CODEX_BIN;
test('fixed native engine initializes only fresh main memory and preserves resumed modes and withdrawal notes',{
 skip:binary?false:'Set HOMER_OFFLINE_CODEX_BIN to the pinned 0.163.0 binary; never uses a real account or model.',
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
 const manifest=JSON.stringify({format:2,node:'22.22.0',codex:'0.163.0',codeFiles:['Contents/MacOS/homer-image-decoder','Contents/MacOS/homer-window-capture','Contents/MacOS/node'].map(path=>({path,sha256:hash(join(bundleRoot,path))}))});
 writeFileSync(join(resources,'desktop-manifest.json'),manifest);
 const configPath=join(home,'config.toml'),notes=join(home,'memories/extensions/ad_hoc/notes');mkdirSync(notes,{recursive:true});
 writeFileSync(configPath,'[memories]\nuse_memories = true\n');
 const withdrawal=join(notes,'2026-10-30T00-00-00-synthetic-withdrawal.md');
 writeFileSync(withdrawal,'Synthetic preference withdrawn. Do not use or reconstruct it.\n');
 const preserved=[configPath,withdrawal].map(path=>[path,hash(path)]);
 const requests=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
  const data=JSON.parse(body);requests.push({model:data.model,effort:data.reasoning?.effort});
  const response={id:'synthetic-'+requests.length,object:'response',model:data.model,status:'completed',output:[{id:'synthetic-message-'+requests.length,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic offline response; no real model.',annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.setHeader('Content-Type','text/event-stream');
  for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item:response.output[0]},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
  res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connection={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false};
 const config={appData:root,workspace,runtime,codexHome:home,nativeCodexHome:home,codexBin:resolve(binary),...connection,desktopConnection:{main:connection,worker:connection},requiresOpenaiAuth:false,keyEnv:'HOMER_DEEPSEEK_TOKEN',stopGraceMs:1000,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot,manifestSha256:createHash('sha256').update(manifest).digest('hex')}};
 const mode=thread=>{
  const db=new DatabaseSync(join(home,'state_5.sqlite'),{readOnly:true});
  try{return db.prepare('SELECT memory_mode FROM threads WHERE id = ?').get(thread)?.memory_mode;}
  finally{db.close();}
 };
 async function start(role,threadId,controlOnly=false){
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
    assert.equal(effective.extract_model,'deepseek-flash');assert.equal(effective.consolidation_model,'deepseek-flash');
   }
   if(!threadId&&!controlOnly)assert.equal((await engine.turn('Synthetic metadata persistence only.')).status,'completed');
   for(const [path,before] of preserved)assert.equal(hash(path),before);
   return id;
  }finally{t.signal.removeEventListener('abort',abort);assert.equal(await engine.close(),true);}
 }
 try{
  process.execPath=join(mac,'node');process.env.HOMER_DEEPSEEK_TOKEN='synthetic-offline-no-real-account';
  const main=await start('main');assert.equal(mode(main),'enabled');
  assert.equal(await start('main',main),main);assert.equal(mode(main),'enabled');
  const worker=await start('worker');assert.equal(mode(worker),'disabled');
  assert.equal(await start('main',worker),worker);assert.equal(mode(worker),'disabled');
  assert.equal(await start('worker',main),main);assert.equal(mode(main),'enabled');
  const beforeControl=requests.length;
  assert.equal(await start(undefined,undefined,true),'');
  assert.equal(requests.length,beforeControl);
  assert.ok(requests.length>=2);
  assert.ok(requests.every(request=>request.model==='deepseek-flash'),'all scripted requests must use the explicitly bound model');
  const efforts=Object.fromEntries([...new Set(requests.map(request=>request.effort))].map(effort=>[effort,requests.filter(request=>request.effort===effort).length]));
  console.log('Native metadata verified: new main enabled; new Worker disabled; resumed modes and withdrawal preserved; scripted loopback requests='+requests.length+'; efforts='+JSON.stringify(efforts)+'; real model requests=0.');
 }finally{
  process.execPath=originalExecPath;
  if(tokenBefore===undefined)delete process.env.HOMER_DEEPSEEK_TOKEN;else process.env.HOMER_DEEPSEEK_TOKEN=tokenBefore;
  await new Promise(resolve=>server.close(resolve));
  rmSync(root,{recursive:true,force:true});
 }
});
