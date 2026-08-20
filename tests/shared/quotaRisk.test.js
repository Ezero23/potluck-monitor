'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { forecastQuotaWindow } = require('../../src/shared/quotaForecast');
const {
  RISK_STATES,
  bindingQuotaConstraint,
  evaluateProviderRisks,
  evaluateQuotaRisk
} = require('../../src/shared/quotaRisk');

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
    const usedPercent = (extra.startPercent || 0)
      + ((extra.endPercent ?? 100) - (extra.startPercent || 0)) * (hour / hours);
    samples.push(percentPoint(atHour(start, hour), usedPercent, extra));
  }
  return samples;
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

function seriesFrom(startPercent, endPercent, hours = 5) {
  return {
    seriesKey: 'pool:zai-pool-1:session:primary',
    quotaPoolKey: 'zai-pool-1',
    windowKey: 'session:primary',
    raw: linearPercentSamples(WINDOW_START, hours, {
      startPercent,
      endPercent,
      resetsAt: WINDOW_RESET,
      windowStartedAt: WINDOW_START
    }),
    hourly: [],
    cycles: []
  };
}

test('RISK_STATES lists the unified Monitor risk vocabulary', () => {
  assert.deepEqual(RISK_STATES, [
    'exhausted', 'likely_to_exhaust', 'watch', 'stale', 'normal', 'unknown'
  ]);
});

test('no history yields unknown risk and no exhaust time', () => {
  const risk = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow(),
    series: { raw: [], hourly: [], cycles: [] }
  });
  assert.equal(risk.state, 'unknown');
  assert.equal(risk.exhaust, null);
  assert.ok(risk.reasonCodes.includes('insufficient_samples'));
  assertNoActionFields(risk);
});

test('true zero is exhausted; unknown remaining is not', () => {
  const exhausted = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow({ remaining: 0, remainingPercent: 0, usedPercent: 100, used: 100 }),
    series: { raw: [], hourly: [], cycles: [] }
  });
  assert.equal(exhausted.state, 'exhausted');
  assert.ok(exhausted.reasonCodes.includes('true_zero'));
  assert.equal(exhausted.exhaust, null);

  const unknownZero = evaluateQuotaRisk({
    now: NOW,
    window: { kind: 'session' },
    series: { raw: [], hourly: [], cycles: [] }
  });
  assert.equal(unknownZero.state, 'unknown');
  assert.equal(unknownZero.reasonCodes.includes('true_zero'), false);
});

test('stale snapshots cap confidence and do not speak exhaust times', () => {
  const risk = evaluateQuotaRisk({
    now: NOW,
    stale: true,
    window: sessionWindow({ quotaStatus: 'stale' }),
    series: seriesFrom(0, 40)
  });
  assert.equal(risk.state, 'stale');
  assert.equal(risk.exhaust, null);
  assert.ok(risk.confidence <= 0.4);
});

test('exhaust before reset is likely_to_exhaust', () => {
  const window = sessionWindow({
    used: 72, remaining: 28, usedPercent: 72, remainingPercent: 28
  });
  const series = seriesFrom(0, 72);
  const forecast = forecastQuotaWindow({ now: NOW, window, series });
  assert.ok(forecast.exhaust.estimatedExhaustAt < WINDOW_RESET);
  const risk = evaluateQuotaRisk({ now: NOW, window, series, forecast });
  assert.equal(risk.state, 'likely_to_exhaust');
  assert.ok(risk.reasonCodes.includes('exhaust_before_reset'));
  assert.equal(risk.exhaust.estimatedExhaustAt, forecast.exhaust.estimatedExhaustAt);
});

test('ahead-of-pace usage is watch, in-pace usage is normal', () => {
  const watch = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow({ used: 82, remaining: 18, usedPercent: 82, remainingPercent: 18 }),
    series: {
      raw: [
        percentPoint(atHour(WINDOW_START, 0), 80, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
        percentPoint(atHour(WINDOW_START, 3), 81, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START }),
        percentPoint(NOW, 82, { resetsAt: WINDOW_RESET, windowStartedAt: WINDOW_START })
      ],
      hourly: [],
      cycles: []
    }
  });
  assert.equal(watch.state, 'watch');
  assert.ok(watch.reasonCodes.includes('low_remaining'));

  const normal = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow({ used: 24, remaining: 76, usedPercent: 24, remainingPercent: 76 }),
    series: seriesFrom(0, 24, 6)
  });
  assert.equal(normal.state, 'normal');
  assert.ok(normal.reasonCodes.includes('within_pace'));
});

