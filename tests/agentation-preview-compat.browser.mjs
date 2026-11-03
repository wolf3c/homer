import assert from 'node:assert/strict';
import {build} from 'vite';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {verifyVendor} from '../scripts/patch-preview-agentation.mjs';
const dir=fileURLToPath(new URL('../',import.meta.url)),out=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/html-preview-product-integration-20261024/compat')+'/',checks=[];
mkdirSync(out,{recursive:true});
writeFileSync(out+'fixture.tsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {Agentation} from 'test-agentation';declare const __TEST_EXTENDED__:boolean;const root=createRoot(document.getElementById('root')!);const changes:boolean[]=[];const changed=(active:boolean)=>changes.push(active);(window as any).__changes=changes;function render(defaultActive=true){root.render(<Agentation copyToClipboard={false} {...(__TEST_EXTENDED__?{defaultActive,onActiveChange:changed}:{})}/>);}(window as any).__rerender=()=>render(false);(window as any).__unmount=()=>root.unmount();render();`);
verifyVendor();
for(const variant of ['upstream-default','patched-default','patched-extended']){
 const bundle=await build({configFile:false,root:dir,logLevel:'error',resolve:{alias:{'test-agentation':dir+'ui/vendor/agentation-3.1.2/'+(variant==='upstream-default'?'upstream/':'')+'index.mjs'}},define:{'process.env.NODE_ENV':'"production"',__TEST_EXTENDED__:String(variant==='patched-extended')},build:{write:false,minify:true,lib:{entry:out+'fixture.tsx',name:'CompatibilityFixture',formats:['iife']}}});
 const script=(Array.isArray(bundle)?bundle[0]:bundle).output.find(c=>c.type==='chunk').code;
 writeFileSync(out+variant+'.html',`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'"><h1 style="margin:100px">Synthetic compatibility heading</h1><div id="root"></div><script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
}
const chrome=await isolatedChrome(out),pages=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
const check=(label,value)=>{assert.ok(value,label);checks.push(label);console.log('PASS',label);};
async function pointer(p,selector){const r=await p.evaluate(`__q(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await p.command('Input.dispatchMouseEvent',{type,x:r.x+r.width/2,y:r.y+r.height/2,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function create(variant){const p=await chrome.page('null',1440);pages.push(p);await p.command('Network.enable');await p.command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await p.command('Page.navigate',{url:new URL('file://'+out+variant+'.html').href});await p.until(()=>!!document.querySelector('agentation-toolbar')?.shadowRoot);await p.evaluate(()=>{window.__qa=s=>{const a=[];function scan(root){a.push(...root.querySelectorAll(s));for(const e of root.querySelectorAll('*'))if(e.shadowRoot)scan(e.shadowRoot);}scan(document);return a;};window.__q=s=>__qa(s)[0];});await delay(450);return p;}
const results=[];
try{
 for(const variant of ['upstream-default','patched-default']){
  const p=await create(variant);check(variant+' omitted extension props starts native collapsed',await p.evaluate(()=>__q('[aria-label="Start feedback mode"]')?.getAttribute('aria-expanded')==='false'));
  await pointer(p,'h1');await delay(200);check(variant+' remains nonselecting without native activation',await p.evaluate(()=>!__q('textarea[placeholder="What should change?"]')));
  // Deliberate native Start in a compatibility fixture ONLY, never product acceptance.
  await pointer(p,'[aria-label="Start feedback mode"]');await p.until(()=>!!__q('[aria-label="Exit"]'));await delay(450);await pointer(p,'h1');await p.until(()=>!!__q('textarea[placeholder="What should change?"]'));
  const state=await p.evaluate(()=>({expanded:__q('[aria-label="Exit"]').getAttribute('aria-expanded'),instances:document.querySelectorAll('agentation-toolbar').length,popup:!!__q('[data-annotation-popup]'),add:__qa('button').some(b=>b.textContent==='Add'),cancel:__qa('button').some(b=>b.textContent==='Cancel')}));results.push(state);
  check(variant+' native launcher still opens same original selection/popup contract',state.expanded==='true'&&state.instances===1&&state.popup&&state.add&&state.cancel);await p.close();
 }
 check('omitted extension path matches upstream observed native behavior',JSON.stringify(results[0])===JSON.stringify(results[1]));
 const p=await create('patched-extended');await p.until(()=>window.__changes?.length===1);
 check('extended initial callback reports actual true exactly once after mount',await p.evaluate(()=>JSON.stringify(window.__changes)==='[true]'&&!!__q('[aria-label="Exit"]')));
 await p.evaluate(()=>window.__rerender());await delay(100);check('defaultActive is initial-only and rerender does not duplicate callback',await p.evaluate(()=>JSON.stringify(window.__changes)==='[true]'&&!!__q('[aria-label="Exit"]')));
 await pointer(p,'[aria-label="Exit"]');await p.until(()=>JSON.stringify(window.__changes)==='[true,false]');await delay(450);check('native Exit reports false through sole active state',true);
 await pointer(p,'[aria-label="Start feedback mode"]');await p.until(()=>JSON.stringify(window.__changes)==='[true,false,true]');check('native launcher reactivation reports true without callback loop',true);
 await p.evaluate(()=>window.__unmount());await delay(100);check('unmount does not emit a false callback that could invalidate a new frame',await p.evaluate(()=>JSON.stringify(window.__changes)==='[true,false,true]'&&!document.querySelector('agentation-toolbar')));
 check('compatibility fixtures are offline and have no host exceptions',pages.every(p=>p.blocked.length===0&&p.errors.length===0));
 writeFileSync(out+'compat-results.json',JSON.stringify({checks,defaultPathObservedStates:results,browser:chrome.version,note:'Native Start clicks occur ONLY in these isolated backward-compatibility fixtures, not the product single-entry acceptance.'},null,2));
}catch(error){writeFileSync(out+'failure-'+Date.now()+'.json',JSON.stringify({checks,error:String(error.stack)},null,2));throw error;}finally{await chrome.close();}
