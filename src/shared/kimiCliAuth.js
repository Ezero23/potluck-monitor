'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KIMI_CLI_CREDENTIAL_FILE = path.join('credentials', 'kimi-code.json');
const MAX_CREDENTIAL_BYTES = 64 * 1024;

function kimiShareDir(env = process.env, homedir = os.homedir()) {
  const configured = String(env.KIMI_SHARE_DIR || '').trim();
  return configured ? path.resolve(configured) : path.join(homedir, '.kimi');
}

function jwtExpiry(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = Number(payload.exp);
    return Number.isFinite(exp) ? exp : 0;
  } catch (_) {
    return 0;
  }
}

function readPrivateJson(filePath, fileSystem = fs) {
  let fd = null;
  try {
    const noFollow = fileSystem.constants?.O_NOFOLLOW || 0;
    fd = fileSystem.openSync(filePath, fileSystem.constants.O_RDONLY | noFollow);
    const stat = fileSystem.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CREDENTIAL_BYTES) return null;
    const text = fileSystem.readFileSync(fd, 'utf8');
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) {
      try { fileSystem.closeSync(fd); } catch (_) {}
    }
  }
}

function readKimiCliAccessToken(options = {}, deps = {}) {
  const env = options.env || deps.env || process.env;
  const home = options.homedir || deps.homedir || os.homedir();
  const filePath = path.join(kimiShareDir(env, home), KIMI_CLI_CREDENTIAL_FILE);
  const credential = readPrivateJson(filePath, deps.fs || fs);
  const token = String(credential?.access_token || '').trim();
  if (!token) return '';
  const expiresAt = Number(credential.expires_at) || jwtExpiry(token);
  const nowSeconds = Number((deps.now || Date.now)()) / 1000;
  const minValiditySeconds = Math.max(0, Number(options.minValiditySeconds ?? 60) || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds + minValiditySeconds) return '';
  return token;
}

module.exports = {
  KIMI_CLI_CREDENTIAL_FILE,
  kimiShareDir,
  readKimiCliAccessToken
};
