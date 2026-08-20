'use strict';

const quotaHistoryPeer = (() => {
  try {
    return require('./quotaHistory');
  } catch {
    return null;
  }
})();

function quotaHistoryLite() {
  function normalizeIso(value) {
    if (value == null || value === '') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
  function isQuotaResetEvent(previous, incoming) {
    if (!incoming) return false;
    if (incoming.kind === 'reset' || incoming.resetEvent === true || incoming.event === 'reset') return true;
    if (!previous) return false;
    const prevReset = normalizeIso(previous.resetsAt);
    const nextReset = normalizeIso(incoming.resetsAt);
    return Boolean(prevReset && nextReset && prevReset !== nextReset);
  }
  return { isQuotaResetEvent, quotaHistorySeriesKey, windowHistoryKey };
}

const {
  isQuotaResetEvent,
  quotaHistorySeriesKey,
  windowHistoryKey
} = quotaHistoryPeer || quotaHistoryLite();

const MIN_SHADOW_CYCLES = 2;
const DEFAULT_MIN_INTERVAL_MS = 60 * 1000;
const STALE_CONFIDENCE_CAP = 0.4;
const LOW_RESET_CONFIDENCE_CAP = 0.5;
const LOW_RESET_CONFIDENCE = 0.6;
const OUTLIER_RATIO = 3;
const LIMIT_SWITCH_RATIO = 0.2;
const SHADOW_ERROR_DEGRADE = 25;
const MS_PER_HOUR = 60 * 60 * 1000;
const DAY_MS = 24 * MS_PER_HOUR;
const FORBIDDEN_KEYS = new Set(['route', 'switch', 'action']);

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function nowMs(options = {}) {
  if (typeof options.now === 'function') return parseMs(options.now()) ?? Date.now();
  if (options.now != null) return parseMs(options.now) ?? Date.now();
  return Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values, center) {
  if (center == null) return null;
  return median(values.map((value) => Math.abs(value - center)));
}

function uniqueAts(samples) {
  return [...new Set(samples.map((sample) => sample.at).filter(Boolean))];
}

function successSamples(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .filter((sample) => sample && sample.kind !== 'failure' && parseMs(sample.at) != null)
    .slice()
    .sort((left, right) => left.at.localeCompare(right.at));
}

function currentCycleSamples(samples) {
  let start = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (isQuotaResetEvent(samples[index - 1], samples[index])) start = index;
  }
  return samples.slice(start);
}

function isUnlimited(window = {}) {
  if (window.unlimited === true) return true;
  return String(window.limit ?? '').trim().toLowerCase() === 'unlimited';
}

function resolveWindowStart(window = {}) {
  const started = parseMs(window.windowStartedAt);
  if (started != null) {
    return { startMs: started, precision: window.precision || 'providerReported' };
  }
  const reset = parseMs(window.resetsAt || window.resetAt);
  const duration = numberOrNull(window.windowDurationMs);
  if (reset != null && duration != null && duration > 0) {
    return { startMs: reset - duration, precision: 'derived' };
  }
  const minutes = numberOrNull(window.windowMinutes);
  if (reset != null && minutes != null && minutes > 0) {
    return { startMs: reset - minutes * 60000, precision: 'derived' };
  }
  return { startMs: null, precision: 'unavailable' };
}

function usageProgress(window = {}) {
  const usedPercent = numberOrNull(window.usedPercent);
  if (usedPercent != null) return clamp(usedPercent / 100, 0, 1);
  const used = numberOrNull(window.used);
  const limit = numberOrNull(window.limit);
  if (used != null && limit != null && limit > 0) return clamp(used / limit, 0, 1);
  return null;
}

