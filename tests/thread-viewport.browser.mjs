// Real layout/scroll regression, synthetic history and HTTP only. No product profile/model.
// HOMER_SYNTHETIC_ROOT=<scratch> HISTORY_FOLLOWUP_BUILD=<built-ui> node --import tsx tests/thread-viewport.browser.mjs
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';

const destination = resolve(process.env.HOMER_BROWSER_EVIDENCE ?? '.codex/scratch/thread-viewport-browser');
mkdirSync(destination, {recursive: true});
const results = [], browser = await isolatedChrome(destination);
const settle = () => new Promise(done => setTimeout(done, 150));

export function viewportMetrics() {
  const geometry = element => {
    const r = element.getBoundingClientRect();
    return {top: element.scrollTop, range: element.scrollHeight - element.clientHeight, y: r.y, bottom: r.bottom};
  };
  const view = document.querySelector('.thread-viewport');
  return {
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    document: geometry(document.scrollingElement),
    panel: geometry(document.querySelector('.preview-main-panel')),
    view: geometry(view), composer: geometry(document.querySelector('.composer-area')),
    header: geometry(document.querySelector('.conversation-header')),
    activityCount: view.querySelectorAll('[data-slot="run-activity"]').length,
    liveStatusCount: view.querySelectorAll('[data-slot="run-activity"] > .sr-only[role="status"]').length,
  };
}

export function assertContained(sample, label) {
  assert.equal(sample.document.top, 0, label + ': document must remain stationary');
  assert.equal(sample.document.range, 0, label + ': document must have no extra scroll range');
  assert.equal(sample.panel.range, 0, label + ': outer Panel must have no extra scroll range');
  assert.equal(sample.panel.top, 0, label + ': outer Panel must remain stationary');
  assert.equal(sample.header.y, 0, label + ': header must remain stationary');
  assert.ok(Math.abs(sample.composer.bottom - sample.height) <= 1, label + ': Composer must stay at the window bottom');
}

try {
  for (const scenario of [
    {name: 'short', total: 1, width: 1440, height: 900},
    {name: 'long', total: 30, width: 1440, height: 900},
    {name: 'running-stop', total: 30, width: 1440, height: 900, running: true},
    {name: 'running-queue', total: 30, width: 1440, height: 900, running: true, queue: true},
    {name: 'narrow-390', total: 30, width: 390, height: 780},
    {name: 'narrow-320', total: 30, width: 320, height: 780},
    {name: 'short-window', total: 30, width: 1440, height: 520},
    {name: 'high-dpi', total: 30, width: 1440, height: 900, dpr: 2},
  ]) {
    const f = await fixture(scenario.total, 'after');
    const lastProcessKey = 'publicMainNode:v1:node-' + (scenario.total - 1);
    const lastProcess = JSON.parse(f.store.meta(lastProcessKey));
    lastProcess.items = [{id: 'viewport-commentary', kind: 'commentary', seq: 1, revision: 1, text: '合成公开进展，用于展开和收起验收。'}];
    f.store.setMeta(lastProcessKey, JSON.stringify(lastProcess));
    const state = f.bridge.history.state;
    f.bridge.history.state = async () => ({
      ...await state(), isRunning: !!scenario.running,
      activeMessageId: scenario.running ? 'reply-' + (scenario.total - 1) : null,
    });
    if (scenario.queue) for (let n = 0; n < 8; n++) f.inputs.accept({requestId: 'viewport-queue-' + n, text: '合成待发送消息 ' + n});
    const page = await browser.page(new URL(f.server.url).origin, scenario.width);
    const row = {scenario}; results.push(row);
    try {
      await page.command('Emulation.setDeviceMetricsOverride', {width: scenario.width, height: scenario.height, deviceScaleFactor: scenario.dpr ?? 1, mobile: false});
      await page.command('Page.navigate', {url: f.server.url});
      await page.until(() => !!document.querySelector('[contenteditable=true]') && !!document.querySelector('[data-slot="run-activity"] > .sr-only[role="status"]'));
      await settle();
      await page.evaluate(() => {const v = document.querySelector('.thread-viewport'); v.scrollTop = v.scrollHeight;});
      await settle();
      row.before = await page.evaluate(viewportMetrics);
      // Keep RunActivity and its actual absolute live regions in the reproduction.
      // Moving Worker cards outside it must never turn this into a vacuous pass.
      assert.ok(row.before.activityCount >= scenario.total, 'fixture must retain multiple real RunActivity disclosures');
      assert.ok(row.before.liveStatusCount >= scenario.total, 'fixture must retain official sr-only status elements');
      if (scenario.total > 1) assert.ok(row.before.view.range > 1000, 'fixture must overflow the inner message viewport');
      row.queueRows = await page.evaluate(() => document.querySelectorAll('[data-slot="message-queue"] li').length);
      row.stopVisible = await page.evaluate(() => !!document.querySelector('[aria-label="停止当前回复"]') || [...document.querySelectorAll('button')].some(b => b.textContent === '停止'));
      if (scenario.queue) assert.equal(row.queueRows, 8);
      if (scenario.running) assert.equal(row.stopVisible, true);
      const wheel = async deltaY => {
        const point = await page.evaluate(() => {const r = document.querySelector('.thread-viewport').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};});
        await page.command('Input.dispatchMouseEvent', {type: 'mouseWheel', ...point, deltaX: 0, deltaY});
        await settle();
      };
      await wheel(400);
      row.down = await page.evaluate(viewportMetrics);
      await page.screenshot(scenario.name + '-wheel400.png');
      assertContained(row.before, scenario.name + ' before');
      assertContained(row.down, scenario.name + ' down');
      assert.ok(Math.abs(row.down.view.top - row.before.view.top) <= 1, 'wheel at the inner bottom must not move it');
      await wheel(-250);
      row.up = await page.evaluate(viewportMetrics);
      assertContained(row.up, scenario.name + ' up');
      if (scenario.total > 1) assert.ok(Math.abs(row.up.view.top - row.down.view.top + 250) <= 1, 'upward wheel must still scroll the message viewport');
      if (scenario.total > 1) {
        await page.evaluate(() => [...document.querySelectorAll('[data-slot="run-activity"] button[aria-expanded]')].at(-1).click());
        await page.until(() => [...document.querySelectorAll('[data-slot="run-activity"] button[aria-expanded]')].at(-1)?.getAttribute('aria-expanded') === 'true');
        await page.until(() => document.querySelector('[data-activity-kind="commentary"]')?.textContent.includes('合成公开进展'));
        await settle();
        row.expanded = await page.evaluate(viewportMetrics);
        assertContained(row.expanded, scenario.name + ' activity expanded');
        await page.evaluate(() => [...document.querySelectorAll('[data-slot="run-activity"] button[aria-expanded]')].at(-1).click());
        await settle();
        assertContained(await page.evaluate(viewportMetrics), scenario.name + ' activity collapsed');
      }
      assert.deepEqual(page.errors, []);
      assert.deepEqual(page.blocked, []);
      assert.equal(f.submitted.length, 0); assert.equal(f.stopped.length, 0);
      row.passed = true;
      console.log(JSON.stringify({scenario: scenario.name, outerRange: row.down.panel.range, composerBottom: row.down.composer.bottom, innerUpDelta: row.up.view.top - row.down.view.top}));
    } catch (error) {
      row.error = String(error); throw error;
    } finally {await page.close(); await f.close();}
  }
} finally {
  await browser.close();
  writeFileSync(join(destination, 'results.json'), JSON.stringify({browser: browser.version, syntheticOnly: true, results}, null, 2) + '\n');
}
