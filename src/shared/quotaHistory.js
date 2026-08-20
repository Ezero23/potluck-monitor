'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { sharedDataDir, writeJsonAtomic } = require('./config');

const ARCHIVE_VERSION = 1;
const RAW_RETAIN_DAYS = 14;
const HOURLY_RETAIN_DAYS = 90;
const CYCLE_RETAIN_DAYS = 370;
const MAX_BYTES = 25 * 1024 * 1024;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ANNOTATION_NOTE_MAX = 500;

const SAMPLE_KINDS = new Set(['sample', 'failure', 'reset']);
const FAILURE_CONNECTION = new Set(['error', 'unauthorized']);
const FAILURE_QUOTA = new Set(['unavailable']);

function emptyArchive() {
  return {
    version: ARCHIVE_VERSION,
    updatedAt: null,
    series: {},
    annotations: {}
  };
}

function quotaHistoryPath(options = {}) {
  return options.path || path.join(sharedDataDir(options), 'quota-history.json');
}

function nowMs(options = {}) {
  if (typeof options.now === 'function') return epochMs(options.now());
  if (options.now != null) return epochMs(options.now);
  return Date.now();
}

function epochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function normalizeIso(value) {
  if (value == null || value === '') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function hourBucketUtc(value) {
  const iso = typeof value === 'number' ? toIso(value) : normalizeIso(value);
  if (!iso) return null;
  return `${iso.slice(0, 13)}:00:00.000Z`;
}

function windowHistoryKey(window = {}) {
  const explicit = String(window.windowKey || window.window_key || '').trim();
  if (explicit) return explicit;
  const kind = String(window.kind || '').trim() || 'window';
  const label = String(window.label || '').trim();
  if (label && label !== kind) return `${kind}:${label}`;
  return kind;
}

function quotaHistorySeriesKey(input = {}) {
  const windowKey = String(input.windowKey || '').trim() || 'window';
  const pool = String(input.quotaPoolKey || '').trim();
  if (pool) return `pool:${pool}:${windowKey}`;
  const connection = String(input.connectionKey || '').trim() || 'unknown';
  return `conn:${connection}:${windowKey}`;
}

function compactPoint(sample) {
  return {
    at: sample.at,
    used: numberOrNull(sample.used),
    remaining: numberOrNull(sample.remaining),
    usedPercent: numberOrNull(sample.usedPercent)
  };
}

function persistableSample(sample) {
  const kind = SAMPLE_KINDS.has(sample.kind) ? sample.kind : 'sample';
  const out = {
    at: sample.at,
    kind,
    used: numberOrNull(sample.used),
    limit: numberOrNull(sample.limit),
    remaining: numberOrNull(sample.remaining),
    usedPercent: numberOrNull(sample.usedPercent),
    remainingPercent: numberOrNull(sample.remainingPercent)
  };
  const resetsAt = normalizeIso(sample.resetsAt);
  const windowStartedAt = normalizeIso(sample.windowStartedAt);
  const status = String(sample.status || '').trim();
  const quotaStatus = String(sample.quotaStatus || '').trim();
  const connectionStatus = String(sample.connectionStatus || '').trim();
  if (resetsAt) out.resetsAt = resetsAt;
  if (windowStartedAt) out.windowStartedAt = windowStartedAt;
  if (status) out.status = status;
  if (quotaStatus) out.quotaStatus = quotaStatus;
  if (connectionStatus) out.connectionStatus = connectionStatus;
  return out;
}

function sampleFingerprint(sample, { includeKind = true } = {}) {
  return JSON.stringify([
    includeKind ? sample.kind : null,
    sample.used,
    sample.limit,
    sample.remaining,
    sample.usedPercent,
    sample.remainingPercent,
    sample.resetsAt || null,
    sample.windowStartedAt || null,
    sample.status || null,
    sample.quotaStatus || null,
    sample.connectionStatus || null
  ]);
}

function latestSample(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.reduce((latest, sample) => (sample.at > latest.at ? sample : latest));
}

function isQuotaResetEvent(previous, incoming) {
  if (!incoming) return false;
  if (incoming.kind === 'reset' || incoming.resetEvent === true || incoming.event === 'reset') return true;
  if (!previous) return false;
  const prevReset = normalizeIso(previous.resetsAt);
  const nextReset = normalizeIso(incoming.resetsAt);
  return Boolean(prevReset && nextReset && prevReset !== nextReset);
}

function sampleExhausted(sample) {
  if (numberOrNull(sample.remaining) === 0) return true;
  if (numberOrNull(sample.remainingPercent) === 0) return true;
  const usedPercent = numberOrNull(sample.usedPercent);
  if (usedPercent != null && usedPercent >= 100) return true;
  return String(sample.quotaStatus || '') === 'exhausted';
}

function isFailureStatus(connectionStatus, quotaStatus) {
  return FAILURE_CONNECTION.has(String(connectionStatus || ''))
    || FAILURE_QUOTA.has(String(quotaStatus || ''));
}

function hasMeter(window) {
  return numberOrNull(window?.used) != null
    || numberOrNull(window?.limit) != null
    || numberOrNull(window?.remaining) != null
    || numberOrNull(window?.usedPercent) != null;
}

function limitsFrom(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.limits && typeof record.limits === 'object') return record.limits;
  if (Array.isArray(record.providers)) return record;
  return null;
}

