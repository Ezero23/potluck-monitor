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
