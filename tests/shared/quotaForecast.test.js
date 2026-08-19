'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MIN_SHADOW_CYCLES,
  forecastFromArchive,
  forecastQuotaWindow,
  paceFacts,
  shadowBacktest
} = require('../../src/shared/quotaForecast');

function assertNoActionFields(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(['route', 'switch', 'action'].includes(key), false, key);
      if (child && typeof child === 'object') stack.push(child);
    }
  }
}

function atHour(start, hour) {
  return new Date(Date.parse(start) + hour * 3600000).toISOString();
}

function percentPoint(at, usedPercent, extra = {}) {
  return {
    at,
    kind: extra.kind || 'sample',
    used: usedPercent,
    limit: extra.limit ?? 100,
    remaining: 100 - usedPercent,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: extra.resetsAt,
    windowStartedAt: extra.windowStartedAt,
    quotaStatus: extra.quotaStatus || 'fresh',
    connectionStatus: 'ok',
    status: 'ok'
  };
}

function linearPercentSamples(start, hours, extra = {}) {
  const samples = [];
  for (let hour = 0; hour <= hours; hour += 1) {
    const usedPercent = (extra.startPercent || 0) + ((extra.endPercent ?? 100) - (extra.startPercent || 0)) * (hour / hours);
    samples.push(percentPoint(atHour(start, hour), usedPercent, {
      ...extra,
      kind: hour === 0 && extra.resetStart ? 'reset' : 'sample'
    }));
  }
  return extra.includeEnd === false ? samples.slice(0, -1) : samples;
}

const NOW = '2026-08-19T12:00:00.000Z';
const WINDOW_START = '2026-08-19T06:00:00.000Z';
const WINDOW_RESET = '2026-08-19T18:00:00.000Z';

function sessionWindow(extra = {}) {
  return {
    windowKey: 'session:primary',
    kind: 'session',
    used: 40,
    limit: 100,
    remaining: 60,
    usedPercent: 40,
    remainingPercent: 60,
    windowStartedAt: WINDOW_START,
    resetsAt: WINDOW_RESET,
    windowDurationMs: 12 * 3600000,
    resetPolicy: 'fixed',
    resetConfidence: 0.95,
    ...extra
  };
}

function currentSeries(extra = {}) {
  const samples = linearPercentSamples(WINDOW_START, 5, {
    startPercent: 0,
    endPercent: 40,
    resetsAt: WINDOW_RESET,
    windowStartedAt: WINDOW_START
  });
  return {
    seriesKey: 'pool:zai-pool-1:session:primary',
    quotaPoolKey: 'zai-pool-1',
    windowKey: 'session:primary',
    raw: extra.raw || samples,
    hourly: extra.hourly || [],
    cycles: extra.cycles || []
  };
}

test('paceFacts reports usage vs time for a fixed window', () => {
  const pace = paceFacts(sessionWindow(), { now: NOW });
  assert.equal(pace.timeProgress, 0.5);
  assert.equal(pace.usageProgress, 0.4);
  assert.equal(pace.paceDelta, -0.1);
  assert.equal(pace.precision, 'providerReported');
});

test('missing windowStartedAt is derived from duration and marked derived', () => {
  const pace = paceFacts(sessionWindow({ windowStartedAt: undefined }), { now: NOW });
  assert.equal(pace.windowStartedAt, WINDOW_START);
  assert.equal(pace.precision, 'derived');
});

test('a fixed fixture yields 8 percent/hour and remaining at reset', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow(),
    series: currentSeries()
  });
  assert.equal(forecast.eligibility, 'eligible');
  assert.equal(forecast.displayEligible, false);
  assert.equal(forecast.velocity.value, 8);
  assert.equal(forecast.velocity.unit, 'percent_per_hour');
  assert.equal(forecast.velocity.sampleCount, 6);
  assert.equal(forecast.exhaust.estimatedRemainingAtReset, 12);
  assert.equal(forecast.exhaust.estimatedExhaustAt, '2026-08-19T19:30:00.000Z');
  assert.ok(forecast.sampleAts.includes(WINDOW_START));
  assertNoActionFields(forecast);
});

