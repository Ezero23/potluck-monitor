'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const supervisor = require('../../src/electron/potluckSupervisor');

const SILENT_LOGGER = { log() {}, warn() {}, error() {} };

function mockFs(files = {}) {
  return {
    readFileSync(filePath) {
      if (Object.hasOwn(files, filePath)) return files[filePath];
      const error = new Error(`ENOENT: ${filePath}`);
      error.code = 'ENOENT';
      throw error;
    },
    existsSync(filePath) {
      return Object.hasOwn(files, filePath);
    },
    mkdirSync() {},
    openSync() { return 3; },
    closeSync() {}
  };
}

function mockOs() {
  return { homedir: () => '/home/tester' };
}

// fetch mock: `alive` is the set of ports that answer /api/health with ok.
// Records probe order in `calls`.
function mockFetch(alive = [], calls = []) {
  return async (url) => {
    const port = Number(new URL(url).port);
    calls.push(port);
    if (alive.includes(port)) return { ok: true, status: 200 };
    const error = new Error('connect ECONNREFUSED');
    error.code = 'ECONNREFUSED';
    throw error;
  };
}

function baseDeps(overrides = {}) {
  return {
    fs: mockFs(),
    os: mockOs(),
    path: require('node:path'),
    childProcess: { spawn() { throw new Error('spawn not mocked'); }, execFileSync() { throw new Error('no which'); } },
    fetch: mockFetch(),
    execPath: '/fake/electron',
    env: {},
    appPath: '/repo/potluck-monitor',
    logger: SILENT_LOGGER,
    sleep: () => Promise.resolve(),
    persist: null,
    onSettingsChanged: null,
    settings: null,
    ...overrides
  };
}

test('candidatePorts: configured port first, defaults after, deduplicated', () => {
  assert.deepEqual(supervisor.candidatePorts({ potluckPort: 20444 }), [20444, 20131, 21023]);
  assert.deepEqual(supervisor.candidatePorts({ potluckPort: 20131 }), [20131, 21023]);
  assert.deepEqual(supervisor.candidatePorts({ potluckPort: 21023 }), [21023, 20131]);
  assert.deepEqual(supervisor.candidatePorts({}), [20131, 21023]);
  assert.deepEqual(supervisor.candidatePorts({ potluckPort: 'not-a-port' }), [20131, 21023]);
});

test('probePotluck: true on ok health, false on refusal or non-ok', async () => {
  const deps = baseDeps({ fetch: mockFetch([20131]) });
  assert.equal(await supervisor.probePotluck(20131, 50, deps), true);
  assert.equal(await supervisor.probePotluck(21023, 50, deps), false);
  const notOk = baseDeps({ fetch: async () => ({ ok: false, status: 500 }) });
  assert.equal(await supervisor.probePotluck(20131, 50, notOk), false);
  assert.equal(await supervisor.probePotluck(0, 50, deps), false);
});

test('discoverPotluck: probes in order, first alive wins, none alive → null', async () => {
  const calls = [];
  const deps = baseDeps({ fetch: mockFetch([21023], calls) });
  const port = await supervisor.discoverPotluck({ potluckPort: 20444 }, deps);
  assert.equal(port, 21023);
  assert.deepEqual(calls, [20444, 20131, 21023]);

  const dead = baseDeps({ fetch: mockFetch([]) });
  assert.equal(await supervisor.discoverPotluck({}, dead), null);

  const firstWinsCalls = [];
  const firstWins = baseDeps({ fetch: mockFetch([20131, 21023], firstWinsCalls) });
  assert.equal(await supervisor.discoverPotluck({}, firstWins), 20131);
  assert.deepEqual(firstWinsCalls, [20131]); // stops at first alive
});

test('readPairingSecret: missing file → null, present → trimmed', () => {
  const secretPath = '/home/tester/.potluck/auth/monitor-secret';
  const missing = baseDeps({ fs: mockFs() });
  assert.equal(supervisor.readPairingSecret({}, missing), null);

  const present = baseDeps({ fs: mockFs({ [secretPath]: '  abc123def\n' }) });
  assert.equal(supervisor.readPairingSecret({}, present), 'abc123def');

  const blank = baseDeps({ fs: mockFs({ [secretPath]: '  \n' }) });
  assert.equal(supervisor.readPairingSecret({}, blank), null);

  // potluckDataDir override relocates the secret file
  const custom = baseDeps({ fs: mockFs({ '/data/auth/monitor-secret': 'zzz' }) });
  assert.equal(supervisor.readPairingSecret({ potluckDataDir: '/data' }, custom), 'zzz');
});

