import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {act} from 'react';
import {withDom,React} from './helpers/process-dom.mjs';

// Execute the product hooks and JSX without bundling the app or starting a service.
function component(options={}){
 const source=readFileSync('ui/homer-app.tsx','utf8'),ast=ts.createSourceFile('homer-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const app=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='HomerApp');
 const start=app.body.statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isArrayBindingPattern(d.name)&&d.name.elements[0].name.getText(ast)==='desktopUpdate'));
 assert.ok(start>=0,'desktop update state is missing');
 const end=app.body.statements.findIndex((n,i)=>i>start&&ts.isFunctionDeclaration(n)&&n.name.text==='desktopUpdateIntent');
 assert.ok(end>start,'desktop update actions are missing');
 let notice;const visit=node=>{if(ts.isJsxExpression(node)&&node.getText(ast).startsWith('{desktopUpdate?.status'))notice??=node;ts.forEachChild(node,visit);};visit(app.body);
 assert.ok(notice,'desktop update notice is missing');
 const hooks=app.body.statements.slice(start,end+1).map(n=>n.getText(ast)).join('\n');
 const code=ts.transpileModule(`const {useState,useLayoutEffect,useRef}=require('react');module.exports=function Notice(){${hooks}\nreturn <>${notice.getText(ast)}</>;}`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports','mobileView','captureAnchor','restoreAnchor','focusEditor',code)(createRequire(import.meta.url),mod,mod.exports,options.mobile??false,options.capture??(()=>{}),options.restore??(()=>{}),{current:options.focus??(()=>{})});
 return mod.exports;
}
const ready={status:'ready',version:'0.2.0',noticeHidden:false};
const button=(dom,label)=>dom.find(n=>n.tagName==='BUTTON'&&(n.attrs['aria-label']===label||n.textContent===label));
function bridge(initial=ready){let state=initial,listener,unsubscribed=false;const actions=[];return {
 api:{state:async()=>state,onChange:fn=>{listener=fn;return()=>{unsubscribed=true;};},dismiss:async()=>{actions.push('dismiss');state={...state,noticeHidden:true};listener();return state;},restart:async()=>{actions.push('restart');return state;}},
 change:async value=>act(async()=>{state=value;listener?.();}),actions,get unsubscribed(){return unsubscribed;},
};}

test('ready notice uses existing strip and only restart and close; preserves reading anchors',async()=>withDom(async dom=>{
 let captures=0,restores=0;const b=bridge();window.homerDesktopUpdate=b.api;const Notice=component({capture:()=>captures++,restore:()=>restores++});await dom.render(React.createElement(Notice));
 assert.match(dom.container.textContent,/新版本 0.2.0 已准备好/);assert.equal(dom.all().filter(n=>n.tagName==='BUTTON').length,2);assert.doesNotMatch(dom.container.textContent,/更新内容|完整说明/);
 await dom.click(button(dom,'重启并更新'));assert.deepEqual(b.actions,['restart']);await dom.click(button(dom,'关闭更新提示'));assert.equal(dom.container.textContent,'');assert.deepEqual(b.actions,['restart','dismiss']);assert.ok(captures>=2&&restores>=2);
 await dom.remount();await dom.render(React.createElement(Notice));assert.equal(dom.container.textContent,'');assert.equal(b.unsubscribed,true);
}));
for(const value of [null,{status:'checking'}, {...ready,noticeHidden:true},{status:'ready',version:'invalid',noticeHidden:false}])test('no notice for absent, unfinished, hidden or invalid state '+JSON.stringify(value),async()=>withDom(async dom=>{
 window.homerDesktopUpdate=bridge(value).api;const Notice=component();await dom.render(React.createElement(Notice));assert.equal(dom.container.textContent,'');
}));
for(const mobile of [false,true])test('ordinary web and mobile do not display desktop notice '+mobile,async()=>withDom(async dom=>{
 if(mobile)window.homerDesktopUpdate=bridge().api;const Notice=component({mobile});await dom.render(React.createElement(Notice));assert.equal(dom.container.textContent,'');
}));
test('subscribe before initial read; stale read cannot overwrite newer hidden state',async()=>withDom(async dom=>{
 let resolve,listener;window.homerDesktopUpdate={onChange:fn=>{listener=fn;return()=>{};},state:()=>new Promise(r=>{resolve=r;})};const Notice=component();await dom.render(React.createElement(Notice));const old=resolve;
 await act(async()=>{listener();resolve({...ready,noticeHidden:true});});await act(async()=>old(ready));assert.equal(dom.container.textContent,'');
}));
test('retry error stays in the strip; close returns focus only when it removes the focused control',async()=>withDom(async dom=>{
 let focused=0;const b=bridge();window.homerDesktopUpdate=b.api;const Notice=component({focus:()=>focused++});await dom.render(React.createElement(Notice));
 await b.change({...ready,error:'update_busy'});assert.match(dom.container.textContent,/当前工作尚未结束，请稍后重试/);assert.ok(button(dom,'重启并更新'));
 button(dom,'关闭更新提示').focus();await dom.click(button(dom,'关闭更新提示'));assert.equal(focused,1);
 await b.change(ready);await dom.click(button(dom,'关闭更新提示'));assert.equal(focused,1);
}));

test('rejected close does not hide the notice or move focus',async()=>withDom(async dom=>{
 let focused=0;const b=bridge();b.api.dismiss=async()=>{throw Error('forbidden');};window.homerDesktopUpdate=b.api;const Notice=component({focus:()=>focused++});await dom.render(React.createElement(Notice));button(dom,'关闭更新提示').focus();await dom.click(button(dom,'关闭更新提示'));assert.equal(focused,0);assert.match(dom.container.textContent,/未能确认重启更新/);
}));
