'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  captureQuotaHistory,
  clearQuotaHistory,
  hourBucketUtc,
  isQuotaResetEvent,
  MAX_BYTES,
  normalizeQuotaHistory,
  quotaHistoryPath,
  quotaHistorySeriesKey,
  quotaHistoryStats,
  retainQuotaHistoryFromLimits,
  setQuotaHistoryAnnotation,
  windowHistoryKey
} = require('../../src/shared/quotaHistory');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quota-history-'));
}

function fileOptions(overrides = {}) {
  const dir = overrides.dir || tmpDir();
  return {
    path: path.join(dir, 'quota-history.json'),
    now: () => '2026-08-19T12:00:00.000Z',
    ...overrides,
    dir
  };
}

function windowFixture(extra = {}) {
  return {
    windowKey: 'session:primary',
    kind: 'session',
    label: 'Session',
    used: 32,
    limit: 100,
    remaining: 68,
    usedPercent: 32,
    remainingPercent: 68,
    resetsAt: '2026-08-19T18:00:00.000Z',
    windowStartedAt: '2026-08-19T06:00:00.000Z',
    ...extra
  };
}

function providerFixture(extra = {}) {
  return {
    provider: 'zai',
    connectionKey: 'potluck:mac:conn-a',
    quotaPoolKey: 'zai-pool-1',
    status: 'ok',
    connectionStatus: 'ok',
    quotaStatus: 'fresh',
    lastSuccessAt: '2026-08-19T12:00:00.000Z',
    lastAttemptAt: '2026-08-19T12:00:00.000Z',
    windows: [windowFixture()],
    ...extra
  };
}

function recordFixture(providers, extra = {}) {
  return {
    deviceId: 'macbook',
    updatedAt: '2026-08-19T12:00:00.000Z',
    limits: {
      schemaVersion: 2,
      updatedAt: '2026-08-19T12:00:00.000Z',
      providers: Array.isArray(providers) ? providers : [providers],
      ...extra
    }
  };
}

function seriesOf(archive) {
  const keys = Object.keys(archive.series);
  assert.equal(keys.length, 1);
  return archive.series[keys[0]];
}

test('quotaHistorySeriesKey prefers quotaPoolKey then connectionKey+windowKey', () => {
  assert.equal(
    quotaHistorySeriesKey({ quotaPoolKey: 'pool-a', connectionKey: 'conn-a', windowKey: 'session' }),
    'pool:pool-a:session'
  );
  assert.equal(
    quotaHistorySeriesKey({ connectionKey: 'conn-a', windowKey: 'week' }),
    'conn:conn-a:week'
  );
});

test('windowHistoryKey uses stamped windowKey then kind:label', () => {
  assert.equal(windowHistoryKey({ windowKey: 'session:primary', kind: 'session' }), 'session:primary');
  assert.equal(windowHistoryKey({ kind: 'week' }), 'week');
  assert.equal(windowHistoryKey({ kind: 'billing', label: 'Token Plan' }), 'billing:Token Plan');
});

test('hourBucketUtc stores UTC hours so DST does not collapse buckets', () => {
  // 2026-03-08 America/New_York springs forward 02:00→03:00.
  assert.equal(hourBucketUtc('2026-03-08T06:30:00.000Z'), '2026-03-08T06:00:00.000Z');
  assert.equal(hourBucketUtc('2026-03-08T07:30:00.000Z'), '2026-03-08T07:00:00.000Z');
});

test('percent-up is not a reset without resetsAt or an explicit event', () => {
  assert.equal(isQuotaResetEvent(
    { usedPercent: 90, resetsAt: '2026-08-19T18:00:00.000Z' },
    { kind: 'sample', usedPercent: 10, resetsAt: '2026-08-19T18:00:00.000Z' }
  ), false);
  assert.equal(isQuotaResetEvent(
    { usedPercent: 90, resetsAt: '2026-08-19T18:00:00.000Z' },
    { kind: 'sample', usedPercent: 4, resetsAt: '2026-08-20T18:00:00.000Z' }
  ), true);
  assert.equal(isQuotaResetEvent(
    { usedPercent: 40, resetsAt: '2026-08-19T18:00:00.000Z' },
    { kind: 'reset', usedPercent: 0, resetsAt: '2026-08-19T18:00:00.000Z' }
  ), true);
});

