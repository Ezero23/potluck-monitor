'use strict';

// Potluck gateway supervisor: discovers (or spawns) the local Potluck AI
// gateway and auto-pairs this app's embedded hub with the gateway's pairing
// secret (~/.potluck/auth/monitor-secret), so the gateway can push stats to
// POST 127.0.0.1:17321/api/ingest without any manual secret entry.
//
// Deliberately free of `electron` imports so the whole lifecycle is unit
// testable under plain node --test; every side effect goes through an
// injectable deps object (see init()).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

// The embedded hub port Potluck pushes to (fixed by the gateway contract).
const HUB_PORT = 17321;
// Canonical Potluck production/standalone port. A user-configured custom port
// is still probed first; legacy defaults are migrated by the settings loader.
const DISCOVERY_PORTS = [21023];
const PROBE_TIMEOUT_MS = 1000;
const SPAWN_HEALTH_TIMEOUT_MS = 60000;
const SPAWN_HEALTH_POLL_MS = 500;

const state = {
  status: 'idle', // idle | spawning | running | stopped | failed
  port: null,
  pid: null,
  supervised: false,
  child: null,
  potluckPath: null,
  error: null
};

let moduleDeps = null;

function realDeps() {
  return {
    fs,
    os,
    path,
    childProcess,
    fetch: (...args) => globalThis.fetch(...args),
    execPath: process.execPath,
    env: process.env,
    appPath: path.join(__dirname, '..', '..'),
    logger: console,
    persist: null,
    onSettingsChanged: null,
    settings: null,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}

function depsFor(overrides) {
  return overrides || moduleDeps || realDeps();
}

function log(deps, message) {
  try { deps.logger?.log?.(`[potluck] ${message}`); } catch (_) {}
}

function normalizePort(value, fallback = null) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
  return n;
}

// Probe order: the configured port first (user intent wins), then Potluck's
// built-in default — deduplicated.
function candidatePorts(settings) {
  const seen = new Set();
  const out = [];
  for (const value of [settings?.potluckPort, ...DISCOVERY_PORTS]) {
    const port = normalizePort(value);
    if (!port || seen.has(port)) continue;
    seen.add(port);
    out.push(port);
  }
  return out;
}