function paceFacts(window = {}, options = {}) {
  const now = nowMs(options);
  const resetMs = parseMs(window.resetsAt || window.resetAt);
  const { startMs, precision } = resolveWindowStart(window);
  const usage = usageProgress(window);
  if (startMs == null || resetMs == null || resetMs <= startMs || usage == null) {
    return null;
  }
  const timeProgress = clamp((now - startMs) / (resetMs - startMs), 0, 1);
  return {
    timeProgress: round(timeProgress),
    usageProgress: round(usage),
    paceDelta: round(usage - timeProgress),
    windowStartedAt: toIso(startMs),
    resetsAt: toIso(resetMs),
    precision
  };
}

function detectMetric(window = {}, samples = []) {
  if (window.metric === 'credits') return 'credits';
  const probe = [window, ...samples];
  if (probe.some((row) => numberOrNull(row?.usedPercent) != null)) return 'percent';
  if (probe.some((row) => numberOrNull(row?.remaining) != null) && window.metric === 'credits') return 'credits';
  if (probe.some((row) => numberOrNull(row?.used) != null)) return 'requests';
  if (probe.some((row) => numberOrNull(row?.remaining) != null)) return 'credits';
  return null;
}

function consumedBetween(previous, current, metric) {
  if (metric === 'percent') {
    const prev = numberOrNull(previous.usedPercent);
    const next = numberOrNull(current.usedPercent);
    if (prev == null || next == null) return null;
    return next - prev;
  }
  if (metric === 'credits') {
    const prev = numberOrNull(previous.remaining);
    const next = numberOrNull(current.remaining);
    if (prev == null || next == null) return null;
    return prev - next;
  }
  const prev = numberOrNull(previous.used);
  const next = numberOrNull(current.used);
  if (prev == null || next == null) return null;
  return next - prev;
}

function remainingForMetric(row, metric) {
  if (metric === 'percent') {
    const remainingPercent = numberOrNull(row.remainingPercent);
    if (remainingPercent != null) return remainingPercent;
    const usedPercent = numberOrNull(row.usedPercent);
    return usedPercent == null ? null : 100 - usedPercent;
  }
  if (metric === 'credits') return numberOrNull(row.remaining);
  const used = numberOrNull(row.used);
  const limit = numberOrNull(row.limit);
  if (used == null || limit == null) return numberOrNull(row.remaining);
  return limit - used;
}

function velocityUnit(metric) {
  if (metric === 'percent') return 'percent_per_hour';
  if (metric === 'credits') return 'credits_per_hour';
  return 'units_per_hour';
}

function limitSwitched(previous, current) {
  const prev = numberOrNull(previous.limit);
  const next = numberOrNull(current.limit);
  if (prev == null || next == null || prev <= 0) return false;
  return Math.abs(next - prev) / prev > LIMIT_SWITCH_RATIO;
}

function velocityIntervals(samples, metric, options = {}) {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const intervals = [];
  let topUpExcluded = 0;
  let identitySwitch = false;
  let outliers = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = parseMs(current.at) - parseMs(previous.at);
    if (!(dt > 0)) continue;
    if (limitSwitched(previous, current)) {
      identitySwitch = true;
      continue;
    }
    const consumed = consumedBetween(previous, current, metric);
    if (consumed == null) continue;
    if (consumed < 0) {
      topUpExcluded += 1;
      continue;
    }
    if (dt < minIntervalMs && consumed > 0) {
      // Burst inside the provider's minimum interval still counts, but zero-width
      // coverage is rejected later. Keep the rate so a 2-sample fixture works.
    }
    intervals.push({
      rate: consumed / (dt / MS_PER_HOUR),
      dt,
      from: previous.at,
      to: current.at,
      consumed
    });
  }
  const rates = intervals.map((row) => row.rate);
  const mid = median(rates.filter((rate) => rate > 0)) ?? median(rates);
  const kept = [];
  for (const interval of intervals) {
    if (mid != null && mid > 0 && interval.rate > mid * OUTLIER_RATIO) {
      outliers += 1;
      continue;
    }
    kept.push(interval);
  }
  return { intervals: kept, topUpExcluded, identitySwitch, outliers };
}

