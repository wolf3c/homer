import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';

async function restoredPolicy(config:Record<string,unknown>,layers:unknown[]){
 const parent=resolve('.codex/scratch/runtime-policy');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),cwd=join(root,'work'),home=join(root,'codex');
 for(const dir of [cwd,home])mkdirSync(dir);
 const configLayers=layers.map((layer:any)=>({version:'synthetic-version',disabledReason:null,...layer,name:{...layer.name,...(layer.name.type==='user'?{file:join(home,'config.toml')}:{})}}));
 writeFileSync(join(cwd,'fixture-state.json'),JSON.stringify({config:{config:{mcp_servers:{},...config},layers:configLayers}}));
 const engine=new CodexEngine({workspace:cwd,runtime:join(root,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:resolve('tests/fixtures/project-mcp-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,fast:false,stopGraceMs:500},{cwd,role:'main',nativeTools:'main',threadId:'saved-thread',readRoots:[],instructions:'Synthetic policy contract.',tools:[]},async()=>{throw Error('no_model_tools');});
 try{await engine.start();const info=await engine.request('fixture/inspect',{});return info.calls.find((call:any)=>call.method==='thread/resume').params;}
 finally{assert.ok(await engine.close());rmSync(root,{recursive:true,force:true});}
}

test('restored native policy preserves saved permissions when no trusted layer selects a replacement',async()=>{
 const result=await restoredPolicy({sandbox_mode:'read-only',approval_policy:'on-request'},[
  {name:{type:'user'},config:{}},
  {name:{type:'project'},disabledReason:'Project is not trusted',config:{sandbox_mode:'danger-full-access',approval_policy:'never'}},
 ]);
 for(const key of ['sandbox','permissions','approvalPolicy','approvalsReviewer'])assert.equal(Object.hasOwn(result,key),false);
});

test('restored native policy adopts the resolved explicit sandbox and approval choices',async()=>{
 const result=await restoredPolicy({sandbox_mode:'workspace-write',approval_policy:'on-request',approvals_reviewer:'user'},[
  {name:{type:'user'},config:{sandbox_mode:'workspace-write',approval_policy:'on-request',approvals_reviewer:'user'}},
 ]);
 assert.equal(result.sandbox,'workspace-write');assert.equal(result.approvalPolicy,'on-request');assert.equal(result.approvalsReviewer,'user');assert.equal(Object.hasOwn(result,'permissions'),false);
});

test('restored named permissions retain their native profile instead of adding a legacy sandbox override',async()=>{
 const result=await restoredPolicy({default_permissions:'selected-project',sandbox_mode:'read-only',approval_policy:'on-request'},[
  {name:{type:'user'},config:{default_permissions:'selected-project'}},
 ]);
 assert.equal(result.permissions,'selected-project');assert.equal(Object.hasOwn(result,'sandbox'),false);assert.equal(Object.hasOwn(result,'approvalPolicy'),false);
});

test('higher project sandbox overrides a lower user named full-access profile on resume',async()=>{
 const result=await restoredPolicy({default_permissions:':danger-full-access',sandbox_mode:'read-only'},[
  {name:{type:'project'},config:{sandbox_mode:'read-only'}},
  {name:{type:'user'},config:{default_permissions:':danger-full-access'}},
 ]);
 assert.equal(result.sandbox,'read-only');assert.equal(Object.hasOwn(result,'permissions'),false);
});

test('higher project named permissions override a lower user legacy sandbox on resume',async()=>{
 const result=await restoredPolicy({default_permissions:'selected-project',sandbox_mode:'danger-full-access'},[
  {name:{type:'project'},config:{default_permissions:'selected-project'}},
  {name:{type:'user'},config:{sandbox_mode:'danger-full-access'}},
 ]);
 assert.equal(result.permissions,'selected-project');assert.equal(Object.hasOwn(result,'sandbox'),false);
});
