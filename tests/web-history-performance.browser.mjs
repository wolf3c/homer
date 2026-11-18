// Explicit synthetic benchmark. No accounts, models, product runtime or user browser.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {fixture} from './web-history-followup-fixture.mjs';
import {updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {openBrowser} from './helpers/image-zoom-browser.mjs';
for(const key of ['HISTORY_FOLLOWUP_BUILD','HOMER_SYNTHETIC_ROOT','HOMER_BROWSER_EVIDENCE'])assert.ok(process.env[key]&&isAbsolute(process.env[key]),'explicit absolute path required: '+key);
const dir=resolve(process.env.HOMER_BROWSER_EVIDENCE),variant=process.env.HOMER_PERF_VARIANT??'virtualized';
const scales=(process.env.HOMER_PERF_SCALES??'400,2000,5000').split(',').map(Number);
assert.ok(['current','baseline','virtualized'].includes(variant),'unknown performance variant');assert.ok(scales.every(n=>Number.isSafeInteger(n)&&n>=200),'scales must be integer units >=200');
const waves=Number(process.env.HOMER_PERF_WAVES??50),waveSize=20,intervalMs=Number(process.env.HOMER_PERF_INTERVAL??2000);
assert.ok(Number.isSafeInteger(waves)&&waves>=0&&intervalMs>=0,'invalid live workload');
mkdirSync(dir,{recursive:true});
const result={variant,syntheticOnly:true,node:process.version,environment:{os:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,cores:os.cpus().length,totalMemory:os.totalmem()},targets:{inputP95Ms:200,jumpMs:500,fill5000Ms:30000,heapMiB:256,exploratory:true},runs:[]};
const save=()=>writeFileSync(join(dir,'results.json'),JSON.stringify(result,null,2));
const browser=await openBrowser(dir,{mockKeychain:true});result.browser=browser.browser.version();save();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
const frames=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
let failure;
try{
 for(const total of scales){
  const r={totalUnits:total,visibleSeedMessages:total*2,body:'UTF-8 answer 203–206 bytes (index dependent); no images/process panels',answerBytesAtFirst:Buffer.byteLength('合成历史答复 0。'+'仅用于隔离性能测量。'.repeat(6)),answerBytesAtLast:Buffer.byteLength('合成历史答复 '+(total-1)+'。'+'仅用于隔离性能测量。'.repeat(6)),reads:[],samples:[],errors:[],blocked:[]};result.runs.push(r);save();
  const f=await fixture(total,'after');let context,page,cdp,failNext=variant!=='baseline'&&total===Math.max(...scales),phase='seed';
  try{
   for(let n=0;n<total;n++)updateSyntheticPublicText(f,'node-'+n,'合成历史答复 '+n+'。'+ '仅用于隔离性能测量。'.repeat(6));
   f.store.db.prepare('UPDATE conversation_messages SET quote=? WHERE id=?').run(JSON.stringify({messageId:'node-100',text:'合成历史答复 100',annotation:'定位旧记录'}),'user-'+(total-1));
   const original=f.bridge.history.page;
   f.bridge.history.page=async input=>{const start=performance.now(),row={phase,request:input.request};r.reads.push(row);try{
    if(input.request.after&&failNext){failNext=false;row.injectedFailure=true;throw Error('synthetic_transient_failure');}
    const value=await original(input);row.units=value.units.length;row.bytes=Buffer.byteLength(JSON.stringify(value));return value;
   }finally{row.serverMs=performance.now()-start;}};
   context=await browser.browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();page.setDefaultTimeout(180000);
   page.on('pageerror',e=>r.errors.push(String(e)));r.httpFailures=[];page.on('response',response=>{if(response.url().endsWith('/api/history/page')&&response.status()>=400)r.httpFailures.push({status:response.status(),phase});});
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==f.server.url&&!['data:','blob:','about:'].includes(u.protocol)){r.blocked.push(u.origin);return route.abort();}return route.continue();});
   await page.addInitScript(()=>{window.__historyPerf={longTasks:[],keys:[]};new PerformanceObserver(list=>{for(const x of list.getEntries())if(window.__historyPerf.longTasks.length<10000)window.__historyPerf.longTasks.push({start:x.startTime,duration:x.duration});}).observe({type:'longtask',buffered:true});document.addEventListener('input',()=>{const t=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.__historyPerf.keys.push(performance.now()-t)));},true);});
   cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
   async function sample(label){await frames(page);await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');const extra=await page.evaluate(()=>({rows:document.querySelectorAll('[data-conversation-message]').length,cachedMessages:window.__historyWindow?.messages.length,cachedUnits:(window.__historyWindow?.pages[0]??window.__historyWindow?.recent)?.units.length,longTasks:window.__historyPerf.longTasks.length,maxLongTaskMs:Math.max(0,...window.__historyPerf.longTasks.map(x=>x.duration))}));const s={label,heapUsedMiB:heap.usedSize/1048576,backingStorageMiB:(heap.backingStorageSize??0)/1048576,dom,...extra};r.samples.push(s);save();return s;}
   const start=performance.now();phase='initial';await page.goto(f.server.url);await page.waitForSelector('#message-user-'+(total-1)+' .message-quote-source');if(variant!=='baseline')assert.ok(await page.evaluate(()=>!!window.__historyWindow),'requires a test-only readonly HistoryWindow build probe; see docs/testing.md');await frames(page);r.initialMs=performance.now()-start;await sample('initial');
   phase='locate';const locate=performance.now();await page.locator('#message-user-'+(total-1)+' .message-quote-source').click();await page.waitForSelector('#message-node-100');await frames(page);r.locateDomReadyMs=performance.now()-locate;await page.waitForFunction(()=>{const row=document.getElementById('message-node-100')?.getBoundingClientRect(),view=document.querySelector('.thread-viewport')?.getBoundingClientRect();return row&&view&&row.bottom>view.top&&row.top<view.bottom;});r.locateVisibleMs=performance.now()-locate;
   if(variant!=='baseline'){
    if(total===Math.max(...scales)){
     await page.waitForFunction(()=>document.body.textContent.includes('后续消息暂未读全'));r.transientFailureVisibleMs=performance.now()-locate;
     const before=r.reads.length;await frames(page);assert.equal(r.reads.length,before,'no polling retry');
     phase='retry';const retry=performance.now();await page.locator('.scroll-latest').click();
     await page.waitForFunction(()=>document.querySelector('.scroll-latest').disabled);await frames(page);r.retryToLatestMs=performance.now()-retry;
    }else{await page.waitForFunction(total=>window.__historyWindow?.messages.some(m=>m.id==='node-'+(total-1)),total);await page.waitForFunction(()=>!document.body.textContent.includes('正在补齐后续消息'));await frames(page);}
    r.fillMs=performance.now()-locate;
    if(variant==='virtualized')assert.ok(await page.locator('[data-conversation-message]').count()<100,'DOM remains a small window after cache fill');
    const complete=await page.evaluate(total=>{const ids=window.__historyWindow.messages.map(m=>m.id),set=new Set(ids),numbers=ids.filter(x=>/^node-\d+$/.test(x)).map(x=>Number(x.slice(5))),first=Math.min(...numbers);let missing=0;for(let n=first;n<total;n++)if(!set.has('node-'+n)||!set.has('user-'+n))missing++;return {cachedMessages:ids.length,duplicates:ids.length-set.size,first,missing};},total);r.complete=complete;assert.equal(complete.duplicates,0);assert.equal(complete.missing,0);
   }else{r.boundedRowsAfterLocate=await page.locator('[data-conversation-message]').count();const t=performance.now();await page.locator('.scroll-latest').click();await page.waitForFunction(()=>document.querySelector('.scroll-latest').disabled);await frames(page);r.directLatestMs=performance.now()-t;}
   await sample('loaded');
   async function interactions(label){
    const jumps=[],keyWall=[];const jumpCount=Number(process.env.HOMER_PERF_JUMP_SAMPLES??8);for(let i=0;i<jumpCount;i++){
     await page.locator('.thread-viewport').hover();await page.mouse.wheel(0,-10000000);await frames(page);
     const t=performance.now();await page.locator('.scroll-latest').click();await page.waitForFunction(()=>document.querySelector('.scroll-latest').disabled);await frames(page);jumps.push(performance.now()-t);
    }
    const editor=page.locator('[contenteditable="true"]').first();await editor.focus();const before=await page.evaluate(()=>window.__historyPerf.keys.length);
    for(let i=0;i<12;i++){const t=performance.now();await page.keyboard.insertText('x');await frames(page);keyWall.push(performance.now()-t);}
    await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('Backspace');await frames(page);
    const keyFrames=await page.evaluate(before=>window.__historyPerf.keys.slice(before,before+12),before);
    return {label,jumpsMs:jumps,jumpP95Ms:percentile(jumps,.95),inputWallMs:keyWall,inputWallP95Ms:percentile(keyWall,.95),inputToTwoFramesMs:keyFrames,inputFrameP95Ms:percentile(keyFrames,.95)};
   }
   if(process.env.HOMER_PERF_PROFILE==='1'){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
   r.interactions=[await interactions('loaded')];
   if(process.env.HOMER_PERF_PROFILE==='1'){const cpu=await cdp.send('Profiler.stop');writeFileSync(join(dir,'cpu-'+total+'.json'),JSON.stringify(cpu));}
   save();
   if(total===Math.max(...scales)&&waves>0){
    phase='live';const expected=[],begin=performance.now();r.live={waves,waveSize,intervalMs,latencies:[],heapSamples:[]};
    for(let wave=0;wave<waves;wave++){
     const at=performance.now();for(let i=0;i<waveSize;i++)expected.push(f.attach('持续新增合成消息 '+wave+'-'+i+'。'+ '新增正文。'.repeat(20)).messageId);f.server.publish();
     if(variant==='baseline'&&process.env.HOMER_PERF_BASELINE_LATEST==='1'){const button=page.locator('.scroll-latest');await page.waitForFunction(()=>!document.querySelector('.scroll-latest').disabled);await button.click();r.live.manualLatestActions=(r.live.manualLatestActions??0)+1;}
     await page.waitForFunction(id=>window.__historyWindow?.messages.some(m=>m.id===id),expected.at(-1));await frames(page);r.live.latencies.push(performance.now()-at);
     if((wave+1)%10===0){r.live.heapSamples.push(await sample('live-'+expected.length));r.live.lastInteraction=await interactions('live-'+expected.length);save();}
     await pause(Math.max(0,intervalMs-(performance.now()-at)));
    }
    r.live.elapsedMs=performance.now()-begin;r.live.messages=expected.length;
    r.live.present=await page.evaluate(ids=>ids.filter(id=>window.__historyWindow.messages.some(m=>m.id===id)).length,expected);
    if(variant!=='baseline')assert.equal(r.live.present,expected.length);r.interactions.push(await interactions('live-final'));await sample('live-final');
   }
   r.network={pageAttempts:r.reads.length,afterAttempts:r.reads.filter(x=>x.request.after).length,injectedFailures:r.reads.filter(x=>x.injectedFailure).length,emptyBeforeReads:r.reads.filter(x=>x.request.before&&x.units===0).length,maxUnits:Math.max(0,...r.reads.map(x=>x.units??0)),bytes:r.reads.reduce((n,x)=>n+(x.bytes??0),0)};
   assert.ok(r.network.emptyBeforeReads<=1,'a terminal empty before page is not repeatedly fetched');assert.ok(r.network.maxUnits<=80);assert.equal(f.submitted.length,0);assert.equal(f.stopped.length,0);assert.equal(f.fakeEngine.invocations,0);r.engineCalls=f.fakeEngine.invocations;r.submitted=f.submitted.length;r.stopped=f.stopped.length;assert.deepEqual(r.errors,[]);assert.deepEqual(r.blocked,[]);
   await page.screenshot({path:join(dir,'loaded-'+total+'.png')});r.functionalPassed=true;save();
  }catch(error){r.failure=String(error);r.phase=phase;if(page)try{await page.screenshot({path:join(dir,'failure-'+total+'.png')});r.failureText=await page.locator('body').innerText();}catch{}save();throw error;}
  finally{await context?.close();await f.close();}
 }
}catch(error){failure=error;}
finally{result.exit=await browser.finish();result.assessment={functional:result.runs.length===scales.length&&result.runs.every(r=>r.functionalPassed),heapTarget:result.runs.every(r=>r.samples.every(s=>s.heapUsedMiB<=result.targets.heapMiB)),jumpTarget:result.runs.every(r=>(r.interactions??[]).every(s=>s.jumpP95Ms<=result.targets.jumpMs)),inputTarget:result.runs.every(r=>(r.interactions??[]).every(s=>s.inputWallP95Ms<=result.targets.inputP95Ms)),fillTarget:variant==='baseline'||!result.runs.some(r=>r.totalUnits===5000&&Number.isFinite(r.fillMs))?null:result.runs.filter(r=>r.totalUnits===5000).every(r=>r.fillMs<=result.targets.fill5000Ms),note:'Exploratory targets only; functional success is not performance acceptance'};save();}
assert.equal(result.exit.code,0);assert.equal(result.exit.forced,false);assert.equal(result.exit.watchdog,false);if(failure)throw failure;
console.log(JSON.stringify(result.runs.map(r=>({units:r.totalUnits,functionalPassed:r.functionalPassed,fillMs:r.fillMs,network:r.network,samples:r.samples,interactions:r.interactions,live:r.live})),null,2));
