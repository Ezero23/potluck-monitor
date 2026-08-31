'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { macAppPath } = require('../../scripts/after-pack');

test('mac afterPack resolves the branded application bundle', () => {
  assert.equal(macAppPath({
    appOutDir: '/tmp/dist/mac-arm64',
    packager: { appInfo: { productFilename: 'Potluck Monitor' } }
  }), path.join('/tmp/dist/mac-arm64', 'Potluck Monitor.app'));
});

test('mac afterPack refuses incomplete builder context', () => {
  assert.equal(macAppPath({}), '');
  assert.equal(macAppPath({ appOutDir: '/tmp/dist' }), '');
});