test('identical snapshots are not written again', () => {
  const options = fileOptions();
  const record = recordFixture(providerFixture());
  const first = retainQuotaHistoryFromLimits(record, options);
  assert.equal(first.wrote, true);
  const second = retainQuotaHistoryFromLimits(record, options);
  assert.equal(second.wrote, false);
  assert.equal(seriesOf(second.archive).raw.length, 1);
});

test('multi-device samples that share a pool key and timestamp dedup', () => {
  const options = fileOptions();
  retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    connectionKey: 'device-one',
    lastSuccessAt: '2026-08-19T12:00:00.000Z'
  })), options);
  const again = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    connectionKey: 'device-two',
    lastSuccessAt: '2026-08-19T12:00:00.000Z'
  })), options);
  assert.equal(again.wrote, false);
  assert.equal(Object.keys(again.archive.series).length, 1);
  assert.equal(seriesOf(again.archive).raw.length, 1);
});

test('out-of-order timestamps sort raw samples and hourly first/last', () => {
  const options = fileOptions();
  retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T12:40:00.000Z',
    windows: [windowFixture({ used: 50, remaining: 50, usedPercent: 50 })]
  })), options);
  const next = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T12:10:00.000Z',
    windows: [windowFixture({ used: 20, remaining: 80, usedPercent: 20 })]
  })), options);
  const series = seriesOf(next.archive);
  assert.deepEqual(series.raw.map((sample) => sample.at), [
    '2026-08-19T12:10:00.000Z',
    '2026-08-19T12:40:00.000Z'
  ]);
  assert.equal(series.hourly.length, 1);
  assert.equal(series.hourly[0].hour, '2026-08-19T12:00:00.000Z');
  assert.equal(series.hourly[0].first.used, 20);
  assert.equal(series.hourly[0].last.used, 50);
  assert.equal(series.hourly[0].minRemaining, 50);
  assert.equal(series.hourly[0].maxRemaining, 80);
  assert.equal(series.hourly[0].deltaUsed, 30);
});

test('resetsAt change closes a cycle; percent-up alone does not', () => {
  const options = fileOptions();
  retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T10:00:00.000Z',
    windows: [windowFixture({
      used: 90, remaining: 10, usedPercent: 90, remainingPercent: 10,
      resetsAt: '2026-08-19T18:00:00.000Z'
    })]
  })), options);
  const fakeReset = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T11:00:00.000Z',
    windows: [windowFixture({
      used: 5, remaining: 95, usedPercent: 5, remainingPercent: 95,
      resetsAt: '2026-08-19T18:00:00.000Z'
    })]
  })), options);
  assert.equal(seriesOf(fakeReset.archive).cycles.length, 1);
  assert.equal(seriesOf(fakeReset.archive).cycles[0].endedAt, undefined);
  assert.equal(seriesOf(fakeReset.archive).raw.at(-1).kind, 'sample');

  const realReset = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T18:00:00.000Z',
    windows: [windowFixture({
      used: 2, remaining: 98, usedPercent: 2, remainingPercent: 98,
      resetsAt: '2026-08-20T18:00:00.000Z'
    })]
  })), options);
  const cycles = seriesOf(realReset.archive).cycles;
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].endedAt, '2026-08-19T18:00:00.000Z');
  assert.equal(cycles[0].peakUsed, 90);
  assert.equal(cycles[0].exhausted, false);
  assert.equal(cycles[1].startedAt, '2026-08-19T18:00:00.000Z');
  assert.equal(seriesOf(realReset.archive).raw.at(-1).kind, 'reset');
});

test('explicit adapter reset events close a cycle without a resetsAt change', () => {
  const options = fileOptions();
  retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T10:00:00.000Z',
    windows: [windowFixture({ used: 80, remaining: 20, usedPercent: 80 })]
  })), options);
  const next = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T10:05:00.000Z',
    windows: [windowFixture({
      used: 0, remaining: 100, usedPercent: 0, remainingPercent: 100,
      resetEvent: true
    })]
  })), options);
  assert.equal(seriesOf(next.archive).raw.at(-1).kind, 'reset');
  assert.equal(seriesOf(next.archive).cycles.length, 2);
});

