// Explicit acceptance of candidate shell resources on a synthetic Windows desktop and loopback conversation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {release} from 'node:os';
import {createHash} from 'node:crypto';
import {windowsCommand} from '../scripts/windows-security.mjs';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {_electron} from 'playwright-core';

const titles=['Homer Windows Capture A','Homer Windows Capture B'];
const colors=[[227,41,36],[26,80,225]];
function pressCaptureKey({pid,cursor},scratch){
 windowsCommand(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HomerCaptureFixture {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
[uint32]$foreground=0
[void][HomerCaptureFixture]::GetWindowThreadProcessId([HomerCaptureFixture]::GetForegroundWindow(), [ref]$foreground)
if ($foreground -ne [uint32]$env:HOMER_FIXTURE_PID) { throw 'Synthetic window is not foreground' }
[Windows.Forms.Cursor]::Position=[Drawing.Point]::new([int]$env:HOMER_FIXTURE_X,[int]$env:HOMER_FIXTURE_Y)
[Windows.Forms.SendKeys]::SendWait('^+{F2}')
`,{TMP:scratch,TEMP:scratch,HOMER_FIXTURE_PID:String(pid),HOMER_FIXTURE_X:String(cursor.x),HOMER_FIXTURE_Y:String(cursor.y)});
}
async function annotate(panel,note){
 const dialog=panel.getByRole('dialog',{name:'截图批注'}),image=dialog.getByAltText('截图.png');
 await image.waitFor();
 const screenshot=await image.evaluate(async img=>{
  await img.decode();
  const width=img.naturalWidth,height=img.naturalHeight,canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
  const pixels=[.25,.75].flatMap(x=>[.25,.75].map(y=>Array.from(ctx.getImageData(Math.floor(x*width),Math.floor(y*height),1,1).data).slice(0,3)));
  return {width,height,pixels};
 });
 const box=await dialog.locator('.a9s-annotationlayer').boundingBox();
 assert.ok(box?.width&&box?.height);
 await panel.mouse.move(box.x+.12*box.width,box.y+.15*box.height);await panel.mouse.down();
 await panel.mouse.move(box.x+.56*box.width,box.y+.56*box.height,{steps:8});await panel.mouse.up();
 await dialog.getByPlaceholder('希望这里怎么改？').fill(note);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await dialog.locator('.image-region-number').waitFor();
 await dialog.getByRole('button',{name:'发送',exact:true}).click();
 return screenshot;
}

test('Windows candidate captures the selected window and clean region, annotates and sends each once',{timeout:150000},async t=>{
 assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');
 assert.equal(process.version,'v22.22.0');
 assert.ok(process.env.HOMER_WINDOWS_TEST_APP,'provide the isolated candidate Homer.exe');
 const executable=realpathSync(process.env.HOMER_WINDOWS_TEST_APP);
 const resources=join(dirname(executable),'resources'),manifest=JSON.parse(readFileSync(join(resources,'desktop-manifest.json'),'utf8'));
 assert.equal(manifest.platform,'win32');assert.equal(manifest.publishable,false);
 assert.equal(manifest.electron,'45.0.0');
 assert.ok(manifest.files.some(file=>file.path.replaceAll('\\','/')==='homer/dist/capture-panel/capture-panel.html'));
 const fixtureElectron=resolve('node_modules/electron/dist/electron.exe');
 assert.ok(existsSync(fixtureElectron),'prepare the pinned Electron runtime first');
 assert.equal(readFileSync(resolve('node_modules/electron/dist/version'),'utf8').trim(),'45.0.0');
 const parent=resolve('.codex/scratch/windows-capture-acceptance');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'synthetic-')),target=join(dir,'targets.mjs');
 writeFileSync(target,`
import {app,BrowserWindow,screen} from 'electron';
app.setPath('userData',process.argv.at(-1));app.setPath('sessionData',process.argv.at(-1));
globalThis.fixture=app.whenReady().then(async()=>{
 const display=screen.getPrimaryDisplay(),{x,y,width,height}=display.workArea,boards=[];
 for(const [index,title] of ${JSON.stringify(titles)}.entries()){
  const board=new BrowserWindow({x:x+Math.round(width*(index ? .55 : .1)),y:y+Math.round(height*.2),
   width:Math.round(width*.34),height:Math.round(height*.42),frame:false,resizable:false,show:false,title});
  boards.push(board);
  const fill=${JSON.stringify(colors)}[index].join(',');
  await board.loadURL('data:text/html,'+encodeURIComponent('<title>'+title+'</title><style>html{background:rgb('+fill+')}</style>'));
  board.show();
 }
 return {boards,display};
});
`);
 const targetProfile=join(dir,'target-profile');mkdirSync(targetProfile);
 const retained=new Map(),messages=[];
 const webDir=join(resources,'homer/dist/web');
 const web=await composerFixture({webDir,beforeDir:webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png'),
  resource:(_req,res,url)=>{
   const bytes=retained.get(url.pathname);
   if(!bytes){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':'image/png'});res.end(bytes);
  }});
 web.reset({messages:[]});
 let source,app,passed=false;
 try{
  source=await _electron.launch({executablePath:fixtureElectron,args:[target,targetProfile],timeout:30000});
  await source.firstWindow();
  app=await _electron.launch({executablePath:fixtureElectron,
   args:[resolve('tests/fixtures/desktop-access-electron.mjs'),dir,resources,web.url],timeout:30000});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  const uploads=new Map();
  await page.route(web.url+'/api/uploads',async route=>{
   const bytes=route.request().postDataBuffer(),response=await route.fetch(),value=await response.json();
   const asset={...value,assetId:'asset-'+value.assetId,mime:'image/png'};
   uploads.set(asset.assetId,{asset,bytes});
   await route.fulfill({response,json:asset});
  });
  await page.waitForURL(web.url+'/');
  await page.locator('[contenteditable=true]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.homerDesktopCapture.getShortcut()),{
   shortcut:'Control+Shift+F2',defaultShortcut:'Control+Shift+F2',active:true,
  });
  const timings=[];
  for(const [mode,index] of [['window',1],['region',0]]){
   await app.evaluate(()=>globalThis.desktopAccessFixture.waitForCapture());
   const selection=await source.evaluate(async({screen},index)=>{
    const {boards,display}=await globalThis.fixture,board=boards[index];
    board.focus();
    const bounds=board.getContentBounds();
    return {pid:process.pid,bounds,display,cursor:screen.dipToScreenPoint({x:bounds.x+Math.floor(bounds.width/2),y:bounds.y+Math.floor(bounds.height/2)})};
   },index);
   const opening=app.waitForEvent('window',{timeout:12000});pressCaptureKey(selection,dir);
   const panel=await opening;panel.setDefaultTimeout(12000);
   const picker=panel.getByRole('dialog',{name:'选取窗口或区域'});await picker.waitFor();
   let expected;
   const started=performance.now();
   if(mode==='window')await picker.getByRole('button',{name:titles[index],exact:true}).click();
   else{
    await picker.getByRole('button',{name:'框选区域'}).click();
    const canvas=panel.getByRole('dialog',{name:'框选截图区域'}).locator('canvas');
    await canvas.waitFor();
    const view=await canvas.boundingBox(),frame=await canvas.evaluate(c=>({width:c.width,height:c.height}));
    assert.ok(view?.width&&view?.height);
    const {bounds,display:{bounds:screen}}=selection;
    const left=Math.round(bounds.x-screen.x+bounds.width*.2),right=Math.round(bounds.x-screen.x+bounds.width*.8);
    const top=Math.round(bounds.y-screen.y+bounds.height*.2),bottom=Math.round(bounds.y-screen.y+bounds.height*.8);
    expected=[Math.ceil(right/view.width*frame.width)-Math.floor(left/view.width*frame.width),
     Math.ceil(bottom/view.height*frame.height)-Math.floor(top/view.height*frame.height)];
    await panel.mouse.move(view.x+right,view.y+bottom);await panel.mouse.down();
    await panel.mouse.move(view.x+left,view.y+top,{steps:8});await panel.mouse.up();
   }
   await panel.getByAltText('截图.png').waitFor();
   timings.push({mode,previewMs:Math.round(performance.now()-started)});
   const note=mode==='window'?'合成窗口批注':'合成区域批注';
   const digest=await app.evaluate(()=>globalThis.desktopAccessFixture.captureDigest());
   const [submitted,screenshot]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/messages'&&response.request().method()==='POST'),
    annotate(panel,note),
   ]);
   assert.ok(submitted.ok());
   if(expected)assert.deepEqual([screenshot.width,screenshot.height],expected);
   else assert.ok(screenshot.width>0&&screenshot.height>0&&Math.abs(screenshot.width/screenshot.height-selection.bounds.width/selection.bounds.height)<.05);
   for(const pixel of screenshot.pixels)assert.ok(pixel.every((value,i)=>Math.abs(value-colors[index][i])<=28),'unexpected target pixels');
   assert.equal(web.received.messages.length,messages.length+1);assert.equal(web.received.uploads.length,messages.length+1);
   const input=web.received.messages.at(-1);
   assert.equal(input.attachments.length,1);assert.equal(input.resourceReferences.length,1);
   const [reference]=input.resourceReferences;
   assert.equal(reference.source.kind,'draft-image');assert.equal(reference.image.assetId,input.attachments[0].assetId);
   assert.equal(reference.annotations.length,1);assert.equal(reference.annotations[0].comment,note);assert.equal(reference.ax,undefined);
   const {asset,bytes}=uploads.get(reference.image.assetId);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);
   const id='accepted-'+input.requestId,assetPath='/api/media/'+id+'/'+asset.assetId+'/'+asset.revision;
   retained.set(assetPath,bytes);
   messages.push({id,threadId:'composer-review',requestId:input.requestId,role:'user',status:'completed',text:input.text,
    createdAt:Date.now(),media:[asset],resourceReferences:[reference]});
   web.update({messages:[...messages]});
   const message=page.locator('[data-conversation-message="'+id+'"]');
   await message.scrollIntoViewIfNeeded();
   await message.locator('.message-attachments img[alt="截图.png"]').first().waitFor();
   const response=await page.request.get(web.url+assetPath);
   assert.equal(createHash('sha256').update(await response.body()).digest('hex'),digest);
  }
  t.diagnostic(JSON.stringify({windows:release(),arch:process.arch,electron:manifest.electron,timings}));
  passed=true;
 }finally{
  if(app)await app.evaluate(()=>globalThis.desktopAccessFixture?.close()).catch(()=>{});
  const closed=await Promise.allSettled([app?.close(),source?.close(),web.close()]);
  assert.ok(closed.every(result=>result.status==='fulfilled'),'failed to close the isolated Windows processes');
  if(passed)rmSync(dir,{recursive:true,force:true});
 }
});
