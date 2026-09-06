'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');

const path = require('node:path');
const {
  createNativeStatusItemBridge,
  helperPath,
  parseHelperEvent,
  trayBoundsAreVisible
} = require('../../src/electron/nativeStatusItem');

const displays = [{
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 30, width: 1920, height: 1050 }
}];

test('recognizes a status item inside the macOS menu bar', () => {
  assert.equal(trayBoundsAreVisible({ x: 1113, y: 3, width: 24, height: 24 }, displays), true);
});

test('rejects status items parked outside the visible menu bar', () => {
  assert.equal(trayBoundsAreVisible({ x: 1883, y: -1, width: 38, height: 24 }, displays), false);
  assert.equal(trayBoundsAreVisible({ x: 1884, y: 0, width: 36, height: 22 }, displays), false);
  assert.equal(trayBoundsAreVisible({ x: 1910, y: 3, width: 24, height: 24 }, displays), false);
  assert.equal(trayBoundsAreVisible({ x: 1113, y: 0, width: 24, height: 24 }, displays), true);
  assert.equal(trayBoundsAreVisible({ x: -1, y: 1075, width: 38, height: 24 }, displays), false);
  assert.equal(trayBoundsAreVisible({ x: 0, y: 0, width: 0, height: 0 }, displays), false);
});

test('parses native helper click anchors and menu events', () => {
  assert.deepEqual(parseHelperEvent('toggle\t1113\t3\t24\t24'), {
    type: 'toggle',
    anchor: { x: 1113, y: 3, width: 24, height: 24 }
  });
  assert.deepEqual(parseHelperEvent('settings'), { type: 'settings' });
  assert.deepEqual(parseHelperEvent('toggle\tbad'), { type: 'toggle', anchor: null });
});

test('rejects incomplete, blank and nonpositive native click bounds', () => {
  for (const line of ['toggle', 'toggle\t1\t2', 'toggle\t1\t\t3\t4', 'toggle\t1\t2\t0\t4', 'toggle\t1\t2\t3\t4\t5']) {
    assert.deepEqual(parseHelperEvent(line), { type: 'toggle', anchor: null });
  }
});

async function waitUntil(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for helper state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('native menu events preserve global negative display coordinates', () => {
  assert.deepEqual(parseHelperEvent('menu\t-1200\t-900\t40\t24'), {
    type: 'menu', anchor: { x: -1200, y: -900, width: 40, height: 24 }
  });
  assert.deepEqual(parseHelperEvent('menu\t1'), { type: 'menu', anchor: null });
});

test('native display is replayed on readiness and restart, including PNG and template semantics', async (t) => {
  const received = [];
  const bridge = createNativeStatusItemBridge({
    executablePath: process.execPath,
    args: ['-e', `
      const readline = require('node:readline');
      readline.createInterface({input: process.stdin}).on('line', line => {
        process.stderr.write(line + '\\n');
        process.stdout.write('menu\\t-1200\\t-900\\t40\\t24\\n');
      });
      process.stdout.write('ready\\n');
    `],
    onError: (error) => received.push(error.message),
    onContextMenu: (anchor) => { assert.equal(anchor.x, -1200); }
  });
  t.after(() => bridge.stop());
  bridge.setDisplay({ title: '额度 75%', tooltip: '中文提示', image: {
    getSize: () => ({ width: 100, height: 20 }),
    toPNG: () => Buffer.from('png-fixture'), isTemplateImage: () => false
  } });
  const expected = { title: '额度 75%', tooltip: '中文提示', image: Buffer.from('png-fixture').toString('base64'), width: 100, height: 20, template: false };
  for (let i = 0; i < 2; i += 1) {
    bridge.start();
    await waitUntil(() => received.length > i);
    const [command, encoded] = received[i].split('\t');
    assert.equal(command, 'display');
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString()), expected);
    bridge.stop();
  }
});

