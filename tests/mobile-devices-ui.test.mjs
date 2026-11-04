import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import QRCode from 'qrcode';
import {withDom,descendants} from './helpers/process-dom.mjs';
import {MobileDevices} from '../src/mobile-devices.ts';
const require=createRequire(import.meta.url),context=React.createContext(null),dialogContext=React.createContext(null);
const pass=tag=>React.forwardRef(({children,...props},ref)=>React.createElement(tag,{...props,ref},children));
const AlertDialog={Root:({open,onOpenChange,children})=>React.createElement(context.Provider,{value:{open,onOpenChange}},children),Portal:({children})=>React.useContext(context).open?children:null,Backdrop:pass('div'),Popup:({initialFocus,children,...props})=>React.createElement('div',{...props,role:'alertdialog'},children),Title:pass('h2'),Description:pass('p'),Close:({children,...props})=>{const c=React.useContext(context);return React.createElement('button',{...props,onClick:()=>c.onOpenChange(false)},children)}};
const Dialog={Root:({children})=>{const [open,setOpen]=React.useState(false);return React.createElement(dialogContext.Provider,{value:{open,setOpen}},children)},Trigger:({children,...props})=>{const c=React.useContext(dialogContext);return React.createElement('button',{...props,onClick:()=>c.setOpen(true)},children)},Portal:({children})=>React.useContext(dialogContext).open?children:null,Backdrop:pass('div'),Popup:({children,...props})=>React.createElement('div',{...props,role:'dialog'},children),Title:pass('h2'),Description:pass('p'),Close:({children,...props})=>{const c=React.useContext(dialogContext);return React.createElement('button',{...props,onClick:()=>c.setOpen(false)},children)}};
const result=buildSync({entryPoints:['ui/mobile-devices.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@base-ui/react/button','@base-ui/react/alert-dialog','@base-ui/react/dialog'],logLevel:'silent'});
const m={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(name=>name==='@base-ui/react/button'?{Button:pass('button')}:name==='@base-ui/react/alert-dialog'?{AlertDialog}:name==='@base-ui/react/dialog'?{Dialog}:require(name),m,m.exports);
const button=(d,label)=>d.find(n=>n.tagName==='BUTTON'&&(n.getAttribute('aria-label')===label||n.textContent===label));
const state=(overrides={})=>({configured:true,devices:[],pending:null,expiresAt:null,...overrides});
async function setup(run){const oldFetch=globalThis.fetch,oldLocation=globalThis.location;globalThis.location=new URL('http://127.0.0.1:12345/');try{await withDom(async d=>{await run(d);await d.render(null)});}finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}}
const json=x=>Response.json(x);
test('download dialog remains available independently of device state and does not change it',async()=>{
 for(const [deviceState,expected] of [[state(),'还没有绑定设备'],[state({devices:[{id:'d',name:'我的手机',enabled:true}]}),'我的手机'],[state({configured:false}),'移动连接尚未配置'],[null,'暂时无法读取设备状态']])await setup(async d=>{
  const calls=[];globalThis.fetch=async(path,init)=>{calls.push([path,init]);if(!deviceState)throw Error('offline');return json(deviceState)};
  await d.render(React.createElement(m.exports.MobileDeviceSettings));assert.ok(d.container.textContent.includes(expected));
  await d.click(button(d,'下载手机 App'));assert.ok(d.find(n=>n.getAttribute('role')==='dialog'));
  assert.ok(d.find(n=>n.getAttribute('aria-label')==='手机 App 下载二维码'));
  const link=d.find(n=>n.tagName==='A'&&n.textContent==='在浏览器打开下载页');assert.equal(link?.getAttribute('href'),'https://super-tree.com/homer/app');assert.equal(link?.getAttribute('target'),'_blank');assert.match(link?.getAttribute('rel')??'',/noopener/);
  assert.match(d.container.textContent,/手机相机扫描/);assert.match(d.container.textContent,/添加设备/);
  await d.click(button(d,'知道了'));assert.ok(!d.find(n=>n.getAttribute('role')==='dialog'));assert.ok(d.container.textContent.includes(expected));
  assert.equal(calls.filter(([,init])=>init?.method==='POST').length,0);
 });
});
test('download dialog preserves an active pairing invitation',async()=>setup(async d=>{
 const calls=[];let current=state();globalThis.fetch=async(path,init)=>{calls.push([path,init]);if(path.endsWith('/invite')){current=state({expiresAt:Date.now()+300000});return json({qr:'data:image/png;base64,AA==',expiresAt:current.expiresAt});}return json(current)};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));await d.click(button(d,'添加移动设备'));assert.match(d.container.textContent,/使用 Homer App 扫码/);
 await d.click(button(d,'下载手机 App'));assert.ok(d.find(n=>n.getAttribute('aria-label')==='手机 App 下载二维码'));await d.click(button(d,'知道了'));
 assert.match(d.container.textContent,/使用 Homer App 扫码/);assert.equal(calls.filter(([path])=>path.endsWith('/invite')).length,1);
}));
test('resizing keeps download dialog focus visible without scrolling other controls',async()=>setup(async d=>{
 const listeners=new Set();window.addEventListener=(type,fn)=>{if(type==='resize')listeners.add(fn)};window.removeEventListener=(type,fn)=>{if(type==='resize')listeners.delete(fn)};
 const resize=()=>{for(const fn of listeners)fn()};let scrolls=0;
 globalThis.fetch=async()=>json(state());await d.render(React.createElement(m.exports.MobileDeviceSettings));await d.click(button(d,'下载手机 App'));
 const link=d.find(n=>n.tagName==='A'&&n.textContent==='在浏览器打开下载页');link.scrollIntoView=()=>scrolls++;link.focus();resize();assert.equal(scrolls,1);
 const close=button(d,'知道了');close.scrollIntoView=()=>scrolls++;close.focus();resize();assert.equal(scrolls,2);
 button(d,'下载手机 App').focus();resize();assert.equal(scrolls,2);
 await d.click(button(d,'知道了'));await d.render(null);assert.equal(listeners.size,0);
}));
test('download QR matches the fixed link without a runtime QR dependency',async()=>setup(async d=>{
 globalThis.fetch=async()=>json(state());await d.render(React.createElement(m.exports.MobileDeviceSettings));await d.click(button(d,'下载手机 App'));
 const svg=d.find(n=>n.getAttribute('aria-label')==='手机 App 下载二维码'),link=d.find(n=>n.tagName==='A'&&n.textContent==='在浏览器打开下载页');
 const expected=await QRCode.toString(link.getAttribute('href'),{type:'svg',margin:4,errorCorrectionLevel:'M'});
 assert.equal(svg.getAttribute('viewBox'),expected.match(/viewBox="([^"]+)"/)[1]);
 assert.deepEqual(descendants(svg).filter(n=>n.tagName==='PATH').map(n=>n.getAttribute('d')),[...expected.matchAll(/<path[^>]* d="([^"]+)"/g)].map(m=>m[1]));
}));
test('device state may update while the download dialog is open',async()=>setup(async d=>{
 let current=state();globalThis.fetch=async()=>json(current);await d.render(React.createElement(m.exports.MobileDeviceSettings));await d.click(button(d,'下载手机 App'));
 current=state({pending:{id:'a',name:'新手机'},expiresAt:Date.now()+300000});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});
 assert.ok(d.find(n=>n.getAttribute('role')==='dialog'));await d.click(button(d,'知道了'));assert.match(d.container.textContent,/有设备请求连接/);assert.match(d.container.textContent,/新手机/);
}));
test('empty, QR, pending and confirmation use the existing mobile endpoints',async()=>setup(async d=>{
 const calls=[];let current=state();
 globalThis.fetch=async(path,init)=>{calls.push([path,init]);if(path.endsWith('/invite')){current=state({expiresAt:Date.now()+300000});return json({qr:'data:image/png;base64,AA==',expiresAt:current.expiresAt});}if(path.endsWith('/approve')){current=state({devices:[{id:'a',name:'移动设备',enabled:true}]});return json(current)}return json(current)};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));assert.match(d.container.textContent,/还没有绑定设备/);await d.click(button(d,'添加移动设备'));assert.ok(d.find(n=>n.tagName==='IMG'));assert.match(d.container.textContent,/有效时间/);
 current=state({pending:{id:'a',name:'移动设备'},expiresAt:Date.now()+300000});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});assert.match(d.container.textContent,/有设备请求连接/);assert.match(d.container.textContent,/不能作为身份凭证/);assert.equal(calls.filter(([p])=>p.endsWith('/approve')).length,0);const form=d.find(n=>n.tagName==='FORM');await act(async()=>{const event={type:'submit',target:form,bubbles:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};for(const listener of d.container.listeners.submit??[])if(!listener.capture)listener.handler(event);});assert.equal(calls.filter(([p])=>p.endsWith('/approve')).length,1);assert.match(d.container.textContent,/已绑定设备/);
}));