test('unauthorized connections without windows store a failure sample', () => {
  const options = fileOptions();
  const result = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    connectionStatus: 'unauthorized',
    quotaStatus: 'stale',
    status: 'unauthorized',
    lastAttemptAt: '2026-08-19T12:01:00.000Z',
    windows: []
  })), options);
  const series = seriesOf(result.archive);
  assert.equal(series.windowKey, 'connection');
  assert.equal(series.raw[0].kind, 'failure');
  assert.equal(series.raw[0].connectionStatus, 'unauthorized');
});

test('age retention keeps 14/90/370 day layers independently', () => {
  const options = fileOptions({ now: () => '2026-08-19T12:00:00.000Z' });
  const staleRaw = '2026-08-04T12:00:00.000Z';
  const keptRaw = '2026-08-06T12:00:00.000Z';
  retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: staleRaw,
    windows: [windowFixture({ used: 10, remaining: 90, usedPercent: 10 })]
  })), options);
  retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: keptRaw,
    windows: [windowFixture({ used: 20, remaining: 80, usedPercent: 20 })]
  })), options);

  const archive = captureQuotaHistory(
    retainQuotaHistoryFromLimits(recordFixture(providerFixture({
      lastSuccessAt: '2026-08-19T12:00:00.000Z',
      windows: [windowFixture({ used: 30, remaining: 70, usedPercent: 30 })]
    })), { ...options, writeEnabled: false }).archive,
    { limits: { providers: [] } },
    options
  );
  const series = seriesOf(archive);
  assert.equal(series.raw.some((sample) => sample.at === staleRaw), false);
  assert.equal(series.raw.some((sample) => sample.at === keptRaw), true);

  series.hourly.push({
    hour: '2026-05-20T00:00:00.000Z',
    first: { at: '2026-05-20T00:10:00.000Z', used: 1, remaining: 99, usedPercent: 1 },
    last: { at: '2026-05-20T00:50:00.000Z', used: 2, remaining: 98, usedPercent: 2 },
    minRemaining: 98,
    maxRemaining: 99,
    deltaUsed: 1
  });
  series.hourly.push({
    hour: '2026-05-22T00:00:00.000Z',
    first: { at: '2026-05-22T00:10:00.000Z', used: 1, remaining: 99, usedPercent: 1 },
    last: { at: '2026-05-22T00:50:00.000Z', used: 2, remaining: 98, usedPercent: 2 },
    minRemaining: 98,
    maxRemaining: 99,
    deltaUsed: 1
  });
  series.cycles.push({
    startedAt: '2025-08-10T00:00:00.000Z',
    endedAt: '2025-08-13T00:00:00.000Z',
    peakUsed: 100,
    exhausted: true,
    first: { at: '2025-08-10T00:00:00.000Z', used: 1, remaining: 99, usedPercent: 1 },
    last: { at: '2025-08-13T00:00:00.000Z', used: 100, remaining: 0, usedPercent: 100 }
  });
  series.cycles.push({
    startedAt: '2025-08-20T00:00:00.000Z',
    endedAt: '2025-08-21T00:00:00.000Z',
    peakUsed: 40,
    exhausted: false,
    first: { at: '2025-08-20T00:00:00.000Z', used: 1, remaining: 99, usedPercent: 1 },
    last: { at: '2025-08-21T00:00:00.000Z', used: 40, remaining: 60, usedPercent: 40 }
  });
  const pruned = captureQuotaHistory(archive, { limits: { providers: [] } }, options);
  const kept = seriesOf(pruned);
  assert.equal(kept.hourly.some((bucket) => bucket.hour.startsWith('2026-05-20')), false);
  assert.equal(kept.hourly.some((bucket) => bucket.hour.startsWith('2026-05-22')), true);
  assert.equal(kept.cycles.some((cycle) => cycle.endedAt === '2025-08-13T00:00:00.000Z'), false);
  assert.equal(kept.cycles.some((cycle) => cycle.endedAt === '2025-08-21T00:00:00.000Z'), true);
});

