import{test}from'node:test';import assert from'node:assert/strict';import{resolve,join}from'node:path';import{NativeCapabilities}from'../src/native-capabilities.js';
test('native search returns an exact reusable remote or local review target',async()=>{
 const home=resolve('.codex/scratch/discovery-search/codex'),reads:any[]=[];
 const manager=new NativeCapabilities(home,async(method,params)=>{
  if(method==='plugin/search')return {data:[{plugin:{name:'remote',id:'remote@catalog'},marketplaceName:'catalog',marketplacePath:null},{plugin:{name:'local',id:'local@local'},marketplaceName:'local',marketplacePath:home+'/marketplace.json'}],nextCursor:'native-next'};
  if(method==='plugin/read'){reads.push(params);return {plugin:{summary:{name:params.pluginName,id:params.pluginName+'@native'}}};}throw Error('unexpected_rpc');
 },()=>true);
 const found=await manager.manage({action:'plugin_search',query:'design'},'agent');
 assert.equal(found.nextCursor,'native-next');
 for(const item of found.data)await manager.manage({action:'plugin_read',target:item.target},'agent');
 assert.deepEqual(reads,[{pluginName:'remote',remoteMarketplaceName:'catalog'},{pluginName:'local',marketplacePath:home+'/marketplace.json'}]);
});
function setup(){const home=resolve('.codex/scratch/discovery-unit/codex'),calls:{m:string;p:any}[]=[];let fail=false,changed=false;const rpc=async(m:string,p:any)=>{calls.push({m,p});if(m==='config/read')return {layers:[{name:{type:'user',file:join(home,'config.toml')},version:'1',config:{}}]};if(m==='plugin/list'){if(fail)throw Error('engine_authentication_failed');return {marketplaces:[],marketplaceLoadErrors:[]};}if(m==='plugin/read')return {plugin:{summary:{id:'sample@native',name:'sample',installed:false,version:changed?'2':'1',source:{type:'local',path:home+'/plugins/sample'}},skills:[],hooks:[],apps:[],mcpServers:[]}};if(m==='plugin/install')return {authPolicy:'ON_INSTALL',appsNeedingAuth:[]};if(m==='app/list')return {data:[],nextCursor:null};if(m==='experimentalFeature/list')return {data:[{name:'browser_use',enabled:true,defaultEnabled:true,stage:'stable'}]};if(m==='modelProvider/capabilities/read')return {webSearch:true,imageGeneration:true};if(m==='skills/list')return {data:[{skills:[{name:'own',path:home+'/skills/own/SKILL.md'},{name:'ambient',path:'/outside/SKILL.md'}]}]};return {};};return {home,calls,manager:new NativeCapabilities(home,rpc,()=>true),fail:()=>fail=true,change:()=>changed=true};}
test('remote install and uninstall use the native backend identity and reject a changed uninstall review',async()=>{
 const home=resolve('.codex/scratch/remote-identity/codex'),mutations:any[]=[];let installed=false,version='1';
 const manager=new NativeCapabilities(home,async(method,params)=>{
  if(method==='config/read')return {layers:[{name:{type:'user',file:home+'/config.toml'},version:'config',config:{}}]};
  if(method==='plugin/read')return {plugin:{summary:{id:'sample@catalog',name:'sample',remotePluginId:'plugins_backend',source:{type:'remote'},installed,version}}};
  if(['plugin/install','plugin/uninstall'].includes(method)){mutations.push({method,...params});installed=method==='plugin/install';return {};}
  throw Error('unexpected_rpc');
 },()=>true),target={pluginName:'sample',remoteMarketplaceName:'catalog'};
 const detail=await manager.manage({action:'plugin_read',target},'agent');
 await manager.manage({action:'plugin_install',target,reviewHash:detail.reviewHash,expectedVersion:'config',approve:true},'user');
 assert.equal(mutations[0].pluginName,'plugins_backend');
 const before=await manager.manage({action:'plugin_read',target},'agent');version='2';
 await assert.rejects(()=>manager.manage({action:'plugin_uninstall',target,pluginId:'sample@catalog',reviewHash:before.reviewHash,expectedVersion:'config',approve:true},'user'),/capability_plugin_review_conflict/);
 assert.equal(mutations.length,1);
 const current=await manager.manage({action:'plugin_read',target},'agent');
 await manager.manage({action:'plugin_uninstall',target,pluginId:'sample@catalog',reviewHash:current.reviewHash,expectedVersion:'config',approve:true},'user');
 assert.equal(mutations[1].pluginId,'plugins_backend');
});
test('remote review uses the canonical native identity when slug metadata has stale installed state',async()=>{
 const home=resolve('.codex/scratch/remote-review/codex');let reads=0;
 const manager=new NativeCapabilities(home,async(method,params)=>{assert.equal(method,'plugin/read');reads++;return {plugin:{summary:{id:'sample@catalog',name:'sample',remotePluginId:'plugins_backend',installed:params.pluginName==='plugins_backend'}}};},()=>true);
 const detail=await manager.manage({action:'plugin_read',target:{pluginName:'sample',remoteMarketplaceName:'catalog'}},'agent');
 assert.equal(detail.plugin.summary.installed,true);assert.equal(detail.target.pluginName,'plugins_backend');assert.equal(reads,2);
});
test('search prefers native backend identity and canonical resolution cannot switch plugins',async()=>{
 const home=resolve('.codex/scratch/remote-review-conflict/codex');
 const manager=new NativeCapabilities(home,async(method,params)=>{
  if(method==='plugin/search')return {data:[{plugin:{name:'sample',remotePluginId:'plugins_backend'},marketplaceName:'catalog',marketplacePath:null}]};
  assert.equal(method,'plugin/read');return {plugin:{summary:{id:params.pluginName==='sample'?'sample@catalog':'other@catalog',remotePluginId:'plugins_backend'}}};
 },()=>true);
 const found=await manager.manage({action:'plugin_search',query:'sample'},'agent');assert.equal(found.data[0].target.pluginName,'plugins_backend');
 await assert.rejects(()=>manager.manage({action:'plugin_read',target:{pluginName:'sample',remoteMarketplaceName:'catalog'}},'agent'),/capability_plugin_target_conflict/);
});
test('discovery reuses native services without authorizing installation and preserves partial failures',async()=>{const f=setup();f.fail();const d=await f.manager.manage({action:'discover'},'user');assert.equal(d.plugins.error,'engine_authentication_failed');assert.equal(d.provider.value.webSearch,true);assert.deepEqual(d.skills.value.data[0].skills.map((s:any)=>s.name),['own']);assert.equal(d.apps.value.data.length,0);assert.equal(f.calls.some(x=>x.m==='plugin/install'),false);});
test('plugin installation requires actual user approval and exact reviewed native metadata',async()=>{const f=setup(),target={pluginName:'sample',marketplacePath:f.home+'/plugins/marketplace.json'};const detail=await f.manager.manage({action:'plugin_read',target},'user');await assert.rejects(()=>f.manager.manage({action:'plugin_install',target,reviewHash:detail.reviewHash,expectedVersion:'1',approve:true},'agent'),/capability_user_approval_required/);assert.equal(f.calls.some(x=>x.m==='plugin/install'),false);f.change();await assert.rejects(()=>f.manager.manage({action:'plugin_install',target,reviewHash:detail.reviewHash,expectedVersion:'1',approve:true},'user'),/capability_plugin_review_conflict/);const next=await f.manager.manage({action:'plugin_read',target},'user');await f.manager.manage({action:'plugin_install',target,reviewHash:next.reviewHash,expectedVersion:'1',approve:true},'user');assert.equal(f.calls.filter(x=>x.m==='plugin/install').length,1);});
test('discovery does not permit an arbitrary native RPC or outside-home local marketplace',async()=>{const f=setup();await assert.rejects(()=>f.manager.manage({action:'plugin_read',target:{pluginName:'bad',marketplacePath:'/outside/marketplace.json'}},'user'),/capability_path_denied/);await assert.rejects(()=>f.manager.manage({action:'native_rpc',method:'process/spawn'},'user'),/capability_/);});
