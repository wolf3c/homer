import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexEngine,codexVersion} from '../src/engine.ts';

// Opt-in real pinned engine, scripted loopback Responses; no supplier or real Key.
const binary=process.env.HOMER_TEST_CODEX;
test('real Codex 163 uses both configured roles with max/non-Fast and writes files without the model Key in tools',{skip:!binary,timeout:60000},async t=>{
 assert.equal(codexVersion(binary),'codex-cli 0.163.0');
 const bundle=resolve(binary).split('/Contents/')[0];assert.ok(bundle.endsWith('.app'),'use the pinned packaged engine');
 const desktopResources={bundleRoot:bundle,manifestSha256:createHash('sha256').update(readFileSync(join(bundle,'Contents/Resources/desktop-manifest.json'))).digest('hex')};
 const parent=resolve('.codex/scratch/account-mvp/native');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'synthetic-'));for(const part of ['runtime','workspace','codex'])mkdirSync(join(root,part),{mode:0o700});
 const seen=[],steps=new Map(),extra=[];let requestShape,currentRole;
 const server=createServer(async(req,res)=>{
  assert.equal(req.url,'/v1/responses');assert.equal(req.headers.authorization,'Bearer synthetic-native-account');
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);
  assert.notEqual(data.service_tier,'priority');
  if(data.reasoning?.effort==='medium'||data.model!=='deepseek-flash'){
   extra.push({model:data.model,effort:data.reasoning?.effort});
   seen.push(data.model);res.setHeader('Content-Type','text/event-stream');const response={id:'synthetic-background',object:'response',status:'completed',output:[],usage:{input_tokens:1,output_tokens:0,total_tokens:1}};res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response})+'\n\n');return;
  }
  assert.equal(data.reasoning.effort,'max');assert.notEqual(data.service_tier,'priority');
  requestShape??=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,Array.isArray(value)?'array':value===null?'null':typeof value]));
  seen.push(data.model);const step=steps.get(currentRole)??0;steps.set(currentRole,step+1);
  const role=currentRole;
  const command='test -z "$HOMER_DEEPSEEK_TOKEN" && printf native-'+role+' > '+role+'.md';
  const tool=data.tools.find(tool=>['exec_command','shell_command'].includes(tool.name));assert.ok(tool);
  const item=step===0?{id:'call-'+role,type:'function_call',name:tool.name,call_id:'synthetic-'+role,arguments:JSON.stringify(tool.name==='exec_command'?{cmd:command,login:false}:{command,login:false})}:{id:'msg-'+role,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic native file completed.',annotations:[]}]};
  const response={id:'response-'+seen.length,object:'response',model:data.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  res.setHeader('Content-Type','text/event-stream');
  for(const e of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,...(item.type==='message'?{content:[]}:{})}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const saved=Object.fromEntries(['HOMER_DEEPSEEK_TOKEN','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{HOMER_DEEPSEEK_TOKEN:'synthetic-native-account',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1'});
 try{
  for(const role of ['main','worker']){
   currentRole=role;
   const engine=new CodexEngine({appData:root,runtime:join(root,'runtime'),workspace:join(root,'workspace'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:binary,model:'deepseek-flash',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',keyEnv:'HOMER_DEEPSEEK_TOKEN',effort:'max',fast:false,dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources,desktopConnection:{main:{baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false},worker:{baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'deepseek-flash',context:{contextWindow:512000,autoCompactTokenLimit:400000,autoCompactTokenLimitScope:'total'},effort:'max',fast:false}},requiresOpenaiAuth:false,stopGraceMs:3000},{role,cwd:join(root,'workspace'),readRoots:[],instructions:'Synthetic scripted local test only.',tools:[],nativeCapabilities:true,nativeTools:role,permissionRequests:true,onInteraction:async()=>({status:'denied',decision:{action:'deny',reason:'synthetic_unexpected_approval'}})},async()=>{throw Error('unexpected_host_tool');});
   try{await engine.start();const result=await engine.turn('Synthetic local '+role+' file.');assert.equal(result.status,'completed');assert.ok(existsSync(join(root,'workspace',role+'.md')),'file missing; request models '+JSON.stringify(seen));assert.equal(readFileSync(join(root,'workspace',role+'.md'),'utf8'),'native-'+role);}
   finally{assert.equal(await engine.close(),true);}
  }
  for(const role of ['main','worker'])assert.ok((steps.get(role)??0)>=2,'both ordinary tool and reply requests must use max');
  assert.ok(extra.length>0,'fresh native HOME must exercise background consolidation');
  for(const background of extra){assert.equal(background.model,'deepseek-flash','unexpected background model: '+background.model);assert.equal(background.effort,'medium');}
  t.diagnostic(JSON.stringify({synthetic:true,requestShape}));
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
