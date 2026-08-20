'use strict';

const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { aggregateDevices, mergeDeviceRecord, aggregateHistory } = require('../shared/usage');
const { historyPreview, historyRevision } = require('../shared/history');
const { publicLimits } = require('../shared/limits');
const { stripForbidden } = require('../shared/quotaForecast');
const { isAuthorized, readJsonBody, sendJson, sendText } = require('../shared/http');
const { loadDotEnv, parseArgs, projectRoot, readJson, writeJsonAtomic } = require('../shared/config');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const LIMITS_SNAPSHOT_SCHEMA_VERSION = 1;
const LIMITS_SNAPSHOT_SUPPORTED_VERSIONS = [LIMITS_SNAPSHOT_SCHEMA_VERSION];
const LIMITS_SNAPSHOT_RATE_LIMIT_MS = 1000;
const LIMITS_SNAPSHOT_ACCEPT_RE = /application\/vnd\.token-monitor\.limits-snapshot\.v(\d+)\+json/i;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function negotiateLimitsSnapshotVersion(req, url) {
  const accept = String(req.headers.accept || '');
  const acceptMatch = accept.match(LIMITS_SNAPSHOT_ACCEPT_RE);
  if (acceptMatch) return Number(acceptMatch[1]);
  const queryVersion = url.searchParams.get('version') ?? url.searchParams.get('v');
  if (queryVersion != null && String(queryVersion).trim() !== '') return Number(queryVersion);
  return LIMITS_SNAPSHOT_SCHEMA_VERSION;
}

function buildHubLimitsSnapshot(stats, version = LIMITS_SNAPSHOT_SCHEMA_VERSION) {
  const generatedAt = new Date().toISOString();
  const limits = stats?.limits ? publicLimits(stats.limits) : { providers: [] };
  const snapshotId = `hub-${generatedAt}`;
  return stripForbidden({
    schemaVersion: LIMITS_SNAPSHOT_SCHEMA_VERSION,
    negotiatedVersion: version,
    snapshotId,
    generatedAt,
    capabilities: ['limits'],
    staleAfterMs: stats?.staleAfterMs ?? null,
    limits
  });
}

function createRateLimiter(intervalMs = LIMITS_SNAPSHOT_RATE_LIMIT_MS) {
  const lastByKey = new Map();
  return {
    check(key) {
      const now = Date.now();
      const last = lastByKey.get(key) || 0;
      if (now - last < intervalMs) {
        return { allowed: false, retryAfterMs: intervalMs - (now - last) };
      }
      lastByKey.set(key, now);
      return { allowed: true, retryAfterMs: 0 };
    }
  };
}

function snapshotRequestSecret(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-token-monitor-secret'] || '').trim();
}

function rateLimitKey(req, secret) {
  const used = snapshotRequestSecret(req) || secret;
  if (used) return `secret:${used.slice(0, 8)}`;
  const remote = req.socket?.remoteAddress || 'unknown';
  return `ip:${remote}`;
}

// Without a secret the hub cannot tell its own widget from any other caller, so it
// must not expose account identity (email/plan/key) to the network. Binding to
// loopback keeps an unauthenticated hub usable locally while refusing LAN/remote
// reach; set a secret to bind a non-loopback address and accept other devices.
function resolveBindHost(host, secret) {
  const requested = String(host || '').trim() || '0.0.0.0';
  if (secret) return requested;
  return LOOPBACK_HOSTS.has(requested.toLowerCase()) ? requested : '127.0.0.1';
}