test('the 25 MiB cap drops oldest raw, then hourly, then closed cycles', () => {
  const options = fileOptions({ maxBytes: 2200 });
  let used = 1;
  for (let hour = 0; hour < 8; hour += 1) {
    used += 3;
    retainQuotaHistoryFromLimits(recordFixture(providerFixture({
      lastSuccessAt: `2026-08-18T${String(hour).padStart(2, '0')}:00:00.000Z`,
      windows: [windowFixture({
        used,
        remaining: 100 - used,
        usedPercent: used,
        remainingPercent: 100 - used,
        resetsAt: '2026-08-25T00:00:00.000Z'
      })]
    })), options);
  }
  const afterRaw = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T01:00:00.000Z',
    windows: [windowFixture({ used: 40, remaining: 60, usedPercent: 40 })]
  })), options);
  assert.ok(afterRaw.stats.bytes <= 2200);
  const series = seriesOf(afterRaw.archive);
  assert.ok(series.raw.length < 9);
  assert.ok(series.hourly.length >= 1);

  const tiny = fileOptions({ maxBytes: 900, dir: tmpDir() });
  tiny.path = path.join(tiny.dir, 'quota-history.json');
  const seeded = normalizeQuotaHistory({
    version: 1,
    series: {
      'pool:zai-pool-1:session:primary': {
        seriesKey: 'pool:zai-pool-1:session:primary',
        quotaPoolKey: 'zai-pool-1',
        windowKey: 'session:primary',
        provider: 'zai',
        raw: [],
        hourly: Array.from({ length: 6 }, (_, index) => ({
          hour: `2026-08-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
          first: { at: `2026-08-${String(10 + index).padStart(2, '0')}T00:10:00.000Z`, used: index, remaining: 90, usedPercent: index },
          last: { at: `2026-08-${String(10 + index).padStart(2, '0')}T00:50:00.000Z`, used: index + 1, remaining: 80, usedPercent: index + 1 },
          minRemaining: 80,
          maxRemaining: 90,
          deltaUsed: 1
        })),
        cycles: [{
          startedAt: '2026-07-01T00:00:00.000Z',
          endedAt: '2026-07-31T00:00:00.000Z',
          peakUsed: 99,
          exhausted: true,
          first: { at: '2026-07-01T00:00:00.000Z', used: 1, remaining: 99, usedPercent: 1 },
          last: { at: '2026-07-31T00:00:00.000Z', used: 99, remaining: 1, usedPercent: 99 }
        }, {
          startedAt: '2026-08-01T00:00:00.000Z',
          peakUsed: 10,
          exhausted: false,
          first: { at: '2026-08-01T00:00:00.000Z', used: 1, remaining: 99, usedPercent: 1 },
          last: { at: '2026-08-19T00:00:00.000Z', used: 10, remaining: 90, usedPercent: 10 }
        }]
      }
    }
  });
  const capped = captureQuotaHistory(seeded, { limits: { providers: [] } }, tiny);
  const cappedSeries = seriesOf(capped);
  assert.equal(cappedSeries.raw.length, 0);
  assert.ok(cappedSeries.hourly.length < 6);
  assert.equal(cappedSeries.cycles.some((cycle) => !cycle.endedAt), true);
});

test('a corrupt archive is not replaced with an empty document', () => {
  const options = fileOptions();
  fs.writeFileSync(options.path, '{not-json');
  const result = retainQuotaHistoryFromLimits(recordFixture(providerFixture()), options);
  assert.equal(result.wrote, false);
  assert.equal(result.corrupt, true);
  assert.equal(fs.readFileSync(options.path, 'utf8'), '{not-json');
  assert.equal(quotaHistoryStats(options).corrupt, true);
});

test('an unsupported version is treated as corrupt and left untouched', () => {
  const options = fileOptions();
  fs.writeFileSync(options.path, `${JSON.stringify({ version: 99, series: {} }, null, 2)}\n`);
  const before = fs.readFileSync(options.path, 'utf8');
  const result = retainQuotaHistoryFromLimits(recordFixture(providerFixture()), options);
  assert.equal(result.wrote, false);
  assert.equal(result.corrupt, true);
  assert.equal(fs.readFileSync(options.path, 'utf8'), before);
});

test('ENOSPC leaves the previous archive in place', () => {
  const options = fileOptions();
  retainQuotaHistoryFromLimits(recordFixture(providerFixture()), options);
  const before = fs.readFileSync(options.path, 'utf8');
  const result = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    lastSuccessAt: '2026-08-19T12:05:00.000Z',
    windows: [windowFixture({ used: 40, remaining: 60, usedPercent: 40, remainingPercent: 60 })]
  })), {
    ...options,
    writeJsonAtomic: (filePath, value) => {
      fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
      const error = new Error('ENOSPC');
      error.code = 'ENOSPC';
      throw error;
    }
  });
  assert.equal(result.wrote, false);
  assert.equal(result.error.code, 'ENOSPC');
  assert.equal(fs.readFileSync(options.path, 'utf8'), before);
  assert.equal(fs.existsSync(`${options.path}.tmp`), true);
});

test('clearQuotaHistory deletes only the quota archive', () => {
  const options = fileOptions();
  const credentialsPath = path.join(path.dirname(options.path), 'credentials.json');
  retainQuotaHistoryFromLimits(recordFixture(providerFixture()), options);
  fs.writeFileSync(credentialsPath, '{"token":"secret"}');
  assert.equal(clearQuotaHistory(options), true);
  assert.equal(fs.existsSync(options.path), false);
  assert.equal(fs.readFileSync(credentialsPath, 'utf8'), '{"token":"secret"}');
  assert.equal(clearQuotaHistory(options), false);
});

test('annotations survive age pruning until the user deletes them', () => {
  const options = fileOptions();
  const first = retainQuotaHistoryFromLimits(recordFixture(providerFixture()), options);
  const seriesKey = Object.keys(first.archive.series)[0];
  const annotated = setQuotaHistoryAnnotation(seriesKey, { muted: true, note: 'expected dip' }, options);
  const pruned = captureQuotaHistory(annotated.archive, { limits: { providers: [] } }, {
    ...options,
    now: () => '2026-12-01T00:00:00.000Z'
  });
  assert.deepEqual(pruned.annotations[seriesKey], { muted: true, note: 'expected dip' });
  setQuotaHistoryAnnotation(seriesKey, {}, options);
  assert.equal(quotaHistoryStats(options).annotations, 0);
});

test('persisted samples never copy credentials or raw provider payloads', () => {
  const options = fileOptions();
  const result = retainQuotaHistoryFromLimits(recordFixture(providerFixture({
    apiKey: 'sk-secret',
    cookie: 'session=abc',
    rawResponse: { token: 'nope' },
    windows: [windowFixture({ authorization: 'Bearer secret', raw: { nested: true } })]
  })), options);
  const json = JSON.stringify(result.archive);
  assert.equal(json.includes('sk-secret'), false);
  assert.equal(json.includes('session=abc'), false);
  assert.equal(json.includes('Bearer secret'), false);
  assert.equal(json.includes('rawResponse'), false);
  const sample = seriesOf(result.archive).raw[0];
  assert.deepEqual(Object.keys(sample).sort(), [
    'at', 'connectionStatus', 'kind', 'limit', 'quotaStatus', 'remaining',
    'remainingPercent', 'resetsAt', 'status', 'used', 'usedPercent', 'windowStartedAt'
  ]);
});

test('quotaHistoryPath lives under the shared data directory by default', () => {
  assert.equal(
    quotaHistoryPath({ env: { TOKEN_MONITOR_SHARED_DIR: '/tmp/monitor-data' } }),
    path.join('/tmp/monitor-data', 'quota-history.json')
  );
  assert.equal(MAX_BYTES, 25 * 1024 * 1024);
});

test('normalizeQuotaHistory drops malformed rows and migrates missing versions', () => {
  const archive = normalizeQuotaHistory({
    series: {
      'pool:p:week': {
        quotaPoolKey: 'p',
        windowKey: 'week',
        raw: [{ at: 'nope' }, { at: '2026-08-19T01:00:00.000Z', used: 4, cookie: 'drop-me' }],
        hourly: [{ hour: 'bad' }],
        cycles: [{}]
      }
    }
  });
  assert.equal(archive.version, 1);
  const series = archive.series['pool:p:week'];
  assert.equal(series.raw.length, 1);
  assert.equal(series.raw[0].cookie, undefined);
  assert.equal(series.hourly.length, 0);
  assert.equal(series.cycles.length, 0);
});
