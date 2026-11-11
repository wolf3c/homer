import {test,beforeEach,afterEach} from 'node:test';
let previousStorage;
beforeEach(()=>{previousStorage=globalThis.sessionStorage;const entries=new Map();globalThis.sessionStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};});
afterEach(()=>{if(previousStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previousStorage;});
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import {withDom} from './helpers/process-dom.mjs';

// Reuse the existing React DOM harness. Base UI's portal/focus engine needs a
// browser: these adapters exercise our controlled props and actions, not that engine.
const require=createRequire(import.meta.url),focusProps=[];
const uiBase='/ui/'+'a'.repeat(64)+'/';
const dialogContext=React.createContext(null);
const pass=tag=>React.forwardRef(({children,...props},ref)=>React.createElement(tag,{...props,ref},children));
const Button=React.forwardRef(({focusableWhenDisabled:_focusable,...props},ref)=>React.createElement('button',{...props,ref}));
const Dialog={
 Root:({open,onOpenChange,children})=>React.createElement(dialogContext.Provider,{value:{open,onOpenChange}},children),
 Trigger:React.forwardRef(({children,...props},ref)=>{const c=React.useContext(dialogContext);return React.createElement('button',{...props,ref,'aria-haspopup':'dialog','aria-expanded':c.open,onClick:()=>c.onOpenChange(true,{cancel(){}})},children);}),
 Portal:({children})=>React.useContext(dialogContext).open?children:null,
 Popup:({initialFocus,finalFocus,children,...props})=>{focusProps.push({initialFocus,finalFocus});return React.createElement('div',{...props,role:'dialog'},children);},
 Close:({children,...props})=>{const c=React.useContext(dialogContext);return React.createElement('button',{...props,onClick:()=>c.onOpenChange(false,{cancel(){}})},children);},
 Backdrop:pass('div'),Title:pass('h2'),Description:pass('p'),
};
const tabsContext=React.createContext(null);
const Tabs={Root:({value,onValueChange,orientation:_orientation,children,...props})=>React.createElement(tabsContext.Provider,{value:{value,onValueChange}},React.createElement('div',props,children)),List:({activateOnFocus:_activateOnFocus,...props})=>React.createElement('nav',props),Tab:({value,...props})=>{const c=React.useContext(tabsContext);return React.createElement('button',{...props,'data-value':value,role:'tab','aria-selected':c.value===value,onClick:()=>c.onValueChange?.(value)});},Panel:({value,...props})=>React.useContext(tabsContext).value===value?React.createElement('div',{...props,'data-value':value,role:'tabpanel'}):null};
const Popover={Root:({children})=>children,Trigger:pass('button'),Portal:()=>null,Positioner:pass('div'),Popup:pass('div'),Title:pass('h2')};
const primitives={
 '@base-ui/react/dialog':{Dialog},'@base-ui/react/tabs':{Tabs},'@base-ui/react/button':{Button},'@base-ui/react/popover':{Popover},
};
function load(){
 const result=buildSync({entryPoints:['ui/desktop-permissions.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.png':'dataurl','.svg':'dataurl','.css':'empty'},define:{'import.meta.env.BASE_URL':JSON.stringify(uiBase)},external:['react','react/jsx-runtime',...Object.keys(primitives)],logLevel:'silent'});
 const m={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(name=>primitives[name]??require(name),m,m.exports);return m.exports;
}
let components;
const get=()=>components??=load();
const granted={supported:true,subject:'Homer',accessibility:'granted',screen:'granted'};
const button=(d,label)=>d.find(n=>n.tagName==='BUTTON'&&(n.getAttribute('aria-label')===label||n.textContent===label));
const row=(d,label)=>d.find(n=>n.tagName==='SECTION'&&n.getAttribute('aria-label')===label);
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function bridge(checkValue={...granted,accessibility:'not-granted',screen:'not-determined'}){
 const calls=[];return {calls,check:async(...args)=>{calls.push(['check',...args]);return checkValue;},promptAccessibility:async(...args)=>{calls.push(['prompt',...args]);return {ok:true};},openSystemSettings:async(...args)=>{calls.push(['open',...args]);return {ok:true};}};
}
async function panel(d,api){if(api)window.homerDesktopPermissions=api;await d.render(React.createElement(get().DesktopPermissions));}

test('one settings dialog exposes permissions and mobile devices without starting network requests',async()=>withDom(async d=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error('unexpected_settings_request');};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
  assert.deepEqual(d.all().filter(n=>n.getAttribute('role')==='tab').map(n=>n.textContent),['本机权限','移动设备']);
  assert.equal(d.all().filter(n=>n.getAttribute('role')==='dialog').length,1);
  assert.equal(calls.length,0);
 }finally{globalThis.fetch=original;}
}));
test('about displays the version supplied by the desktop app',async()=>withDom(async d=>{
 let reads=0;
 window.homerDesktopFeatureTour={pending:async()=>false,dismiss:async()=>{}};
 window.homerDesktopSettings={onOpen:()=>()=>{},openAboutLink:async()=>{},getVersion:async()=>{reads++;return '9.8.7';}};
 await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
 assert.equal(reads,0);
 await d.click(d.find(n=>n.getAttribute('role')==='tab'&&n.textContent==='关于'));
 assert.equal(reads,1);assert.match(d.find(n=>n.getAttribute('role')==='tabpanel').textContent,/版本 9\.8\.7/);
}));
test('the screenshot annotation settings introduce capture and let users edit and restore the global shortcut',async()=>withDom(async d=>{
 const changes=[],visibility=[];let reads=0,resetAttempts=0;
 let state={shortcut:'Control+Shift+A',defaultShortcut:'Control+1',active:true};
 window.homerDesktopCapture={getShortcut:async()=>{reads++;return state;},setShortcut:async value=>{
  changes.push(value);
  if(value===null&&++resetAttempts===1)return {...state,error:'unavailable'};
  return state={...state,shortcut:value??state.defaultShortcut};
 }};
 await d.render(React.createElement(get().DesktopSettings,{onVisibilityChange:value=>visibility.push(value)}));
 await d.click(button(d,'设置'));assert.equal(reads,0);
 const tabs=d.all().filter(n=>n.getAttribute('role')==='tab');
 assert.deepEqual(tabs.map(n=>n.textContent),['本机权限','截图批注','移动设备']);
 await d.click(tabs[1]);
 const panel=d.find(n=>n.getAttribute('role')==='tabpanel');
 assert.match(panel.textContent,/截取当前窗口/);
 assert.match(panel.textContent,/选取窗口或区域/);
 assert.ok(d.find(n=>n.getAttribute('role')==='img'&&n.getAttribute('aria-label')?.includes('操作示意')&&panel.contains(n)));
 const key=()=>d.find(n=>n.tagName==='KBD');
 const edit=d.find(n=>n.tagName==='BUTTON'&&n.contains(key())),restore=button(d,'恢复截图批注默认快捷键');
 assert.equal(reads,1);assert.equal(key().textContent,'⌃⇧A');
 assert.ok(edit&&restore&&edit.parentNode===restore.parentNode);
 const pressControl=async (key,code)=>act(async()=>{
  const event={type:'keydown',target:edit,key,code,ctrlKey:true,preventDefault(){},stopPropagation(){}};
  for(const listener of d.container.listeners.keydown??[])if(!listener.capture)listener.handler(event);
 });
 await d.click(edit);assert.equal(edit.getAttribute('aria-pressed'),'true');
 await pressControl('a','KeyA');assert.deepEqual(changes,[]);
 await pressControl('2','Digit2');assert.equal(key()?.textContent,'⌃2');assert.deepEqual(changes,['Control+2']);
 await d.click(restore);assert.equal(key().textContent,'⌃2');assert.match(d.container.textContent,/已被占用/);
 await d.click(restore);assert.equal(key().textContent,'⌃1');assert.deepEqual(changes,['Control+2',null,null]);
 assert.ok(!d.find(n=>n.getAttribute('role')==='status'&&row(d,'全局快捷键').contains(n)));
 await d.click(button(d,'关闭设置'));assert.deepEqual(visibility,[true,false]);
}));