function weekdayBaseline(hourly, now, metric) {
  const date = new Date(now);
  const dow = date.getUTCDay();
  const hour = date.getUTCHours();
  const rates = [];
  for (const bucket of Array.isArray(hourly) ? hourly : []) {
    const at = parseMs(bucket.hour);
    if (at == null) continue;
    const point = new Date(at);
    if (point.getUTCDay() !== dow || point.getUTCHours() !== hour) continue;
    if (metric === 'percent' || metric === 'requests') {
      const delta = numberOrNull(bucket.deltaUsed);
      if (delta != null && delta >= 0) rates.push(delta);
    } else {
      const first = numberOrNull(bucket.first?.remaining);
      const last = numberOrNull(bucket.last?.remaining);
      if (first != null && last != null && first >= last) rates.push(first - last);
    }
  }
  return median(rates);
}

function robustVelocity(samples, options = {}) {
  const metric = options.metric || detectMetric(options.window, samples);
  if (!metric || samples.length < 2) return null;
  const { intervals, topUpExcluded, identitySwitch, outliers } = velocityIntervals(samples, metric, options);
  if (intervals.length === 0) {
    return {
      value: null,
      unit: velocityUnit(metric),
      metric,
      sampleCount: samples.length,
      coverageMs: 0,
      dispersion: null,
      shortTerm: null,
      weekdayBaseline: null,
      sampleAts: uniqueAts(samples),
      topUpExcluded,
      identitySwitch,
      outliers
    };
  }
  const rates = intervals.map((row) => row.rate);
  const value = median(rates);
  const coverageMs = intervals.reduce((sum, row) => sum + row.dt, 0);
  const now = nowMs(options);
  const shortRates = intervals
    .filter((row) => parseMs(row.to) >= now - DAY_MS)
    .map((row) => row.rate);
  const dispersionCenter = value;
  const dispersion = mad(rates, dispersionCenter);
  return {
    value: round(value),
    unit: velocityUnit(metric),
    metric,
    sampleCount: uniqueAts(samples).length,
    coverageMs,
    dispersion: round(dispersion),
    dispersionRatio: value ? round(dispersion / Math.abs(value)) : null,
    shortTerm: round(median(shortRates.length ? shortRates : rates)),
    weekdayBaseline: round(weekdayBaseline(options.hourly, now, metric)),
    sampleAts: uniqueAts(samples),
    topUpExcluded,
    identitySwitch,
    outliers
  };
}

function estimatedRemainingAtReset(remaining, velocity, now, resetMs) {
  if (remaining == null || velocity == null || resetMs == null) return null;
  const hours = (resetMs - now) / MS_PER_HOUR;
  if (hours < 0) return remaining;
  return round(Math.max(0, remaining - velocity * hours));
}

function exhaustEstimate(row, velocity, options = {}) {
  if (!velocity || !(velocity.value > 0)) return null;
  const remaining = remainingForMetric(row, velocity.metric);
  if (remaining == null || remaining < 0) return null;
  const now = nowMs(options);
  const hours = remaining / velocity.value;
  const estimatedExhaustAt = toIso(now + hours * MS_PER_HOUR);
  const resetMs = parseMs(options.resetsAt || row.resetsAt || row.resetAt);
  return {
    estimatedExhaustAt,
    estimatedRemainingAtReset: estimatedRemainingAtReset(remaining, velocity.value, now, resetMs),
    remaining
  };
}

function observationsForCycle(series, cycle) {
  const start = cycle.startedAt;
  const end = cycle.endedAt;
  if (!start || !end) return [];
  const raw = successSamples(series.raw).filter((sample) => sample.at >= start && sample.at < end);
  if (raw.length >= 2) return raw;
  return (Array.isArray(series.hourly) ? series.hourly : [])
    .filter((bucket) => bucket.hour >= start && bucket.hour < end)
    .map((bucket) => ({
      at: bucket.last?.at || bucket.hour,
      used: bucket.last?.used,
      remaining: bucket.last?.remaining,
      usedPercent: bucket.last?.usedPercent,
      remainingPercent: bucket.last?.usedPercent == null ? null : 100 - bucket.last.usedPercent
    }))
    .filter((sample) => parseMs(sample.at) != null);
}

