'use strict';

// Pricing audit: decides, per model, whether tokscale can price it, so the UI
// never presents an unmatched/zero-priced catalog record as a real $0.00 cost
// (PRC-004). Lookups go through the pricing:lookup IPC (tokscale pricing <id>
// --json) and are cached in memory; a custom-pricing save or the TTL expiring
// forces a re-resolve.
(function exposePricingAudit(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorPricingAudit = api;
})(typeof window !== 'undefined' ? window : null, function createPricingAuditApi() {
  const PRICING_AUDIT_TTL_MS = 6 * 60 * 60 * 1000;

  function normalizeModelId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function rateValue(value) {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : undefined;
  }

  // Maps a raw `tokscale pricing <id> --json` payload onto an audit record.
  // A matched catalog entry whose every rate is 0 cannot be told apart from an
  // unpriced model, so it audits as unknown (reason: zero-price) rather than
  // as a genuine free tier.
  function normalizePricingResult(result) {
    if (!result || typeof result !== 'object' || result.error) {
      return { status: 'unknown', reason: 'unmatched' };
    }
    const pricing = result.pricing;
    if (!pricing || typeof pricing !== 'object') {
      return { status: 'unknown', reason: 'unmatched' };
    }
    const rates = [
      rateValue(pricing.inputCostPerToken),
      rateValue(pricing.outputCostPerToken),
      rateValue(pricing.cacheReadInputTokenCost),
      rateValue(pricing.cacheCreationInputTokenCost)
    ].filter((value) => value !== undefined);
    const matchedKey = String(result.matchedKey || '').trim();
    const source = String(result.source || '').trim();
    if (rates.some((value) => value > 0)) {
      return { status: 'priced', ...(matchedKey ? { matchedKey } : {}), ...(source ? { source } : {}) };
    }
    return {
      status: 'unknown',
      reason: 'zero-price',
      ...(matchedKey ? { matchedKey } : {}),
      ...(source ? { source } : {})
    };
  }

  function createPricingAudit(options = {}) {
    const lookup = options.lookup;
    const ttlMs = options.ttlMs || PRICING_AUDIT_TTL_MS;
    const nowFn = options.nowFn || Date.now;
    const cache = new Map();

    async function infoForModel(modelId) {
      const key = normalizeModelId(modelId);
      if (!key || typeof lookup !== 'function') return { status: 'unknown', reason: 'unmatched' };
      const cached = cache.get(key);
      if (cached && nowFn() - cached.at < ttlMs) return cached.info;
      let info;
      try {
        info = normalizePricingResult(await lookup(key));
      } catch (_) {
        info = { status: 'unknown', reason: 'unmatched' };
      }
      cache.set(key, { at: nowFn(), info });
      return info;
    }

    // Resolves every model that carries tokens in any of the given periods.
    // Serial on purpose: each lookup spawns a tokscale process.
    async function resolveModels(periods) {
      const models = new Set();
      for (const period of Object.values(periods || {})) {
        for (const model of Object.keys(period?.models || {})) {
          if (Number(period.models[model]) > 0) models.add(normalizeModelId(model));
        }
      }
      const byModel = {};
      for (const model of models) {
        byModel[model] = await infoForModel(model);
      }
      return byModel;
    }

    function invalidate() {
      cache.clear();
    }

    return { infoForModel, resolveModels, invalidate };
  }

  // Token-weighted coverage for one period: how much of its volume tokscale
  // can price. Models without an audit record count as unpriced.
  function summarizePeriod(period, byModel) {
    let pricedTokens = 0;
    let unpricedTokens = 0;
    const unpricedModels = [];
    for (const [model, value] of Object.entries(period?.models || {})) {
      const tokens = Number(value) || 0;
      if (tokens <= 0) continue;
      const info = byModel?.[normalizeModelId(model)];
      if (info?.status === 'priced') {
        pricedTokens += tokens;
      } else {
        unpricedTokens += tokens;
        unpricedModels.push(model);
      }
    }
    return { pricedTokens, unpricedTokens, unpricedModels };
  }

  return {
    PRICING_AUDIT_TTL_MS,
    normalizeModelId,
    normalizePricingResult,
    createPricingAudit,
    summarizePeriod
  };
});