test('Windows screenshot settings show the window or region flow and record function keys',async()=>withDom(async d=>{
 const changes=[];
 let state={shortcut:'Control+Shift+F2',defaultShortcut:'Control+Shift+F2',active:true};
 window.homerDesktopCapture={platform:'win32',getShortcut:async()=>state,setShortcut:async value=>{
  changes.push(value);return state={...state,shortcut:value??state.defaultShortcut};
 }};
 await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
 await d.click(d.find(n=>n.getAttribute('role')==='tab'&&n.textContent==='截图批注'));
 const panel=d.find(n=>n.getAttribute('role')==='tabpanel'),key=()=>d.find(n=>n.tagName==='KBD');
 assert.equal(key().textContent,'Ctrl+Shift+F2');assert.match(panel.textContent,/从列表选择窗口/);
 const edit=d.find(n=>n.tagName==='BUTTON'&&n.contains(key()));
 await d.click(edit);assert.match(panel.textContent,/F1–F11/);
 async function press(key,code=key){await act(async()=>{
  const event={type:'keydown',target:edit,key,code,ctrlKey:true,shiftKey:true,preventDefault(){},stopPropagation(){}};
  for(const listener of d.container.listeners.keydown??[])if(!listener.capture)listener.handler(event);
 });}
 await press('F12');assert.deepEqual(changes,[]);
 await press('F11');assert.equal(key().textContent,'Ctrl+Shift+F11');
 await d.click(edit);await press('!','Digit1');assert.equal(key().textContent,'Ctrl+Shift+1');
 await d.click(button(d,'恢复截图批注默认快捷键'));assert.equal(key().textContent,'Ctrl+Shift+F2');
 assert.deepEqual(changes,['Control+Shift+F11','Control+Shift+1',null]);
}));

test('screenshot settings reuse the tour GIF and show the static guide when motion is paused or reduced',async()=>withDom(async d=>{
 let motionChanged;
 window.matchMedia=query=>({
  matches:query==='(prefers-reduced-motion: no-preference)',
  addEventListener:(_name,listener)=>{if(query==='(prefers-reduced-motion: no-preference)')motionChanged=listener;},
  removeEventListener(){},
 });
 const shortcut={shortcut:'Control+1',defaultShortcut:'Control+1',active:true};
 window.homerDesktopCapture={getShortcut:async()=>shortcut,setShortcut:async()=>shortcut};
 const gif=()=>d.find(n=>n.tagName==='IMG'&&n.getAttribute('src')===uiBase+'assets/desktop-feature-tour-v1-annotation.gif');
 const still=()=>d.find(n=>n.getAttribute('role')==='img'&&n.getAttribute('aria-label')?.includes('操作示意'));
 await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
 assert.ok(!gif());
 await d.click(d.find(n=>n.getAttribute('role')==='tab'&&n.textContent==='截图批注'));
 assert.ok(gif());assert.match(d.container.textContent,/体验示意/);
 await d.click(button(d,'暂停示意动图'));assert.ok(!gif());assert.ok(still());
 await d.click(button(d,'播放示意动图'));assert.ok(gif());
 await act(async()=>motionChanged({matches:false}));
 assert.ok(!gif());assert.ok(still());assert.ok(!button(d,'播放示意动图'));
}));

test('chat apps show only nonzero binding counts beside their names',async()=>withDom(async d=>{
 const bindings=['first_bot','second_bot'].map(label=>({adapterId:'telegram',accountKey:label,label,state:'ready',failed:0,unknown:0}));
 window.homerDesktopChatApps={state:async()=>({bindings,pending:[],busy:false,stopped:false,readError:false})};
 await d.render(React.createElement(get().DesktopSettings));
 await d.click(button(d,'设置'));
 await d.click(button(d,'连接聊天应用'));
 const headings=d.all().filter(n=>n.tagName==='H3');
 assert.deepEqual(headings.map(n=>n.textContent.trim()),['微信','Telegram 2 个绑定','钉钉']);
 const count=headings[1].lastChild;
 assert.equal(count.firstChild.textContent,'2');
 assert.equal(count.lastChild.getAttribute('class'),'sr-only');
 assert.equal(d.all().filter(n=>n.getAttribute('aria-label')==='如何关闭 Telegram 群隐私模式').length,1);
}));

test('settings entry opens the approved dialog and two columns; close and thread change unmount pending reads',async()=>withDom(async d=>{
 const b=bridge();window.homerDesktopPermissions=b;
 const render=thread=>d.render(React.createElement(get().DesktopSettings,{key:thread}));
 await render('a');assert.equal(b.calls.length,0);const entry=button(d,'设置');assert.ok(entry);await d.click(entry);
 assert.ok(d.find(n=>n.getAttribute('class')==='desktop-settings-layout'));
 assert.ok(d.find(n=>n.getAttribute('class')==='desktop-settings-nav'));
 assert.ok(d.find(n=>n.getAttribute('class')==='desktop-settings-content'));
 assert.equal(b.calls.length,1);assert.equal(focusProps.at(-1).initialFocus().getAttribute('role'),'tab');assert.equal(focusProps.at(-1).finalFocus.current,entry);
 const wait=pending();b.check=()=>wait.promise;await d.click(button(d,'重新检查辅助功能'));await d.click(button(d,'关闭设置'));
 await act(async()=>wait.resolve(granted));assert.ok(!row(d,'辅助功能'));
 const threadWait=pending();b.check=()=>threadWait.promise;await d.click(entry);assert.ok(row(d,'辅助功能'));await render('b');await act(async()=>threadWait.resolve(granted));assert.ok(!row(d,'辅助功能'));
}));
test('mount reads once; screen settings sends only its fixed target and never marks permission granted',async()=>withDom(async d=>{
 const b=bridge();await panel(d,b);assert.deepEqual(b.calls,[['check']]);assert.match(row(d,'辅助功能').textContent,/未允许/);assert.match(row(d,'屏幕采集').textContent,/尚未决定/);
 assert.ok(!button(d,'申请引导'));assert.match(row(d,'辅助功能').textContent,/手动添加/);
 await d.click(button(d,'打开屏幕采集系统设置'));assert.deepEqual(b.calls.at(-1),['open','screen']);assert.match(row(d,'屏幕采集').textContent,/尚未决定/);assert.match(row(d,'屏幕采集').textContent,/返回后点击重新检查/);
 assert.match(row(d,'屏幕采集').textContent,/已请求/);assert.match(row(d,'屏幕采集').textContent,/如未直达/);assert.doesNotMatch(row(d,'屏幕采集').textContent,/系统设置已打开/);
 await d.click(button(d,'打开辅助功能系统设置'));assert.deepEqual(b.calls.at(-1),['open']);
 await d.click(button(d,'重新检查屏幕采集'));assert.deepEqual(b.calls.at(-1),['check']);assert.equal(b.calls.length,4);
}));
test('screen dispatch fallback and rejection keep the manual route visible and do not grant permission',async()=>withDom(async d=>{
 const b=bridge({...granted,screen:'denied'});await panel(d,b);
 b.openSystemSettings=async()=>({ok:true,code:'manual_navigation'});await d.click(button(d,'打开屏幕采集系统设置'));
 assert.match(row(d,'屏幕采集').textContent,/未允许/);assert.match(row(d,'屏幕采集').textContent,/未能直接打开/);assert.match(row(d,'屏幕采集').textContent,/手动进入/);assert.match(row(d,'屏幕采集').textContent,/屏幕与系统音频录制/);
 b.openSystemSettings=async()=>{throw Error('private');};await d.click(button(d,'打开屏幕采集系统设置'));
 assert.match(row(d,'屏幕采集').textContent,/未能打开/);assert.match(row(d,'屏幕采集').textContent,/屏幕与系统音频录制/);assert.doesNotMatch(row(d,'屏幕采集').textContent,/private|已允许/);
}));
test('accessibility settings fallback and recheck report observed permission only',async()=>withDom(async d=>{
 const b=bridge();await panel(d,b);
 b.openSystemSettings=async()=>({ok:true,code:'manual_navigation'});await d.click(button(d,'打开辅助功能系统设置'));
 assert.match(row(d,'辅助功能').textContent,/未允许/);assert.match(row(d,'辅助功能').textContent,/未能直接打开/);assert.match(row(d,'辅助功能').textContent,/手动添加/);
 b.check=async()=>({...granted,screen:'not-determined'});await d.click(button(d,'重新检查辅助功能'));
 assert.match(row(d,'辅助功能').textContent,/已允许/);assert.doesNotMatch(row(d,'辅助功能').textContent,/未能直接打开|手动添加/);
}));
test('all five raw screen statuses and AX boolean-derived states are shown honestly',async()=>withDom(async d=>{
 for(const [screen,label] of [['not-determined','尚未决定'],['denied','未允许'],['granted','已允许'],['restricted','系统限制'],['unknown','无法确认'],['new-status','无法确认']]){
  await d.remount();await panel(d,bridge({...granted,screen}));assert.match(row(d,'屏幕采集').textContent,new RegExp(label));assert.ok(!button(d,'申请引导'));
 }
 await d.remount();await panel(d,bridge({...granted,accessibility:'unknown'}));assert.match(row(d,'辅助功能').textContent,/无法确认/);assert.ok(!button(d,'申请引导'));
 assert.match(d.container.textContent,/荷马本机应用/);assert.match(d.container.textContent,/独立工具/);assert.match(d.container.textContent,/具体操作/);assert.match(d.container.textContent,/系统设置 → 隐私与安全性/);assert.match(d.container.textContent,/重开/);
 assert.ok(!d.find(n=>n.getAttribute('role')==='switch'||n.getAttribute('type')==='checkbox'));
}));
test('refresh and action failures clear only relevant old success; rejection never silently preserves green',async()=>withDom(async d=>{
 const b=bridge(granted);await panel(d,b);
 b.check=async()=>({...granted,accessibility:'unknown'});await d.click(button(d,'重新检查辅助功能'));assert.match(row(d,'辅助功能').textContent,/无法确认/);assert.match(row(d,'屏幕采集').textContent,/已允许/);
 b.openSystemSettings=async()=>({ok:false,code:'open_failed'});await d.click(button(d,'打开屏幕采集系统设置'));assert.match(row(d,'屏幕采集').textContent,/无法确认/);assert.match(row(d,'屏幕采集').textContent,/未能打开/);
 b.check=async()=>{throw Error('private');};await d.click(button(d,'重新检查辅助功能'));for(const name of ['辅助功能','屏幕采集'])assert.match(row(d,name).textContent,/无法确认/);assert.doesNotMatch(d.container.textContent,/private/);
 b.check=async()=>({...granted,accessibility:'not-granted'});await d.click(button(d,'重新检查辅助功能'));assert.match(row(d,'辅助功能').textContent,/未允许/);assert.match(row(d,'屏幕采集').textContent,/已允许/);
}));
test('requests disable buttons, reject duplicate clicks and ignore unmounted late check/actions',async()=>withDom(async d=>{
 const b=bridge(),wait=pending();b.check=()=>{b.calls.push(['check']);return wait.promise;};await panel(d,b);
 const buttons=d.all().filter(n=>n.tagName==='BUTTON');assert.ok(buttons.length);for(const n of buttons)assert.equal(n.getAttribute('disabled'),'');await d.click(buttons[0]);assert.equal(b.calls.length,1);
 await d.render(null);await act(async()=>wait.resolve(granted));assert.equal(d.container.textContent,'');
 for(const action of ['open']){
  const next=bridge(),later=pending();next.openSystemSettings=()=>later.promise;await panel(d,next);await d.click(button(d,'打开屏幕采集系统设置'));
  for(const n of d.all().filter(n=>n.tagName==='BUTTON'))assert.equal(n.getAttribute('disabled'),'');
  await d.render(null);await act(async()=>later.resolve({ok:true}));assert.equal(d.container.textContent,'');
 }
}));
test('ordinary web and unsupported desktop have no native actions or UA inference',async()=>withDom(async d=>{
 await panel(d);assert.match(d.container.textContent,/当前环境不支持/);assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,0);
 await d.remount();const b=bridge({supported:false});await panel(d,b);assert.deepEqual(b.calls,[['check']]);assert.match(d.container.textContent,/当前环境不支持/);assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,0);
}));