function scoreShadowCycle(series, cycle, options = {}) {
  const samples = observationsForCycle(series, cycle);
  const startMs = parseMs(cycle.startedAt);
  const endMs = parseMs(cycle.endedAt);
  if (samples.length < 2 || startMs == null || endMs == null || endMs <= startMs) {
    return { gap: true, startedAt: cycle.startedAt, endedAt: cycle.endedAt };
  }
  const asOf = startMs + (endMs - startMs) / 2;
  const asOfSamples = samples.filter((sample) => parseMs(sample.at) <= asOf);
  if (asOfSamples.length < 2) {
    return { gap: true, startedAt: cycle.startedAt, endedAt: cycle.endedAt };
  }
  const metric = detectMetric(options.window, asOfSamples);
  const velocity = robustVelocity(asOfSamples, { ...options, metric, now: asOf });
  const last = asOfSamples[asOfSamples.length - 1];
  const exhaust = exhaustEstimate(last, velocity, { now: asOf, resetsAt: cycle.endedAt || cycle.resetsAt });
  const actualRemaining = remainingForMetric({
    remaining: cycle.last?.remaining,
    usedPercent: cycle.last?.usedPercent,
    remainingPercent: cycle.last?.usedPercent == null ? null : 100 - cycle.last.usedPercent,
    used: cycle.last?.used,
    limit: options.window?.limit
  }, metric);
  const predictedRemaining = exhaust?.estimatedRemainingAtReset ?? null;
  return {
    gap: false,
    predictedAt: toIso(asOf),
    estimatedExhaustAt: exhaust?.estimatedExhaustAt || null,
    actualExhausted: cycle.exhausted === true,
    estimatedRemainingAtReset: predictedRemaining,
    actualRemainingBeforeReset: actualRemaining,
    error: predictedRemaining == null || actualRemaining == null ? null : round(predictedRemaining - actualRemaining),
    startedAt: cycle.startedAt,
    endedAt: cycle.endedAt
  };
}

function shadowBacktest(series = {}, options = {}) {
  const cycles = (Array.isArray(series.cycles) ? series.cycles : []).filter((cycle) => cycle.endedAt);
  const records = cycles.map((cycle) => scoreShadowCycle(series, cycle, options));
  const scored = records.filter((record) => record.gap !== true);
  const errors = scored.map((record) => record.error).filter((value) => value != null);
  const meanAbsError = errors.length ? round(errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length) : null;
  return {
    cyclesRequired: MIN_SHADOW_CYCLES,
    cyclesCompleted: scored.length,
    ready: scored.length >= MIN_SHADOW_CYCLES,
    meanAbsError,
    degraded: meanAbsError != null && meanAbsError > SHADOW_ERROR_DEGRADE,
    records
  };
}

function hasInterpretableDenominator(window = {}, metric) {
  if (isUnlimited(window)) return false;
  if (metric === 'percent') {
    return numberOrNull(window.usedPercent) != null || (numberOrNull(window.used) != null && numberOrNull(window.limit) != null);
  }
  if (metric === 'credits') return numberOrNull(window.remaining) != null;
  return numberOrNull(window.limit) != null && numberOrNull(window.used) != null;
}

function isStaleInput(input = {}) {
  if (input.stale === true) return true;
  const window = input.window || {};
  const provider = input.provider || {};
  return window.quotaStatus === 'stale' || provider.quotaStatus === 'stale';
}

function untrustedRolling(window = {}) {
  if (String(window.resetPolicy || '').toLowerCase() !== 'rolling') return false;
  const confidence = numberOrNull(window.resetConfidence);
  return confidence == null || confidence < LOW_RESET_CONFIDENCE;
}

