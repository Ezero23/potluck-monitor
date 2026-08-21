'use strict';

const { normalizeLimitsSummary } = require('./limits');

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_DEPTH = 12;
const MAX_PROVIDERS = 256;
const MAX_WINDOWS = 32;
const MAX_GENERIC_ARRAY = 1024;
const MIN_TIMESTAMP_MS = Date.parse('2000-01-01T00:00:00.000Z');
const MAX_FUTURE_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const UNSAFE_LABEL = /https?:\/\/|authorization\b|bearer\s+[a-z0-9._-]|cookie\s*:/i;

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_KEYS = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'cookie',
  'cookies',
  'cookieheader',
  'authorization',
  'clientsecret',
  'secretaccesskey',
  'oauthcode',
  'providerspecificdata',
  'rawresponse',
  'requestheaders',
  'password',
  'privatekey',
  'sessiontoken',
  'credentials',
  'bearer',
  'token',
  'secret'
]);
const CONTROL_KEYS = new Set([
  'route',
  'routing',
  'switch',
  'action',
  'actions',
  'autopilot',
  'quotaautopilot',
  'selectedmodel',
  'nextmodel',
  'command',
  'commands'
]);
const ENVELOPE_KEYS = new Set([
  'schemaVersion',
  'schema_version',
  'snapshotId',
  'snapshot_id',
  'snapshotType',
  'snapshot_type',
  'sourceInstanceId',
  'source_instance_id',
  'generatedAt',
  'generated_at',
  'updatedAt',
  'refreshMs',
  'capabilities',
  'providers',
  'quotaPools',
  'quota_pools',
  'scope'
]);

function fail(code, safeDetail = '') {
  return {
    ok: false,
    skipped: false,
    error: {
      code,
      category: 'parse',
      safeDetail: String(safeDetail || code).slice(0, 96)
    }
  };
}

function normalizeKeyName(key) {
  return String(key).toLowerCase().replace(/[_-]/g, '');
}

function isExternalManagedLimitsRow(row) {
  return row?.managedBy === 'potluck' || row?.managedBy === 'external';
}

function providerIdentityKey(row) {
  const provider = String(row?.provider || '');
  const identity = String(row?.connectionKey || row?.accountKey || '');
  return identity ? `${provider}:${identity}` : '';
}