test('native right-click uses the same current translated menu and actions as Electron', (t) => {
  const Module = require('node:module');
  const original = Module._load;
  let template;
  let location;
  let refreshes = 0;
  let refreshing = false;
  const image = { resize() { return this; }, setTemplateImage() {} };
  const fake = {
    nativeImage: { createFromPath: () => image },
    Tray: class { setToolTip() {} on() {} },
    Menu: { buildFromTemplate(items) { template = items; return { popup: (options) => { location = options; } }; } }
  };
  t.mock.method(Module, '_load', function (name, ...args) {
    return name === 'electron' ? fake : original.call(this, name, ...args);
  });
  const { createTray } = require('../../src/electron/tray');
  const tray = createTray({
    getMenuState: () => ({ refreshing }),
    translateMenu: (key) => key === 'trayMenu.refreshNow' ? '立即刷新' : key,
    onRefresh: () => { refreshes += 1; }
  });
  tray.showContextMenuAt({ x: -1200, y: -900, height: 24 });
  assert.equal(location, undefined);
  assert.equal(template[0].label, '立即刷新');
  template[0].click();
  assert.equal(refreshes, 1);
  refreshing = true;
  tray.showContextMenuAt({ x: 0, y: 0, height: 24 });
  assert.equal(template[0].enabled, false);
});

test('failed spawn clears running state and retries only after backoff', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potluck-spawn-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const errors = [];
  let exits = 0;
  const bridge = createNativeStatusItemBridge({
    executablePath: dir,
    onError: (error) => errors.push(error),
    onExit: () => { exits += 1; }
  });
  t.after(() => bridge.stop());
  assert.equal(bridge.start(), true);
  await waitUntil(() => exits === 1);
  assert.equal(bridge.isRunning(), false);
  assert.equal(bridge.isReady(), false);
  assert.equal(bridge.start(), false);
  assert.ok(errors.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.equal(bridge.start(), true);
  await waitUntil(() => exits === 2);
});

test('helper that never becomes ready is terminated and recoverable', async (t) => {
  let exits = 0;
  const errors = [];
  const bridge = createNativeStatusItemBridge({
    executablePath: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    readyTimeoutMs: 100,
    onError: (error) => errors.push(error.message),
    onExit: () => { exits += 1; }
  });
  t.after(() => bridge.stop());
  bridge.start();
  assert.equal(bridge.isReady(), false);
  await waitUntil(() => exits === 1);
  assert.equal(bridge.isRunning(), false);
  assert.ok(errors.includes('native status item ready timeout'));
});

test('old process exit cannot clear a replacement helper or emit its callbacks', async (t) => {
  let exits = 0;
  const bridge = createNativeStatusItemBridge({
    executablePath: process.execPath,
    args: ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'],
    onExit: () => { exits += 1; }
  });
  t.after(() => bridge.stop());
  bridge.start();
  await waitUntil(() => bridge.isReady());
  bridge.stop();
  assert.equal(bridge.start(), true);
  await waitUntil(() => bridge.isReady());
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(bridge.isRunning(), true);
  assert.equal(bridge.isReady(), true);
  assert.equal(exits, 0);
});

test('resolves the executable inside the bundled status item app', () => {
  assert.equal(helperPath('/tmp/resources'), path.join(
    '/tmp/resources',
    'Potluck Monitor Status Item.app',
    'Contents',
    'MacOS',
    'potluck-status-item'
  ));
});

test('helper pipe closure cannot surface an EPIPE as an uncaught app error', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'potluck-status-helper-'));
  const script = path.join(dir, 'short-lived-helper.js');
  fs.writeFileSync(script, 'process.stdout.write("ready\\n");\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const reported = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('helper did not exit')), 2000);
    const bridge = createNativeStatusItemBridge({
      executablePath: process.execPath,
      args: [script],
      onError: (error) => reported.push(error),
      onExit: () => {
        clearTimeout(timeout);
        bridge.setTitle('still safe');
        resolve();
      }
    });
    assert.equal(bridge.start(), true);
  });
  assert.deepEqual(reported, []);
});
