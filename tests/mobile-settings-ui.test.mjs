import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import {withDom} from './helpers/process-dom.mjs';

// The browser verifies Base UI's focus and portal behavior; this harness keeps
// the real settings actions and replaces only its dialog environment.
const require=createRequire(import.meta.url),context=React.createContext(null);
const Dialog={
 Root:({open,onOpenChange,children})=>React.createElement(context.Provider,{value:{open,setOpen:onOpenChange}},children),
 Trigger:React.forwardRef(({children,...props},ref)=>{const {open,setOpen}=React.useContext(context);return React.createElement('button',{...props,ref,'aria-expanded':open,onClick:()=>setOpen(true)},children);}),
 Portal:({children})=>React.useContext(context).open?children:null,
 Popup:({children,...props})=>React.createElement('div',{...props,role:'dialog'},children),
 Title:({children,...props})=>React.createElement('h1',props,children),
 Close:({children,...props})=>{const {setOpen}=React.useContext(context);return React.createElement('button',{...props,onClick:()=>setOpen(false)},children);},
};
function load(){
 const path='ui/mobile-settings.tsx';
 assert.ok(existsSync(path),'the mobile settings page must be implemented');
 const result=buildSync({entryPoints:[path],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@base-ui/react/dialog'],logLevel:'silent'});
 const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(name=>name==='@base-ui/react/dialog'?{Dialog}:require(name),module,module.exports);return module.exports.MobileSettings;
}
const button=(d,label)=>d.find(node=>node.tagName==='BUTTON'&&(node.getAttribute('aria-label')===label||node.textContent===label));

test('mobile settings preserves the page while invoking the current native scanner and privacy actions',async()=>withDom(async d=>{
 const messages=[];
 window.__homerMobileNonce='first';window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 await d.render(React.createElement(load()));
 assert.ok(button(d,'设置'));assert.equal(d.find(node=>node.getAttribute('role')==='dialog'),undefined);
 await d.click(button(d,'设置'));
 assert.ok(d.find(node=>node.getAttribute('role')==='dialog'));
 assert.ok(button(d,'完成'));assert.ok(button(d,'重新扫码'));assert.ok(button(d,'隐私政策'));
 await d.click(button(d,'重新扫码'));
 assert.deepEqual(messages,[{type:'open-scanner',nonce:'first'}]);
 assert.ok(button(d,'重新扫码'),'returning from the native scanner leaves settings open');
 window.__homerMobileNonce='second';
 await d.click(button(d,'隐私政策'));
 assert.deepEqual(messages.at(-1),{type:'open-privacy',nonce:'second'});
 assert.ok(button(d,'隐私政策'),'opening the system browser leaves settings open');
 await d.click(button(d,'完成'));
 assert.equal(d.find(node=>node.getAttribute('role')==='dialog'),undefined);
}));

test('a new binding leaves settings while reconnecting the same binding keeps it open',async()=>withDom(async d=>{
 const events=new EventTarget();
 window.addEventListener=events.addEventListener.bind(events);window.removeEventListener=events.removeEventListener.bind(events);
 window.__homerMobileNonce='original';window.ReactNativeWebView={postMessage:()=>{}};
 await d.render(React.createElement(load()));await d.click(button(d,'设置'));await d.click(button(d,'重新扫码'));
 await act(async()=>events.dispatchEvent(new Event('homer-mobile-connect')));
 assert.ok(button(d,'完成'),'a reconnect using the same binding must not close settings');
 await act(async()=>{window.__homerMobileNonce='new-binding';events.dispatchEvent(new Event('homer-mobile-connect'));});
 assert.equal(d.find(node=>node.getAttribute('role')==='dialog'),undefined,'scanning a new binding returns to the normal connection flow');
}));