function normalizeAnnotation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const note = String(value.note || value.notes || '').slice(0, ANNOTATION_NOTE_MAX).trim();
  const next = {};
  if (value.muted === true) next.muted = true;
  if (value.expected === true) next.expected = true;
  if (note) next.note = note;
  return Object.keys(next).length > 0 ? next : null;
}

function normalizeHourly(value) {
  const hour = hourBucketUtc(value?.hour);
  if (!hour) return null;
  const first = compactPoint({ ...value.first, at: normalizeIso(value.first?.at) || hour });
  const last = compactPoint({ ...value.last, at: normalizeIso(value.last?.at) || first.at });
  if (!first.at || !last.at) return null;
  return {
    hour,
    first,
    last,
    minRemaining: numberOrNull(value.minRemaining),
    maxRemaining: numberOrNull(value.maxRemaining),
    deltaUsed: numberOrNull(value.deltaUsed)
  };
}

function normalizeCycle(value) {
  const startedAt = normalizeIso(value?.startedAt);
  if (!startedAt) return null;
  const endedAt = normalizeIso(value.endedAt);
  const resetsAt = normalizeIso(value.resetsAt);
  const first = compactPoint({ ...value.first, at: normalizeIso(value.first?.at) || startedAt });
  const last = compactPoint({ ...value.last, at: normalizeIso(value.last?.at) || first.at });
  return {
    startedAt,
    ...(endedAt ? { endedAt } : {}),
    ...(resetsAt ? { resetsAt } : {}),
    peakUsed: numberOrNull(value.peakUsed),
    exhausted: value.exhausted === true,
    first,
    last
  };
}

function normalizeSeries(seriesKey, value) {
  if (!value || typeof value !== 'object') return null;
  const windowKey = String(value.windowKey || '').trim() || windowHistoryKey(value);
  const quotaPoolKey = String(value.quotaPoolKey || '').trim();
  const connectionKey = String(value.connectionKey || '').trim();
  const key = String(value.seriesKey || seriesKey || '').trim()
    || quotaHistorySeriesKey({ quotaPoolKey, connectionKey, windowKey });
  const raw = [];
  for (const item of Array.isArray(value.raw) ? value.raw : []) {
    const at = normalizeIso(item?.at);
    if (!at) continue;
    raw.push(persistableSample({ ...item, at }));
  }
  raw.sort((left, right) => left.at.localeCompare(right.at));
  const hourly = [];
  for (const item of Array.isArray(value.hourly) ? value.hourly : []) {
    const bucket = normalizeHourly(item);
    if (bucket) hourly.push(bucket);
  }
  hourly.sort((left, right) => left.hour.localeCompare(right.hour));
  const cycles = [];
  for (const item of Array.isArray(value.cycles) ? value.cycles : []) {
    const cycle = normalizeCycle(item);
    if (cycle) cycles.push(cycle);
  }
  cycles.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return {
    seriesKey: key,
    ...(quotaPoolKey ? { quotaPoolKey } : {}),
    ...(connectionKey ? { connectionKey } : {}),
    windowKey,
    provider: String(value.provider || '').trim(),
    raw,
    hourly,
    cycles
  };
}