test('native requests share the gear dialog, focus on repeat, and unsubscribe on remount',async()=>withDom(async d=>{
 let callback,subscriptions=0,disposals=0;window.homerDesktopPermissions=bridge();window.homerDesktopSettings={onOpen:fn=>{callback=fn;subscriptions++;return ()=>{disposals++;callback=undefined;};}};
 await d.render(React.createElement(get().DesktopSettings));assert.equal(subscriptions,1);await act(async()=>callback());assert.ok(d.find(n=>n.getAttribute('role')==='dialog'));
 await act(async()=>callback());assert.equal(d.all().filter(n=>n.getAttribute('role')==='dialog').length,1);assert.equal(d.doc.activeElement.getAttribute('role'),'tab');assert.equal(subscriptions,1);
 await d.click(button(d,'关闭设置'));assert.ok(!d.find(n=>n.getAttribute('role')==='dialog'));await d.click(button(d,'设置'));assert.ok(d.find(n=>n.getAttribute('role')==='dialog'));
 await d.remount();assert.equal(disposals,1);await d.render(React.createElement(get().DesktopSettings));assert.equal(subscriptions,2);
}));
test('a capture permission request opens the permission tab with instructions and waits for the user',async()=>withDom(async d=>{
 const b=bridge({...granted,screen:'denied'});let open;
 window.homerDesktopPermissions=b;
 window.homerDesktopAccount={state:async()=>({supported:false}),onChange:()=>()=>{}};
 window.homerDesktopSettings={onOpen:fn=>{open=fn;return ()=>{};}};
 await d.render(React.createElement(get().DesktopSettings));
 await act(async()=>open('permissions'));
 const screenRow=row(d,'屏幕采集');assert.ok(screenRow);
 assert.match(screenRow.textContent,/请在系统设置中允许荷马录屏/);
 assert.deepEqual(b.calls,[['check']]);
 await d.click(button(d,'打开屏幕采集系统设置'));
 assert.deepEqual(b.calls,[['check'],['open','screen']]);
}));
test('native source uses existing account actions and requires an explicit apply',async()=>withDom(async d=>{
 const calls=[],listeners=new Set();let changed=()=>{for(const listener of listeners)listener();},current={supported:true,configured:false,source:'website',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'none',connected:false,phase:'idle',pending:false}};
 window.homerDesktopAccount={state:async()=>current,onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},nativeConnect:async()=>{calls.push('nativeConnect');return current={...current,native:{account:'none',connected:false,phase:'waiting',pending:true,canReopen:true}};},nativeCancel:async()=>{calls.push('nativeCancel');return current={...current,native:{account:'none',connected:false,phase:'cancelled',pending:false}};},nativeModels:async()=>nativeSettings(),applyCodex:async()=>{calls.push('applyCodex');return current;}};
 await d.render(React.createElement(get().DesktopAccount));
 await d.click(button(d,'改用 ChatGPT 套餐'));assert.deepEqual(calls,[]);
 await d.click(button(d,'通过 Codex 登录'));assert.deepEqual(calls,['nativeConnect']);assert.ok(button(d,'取消 Codex 登录'));await d.click(button(d,'取消 Codex 登录'));
 current={...current,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};await act(async()=>changed());
 assert.ok(!button(d,'重新检查 Codex 登录'));assert.ok(!button(d,'通过 Codex 登录'));await d.click(button(d,'应用并重启'));assert.deepEqual(calls,['nativeConnect','nativeCancel','applyCodex']);
 current={...current,native:{account:'other',connected:false,phase:'idle',pending:false}};await act(async()=>changed());assert.match(d.container.textContent,/API Key/);assert.ok(!button(d,'通过 Codex 登录'));assert.ok(!button(d,'应用并重启'));
}));
test('unconfirmed Codex status can be retried and disappears after a successful read',async()=>withDom(async d=>{
 let current={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,nativeError:'Codex 登录状态未能确认，请重试。'};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{}};
 await d.render(React.createElement(get().DesktopAccount));assert.ok(button(d,'重新检查 Codex 登录'));
 current={...current,nativeError:undefined,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 await d.click(button(d,'重新检查 Codex 登录'));assert.match(d.container.textContent,/已登录/);assert.ok(!button(d,'重新检查 Codex 登录'));
}));
test('saved website account retains balance and an explicit apply while Codex is active',async()=>withDom(async d=>{
 const calls=[];const current={supported:true,configured:true,source:'codex',connection:'website',active:'disconnected',pending:false,needsRestart:false,stale:true,websiteReady:true};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},refresh:async()=>{calls.push('refresh');return {...current,stale:false,wallet:{available:7,used:1,unit:'CNY'}};},applyWebsite:async()=>{calls.push('applyWebsite');return current;}};
 await d.render(React.createElement(get().DesktopAccount));await act(async()=>{});
 await d.click(button(d,'荷马会员'));
 assert.match(d.container.textContent,/登录信息已保存，应用后生效/);assert.match(d.container.textContent,/7 CNY/);assert.ok(!button(d,'登录'));
 await d.click(button(d,'应用并重启'));assert.deepEqual(calls,['refresh','applyWebsite']);
}));
for(const effective of ['codex','website'])test(`account defaults to ${effective}; status reads keep a manually selected detail and remount restores the default`,async()=>withDom(async d=>{
 let changed;const calls=[],current={supported:true,configured:true,source:effective,connection:'website',active:effective==='website'?'website':'disconnected',pending:false,needsRestart:false,stale:false,websiteReady:true};
 window.homerDesktopAccount={state:async()=>current,onChange:fn=>{changed=fn;return()=>{};},applyWebsite:async()=>{calls.push('applyWebsite');return current;}};
 const title=()=>d.find(n=>n.tagName==='H2').textContent;
 await d.render(React.createElement(get().DesktopAccount));
 assert.equal(title(),effective==='codex'?'ChatGPT 套餐':'荷马模型服务');
 await d.click(button(d,effective==='codex'?'荷马会员':'改用 ChatGPT 套餐'));await act(async()=>changed());
 assert.equal(title(),effective==='codex'?'荷马模型服务':'ChatGPT 套餐');assert.deepEqual(calls,[]);
 await d.render(null);await d.render(React.createElement(get().DesktopAccount));
 assert.equal(title(),effective==='codex'?'ChatGPT 套餐':'荷马模型服务');
 if(effective==='codex')await d.click(button(d,'荷马会员'));
 assert.ok(!button(d,'登录'));
 if(effective==='codex'){await d.click(button(d,'应用并重启'));assert.deepEqual(calls,['applyWebsite']);}
}));
test('model source entry changes only the viewed page; login remains independent',async()=>withDom(async d=>{
 const calls=[],current={supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:true};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},connect:async()=>{calls.push('connect');return current;}};
 await d.render(React.createElement(get().DesktopAccount));
 assert.ok(button(d,'登录'));assert.equal(d.find(n=>n.tagName==='H2').textContent,'荷马模型服务');
 await d.click(button(d,'改用 ChatGPT 套餐'));
 assert.equal(d.find(n=>n.tagName==='H2').textContent,'ChatGPT 套餐');assert.match(d.container.textContent,/Codex/);assert.ok(!button(d,'登录'));assert.deepEqual(calls,[]);
 await d.click(button(d,'荷马会员'));await d.click(button(d,'登录'));assert.deepEqual(calls,['connect']);
}));
test('account panel connects without a Token form and exposes saved/restart and explicit unknown wallet states',async()=>withDom(async d=>{
 let current={supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:true};const calls=[];let changed;
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{changed=undefined;};},...Object.fromEntries(['connect','cancel','refresh','openWebsite','disconnect','restart','reopen'].map(name=>[name,async()=>{calls.push(name);if(name==='connect'||name==='cancel')current={...current,pending:name==='connect',canReopen:name==='connect'};return current;}]))};
 await d.render(React.createElement(get().DesktopAccount));assert.match(d.container.textContent,/未登录/);assert.ok(!row(d,'可用积分'));assert.doesNotMatch(d.container.textContent,/账号连接|个人 Token/);assert.ok(!d.find(n=>n.tagName==='INPUT'));
 await d.click(button(d,'登录'));assert.deepEqual(calls,['connect']);assert.ok(button(d,'取消'));assert.ok(button(d,'重新打开登录页面'));await d.click(button(d,'重新打开登录页面'));assert.equal(calls.at(-1),'reopen');
 await d.click(button(d,'取消'));assert.equal(calls.at(-1),'cancel');assert.ok(button(d,'登录'));assert.ok(!row(d,'可用积分'));
 current={...current,pending:false,connection:'website',needsRestart:true};await act(async()=>changed());
 assert.match(d.container.textContent,/重启后生效/);await d.click(button(d,'重启并应用'));assert.equal(calls.at(-1),'restart');
 current={...current,active:'website',needsRestart:false,walletError:'USAGE_UNAVAILABLE'};await act(async()=>changed());assert.match(d.container.textContent,/可用积分未知/);assert.ok(!button(d,'重新登录'));
 current={...current,active:'website',needsRestart:false,wallet:{available:0,used:5,unit:'积分'},updatedAt:'2026-10-28T00:00:00Z',stale:false};await act(async()=>changed());assert.match(d.container.textContent,/可用积分/);assert.match(d.container.textContent,/0 积分/);assert.ok(!button(d,'刷新'));
 current={...current,stale:true,walletError:'USAGE_UNAVAILABLE'};await act(async()=>changed());assert.match(d.container.textContent,/上次记录/);assert.match(d.container.textContent,/未能确认/);
 await d.remount();assert.equal(changed,undefined);
}));
test('pending authorization observes saved credentials without a change notification or remount',async()=>withDom(async d=>{
 const timers=new Map();let next=0,reads=0,slow;
 window.setInterval=fn=>{timers.set(++next,fn);return next;};window.clearInterval=id=>timers.delete(id);
 let current={supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:true};
 window.homerDesktopAccount={state:async()=>{reads++;return slow?slow.promise:current;},onChange:()=>()=>{},connect:async()=>current={...current,pending:true}};
 await d.render(React.createElement(get().DesktopAccount));assert.equal(timers.size,0);
 await d.click(button(d,'登录'));assert.match(d.container.textContent,/请在浏览器完成登录/);
 const scheduled=[...timers.values()][0],tick=()=>scheduled?.();slow=pending();
 await act(async()=>tick());const before=reads;await act(async()=>tick());assert.equal(reads,before,'slow local reads must not overlap');
 current={...current,pending:false,connection:'website',needsRestart:true};
 await act(async()=>{slow.resolve(current);});
 assert.match(d.container.textContent,/登录信息已保存，重启后生效/);assert.ok(button(d,'重启并应用'));assert.ok(!button(d,'取消'));assert.equal(timers.size,0);
 await act(async()=>tick());assert.equal(reads,before,'a cleared pending observer must not read again');
}));
for(const ending of ['cancel','failure','unmount'])test(`pending authorization stops observing after ${ending}`,async()=>withDom(async d=>{
 const timers=new Map();let next=0,reads=0;
 window.setInterval=fn=>{timers.set(++next,fn);return next;};window.clearInterval=id=>timers.delete(id);
 let current={supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:true,needsRestart:false,stale:true};
 window.homerDesktopAccount={state:async()=>{reads++;return current;},onChange:()=>()=>{},cancel:async()=>current={...current,pending:false,error:'CONNECTION_CANCELLED'}};
 await d.render(React.createElement(get().DesktopAccount));assert.equal(timers.size,1);const tick=[...timers.values()][0];
 if(ending==='unmount')await d.remount();
 else if(ending==='cancel')await d.click(button(d,'取消'));
 else{current={...current,pending:false,error:'ACCOUNT_MISMATCH'};await act(async()=>tick());assert.match(d.container.textContent,/请使用原账号登录/);}
 assert.equal(timers.size,0);const before=reads;await act(async()=>tick());assert.equal(reads,before);
}));
test('slow wallet preserves the connected account and exit without an unnecessary reconnect action',async()=>withDom(async d=>{
 const wait=pending();window.homerDesktopAccount={state:async()=>({supported:true,configured:true,connection:'website',active:'website',pending:false,needsRestart:false,stale:true}),refresh:()=>wait.promise,onChange:()=>()=>{}};
 await d.render(React.createElement(get().DesktopAccount));assert.ok(row(d,'可用积分'));assert.ok(!button(d,'重新连接'));assert.ok(!button(d,'重新登录'));assert.ok(button(d,'退出登录'));
 await d.remount();await act(async()=>wait.resolve({supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:true}));
}));