test('missing history is insufficient and does not fabricate an exhaust time', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow(),
    series: { raw: [], hourly: [], cycles: [] }
  });
  assert.equal(forecast.eligibility, 'insufficient');
  assert.equal(forecast.exhaust, null);
  assert.ok(forecast.reasonCodes.includes('insufficient_samples'));
});

test('a single sample is not enough to forecast', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow(),
    series: { raw: [percentPoint(NOW, 40, { resetsAt: WINDOW_RESET })], hourly: [], cycles: [] }
  });
  assert.equal(forecast.eligibility, 'insufficient');
  assert.equal(forecast.exhaust, null);
});

test('velocity uses only samples after the latest reset', () => {
  const before = linearPercentSamples('2026-08-19T00:00:00.000Z', 5, {
    startPercent: 10,
    endPercent: 90,
    resetsAt: '2026-08-19T06:00:00.000Z',
    windowStartedAt: '2026-08-19T00:00:00.000Z'
  });
  const after = linearPercentSamples(WINDOW_START, 5, {
    startPercent: 0,
    endPercent: 40,
    resetStart: true,
    resetsAt: WINDOW_RESET,
    windowStartedAt: WINDOW_START
  });
  const forecast = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow(),
    series: { raw: [...before, ...after], hourly: [], cycles: [] }
  });
  assert.equal(forecast.velocity.value, 8);
  assert.equal(forecast.exhaust.estimatedRemainingAtReset, 12);
});

test('top-up jumps are excluded from velocity', () => {
  const raw = [
    percentPoint(atHour(WINDOW_START, 0), 20, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 1), 40, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 2), 10, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 3), 18, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START })
  ];
  const forecast = forecastQuotaWindow({
    now: atHour(WINDOW_START, 3),
    window: sessionWindow({ used: 18, remaining: 82, usedPercent: 18, remainingPercent: 82 }),
    series: { raw, hourly: [], cycles: [] }
  });
  assert.ok(forecast.reasonCodes.includes('top_up_excluded'));
  assert.equal(forecast.velocity.topUpExcluded, 1);
  assert.equal(forecast.velocity.value, 14);
});

test('outlier bursts are dropped from the median velocity', () => {
  const raw = [
    percentPoint(atHour(WINDOW_START, 0), 0, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 1), 8, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 2), 16, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 3), 24, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 4), 80, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
    percentPoint(atHour(WINDOW_START, 5), 88, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START })
  ];
  const forecast = forecastQuotaWindow({
    now: atHour(WINDOW_START, 5),
    window: sessionWindow({ used: 88, remaining: 12, usedPercent: 88, remainingPercent: 12 }),
    series: { raw, hourly: [], cycles: [] }
  });
  assert.ok(forecast.reasonCodes.includes('outlier_excluded'));
  assert.equal(forecast.velocity.outliers, 1);
  assert.equal(forecast.velocity.value, 8);
});

test('unlimited and unknown totals do not predict exhaustion', () => {
  const series = currentSeries();
  const unlimited = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow({ unlimited: true, limit: null, usedPercent: null, remainingPercent: null }),
    series
  });
  assert.equal(unlimited.eligibility, 'unknown');
  assert.equal(unlimited.exhaust, null);
  assert.ok(unlimited.reasonCodes.includes('unlimited'));

  const unknown = forecastQuotaWindow({
    now: NOW,
    window: { kind: 'session' },
    series: { raw: [], hourly: [], cycles: [] }
  });
  assert.equal(unknown.eligibility, 'unknown');
  assert.equal(unknown.exhaust, null);
});

test('a one-shot credits balance without consumption history is not forecast', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    window: { metric: 'credits', remaining: 12.5, currency: 'USD' },
    series: {
      raw: [{
        at: NOW,
        kind: 'sample',
        remaining: 12.5
      }],
      hourly: [],
      cycles: []
    }
  });
  assert.equal(forecast.eligibility, 'insufficient');
  assert.ok(forecast.reasonCodes.includes('one_shot_balance'));
  assert.equal(forecast.exhaust, null);
});

