'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function macAppPath(context) {
  const productFilename = context?.packager?.appInfo?.productFilename;
  if (!context?.appOutDir || !productFilename) return '';
  return path.join(context.appOutDir, `${productFilename}.app`);
}

function compileNativeStatusItem(appPath) {
  const sourcePath = path.join(__dirname, '..', 'native', 'macos', 'PotluckStatusItem.swift');
  const plistPath = path.join(__dirname, '..', 'native', 'macos', 'StatusItem-Info.plist');
  const helperAppPath = path.join(appPath, 'Contents', 'Resources', 'Potluck Monitor Status Item.app');
  const contentsPath = path.join(helperAppPath, 'Contents');
  const executablePath = path.join(contentsPath, 'MacOS', 'potluck-status-item');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.copyFileSync(plistPath, path.join(contentsPath, 'Info.plist'));
  const result = spawnSync('/usr/bin/xcrun', [
    'swiftc',
    sourcePath,
    '-O',
    '-o',
    executablePath
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Native status item compilation failed: ${detail || `exit ${result.status}`}`);
  }
  return executablePath;
}

/**
 * electron-builder leaves macOS bundles completely unsigned when certificate
 * discovery is disabled. Electron's nested linker signatures then reference a
 * resource envelope that the outer bundle does not contain, producing release
 * archives that fail `codesign --verify --deep --strict` after extraction.
 *
 * A Developer ID build is signed by electron-builder after this hook. For a
 * certificate-less build, seal the entire bundle with a local ad-hoc signature
 * before DMG/ZIP targets consume it. This is not notarization, but it preserves
 * bundle identity and guarantees that the downloadable archive is internally
 * valid instead of shipping a structurally broken signature.
 */
module.exports = async function afterPack(context) {
  if (context?.electronPlatformName !== 'darwin') return;
  const appPath = macAppPath(context);
  if (!appPath) throw new Error('Unable to resolve the packaged macOS app path');
  compileNativeStatusItem(appPath);

  if (process.env.CSC_LINK) return;

  const result = spawnSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath
  ], { encoding: 'utf8' });

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Ad-hoc signing failed for ${appPath}: ${detail || `exit ${result.status}`}`);
  }
};

module.exports.macAppPath = macAppPath;
module.exports.compileNativeStatusItem = compileNativeStatusItem;
