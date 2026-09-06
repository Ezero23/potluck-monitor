'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');
const handler = source.slice(source.indexOf('function focusExistingWindow()'), source.indexOf('function currentWindowToggleShortcutStatus()'));

test('macOS activation and second-instance both restore the main window', () => {
  assert.match(source, /app\.on\('activate', focusExistingWindow\)/);
  assert.match(source, /app\.on\('second-instance', focusExistingWindow\)/);
});

for (const mode of ['hidden', 'minimized', 'tray', 'destroyed', 'absent']) {
  test(`activation restores ${mode} main window`, () => {
    const calls = [];
    const context = {
      mainWindow: mode === 'absent' ? null : {
        isDestroyed: () => mode === 'destroyed',
        isMinimized: () => mode === 'minimized',
        restore: () => calls.push('restore'),
        show: () => calls.push('show')
      },
      settings: { trayMode: mode === 'tray' },
      floatingBubbleState: { collapsed: false },
      applyMacActivationPolicy() {},
      applyMacSpaceBehavior() {},
      createWindow: () => calls.push('create'),
      showPopover: () => calls.push('popover')
    };
    vm.runInNewContext(`${handler}\nfocusExistingWindow();`, context);
    assert.deepEqual(calls, mode === 'absent' || mode === 'destroyed' ? ['create']
      : mode === 'tray' ? ['popover'] : mode === 'minimized' ? ['restore', 'show'] : ['show']);
  });
}