test('configuration sync errors do not demand login, while an invalid model credential exposes login recovery',async()=>withDom(async d=>{
 let current={supported:true,configured:true,connection:'website',active:'website',pending:false,needsRestart:false,stale:false,error:'CONFIG_UNAVAILABLE',wallet:{available:8,used:2,unit:'积分'},updatedAt:'2026-10-30T00:00:00Z'};let changed;const calls=[];
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{};},connect:async()=>{calls.push('connect');return {...current,pending:true};}};
 await d.render(React.createElement(get().DesktopAccount));assert.ok(!button(d,'重新登录'));assert.ok(button(d,'退出登录'));assert.ok(row(d,'可用积分'));
 current={...current,error:undefined,walletError:'TOKEN_UNAVAILABLE'};await act(async()=>changed());
 assert.match(d.container.textContent,/登录已失效/);assert.match(d.container.textContent,/上次记录/);await d.click(button(d,'重新登录'));assert.deepEqual(calls,['connect']);
}));
test('saved configuration offers restart without login and does not show quota until adopted',async()=>withDom(async d=>{
 let current={supported:true,configured:true,connection:'website',active:'disconnected',pending:false,needsRestart:true,stale:false};let changed;
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{};}};
 await d.render(React.createElement(get().DesktopAccount));assert.ok(button(d,'重启并应用'));assert.ok(!button(d,'登录'));assert.ok(!row(d,'可用积分'));
 current={...current,active:'website'};await act(async()=>changed());assert.match(d.container.textContent,/配置已更新/);assert.ok(!button(d,'重新登录'));
}));
test('desktop account shares the local settings shell without starting network requests',async()=>withDom(async d=>{
 const original=globalThis.fetch,calls=[];
 window.homerDesktopAccount={state:async()=>({supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:true}),onChange:()=>()=>{}};
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error('unexpected_settings_request');};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
  assert.deepEqual(d.all().filter(n=>n.getAttribute('role')==='tab').map(n=>n.textContent),['账号','本机权限','移动设备']);
  assert.ok(button(d,'登录'));assert.equal(calls.length,0);
  await d.click(button(d,'本机权限'));assert.match(d.container.textContent,/辅助功能/);
  await d.click(button(d,'关闭设置'));await d.click(button(d,'设置'));assert.ok(button(d,'登录'));
  assert.equal(calls.length,0);
 }finally{await d.render(null);globalThis.fetch=original;}
}));


