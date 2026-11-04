// A closing disclosure must leave the tab order before its exit animation ends.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readingFixture} from './process-reading-browser-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/run-activity-focus');
mkdirSync(destination,{recursive:true});
const browser=await isolatedChrome(destination),results=[];
async function key(page,key,code,number){
  await page.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:number,...(key==='Enter'?{text:'\r'}:{})});
  await page.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:number});
}
try{
  for(const width of [1440,390,320]){
    const fixture=await readingFixture(),page=await browser.page(fixture.server.url,width);
    try{
      fixture.setMode('streaming');
      const node=JSON.parse(fixture.store.meta('publicMainNode:v1:node-89'));
      node.revision++;
      node.items[0].text='公开进展：[查看公开材料](https://example.invalid/)';
      fixture.store.setMeta('publicMainNode:v1:node-89',JSON.stringify(node));
      await page.navigate();
      await page.until(()=>!!document.querySelector('#message-node-89 [data-slot=collapsible-trigger]'));
      await page.evaluate(()=>document.querySelector('#message-node-89 [data-slot=collapsible-trigger]').click());
      await page.until(()=>!!document.querySelector('#message-node-89 [data-slot=collapsible-content] a'));
      await page.until(()=>document.querySelector('#message-node-89 [data-slot=collapsible-content]').getAnimations().length===0);
      await page.evaluate(()=>document.querySelector('#message-node-89 [data-slot=collapsible-trigger]').focus());
      await key(page,'Enter','Enter',13);
      const closing=await page.evaluate(()=>{
        const trigger=document.querySelector('#message-node-89 [data-slot=collapsible-trigger]'),panel=document.querySelector('#message-node-89 [data-slot=collapsible-content]');
        return {closed:trigger.getAttribute('aria-expanded')==='false',inert:panel?.inert,ariaHidden:panel?.getAttribute('aria-hidden')};
      });
      assert.deepEqual(closing,{closed:true,inert:true,ariaHidden:'true'});
      await key(page,'Tab','Tab',9);
      assert.equal(await page.evaluate(()=>!!document.querySelector('#message-node-89 [data-slot=collapsible-content]')?.contains(document.activeElement)),false);
      await page.evaluate(()=>document.querySelector('#message-node-89 [data-slot=collapsible-content] a')?.focus());
      assert.equal(await page.evaluate(()=>!!document.querySelector('#message-node-89 [data-slot=collapsible-content]')?.contains(document.activeElement)),false);
      await page.until(()=>!document.querySelector('#message-node-89 [data-slot=collapsible-content]'));
      assert.equal(await page.evaluate(()=>document.querySelectorAll('#message-node-89 [data-slot=collapsible-content] a').length),0);
      await page.evaluate(()=>document.querySelector('#message-node-89 [data-slot=collapsible-trigger]').focus());
      await key(page,'Enter','Enter',13);
      await page.until(()=>!!document.querySelector('#message-node-89 [data-slot=collapsible-content] a'));
      await key(page,'Tab','Tab',9);
      assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('#message-node-89 [data-slot=collapsible-content] a')),true);
      assert.equal(await page.evaluate(()=>document.querySelector('#message-node-89 [data-slot=collapsible-content]').inert),false);
      assert.deepEqual(page.errors,[]);
      assert.deepEqual(page.blocked,[]);
      assert.equal(fixture.fakeEngine.invocations,0);
      assert.equal(fixture.submitted.length,0);
      results.push({width,closing,closedPanelSkippedByTab:true,programmaticFocusBlocked:true,closedChildrenUnmounted:true,reopenedLinkFocusable:true});
    }finally{await page.close();await fixture.close();}
  }
}finally{
  await browser.close();
  writeFileSync(join(destination,'focus-browser.json'),JSON.stringify({browser:browser.version,syntheticOnly:true,results},null,2)+'\n');
}
console.log(JSON.stringify({passed:results.length===3,widths:results.map(row=>row.width)}));