function forecastConfidence({ velocity, shadow, stale, resetConfidence, eligible }) {
  if (!eligible) return 0.1;
  let score = 0.35;
  const count = velocity?.sampleCount || 0;
  if (count >= 6) score += 0.15;
  if (count >= 12) score += 0.1;
  if ((velocity?.coverageMs || 0) >= 6 * MS_PER_HOUR) score += 0.1;
  if ((velocity?.coverageMs || 0) >= DAY_MS) score += 0.1;
  if (velocity?.dispersionRatio != null && velocity.dispersionRatio < 0.5) score += 0.1;
  if (shadow?.ready && !shadow.degraded) score += 0.1;
  if (stale) score = Math.min(score, STALE_CONFIDENCE_CAP);
  if (resetConfidence != null && resetConfidence < LOW_RESET_CONFIDENCE) {
    score = Math.min(score, LOW_RESET_CONFIDENCE_CAP);
  }
  if (shadow?.degraded) score *= 0.5;
  return round(clamp(score, 0, 1), 2);
}

function emptyForecast(reasonCodes, extras = {}) {
  return stripForbidden({
    eligibility: extras.eligibility || 'insufficient',
    displayEligible: false,
    reasonCodes,
    precision: extras.precision || 'unavailable',
    confidence: extras.confidence ?? 0.1,
    pace: extras.pace || null,
    velocity: extras.velocity || null,
    exhaust: null,
    shadow: extras.shadow || {
      cyclesRequired: MIN_SHADOW_CYCLES,
      cyclesCompleted: 0,
      ready: false,
      meanAbsError: null,
      degraded: false,
      records: []
    },
    sampleAts: extras.sampleAts || []
  });
}

function stripForbidden(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripForbidden);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = stripForbidden(child);
  }
  return out;
}

