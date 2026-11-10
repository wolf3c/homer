// Run with the repo's Node and Electron versions on an isolated, interactive Windows x64 desktop.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {release} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const probeFile = fileURLToPath(import.meta.url);
const require = createRequire(join(process.cwd(), 'package.json'));
const electronVersion = '45.0.0';
const patterns = [
  {title: 'Homer Capture Probe A', direction: 'right', colors: [[227, 41, 36], [242, 196, 31]]},
  {title: 'Homer Capture Probe B', direction: 'bottom', colors: [[26, 80, 225], [36, 185, 64]]},
];
const marker = [223, 33, 204];

export function assertPattern(result, expected, label) {
  assert.ok(result && !result.error, label + ': ' + (result?.error ?? 'frame missing'));
  assert.deepEqual(result.pngDimensions, [result.width, result.height], label + ': invalid PNG');
  assert.ok(result.width > 0 && result.height > 0 && result.bytes > 24 && result.bytes <= 8 * 1024 * 1024);
  assert.equal(result.stopped, true, label + ': stream still active');
  assert.equal(result.samples.length, expected.length);
  for (const [index, rgb] of result.samples.entries()) {
    assert.ok(rgb.length === 3 && rgb.every((value, channel) => Math.abs(value - expected[index][channel]) <= 28),
      label + ': unexpected pixels at sample ' + index + ' (' + rgb.join(',') + ')');
  }
}

// Executed only in the probe's sandboxed local page.
export function capturePage() {
  window.probe = {region: [0, 0, 1, 1], result: null};
  const button = document.querySelector('button');
  button.addEventListener('click', async () => {
    button.disabled = true;
    const video = document.createElement('video');
    video.muted = true;
    document.body.append(video);
    let stream;
    try {
      const started = performance.now();
      stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
      if (stream.getVideoTracks().length !== 1 || stream.getAudioTracks().length) throw Error('unexpected tracks');
      video.srcObject = stream;
      const first = new Promise(resolve => video.requestVideoFrameCallback(resolve));
      await video.play();
      await first;
      const firstFrameMs = Math.round(performance.now() - started);
      const {videoWidth, videoHeight} = video;
      if (!videoWidth || !videoHeight || videoWidth * videoHeight > 40_000_000) throw Error('invalid frame dimensions');

      const [left, top, right, bottom] = window.probe.region;
      const x = Math.floor(left * videoWidth), y = Math.floor(top * videoHeight);
      const width = Math.ceil(right * videoWidth) - x, height = Math.ceil(bottom * videoHeight) - y;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', {willReadFrequently: true});
      context.drawImage(video, x, y, width, height, 0, 0, width, height);
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;

      const samples = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([a, b]) =>
        Array.from(context.getImageData(Math.floor(a * width), Math.floor(b * height), 1, 1).data).slice(0, 3));
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const header = new DataView(await png.slice(0, 24).arrayBuffer());
      if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a) throw Error('invalid PNG signature');
      window.probe.result = {
        width, height, firstFrameMs, samples, bytes: png.size,
        pngDimensions: [header.getUint32(16), header.getUint32(20)],
        stopped: stream.getTracks().every(track => track.readyState === 'ended'),
      };
    } catch (error) {
      window.probe.result = {error: error.message};
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      video.remove();
      button.disabled = false;
    }
  });
}

async function launchProbeApp() {
  const {app, BrowserWindow, desktopCapturer, screen} = await import('electron');
  const [role, directory] = process.argv.slice(process.argv.indexOf(probeFile) + 1);
  assert.ok(['target', 'capture'].includes(role) && directory);
  const profile = join(directory, role);
  mkdirSync(profile);
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);

  // Store the promise before app readiness so the driver can wait on a single completion signal.
  globalThis.probeReady = app.whenReady().then(async () => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const {workArea, bounds} = display;
    if (role === 'target') {
      assert.ok(workArea.width >= 640 && workArea.height >= 400, 'interactive display too small');
      const windows = [];
      for (const [index, pattern] of patterns.entries()) {
        const board = new BrowserWindow({
          x: workArea.x + Math.round(workArea.width * (index ? .55 : .12)),
          y: workArea.y + Math.round(workArea.height * .28),
          width: Math.round(workArea.width * .32), height: Math.round(workArea.height * .4),
          title: pattern.title, frame: false, resizable: false, show: false,
          webPreferences: {backgroundThrottling: false},
        });
        windows.push(board);
        const [first, second] = pattern.colors.map(rgb => 'rgb(' + rgb.join(',') + ')');
        await board.loadURL('data:text/html,' + encodeURIComponent('<title>' + pattern.title + '</title>' +
          '<style>html{height:100%;background:linear-gradient(to ' + pattern.direction + ',' + first + ' 50%,' + second + ' 50%)}</style>'));
        board.show();
      }
      globalThis.probeBoards = windows;
      return {display: display.id, windows: windows.map(board => board.getContentBounds())};
    }

    const page = join(directory, 'capture.html');
    writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>Homer Capture Probe</title>' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; media-src blob:">' +
      '<style>html,body{height:100%;margin:0}body{background:rgb(' + marker.join(',') + ')}video{position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:.01}</style>' +
      '<button type="button">Capture frame</button><script>(' + capturePage.toString() + ')()</script>');
    const panel = new BrowserWindow({...bounds, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: {partition: 'homer-windows-capture-probe', sandbox: true, contextIsolation: true, nodeIntegration: false},
    });
    const contents = panel.webContents;
    const url = pathToFileURL(page).href;
    let armed;
    const trusted = wc => wc === contents && !panel.isDestroyed() && contents.mainFrame.url === url;
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
    contents.on('will-navigate', event => event.preventDefault());
    contents.session.setPermissionCheckHandler((wc, permission) => trusted(wc) && permission === 'display-capture' && !!armed);
    contents.session.setPermissionRequestHandler((wc, permission, respond) => respond(trusted(wc) && permission === 'display-capture' && !!armed));
    contents.session.setDisplayMediaRequestHandler((request, respond) => {
      if (!armed || armed.used || !trusted(contents) || request.frame !== contents.mainFrame ||
          !request.userGesture || !request.videoRequested || request.audioRequested) return respond(null);
      armed.used = true;
      respond({video: armed.source});
    });
    panel.setContentProtection(true);
    await panel.loadFile(page);
    panel.show();
    globalThis.probePick = async title => {
      const sources = await desktopCapturer.getSources({
        types: title ? ['window'] : ['screen'], thumbnailSize: {width: 0, height: 0},
      });
      const matches = sources.filter(source => title ? source.name === title && /^window:[^:]+:0$/.test(source.id) :
        source.id.startsWith('screen:') && source.display_id === String(display.id));
      assert.equal(matches.length, 1, 'requested source must resolve uniquely');
      armed = {source: matches[0], used: false};
    };
    globalThis.probeUnprotect = () => panel.setContentProtection(false);
    return {display: display.id, bounds, scale: display.scaleFactor, electron: process.versions.electron};
  });
  await globalThis.probeReady;
}

