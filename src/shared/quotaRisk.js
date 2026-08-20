'use strict';

const quotaForecastPeer = (() => {
  try {
    return require('./quotaForecast');
  } catch {
    return null;
  }
})();

const {
  forecastFromArchive,
  forecastQuotaWindow,
  stripForbidden
} = quotaForecastPeer || (typeof window !== 'undefined' ? window.TokenMonitorQuotaForecast : null) || {
  forecastFromArchive: () => [],
  forecastQuotaWindow: () => ({ eligibility: 'insufficient', exhaust: null }),
  stripForbidden: (value) => value
};

const RISK_STATES = Object.freeze([
  'exhausted',
  'likely_to_exhaust',
  'watch',
  'stale',
  'normal',
  'unknown'
]);

const DEFAULT_WATCH_REMAINING_PERCENT = 20;
const STALE_CONFIDENCE_CAP = 0.4;
const LOW_RESET_CONFIDENCE_CAP = 0.5;
const LOW_RESET_CONFIDENCE = 0.6;

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function windowMetric(window = {}, forecast) {
  if (window.metric === 'credits') return 'credits';
  if (forecast?.velocity?.metric) return forecast.velocity.metric;
  if (numberOrNull(window.usedPercent) != null) return 'percent';
  if (numberOrNull(window.remaining) != null) return 'credits';
  if (numberOrNull(window.used) != null) return 'requests';
  return 'percent';
}

function remainingPercent(window = {}) {
  const remaining = numberOrNull(window.remainingPercent);
  if (remaining != null) return remaining;
  const used = numberOrNull(window.usedPercent);
  if (used != null) return 100 - used;
  const usedAbs = numberOrNull(window.used);
  const limit = numberOrNull(window.limit);
  if (usedAbs != null && limit != null && limit > 0) return ((limit - usedAbs) / limit) * 100;
  return null;
}

function isTrueZero(window = {}) {
  if (numberOrNull(window.remaining) === 0) return true;
  if (numberOrNull(window.remainingPercent) === 0) return true;
  const usedPercent = numberOrNull(window.usedPercent);
  if (usedPercent != null && usedPercent >= 100) return true;
  const used = numberOrNull(window.used);
  const limit = numberOrNull(window.limit);
  return used != null && limit != null && limit > 0 && used >= limit;
}

function isStale(input = {}, forecast) {
  if (input.stale === true) return true;
  const window = input.window || {};
  const provider = input.provider || {};
  if (window.quotaStatus === 'stale' || provider.quotaStatus === 'stale') return true;
  return Array.isArray(forecast?.reasonCodes) && forecast.reasonCodes.includes('stale');
}

function annotationFlags(annotation = {}) {
  return {
    muted: annotation.muted === true,
    expected: annotation.expected === true
  };
}

function baseRisk(state, reasonCodes, extras = {}) {
  return stripForbidden({
    state,
    metric: extras.metric || 'percent',
    confidence: extras.confidence ?? 0,
    reasonCodes: [...new Set(reasonCodes)],
    muted: extras.muted === true,
    expected: extras.expected === true,
    exhaust: extras.exhaust || null,
    forecastEligibility: extras.forecastEligibility || null,
    displayEligible: extras.displayEligible === true
  });
}

function capConfidence(value, cap) {
  if (value == null) return cap;
  return round(clamp(Math.min(value, cap), 0, 1));
}