test('ensureAutoPaired: no secret file → no-op', () => {
  supervisor.__resetForTests();
  const persisted = [];
  const settings = { hubMode: 'local', hubHostPort: 17321, hubHostSecret: '' };
  const deps = baseDeps({ settings, persist: () => persisted.push(1) });
  const result = supervisor.ensureAutoPaired(settings, deps);
  assert.deepEqual(result, { changed: false, reason: 'no-secret' });
  assert.equal(settings.hubMode, 'local');
  assert.equal(persisted.length, 0);
});

test('ensureAutoPaired: secret present → host mode on 17321 with the pairing secret', () => {
  supervisor.__resetForTests();
  const secretPath = '/home/tester/.potluck/auth/monitor-secret';
  const persisted = [];
  const settings = { hubMode: 'local', hubHostPort: 17321, hubHostSecret: '' };
  const deps = baseDeps({ fs: mockFs({ [secretPath]: 'deadbeef\n' }), settings, persist: () => persisted.push(1) });
  const result = supervisor.ensureAutoPaired(settings, deps);
  assert.deepEqual(result, { changed: true, reason: 'paired' });
  assert.equal(settings.hubMode, 'host');
  assert.equal(settings.hubHostPort, 17321);
  assert.equal(settings.hubHostSecret, 'deadbeef');
  assert.equal(settings.potluckAutoPaired, true);
  assert.equal(persisted.length, 1);

  // Idempotent: a second run changes nothing and does not persist again.
  const again = supervisor.ensureAutoPaired(settings, deps);
  assert.deepEqual(again, { changed: false, reason: 'already' });
  assert.equal(persisted.length, 1);
});

test('ensureAutoPaired: user-configured client hubUrl → untouched', () => {
  supervisor.__resetForTests();
  const secretPath = '/home/tester/.potluck/auth/monitor-secret';
  const persisted = [];
  const settings = { hubMode: 'client', hubUrl: 'http://nas:17321', hubHostSecret: '' };
  const deps = baseDeps({ fs: mockFs({ [secretPath]: 'deadbeef' }), settings, persist: () => persisted.push(1) });
  const result = supervisor.ensureAutoPaired(settings, deps);
  assert.deepEqual(result, { changed: false, reason: 'client-configured' });
  assert.equal(settings.hubMode, 'client');
  assert.equal(settings.hubHostSecret, '');
  assert.equal(persisted.length, 0);
});

test('ensureAutoPaired: autoPairPotluck === false opts out', () => {
  supervisor.__resetForTests();
  const secretPath = '/home/tester/.potluck/auth/monitor-secret';
  const settings = { hubMode: 'local', autoPairPotluck: false, hubHostSecret: '' };
  const deps = baseDeps({ fs: mockFs({ [secretPath]: 'deadbeef' }), settings });
  assert.deepEqual(supervisor.ensureAutoPaired(settings, deps), { changed: false, reason: 'disabled' });
  assert.equal(settings.hubMode, 'local');
});

test('ensureAutoPaired: never clobbers a user-set host secret, but refreshes its own', () => {
  supervisor.__resetForTests();
  const secretPath = '/home/tester/.potluck/auth/monitor-secret';
  const fsMock = mockFs({ [secretPath]: 'deadbeef' });

  const userSettings = { hubMode: 'host', hubHostPort: 18000, hubHostSecret: 'user-chosen', potluckAutoPaired: false };
  const userDeps = baseDeps({ fs: fsMock, settings: userSettings });
  assert.deepEqual(supervisor.ensureAutoPaired(userSettings, userDeps), { changed: false, reason: 'user-secret' });
  assert.equal(userSettings.hubHostSecret, 'user-chosen');
  assert.equal(userSettings.hubHostPort, 18000);

  // A secret this app previously auto-paired may be rotated (gateway
  // regenerated its secret) and the port re-pinned to the contract port.
  const ownSettings = { hubMode: 'host', hubHostPort: 18000, hubHostSecret: 'old-auto', potluckAutoPaired: true };
  const ownDeps = baseDeps({ fs: fsMock, settings: ownSettings, persist: () => {} });
  const result = supervisor.ensureAutoPaired(ownSettings, ownDeps);
  assert.equal(result.changed, true);
  assert.equal(ownSettings.hubHostSecret, 'deadbeef');
  assert.equal(ownSettings.hubHostPort, 17321);
});

