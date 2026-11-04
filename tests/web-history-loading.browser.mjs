// Current pagination/SSE/media contracts; synthetic owners and isolated Chrome only.
// Long-text measurements live in web-history-kerning.browser.mjs, not a V2 build comparison.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {syntheticRoot,updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome,probeScript} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??syntheticRoot);
mkdirSync(destination,{recursive:true});
const chrome=await isolatedChrome(destination),functional=[];
try {
    for (const width of [1440,390,320]) {
        const f = await fixture(1000, 'after', true), page = await chrome.page(f.server.url, width);
        try {
            let releaseReceipt;const receiptGate=new Promise(done=>{releaseReceipt=done;}),receiptOwner=f.bridge.history.receipts;f.bridge.history.receipts=async input=>{const receipt=await receiptOwner(input);await receiptGate;return receipt;};
            await page.command('Page.addScriptToEvaluateOnNewDocument',{source:probeScript+`;sessionStorage.setItem('homer-unconfirmed:synthetic-history',JSON.stringify([{input:{requestId:'request-0',text:'合成问题 0'}}]));sessionStorage.setItem('homer-interaction:synthetic-history:off-page:draft',JSON.stringify('离窗待答草稿'));`});
            await page.navigate();
            await page.until(() => document.querySelectorAll('[data-conversation-message]').length === 80);
            await page.evaluate(() => new Promise(done => setTimeout(done, 250)));
            const initial = await page.evaluate(() => ({ messages: document.querySelectorAll('[data-conversation-message]').length, processContent: document.querySelectorAll('[data-slot=collapsible-content]').length, overflow: document.documentElement.scrollWidth > innerWidth, box: !!document.querySelector('[contenteditable=true]') }));
            assert.equal(initial.processContent, 0);
            assert.equal(initial.overflow, false);
            const initialMedia = f.mediaRequests.length;
            assert.ok(initialMedia <= 4, 'only viewport-near previews may load');
            await page.screenshot('candidate-latest-' + width + '.png');
            await page.evaluate(() => { const box = document.querySelector('[contenteditable=true]'); box.focus(); });
            await page.command('Input.insertText', { text: '分页期间保留的合成草稿' });releaseReceipt();await page.until(()=>sessionStorage.getItem('homer-unconfirmed:synthetic-history')===null);assert.equal(await page.evaluate(()=>document.querySelector('[contenteditable=true]').textContent),'分页期间保留的合成草稿','old ACK cannot replace new draft');
            // A real reader gesture cancels pending initial positioning before pagination.
            await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:300,deltaX:0,deltaY:-1000000});
            await page.until(()=>document.querySelector('.thread-viewport').scrollTop===0);
            await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
            const anchor = await page.evaluate(() => { const view = document.querySelector('.thread-viewport'), e = [...document.querySelectorAll('[data-conversation-message]')].find(e => e.getBoundingClientRect().bottom > view.getBoundingClientRect().top); return { id: e.getAttribute('data-conversation-message'), offset: e.getBoundingClientRect().top - view.getBoundingClientRect().top }; });
            await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === '加载更早消息').click());
            await page.until(() => document.querySelectorAll('[data-conversation-message]').length > 80);
            await page.evaluate(() => new Promise(done => setTimeout(done, 300)));
            const after = await page.evaluate(() => { return { draft: document.querySelector('[contenteditable=true]').textContent, count: document.querySelectorAll('[data-conversation-message]').length }; });
            const offset = await page.evaluate(`(()=>{const e=document.getElementById('message-'+${JSON.stringify(anchor.id)}),v=document.querySelector('.thread-viewport');return e.getBoundingClientRect().top-v.getBoundingClientRect().top;})()`);
            const anchorError = Math.abs(offset - anchor.offset);
            assert.ok(anchorError <= 4, 'prepend must preserve first visible identity within 4px');
            assert.equal(after.draft, '分页期间保留的合成草稿');
            await page.screenshot('candidate-prepend-' + width + '.png');
            await page.command('Input.dispatchMouseEvent',{type:'mouseWheel',x:Math.min(width/2,700),y:400,deltaY:1,deltaX:0});
            await page.evaluate(()=>document.querySelector('.thread-viewport').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));
            const firstNode = 'node-920';
            const process=f.processes.exact(firstNode);process.revision++;process.items.unshift({id:'pagination-progress',kind:'commentary',phase:'commentary',seq:0,revision:1,text:'合成历史过程'});f.store.setMeta('publicMainNode:v1:'+firstNode,JSON.stringify(process));f.server.publish();
            await page.evaluate(`document.getElementById('message-'+${JSON.stringify(firstNode)})?.scrollIntoView({block:'center'})`);
            await page.evaluate(`document.getElementById('message-'+${JSON.stringify(firstNode)})?.querySelector('[data-slot=collapsible-trigger]')?.click()`);
            await page.until(() => document.querySelectorAll('[data-slot=collapsible-content]').length === 1);
            await page.evaluate(`document.getElementById('message-'+${JSON.stringify(firstNode)})?.querySelector('[data-slot=collapsible-trigger]')?.click()`);
            await page.until(() => document.querySelectorAll('[data-slot=collapsible-content]').length===0);
            const originalPage=f.bridge.history.page;f.bridge.history.page=async input=>{const result=await originalPage(input);if(input.request.around)await new Promise(done=>setTimeout(done,500));return result;};
            await page.evaluate(()=>{const box=document.querySelector('[contenteditable=true]');window.__originalComposer=box;box.focus({preventScroll:true});window.__removedMessageRoots=0;window.__streamObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node.nodeType===1&&(node.matches('[data-conversation-message]')||node.querySelector('[data-conversation-message]')))window.__removedMessageRoots++;});window.__streamObserver.observe(document.querySelector('.messages'),{childList:true,subtree:true});});
            for(let n=0;n<5;n++){assert.equal(updateSyntheticPublicText(f,'node-999','合成快照增量 '+n).changes,1);await new Promise(done=>setTimeout(done,180));}
            assert.equal(updateSyntheticPublicText(f,'node-920','合成历史晚更新').changes,1);
            try{await page.until(()=>document.getElementById('message-node-920')?.textContent.includes('合成历史晚更新'),10000);}catch(error){writeFileSync(join(destination,'browser-historical-update-failure.json'),JSON.stringify({requests:page.requests,view:await page.evaluate(()=>({text:document.getElementById('message-node-920')?.textContent,top:document.getElementById('message-node-920')?.getBoundingClientRect().top,view:document.querySelector('.thread-viewport')?.getBoundingClientRect().toJSON(),visible:[...document.querySelectorAll('[data-conversation-message]')].filter(e=>{const b=e.getBoundingClientRect(),v=document.querySelector('.thread-viewport').getBoundingClientRect();return b.bottom>v.top&&b.top<v.bottom;}).map(e=>e.id)}))},null,2));throw error;}
            const reconnects=page.requests.filter(request=>request.path==='/api/history/events').length;f.server.disconnectClients();
            await page.until(()=>document.querySelector('[contenteditable=true]')===window.__originalComposer);
            await new Promise(done=>setTimeout(done,1800));
            const stability=await page.evaluate(()=>({sameComposer:document.querySelector('[contenteditable=true]')===window.__originalComposer,focused:document.activeElement===window.__originalComposer,draft:window.__originalComposer.textContent,removedMessageRoots:window.__removedMessageRoots}));
            assert.equal(stability.sameComposer,true);assert.equal(stability.focused,true);assert.equal(stability.draft,'分页期间保留的合成草稿');assert.equal(stability.removedMessageRoots,0);
            assert.ok(page.requests.filter(request=>request.path==='/api/history/events').length>reconnects,'SSE reconnect uses bounded endpoint');
            await page.evaluate(()=>window.__streamObserver.disconnect());
            const offPageDraft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-interaction:synthetic-history:off-page:draft')));assert.equal(offPageDraft,'离窗待答草稿');
            const media=await page.evaluate(()=>window.__mediaProbe);assert.ok(media.max>=1&&media.max<=2);assert.ok(media.revoked>0,'offscreen object URLs are released');
            assert.equal(f.submitted.length, 0, 'reading, reconnect and pagination must never submit');
            assert.deepEqual(page.blocked, []);
            assert.equal(page.errors.length, 0);
            functional.push({ width, initial, initialMedia, anchorError, after, expandedOnDemand: true, offWindowAckPreservedNewDraft:true, offPageFormDraftRetained:true, media, stability, historicalLateUpdate: true, reconnected: true, submitted: f.submitted.length, errors: page.errors });
        }
        finally {
            await page.close();
            await f.close();
        }
    }
}finally{
 await chrome.close();
 writeFileSync(join(destination,'browser-functional-acceptance.json'),JSON.stringify({syntheticOnly:true,browser:chrome.version,viewportEmulationNotPhone:true,functional},null,2)+'\n');
}
assert.equal(functional.length,3);