function evaluateQuotaMetric(input, metric) {
  const window = input.window || {};
  const forecast = input.forecast || forecastQuotaWindow(input);
  const flags = annotationFlags(input.annotation);
  const extras = {
    metric,
    muted: flags.muted,
    expected: flags.expected,
    forecastEligibility: forecast.eligibility,
    displayEligible: forecast.displayEligible === true
  };
  const reasonCodes = [];
  if (flags.muted) reasonCodes.push('user_muted');
  if (flags.expected) reasonCodes.push('user_expected');

  if (isTrueZero(window)) {
    return baseRisk('exhausted', [...reasonCodes, 'true_zero'], {
      ...extras,
      confidence: 1,
      exhaust: null
    });
  }

  const stale = isStale(input, forecast);
  const resetConfidence = numberOrNull(window.resetConfidence);
  let confidence = forecast.confidence ?? 0.1;
  if (stale) confidence = capConfidence(confidence, STALE_CONFIDENCE_CAP);
  if (resetConfidence != null && resetConfidence < LOW_RESET_CONFIDENCE) {
    confidence = capConfidence(confidence, LOW_RESET_CONFIDENCE_CAP);
    reasonCodes.push('low_reset_confidence');
  }

  if (stale) {
    return baseRisk('stale', [...reasonCodes, 'stale_snapshot'], {
      ...extras,
      confidence,
      exhaust: null
    });
  }

  if (forecast.eligibility !== 'eligible' || !forecast.exhaust) {
    const fallback = forecast.reasonCodes?.length ? forecast.reasonCodes : ['insufficient_history'];
    return baseRisk('unknown', [...reasonCodes, ...fallback], {
      ...extras,
      confidence,
      exhaust: null
    });
  }

  const exhaustAt = parseMs(forecast.exhaust.estimatedExhaustAt);
  const resetsAt = parseMs(window.resetsAt || window.resetAt);
  if (exhaustAt != null && resetsAt != null && exhaustAt <= resetsAt) {
    return baseRisk('likely_to_exhaust', [...reasonCodes, 'exhaust_before_reset', ...forecast.reasonCodes], {
      ...extras,
      confidence,
      exhaust: {
        estimatedExhaustAt: forecast.exhaust.estimatedExhaustAt,
        estimatedRemainingAtReset: forecast.exhaust.estimatedRemainingAtReset
      }
    });
  }

  const watchPercent = numberOrNull(input.watchRemainingPercent) ?? DEFAULT_WATCH_REMAINING_PERCENT;
  const remaining = remainingPercent(window);
  const remainingAtReset = numberOrNull(forecast.exhaust.estimatedRemainingAtReset);
  const remainingAtResetPercent = metric === 'percent' ? remainingAtReset : null;
  const paceDelta = numberOrNull(forecast.pace?.paceDelta);
  const watchReasons = [];
  if (remaining != null && remaining <= watchPercent) watchReasons.push('low_remaining');
  if (remainingAtResetPercent != null && remainingAtResetPercent <= watchPercent) watchReasons.push('low_remaining_at_reset');
  if (paceDelta != null && paceDelta >= 0.15) watchReasons.push('ahead_of_pace');
  if (watchReasons.length > 0) {
    return baseRisk('watch', [...reasonCodes, ...watchReasons], {
      ...extras,
      confidence,
      exhaust: {
        estimatedExhaustAt: forecast.exhaust.estimatedExhaustAt,
        estimatedRemainingAtReset: forecast.exhaust.estimatedRemainingAtReset
      }
    });
  }

  return baseRisk('normal', [...reasonCodes, 'within_pace'], {
    ...extras,
    confidence,
    exhaust: {
      estimatedExhaustAt: forecast.exhaust.estimatedExhaustAt,
      estimatedRemainingAtReset: forecast.exhaust.estimatedRemainingAtReset
    }
  });
}

function evaluateQuotaMetrics(input = {}) {
  const window = input.window || {};
  const forecast = input.forecast || forecastQuotaWindow(input);
  const metrics = {
    percent: null,
    credits: null,
    requests: null
  };
  if (numberOrNull(window.usedPercent) != null || (numberOrNull(window.used) != null && numberOrNull(window.limit) != null)) {
    metrics.percent = evaluateQuotaMetric({ ...input, forecast }, 'percent');
  }
  if (window.metric === 'credits' || (numberOrNull(window.remaining) != null && window.metric === 'credits')) {
    metrics.credits = evaluateQuotaMetric({ ...input, forecast }, 'credits');
  }
  if (numberOrNull(window.used) != null && window.metric !== 'credits' && numberOrNull(window.usedPercent) == null) {
    metrics.requests = evaluateQuotaMetric({ ...input, forecast }, 'requests');
  }
  return metrics;
}

function evaluateQuotaRisk(input = {}) {
  const forecast = input.forecast || forecastQuotaWindow(input);
  const metric = windowMetric(input.window || {}, forecast);
  const primary = evaluateQuotaMetric({ ...input, forecast }, metric);
  return stripForbidden({
    ...primary,
    byMetric: evaluateQuotaMetrics({ ...input, forecast })
  });
}

function stateRank(state) {
  const index = RISK_STATES.indexOf(state);
  return index === -1 ? RISK_STATES.length : index;
}

function bindingQuotaConstraint(risks = []) {
  const list = (Array.isArray(risks) ? risks : []).filter(Boolean);
  if (list.length === 0) return null;
  const scored = list.map((risk, index) => ({
    risk,
    index,
    rank: stateRank(risk.state),
    exhaustAt: parseMs(risk.exhaust?.estimatedExhaustAt)
  }));
  scored.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.exhaustAt != null && right.exhaustAt != null && left.exhaustAt !== right.exhaustAt) {
      return left.exhaustAt - right.exhaustAt;
    }
    return left.index - right.index;
  });
  const winner = scored[0];
  const reason = winner.risk.state === 'exhausted'
    ? 'already_exhausted'
    : winner.risk.exhaust?.estimatedExhaustAt
      ? 'earliest_exhaust'
      : 'highest_severity';
  return stripForbidden({
    ...winner.risk,
    bindingReason: reason
  });
}

function evaluateProviderRisks(archive, providers, options = {}) {
  const items = forecastFromArchive(archive, providers, options);
  const risks = items.map((item) => evaluateQuotaRisk({
    ...options,
    window: item.window,
    provider: item.provider,
    forecast: item.forecast,
    stale: item.provider?.quotaStatus === 'stale'
  }));
  return {
    items,
    risks,
    binding: bindingQuotaConstraint(risks)
  };
}

const quotaRiskApi = {
  RISK_STATES,
  bindingQuotaConstraint,
  evaluateProviderRisks,
  evaluateQuotaMetrics,
  evaluateQuotaRisk
};

if (typeof window !== 'undefined') window.TokenMonitorQuotaRisk = quotaRiskApi;
if (typeof module === 'object' && module.exports) module.exports = quotaRiskApi;