test('model quota card keeps purchase reachable without dismissal or replay',async()=>withDom(async d=>{
 const calls=[];window.homerDesktopAccount={state:async()=>firstAccount,onChange:()=>()=>{},openWebsite:async()=>{calls.push('openWebsite');return {configured:true};}};
 const failure={messageId:'new-failure',code:'engine_quota_insufficient',source:'website'};
 const render=(id='new-failure')=>d.render(React.createElement(get().ModelFailureNotice,{key:id,failure:{...failure,messageId:id},onAccount:()=>calls.push('account'),onDismiss:()=>calls.push('dismiss')}));
 await render();assert.match(d.container.textContent,/本次请求因额度不足未能完成/);
 assert.match(d.container.textContent,/剩余积分：暂时无法确认/);assert.deepEqual(calls,[]);
 await d.click(button(d,'购买积分'));assert.deepEqual(calls,['openWebsite']);
 await d.click(button(d,'查看账号与额度'));assert.deepEqual(calls,['openWebsite','account']);
 assert.ok(!button(d,'关闭额度不足提醒'));assert.deepEqual(calls,['openWebsite','account']);
 await render();assert.ok(button(d,'购买积分'));await render('next-failure');assert.ok(button(d,'购买积分'));
}));

for(const [code,title] of [['engine_rate_limited','请求受到限流，本次未能继续'],['main_turn_failed','本次请求未能完成']])test('model failure card distinguishes '+code+' without a recharge or retry action',async()=>withDom(async d=>{
 await d.render(React.createElement(get().ModelFailureNotice,{failure:{messageId:'failure',code,source:'website'},onAccount:()=>assert.fail('account action should not run')}));
 assert.match(d.container.textContent,new RegExp(title));assert.doesNotMatch(d.container.textContent,/充值|额度不足|倒计时|秒后/);
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,1);
}));

for(const [code,title]of [['engine_authentication_failed','账号连接未通过验证'],['engine_account_status_unconfirmed','账号状态未能确认']])test(code+' offers account inspection without guessing a quota failure',async()=>withDom(async d=>{
 const calls=[];window.homerDesktopAccount={state:async()=>firstAccount,onChange:()=>()=>{},openWebsite:async()=>{assert.fail('must not recharge');}};
 await d.render(React.createElement(get().ModelFailureNotice,{failure:{messageId:'failure',code,source:'website'},onAccount:()=>calls.push('account')}));
 assert.match(d.container.textContent,new RegExp(title));assert.doesNotMatch(d.container.textContent,/原因暂无法确认|充值|额度不足|0 积分/);
 await d.click(button(d,'查看账号与额度'));assert.deepEqual(calls,['account']);
}));

test('Codex quota never offers Homer recharge and a failed website open keeps the original card',async()=>withDom(async d=>{
 window.homerDesktopAccount={state:async()=>firstAccount,onChange:()=>()=>{},openWebsite:async()=>{throw Error('PRIVATE_DIAGNOSTICS');}};
 await d.render(React.createElement(get().ModelFailureNotice,{key:'codex',failure:{messageId:'codex',code:'engine_quota_insufficient',source:'codex'},onAccount:()=>{}}));
 assert.ok(!button(d,'购买积分'));assert.ok(button(d,'查看账号与额度'));
 await d.render(React.createElement(get().ModelFailureNotice,{key:'website',failure:{messageId:'website',code:'engine_quota_insufficient',source:'website'},onAccount:()=>{}}));
 await d.click(button(d,'购买积分'));assert.match(d.container.textContent,/购买积分页面未能打开/);assert.doesNotMatch(d.container.textContent,/PRIVATE_DIAGNOSTICS/);assert.ok(!button(d,'关闭额度不足提醒'));assert.ok(button(d,'购买积分'));
}));

test('quota account action opens the existing settings dialog on its account tab and returns to its opener',async()=>withDom(async d=>{
 const ref=React.createRef(),calls=[];window.homerDesktopAccount={state:async()=>{calls.push('state');return {supported:true,source:'website',configured:true,active:'disconnected',connection:'disconnected',stale:false};},onChange:()=>()=>{}};
 await d.render(React.createElement(React.Fragment,null,React.createElement(get().DesktopSettings,{ref}),React.createElement('button',{onClick:()=>ref.current.openAccount()},'查看账号与额度')));
 const opener=button(d,'查看账号与额度');opener.isConnected=true;opener.focus();await d.click(opener);
 assert.equal(d.all().filter(n=>n.getAttribute('role')==='dialog').length,1);
 assert.equal(button(d,'账号').getAttribute('aria-selected'),'true');assert.deepEqual(calls,['state']);
 assert.equal(focusProps.at(-1).finalFocus(),opener);
}));


test('single source account page keeps purchase and logout scoped to Homer and never applies while browsing',async()=>withDom(async d=>{
 const calls=[];const current={supported:true,configured:true,source:'website',connection:'website',active:'website',pending:false,needsRestart:false,stale:false,wallet:{available:0,used:25,unit:'积分'},native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},openWebsite:async()=>{calls.push('openWebsite');return current;},disconnect:async()=>{calls.push('disconnect');return current;},nativeModels:async()=>nativeSettings(),applyCodex:async()=>{calls.push('applyCodex');return current;}};
 await d.render(React.createElement(get().DesktopAccount));
 assert.ok(button(d,'改用 ChatGPT 套餐'));assert.ok(button(d,'购买积分'));assert.ok(button(d,'退出登录'));
 assert.doesNotMatch(d.container.textContent,/已用|已登录|当前使用|账号与额度/);assert.match(d.container.textContent,/0 积分/);
 assert.ok(!button(d,'应用并重启'));
 await d.click(button(d,'购买积分'));assert.deepEqual(calls,['openWebsite']);
 await d.click(button(d,'改用 ChatGPT 套餐'));
 assert.ok(button(d,'荷马会员'));assert.ok(!button(d,'购买积分'));assert.ok(!button(d,'退出登录'));
 assert.match(d.container.textContent,/当前使用荷马模型服务/);assert.deepEqual(calls,['openWebsite']);
 await d.click(button(d,'应用并重启'));assert.deepEqual(calls,['openWebsite','applyCodex']);
 assert.match(d.container.textContent,/当前使用荷马模型服务/,'cancelled native restart must keep the effective source');
 await d.click(button(d,'荷马会员'));await d.click(button(d,'退出登录'));assert.deepEqual(calls,['openWebsite','applyCodex','disconnect']);
}));

test('purchase failure is safe, retains the account and permits a later explicit attempt',async()=>withDom(async d=>{
 let calls=0;const current={supported:true,configured:true,source:'website',connection:'website',active:'website',pending:false,needsRestart:false,stale:false,wallet:{available:3,used:99,unit:'积分'}};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},openWebsite:async()=>{calls++;throw Error('PRIVATE_PURCHASE_DETAILS');}};
 await d.render(React.createElement(get().DesktopAccount));await d.click(button(d,'购买积分'));
 assert.match(d.container.textContent,/购买积分页面未能打开/);assert.doesNotMatch(d.container.textContent,/PRIVATE_PURCHASE_DETAILS|已用/);assert.ok(button(d,'退出登录'));assert.ok(!button(d,'登录'));assert.equal(calls,1);
 await d.click(button(d,'购买积分'));assert.equal(calls,2);
}));

test('native login remains available while the website account is disconnected and follows phase changes',async()=>withDom(async d=>{
 let changed;let current={supported:true,configured:false,source:'website',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'unknown',connected:false,phase:'unconfirmed',pending:false}};
 window.homerDesktopAccount={state:async()=>current,onChange:fn=>{changed=fn;return()=>{};}};
 await d.render(React.createElement(get().DesktopAccount));await d.click(button(d,'改用 ChatGPT 套餐'));
 assert.match(d.container.textContent,/授权结果待确认/);assert.ok(!button(d,'应用并重启'));
 for(const [phase,label] of [['failed','登录失败'],['timed_out','登录已超时'],['cancel_unconfirmed','取消结果待确认']]){
  current={...current,native:{account:'none',connected:false,phase,pending:false}};await act(async()=>changed());
  assert.match(d.container.textContent,new RegExp(label));assert.ok(button(d,'通过 Codex 登录'));assert.ok(!button(d,'应用并重启'));
 }
}));

