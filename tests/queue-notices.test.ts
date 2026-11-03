import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import config from '../ui/vite.config.js';

test('browser distribution carries every bundled DnD copyright and permission notice',async()=>{
 const assets:any[]=[];
 const plugin=(config as any).plugins.find((item:any)=>item.name==='task-status-notices');
 await plugin.generateBundle.call({emitFile:(asset:unknown)=>assets.push(asset)});
 const notice=assets.find(item=>item.fileName==='assets/task-status-NOTICES.txt')?.source;
 assert.equal(typeof notice,'string');
 for(const pkg of ['@dnd-kit/abstract','@dnd-kit/collision','@dnd-kit/dom','@dnd-kit/geometry','@dnd-kit/react','@dnd-kit/state','@preact/signals-core','tslib']){
  const license=readFileSync('node_modules/'+pkg+(pkg==='tslib'?'/LICENSE.txt':'/LICENSE'),'utf8');
  assert.ok(notice.includes(pkg+'\n'+license),pkg+' license must ship with browser copies');
 }
});