test('pending name is shown and missing name can still be manually approved',async()=>setup(async d=>{
 let current=state({pending:{id:'a',name:'小王的手机'},expiresAt:Date.now()+300000});const calls=[];
 globalThis.fetch=async(path,init)=>{calls.push([path,init]);return json(current);};
 await d.render(React.createElement(m.exports.MobileDeviceSettings));
 assert.match(d.container.textContent,/小王的手机/);assert.doesNotMatch(d.container.textContent,/核对码/);
 assert.equal(button(d,'确认绑定').hasAttribute('disabled'),false);
 current=state({pending:{id:'b',name:'未知设备'},expiresAt:Date.now()+300000});
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});
 assert.match(d.container.textContent,/未知设备/);assert.equal(button(d,'确认绑定').hasAttribute('disabled'),false);
 const form=d.find(n=>n.tagName==='FORM');await act(async()=>{const event={type:'submit',target:form,bubbles:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};for(const listener of d.container.listeners.submit??[])if(!listener.capture)listener.handler(event);});
 assert.equal(calls.filter(([path])=>path.endsWith('/approve')).length,1);
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

test('relay authorization pauses explain recovery without blocking device approval',async()=>{
 for(const [turnStatus,message] of [['configuration_required','检查服务配置后重启 Homer'],['account_required','重新连接账号并重启 Homer'],['network_restricted','切换网络后重试']])await setup(async d=>{
  globalThis.fetch=async()=>json(state({turnStatus,pending:{id:'a',name:'合成手机'},expiresAt:Date.now()+300000}));
  await d.render(React.createElement(m.exports.MobileDeviceSettings));
  assert.ok(d.container.textContent.includes(message));assert.equal(button(d,'确认绑定').hasAttribute('disabled'),false);
  assert.doesNotMatch(d.container.textContent,/Bearer|credential|token/);
 });
});