const firstAccount={supported:true,configured:true,source:'website',connection:'disconnected',active:'disconnected',pending:false,canReopen:false,needsRestart:false,stale:true,native:{account:'none',connected:false,phase:'idle',pending:false,canReopen:false}};
test('first-open account reuses login, reopen, cancel and restart without automatically applying a source',async()=>withDom(async d=>{
 let current={...firstAccount},changed;const actions=[];
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{};},connect:async()=>{actions.push('connect');return current={...current,pending:true,canReopen:true};},reopen:async()=>{actions.push('reopen');return current;},cancel:async()=>{actions.push('cancel');return current={...current,pending:false,error:'CONNECTION_CANCELLED'};},restart:async()=>{actions.push('restart');return current;}};
 await d.render(React.createElement(get().DesktopAccount,{onboarding:true}));
 assert.match(d.container.textContent,/欢迎使用荷马/);assert.match(d.container.textContent,/荷马会员服务/);assert.ok(button(d,'登录荷马'));assert.deepEqual(actions,[]);
 await d.click(button(d,'登录荷马'));assert.match(d.container.textContent,/浏览器完成登录/);
 await d.click(button(d,'重新打开登录页面'));await d.click(button(d,'取消'));assert.match(d.container.textContent,/登录已取消/);
 await d.click(button(d,'登录荷马'));current={...current,pending:false,error:undefined,connection:'website',needsRestart:true};await act(async()=>changed());
 assert.ok(button(d,'重启并应用'));assert.ok(!button(d,'购买积分'));await d.click(button(d,'重启并应用'));
 assert.deepEqual(actions,['connect','reopen','cancel','connect','restart']);
}));
test('first-open ChatGPT navigation never changes the source until explicit application',async()=>withDom(async d=>{
 let current={...firstAccount},changed;const actions=[];
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{};},nativeConnect:async()=>{actions.push('nativeConnect');return current={...current,native:{...current.native,pending:true,canReopen:true}};},nativeReopen:async()=>{actions.push('nativeReopen');return current;},nativeCancel:async()=>{actions.push('nativeCancel');return current={...current,native:{...current.native,pending:false,phase:'cancelled'}};},applyCodex:async()=>{actions.push('applyCodex');return current;}};
 await d.render(React.createElement(get().DesktopAccount,{onboarding:true}));await d.click(button(d,'改用 ChatGPT 套餐'));
 assert.deepEqual(actions,[]);await d.click(button(d,'通过 Codex 登录'));await d.click(button(d,'重新打开 Codex 登录页面'));await d.click(button(d,'取消 Codex 登录'));
 current={...current,native:{...current.native,account:'chatgpt',connected:true,pending:false,phase:'idle'}};await act(async()=>changed());
 assert.ok(button(d,'应用并重启'));assert.doesNotMatch(d.container.textContent,/调用已验证/);await d.click(button(d,'应用并重启'));
 assert.deepEqual(actions,['nativeConnect','nativeReopen','nativeCancel','applyCodex']);
}));
for(const onboarding of [false,true])for(const [name,changes,want] of [
 ['zero',{wallet:{available:0,used:1,unit:'积分'},stale:false},'zero'],
 ['positive',{wallet:{available:2,used:1,unit:'积分'},stale:false},'positive'],
 ['unknown',{stale:false},'unknown'],
 ['stale zero',{wallet:{available:0,used:1,unit:'积分'},stale:true},'unknown'],
 ['failed zero',{wallet:{available:0,used:1,unit:'积分'},stale:false,walletError:'USAGE_UNAVAILABLE'},'unknown'],
 ['expired zero',{wallet:{available:0,used:1,unit:'积分'},stale:false,walletError:'TOKEN_UNAVAILABLE'},'unknown'],
])test((onboarding?'first-open hides wallet and purchase actions: ':'account wallet guidance preserves ')+name,async()=>withDom(async d=>{
 const current={...firstAccount,connection:'website',active:'website',updatedAt:'2026-11-04T00:00:00Z',...changes};
 window.homerDesktopAccount={state:async()=>current,refresh:async()=>current,onChange:()=>()=>{}};
 await d.render(React.createElement(get().DesktopAccount,{onboarding}));
 if(onboarding){
  assert.ok(!row(d,'可用积分'));assert.doesNotMatch(d.container.textContent,/可用积分|更新时间|上次记录|购买积分后即可开始使用/);
  for(const label of ['购买积分','我已购买，刷新状态','重新检查积分'])assert.ok(!button(d,label));
  assert.ok(button(d,'改用 ChatGPT 套餐'));
 }else{
  assert.ok(row(d,'可用积分'));assert.ok(button(d,'购买积分'));
  if(want==='zero'){assert.match(d.container.textContent,/购买积分后即可开始使用/);assert.ok(button(d,'我已购买，刷新状态'));}
  else{assert.doesNotMatch(d.container.textContent,/购买积分后即可开始使用|积分不足/);assert.ok(!button(d,'我已购买，刷新状态'));if(want==='unknown'){assert.match(d.container.textContent,/暂时无法确认/);assert.ok(button(d,'重新检查积分'));}}
 }
}));
test('account purchase and refresh failures keep a retry and never retain a zero-balance conclusion',async()=>withDom(async d=>{
 let current={...firstAccount,connection:'website',active:'website',stale:false,wallet:{available:0,used:1,unit:'积分'}};let fail=false;
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},openWebsite:async()=>{throw Error('synthetic-open-failure');},refresh:async()=>{if(fail)throw Error('synthetic-read-failure');return current={...current,wallet:{...current.wallet,available:3}};}};
 await d.render(React.createElement(get().DesktopAccount));await d.click(button(d,'购买积分'));assert.match(d.container.textContent,/购买积分页面未能打开/);
 fail=true;await d.click(button(d,'我已购买，刷新状态'));assert.match(d.container.textContent,/暂时无法确认/);assert.doesNotMatch(d.container.textContent,/购买积分后即可开始使用/);
 fail=false;await d.click(button(d,'重新检查积分'));assert.match(d.container.textContent,/3 积分/);assert.doesNotMatch(d.container.textContent,/暂时无法确认|购买积分后即可开始使用/);
}));
test('first-open unreadable account exposes a working retry instead of an absent login',async()=>withDom(async d=>{
 let fail=true;window.homerDesktopAccount={state:async()=>{if(fail)throw Error('synthetic-read-failure');return firstAccount;},onChange:()=>()=>{}};
 await d.render(React.createElement(get().DesktopAccount,{onboarding:true}));assert.match(d.container.textContent,/状态未能确认/);fail=false;await d.click(button(d,'重新检查账号'));assert.ok(button(d,'登录荷马'));
}));

// Execute the actual app condition and account JSX without starting its service.
function firstOpenApp(state,connected=false,mobileView=false){
 const source=readFileSync('ui/homer-app.tsx','utf8'),ast=ts.createSourceFile('homer-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const app=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='HomerApp');
 const condition=app.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='accountRequired'));assert.ok(condition);
 let view;const visit=node=>{if(ts.isJsxExpression(node)&&node.getText(ast).startsWith('{accountRequired&&'))view=node;ts.forEachChild(node,visit);};visit(app);assert.ok(view);
 const code=ts.transpileModule(`module.exports=function FirstOpen(){${condition.getText(ast)}return <>${view.getText(ast)}</>;}`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};Function('require','module','exports','state','connected','mobileView','DesktopAccount',code)(require,m,m.exports,state,connected,mobileView,get().DesktopAccount);return m.exports;
}
for(const [name,phase,code,connected,mobile,bridgePresent,want] of [
 ['required','management','desktop_account_required',false,false,true,true],
 ['starting','starting',undefined,false,false,true,false],
 ['other failure','management','engine_failed',false,false,true,false],
 ['connected','running','desktop_account_required',true,false,true,false],
 ['web','management','desktop_account_required',false,false,false,false],
 ['mobile','management','desktop_account_required',false,true,true,false],
])test('chat first-open entry only enables the trusted account-required branch: '+name,async()=>withDom(async d=>{
 let reads=0;if(bridgePresent)window.homerDesktopAccount={state:async()=>{reads++;return firstAccount;},onChange:()=>()=>{}};
 const App=firstOpenApp({upgrade:{phase,code}},connected,mobile);await d.render(React.createElement(App));
 assert.equal(!!button(d,'登录荷马'),want);assert.equal(reads,want?1:0);
}));

test('existing ChatGPT source can restart after reconnecting without switching source again',async()=>withDom(async d=>{
 let current={...firstAccount,source:'codex'},changed;const actions=[];
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{};},nativeConnect:async()=>{actions.push('nativeConnect');return current;},restart:async()=>{actions.push('restart');return current;}};
 await d.render(React.createElement(get().DesktopAccount,{onboarding:true}));await d.click(button(d,'改用 ChatGPT 套餐'));assert.ok(!button(d,'重启并应用'));
 await d.click(button(d,'通过 Codex 登录'));current={...current,native:{account:'chatgpt',connected:true,phase:'idle',pending:false,canReopen:false}};await act(async()=>changed());
 assert.ok(button(d,'重启并应用'));assert.ok(!button(d,'应用并重启'));await d.click(button(d,'重启并应用'));assert.deepEqual(actions,['nativeConnect','restart']);
}));

