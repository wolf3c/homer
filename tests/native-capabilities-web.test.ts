import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createWebServer,fetch} from './web-connected-fixture.js';
import type {WebBridge} from '../src/web-contract.js';

test('retired capability page and management HTTP routes return 404 without reaching any owner',async()=>{
 const root=resolve('.codex/scratch/remove-capability-settings-20261023');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'routes-'));writeFileSync(join(dir,'index.html'),'<main>synthetic chat shell</main>');
 mkdirSync(join(dir,'assets'));writeFileSync(join(dir,'assets','chat.js'),'/* synthetic chat asset */');
 let calls=0;const forbidden=async()=>{calls++;throw Error('retired_management_reached_owner');};
 const bridge:WebBridge={state:async()=>({threadId:'synthetic-retired-capability',messages:[],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}}),submit:forbidden,stop:async()=>{},respond:async()=>{},artifact:forbidden};
 // Even an older bridge must never make the removed transport reachable.
 Object.assign(bridge,{capabilities:{state:forbidden,manage:forbidden}});
 const web=await createWebServer({port:0,bridge,uiDirectory:dir});
 try{
  assert.equal(await (await fetch(web.url+'/')).text(),'<main>synthetic chat shell</main>');
  assert.equal((await fetch(web.url+'/assets/chat.js')).status,200);
  for(const path of ['/settings/capabilities','/settings/capabilities/','/api/capabilities']){
   const response=await fetch(web.url+path);assert.equal(response.status,404,path);assert.deepEqual(await response.json(),{error:'route_not_found'});
  }
  for(const action of ['state','catalog','models','discover','plugin_search','plugin_read','plugin_install','plugin_uninstall','skill_read','skill_save','skill_toggle','skill_remove','mcp_save','mcp_toggle','mcp_remove','tools_configure','oauth','oauth_logout','account_state','account_login','account_cancel','account_logout']){
   const response=await fetch(web.url+'/api/capabilities',{method:'POST',headers:{'Content-Type':'application/json',Origin:web.url},body:JSON.stringify({action,approve:true})});
   assert.equal(response.status,404,action);assert.deepEqual(await response.json(),{error:'route_not_found'});
  }
  const foreign=await fetch(web.url+'/api/capabilities',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:'{}'});
  assert.equal(foreign.status,403,'existing Origin fence remains');assert.equal(calls,0);
 }finally{await web.close();rmSync(dir,{recursive:true,force:true});}
});