function normalizeQuotaHistory(value) {
  const archive = emptyArchive();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return archive;
  archive.updatedAt = normalizeIso(value.updatedAt);
  const source = value.series && typeof value.series === 'object' ? value.series : {};
  for (const [key, rawSeries] of Object.entries(source)) {
    const series = normalizeSeries(key, rawSeries);
    if (series) archive.series[series.seriesKey] = series;
  }
  const annotations = value.annotations && typeof value.annotations === 'object' ? value.annotations : {};
  for (const [key, raw] of Object.entries(annotations)) {
    const annotation = normalizeAnnotation(raw);
    if (annotation) archive.annotations[key] = annotation;
  }
  return archive;
}

function parseQuotaHistoryDocument(value) {
  if (value == null) return { archive: emptyArchive() };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { corrupt: true, reason: 'invalid_document' };
  }
  if (value.version != null && value.version !== ARCHIVE_VERSION) {
    return { corrupt: true, reason: 'unsupported_version' };
  }
  return { archive: normalizeQuotaHistory({ ...value, version: ARCHIVE_VERSION }) };
}

function serializeQuotaHistory(archive) {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

function serializedBytes(archive) {
  return Buffer.byteLength(serializeQuotaHistory(archive), 'utf8');
}

function createSeries(seriesKey, identity) {
  return {
    seriesKey,
    ...(identity.quotaPoolKey ? { quotaPoolKey: identity.quotaPoolKey } : {}),
    ...(identity.connectionKey ? { connectionKey: identity.connectionKey } : {}),
    windowKey: identity.windowKey || 'window',
    provider: String(identity.provider || '').trim(),
    raw: [],
    hourly: [],
    cycles: []
  };
}

function retentionOptions(options = {}) {
  return {
    rawRetainDays: options.rawRetainDays ?? RAW_RETAIN_DAYS,
    hourlyRetainDays: options.hourlyRetainDays ?? HOURLY_RETAIN_DAYS,
    cycleRetainDays: options.cycleRetainDays ?? CYCLE_RETAIN_DAYS,
    maxBytes: options.maxBytes ?? MAX_BYTES
  };
}

function gcEmptySeries(archive) {
  for (const [key, series] of Object.entries(archive.series)) {
    if (series.raw.length > 0 || series.hourly.length > 0 || series.cycles.length > 0) continue;
    if (archive.annotations[key]) continue;
    delete archive.series[key];
  }
}

function pruneByAge(archive, options = {}) {
  const now = nowMs(options);
  const retain = retentionOptions(options);
  const rawCut = now - retain.rawRetainDays * MS_PER_DAY;
  const hourCut = now - retain.hourlyRetainDays * MS_PER_DAY;
  const cycleCut = now - retain.cycleRetainDays * MS_PER_DAY;
  let changed = false;
  for (const series of Object.values(archive.series)) {
    const rawLen = series.raw.length;
    series.raw = series.raw.filter((sample) => Date.parse(sample.at) >= rawCut);
    const hourLen = series.hourly.length;
    series.hourly = series.hourly.filter((bucket) => Date.parse(bucket.hour) >= hourCut);
    const cycleLen = series.cycles.length;
    series.cycles = series.cycles.filter((cycle) => {
      if (!cycle.endedAt) return true;
      return Date.parse(cycle.endedAt) >= cycleCut;
    });
    if (series.raw.length !== rawLen || series.hourly.length !== hourLen || series.cycles.length !== cycleLen) {
      changed = true;
    }
  }
  const beforeKeys = Object.keys(archive.series).length;
  gcEmptySeries(archive);
  if (Object.keys(archive.series).length !== beforeKeys) changed = true;
  return changed;
}

function collectLayerItems(archive, layer) {
  const items = [];
  for (const [seriesKey, series] of Object.entries(archive.series)) {
    const rows = series[layer];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const open = layer === 'cycles' && !row.endedAt;
      const time = layer === 'raw' ? row.at : layer === 'hourly' ? row.hour : (row.endedAt || row.startedAt);
      items.push({ seriesKey, index, time, open });
    }
  }
  items.sort((left, right) => {
    if (left.open !== right.open) return left.open ? 1 : -1;
    return String(left.time).localeCompare(String(right.time)) || left.seriesKey.localeCompare(right.seriesKey);
  });
  return items;
}

function evictToMaxBytes(archive, options = {}) {
  const maxBytes = retentionOptions(options).maxBytes;
  if (serializedBytes(archive) <= maxBytes) return false;
  let changed = false;
  for (const layer of ['raw', 'hourly', 'cycles']) {
    while (serializedBytes(archive) > maxBytes) {
      const items = collectLayerItems(archive, layer);
      const victim = items.find((item) => !item.open) || items[0];
      if (!victim) break;
      archive.series[victim.seriesKey][layer].splice(victim.index, 1);
      changed = true;
    }
    if (serializedBytes(archive) <= maxBytes) break;
  }
  gcEmptySeries(archive);
  return changed;
}