function scanValue(value, depth, seen) {
  if (value === null || typeof value === 'boolean' || typeof value === 'undefined') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : 'invalid_payload';
  }
  if (typeof value === 'string') {
    return CONTROL_CHARS.test(value) ? 'control_character' : null;
  }
  if (typeof value !== 'object') return 'invalid_payload';
  if (seen.has(value)) return 'invalid_payload';
  seen.add(value);
  if (depth > MAX_DEPTH) return 'too_deep';

  if (Array.isArray(value)) {
    if (value.length > MAX_GENERIC_ARRAY) return 'too_many_providers';
    for (const entry of value) {
      const nested = scanValue(entry, depth + 1, seen);
      if (nested) return nested;
    }
    return null;
  }

  for (const key of Object.keys(value)) {
    if (POLLUTION_KEYS.has(key)) return 'prototype_pollution';
    const normalized = normalizeKeyName(key);
    if (FORBIDDEN_KEYS.has(normalized)) return 'forbidden_field';
    if (CONTROL_KEYS.has(normalized)) return 'control_field';
    const nested = scanValue(value[key], depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}

function payloadSize(input) {
  try {
    return JSON.stringify(input).length;
  } catch {
    return Infinity;
  }
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampInRange(value) {
  if (value === undefined || value === null || value === '') return true;
  const ms = timestampMs(value);
  if (!ms) return false;
  if (ms < MIN_TIMESTAMP_MS) return false;
  if (ms > Date.now() + MAX_FUTURE_MS) return false;
  return true;
}

function labelUnsafe(value) {
  const text = String(value || '');
  return Boolean(text) && UNSAFE_LABEL.test(text);
}

function validateProviderShape(providers) {
  if (providers === undefined) return null;
  if (!Array.isArray(providers)) return 'invalid_payload';
  if (providers.length > MAX_PROVIDERS) return 'too_many_providers';
  for (const row of providers) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 'invalid_payload';
    if (Array.isArray(row.windows) && row.windows.length > MAX_WINDOWS) return 'too_many_providers';
    if (labelUnsafe(row.accountLabel) || labelUnsafe(row.planLabel) || labelUnsafe(row.accountName)) {
      return 'unsafe_label';
    }
    if (!timestampInRange(row.updatedAt) || !timestampInRange(row.lastAttemptAt) || !timestampInRange(row.lastSuccessAt)) {
      return 'invalid_timestamp';
    }
  }
  return null;
}

function pickEnvelope(input) {
  const picked = {};
  for (const key of Object.keys(input)) {
    if (ENVELOPE_KEYS.has(key)) picked[key] = input[key];
  }
  return picked;
}

function stampExternalProvider(row) {
  if (!row || typeof row !== 'object') return row;
  const stamped = { ...row, managedBy: 'potluck' };
  if (!stamped.accountKey && stamped.connectionKey) stamped.accountKey = stamped.connectionKey;
  return stamped;
}

function adaptExternalLimitSnapshot(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('invalid_payload');
  }
  if (payloadSize(input) > MAX_PAYLOAD_BYTES) return fail('payload_too_large');
  const scanned = scanValue(input, 0, new WeakSet());
  if (scanned) return fail(scanned);

  const version = Number(input.schemaVersion ?? input.schema_version);
  if (version !== 1 && version !== 2) return fail('unknown_version');

  const shapeError = validateProviderShape(input.providers);
  if (shapeError) return fail(shapeError);
  if (!timestampInRange(input.generatedAt ?? input.generated_at ?? input.updatedAt)) {
    return fail('invalid_timestamp');
  }

  const picked = pickEnvelope(input);
  const requestedType = String(picked.snapshotType ?? picked.snapshot_type ?? '').trim().toLowerCase();
  if (requestedType && requestedType !== 'full' && requestedType !== 'partial') {
    return fail('invalid_payload');
  }
  if (requestedType === 'partial') {
    const scope = picked.scope;
    const hasScope = Boolean(
      scope
      && typeof scope === 'object'
      && (
        (Array.isArray(scope.connectionKeys) && scope.connectionKeys.length > 0)
        || (Array.isArray(scope.connection_keys) && scope.connection_keys.length > 0)
        || (Array.isArray(scope.providers) && scope.providers.length > 0)
      )
    );
    if (!hasScope) return fail('invalid_partial');
  }

  const stamped = {
    ...picked,
    providers: Array.isArray(picked.providers) ? picked.providers.map(stampExternalProvider) : []
  };
  const summary = normalizeLimitsSummary(stamped);
  if (!summary.sourceInstanceId) return fail('missing_identity');
  if (!summary.snapshotId) return fail('missing_identity');
  summary.providers = summary.providers.map((row) => ({ ...row, managedBy: 'potluck' }));
  return { ok: true, skipped: false, summary };
}

function cloneApplied(applied) {
  const next = Object.create(null);
  for (const [sourceId, entry] of Object.entries(applied || {})) {
    next[sourceId] = {
      snapshotId: entry.snapshotId,
      generatedAt: entry.generatedAt,
      keys: Array.isArray(entry.keys) ? [...entry.keys] : []
    };
  }
  return next;
}

function rowsForSource(providers, keys) {
  const live = new Set(keys || []);
  return providers.filter((row) => isExternalManagedLimitsRow(row) && live.has(providerIdentityKey(row)));
}

function inPartialScope(row, scope) {
  if (!scope) return false;
  const connectionKeys = new Set(scope.connectionKeys || []);
  const providers = new Set(scope.providers || []);
  if (connectionKeys.size > 0 && (connectionKeys.has(row.connectionKey) || connectionKeys.has(row.accountKey))) {
    return true;
  }
  if (providers.size > 0 && providers.has(row.provider)) return true;
  return false;
}

function mergeExternalLimitSnapshot(previous, incoming) {
  const prevProviders = Array.isArray(previous?.providers) ? previous.providers : [];
  const localRows = prevProviders.filter((row) => !isExternalManagedLimitsRow(row));
  const localKeys = new Set(localRows.map(providerIdentityKey).filter(Boolean));
  const incomingRows = incoming.providers.filter((row) => {
    const key = providerIdentityKey(row);
    return !key || !localKeys.has(key);
  });

  return { localRows, incomingRows };
}