async function runProbe() {
  assert.equal(process.version, 'v22.22.0', 'use the project Node version');
  assert.equal(require('electron/package.json').version, electronVersion);
  const {_electron} = require('playwright-core');
  const parent = resolve('.codex/scratch/windows-capture-probe');
  mkdirSync(parent, {recursive: true});
  const directory = mkdtempSync(join(parent, 'run-'));
  const apps = [];
  async function launch(role) {
    const instance = await _electron.launch({executablePath: require('electron'), args: [probeFile, role, directory], timeout: 30_000});
    apps.push(instance);
    await instance.firstWindow({timeout: 15_000});
    const info = await instance.evaluate(() => globalThis.probeReady);
    return {instance, info};
  }
  try {
    const targets = await launch('target');
    const {instance, info} = await launch('capture');
    assert.equal(info.electron, electronVersion);
    assert.equal(info.display, targets.info.display, 'probe and test windows must use the same display');
    const page = await instance.firstWindow();
    async function shot(title, region = [0, 0, 1, 1]) {
      await instance.evaluate((_electron, title) => globalThis.probePick(title), title);
      await page.evaluate(region => { window.probe.region = region; window.probe.result = null; }, region);
      await page.getByRole('button', {name: 'Capture frame'}).click({timeout: 5_000});
      await page.waitForFunction(() => window.probe.result !== null, null, {timeout: 10_000});
      return page.evaluate(() => window.probe.result);
    }

    const a = await shot(patterns[0].title), b = await shot(patterns[1].title);
    const [red, yellow] = patterns[0].colors, [blue, green] = patterns[1].colors;
    assertPattern(a, [red, yellow, red, yellow], 'selected window A');
    assertPattern(b, [blue, blue, green, green], 'selected window B');

    const [board] = targets.info.windows, bounds = info.bounds;
    const left = (board.x - bounds.x) / bounds.width, top = (board.y - bounds.y) / bounds.height;
    const width = board.width / bounds.width, height = board.height / bounds.height;
    const region = [left + .1 * width, top + .2 * height, left + .9 * width, top + .8 * height];
    assert.ok(region.every(value => value >= 0 && value <= 1));
    const selected = await shot(null, region);
    assertPattern(selected, [red, yellow, red, yellow], 'display region with probe excluded');

    // The same region must see the overlay when protection is deliberately disabled.
    await instance.evaluate(() => globalThis.probeUnprotect());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const control = await shot(null, region);
    assertPattern(control, [marker, marker, marker, marker], 'unprotected overlay control');
    assert.deepEqual([selected.width, selected.height], [control.width, control.height]);

    const describe = frame => ({width: frame.width, height: frame.height, firstFrameMs: frame.firstFrameMs});
    console.log(JSON.stringify({windows: release(), arch: process.arch, electron: info.electron, scale: info.scale,
      windowA: describe(a), windowB: describe(b), selectedRegion: describe(selected), overlayExcluded: true}, null, 2));
  } finally {
    const closed = await Promise.allSettled(apps.map(instance => instance.close()));
    assert.ok(closed.every(result => result.status === 'fulfilled'), 'failed to close an isolated probe process');
    rmSync(directory, {recursive: true, force: true});
  }
}

if (process.versions.electron || (process.argv[1] && resolve(process.argv[1]) === probeFile)) {
  assert.ok(process.platform === 'win32' && process.arch === 'x64', 'requires an interactive Windows x64 desktop');
  if (process.versions.electron) await launchProbeApp();
  else await runProbe();
}
