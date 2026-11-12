import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import {withDom} from './helpers/process-dom.mjs';

const require=createRequire(import.meta.url);
const Button=React.forwardRef(({focusableWhenDisabled:_focusable,...props},ref)=>React.createElement('button',{...props,ref}));
let Component;
function component(){
 if(Component)return Component;
 const result=buildSync({entryPoints:['ui/desktop-power-settings.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@base-ui/react/button'],logLevel:'silent'});
 const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(name=>name==='@base-ui/react/button'?{Button}:require(name),module,module.exports);
 return Component=module.exports.DesktopPowerSettings;
}
const defaults={keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15};
const initial=()=>({supported:true,preferences:{...defaults},runtimeAvailable:true,protection:'none',channels:[],wake:{supported:true,authorization:'required',status:'authorization-required',nextAt:null}});
const button=(d,label)=>d.find(n=>n.tagName==='BUTTON'&&(n.getAttribute('aria-label')===label||n.textContent===label));
const control=(d,label)=>{const heading=d.find(n=>n.textContent===label&&n.tagName==='H3');return d.find(n=>n.getAttribute('role')==='switch'&&n.getAttribute('aria-labelledby')===heading?.getAttribute('id'));};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function bridge(current=initial()){
 const listeners=new Set(),calls=[];
 const api={state:async()=>{calls.push(['state']);return structuredClone(current);},update:async patch=>{calls.push(['update',patch]);current={...current,preferences:{...current.preferences,...patch}};listeners.forEach(fn=>fn());return structuredClone(current);},authorize:async()=>{calls.push(['authorize']);current={...current,wake:{...current.wake,authorization:'denied'}};return structuredClone(current);},onChanged:fn=>{calls.push(['subscribe']);listeners.add(fn);return()=>listeners.delete(fn);}};
 return {api,calls,listeners,change:async value=>{current=value;await act(async()=>listeners.forEach(fn=>fn()));}};
}
async function render(d,b=bridge()){
 // The shared DOM has no form defaults; add native select semantics, not a React adapter.
 const create=d.doc.createElement;d.doc.createElement=name=>{const node=create(name);if(name==='select'){
  Object.defineProperty(node,'options',{get:()=>node.childNodes.filter(child=>child.tagName==='OPTION')});
  Object.defineProperty(node,'value',{get:()=>node.options.find(option=>option.selected)?.getAttribute('value')??node.options[0]?.getAttribute('value'),set:value=>node.options.forEach(option=>{option.selected=option.getAttribute('value')===String(value);})});
 }else if(name==='option')Object.defineProperty(node,'value',{get:()=>node.getAttribute('value')??node.textContent});return node;};
 window.homerDesktopPower=b.api;await d.render(React.createElement(component()));return b;
}
async function select(d,value){const target=d.find(n=>n.tagName==='SELECT');target.value=String(value);await act(async()=>{for(const listener of d.container.listeners.change??[])if(!listener.capture)listener.handler({type:'change',target,bubbles:true,defaultPrevented:false,preventDefault(){},stopPropagation(){}});});}

test('power settings show saved defaults, automatic execution protection and honest unavailable receipt',async()=>withDom(async d=>{
 const b=await render(d);
 assert.deepEqual(b.calls,[['subscribe'],['state']]);
 assert.equal(d.all().filter(n=>n.getAttribute('role')==='switch').length,3);
 assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'false');
 assert.equal(control(d,'定期唤醒检查渠道消息').getAttribute('aria-checked'),'true');
 assert.equal(control(d,'为定时消息自动唤醒').getAttribute('aria-checked'),'true');
 assert.match(d.container.textContent,/执行期间保持唤醒.*自动/s);assert.match(d.container.textContent,/暂无支持定期补收的渠道/);
 assert.match(d.container.textContent,/下一轮.*重连/s);assert.match(d.container.textContent,/需要系统授权/);
 const interval=d.find(n=>n.tagName==='SELECT');assert.equal(interval.value,'15');assert.deepEqual(interval.childNodes.map(n=>n.getAttribute('value')),['5','15','30','60']);
 assert.ok(button(d,'授权系统唤醒'));assert.ok(button(d,'重新检查'));assert.ok(!button(d,'重试保存'));
}));