function applyExternalLimitSnapshot(previous, input, appliedState = {}) {
  const adapted = adaptExternalLimitSnapshot(input);
  if (!adapted.ok) return adapted;

  const summary = adapted.summary;
  const sourceId = summary.sourceInstanceId;
  const generatedAt = timestampMs(summary.generatedAt || summary.updatedAt);
  const previousApplied = appliedState[sourceId];
  if (previousApplied && previousApplied.snapshotId === summary.snapshotId) {
    return { ok: true, skipped: true, reason: 'duplicate', summary: previous, applied: appliedState };
  }
  if (previousApplied && generatedAt && previousApplied.generatedAt && generatedAt < previousApplied.generatedAt) {
    return { ok: true, skipped: true, reason: 'out_of_order', summary: previous, applied: appliedState };
  }

  const prevProviders = Array.isArray(previous?.providers) ? previous.providers : [];
  const { localRows, incomingRows } = mergeExternalLimitSnapshot(previous, summary);
  const prevKeys = previousApplied?.keys || [];
  const prevKeySet = new Set(prevKeys);
  const otherExternal = prevProviders.filter((row) => {
    if (!isExternalManagedLimitsRow(row)) return false;
    return !prevKeySet.has(providerIdentityKey(row));
  });
  const sameSourceRows = rowsForSource(prevProviders, prevKeys);

  let nextSourceRows;
  if (summary.snapshotType === 'partial') {
    const byKey = new Map();
    for (const row of sameSourceRows) {
      const key = providerIdentityKey(row);
      if (key) byKey.set(key, row);
    }
    for (const row of incomingRows) {
      if (!inPartialScope(row, summary.scope)) continue;
      const key = providerIdentityKey(row) || `${row.provider}:${byKey.size}`;
      const previousRow = byKey.get(key);
      const merged = { ...row };
      if (!merged.lastSuccessAt && previousRow?.lastSuccessAt) merged.lastSuccessAt = previousRow.lastSuccessAt;
      byKey.set(key, merged);
    }
    nextSourceRows = Array.from(byKey.values());
  } else {
    nextSourceRows = incomingRows.map((row) => {
      const previousRow = sameSourceRows.find((entry) => providerIdentityKey(entry) === providerIdentityKey(row));
      if (!previousRow || row.lastSuccessAt) return row;
      return { ...row, lastSuccessAt: previousRow.lastSuccessAt };
    });
  }

  const nextSummary = {
    ...(previous && typeof previous === 'object' ? previous : {}),
    ...summary,
    providers: [...localRows, ...otherExternal, ...nextSourceRows]
  };
  if (previous?.updatedAt && !summary.updatedAt) nextSummary.updatedAt = previous.updatedAt;
  if (previous?.refreshMs && !summary.refreshMs) nextSummary.refreshMs = previous.refreshMs;
  if (summary.snapshotType !== 'full' && previous?.quotaPools && !summary.quotaPools) {
    nextSummary.quotaPools = previous.quotaPools;
  }

  const applied = cloneApplied(appliedState);
  applied[sourceId] = {
    snapshotId: summary.snapshotId,
    generatedAt,
    keys: nextSourceRows.map(providerIdentityKey).filter(Boolean)
  };
  return { ok: true, skipped: false, summary: nextSummary, applied };
}

function preserveExternalLimitsRows(previous, incoming) {
  if (!previous || !Array.isArray(previous.providers) || !Array.isArray(incoming?.providers)) {
    return incoming;
  }
  const localKeys = new Set(incoming.providers.map(providerIdentityKey).filter(Boolean));
  const kept = [];
  for (const row of previous.providers) {
    if (!isExternalManagedLimitsRow(row)) continue;
    const key = providerIdentityKey(row);
    if (key && localKeys.has(key)) continue;
    kept.push(row);
  }
  if (kept.length === 0 && !(previous.quotaPools && !incoming.quotaPools)) return incoming;
  const next = { ...incoming, providers: [...incoming.providers, ...kept] };
  if (previous.quotaPools && !incoming.quotaPools) next.quotaPools = previous.quotaPools;
  return next;
}

module.exports = {
  MAX_PAYLOAD_BYTES,
  adaptExternalLimitSnapshot,
  applyExternalLimitSnapshot,
  isExternalManagedLimitsRow,
  preserveExternalLimitsRows
};