function createHub({
  port = 17321,
  host = '0.0.0.0',
  secret = '',
  staleAfterMs = 10 * 60 * 1000,
  dataFile = path.join(projectRoot(), 'data', 'devices.json'),
  limitsSnapshotEnabled = false,
  limitsSnapshotRateLimitMs = LIMITS_SNAPSHOT_RATE_LIMIT_MS,
  logger = console
} = {}) {
  const store = readJson(dataFile, { version: 1, devices: {} }) || { version: 1, devices: {} };
  if (!store.devices || typeof store.devices !== 'object') store.devices = {};
  const bindHost = resolveBindHost(host, secret);
  const limitsSnapshotLimiter = createRateLimiter(limitsSnapshotRateLimitMs);

  function persist() {
    store.version = 1;
    store.savedAt = new Date().toISOString();
    writeJsonAtomic(dataFile, store);
  }

  function getStats() {
    const stats = aggregateDevices(Object.values(store.devices), staleAfterMs);
    stats.staleAfterMs = staleAfterMs;
    const history = aggregateHistory(Object.values(store.devices));
    stats.historyPreview = historyPreview(history);
    stats.historyRevision = historyRevision(history);
    return stats;
  }

  function getHistory() {
    return aggregateHistory(Object.values(store.devices));
  }

  const sseClients = new Set();
  const statsListeners = new Set();

  function sseFormat(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function broadcastStats(reason = 'update') {
    if (sseClients.size === 0 && statsListeners.size === 0) return;
    const stats = getStats();
    const at = new Date().toISOString();
    if (sseClients.size > 0) {
      const payload = sseFormat('stats', { type: 'stats', reason, stats, at });
      for (const res of sseClients) {
        try { res.write(payload); } catch (_) { sseClients.delete(res); }
      }
    }
    for (const listener of statsListeners) {
      try { listener(stats, reason, at); } catch (_) { /* listener errors must not break ingest */ }
    }
  }

  // Transport-agnostic core: both the HTTP POST handler and the same-process
  // widget call these, so a host-mode widget never has to loopback to itself.
  function ingest(payload) {
    if (!payload || (!payload.deviceId && !payload.id)) {
      throw new Error('deviceId_required');
    }
    const record = mergeDeviceRecord(store.devices[String(payload.deviceId || payload.id)], { ...payload, receivedAt: new Date().toISOString() });
    store.devices[record.deviceId] = record;
    persist();
    broadcastStats('ingest');
    return record;
  }

  function deleteDevice(deviceId) {
    delete store.devices[deviceId];
    persist();
    broadcastStats('delete');
  }

  function onStats(listener) {
    statsListeners.add(listener);
    return () => statsListeners.delete(listener);
  }

  async function handleRequest(req, res) {
    if (req.method === 'OPTIONS') return sendText(res, 204, '');
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        role: 'hub',
        version: store.version || 1,
        deviceCount: Object.keys(store.devices).length,
        secretRequired: Boolean(secret),
        limitsSnapshotEnabled: Boolean(limitsSnapshotEnabled),
        now: new Date().toISOString()
      });
    }

    if (!isAuthorized(req, secret)) return sendJson(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/api/limits/snapshot') {
      if (!limitsSnapshotEnabled) return sendJson(res, 404, { error: 'not_found' });
      const requestedVersion = negotiateLimitsSnapshotVersion(req, url);
      if (!Number.isInteger(requestedVersion) || !LIMITS_SNAPSHOT_SUPPORTED_VERSIONS.includes(requestedVersion)) {
        return sendJson(res, 406, {
          error: 'unsupported_version',
          supported: LIMITS_SNAPSHOT_SUPPORTED_VERSIONS
        });
      }
      const limitCheck = limitsSnapshotLimiter.check(rateLimitKey(req, secret));
      if (!limitCheck.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(limitCheck.retryAfterMs / 1000));
        return sendJson(res, 429, { error: 'rate_limited', retryAfterMs: limitCheck.retryAfterMs }, {
          'retry-after': String(retryAfterSec)
        });
      }
      return sendJson(res, 200, buildHubLimitsSnapshot(getStats(), requestedVersion));
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(res, 200, getStats());
    if (req.method === 'GET' && url.pathname === '/api/devices') return sendJson(res, 200, { devices: Object.values(store.devices) });
    if (req.method === 'GET' && url.pathname === '/api/history') return sendJson(res, 200, getHistory());

    if (req.method === 'GET' && url.pathname === '/api/stats/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write(sseFormat('snapshot', { type: 'stats', reason: 'snapshot', stats: getStats(), at: new Date().toISOString() }));
      sseClients.add(res);
      const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 30000);
      const cleanup = () => { clearInterval(heartbeat); sseClients.delete(res); };
      req.on('close', cleanup);
      req.on('error', cleanup);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest') {
      try {
        const payload = await readJsonBody(req);
        const record = ingest(payload);
        return sendJson(res, 200, { ok: true, deviceId: record.deviceId, stats: getStats() });
      } catch (error) {
        if (error.message === 'deviceId_required') return sendJson(res, 400, { error: 'deviceId_required' });
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'bad_request', message: error.message });
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      deleteDevice(deviceId);
      return sendJson(res, 200, { ok: true, deviceId });
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      (logger.error || console.error)(error);
      sendJson(res, 500, { error: 'internal_error', message: error.message });
    });
  });

  function start() {
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.off('listening', onListening); reject(err); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, bindHost);
    });
  }

  function stop() {
    return new Promise((resolve) => {
      for (const res of sseClients) { try { res.end(); } catch (_) {} }
      sseClients.clear();
      server.close(() => resolve());
    });
  }

  return {
    start,
    stop,
    server,
    getStats,
    getHistory,
    ingest,
    deleteDevice,
    onStats,
    bindHost,
    buildLimitsSnapshot: (version = LIMITS_SNAPSHOT_SCHEMA_VERSION) => buildHubLimitsSnapshot(getStats(), version)
  };
}

if (require.main === module) {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || process.env.TOKEN_MONITOR_PORT || 17321);
  const host = String(args.host || process.env.TOKEN_MONITOR_HOST || '0.0.0.0');
  const secret = String(args.secret || process.env.TOKEN_MONITOR_SECRET || '').trim();
  const staleAfterMs = Number(args.staleAfterMs || process.env.TOKEN_MONITOR_STALE_AFTER_MS || 10 * 60 * 1000);
  const dataFile = String(args.dataFile || process.env.TOKEN_MONITOR_DATA_FILE || path.join(projectRoot(), 'data', 'devices.json'));
  const limitsSnapshotEnabled = parseBoolean(
    args.limitsSnapshotEnabled ?? process.env.TOKEN_MONITOR_LIMITS_SNAPSHOT_ENABLED,
    false
  );

  const hub = createHub({ port, host, secret, staleAfterMs, dataFile, limitsSnapshotEnabled });
  hub.start().then(() => {
    console.log(`Token Monitor hub listening on http://${hub.bindHost}:${port}`);
    console.log(`Data file: ${dataFile}`);
    if (!secret) {
      console.warn(`Warning: TOKEN_MONITOR_SECRET is not set, so the hub is bound to ${hub.bindHost} (localhost only) to keep account identity off the network. Set a secret to accept connections from other devices.`);
    }
  }).catch((err) => {
    console.error(`Hub failed to start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  createHub,
  resolveBindHost,
  buildHubLimitsSnapshot,
  LIMITS_SNAPSHOT_SCHEMA_VERSION,
  LIMITS_SNAPSHOT_SUPPORTED_VERSIONS
};
