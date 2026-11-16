import './fixtures/synthetic-home.mjs';
// Explicit native acceptance: fresh homes, local plugin/MCP and a loopback-only Git proxy.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {CodexEngine,codexVersion} from '../src/engine.ts';
import {captureUnixChildren,terminateUnixChildren,processIdentity,leaseOwnerGone} from '../src/processes.ts';

const binary=process.env.HOMER_TEST_CODEX_BIN;
test('fixed native Worker preserves plugins and drains captured startup Git after stdio EOF',{
 skip:!binary||process.platform==='win32',timeout:60000,
},async t=>{
 assert.equal(codexVersion(binary),'codex-cli 0.171.0-alpha.7');
 const parent=resolve('.codex/scratch/native-plugin-shutdown');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),home=join(root,'codex'),workspace=join(root,'workspace');
 for(const path of [home,workspace,join(root,'runtime'),join(root,'tmp')])mkdirSync(path,{mode:0o700});
 writeFileSync(join(home,'config.toml'),'[features]\nplugins=true\n[memories]\ngenerate_memories=false\nuse_memories=false\n');
 const marketplace=join(root,'market'),plugin=join(marketplace,'sample');
 for(const path of [join(marketplace,'.agents/plugins'),join(plugin,'.codex-plugin'),join(plugin,'skills/sample')])mkdirSync(path,{recursive:true});
 writeFileSync(join(marketplace,'.agents/plugins/marketplace.json'),JSON.stringify({name:'synthetic-shutdown',plugins:[{name:'sample',source:{source:'local',path:'./sample'}}]}));
 writeFileSync(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:'sample',version:'1.0.0',description:'Synthetic local plugin'}));
 writeFileSync(join(plugin,'skills/sample/SKILL.md'),'---\nname: sample\ndescription: Synthetic shutdown acceptance\n---\nNo executable or network.\n');
 const mcp=join(root,'mcp.mjs');
 writeFileSync(mcp,`import{createInterface}from'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line);if(message.id===undefined)return;let result={};
 if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic-shutdown',version:'1'}};
 if(message.method==='tools/list')result={tools:[{name:'shutdown_echo',description:'Synthetic local echo',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 if(message.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({marker:'synthetic shutdown MCP',pid:process.pid})}],isError:false};
 if(message.method==='resources/list')result={resources:[]};if(message.method==='resources/templates/list')result={resourceTemplates:[]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
});
`);
 const sockets=new Set();let blockedConnects=0,modelRequests=0;
 const proxy=createServer((req,res)=>{if(req.url?.includes('/responses'))modelRequests++;res.writeHead(403).end();});
 proxy.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 // Hold CONNECT before any tunnel is established; no external traffic is forwarded.
 proxy.on('connect',()=>{blockedConnects++;});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+proxy.address().port;
 const proxyKeys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'],keys=[...proxyKeys,'NO_PROXY','no_proxy','TMPDIR'];
 const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 for(const key of proxyKeys)process.env[key]=origin;
 process.env.NO_PROXY=process.env.no_proxy='127.0.0.1,localhost';process.env.TMPDIR=join(root,'tmp');
 const config={codexBin:binary,model:'gpt-6.1-sol',requiresOpenaiAuth:false,baseUrl:origin+'/v1',codexHome:home,nativeCodexHome:home,workspace,runtime:join(root,'runtime'),stopGraceMs:1000};
 const tool={name:'shutdown_echo',description:'Synthetic local echo',inputSchema:{type:'object',properties:{},additionalProperties:false}};
 const engine=new CodexEngine(config,{role:'worker',cwd:workspace,readRoots:[],instructions:'Local plugin and MCP shutdown only; no model turn.',tools:[],nativeTools:'worker',interactionMcp:{command:process.execPath,args:[mcp],cwd:root,catalog:[tool]}},async()=>{throw Error('no_model_tools');});
 let captured,mcpPid,stopped=false;
 try{
  await engine.start();
  const target={pluginName:'sample',marketplacePath:join(marketplace,'.agents/plugins/marketplace.json')};
  assert.equal((await engine.request('plugin/read',target)).plugin.summary.installed,false);
  await engine.request('plugin/install',target);
  const detail=await engine.request('plugin/read',target);assert.equal(detail.plugin.summary.installed,true);
  const skills=async()=>(await engine.request('skills/list',{cwds:[workspace],forceReload:true})).data.flatMap(entry=>entry.skills??[]);
  const skill=(await skills()).find(value=>value.name.includes('sample'));assert.ok(skill);
  for(const enabled of [false,true]){await engine.request('skills/config/write',{path:skill.path,enabled});assert.equal((await skills()).find(value=>value.path===skill.path)?.enabled,enabled);}
  await engine.request('plugin/uninstall',{pluginId:detail.plugin.summary.id});
  assert.equal((await engine.request('plugin/read',target)).plugin.summary.installed,false);
  let ready=false;
  for(let n=0;n<100;n++){
   const status=await engine.request('mcpServerStatus/list',{threadId:engine.threadId,detail:'full',limit:100});
   ready=status.data.some(server=>server.name==='homer_interactions'&&server.tools.shutdown_echo);
   if(ready&&blockedConnects>0)break;await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.ok(ready,'the real stdio MCP child must connect');assert.ok(blockedConnects>0,'curated startup Git must be held at the loopback proxy');
  const result=await engine.request('mcpServer/tool/call',{threadId:engine.threadId,server:'homer_interactions',tool:'shutdown_echo',arguments:{}});const mcpResult=JSON.parse(result.content[0].text);assert.equal(mcpResult.marker,'synthetic shutdown MCP');mcpPid=mcpResult.pid;assert.ok(Number.isSafeInteger(mcpPid)&&mcpPid>1);
  const identity=processIdentity(engine.pid);assert.ok(identity);captured=captureUnixChildren({pid:engine.pid,identity});assert.ok(captured?.children.length,'startup Git must remain owned before EOF');
  stopped=await engine.close();assert.equal(stopped,true,'native EOF must clean only proven owned descendants');assert.equal(leaseOwnerGone(engine.pid),true);assert.equal(leaseOwnerGone(mcpPid),true,'native MCP child and its own group must drain');assert.equal(modelRequests,0);
  t.diagnostic(JSON.stringify({pluginsEnabled:true,localPluginLifecycle:true,stdioMcp:true,mcpGroupGone:true,blockedExternalConnects:blockedConnects,modelRequests,groupGone:true}));
 }finally{
  if(!captured&&engine.pid){const identity=processIdentity(engine.pid);if(identity)captured=captureUnixChildren({pid:engine.pid,identity});}
  stopped=await engine.close();if(!stopped)stopped=await terminateUnixChildren(captured,1000);
  for(const socket of sockets)socket.destroy();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));
  for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  if(stopped)rmSync(root,{recursive:true,force:true});
  assert.equal(stopped,true,'fixture processes must be confirmed stopped before removing their home');
 }
});