async function probePotluck(port, timeoutMs = PROBE_TIMEOUT_MS, depsArg) {
  const deps = depsFor(depsArg);
  const normalized = normalizePort(port);
  if (!normalized) return false;
  try {
    const response = await deps.fetch(`http://127.0.0.1:${normalized}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return Boolean(response?.ok);
  } catch (_) {
    return false;
  }
}

// Returns the first alive port in probe order, or null when nothing answers.
async function discoverPotluck(settings, depsArg) {
  const deps = depsFor(depsArg);
  for (const port of candidatePorts(settings)) {
    if (await probePotluck(port, PROBE_TIMEOUT_MS, deps)) return port;
  }
  return null;
}

function potluckDataDir(settings, depsArg) {
  const deps = depsFor(depsArg);
  const configured = String(settings?.potluckDataDir || '').trim();
  if (configured) return configured;
  return deps.path.join(deps.os.homedir(), '.potluck');
}

function pairingSecretPath(settings, depsArg) {
  const deps = depsFor(depsArg);
  return deps.path.join(potluckDataDir(settings, deps), 'auth', 'monitor-secret');
}

function readPairingSecret(settings, depsArg) {
  const deps = depsFor(depsArg);
  try {
    const raw = deps.fs.readFileSync(pairingSecretPath(settings, deps), 'utf8');
    const secret = String(raw || '').trim();
    return secret || null;
  } catch (_) {
    return null;
  }
}

// A resolvable Potluck checkout is a directory containing scripts/potluck.
function resolvePotluckPath(settings, depsArg) {
  const deps = depsFor(depsArg);
  const candidates = [];
  const configured = String(settings?.potluckPath || '').trim();
  if (configured) candidates.push(configured);
  candidates.push(deps.path.resolve(deps.appPath, '..', 'potluck'));
  candidates.push(deps.path.join(deps.os.homedir(), 'potluck'));
  for (const candidate of candidates) {
    try {
      if (deps.fs.existsSync(deps.path.join(candidate, 'scripts', 'potluck'))) return candidate;
    } catch (_) {}
  }
  return null;
}

// The auto-pair guard. We only take over sync configuration when the user has
// not explicitly configured it themselves:
// - autoPairPotluck === false opts out entirely;
// - client mode with a hub URL is a deliberate manual setup;
// - host mode with a secret we did not set (potluckAutoPaired !== true) is a
//   user-managed secret and is never clobbered.
// Everything else (fresh 'local' installs, our own previous auto-pairing, an
// empty client config) is safe to auto-manage.
function manualSyncConfigured(settings) {
  if (settings?.autoPairPotluck === false) return true;
  const mode = settings?.hubMode || 'local';
  if (mode === 'client' && String(settings?.hubUrl || '').trim()) return true;
  if (mode === 'host' && String(settings?.hubHostSecret || '') && settings?.potluckAutoPaired !== true) return true;
  return false;
}

// Adopt the gateway's pairing secret as the embedded hub's host secret so the
// hub comes up requiring exactly the Bearer token Potluck pushes with.
// Mutates `settings` and persists via deps.persist when anything changed.
function ensureAutoPaired(settings, depsArg) {
  const deps = depsFor(depsArg);
  if (settings?.autoPairPotluck === false) return { changed: false, reason: 'disabled' };
  const mode = settings?.hubMode || 'local';
  if (mode === 'client' && String(settings?.hubUrl || '').trim()) return { changed: false, reason: 'client-configured' };
  const secret = readPairingSecret(settings, deps);
  if (!secret) return { changed: false, reason: 'no-secret' };
  const currentSecret = String(settings?.hubHostSecret || '');
  if (mode === 'host' && currentSecret && currentSecret !== secret && settings?.potluckAutoPaired !== true) {
    return { changed: false, reason: 'user-secret' };
  }
  let changed = false;
  if (mode !== 'host') { settings.hubMode = 'host'; changed = true; }
  if (normalizePort(settings?.hubHostPort) !== HUB_PORT) { settings.hubHostPort = HUB_PORT; changed = true; }
  if (currentSecret !== secret) { settings.hubHostSecret = secret; changed = true; }
  if (settings?.potluckAutoPaired !== true) { settings.potluckAutoPaired = true; changed = true; }
  if (changed && typeof deps.persist === 'function') deps.persist();
  return { changed, reason: changed ? 'paired' : 'already' };
}

function resolveNode(settings, depsArg) {
  const deps = depsFor(depsArg);
  const configured = String(settings?.nodePath || '').trim();
  if (configured) return { command: configured, env: {} };
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const found = String(deps.childProcess.execFileSync(which, ['node'], { encoding: 'utf8' }) || '')
      .split('\n')[0].trim();
    if (found) return { command: found, env: {} };
  } catch (_) {}
  // Last resort: reuse the Electron binary as plain Node.
  return { command: deps.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

// Spawn `node <potluckPath>/scripts/potluck <port>` with output mirrored to
// <potluckDataDir>/logs/potluck-supervised.log, then poll /api/health for up
// to 60s. Only ever called when discovery found nothing, so the spawned child
// is ours to supervise (and to stop on quit).
async function spawnGateway(settings, depsArg) {
  const deps = depsFor(depsArg);
  const potluckPath = resolvePotluckPath(settings, deps);
  if (!potluckPath) throw new Error('Potluck checkout not found; set potluckPath in settings');
  const port = normalizePort(settings?.potluckPort, 21023);
  const script = deps.path.join(potluckPath, 'scripts', 'potluck');
  const logsDir = deps.path.join(potluckDataDir(settings, deps), 'logs');
  deps.fs.mkdirSync(logsDir, { recursive: true });
  const logFd = deps.fs.openSync(deps.path.join(logsDir, 'potluck-supervised.log'), 'a');
  const node = resolveNode(settings, deps);
  let child;
  try {
    child = deps.childProcess.spawn(node.command, [script, String(port)], {
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: { ...deps.env, ...node.env }
    });
  } finally {
    try { deps.fs.closeSync(logFd); } catch (_) {}
  }
  state.child = child;
  state.supervised = true;
  state.pid = child.pid ?? null;
  state.potluckPath = potluckPath;
  state.status = 'spawning';
  state.port = port;
  state.error = null;
  log(deps, `spawned gateway (pid ${child.pid}) on port ${port} from ${potluckPath}`);
  child.on('exit', (code, signal) => {
    if (state.child !== child) return;
    state.child = null;
    state.pid = null;
    if (state.status !== 'stopped') {
      state.status = 'failed';
      state.error = `gateway exited (code ${code}, signal ${signal})`;
    }
  });
  child.on('error', (error) => {
    if (state.child !== child) return;
    state.child = null;
    state.pid = null;
    state.status = 'failed';
    state.error = error?.message || String(error);
  });
  const deadline = Date.now() + SPAWN_HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!state.child) break; // exited before becoming healthy
    if (await probePotluck(port, PROBE_TIMEOUT_MS, deps)) {
      state.status = 'running';
      log(deps, `gateway healthy on port ${port}`);
      return { pid: state.pid, port };
    }
    await deps.sleep(SPAWN_HEALTH_POLL_MS);
  }
  const reason = state.error || `no /api/health response on port ${port} within ${SPAWN_HEALTH_TIMEOUT_MS / 1000}s`;
  stopGateway();
  state.status = 'failed';
  state.error = reason;
  throw new Error(`Potluck gateway failed to start: ${reason}`);
}

// Only ever stops a child we spawned; a discovered external instance is never
// killed.
function stopGateway() {
  const child = state.child;
  if (!child) return false;
  state.status = 'stopped';
  state.child = null;
  state.pid = null;
  try { child.kill('SIGTERM'); } catch (_) {}
  return true;
}

function adoptDiscovered(port, settings, depsArg) {
  const deps = depsFor(depsArg);
  state.status = 'running';
  state.port = port;
  state.pid = null;
  state.supervised = false;
  state.child = null;
  state.error = null;
  state.potluckPath = resolvePotluckPath(settings, deps);
  log(deps, `adopted external gateway on port ${port}`);
}

// Runs the async half of init/rediscover: adopt a live gateway if one answers,
// otherwise spawn one when auto-start is enabled and a checkout is resolvable.
// After a successful spawn the gateway may have just provisioned its pairing
// secret, so pairing is retried and the host hub restarted via
// deps.onSettingsChanged when the secret changed under it.
async function reconcile(deps, { notifyOnPair }) {
  const settings = deps.settings;
  state.error = null;
  try {
    const port = await discoverPotluck(settings, deps);
    if (port) {
      adoptDiscovered(port, settings, deps);
    } else if (settings.potluckAutoStart !== false && resolvePotluckPath(settings, deps)) {
      await spawnGateway(settings, deps);
      const repair = ensureAutoPaired(settings, deps);
      if (repair.changed && notifyOnPair) deps.onSettingsChanged?.();
    } else {
      state.status = 'stopped';
    }
  } catch (error) {
    state.status = 'failed';
    state.error = error?.message || String(error);
    try { deps.logger?.warn?.(`[potluck] ${state.error}`); } catch (_) {}
  }
  return getState();
}

// Entry point called once from app ready. The pairing half runs SYNCHRONOUSLY
// before this returns so the caller can start the embedded hub immediately
// afterwards with the auto-paired secret already in settings; gateway
// discovery/spawn continues in the background on state.ready.
function init(depsArg = {}) {
  moduleDeps = { ...realDeps(), ...depsArg };
  const settings = moduleDeps.settings;
  const paired = settings ? ensureAutoPaired(settings, moduleDeps) : { changed: false, reason: 'no-settings' };
  if (paired.changed) log(moduleDeps, `auto-paired hub secret with ${pairingSecretPath(settings, moduleDeps)}`);
  state.ready = reconcile(moduleDeps, { notifyOnPair: true });
  return { paired, ready: state.ready };
}

// Manual "re-detect / reconnect" from the settings UI.
async function rediscover() {
  const deps = depsFor();
  const pair = ensureAutoPaired(deps.settings, deps);
  if (pair.changed) deps.onSettingsChanged?.();
  return reconcile(deps, { notifyOnPair: true });
}

// Keep-on-quit toggle: default (false) stops a supervised child; with
// keepGatewayRunningOnQuit the child outlives us and the next launch's
// discovery adopts it again by port probe. External instances are never
// stopped either way.
function onAppQuit(settings) {
  if (settings?.keepGatewayRunningOnQuit === true) return false;
  return stopGateway();
}

function getState(settingsArg) {
  const settings = settingsArg || moduleDeps?.settings || null;
  return {
    status: state.status,
    running: state.status === 'running',
    port: state.port,
    pid: state.pid,
    supervised: state.supervised,
    potluckPath: state.potluckPath,
    autoPaired: Boolean(settings?.potluckAutoPaired),
    error: state.error
  };
}

function __resetForTests() {
  if (state.child) { try { state.child.kill('SIGKILL'); } catch (_) {} }
  state.status = 'idle';
  state.port = null;
  state.pid = null;
  state.supervised = false;
  state.child = null;
  state.potluckPath = null;
  state.error = null;
  moduleDeps = null;
}

module.exports = {
  HUB_PORT,
  DISCOVERY_PORTS,
  candidatePorts,
  probePotluck,
  discoverPotluck,
  potluckDataDir,
  pairingSecretPath,
  readPairingSecret,
  resolvePotluckPath,
  manualSyncConfigured,
  ensureAutoPaired,
  spawnGateway,
  stopGateway,
  init,
  rediscover,
  onAppQuit,
  getState,
  __resetForTests
};