test('switches and interval save only the chosen preference without requesting authorization',async()=>withDom(async d=>{
 const b=await render(d);await d.click(control(d,'Homer 运行期间始终保持唤醒'));await select(d,30);await d.click(control(d,'定期唤醒检查渠道消息'));await d.click(control(d,'为定时消息自动唤醒'));
 assert.deepEqual(b.calls.filter(([action])=>action==='update').map(([,patch])=>patch),[{keepAwake:true},{pollIntervalMinutes:30},{pollMessages:false},{wakeScheduled:false}]);
 assert.equal(b.calls.some(([action])=>action==='authorize'),false);assert.equal(d.find(n=>n.tagName==='SELECT').getAttribute('disabled'),'');
}));

test('lost native access keeps unresolved old-event cleanup visible without presenting it as a confirmed plan',async()=>withDom(async d=>{
 await render(d,bridge({...initial(),wake:{supported:false,authorization:'unavailable',status:'error',nextAt:1_900_000_000_000,error:'wake_cleanup_unconfirmed'}}));
 assert.match(d.container.textContent,/旧系统唤醒事件的清理未能确认/);assert.doesNotMatch(d.container.textContent,/下次系统唤醒请求/);
}));

test('unsupported wake and disconnected runtime retain saved on preferences without claiming they are active',async()=>withDom(async d=>{
 const b=await render(d,bridge({...initial(),runtimeAvailable:false,wake:{supported:false,authorization:'unavailable',status:'unavailable',nextAt:null}}));
 assert.equal(control(d,'定期唤醒检查渠道消息').getAttribute('aria-checked'),'true');assert.equal(control(d,'为定时消息自动唤醒').getAttribute('aria-checked'),'true');
 assert.match(d.container.textContent,/运行服务未连接/);assert.match(d.container.textContent,/不支持系统唤醒/);assert.ok(!button(d,'授权系统唤醒'));
 await d.click(control(d,'Homer 运行期间始终保持唤醒'));assert.deepEqual(b.calls.find(([action])=>action==='update'),['update',{keepAwake:true}]);
}));

test('system authorization requires an explicit click and denial never repeats on a refresh or preference change',async()=>withDom(async d=>{
 const b=await render(d);await d.click(button(d,'授权系统唤醒'));
 assert.match(d.container.textContent,/未获授权/);assert.ok(button(d,'重试授权'));await d.click(button(d,'重新检查'));await d.click(control(d,'Homer 运行期间始终保持唤醒'));
 assert.equal(b.calls.filter(([action])=>action==='authorize').length,1);await d.click(button(d,'重试授权'));assert.equal(b.calls.filter(([action])=>action==='authorize').length,2);
}));

test('state failure does not invent defaults, exposes no raw error, and allows a manual recheck',async()=>withDom(async d=>{
 const b=bridge();b.api.state=async()=>{throw Error('PRIVATE_SYSTEM_COMMAND');};await render(d,b);
 assert.match(d.container.textContent,/状态未能确认/);assert.doesNotMatch(d.container.textContent,/PRIVATE_SYSTEM_COMMAND/);assert.equal(d.all().filter(n=>n.getAttribute('role')==='switch').length,0);
 b.api.state=async()=>initial();await d.click(button(d,'重新检查'));assert.ok(control(d,'定期唤醒检查渠道消息'));
}));

test('failed save keeps the selected draft through notifications and recheck, then retries the same patch',async()=>withDom(async d=>{
 const b=bridge(),updates=[];let failed=true;
 b.api.update=async patch=>{updates.push(patch);if(failed)throw Error('PRIVATE_SAVE_DETAILS');return {...initial(),preferences:{...defaults,...patch}};};await render(d,b);
 await d.click(control(d,'Homer 运行期间始终保持唤醒'));assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');
 assert.match(d.container.textContent,/保存结果未确认/);assert.doesNotMatch(d.container.textContent,/PRIVATE_SAVE_DETAILS/);assert.ok(button(d,'重试保存'));
 await b.change(initial());assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');await d.click(button(d,'重新检查'));
 assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');failed=false;button(d,'重试保存').focus();await d.click(button(d,'重试保存'));
 assert.deepEqual(updates,[{keepAwake:true},{keepAwake:true}]);assert.ok(!button(d,'重试保存'));assert.match(d.container.textContent,/已保存/);assert.equal(d.doc.activeElement,button(d,'重新检查'));
}));