test('untrusted rolling resets keep velocity but drop exhaust time', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow({ resetPolicy: 'rolling', resetConfidence: 0.2 }),
    series: currentSeries()
  });
  assert.equal(forecast.eligibility, 'insufficient');
  assert.ok(forecast.reasonCodes.includes('untrusted_rolling_reset'));
  assert.equal(forecast.velocity.value, 8);
  assert.equal(forecast.exhaust, null);
});

test('stale snapshots are not eligible for exhaust predictions', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    stale: true,
    window: sessionWindow({ quotaStatus: 'stale' }),
    series: currentSeries()
  });
  assert.equal(forecast.eligibility, 'insufficient');
  assert.ok(forecast.reasonCodes.includes('stale'));
  assert.equal(forecast.exhaust, null);
  assert.ok(forecast.confidence <= 0.4);
});

test('coverage shorter than the provider interval is insufficient', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    minIntervalMs: 60 * 1000,
    window: sessionWindow(),
    series: {
      raw: [
        percentPoint('2026-08-19T12:00:00.000Z', 10, { resetsAt: WINDOW_RESET }),
        percentPoint('2026-08-19T12:00:10.000Z', 12, { resetsAt: WINDOW_RESET })
      ],
      hourly: [],
      cycles: []
    }
  });
  assert.ok(forecast.reasonCodes.includes('coverage_too_short'));
  assert.equal(forecast.exhaust, null);
});

test('an explicit identity switch is not eligible', () => {
  const forecast = forecastQuotaWindow({
    now: NOW,
    identitySwitch: true,
    window: sessionWindow(),
    series: currentSeries()
  });
  assert.equal(forecast.eligibility, 'insufficient');
  assert.ok(forecast.reasonCodes.includes('identity_switch'));
});

test('shared pools forecast once per quotaPoolKey + window', () => {
  const window = sessionWindow();
  const series = currentSeries();
  const archive = { series: { [series.seriesKey]: series } };
  const providers = [
    { provider: 'zai', quotaPoolKey: 'zai-pool-1', connectionKey: 'conn-a', windows: [window] },
    { provider: 'zai', quotaPoolKey: 'zai-pool-1', connectionKey: 'conn-b', windows: [window] }
  ];
  const items = forecastFromArchive(archive, providers, { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].forecast.velocity.value, 8);
  assert.equal(items[0].seriesKey, 'pool:zai-pool-1:session:primary');
});

test('shadow backtest requires two complete cycles before displayEligible', () => {
  function closedCycle(start) {
    const hours = 12;
    const raw = linearPercentSamples(start, hours, {
      startPercent: 0,
      endPercent: 100,
      includeEnd: false,
      resetsAt: atHour(start, hours),
      windowStartedAt: start
    });
    return {
      raw,
      cycle: {
        startedAt: start,
        endedAt: atHour(start, hours),
        peakUsed: 100,
        exhausted: true,
        first: { at: start, used: 0, remaining: 100, usedPercent: 0 },
        last: { at: atHour(start, hours), used: 100, remaining: 0, usedPercent: 100 }
      }
    };
  }
  const first = closedCycle('2026-08-10T00:00:00.000Z');
  const second = closedCycle('2026-08-11T00:00:00.000Z');
  second.raw[0].kind = 'reset';
  second.raw[0].resetsAt = '2026-08-11T12:00:00.000Z';
  const current = currentSeries();
  current.raw[0].kind = 'reset';
  const series = {
    ...current,
    raw: [...first.raw, ...second.raw, ...current.raw],
    cycles: [first.cycle, second.cycle]
  };
  const oneCycle = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow(),
    series: { ...series, cycles: [first.cycle] }
  });
  assert.equal(oneCycle.shadow.cyclesRequired, MIN_SHADOW_CYCLES);
  assert.equal(oneCycle.shadow.ready, false);
  assert.equal(oneCycle.displayEligible, false);

  const twoCycles = forecastQuotaWindow({
    now: NOW,
    window: sessionWindow(),
    series
  });
  assert.equal(twoCycles.shadow.cyclesCompleted, 2);
  assert.equal(twoCycles.shadow.ready, true);
  assert.equal(twoCycles.eligibility, 'eligible');
  assert.equal(twoCycles.displayEligible, true);
  assert.equal(shadowBacktest(series).degraded, false);
  assertNoActionFields(twoCycles);
});