function upsertRaw(series, incoming) {
  const sameAt = series.raw.findIndex((sample) => sample.at === incoming.at);
  if (sameAt >= 0) {
    if (sampleFingerprint(series.raw[sameAt]) === sampleFingerprint(incoming)) return false;
    series.raw[sameAt] = incoming;
    return true;
  }
  const latest = latestSample(series.raw);
  if (latest && sampleFingerprint(latest, { includeKind: false }) === sampleFingerprint(incoming, { includeKind: false })) {
    return false;
  }
  series.raw.push(incoming);
  series.raw.sort((left, right) => left.at.localeCompare(right.at));
  return true;
}

function applyHourly(series, sample) {
  const hour = hourBucketUtc(sample.at);
  if (!hour) return;
  let bucket = series.hourly.find((row) => row.hour === hour);
  const point = compactPoint(sample);
  const remaining = numberOrNull(sample.remaining);
  if (!bucket) {
    series.hourly.push({
      hour,
      first: point,
      last: point,
      minRemaining: remaining,
      maxRemaining: remaining,
      deltaUsed: 0
    });
    series.hourly.sort((left, right) => left.hour.localeCompare(right.hour));
    bucket = series.hourly.find((row) => row.hour === hour);
  } else {
    if (sample.at < bucket.first.at) bucket.first = point;
    if (sample.at >= bucket.last.at) bucket.last = point;
    if (remaining != null) {
      if (bucket.minRemaining == null || remaining < bucket.minRemaining) bucket.minRemaining = remaining;
      if (bucket.maxRemaining == null || remaining > bucket.maxRemaining) bucket.maxRemaining = remaining;
    }
  }
  const firstUsed = numberOrNull(bucket.first.used);
  const lastUsed = numberOrNull(bucket.last.used);
  bucket.deltaUsed = firstUsed != null && lastUsed != null ? lastUsed - firstUsed : null;
}

function startCycle(sample) {
  const resetsAt = normalizeIso(sample.resetsAt);
  return {
    startedAt: sample.at,
    ...(resetsAt ? { resetsAt } : {}),
    peakUsed: numberOrNull(sample.used),
    exhausted: sampleExhausted(sample),
    first: compactPoint(sample),
    last: compactPoint(sample)
  };
}

function updateCycle(cycle, sample) {
  if (sample.at < cycle.first.at) cycle.first = compactPoint(sample);
  if (sample.at >= cycle.last.at) cycle.last = compactPoint(sample);
  const used = numberOrNull(sample.used);
  if (used != null && (cycle.peakUsed == null || used > cycle.peakUsed)) cycle.peakUsed = used;
  if (sampleExhausted(sample)) cycle.exhausted = true;
  if (!cycle.resetsAt) {
    const resetsAt = normalizeIso(sample.resetsAt);
    if (resetsAt) cycle.resetsAt = resetsAt;
  }
}

function rebuildRecentCycles(series) {
  const raw = series.raw;
  const frozen = [];
  if (raw.length === 0) {
    series.cycles = series.cycles.filter((cycle) => cycle.endedAt);
    return;
  }
  const rawStart = raw[0].at;
  for (const cycle of series.cycles) {
    if (cycle.endedAt && cycle.endedAt < rawStart) frozen.push(cycle);
  }
  const rebuilt = [];
  let current = null;
  let previous = null;
  for (const sample of raw) {
    if (previous && isQuotaResetEvent(previous, sample) && current) {
      current.endedAt = sample.at;
      current.last = compactPoint(previous);
      rebuilt.push(current);
      current = startCycle(sample);
    } else if (!current) {
      current = startCycle(sample);
    } else {
      updateCycle(current, sample);
    }
    previous = sample;
  }
  if (current) rebuilt.push(current);
  series.cycles = [...frozen, ...rebuilt];
}