test('resolvePotluckPath: configured path wins, then app sibling, then ~/potluck', () => {
  const configured = baseDeps({ fs: mockFs({ '/opt/potluck/scripts/potluck': '' }) });
  assert.equal(supervisor.resolvePotluckPath({ potluckPath: '/opt/potluck' }, configured), '/opt/potluck');

  const sibling = baseDeps({ fs: mockFs({ '/repo/potluck/scripts/potluck': '' }) });
  assert.equal(supervisor.resolvePotluckPath({}, sibling), '/repo/potluck');

  const home = baseDeps({ fs: mockFs({ '/home/tester/potluck/scripts/potluck': '' }) });
  assert.equal(supervisor.resolvePotluckPath({}, home), '/home/tester/potluck');

  const none = baseDeps({ fs: mockFs() });
  assert.equal(supervisor.resolvePotluckPath({}, none), null);
});

function fakeChild(pid = 4321) {
  const handlers = {};
  return {
    pid,
    killed: [],
    kill(signal) { this.killed.push(signal); return true; },
    on(event, fn) { handlers[event] = fn; },
    emit(event, ...args) { handlers[event]?.(...args); }
  };
}

// No gateway answers discovery, a checkout exists, spawn succeeds and the
// spawned gateway only then starts answering /api/health.
function initSupervised(settings) {
  const child = fakeChild();
  let spawned = false;
  const deps = baseDeps({
    settings,
    fs: mockFs({ '/repo/potluck/scripts/potluck': '' }),
    fetch: async () => {
      if (!spawned) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return { ok: true, status: 200 };
    },
    childProcess: {
      spawn: () => { spawned = true; return child; },
      execFileSync() { throw new Error('no which'); }
    }
  });
  const { ready } = supervisor.init(deps);
  return { child, deps, ready };
}

test('quit behavior: keep=false stops a supervised child', async () => {
  supervisor.__resetForTests();
  const settings = { potluckPort: 20131, hubMode: 'local', hubHostSecret: '', keepGatewayRunningOnQuit: false };
  const { child, ready } = initSupervised(settings);
  const spawned = await ready;
  assert.equal(spawned.running, true);
  assert.equal(spawned.supervised, true);
  assert.equal(spawned.pid, 4321);
  const stopped = supervisor.onAppQuit(settings);
  assert.equal(stopped, true);
  assert.deepEqual(child.killed, ['SIGTERM']);
  assert.equal(supervisor.getState(settings).running, false);
  supervisor.__resetForTests();
});

test('quit behavior: keep=true leaves a supervised child running', async () => {
  supervisor.__resetForTests();
  const settings = { potluckPort: 20131, hubMode: 'local', hubHostSecret: '', keepGatewayRunningOnQuit: true };
  const { child, ready } = initSupervised(settings);
  await ready;
  assert.equal(supervisor.onAppQuit(settings), false);
  assert.deepEqual(child.killed, []);
  assert.equal(supervisor.getState(settings).running, true);
  supervisor.__resetForTests();
});

test('quit behavior: a discovered external gateway is never stopped', async () => {
  supervisor.__resetForTests();
  const settings = { potluckPort: 20131, hubMode: 'local', hubHostSecret: '' };
  const { ready } = supervisor.init(baseDeps({
    settings,
    fetch: mockFetch([20131]) // alive on first probe → adopted, not spawned
  }));
  await ready;
  const state = supervisor.getState(settings);
  assert.equal(state.running, true);
  assert.equal(state.supervised, false);
  assert.equal(state.port, 20131);
  assert.equal(supervisor.onAppQuit(settings), false);
  assert.equal(supervisor.getState(settings).running, true);
  supervisor.__resetForTests();
});

test('init: sync pairing happens before async discovery resolves', async () => {
  supervisor.__resetForTests();
  const secretPath = '/home/tester/.potluck/auth/monitor-secret';
  const settings = { hubMode: 'local', hubHostSecret: '' };
  supervisor.init(baseDeps({
    settings,
    fs: mockFs({ [secretPath]: 'deadbeef' }),
    fetch: mockFetch([20131])
  }));
  // Synchronously after init() returns, the hub-start prerequisites are set.
  assert.equal(settings.hubMode, 'host');
  assert.equal(settings.hubHostSecret, 'deadbeef');
  assert.equal(settings.hubHostPort, 17321);
  supervisor.__resetForTests();
});
