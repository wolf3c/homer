// Fixed 0.163 native local plugin lifecycle; empty HOME, no model/auth/network.
import {CodexEngine}from '../src/engine.js';
import{mkdirSync,mkdtempSync,writeFileSync,rmSync}from'node:fs';import{resolve,join}from'node:path';import assert from'node:assert/strict';
const base=resolve('.codex/scratch/native-capability-unlock/local-plugin-probe');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'case-')),home=join(dir,'codex'),market=join(home,'market'),plugin=join(market,'sample');for(const x of [home,join(home,'homer-control'),join(plugin,'.codex-plugin'),join(plugin,'skills/sample'),join(dir,'workspace'),join(dir,'runtime')])mkdirSync(x,{recursive:true});
writeFileSync(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:'sample',version:'1.0.0',description:'Synthetic local native install only'}));writeFileSync(join(plugin,'skills/sample/SKILL.md'),'---\nname: sample\ndescription: Synthetic local plugin discovery\n---\n\nNo executable or network.\n');
const path=join(market,'.agents/plugins/marketplace.json');mkdirSync(join(market,'.agents/plugins'),{recursive:true});writeFileSync(path,JSON.stringify({name:'synthetic-native',plugins:[{name:'sample',source:{source:'local',path:'./sample'}}]}));
const binary=process.argv[2];if(!binary)throw Error('fixed_native_binary_required');const config={codexBin:resolve(binary),model:'synthetic-no-model',requiresOpenaiAuth:false,codexHome:home,nativeCodexHome:home,appData:dir,workspace:join(dir,'workspace'),runtime:join(dir,'runtime'),stopGraceMs:1000};
const engine=new CodexEngine(config,{cwd:home+'/homer-control',readRoots:[],instructions:'No model and no thread. Local synthetic plugin only.',tools:[],controlOnly:true},async()=>{throw Error('no_tools')});
try{
 await engine.start();
 const target={pluginName:'sample',marketplacePath:path};
 const read=()=>engine.request('plugin/read',target);
 assert.equal((await read()).plugin.summary.installed,false);
 await engine.request('plugin/install',target);
 const detail=await read();
 assert.equal(detail.plugin.summary.installed,true);
 const list=async()=>(await engine.request('skills/list',{cwds:[config.workspace],forceReload:true})).data.flatMap((d:any)=>d.skills??[]);
 const skill=(await list()).find((s:any)=>s.name.includes('sample'));
 assert.ok(skill);
 for(const enabled of [false,true]){
  await engine.request('skills/config/write',{path:skill.path,enabled});
  assert.equal((await list()).find((s:any)=>s.path===skill.path)?.enabled,enabled);
 }
 await engine.request('plugin/uninstall',{pluginId:detail.plugin.summary.id});
 assert.equal((await read()).plugin.summary.installed,false);
 console.log(JSON.stringify({fixed:'0.163.0',isolatedHome:true,nativeReadInstallDiscoverToggleUninstall:true}));
}finally{if(await engine.close())rmSync(dir,{recursive:true,force:true});}
