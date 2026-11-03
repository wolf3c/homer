import {test,beforeEach,afterEach} from 'node:test';
let previousStorage;
beforeEach(()=>{previousStorage=globalThis.sessionStorage;const entries=new Map();globalThis.sessionStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};});
afterEach(()=>{if(previousStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previousStorage;});
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import {withDom} from './helpers/process-dom.mjs';

// Reuse the existing React DOM harness. Base UI's portal/focus engine needs a
// browser: these adapters exercise our controlled props and actions, not that engine.
const require=createRequire(import.meta.url),focusProps=[];
const dialogContext=React.createContext(null);
const pass=tag=>React.forwardRef(({children,...props},ref)=>React.createElement(tag,{...props,ref},children));
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
function load(){
 const result=buildSync({entryPoints:['ui/desktop-permissions.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.png':'dataurl'},external:['react','react/jsx-runtime','@base-ui/react/dialog','@base-ui/react/alert-dialog','@base-ui/react/tabs','@base-ui/react/button'],logLevel:'silent'});
 const m={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(name=>name==='@base-ui/react/dialog'?{Dialog}:name==='@base-ui/react/alert-dialog'?{AlertDialog:Dialog}:name==='@base-ui/react/tabs'?{Tabs}:name==='@base-ui/react/button'?{Button:pass('button')}:require(name),m,m.exports);return m.exports;
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

test('one settings dialog exposes permissions and both IM channels without starting channel requests',async()=>withDom(async d=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error('unexpected_channel_request');};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
  assert.deepEqual(d.all().filter(n=>n.getAttribute('role')==='tab').map(n=>n.textContent),['本机权限','移动设备','微信','Telegram']);
  assert.equal(d.all().filter(n=>n.getAttribute('role')==='dialog').length,1);
  assert.equal(calls.length,0);
 }finally{globalThis.fetch=original;}
}));

test('unavailable channel reads never show an unconfigured form; unknown recovery cannot resume or erase history',async()=>withDom(async d=>{
 const original=globalThis.fetch,location=globalThis.location,calls=[];
 globalThis.location=new URL('http://127.0.0.1:12345/');
 const state={status:'disabled',enabled:false,bound:true,generation:1,pending:0,uncertain:0,failed:0,extensions:{},recovery:{mode:'new_messages_only',clockVerified:false,reviewRequired:false,heldLocal:8,heldRemote:0}};
 globalThis.fetch=async(path,init)=>{calls.push({path,init});return path.endsWith('wechat')?Response.json(state):Response.json({error:'web_method_denied'},{status:409});};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));await d.click(button(d,'微信'));
  assert.match(d.container.textContent,/本人绑定已保留/);assert.equal(button(d,'恢复收发').getAttribute('disabled'),'');assert.equal(button(d,'解除绑定').getAttribute('disabled'),'');
  await d.click(button(d,'恢复收发'));await d.click(button(d,'解除绑定'));assert.equal(calls.filter(c=>c.init.method==='POST').length,0);
  await d.click(button(d,'Telegram'));assert.match(d.container.textContent,/状态暂不可用/);assert.ok(!d.find(n=>n.tagName==='INPUT'));assert.ok(button(d,'重新检查'));
  assert.equal(calls.filter(c=>c.init.method==='POST').length,0);
 }finally{await d.render(null);globalThis.fetch=original;if(location===undefined)delete globalThis.location;else globalThis.location=location;}
}));

test('Telegram pairing sends the exact explicitly approved candidate and expired candidates cannot be approved',async t=>withDom(async d=>{
 const original=globalThis.fetch,location=globalThis.location,calls=[];
 globalThis.location=new URL('http://127.0.0.1:12345/');
 const state={status:'online',configured:true,enabled:true,bound:false,pending:0,uncertain:0,failed:0,heldInputs:0,uncertainInputs:0,recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:false,heldLocal:0,heldRemote:0}};
 const code='abcdef0123456789abcdef0123456789',candidate={userId:'1234567',chatId:'1234567'};
 globalThis.fetch=async(path,init)=>{calls.push({path,init});return Response.json(path.endsWith('/pair/candidate')?candidate:path.endsWith('/pair/approve')?{...state,bound:true}:path.endsWith('/pair')?{code,expiresInSeconds:600}:state);};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));await d.click(button(d,'Telegram'));
  assert.doesNotMatch(d.container.textContent,/收发已开启/,'an online transport without an approved owner is not ready for messaging');
  await d.click(button(d,'生成配对码'));assert.match(d.container.textContent,/1234567/);assert.equal(calls.filter(c=>c.path.endsWith('/pair/approve')).length,0);
  t.mock.timers.enable({apis:['Date'],now:Date.now()+601000});
  await d.click(button(d,'确认是我并绑定'));assert.equal(calls.filter(c=>c.path.endsWith('/pair/approve')).length,0);assert.match(d.container.textContent,/已过期/);
  await d.click(button(d,'生成配对码'));await d.click(button(d,'确认是我并绑定'));
  const approvals=calls.filter(c=>c.path.endsWith('/pair/approve'));assert.equal(approvals.length,1);assert.deepEqual(JSON.parse(approvals[0].init.body),{code,...candidate});assert.match(d.container.textContent,/本人绑定已保留/);
 }finally{await d.render(null);globalThis.fetch=original;if(location===undefined)delete globalThis.location;else globalThis.location=location;}
}));