function ingestSample(archive, item) {
  const identity = item.series;
  const seriesKey = quotaHistorySeriesKey(identity);
  const series = archive.series[seriesKey] || createSeries(seriesKey, identity);
  archive.series[seriesKey] = series;
  const incoming = persistableSample(item.sample);
  if (item.sample.resetEvent === true || item.sample.kind === 'reset') incoming.kind = 'reset';
  if (!upsertRaw(series, incoming)) return false;
  const stored = series.raw.find((sample) => sample.at === incoming.at) || incoming;
  const index = series.raw.indexOf(stored);
  const previous = index > 0 ? series.raw[index - 1] : null;
  if (isQuotaResetEvent(previous, { ...stored, resetEvent: item.sample.resetEvent }) && stored.kind !== 'failure') {
    stored.kind = 'reset';
  }
  applyHourly(series, stored);
  rebuildRecentCycles(series);
  return true;
}

function samplesFromLimits(limits, options = {}) {
  const providers = Array.isArray(limits?.providers) ? limits.providers : [];
  const fallbackAt = normalizeIso(limits?.updatedAt || limits?.generatedAt) || toIso(nowMs(options));
  const samples = [];
  for (const provider of providers) {
    if (!provider || typeof provider !== 'object') continue;
    const quotaPoolKey = String(provider.quotaPoolKey || '').trim();
    const connectionKey = String(provider.connectionKey || '').trim();
    const connectionStatus = String(provider.connectionStatus || '').trim();
    const quotaStatus = String(provider.quotaStatus || '').trim();
    const status = String(provider.status || connectionStatus || '').trim();
    const atSuccess = normalizeIso(provider.lastSuccessAt || provider.updatedAt) || fallbackAt;
    const atAttempt = normalizeIso(provider.lastAttemptAt || provider.updatedAt) || fallbackAt;
    const windows = Array.isArray(provider.windows) ? provider.windows : [];
    const identityBase = {
      quotaPoolKey,
      connectionKey,
      provider: String(provider.provider || '').trim() || 'unknown'
    };
    if (windows.length === 0) {
      if (!isFailureStatus(connectionStatus, quotaStatus) && status !== 'error') continue;
      samples.push({
        series: { ...identityBase, windowKey: 'connection' },
        sample: {
          at: atAttempt,
          kind: 'failure',
          status,
          quotaStatus,
          connectionStatus
        }
      });
      continue;
    }
    for (const window of windows) {
      if (!window || typeof window !== 'object') continue;
      const failure = !hasMeter(window) && isFailureStatus(connectionStatus, quotaStatus);
      samples.push({
        series: { ...identityBase, windowKey: windowHistoryKey(window) },
        sample: {
          at: failure ? atAttempt : atSuccess,
          kind: failure ? 'failure' : 'sample',
          used: window.used,
          limit: window.limit,
          remaining: window.remaining,
          usedPercent: window.usedPercent,
          remainingPercent: window.remainingPercent,
          resetsAt: window.resetsAt || window.resetAt,
          windowStartedAt: window.windowStartedAt,
          status,
          quotaStatus: window.quotaStatus || quotaStatus,
          connectionStatus,
          resetEvent: window.resetEvent === true || window.event === 'reset'
        }
      });
    }
  }
  return samples;
}

function captureQuotaHistory(existing, record, options = {}) {
  const archive = normalizeQuotaHistory(existing);
  let dirty = false;
  for (const item of samplesFromLimits(limitsFrom(record), options)) {
    if (ingestSample(archive, item)) dirty = true;
  }
  if (pruneByAge(archive, options)) dirty = true;
  if (evictToMaxBytes(archive, options)) dirty = true;
  if (dirty) archive.updatedAt = toIso(nowMs(options));
  return archive;
}

function computeQuotaHistoryStats(archive, extras = {}) {
  const series = Object.values(archive?.series || {});
  const retain = retentionOptions(extras);
  return {
    version: archive?.version || ARCHIVE_VERSION,
    bytes: extras.bytes ?? serializedBytes(archive || emptyArchive()),
    series: series.length,
    rawSamples: series.reduce((sum, row) => sum + row.raw.length, 0),
    hourlyBuckets: series.reduce((sum, row) => sum + row.hourly.length, 0),
    cycles: series.reduce((sum, row) => sum + row.cycles.length, 0),
    annotations: Object.keys(archive?.annotations || {}).length,
    rawRetainDays: retain.rawRetainDays,
    hourlyRetainDays: retain.hourlyRetainDays,
    cycleRetainDays: retain.cycleRetainDays,
    maxBytes: retain.maxBytes,
    corrupt: extras.corrupt === true,
    updatedAt: archive?.updatedAt || null
  };
}

