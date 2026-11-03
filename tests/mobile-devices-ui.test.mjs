import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import {withDom} from './helpers/process-dom.mjs';
import {MobileDevices} from '../src/mobile-devices.ts';
const require=createRequire(import.meta.url),context=React.createContext(null);
const pass=tag=>React.forwardRef(({children,...props},ref)=>React.createElement(tag,{...props,ref},children));
const AlertDialog={Root:({open,onOpenChange,children})=>React.createElement(context.Provider,{value:{open,onOpenChange}},children),Portal:({children})=>React.useContext(context).open?children:null,Backdrop:pass('div'),Popup:({initialFocus,children,...props})=>React.createElement('div',{...props,role:'alertdialog'},children),Title:pass('h2'),Description:pass('p'),Close:({children,...props})=>{const c=React.useContext(context);return React.createElement('button',{...props,onClick:()=>c.onOpenChange(false)},children)}};
const result=buildSync({entryPoints:['ui/mobile-devices.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@base-ui/react/button','@base-ui/react/alert-dialog'],logLevel:'silent'});
const m={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(name=>name==='@base-ui/react/button'?{Button:pass('button')}:name==='@base-ui/react/alert-dialog'?{AlertDialog}:require(name),m,m.exports);
const button=(d,label)=>d.find(n=>n.tagName==='BUTTON'&&(n.getAttribute('aria-label')===label||n.textContent===label));
const state=(overrides={})=>({configured:true,devices:[],pending:null,expiresAt:null,...overrides});
async function setup(run){const oldFetch=globalThis.fetch,oldLocation=globalThis.location;globalThis.location=new URL('http://127.0.0.1:12345/');try{await withDom(async d=>{await run(d);await d.render(null)});}finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}}
const json=x=>Response.json(x);
test('empty, QR, pending and confirmation use the existing mobile endpoints',async()=>setup(async d=>{
 const calls=[];let current=state();
 globalThis.fetch=async(path,init)=>{calls.push([path,init]);if(path.endsWith('/invite')){current=state({expiresAt:Date.now()+300000});return json({qr:'data:image/png;base64,AA==',expiresAt:current.expiresAt});}if(path.endsWith('/approve')){current=state({devices:[{id:'a',name:'移动设备',enabled:true}]});return json(current)}return json(current)};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));assert.match(d.container.textContent,/还没有绑定设备/);await d.click(button(d,'添加移动设备'));assert.ok(d.find(n=>n.tagName==='IMG'));assert.match(d.container.textContent,/有效时间/);
 current=state({pending:{id:'a',name:'移动设备'},expiresAt:Date.now()+300000});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});assert.match(d.container.textContent,/有设备请求连接/);assert.match(d.container.textContent,/不能作为身份凭证/);assert.equal(calls.filter(([p])=>p.endsWith('/approve')).length,0);const form=d.find(n=>n.tagName==='FORM');await act(async()=>{const event={type:'submit',target:form,bubbles:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};for(const listener of d.container.listeners.submit??[])if(!listener.capture)listener.handler(event);});assert.equal(calls.filter(([p])=>p.endsWith('/approve')).length,1);assert.match(d.container.textContent,/已绑定设备/);
}));

test('unavailable state is not presented as empty and recovers only after a successful read',async()=>setup(async d=>{
 let fail=true;globalThis.fetch=async()=>fail?Promise.reject(Error('offline')):json(state());await d.render(React.createElement(m.exports.MobileDeviceSettings));assert.match(d.container.textContent,/暂时无法读取设备状态/);assert.doesNotMatch(d.container.textContent,/还没有绑定设备|正在读取/);fail=false;await d.click(button(d,'重新检查设备状态'));assert.match(d.container.textContent,/还没有绑定设备/);assert.doesNotMatch(d.container.textContent,/暂时无法读取设备状态/);
}));
test('device removal requires confirmation and an uncertain action is not silently retried',async()=>setup(async d=>{
 const calls=[];let current=state({devices:[{id:'d',name:'手机',enabled:true}]});let failDelete=true;
 globalThis.fetch=async(path,init)=>{calls.push(path);if(path.endsWith('/delete')){if(failDelete)throw Error('lost');current=state();}return json(current)};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));await d.click(button(d,'删除手机'));assert.ok(d.find(n=>n.getAttribute('role')==='alertdialog'));assert.equal(calls.filter(p=>p.endsWith('/delete')).length,0);await d.click(button(d,'删除绑定'));assert.match(d.container.textContent,/操作结果尚未确认/);assert.equal(calls.filter(p=>p.endsWith('/delete')).length,1);assert.ok(!button(d,'删除手机'));failDelete=false;await d.click(button(d,'重新检查设备状态'));assert.match(d.container.textContent,/请核对/);assert.equal(calls.filter(p=>p.endsWith('/delete')).length,1);assert.ok(button(d,'删除手机'));
}));

test('a late older read cannot replace an invitation created while the read was in flight',async()=>setup(async d=>{
 let resolveRead;const waiting=new Promise(resolve=>{resolveRead=resolve});let reads=0;
 globalThis.fetch=async(path)=>{if(path.endsWith('/invite'))return json({qr:'data:image/png;base64,AA==',expiresAt:Date.now()+300000});if(++reads===1)return json(state());return waiting;};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});await d.click(button(d,'添加移动设备'));await act(async()=>resolveRead(json(state())));assert.ok(d.find(n=>n.tagName==='IMG'));assert.match(d.container.textContent,/有效时间/);
}));

test('UI approval and deletion use an isolated in-memory device owner',async()=>setup(async d=>{
 const devices=new MobileDevices(':memory:');let pairing;
 try{globalThis.fetch=async(path,init)=>{const op=path.split('/').at(-1),body=init?.body?JSON.parse(init.body):{};if(op==='invite'){const invitation=devices.invite('https://example.invalid');pairing=devices.pair(new URL(invitation.url).hash.slice(1));return json({qr:'data:image/png;base64,AA==',expiresAt:invitation.expiresAt});}if(op==='approve')devices.approve(body.id,body.name);if(op==='update')devices.update(body.id,body);if(op==='delete')devices.remove(body.id);return json(devices.state());};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));await d.click(button(d,'添加移动设备'));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});assert.equal(devices.status(pairing.credential),'pending');const form=d.find(n=>n.tagName==='FORM');await act(async()=>{const event={type:'submit',target:form,bubbles:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};for(const listener of d.container.listeners.submit??[])if(!listener.capture)listener.handler(event);});assert.equal(devices.status(pairing.credential),'active');await d.click(button(d,'停用未知设备'));assert.equal(devices.status(pairing.credential),'denied');await d.click(button(d,'启用未知设备'));assert.equal(devices.status(pairing.credential),'active');await d.click(button(d,'删除未知设备'));await d.click(button(d,'删除绑定'));assert.equal(devices.status(pairing.credential),'denied');assert.deepEqual(devices.state().devices,[]);
 }finally{devices.close();}
}));


test('the pending phone name is visible and unknown names do not disable manual approval',async()=>setup(async d=>{
 globalThis.fetch=async()=>json(state({pending:{id:'a',name:'测试手机'},expiresAt:Date.now()+300000}));
 await d.render(React.createElement(m.exports.MobileDeviceSettings));
 assert.match(d.container.textContent,/测试手机/);assert.match(d.container.textContent,/不能作为身份凭证/);
 assert.equal(button(d,'确认绑定').hasAttribute('disabled'),false);
}));
