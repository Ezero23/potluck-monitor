'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const fs = require('node:fs');
const { Arch } = require('builder-util');

const { adHocSign, compileNativeStatusItem, macAppPath, nativeTarget } = require('../../scripts/after-pack');

test('native target uses the bundle minimum and requested architecture, never the build host', () => {
  const plist = fs.readFileSync(path.join(__dirname, '../../native/macos/StatusItem-Info.plist'), 'utf8');
  assert.equal(nativeTarget(Arch.arm64, plist), 'arm64-apple-macosx11.0');
  assert.equal(nativeTarget(Arch.x64, plist), 'x86_64-apple-macosx11.0');
  assert.throws(() => nativeTarget(undefined, plist), /Unsupported/);
  assert.throws(() => nativeTarget(Arch.universal, plist), /Unsupported/);
  assert.throws(() => nativeTarget(Arch.arm64, ''), /minimum/);
});

test('mac afterPack resolves the branded application bundle', () => {
  assert.equal(macAppPath({
    appOutDir: '/tmp/dist/mac-arm64',
    packager: { appInfo: { productFilename: 'Potluck Monitor' } }
  }), path.join('/tmp/dist/mac-arm64', 'Potluck Monitor.app'));
});

test('mac afterPack exposes the native status item compiler', () => {
  assert.equal(typeof compileNativeStatusItem, 'function');
  assert.equal(typeof adHocSign, 'function');
});

test('mac afterPack refuses incomplete builder context', () => {
  assert.equal(macAppPath({}), '');
  assert.equal(macAppPath({ appOutDir: '/tmp/dist' }), '');
});
