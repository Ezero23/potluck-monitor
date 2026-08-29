'use strict';

const KIMI_LOGIN_URL = 'https://www.kimi.com/code/console';
const KIMI_SESSION_PARTITION = 'persist:potluck-kimi-web';
const KIMI_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function isAllowedKimiLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'kimi.com' || url.hostname.endsWith('.kimi.com'));
  } catch (_) {
    return false;
  }
}

function usableKimiAuthCookie(cookie, nowSeconds = Date.now() / 1000) {
  if (!cookie || cookie.name !== 'kimi-auth' || !String(cookie.value || '').trim()) return false;
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  if (domain && domain !== 'kimi.com' && !domain.endsWith('.kimi.com')) return false;
  return !Number.isFinite(cookie.expirationDate) || cookie.expirationDate > nowSeconds;
}

async function findKimiAuthCookie(webSession) {
  const cookies = await webSession.cookies.get({ name: 'kimi-auth' });
  return cookies
    .filter((cookie) => usableKimiAuthCookie(cookie))
    .sort((a, b) => Number(b.expirationDate || 0) - Number(a.expirationDate || 0))[0] || null;
}

function loginError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function runKimiWebLogin(options) {
  const {
    BrowserWindow,
    session,
    parent = null,
    timeoutMs = KIMI_LOGIN_TIMEOUT_MS
  } = options || {};
  if (!BrowserWindow || !session?.fromPartition) {
    throw loginError('unavailable', 'Kimi login is unavailable in this runtime.');
  }

  const webSession = session.fromPartition(KIMI_SESSION_PARTITION, { cache: true });
  webSession.setPermissionCheckHandler?.(() => false);
  webSession.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false));

  const existing = await findKimiAuthCookie(webSession);
  if (existing) return { token: existing.value, reused: true };

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    const win = new BrowserWindow({
      width: 1040,
      height: 760,
      minWidth: 720,
      minHeight: 560,
      show: false,
      parent: parent && !parent.isDestroyed?.() ? parent : undefined,
      modal: false,
      title: 'Sign in to Kimi',
      autoHideMenuBar: true,
      webPreferences: {
        partition: KIMI_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      webSession.cookies.removeListener('changed', onCookieChanged);
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!win.isDestroyed()) win.close();
      if (error) reject(error);
      else resolve(result);
    };
    const acceptCookie = (cookie) => {
      if (!usableKimiAuthCookie(cookie)) return false;
      finish(null, { token: cookie.value, reused: false });
      return true;
    };
    const checkCookies = async () => {
      try {
        const cookie = await findKimiAuthCookie(webSession);
        if (cookie) acceptCookie(cookie);
      } catch (_) {}
    };
    function onCookieChanged(_event, cookie, _cause, removed) {
      if (!removed) acceptCookie(cookie);
    }

    webSession.cookies.on('changed', onCookieChanged);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedKimiLoginUrl(url)) event.preventDefault();
    });
    win.webContents.on('did-navigate', () => { void checkCookies(); });
    win.webContents.on('did-navigate-in-page', () => { void checkCookies(); });
    win.once('ready-to-show', () => win.show());
    win.once('closed', () => {
      if (!settled) finish(loginError('cancelled', 'Kimi sign-in was cancelled.'));
    });
    timeout = setTimeout(() => {
      finish(loginError('timeout', 'Kimi sign-in timed out.'));
    }, Math.max(1000, Number(timeoutMs) || KIMI_LOGIN_TIMEOUT_MS));
    win.loadURL(KIMI_LOGIN_URL).catch((error) => {
      finish(loginError('unavailable', `Could not open Kimi sign-in: ${error.message}`));
    });
  });
}

async function clearKimiWebSession(session) {
  const webSession = session?.fromPartition?.(KIMI_SESSION_PARTITION, { cache: true });
  if (!webSession) return false;
  await webSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers']
  });
  return true;
}

module.exports = {
  KIMI_LOGIN_TIMEOUT_MS,
  KIMI_LOGIN_URL,
  KIMI_SESSION_PARTITION,
  clearKimiWebSession,
  findKimiAuthCookie,
  isAllowedKimiLoginUrl,
  runKimiWebLogin,
  usableKimiAuthCookie
};
