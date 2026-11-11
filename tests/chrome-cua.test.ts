import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewportPixels,windowElements,CUA_TOOLS} from '../src/desktop-cua.js';
import {ownedCuaProcesses} from '../src/cua-processes.js';
import {hostMcpTools} from '../src/worker-interaction-mcp.js';
import {nativeToolContent} from '../src/tool-content.js';

test('Chrome viewport follows Chrome geometry at native and preview scales',()=>{
 const window={x:-20,y:55,width:1000,height:760};
 const before={window,viewport:{x:-20,y:142,width:1000,height:673},page:'page'};
 const shot={pid:12,window_id:34,window_bounds:window,screenshot_frame_valid:true,screenshot_width:2000,screenshot_height:1520};
 assert.deepEqual(viewportPixels(before,before,shot,2000,1520),{x:0,y:174,width:2000,height:1346});
 const bookmarks={...before,viewport:{...before.viewport,y:176,height:639}};
 assert.deepEqual(viewportPixels(bookmarks,bookmarks,{...shot,screenshot_width:1100,screenshot_height:836},1100,836),
  {x:0,y:133,width:1100,height:703});
 for(const after of [{...before,page:'different'},bookmarks,{...before,window:{...window,x:0}}])
  assert.throws(()=>viewportPixels(before,after,shot,2000,1520),/chrome_viewport_changed/);
 assert.throws(()=>viewportPixels(before,before,{...shot,screenshot_frame_valid:false},2000,1520),/chrome_viewport_changed/);
 const outside={...before,viewport:{...before.viewport,x:window.x-3}};
 assert.throws(()=>viewportPixels(outside,outside,shot,2000,1520),/chrome_viewport_unavailable/);
});

test('Windows accepts only the pinned driver’s native DWM frame and clips its one-pixel inset',()=>{
 const window={x:-1400,y:0,width:1400,height:900};
 const page={window,viewport:{x:-1400,y:127,width:1400,height:773},page:'tab'};
 const shot={pid:12,window_id:34,window_bounds:window,screenshot_width:1398,screenshot_height:898};
 assert.deepEqual(viewportPixels(page,page,shot,1398,898,true),{x:0,y:126,width:1398,height:772});
 assert.throws(()=>viewportPixels(page,page,{...shot,screenshot_width:1400},1400,898,true),/chrome_viewport_changed/);
 assert.throws(()=>viewportPixels(page,{...page,page:'another tab'},shot,1398,898,true),/chrome_viewport_changed/);
 const invalid={...page,viewport:{...page.viewport,y:-1}};
 assert.throws(()=>viewportPixels(invalid,invalid,shot,1398,898,true),/chrome_viewport_unavailable/);
});

test('CUA tools require the desktop Worker catalog and keep inputs and images out of activity details',()=>{
 const names=CUA_TOOLS.map(tool=>tool.name);
 assert.deepEqual(names,['browser_open','browser_read','browser_click','desktop_read','desktop_click','desktop_type']);
 for(const catalog of [hostMcpTools('main',true,false,true),hostMcpTools('worker')])
  assert.ok(!catalog.some(tool=>names.includes(tool.name)));
 assert.deepEqual(hostMcpTools('worker',false,false,true).filter(tool=>names.includes(tool.name)),CUA_TOOLS);
 for(const tool of names){
  const content=nativeToolContent({type:'mcpToolCall',server:'homer_interactions',tool,arguments:{url:'https://example.test/?id=fixture'},result:{data:'fixture-pixels'}},true);
  assert.equal(content?.input.state,'not-recorded');
  assert.equal(content?.output.state,'not-recorded');
 }
});

test('CUA cleanup only selects its own driver and browser profile even after the Chrome leader exits',()=>{
 const dir='/private/test data/homer-cua-Ab123c',chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const profile=dir+'/profile';
 const generation='204bd498-5e2a-4c1a-9e69-e232241e92cd';
 const result=ownedCuaProcesses(dir,`
  10 9 ${dir}/cua-driver __private-worker --generation ${generation}
  11 9 ${dir}-other/cua-driver __private-worker --generation ${generation}
  12 12 ${chrome} --guest --user-data-dir=${profile}
  13 12 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --user-data-dir=${profile}
  14 14 ${chrome} --user-data-dir=${profile}-another
  15 15 ${chrome}
  16 16 /bin/echo --user-data-dir=${profile}
 `);
 assert.deepEqual(result.driver.map(p=>p.pid),[10]);
 assert.deepEqual(result.chrome.map(p=>[p.pid,p.group]),[[12,12],[13,12]]);
});

test('desktop read excludes tokens for application menus outside the approved window',()=>{
 const rows=[{role:'AXWindow',depth:0,element_index:0},{role:'AXButton',element_index:1,parent_index:0},
  {role:'AXMenuBar',depth:0,element_index:2},{role:'AXMenuBarItem',element_index:3,parent_index:2}];
 assert.deepEqual(windowElements(rows),rows.slice(0,2));
 const uia=[{role:'Window',depth:0,element_index:0},{role:'Button',element_index:1,parent_index:0},
  {role:'MenuBar',depth:0,element_index:2},{role:'MenuItem',element_index:3,parent_index:2}];
 assert.deepEqual(windowElements(uia,true),uia.slice(0,2));
});