function forecastQuotaWindow(input = {}) {
  const window = input.window || {};
  const series = input.series || {};
  const options = {
    now: input.now,
    minIntervalMs: input.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    window,
    hourly: series.hourly,
    metric: detectMetric(window, series.raw)
  };
  const pace = paceFacts(window, input);
  const shadow = shadowBacktest(series, { ...options, window });
  const stale = isStaleInput(input);
  const samples = currentCycleSamples(successSamples(series.raw));
  const metric = options.metric;
  const reasonCodes = [];

  if (input.identitySwitch === true) {
    return emptyForecast([...reasonCodes, 'identity_switch'], {
      eligibility: 'insufficient',
      pace,
      shadow,
      sampleAts: uniqueAts(samples)
    });
  }
  if (input.duplicatePool === true) {
    return emptyForecast([...reasonCodes, 'shared_pool_duplicate'], {
      eligibility: 'insufficient',
      pace,
      shadow,
      sampleAts: uniqueAts(samples)
    });
  }
  if (isUnlimited(window)) {
    return emptyForecast([...reasonCodes, 'unlimited'], { eligibility: 'unknown', pace, shadow });
  }
  if (!hasInterpretableDenominator(window, metric)) {
    return emptyForecast([...reasonCodes, 'unknown_total'], { eligibility: 'unknown', pace, shadow });
  }
  if (uniqueAts(samples).length < 2) {
    const reason = metric === 'credits' && uniqueAts(samples).length <= 1
      ? 'one_shot_balance'
      : 'insufficient_samples';
    return emptyForecast([...reasonCodes, reason], { eligibility: 'insufficient', pace, shadow, sampleAts: uniqueAts(samples) });
  }

  const coverageMs = parseMs(samples[samples.length - 1].at) - parseMs(samples[0].at);
  const minIntervalMs = input.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  if (!(coverageMs >= minIntervalMs)) {
    return emptyForecast([...reasonCodes, 'coverage_too_short'], {
      eligibility: 'insufficient',
      pace,
      shadow,
      sampleAts: uniqueAts(samples)
    });
  }

  const velocity = robustVelocity(samples, options);
  if (velocity?.identitySwitch) reasonCodes.push('identity_switch');
  if (velocity?.topUpExcluded) reasonCodes.push('top_up_excluded');
  if (velocity?.outliers) reasonCodes.push('outlier_excluded');
  if (velocity?.value == null) {
    return emptyForecast([...reasonCodes, 'insufficient_samples'], {
      eligibility: 'insufficient',
      pace,
      velocity,
      shadow,
      sampleAts: velocity?.sampleAts || uniqueAts(samples)
    });
  }
  if (untrustedRolling(window)) {
    reasonCodes.push('untrusted_rolling_reset');
    return emptyForecast(reasonCodes, {
      eligibility: 'insufficient',
      precision: 'unavailable',
      pace,
      velocity,
      shadow,
      sampleAts: velocity.sampleAts
    });
  }
  if (stale) {
    reasonCodes.push('stale');
    return emptyForecast(reasonCodes, {
      eligibility: 'insufficient',
      precision: 'stale',
      confidence: STALE_CONFIDENCE_CAP,
      pace,
      velocity,
      shadow,
      sampleAts: velocity.sampleAts
    });
  }

  const latest = samples[samples.length - 1];
  const exhaust = exhaustEstimate(latest, velocity, {
    now: input.now,
    resetsAt: window.resetsAt || window.resetAt
  });
  const degraded = shadow.degraded === true;
  if (degraded) reasonCodes.push('shadow_error_high');
  if (velocity.value > 0) reasonCodes.push('short_term_velocity');
  const resetMs = parseMs(window.resetsAt || window.resetAt);
  const exhaustMs = parseMs(exhaust?.estimatedExhaustAt);
  if (exhaustMs != null && resetMs != null && exhaustMs <= resetMs) reasonCodes.push('reset_before_buffer');

  const eligible = !degraded && exhaust != null && velocity.value > 0;
  const precision = pace?.precision === 'derived' ? 'derived' : 'estimated';
  const confidence = forecastConfidence({
    velocity,
    shadow,
    stale,
    resetConfidence: numberOrNull(window.resetConfidence),
    eligible
  });
  const displayEligible = eligible && shadow.ready && !degraded;

  return stripForbidden({
    eligibility: eligible ? 'eligible' : 'insufficient',
    displayEligible,
    reasonCodes: [...new Set(reasonCodes)],
    precision,
    confidence,
    pace,
    velocity,
    exhaust: eligible ? {
      estimatedExhaustAt: exhaust.estimatedExhaustAt,
      estimatedRemainingAtReset: exhaust.estimatedRemainingAtReset,
      precision: 'estimated'
    } : null,
    shadow,
    sampleAts: velocity.sampleAts
  });
}

function forecastFromArchive(archive = {}, providers = [], options = {}) {
  const seen = new Set();
  const forecasts = [];
  for (const provider of Array.isArray(providers) ? providers : []) {
    for (const window of Array.isArray(provider.windows) ? provider.windows : []) {
      const seriesKey = quotaHistorySeriesKey({
        quotaPoolKey: provider.quotaPoolKey,
        connectionKey: provider.connectionKey,
        windowKey: windowHistoryKey(window)
      });
      if (seen.has(seriesKey)) continue;
      seen.add(seriesKey);
      forecasts.push({
        seriesKey,
        window,
        provider,
        forecast: forecastQuotaWindow({
          ...options,
          window,
          provider,
          series: archive.series?.[seriesKey] || { raw: [], hourly: [], cycles: [] },
          stale: options.stale ?? (provider.quotaStatus === 'stale')
        })
      });
    }
  }
  return forecasts;
}

const quotaForecastApi = {
  DEFAULT_MIN_INTERVAL_MS,
  MIN_SHADOW_CYCLES,
  STALE_CONFIDENCE_CAP,
  detectMetric,
  forecastFromArchive,
  forecastQuotaWindow,
  paceFacts,
  quotaHistorySeriesKey,
  robustVelocity,
  shadowBacktest,
  stripForbidden,
  windowHistoryKey
};

module.exports = quotaForecastApi;
if (typeof window !== 'undefined') window.TokenMonitorQuotaForecast = quotaForecastApi;
