import { publicLimits } from './shared/limits.js';
import { aggregateDevices, mergeDeviceRecord, aggregateHistory } from './shared/usage.js';
import { historyPreview, historyRevision } from './shared/history.js';
import { applyExternalLimitSnapshot } from './shared/externalLimitSnapshot.js';
import { normalizeMonitorEnvelope } from './shared/monitorEvents.js';

// Ingest parity with the Node hub (src/shared/http.js): bodies are capped at
// 1 MiB. Cloudflare Durable Object storage additionally caps each stored value
// at 128 KiB, so a merged device record beyond that is rejected cleanly instead
// of throwing an opaque storage error on put.
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const DO_VALUE_LIMIT_BYTES = 128 * 1024;
const textEncoder = new TextEncoder();

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-token-monitor-secret'
};

function jsonResponse(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, no-transform', ...CORS_HEADERS, ...extra }
  });
}

function textResponse(status, body, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': contentType, ...CORS_HEADERS } });
}

function requestSecret(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerSecret = String(request.headers.get('x-token-monitor-secret') || '').trim();
  if (headerSecret) return headerSecret;
  try {
    const url = new URL(request.url);
    return String(url.searchParams.get('secret') || '').trim();
  } catch (_) { return ''; }
}

function isAuthorized(request, expectedSecret) {
  if (!expectedSecret) return true;
  return requestSecret(request) === expectedSecret;
}

function sseFormat(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return textResponse(204, '');
    const id = env.HUB.idFromName('hub');
    const stub = env.HUB.get(id);
    return stub.fetch(request);
  }
};

