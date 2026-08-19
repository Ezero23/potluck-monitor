'use strict';

(function exposeLimitProviderSummary(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorLimitProviderSummary = api;
})(typeof window !== 'undefined' ? window : null, function createLimitProviderSummaryApi() {
  const ERROR_STATUSES = new Set(['error', 'unavailable', 'rateLimited', 'sourceRateLimited']);
  const MISSING_STATUSES = new Set(['notConfigured', 'noSyncedData', 'notChecked']);

  function providerId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function emptySources() {
    return { potluck: 0, monitor: 0, external: 0 };
  }

  function connectionsByProvider(providers) {
    const byId = new Map();
    for (const provider of providers || []) {
      const id = providerId(provider?.provider);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(provider);
    }
    return byId;
  }

  function sourceBucket(row) {
    const managed = String(row?.managedBy || '').trim().toLowerCase();
    if (managed === 'potluck') return 'potluck';
    if (managed === 'external') return 'external';
    return 'monitor';
  }

  function statusTokens(row) {
    return {
      connection: String(row?.connectionStatus || '').trim(),
      quota: String(row?.quotaStatus || '').trim(),
      legacy: String(row?.status || '').trim()
    };
  }

  function hasAnyStatus(tokens, expected) {
    return tokens.connection === expected || tokens.quota === expected || tokens.legacy === expected;
  }

  function classifyConnection(row) {
    if (!row || typeof row !== 'object') return 'missing';
    const tokens = statusTokens(row);
    if (hasAnyStatus(tokens, 'disabled')) return 'disabled';
    if (hasAnyStatus(tokens, 'unauthorized')) return 'unauthorized';
    if ([tokens.connection, tokens.quota, tokens.legacy].some((value) => ERROR_STATUSES.has(value))) {
      return 'error';
    }
    if (row.stale === true || tokens.quota === 'stale' || tokens.legacy === 'stale') return 'stale';
    if (MISSING_STATUSES.has(tokens.connection) || MISSING_STATUSES.has(tokens.legacy)) return 'missing';
    if (tokens.connection === 'ok' || tokens.legacy === 'ok' || tokens.quota === 'fresh' || tokens.quota === 'unsupported') {
      return 'healthy';
    }
    if (!tokens.connection && !tokens.legacy && !tokens.quota) return 'healthy';
    return 'error';
  }

  function poolCount(connections) {
    const keys = new Set();
    let unkeyed = 0;
    for (const row of connections) {
      const key = String(row?.quotaPoolKey || '').trim();
      if (key) keys.add(key);
      else unkeyed += 1;
    }
    return keys.size + unkeyed;
  }

  function headlineForCounts({ unauthorized, needsAttention, stale, healthy, disabled, missing, connections }) {
    if (unauthorized > 0) return 'unauthorized';
    if (needsAttention > 0) return 'error';
    if (stale > 0) return 'stale';
    if (healthy > 0 && (disabled > 0 || missing > 0)) return 'partial';
    if (healthy > 0) return 'ok';
    if (connections === 0 || missing === connections) return 'missing';
    if (disabled > 0) return 'disabled';
    return 'missing';
  }

  function pickRepresentative(connections, headline, provider, missingStatus) {
    const wanted = {
      unauthorized: 'unauthorized',
      error: 'error',
      stale: 'stale',
      partial: 'healthy',
      ok: 'healthy',
      disabled: 'disabled',
      missing: 'missing'
    }[headline];
    const match = wanted
      ? connections.find((row) => classifyConnection(row) === wanted)
      : null;
    if (match) return match;
    if (connections[0]) return connections[0];
    return {
      provider,
      ...(missingStatus ? { status: missingStatus } : {}),
      windows: []
    };
  }

  function summarizeLimitProvider(provider, connections = [], options = {}) {
    const id = providerId(typeof provider === 'object' && provider ? provider.provider : provider);
    const rows = (connections || []).filter((row) => providerId(row?.provider) === id);
    const sources = emptySources();
    const counts = {
      unauthorized: 0,
      needsAttention: 0,
      stale: 0,
      healthy: 0,
      disabled: 0,
      missing: 0
    };

    for (const row of rows) {
      sources[sourceBucket(row)] += 1;
      const kind = classifyConnection(row);
      if (kind === 'unauthorized') {
        counts.unauthorized += 1;
        counts.needsAttention += 1;
      } else if (kind === 'error') {
        counts.needsAttention += 1;
      } else if (kind === 'stale') {
        counts.stale += 1;
      } else if (kind === 'healthy') {
        counts.healthy += 1;
      } else if (kind === 'disabled') {
        counts.disabled += 1;
      } else {
        counts.missing += 1;
      }
    }

    const headline = headlineForCounts({
      ...counts,
      connections: rows.length
    });

    return {
      provider: id,
      connections: rows.length,
      pools: poolCount(rows),
      healthy: counts.healthy,
      needsAttention: counts.needsAttention,
      stale: counts.stale,
      disabled: counts.disabled,
      sources,
      headline,
      representative: pickRepresentative(rows, headline, id, options.missingStatus)
    };
  }

  function summarizeLimitProviders(providers, options = {}) {
    const byId = connectionsByProvider(providers);
    const summaries = new Map();
    for (const [id, rows] of byId) {
      summaries.set(id, summarizeLimitProvider(id, rows, options));
    }
    return summaries;
  }

  return {
    classifyConnection,
    connectionsByProvider,
    sourceBucket,
    summarizeLimitProvider,
    summarizeLimitProviders
  };
});
