'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPricingAudit,
  normalizeModelId,
  normalizePricingResult,
  summarizePeriod
} = require('../../src/electron/renderer/pricingAudit');

test('normalizePricingResult marks a priced catalog match', () => {
  assert.deepEqual(
    normalizePricingResult({
      matchedKey: 'kimi-for-coding/k3',
      source: 'LiteLLM',
      pricing: { inputCostPerToken: 1e-6, outputCostPerToken: 4e-6, cacheReadInputTokenCost: 1e-7 }
    }),
    { status: 'priced', matchedKey: 'kimi-for-coding/k3', source: 'LiteLLM' }
  );
});

test('normalizePricingResult treats an all-zero catalog record as unknown', () => {
  // PRC-004: a zero-priced match cannot be told apart from "free", so it must
  // never surface as a trustworthy $0.00.
  assert.deepEqual(
    normalizePricingResult({
      matchedKey: 'kimi-for-coding/k3-256k',
      source: 'Models.dev',
      pricing: { inputCostPerToken: 0, outputCostPerToken: 0, cacheReadInputTokenCost: 0, cacheCreationInputTokenCost: 0 }
    }),
    { status: 'unknown', reason: 'zero-price', matchedKey: 'kimi-for-coding/k3-256k', source: 'Models.dev' }
  );
});

test('normalizePricingResult maps errors and missing pricing to unmatched', () => {
  assert.deepEqual(normalizePricingResult({ error: 'Model not found', modelId: 'x' }), { status: 'unknown', reason: 'unmatched' });
  assert.deepEqual(normalizePricingResult(null), { status: 'unknown', reason: 'unmatched' });
  assert.deepEqual(normalizePricingResult({ modelId: 'x' }), { status: 'unknown', reason: 'unmatched' });
});

test('createPricingAudit caches lookups and honors the TTL', async () => {
  let now = 1_000;
  let calls = 0;
  const audit = createPricingAudit({
    lookup: async () => { calls += 1; return { pricing: { inputCostPerToken: 1e-6 } }; },
    nowFn: () => now
  });
  const first = await audit.infoForModel('K3');
  assert.equal(first.status, 'priced');
  await audit.infoForModel('k3');
  assert.equal(calls, 1);
  now += 7 * 60 * 60 * 1000;
  await audit.infoForModel('k3');
  assert.equal(calls, 2);
});

test('createPricingAudit survives lookup failures as unmatched', async () => {
  const audit = createPricingAudit({ lookup: async () => { throw new Error('spawn failed'); } });
  assert.deepEqual(await audit.infoForModel('broken'), { status: 'unknown', reason: 'unmatched' });
});

test('createPricingAudit invalidate forces re-resolution', async () => {
  let calls = 0;
  const audit = createPricingAudit({ lookup: async () => { calls += 1; return { pricing: { inputCostPerToken: 1e-6 } }; } });
  await audit.infoForModel('k3');
  audit.invalidate();
  await audit.infoForModel('k3');
  assert.equal(calls, 2);
});

test('resolveModels unions models with tokens across periods', async () => {
  const seen = [];
  const audit = createPricingAudit({
    lookup: async (id) => { seen.push(id); return { pricing: { inputCostPerToken: 1e-6 } }; }
  });
  const byModel = await audit.resolveModels({
    today: { models: { K3: 100, Zero: 0 } },
    month: { models: { k3: 200, 'gpt-5': 50 } }
  });
  assert.deepEqual(seen, ['k3', 'gpt-5']);
  assert.equal(byModel.k3.status, 'priced');
  assert.equal(byModel['gpt-5'].status, 'priced');
  assert.equal(byModel.zero, undefined);
});

test('summarizePeriod splits priced and unpriced tokens', () => {
  const summary = summarizePeriod(
    { models: { k3: 300, 'k3-256k': 700, gone: 0 } },
    { k3: { status: 'priced' }, 'k3-256k': { status: 'unknown', reason: 'zero-price' } }
  );
  assert.equal(summary.pricedTokens, 300);
  assert.equal(summary.unpricedTokens, 700);
  assert.deepEqual(summary.unpricedModels, ['k3-256k']);
});

test('summarizePeriod counts models without an audit record as unpriced', () => {
  const summary = summarizePeriod({ models: { k3: 100 } }, null);
  assert.equal(summary.pricedTokens, 0);
  assert.equal(summary.unpricedTokens, 100);
  assert.deepEqual(summary.unpricedModels, ['k3']);
});

test('normalizeModelId trims and lowercases', () => {
  assert.equal(normalizeModelId('  K3-256K '), 'k3-256k');
  assert.equal(normalizeModelId(null), '');
});
