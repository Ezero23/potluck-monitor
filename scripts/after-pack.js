'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Arch } = require('builder-util');

function nativeTarget(arch, plist) {
  const cpu = arch === Arch.arm64 ? 'arm64' : arch === Arch.x64 ? 'x86_64' : null;
  if (!cpu) throw new Error(`Unsupported native status item architecture: ${arch}`);
  const minimum = plist.match(/<key>LSMinimumSystemVersion<\/key>\s*<string>(\d+\.\d+(?:\.\d+)?)<\/string>/)?.[1];
  if (!minimum) throw new Error('Missing native status item minimum macOS version');
  return `${cpu}-apple-macosx${minimum}`;
}

function macAppPath(context) {
  const productFilename = context?.packager?.appInfo?.productFilename;
  if (!context?.appOutDir || !productFilename) return '';
  return path.join(context.appOutDir, `${productFilename}.app`);
}

function compileNativeStatusItem(appPath, arch) {
  const sourcePath = path.join(__dirname, '..', 'native', 'macos', 'PotluckStatusItem.swift');
  const plistPath = path.join(__dirname, '..', 'native', 'macos', 'StatusItem-Info.plist');
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'tray-token-monitor.png');
  const target = nativeTarget(arch, fs.readFileSync(plistPath, 'utf8'));
  const helperAppPath = path.join(appPath, 'Contents', 'Resources', 'Potluck Monitor Status Item.app');
  const contentsPath = path.join(helperAppPath, 'Contents');
  const resourcesPath = path.join(contentsPath, 'Resources');
  const executablePath = path.join(contentsPath, 'MacOS', 'potluck-status-item');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(resourcesPath, { recursive: true });
  fs.copyFileSync(plistPath, path.join(contentsPath, 'Info.plist'));
  fs.copyFileSync(iconPath, path.join(resourcesPath, 'tray-token-monitor.png'));
  const result = spawnSync('/usr/bin/xcrun', [
    'swiftc',
    sourcePath,
    '-target',
    target,
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

function adHocSign(targetPath) {
  const result = spawnSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    targetPath
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Ad-hoc signing failed for ${targetPath}: ${detail || `exit ${result.status}`}`);
  }
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
  const helperExecutable = compileNativeStatusItem(appPath, context.arch);

  if (process.env.CSC_LINK) return;
  const helperAppPath = path.resolve(path.dirname(helperExecutable), '..', '..');
  adHocSign(helperAppPath);
  adHocSign(appPath);
};

module.exports.macAppPath = macAppPath;
module.exports.compileNativeStatusItem = compileNativeStatusItem;
module.exports.adHocSign = adHocSign;
module.exports.nativeTarget = nativeTarget;