test('a failed WeChat QR image exposes a visible recovery action instead of silently disappearing',async()=>withDom(async d=>{
 const original=globalThis.fetch,location=globalThis.location;
 globalThis.location=new URL('http://127.0.0.1:12345/');
 globalThis.fetch=async()=>Response.json({status:'connecting',enabled:false,bound:false,generation:1,pending:0,uncertain:0,failed:0,extensions:{},recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:false,heldLocal:0,heldRemote:0},login:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',status:'wait',imagePath:'/api/channels/wechat/login/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/qr.png'}});
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));await d.click(button(d,'微信'));
  const image=d.find(n=>n.tagName==='IMG');assert.ok(image);
  Object.defineProperty(image,'hidden',{set(value){if(value)this.setAttribute('hidden','');}});
  await act(async()=>{for(const {handler} of image.listeners.error??[])handler({type:'error',target:image,bubbles:false});});
  assert.match(d.container.textContent,/二维码未能显示/);assert.ok(button(d,'重新生成二维码'));
 }finally{await d.render(null);globalThis.fetch=original;if(location===undefined)delete globalThis.location;else globalThis.location=location;}
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
test('native source uses existing account actions and requires an explicit apply',async()=>withDom(async d=>{
 const calls=[];let current={supported:true,configured:false,source:'website',connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:false,native:{account:'none',connected:false,phase:'idle',pending:false}};
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},nativeConnect:async()=>{calls.push('nativeConnect');return current={...current,native:{account:'none',connected:false,phase:'waiting',pending:true,canReopen:true}};},nativeCancel:async()=>{calls.push('nativeCancel');return current={...current,native:{account:'none',connected:false,phase:'cancelled',pending:false}};},applyCodex:async()=>{calls.push('applyCodex');return current;}};
 await d.render(React.createElement(get().DesktopAccount));
 await d.click(button(d,'改用 ChatGPT 套餐'));assert.deepEqual(calls,[]);
 await d.click(button(d,'通过 Codex 登录'));assert.deepEqual(calls,['nativeConnect']);assert.ok(button(d,'取消 Codex 登录'));await d.click(button(d,'取消 Codex 登录'));
 current={...current,native:{account:'chatgpt',connected:true,phase:'idle',pending:false}};await d.click(button(d,'重新检查 Codex 登录'));
 assert.ok(!button(d,'通过 Codex 登录'));await d.click(button(d,'应用并重启'));assert.deepEqual(calls,['nativeConnect','nativeCancel','applyCodex']);
 current={...current,native:{account:'other',connected:false,phase:'idle',pending:false}};await d.click(button(d,'重新检查 Codex 登录'));assert.match(d.container.textContent,/API Key/);assert.ok(!button(d,'通过 Codex 登录'));assert.ok(!button(d,'应用并重启'));
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
 let changed;const calls=[],current={supported:true,configured:true,source:effective,connection:'legacy',active:effective==='website'?'legacy':'disconnected',pending:false,needsRestart:false,stale:false,websiteReady:true};
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
test('ordinary parent renders do not postpone WeChat login polling indefinitely',async t=>withDom(async d=>{
 const original=globalThis.fetch,location=globalThis.location,calls=[];
 globalThis.location=new URL('http://127.0.0.1:12345/');
 const login={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',status:'wait'};
 const state={status:'connecting',enabled:false,bound:false,generation:1,pending:0,uncertain:0,failed:0,extensions:{},recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:false,heldLocal:0,heldRemote:0},login};
 globalThis.fetch=async(path,init)=>{calls.push({path,init});return Response.json(path.endsWith('/login/poll')?{...login,status:'confirmed'}:state);};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  await d.click(button(d,'微信'));
  for(let i=0;i<5;i++){await act(async()=>{t.mock.timers.tick(500);});await d.render(React.createElement(get().DesktopSettings));}
  assert.equal(calls.filter(c=>c.path.endsWith('/login/poll')).length,1);
 }finally{await d.render(null);globalThis.fetch=original;if(location===undefined)delete globalThis.location;else globalThis.location=location;}
}));


test('desktop account shares the channel settings shell without starting hidden channel requests',async()=>withDom(async d=>{
 const original=globalThis.fetch,calls=[];
 window.homerDesktopAccount={state:async()=>({supported:true,configured:true,connection:'disconnected',active:'disconnected',pending:false,needsRestart:false,stale:true}),onChange:()=>()=>{}};
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error('unexpected_channel_request');};
 try{
  await d.render(React.createElement(get().DesktopSettings));await d.click(button(d,'设置'));
  assert.deepEqual(d.all().filter(n=>n.getAttribute('role')==='tab').map(n=>n.textContent),['账号','本机权限','移动设备','微信','Telegram']);
  assert.ok(button(d,'登录'));assert.equal(calls.length,0);
  await d.click(button(d,'本机权限'));assert.match(d.container.textContent,/辅助功能/);
  await d.click(button(d,'关闭设置'));await d.click(button(d,'设置'));assert.ok(button(d,'登录'));
  assert.equal(calls.length,0);
 }finally{await d.render(null);globalThis.fetch=original;}
}));


