// Actual isolated Chrome profile zoom preference, not CSS zoom or pinch emulation.
import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/web-history-native-zoom'),rows=[];
const f=await fixture(100,'after');
try{for(const zoomFactor of [1,2]){
 const chrome=await isolatedChrome(destination,{zoomFactor}),page=await chrome.page(f.server.url);
 try{await page.command('Emulation.clearDeviceMetricsOverride');await page.navigate();await page.until(()=>document.querySelectorAll('[data-conversation-message]').length===80&&!!document.querySelector('[contenteditable=true]'));await page.evaluate(()=>document.querySelector('[contenteditable=true]').focus());await page.command('Input.insertText',{text:'真实浏览器缩放草稿'});
 const metrics=await page.evaluate(()=>({ratio:devicePixelRatio,width:innerWidth,outerWidth,scale:visualViewport.scale,overflow:document.documentElement.scrollWidth>innerWidth,draft:document.querySelector('[contenteditable=true]').textContent,focused:document.activeElement===document.querySelector('[contenteditable=true]')}));rows.push({zoomFactor,...metrics,errors:page.errors});await page.screenshot('native-chrome-zoom-'+zoomFactor+'x.png');assert.equal(metrics.draft,'真实浏览器缩放草稿');assert.equal(metrics.overflow,false);assert.equal(metrics.focused,true);assert.deepEqual(page.errors,[]);
 }finally{await page.close();await chrome.close();}
}
 assert.ok(Math.abs(rows[1].width*2-rows[0].width)<=2);assert.ok(rows.every(row=>row.scale===1));
 const ratio=rows[1].ratio/rows[0].ratio;writeFileSync(join(destination,'native-chrome-zoom-browser.json'),JSON.stringify({rows,verified200Percent:ratio===2,actualRatio:ratio,pinchScaleRemainedOne:rows.every(row=>row.scale===1)},null,2));assert.equal(ratio,2,'must measure actual browser zoom, not assume profile preference worked');
}finally{await f.close();}
