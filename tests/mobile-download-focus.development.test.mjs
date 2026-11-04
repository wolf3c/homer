import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {buildSync} from 'esbuild';
import {chromium} from 'playwright-core';

test('mobile download focus remains visible when the window shrinks',{timeout:30000},async()=>{
 const bundle=buildSync({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {DesktopSettings} from './ui/desktop-permissions';createRoot(document.getElementById('root')).render(React.createElement(DesktopSettings));",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},logLevel:'silent'}).outputFiles[0].text;
 const parent=resolve('.codex/scratch');mkdirSync(parent,{recursive:true});const profile=mkdtempSync(join(parent,'mobile-download-focus-'));
 let context;
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:380,height:700},args:['--disable-background-networking']});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='http://127.0.0.1/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}):route.abort());
  await page.addInitScript(()=>{window.fetch=async path=>{if(path==='/api/mobile/state')return Response.json({configured:true,devices:[],pending:null,expiresAt:null});throw Error('unexpected synthetic request');};});
  await page.goto('http://127.0.0.1/');await page.addStyleTag({content:readFileSync('ui/homer-styles.css','utf8')});await page.addScriptTag({content:bundle});
  await page.getByRole('button',{name:'设置'}).click();await page.getByRole('tab',{name:'移动设备'}).click();await page.getByRole('heading',{name:'还没有绑定设备'}).waitFor();
  const trigger=page.getByRole('button',{name:'下载手机 App'});await trigger.click();
  const dialog=page.getByRole('dialog',{name:'下载 Homer 手机 App'}),link=dialog.getByRole('link',{name:'在浏览器打开下载页'}),close=dialog.getByRole('button',{name:'知道了'});
  await page.waitForFunction(()=>document.activeElement?.textContent==='在浏览器打开下载页');
  const resize=async(width,height)=>{await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const check=async(control,ring)=>{
   const bounds=await control.evaluate(node=>{
    const popup=node.closest('.mobile-download-popup'),outer=popup.getBoundingClientRect(),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    const outline=style.outlineStyle==='none'?0:Math.max(0,parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset));
    return {focused:node===document.activeElement,outline,
     top:rect.top-outline-Math.max(0,outer.top+popup.clientTop),bottom:Math.min(innerHeight,outer.top+popup.clientTop+popup.clientHeight)-rect.bottom-outline,
     left:rect.left-outline-Math.max(0,outer.left+popup.clientLeft),right:Math.min(innerWidth,outer.left+popup.clientLeft+popup.clientWidth)-rect.right-outline};
   });
   assert.equal(bounds.focused,true);if(ring)assert.ok(bounds.outline>0,'keyboard focus needs a visible outline');
   assert.ok([bounds.top,bounds.bottom,bounds.left,bounds.right].every(value=>value>=-0.5),JSON.stringify(bounds));
  };
  await resize(380,420);await check(link,false);
  await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement?.textContent==='知道了');
  await resize(380,700);await resize(320,360);await check(close,true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='下载手机 App');
  assert.deepEqual(errors,[]);
 }finally{try{await context?.close();}finally{rmSync(profile,{recursive:true,force:true});}}
});