test('model quota card reuses the existing website/account actions and closes without replay',async()=>withDom(async d=>{
 const calls=[];window.homerDesktopAccount={openWebsite:async()=>{calls.push('openWebsite');return {configured:true};}};
 const failure={messageId:'new-failure',code:'engine_quota_insufficient',source:'website'};
 const render=(id='new-failure')=>d.render(React.createElement(get().ModelFailureNotice,{key:id,failure:{...failure,messageId:id},onAccount:()=>calls.push('account'),onDismiss:()=>calls.push('dismiss')}));
 await render();assert.match(d.container.textContent,/额度不足当前额度不足以继续本次请求。/);
 assert.doesNotMatch(d.container.textContent,/积分|金额|剩余|未知|预扣/);assert.deepEqual(calls,[]);
 await d.click(button(d,'充值'));assert.deepEqual(calls,['openWebsite']);
 await d.click(button(d,'查看账号与额度'));assert.deepEqual(calls,['openWebsite','account']);
 await d.click(button(d,'关闭额度不足提醒'));assert.deepEqual(calls,['openWebsite','account','dismiss']);
 await render();assert.equal(d.container.textContent,'');await render('next-failure');assert.ok(button(d,'充值'));
}));

for(const [code,title] of [['engine_rate_limited','请求受到限流，本次未能继续'],['main_turn_failed','本次请求未能完成']])test('model failure card distinguishes '+code+' without a recharge or retry action',async()=>withDom(async d=>{
 await d.render(React.createElement(get().ModelFailureNotice,{failure:{messageId:'failure',code,source:'website'},onAccount:()=>assert.fail('account action should not run')}));
 assert.match(d.container.textContent,new RegExp(title));assert.doesNotMatch(d.container.textContent,/充值|额度不足|倒计时|秒后/);
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,1);
}));

test('Codex quota never offers Homer recharge and a failed website open keeps the original card',async()=>withDom(async d=>{
 window.homerDesktopAccount={openWebsite:async()=>{throw Error('PRIVATE_DIAGNOSTICS');}};
 await d.render(React.createElement(get().ModelFailureNotice,{key:'codex',failure:{messageId:'codex',code:'engine_quota_insufficient',source:'codex'},onAccount:()=>{}}));
 assert.ok(!button(d,'充值'));assert.ok(button(d,'查看账号与额度'));
 await d.render(React.createElement(get().ModelFailureNotice,{key:'website',failure:{messageId:'website',code:'engine_quota_insufficient',source:'website'},onAccount:()=>{}}));
 await d.click(button(d,'充值'));assert.match(d.container.textContent,/未能打开充值入口/);assert.doesNotMatch(d.container.textContent,/PRIVATE_DIAGNOSTICS/);assert.ok(button(d,'关闭额度不足提醒'));
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
 window.homerDesktopAccount={state:async()=>current,onChange:()=>()=>{},openWebsite:async()=>{calls.push('openWebsite');return current;},disconnect:async()=>{calls.push('disconnect');return current;},applyCodex:async()=>{calls.push('applyCodex');return current;}};
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
 let calls=0;const current={supported:true,configured:true,source:'website',connection:'legacy',active:'legacy',pending:false,needsRestart:false,stale:false,wallet:{available:3,used:99,unit:'积分'}};
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