test('a confirmed matching state resolves a lost save response without another write',async()=>withDom(async d=>{
 const b=bridge();b.api.update=async()=>{throw Error('lost_response');};await render(d,b);await d.click(control(d,'Homer 运行期间始终保持唤醒'));
 await d.click(button(d,'重新检查'));button(d,'重试保存').focus();await b.change({...initial(),preferences:{...defaults,keepAwake:true}});assert.ok(!button(d,'重试保存'));assert.match(d.container.textContent,/已确认所选设置/);assert.equal(d.doc.activeElement,button(d,'重新检查'));
}));

test('authorization cannot discard an unsaved preference or its retry action',async()=>withDom(async d=>{
 const b=bridge();b.api.update=async()=>{throw Error('save_failure');};await render(d,b);await d.click(control(d,'Homer 运行期间始终保持唤醒'));
 await d.click(button(d,'重新检查'));await d.click(button(d,'授权系统唤醒'));
 assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');assert.ok(button(d,'重试保存'));assert.match(d.container.textContent,/所选设置尚未保存/);
}));

test('stale reads cannot overwrite a newer saved preference or wake state',async()=>withDom(async d=>{
 const b=await render(d),readCurrent=b.api.state,old=deferred();b.api.state=()=>old.promise;
 await act(async()=>b.listeners.forEach(fn=>fn()));
 b.api.state=async()=>initial();await act(async()=>b.listeners.forEach(fn=>fn()));await d.click(control(d,'Homer 运行期间始终保持唤醒'));
 await act(async()=>old.resolve(initial()));assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');
 const next={...initial(),protection:'display',channels:['Telegram'],wake:{supported:true,authorization:'authorized',status:'scheduled',nextAt:1800000000000}};b.api.state=readCurrent;await b.change(next);
 assert.match(d.container.textContent,/屏幕与系统/);assert.match(d.container.textContent,/支持补收的渠道：Telegram/);assert.match(d.container.textContent,/下次系统唤醒请求/);assert.match(d.container.textContent,/不代表.*必定/s);
}));

test('late notification during an update cannot reset the draft and unmount disposes reads and listeners',async()=>withDom(async d=>{
 const b=await render(d),saving=deferred(),reading=deferred();b.api.update=()=>saving.promise;await d.click(control(d,'Homer 运行期间始终保持唤醒'));
 b.api.state=()=>reading.promise;await act(async()=>b.listeners.forEach(fn=>fn()));await act(async()=>reading.resolve(initial()));
 assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');
 await act(async()=>saving.resolve({...initial(),preferences:{...defaults,keepAwake:true}}));assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');
 const late=deferred();b.api.state=()=>late.promise;await act(async()=>b.listeners.forEach(fn=>fn()));await d.render(null);assert.equal(b.listeners.size,0);await act(async()=>late.resolve(initial()));assert.equal(d.container.textContent,'');
}));

test('failed update releases a pending notification read so manual recovery stays available',async()=>withDom(async d=>{
 const b=await render(d),saving=deferred(),reading=deferred();b.api.update=()=>saving.promise;
 await d.click(control(d,'Homer 运行期间始终保持唤醒'));b.api.state=()=>reading.promise;await act(async()=>b.listeners.forEach(fn=>fn()));
 await act(async()=>saving.reject(Error('save_failure')));assert.equal(button(d,'重新检查').getAttribute('disabled'),null);
 await act(async()=>reading.resolve(initial()));assert.match(d.container.textContent,/保存结果未确认/);assert.equal(control(d,'Homer 运行期间始终保持唤醒').getAttribute('aria-checked'),'true');
}));

test('authorization and protection errors are explicit and never expose bridge exception content',async()=>withDom(async d=>{
 const b=bridge({...initial(),protectionError:'PRIVATE_PROTECTION_DETAILS'});b.api.authorize=async()=>{throw Error('PRIVATE_AUTH_DETAILS');};await render(d,b);assert.match(d.container.textContent,/保持唤醒未能生效/);await d.click(button(d,'授权系统唤醒'));
 assert.match(d.container.textContent,/授权结果未能确认/);assert.doesNotMatch(d.container.textContent,/PRIVATE_/);
 await d.click(button(d,'重新检查'));assert.doesNotMatch(d.container.textContent,/授权结果未能确认/);assert.ok(button(d,'授权系统唤醒'));
}));

test('a missing desktop bridge provides a clear unavailable state without controls',async()=>withDom(async d=>{
 await d.render(React.createElement(component()));assert.match(d.container.textContent,/桌面版/);assert.equal(d.all().filter(n=>n.getAttribute('role')==='switch').length,0);
}));