test('muted and expected annotations are flags, not routes', () => {
  const risk = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow(),
    series: seriesFrom(0, 40),
    annotation: { muted: true, expected: true, note: 'weekend job' }
  });
  assert.equal(risk.muted, true);
  assert.equal(risk.expected, true);
  assert.ok(risk.reasonCodes.includes('user_muted'));
  assert.ok(risk.reasonCodes.includes('user_expected'));
  assert.equal(risk.route, undefined);
  assert.equal(risk.switch, undefined);
  assert.equal(risk.action, undefined);
});

test('low resetConfidence caps certainty even when a forecast exists', () => {
  const window = sessionWindow({
    used: 72, remaining: 28, usedPercent: 72, remainingPercent: 28,
    resetConfidence: 0.2
  });
  const risk = evaluateQuotaRisk({
    now: NOW,
    window,
    series: seriesFrom(0, 72)
  });
  assert.equal(risk.state, 'likely_to_exhaust');
  assert.ok(risk.confidence <= 0.5);
  assert.ok(risk.reasonCodes.includes('low_reset_confidence'));
});

test('percent and credits risks are computed separately', () => {
  const percent = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow({ used: 24, remaining: 76, usedPercent: 24, remainingPercent: 76 }),
    series: seriesFrom(0, 24, 6)
  });
  assert.equal(percent.metric, 'percent');
  assert.equal(percent.byMetric.percent.state, 'normal');
  assert.equal(percent.byMetric.credits, null);

  const credits = evaluateQuotaRisk({
    now: NOW,
    window: {
      metric: 'credits',
      remaining: 8,
      windowStartedAt: WINDOW_START,
      resetsAt: WINDOW_RESET
    },
    series: {
      raw: [
        { at: WINDOW_START, kind: 'sample', remaining: 20, resetsAt: WINDOW_RESET },
        { at: NOW, kind: 'sample', remaining: 8, resetsAt: WINDOW_RESET }
      ],
      hourly: [],
      cycles: []
    }
  });
  assert.equal(credits.metric, 'credits');
  assert.equal(credits.byMetric.credits.state, credits.state);
  assert.equal(credits.byMetric.percent, null);
});

test('shared pools do not double-count connections when scoring risk', () => {
  const window = sessionWindow({ used: 24, remaining: 76, usedPercent: 24, remainingPercent: 76 });
  const series = seriesFrom(0, 24, 6);
  const archive = { series: { [series.seriesKey]: series } };
  const providers = [
    { provider: 'zai', quotaPoolKey: 'zai-pool-1', connectionKey: 'conn-a', windows: [window] },
    { provider: 'zai', quotaPoolKey: 'zai-pool-1', connectionKey: 'conn-b', windows: [window] }
  ];
  const result = evaluateProviderRisks(archive, providers, { now: NOW });
  assert.equal(result.risks.length, 1);
  assert.equal(result.items[0].forecast.velocity.value, 4);
  assert.equal(result.risks[0].state, 'normal');
});

test('the binding constraint is the window that exhausts first', () => {
  const session = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow({
      windowKey: 'session:primary',
      used: 72, remaining: 28, usedPercent: 72, remainingPercent: 28
    }),
    series: seriesFrom(0, 72)
  });
  const weekly = evaluateQuotaRisk({
    now: NOW,
    window: sessionWindow({
      windowKey: 'week',
      kind: 'week',
      used: 10, remaining: 90, usedPercent: 10, remainingPercent: 90,
      windowStartedAt: '2026-08-17T00:00:00.000Z',
      resetsAt: '2026-08-24T00:00:00.000Z',
      windowDurationMs: 7 * 24 * 3600000
    }),
    series: {
      raw: linearPercentSamples('2026-08-17T00:00:00.000Z', 60, {
        startPercent: 0,
        endPercent: 10,
        resetsAt: '2026-08-24T00:00:00.000Z',
        windowStartedAt: '2026-08-17T00:00:00.000Z'
      }),
      hourly: [],
      cycles: []
    }
  });
  assert.equal(session.state, 'likely_to_exhaust');
  assert.equal(weekly.state, 'normal');
  const binding = bindingQuotaConstraint([weekly, session]);
  assert.equal(binding.state, 'likely_to_exhaust');
  assert.equal(binding.bindingReason, 'earliest_exhaust');
  assertNoActionFields(binding);
});