export class HubDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sseClients = new Set();
    this.heartbeatTimer = null;
    this.encoder = new TextEncoder();
  }

  get secret() {
    return String(this.env.TOKEN_MONITOR_SECRET || '').trim();
  }

  get staleAfterMs() {
    return Number(this.env.STALE_AFTER_MS || 10 * 60 * 1000);
  }

  get publicStatsEnabled() {
    return ['1', 'true', 'yes', 'on'].includes(String(this.env.PUBLIC_STATS_ENABLED || '').trim().toLowerCase());
  }

  async listDevices() {
    const entries = await this.state.storage.list({ prefix: 'dev:' });
    return Array.from(entries.values());
  }

  async getStats() {
    const devices = await this.listDevices();
    const stats = aggregateDevices(devices, this.staleAfterMs);
    stats.staleAfterMs = this.staleAfterMs;
    const history = aggregateHistory(devices);
    stats.historyPreview = historyPreview(history);
    stats.historyRevision = historyRevision(history);
    return stats;
  }

  ensureHeartbeat() {
    if (this.heartbeatTimer || this.sseClients.size === 0) return;
    this.heartbeatTimer = setInterval(() => {
      const chunk = this.encoder.encode(': hb\n\n');
      for (const writer of this.sseClients) {
        writer.write(chunk).catch(() => this.dropClient(writer));
      }
      if (this.sseClients.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }, 30000);
  }

  dropClient(writer) {
    this.sseClients.delete(writer);
    try { writer.close(); } catch (_) {}
    if (this.sseClients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async broadcast(reason = 'update') {
    if (this.sseClients.size === 0) return;
    const stats = await this.getStats();
    const payload = this.encoder.encode(sseFormat('stats', {
      type: 'stats', reason, stats, at: new Date().toISOString()
    }));
    for (const writer of this.sseClients) {
      writer.write(payload).catch(() => this.dropClient(writer));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      const devices = await this.listDevices();
      return jsonResponse(200, {
        ok: true,
        role: 'hub',
        runtime: 'cloudflare-worker',
        version: 1,
        deviceCount: devices.length,
        secretRequired: Boolean(this.secret),
        now: new Date().toISOString()
      });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/public/stats') {
      if (!this.publicStatsEnabled) return jsonResponse(404, { error: 'not_found' });
      const stats = await this.getStats();
      const { devices, limits, periods, ...rest } = stats;
      return jsonResponse(200, {
        ok: true,
        source: 'cloudflare-worker',
        deviceCount: devices.length,
        limits: publicLimits(limits),
        periods: publicPeriods(periods),
        ...rest
      }, { 'cache-control': 'public, max-age=15, s-maxage=15' });
    }

    // A Worker is an internet-facing URL with no trusted-LAN fallback, so it must
    // never serve data unauthenticated. Without a secret every data route is refused
    // (health and the opt-in, already-scrubbed /api/public/stats are handled above).
    if (!this.secret) {
      return jsonResponse(503, { error: 'secret_required', message: 'TOKEN_MONITOR_SECRET must be set on the worker; unauthenticated access is refused.' });
    }
    if (!isAuthorized(request, this.secret)) return jsonResponse(401, { error: 'unauthorized' });

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/stats') {
      return jsonResponse(200, await this.getStats());
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/devices') {
      const devices = await this.listDevices();
      return jsonResponse(200, { devices });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/history') {
      const devices = await this.listDevices();
      return jsonResponse(200, aggregateHistory(devices));
    }

    if (request.method === 'GET' && url.pathname === '/api/stats/stream') {
      const stats = await this.getStats();
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      writer.write(this.encoder.encode(sseFormat('snapshot', {
        type: 'stats', reason: 'snapshot', stats, at: new Date().toISOString()
      }))).catch(() => {});
      this.sseClients.add(writer);
      this.ensureHeartbeat();
      request.signal.addEventListener('abort', () => this.dropClient(writer));
      return new Response(readable, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
          ...CORS_HEADERS
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/ingest') {
      // content-length can be absent (chunked), so measure the actual body too.
      const declaredLength = Number(request.headers.get('content-length') || 0);
      if (declaredLength > MAX_JSON_BODY_BYTES) {
        return jsonResponse(413, { error: 'payload_too_large', message: 'Request body too large' });
      }
      const bodyText = await request.text();
      if (textEncoder.encode(bodyText).length > MAX_JSON_BODY_BYTES) {
        return jsonResponse(413, { error: 'payload_too_large', message: 'Request body too large' });
      }
      let payload;
      try { payload = JSON.parse(bodyText); }
      catch (error) { return jsonResponse(400, { error: 'bad_request', message: error.message }); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return jsonResponse(400, { error: 'bad_request', message: 'JSON object body required' });
      }
      if (!payload.deviceId && !payload.id) return jsonResponse(400, { error: 'deviceId_required' });
      const deviceId = String(payload.deviceId || payload.id);
      const existing = await this.state.storage.get(`dev:${deviceId}`);

      // Mirror the Node hub ingest path: normalize the optional monitor
      // envelope, and route Potluck/external limit snapshots through the same
      // adapter so field allowlisting, snapshot idempotency and full/partial
      // replacement semantics hold on the Worker exactly as self-hosted.
      if (Object.prototype.hasOwnProperty.call(payload, 'monitor')) {
        const monitor = normalizeMonitorEnvelope(payload.monitor);
        if (monitor) payload.monitor = monitor;
        else delete payload.monitor;
      }
      const incomingLimits = payload.limits;
      const providerRows = Array.isArray(incomingLimits?.providers) ? incomingLimits.providers : [];
      const sourceInstanceId = String(
        incomingLimits?.sourceInstanceId || incomingLimits?.source_instance_id || ''
      ).trim();
      const isExternalSnapshot = Boolean(
        incomingLimits
        && typeof incomingLimits === 'object'
        && (
          sourceInstanceId.startsWith('potluck:')
          || providerRows.some((row) => row?.managedBy === 'potluck')
        )
      );
      let externalStateKey = null;
      let externalApplied = null;
      if (isExternalSnapshot) {
        externalStateKey = `extsnap:${deviceId}`;
        const appliedState = (await this.state.storage.get(externalStateKey)) || {};
        const adapted = applyExternalLimitSnapshot(existing?.limits, incomingLimits, appliedState);
        if (!adapted.ok) {
          const reason = adapted.error?.code || adapted.reason || 'invalid';
          return jsonResponse(400, { error: 'invalid_limits_snapshot', message: `limits_snapshot_${reason}` });
        }
        if (adapted.skipped) {
          // Idempotent duplicate or out-of-order generatedAt: keep the stored
          // record untouched and answer with the current aggregate.
          return jsonResponse(200, {
            ok: true,
            deviceId,
            skipped: adapted.reason || 'duplicate',
            stats: await this.getStats()
          });
        }
        payload.limits = adapted.summary;
        externalApplied = adapted.applied;
      }

      const record = mergeDeviceRecord(existing, { ...payload, receivedAt: new Date().toISOString() });
      if (textEncoder.encode(JSON.stringify(record)).length > DO_VALUE_LIMIT_BYTES) {
        return jsonResponse(413, {
          error: 'record_too_large',
          message: 'Device record exceeds the Durable Object 128 KiB value limit'
        });
      }
      if (externalStateKey) {
        await this.state.storage.put({ [`dev:${record.deviceId}`]: record, [externalStateKey]: externalApplied });
      } else {
        await this.state.storage.put(`dev:${record.deviceId}`, record);
      }
      this.broadcast('ingest').catch(() => {});
      return jsonResponse(200, { ok: true, deviceId: record.deviceId, stats: await this.getStats() });
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      await this.state.storage.delete(`dev:${deviceId}`);
      this.broadcast('delete').catch(() => {});
      return jsonResponse(200, { ok: true, deviceId });
    }

    return jsonResponse(404, { error: 'not_found' });
  }
}

function publicPeriods(periods) {
  return Object.fromEntries(Object.entries(periods || {}).map(([name, period]) => {
    const safePeriod = { ...(period || {}) };
    delete safePeriod.projects;
    return [name, {
      ...safePeriod,
      sessions: Object.fromEntries(Object.entries(period?.sessions || {}).map(([key, session]) => {
      const { projectId, projectLabel, projectPath, ...safe } = session;
      return [key, safe];
      }))
    }];
  }));
}

export { publicPeriods };
