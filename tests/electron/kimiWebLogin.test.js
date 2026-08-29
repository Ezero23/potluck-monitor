'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  KIMI_LOGIN_URL,
  KIMI_SESSION_PARTITION,
  clearKimiWebSession,
  isAllowedKimiLoginUrl,
  runKimiWebLogin,
  usableKimiAuthCookie
} = require('../../src/electron/kimiWebLogin');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

class FakeWebContents extends EventEmitter {
  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }
}

class FakeBrowserWindow extends EventEmitter {
  static latest = null;

  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    FakeBrowserWindow.latest = this;
  }

  isDestroyed() { return this.destroyed; }
  show() { this.shown = true; }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
  async loadURL(url) { this.loadedUrl = url; }
}

function fakeElectronSession(initialCookies = []) {
  const cookies = new EventEmitter();
  cookies.get = async () => initialCookies;
  const webSession = {
    cookies,
    setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler; },
    setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler; },
    async clearStorageData(options) { this.cleared = options; }
  };
  return {
    electronSession: {
      fromPartition(partition, options) {
        webSession.partition = partition;
        webSession.partitionOptions = options;
        return webSession;
      }
    },
    webSession
  };
}

test('Kimi login allowlist accepts only HTTPS kimi.com hosts', () => {
  assert.equal(isAllowedKimiLoginUrl('https://www.kimi.com/code/console'), true);
  assert.equal(isAllowedKimiLoginUrl('https://auth.kimi.com/login'), true);
  assert.equal(isAllowedKimiLoginUrl('http://www.kimi.com/code/console'), false);
  assert.equal(isAllowedKimiLoginUrl('https://kimi.com.evil.example/login'), false);
});

test('Kimi auth cookies must be non-empty, scoped to Kimi, and unexpired', () => {
  assert.equal(usableKimiAuthCookie({ name: 'kimi-auth', value: 'token', domain: '.kimi.com' }, 100), true);
  assert.equal(usableKimiAuthCookie({ name: 'kimi-auth', value: 'token', domain: '.kimi.com', expirationDate: 99 }, 100), false);
  assert.equal(usableKimiAuthCookie({ name: 'kimi-auth', value: 'token', domain: '.example.com' }, 100), false);
  assert.equal(usableKimiAuthCookie({ name: 'other', value: 'token', domain: '.kimi.com' }, 100), false);
});

test('Kimi login uses an isolated sandbox, denies permissions, and returns only its auth cookie', async () => {
  const { electronSession, webSession } = fakeElectronSession();
  const loginPromise = runKimiWebLogin({
    BrowserWindow: FakeBrowserWindow,
    session: electronSession,
    timeoutMs: 5000
  });
  await new Promise((resolve) => setImmediate(resolve));

  const win = FakeBrowserWindow.latest;
  assert.equal(win.loadedUrl, KIMI_LOGIN_URL);
  assert.equal(win.options.webPreferences.partition, KIMI_SESSION_PARTITION);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(webSession.permissionCheckHandler(), false);
  let permissionGranted = true;
  webSession.permissionRequestHandler(null, 'camera', (allowed) => { permissionGranted = allowed; });
  assert.equal(permissionGranted, false);

  webSession.cookies.emit('changed', {}, {
    name: 'kimi-auth',
    value: 'web-token',
    domain: '.kimi.com'
  }, 'explicit', false);
  assert.deepEqual(await loginPromise, { token: 'web-token', reused: false });
  assert.equal(win.destroyed, true);
});

test('Kimi login reuses its own valid session and logout clears only that partition', async () => {
  const { electronSession, webSession } = fakeElectronSession([
    { name: 'kimi-auth', value: 'saved-token', domain: '.kimi.com', expirationDate: Date.now() / 1000 + 3600 }
  ]);
  const result = await runKimiWebLogin({ BrowserWindow: FakeBrowserWindow, session: electronSession });
  assert.deepEqual(result, { token: 'saved-token', reused: true });

  assert.equal(await clearKimiWebSession(electronSession), true);
  assert.equal(webSession.partition, KIMI_SESSION_PARTITION);
  assert.deepEqual(webSession.cleared, {
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers']
  });
});

test('main and preload expose Kimi login without sending the cookie to the renderer', () => {
  const main = source('src/electron/main.js');
  const preload = source('src/electron/preload.js');
  assert.match(main, /ipcMain\.handle\('kimi:signIn'/);
  assert.match(main, /fetchKimiLimits\(\{ kimiWebAccessToken: login\.token \}\)/);
  assert.match(main, /handleSettingsUpdate\(event, \{ kimiWebAccessToken: login\.token \}\)/);
  assert.match(preload, /signIn: \(\) => ipcRenderer\.invoke\('kimi:signIn'\)/);
  assert.doesNotMatch(preload, /kimiWebAccessToken/);
});