test('Homer login from an existing ChatGPT source only offers the action that applies website source',async()=>withDom(async d=>{
 let current={...firstAccount,source:'codex',connection:'website',needsRestart:true,websiteReady:true};const actions=[];
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},restart:async()=>{actions.push('restart');return current;},applyWebsite:async()=>{actions.push('applyWebsite');return current;}};
 await d.render(React.createElement(get().DesktopAccount,{onboarding:true}));assert.ok(!button(d,'重启并应用'));assert.ok(button(d,'应用并重启'));
 await d.click(button(d,'应用并重启'));assert.deepEqual(actions,['applyWebsite']);
}));

for(const onboarding of [false,true])test('cached zero wallet expires while open and after reopening: '+onboarding,async t=>withDom(async d=>{
 const now=1800000000000,expiresAt=now/1000+30; t.mock.timers.enable({apis:['Date'],now});
 const timers=new Map();let next=0,reads=0;
 window.setTimeout=(fn,delay)=>{timers.set(++next,{fn,delay});return next;};window.clearTimeout=id=>timers.delete(id);
 const current={...firstAccount,source:'codex',connection:'website',websiteReady:true,stale:false,wallet:{available:0,used:1,unit:'积分',expiresAt}};
 window.homerDesktopAccount={state:async()=>{reads++;return {...current};},onChange:()=>()=>{},refresh:async()=>({...current,stale:true,walletError:'TOKEN_UNAVAILABLE'})};
 await d.render(React.createElement(get().DesktopAccount,{onboarding}));
 if(!onboarding)await d.click(button(d,'荷马会员'));
 if(onboarding)assert.ok(!row(d,'可用积分'));else assert.match(d.container.textContent,/购买积分后即可开始使用/);
 assert.equal(timers.size,1);
 const timer=[...timers.values()][0];assert.equal(timer.delay,30000);const before=reads;
 t.mock.timers.tick(30000);await act(async()=>timer.fn());assert.equal(reads,before+1);
 assert.doesNotMatch(d.container.textContent,/购买积分后即可开始使用/);assert.match(d.container.textContent,/登录已失效/);
 if(onboarding)assert.ok(!row(d,'可用积分'));else assert.match(d.container.textContent,/暂时无法确认/);
 assert.ok(!button(d,'应用并重启'));assert.equal(timers.size,0);
 await d.remount();await d.render(React.createElement(get().DesktopAccount,{onboarding}));
 if(!onboarding)await d.click(button(d,'荷马会员'));
 assert.doesNotMatch(d.container.textContent,/购买积分后即可开始使用/);assert.match(d.container.textContent,/登录已失效/);
 if(onboarding)assert.ok(!row(d,'可用积分'));else assert.match(d.container.textContent,/暂时无法确认/);
 assert.ok(!button(d,'应用并重启'));
}));

for(const [name,changes,visible] of [
 ['zero',{wallet:{available:0,used:1,unit:'积分'}},true],
 ['low',{wallet:{available:3.5,used:1,unit:'积分'}},true],
 ['threshold',{wallet:{available:10,used:1,unit:'积分'}},true],
 ['above threshold',{wallet:{available:10.01,used:1,unit:'积分'}},false],
 ['unknown',{wallet:undefined},false],
 ['stale',{stale:true},false],
 ['failed',{walletError:'USAGE_UNAVAILABLE'},false],
 ['expired',{wallet:{available:0,used:1,unit:'积分',expiresAt:1}},false],
 ['not active',{active:'disconnected'},false],
 ['unsupported',{supported:false},false],
 ['not configured',{configured:false},false],
 ['ChatGPT',{source:'codex',active:'disconnected'},false],
 ['other unit',{wallet:{available:1,used:1,unit:'CNY'}},false],
])test('proactive purchase notice uses current trusted points only: '+name,async()=>withDom(async d=>{
 const calls=[],current={...firstAccount,source:'website',active:'website',connection:'website',stale:false,wallet:{available:0,used:1,unit:'积分'},...changes};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},openWebsite:async()=>{calls.push('openWebsite');return current;}};
 await d.render(React.createElement(get().ModelFailureNotice,{onDismiss:()=>assert.fail('must not dismiss')}));
 assert.equal(!!row(d,'积分余额提醒'),visible);assert.deepEqual(calls,[]);
 if(visible){assert.match(d.container.textContent,new RegExp('剩余积分：'+current.wallet.available+' 积分'));assert.ok(button(d,'购买积分'));assert.ok(button(d,'刷新余额'));assert.ok(!d.find(n=>n.tagName==='BUTTON'&&n.getAttribute('aria-label')?.startsWith('关闭')));
  if(current.wallet.available===0)assert.match(d.container.textContent,/新的模型请求将无法继续/);else assert.match(d.container.textContent,/积分用完后/);
 }
}));

test('proactive credit refresh retains an unknown recovery path then clears above ten',async()=>withDom(async d=>{
 let current={...firstAccount,active:'website',connection:'website',stale:false,wallet:{available:0,used:1,unit:'积分'}},changed,fail=false;const calls=[];
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{changed=cb;return()=>{};},openWebsite:async()=>{calls.push('openWebsite');return current;},refresh:async()=>{calls.push('refresh');if(fail)throw Error('PRIVATE_BALANCE_ERROR');return current;}};
 await d.render(React.createElement(get().ModelFailureNotice));await d.click(button(d,'购买积分'));assert.deepEqual(calls,['openWebsite']);
 fail=true;await d.click(button(d,'刷新余额'));assert.ok(row(d,'积分余额提醒'));assert.match(d.container.textContent,/剩余积分：暂时无法确认/);assert.doesNotMatch(d.container.textContent,/剩余积分：0|PRIVATE_BALANCE_ERROR|积分已用完/);assert.ok(button(d,'购买积分'));assert.ok(button(d,'刷新余额'));
 fail=false;current={...current,wallet:{...current.wallet,available:10}};await d.click(button(d,'刷新余额'));assert.ok(row(d,'积分余额提醒'));assert.match(d.container.textContent,/10 积分/);
 current={...current,wallet:{...current.wallet,available:11}};await act(async()=>changed());assert.equal(d.container.textContent,'');
}));

test('ChatGPT with a saved Homer wallet does not fetch Homer credit proactively',async()=>withDom(async d=>{
 window.homerDesktopAccount={state:async()=>({...firstAccount,source:'codex',connection:'website',stale:true}),onChange:()=>()=>{},refresh:async()=>assert.fail('must not query unused Homer wallet')};
 await d.render(React.createElement(get().ModelFailureNotice));assert.equal(d.container.textContent,'');
}));

test('non-quota failure keeps its original close action and reveals a pending low balance afterwards',async()=>withDom(async d=>{
 window.homerDesktopAccount={state:async()=>({...firstAccount,active:'website',connection:'website',stale:false,wallet:{available:5,used:0,unit:'积分'}}),onChange:()=>()=>{}};
 await d.render(React.createElement(get().ModelFailureNotice,{failure:{messageId:'auth',code:'engine_authentication_failed',source:'website'}}));
 assert.match(d.container.textContent,/账号连接未通过验证/);await d.click(button(d,'关闭请求失败提醒'));assert.match(d.container.textContent,/剩余积分：5 积分/);assert.ok(button(d,'购买积分'));
}));

test('successful manual refresh clears an existing quota failure without sending a request',async()=>withDom(async d=>{
 let current={...firstAccount,active:'website',connection:'website',stale:false,wallet:{available:20,used:0,unit:'积分'}};const calls=[];
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},refresh:async()=>{calls.push('refresh');return current={...current,wallet:{...current.wallet,available:30}};}};
 await d.render(React.createElement(get().ModelFailureNotice,{failure:{messageId:'request-costs-more',code:'engine_quota_insufficient',source:'website'}}));
 assert.ok(row(d,'积分余额提醒'));assert.match(d.container.textContent,/20 积分/);assert.match(d.container.textContent,/当前额度不足以继续本次请求/);
 await d.click(button(d,'刷新余额'));assert.equal(d.container.textContent,'');assert.deepEqual(calls,['refresh']);
}));

test('settings credit refresh updates the visible reminder and failed notifications never loop',async()=>withDom(async d=>{
 let current={...firstAccount,active:'website',connection:'website',stale:false,wallet:{available:0,used:0,unit:'积分'}},fail=false,refreshes=0;const listeners=new Set();
 window.homerDesktopAccount={state:async()=>current,onChange:cb=>{listeners.add(cb);return()=>listeners.delete(cb);},refresh:async()=>{
  refreshes++;current=fail?{...current,stale:true,walletError:'USAGE_UNAVAILABLE'}:{...current,wallet:{...current.wallet,available:20},stale:false,walletError:undefined};listeners.forEach(cb=>cb());return current;
 }};
 await d.render(React.createElement(React.Fragment,null,React.createElement(get().ModelFailureNotice),React.createElement(get().DesktopAccount)));
 assert.equal(listeners.size,2);fail=true;await d.click(button(d,'我已购买，刷新状态'));assert.equal(refreshes,1);assert.ok(row(d,'积分余额提醒'));assert.match(d.container.textContent,/剩余积分：暂时无法确认/);
 fail=false;await d.click(button(d,'重新检查积分'));assert.equal(refreshes,2);assert.ok(!row(d,'积分余额提醒'));assert.match(d.container.textContent,/20 积分/);
 await d.render(null);assert.equal(listeners.size,0);
}));