function readQuotaHistoryFile(options = {}) {
  const filePath = quotaHistoryPath(options);
  const readFile = options.readFileSync || fs.readFileSync;
  let content;
  try {
    content = readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { archive: emptyArchive() };
    return { corrupt: true, reason: 'unreadable', error };
  }
  if (!String(content || '').trim()) return { archive: emptyArchive() };
  try {
    return parseQuotaHistoryDocument(JSON.parse(content));
  } catch (error) {
    return { corrupt: true, reason: 'invalid_json', error };
  }
}

function readQuotaHistory(options = {}) {
  const loaded = readQuotaHistoryFile(options);
  if (loaded.corrupt) return emptyArchive();
  return loaded.archive;
}

function writeQuotaHistory(archive, options = {}) {
  const write = options.writeJsonAtomic || writeJsonAtomic;
  write(quotaHistoryPath(options), normalizeQuotaHistory(archive));
}

function clearQuotaHistory(options = {}) {
  const unlink = options.unlinkSync || fs.unlinkSync;
  try {
    unlink(quotaHistoryPath(options));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function quotaHistoryStats(options = {}) {
  const loaded = readQuotaHistoryFile(options);
  if (loaded.corrupt) {
    let bytes;
    try {
      bytes = (options.statSync || fs.statSync)(quotaHistoryPath(options)).size;
    } catch {
      bytes = 0;
    }
    return computeQuotaHistoryStats(emptyArchive(), { ...retentionOptions(options), bytes, corrupt: true });
  }
  return computeQuotaHistoryStats(loaded.archive, {
    ...retentionOptions(options),
    bytes: serializedBytes(loaded.archive)
  });
}

function writeEnabled(options = {}) {
  if (typeof options.writeEnabled === 'function') return options.writeEnabled() !== false;
  return options.writeEnabled !== false;
}

function retainQuotaHistoryFromLimits(record, options = {}) {
  const loaded = readQuotaHistoryFile(options);
  if (loaded.corrupt) {
    return {
      wrote: false,
      corrupt: true,
      reason: loaded.reason,
      stats: quotaHistoryStats(options),
      archive: null
    };
  }
  const next = captureQuotaHistory(loaded.archive, record, options);
  const changed = !isDeepStrictEqual(loaded.archive, next);
  if (writeEnabled(options) && changed) {
    try {
      writeQuotaHistory(next, options);
      return {
        wrote: true,
        corrupt: false,
        stats: computeQuotaHistoryStats(next, { ...retentionOptions(options), bytes: serializedBytes(next) }),
        archive: next
      };
    } catch (error) {
      if (error?.code === 'ENOSPC') {
        return {
          wrote: false,
          corrupt: false,
          error,
          stats: computeQuotaHistoryStats(loaded.archive, {
            ...retentionOptions(options),
            bytes: serializedBytes(loaded.archive)
          }),
          archive: loaded.archive
        };
      }
      throw error;
    }
  }
  return {
    wrote: false,
    corrupt: false,
    stats: computeQuotaHistoryStats(next, { ...retentionOptions(options), bytes: serializedBytes(next) }),
    archive: next
  };
}

function setQuotaHistoryAnnotation(seriesKey, annotation, options = {}) {
  const loaded = readQuotaHistoryFile(options);
  if (loaded.corrupt) return { wrote: false, corrupt: true, reason: loaded.reason };
  const archive = loaded.archive;
  const key = String(seriesKey || '').trim();
  if (!key) return { wrote: false, corrupt: false, archive };
  const nextAnnotation = normalizeAnnotation(annotation);
  if (nextAnnotation) archive.annotations[key] = nextAnnotation;
  else delete archive.annotations[key];
  archive.updatedAt = toIso(nowMs(options));
  if (writeEnabled(options)) writeQuotaHistory(archive, options);
  return { wrote: writeEnabled(options), corrupt: false, archive };
}

module.exports = {
  ARCHIVE_VERSION,
  CYCLE_RETAIN_DAYS,
  HOURLY_RETAIN_DAYS,
  MAX_BYTES,
  RAW_RETAIN_DAYS,
  captureQuotaHistory,
  clearQuotaHistory,
  computeQuotaHistoryStats,
  hourBucketUtc,
  isQuotaResetEvent,
  normalizeQuotaHistory,
  quotaHistoryPath,
  quotaHistorySeriesKey,
  quotaHistoryStats,
  readQuotaHistory,
  retainQuotaHistoryFromLimits,
  setQuotaHistoryAnnotation,
  windowHistoryKey,
  writeQuotaHistory
};
