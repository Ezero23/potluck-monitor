'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  vercelApiKey,
  creditsWindow,
  fetchVercelLimits
} = require('../../src/shared/vercelLimits');

test('vercelApiKey reads settings before env and trims quotes', () => {
  assert.equal(vercelApiKey({ VERCEL_AI_GATEWAY_API_KEY: 'env' }, { vercelApiKey: ' "settings" ' }), 'settings');
  assert.equal(vercelApiKey({ VERCEL_AI_GATEWAY_API_KEY: ' env ' }), 'env');
  assert.equal(vercelApiKey({}), '');
});

test('creditsWindow parses decimal-string USD balances', () => {
  const window = creditsWindow({ balance: '95.50', total_used: '4.50' });
  assert.equal(window.kind, 'billing');
  assert.equal(window.metric, 'credits');
  assert.equal(window.remaining, 95.5);
  assert.equal(window.used, 4.5);
  assert.equal(window.currency, 'USD');
  assert.equal(window.usedPercent, null);
  assert.equal(window.showMeter, false);
  assert.equal(creditsWindow({ balance: '0' }).remaining, 0);
  assert.equal(creditsWindow({}), null);
  assert.equal(creditsWindow({ balance: 'not-a-number' }), null);
});

test('fetchVercelLimits reports notConfigured without a key', async () => {
  const provider = await fetchVercelLimits({}, { env: {} });
  assert.equal(provider.provider, 'vercel');
  assert.equal(provider.status, 'notConfigured');
});

test('fetchVercelLimits maps the credits payload', async () => {
  const provider = await fetchVercelLimits({}, {
    env: { VERCEL_AI_GATEWAY_API_KEY: 'vck_test' },
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://ai-gateway.vercel.sh/v1/credits');
      assert.equal(init.headers.Authorization, 'Bearer vck_test');
      return { ok: true, status: 200, json: async () => ({ balance: '12.75', total_used: '3.25' }) };
    }
  });

  assert.equal(provider.status, 'ok');
  assert.equal(provider.source, 'api');
  assert.equal(provider.windows.length, 1);
  assert.equal(provider.windows[0].remaining, 12.75);
});

test('fetchVercelLimits maps auth failures to unauthorized', async () => {
  const provider = await fetchVercelLimits({}, {
    env: { VERCEL_AI_GATEWAY_API_KEY: 'bad' },
    fetch: async () => ({ ok: false, status: 403 })
  });
  assert.equal(provider.status, 'unauthorized');
});