test('visible low balance becomes unconfirmed at credential expiry without retaining a zero conclusion',async t=>withDom(async d=>{
 const now=1800000000000;t.mock.timers.enable({apis:['Date'],now});const timers=new Map();let next=0;
 window.setTimeout=(fn,delay)=>{timers.set(++next,{fn,delay});return next;};window.clearTimeout=id=>timers.delete(id);
 const current={...firstAccount,active:'website',connection:'website',stale:false,wallet:{available:0,used:0,unit:'积分',expiresAt:now/1000+1}};
 window.homerDesktopAccount={state:async()=>({...current}),onChange:()=>()=>{}};
 await d.render(React.createElement(get().ModelFailureNotice));assert.match(d.container.textContent,/剩余积分：0 积分/);
 const timer=[...timers.values()][0];t.mock.timers.tick(1000);await act(async()=>timer.fn());
 assert.match(d.container.textContent,/剩余积分：暂时无法确认/);assert.match(d.container.textContent,/登录凭据已失效/);assert.doesNotMatch(d.container.textContent,/积分已用完|剩余积分：0/);assert.ok(!button(d,'购买积分'));assert.ok(button(d,'刷新余额'));
 await d.render(null);assert.equal(timers.size,0);
}));

test('purchase reminder never owns a second login waiting poll',async()=>withDom(async d=>{
 window.setInterval=()=>assert.fail('the login view owns authorization polling');
 window.homerDesktopAccount={state:async()=>({...firstAccount,source:'codex',native:{...firstAccount.native,pending:true}}),onChange:()=>()=>{}};
 await d.render(React.createElement(get().ModelFailureNotice));assert.equal(d.container.textContent,'');
}));

test('quota balance preserves the native currency rather than labeling it as points',async()=>withDom(async d=>{
 window.homerDesktopAccount={state:async()=>({...firstAccount,active:'website',connection:'website',stale:false,wallet:{available:1,used:0,unit:'CNY'}}),onChange:()=>()=>{}};
 await d.render(React.createElement(get().ModelFailureNotice,{failure:{messageId:'currency-quota',code:'engine_quota_insufficient',source:'website'}}));
 assert.match(d.container.textContent,/剩余额度：1 CNY/);assert.doesNotMatch(d.container.textContent,/剩余积分：1/);
}));

const nativeSettings=()=>({current:{main:{model:'gpt-6.1-terra',effort:'high',serviceTier:'priority'},worker:{model:'gpt-6.1-terra',effort:'xhigh',serviceTier:null}},defaults:{main:{model:'gpt-6.1-terra',effort:'high',serviceTier:'priority'},worker:{model:'gpt-6.1-terra',effort:'xhigh',serviceTier:null}},models:[{model:'gpt-6.1-terra',displayName:'GPT-6.1 Terra',defaultReasoningEffort:'high',supportedReasoningEfforts:['low','medium','high','xhigh'].map(reasoningEffort=>({reasoningEffort})),serviceTiers:[{id:'priority',name:'Fast'}]}]});
test('ChatGPT settings keep independent role drafts and submit both roles through one apply action',async()=>withDom(async d=>{
 const current={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 const calls=[];window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},nativeModels:async()=>nativeSettings(),applyCodex:async roles=>{calls.push(roles);return current;}};
 await d.render(React.createElement(get().DesktopAccount));
 assert.ok(button(d,'Homer 速度：Fast'));assert.ok(button(d,'Worker 速度：标准'));assert.equal(button(d,'应用并重启').getAttribute('disabled'),'');
 await d.click(button(d,'Homer 速度：Fast'));assert.equal(button(d,'应用并重启').getAttribute('disabled'),null);assert.ok(button(d,'Worker 速度：标准'));
 await d.click(button(d,'应用并重启'));
 assert.deepEqual(calls,[{main:{model:'gpt-6.1-terra',effort:'high',serviceTier:null},worker:{model:'gpt-6.1-terra',effort:'xhigh',serviceTier:null}}]);
 await d.click(button(d,'恢复默认'));assert.ok(button(d,'Homer 速度：Fast'));assert.equal(calls.length,1);
}));
test('ChatGPT catalog errors preserve unavailable saved model values through retry',async()=>withDom(async d=>{
 const current={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 let failed=true;const settings=nativeSettings();settings.current.main.model='saved-unavailable';
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},nativeModels:async()=>({...settings,...(failed?{models:undefined,error:'native_models_unconfirmed'}:{})}),applyCodex:async()=>current};
 await d.render(React.createElement(get().DesktopAccount));assert.match(d.container.textContent,/saved-unavailable/);assert.ok(button(d,'重试模型列表'));assert.equal(button(d,'应用并重启').getAttribute('disabled'),'');assert.equal(button(d,'Homer 速度：Fast').getAttribute('title'),'Homer 速度：Fast');
 failed=false;await d.click(button(d,'重试模型列表'));assert.match(d.container.textContent,/saved-unavailable/);assert.match(d.container.textContent,/不可用/);assert.equal(button(d,'应用并重启').getAttribute('disabled'),'');
}));
test('ChatGPT account refresh and catalog retry preserve edited role drafts',async()=>withDom(async d=>{
 const current={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 const listeners=new Set();let failed=false;
 window.homerDesktopAccount={state:async()=>current,onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},nativeModels:async()=>({...nativeSettings(),...(failed?{models:undefined,error:'native_models_unconfirmed'}:{})}),applyCodex:async()=>current};
 await d.render(React.createElement(get().DesktopAccount));await d.click(button(d,'Homer 速度：Fast'));
 failed=true;await act(async()=>{for(const fn of listeners)fn();});
 assert.ok(button(d,'Homer 速度：标准'));assert.equal(button(d,'应用并重启').getAttribute('disabled'),'');assert.ok(button(d,'Worker 速度：标准'));
 failed=false;await d.click(button(d,'重试模型列表'));
 assert.ok(button(d,'Homer 速度：标准'));assert.equal(button(d,'应用并重启').getAttribute('disabled'),null);
}));
test('ChatGPT marks a saved effort unavailable when the catalog omits it from adjustable choices',async()=>withDom(async d=>{
 const current={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 const settings=nativeSettings();settings.models[0].supportedReasoningEfforts=[{reasoningEffort:'low'}];
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},nativeModels:async()=>settings};
 await d.render(React.createElement(get().DesktopAccount));
 assert.match(d.container.textContent,/Homer 的当前配置不可用/);assert.equal(button(d,'应用并重启').getAttribute('disabled'),'');
}));
test('ChatGPT failed apply reloads changed permissions once and preserves both role drafts',async()=>withDom(async d=>{
 const current={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 let changed=false,reads=0;
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},nativeModels:async()=>{reads++;const settings=nativeSettings();if(changed)settings.models[0].serviceTiers=[];return settings;},applyCodex:async()=>{changed=true;throw Error('chatgpt_model_selection_unavailable');}};
 await d.render(React.createElement(get().DesktopAccount));await d.click(button(d,'Worker 速度：标准'));
 await d.click(button(d,'应用并重启'));
 assert.equal(reads,2);assert.ok(button(d,'Worker 速度：Fast'));assert.ok(button(d,'Homer 速度：Fast'));
 assert.match(d.container.textContent,/Worker 的当前配置不可用/);assert.equal(button(d,'应用并重启').getAttribute('disabled'),'');
}));
test('ChatGPT transient account uncertainty disables controls and retains drafts through login recheck',async()=>withDom(async d=>{
 const connected={supported:true,configured:false,source:'codex',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};
 const listeners=new Set();let current=connected;
 window.homerDesktopAccount={state:async()=>current,onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},nativeModels:async()=>nativeSettings()};
 await d.render(React.createElement(get().DesktopAccount));await d.click(button(d,'Homer 速度：Fast'));
 current={...connected,native:undefined,nativeError:'Codex 登录状态未能确认，请重试。'};await act(async()=>{for(const fn of listeners)fn();});
 assert.equal(button(d,'Homer 速度：标准')?.getAttribute('disabled'),'');assert.equal(button(d,'恢复默认')?.getAttribute('disabled'),'');
 current=connected;await d.click(button(d,'重新检查 Codex 登录'));
 assert.ok(button(d,'Homer 速度：标准'));assert.equal(button(d,'应用并重启').getAttribute('disabled'),null);
}));
