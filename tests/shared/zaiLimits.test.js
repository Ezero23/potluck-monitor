'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  zaiToken,
  zaiRegion,
  zaiQuotaUrl,
  zaiSubscriptionUrl,
  zaiSubscriptionIdentity,
  parseZaiUsage,
  fetchZaiLimits
} = require('../../src/shared/zaiLimits');

test('zaiToken accepts Z.ai and GLM compatible API key env names', () => {
  assert.equal(zaiToken({ ZAI_API_KEY: '  "zai-key"  ' }), 'zai-key');
  assert.equal(zaiToken({ Z_AI_API_KEY: 'z-ai-key' }), 'z-ai-key');
  assert.equal(zaiToken({ GLM_API_KEY: 'glm-key' }), 'glm-key');
  assert.equal(zaiToken({ ZHIPU_API_KEY: 'zhipu-key' }), 'zhipu-key');
  assert.equal(zaiToken({}, 'settings-key'), 'settings-key');
  assert.equal(zaiToken({ OPENAI_API_KEY: 'unrelated' }), '');
});

test('zaiRegion maps global and BigModel CN hosts', () => {
  assert.equal(zaiRegion({ zaiApiRegion: 'bigmodel-cn' }), 'bigmodel-cn');
  assert.equal(zaiRegion({ zaiApiRegion: 'cn' }), 'bigmodel-cn');
  assert.equal(zaiRegion({}, { Z_AI_API_HOST: 'open.bigmodel.cn' }), 'bigmodel-cn');
  assert.equal(zaiRegion({}, { TOKEN_MONITOR_ZAI_API_REGION: 'global' }), 'global');
  assert.equal(zaiQuotaUrl('bigmodel-cn'), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  assert.equal(zaiSubscriptionUrl('bigmodel-cn'), 'https://open.bigmodel.cn/api/biz/subscription/list');
});

test('parseZaiUsage maps quota windows to CodexBar labels and order', () => {
  const usage = parseZaiUsage({
    data: {
      level: 'pro',
      limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 1000, currentValue: 120, remaining: 850, percentage: 12.5 },
        { type: 'TOKENS_LIMIT', unit: 6, number: 1, usage: 2000, currentValue: 250, remaining: 1500, percentage: 25 },
        { type: 'TIME_LIMIT', remaining: 9, percentage: 40 }
      ]
    }
  }, {
    data: [
      { product_name: 'GLM Coding Pro', next_renew_time: '2026-07-13T00:00:00Z' }
    ]
  });

  assert.equal(usage.plan, 'GLM Coding Pro');
  assert.equal(usage.windows.length, 3);
  assert.equal(usage.windows[0].kind, 'session');
  assert.equal(usage.windows[0].label, '5-hour');
  assert.equal(usage.windows[0].usedPercent, 15);
  assert.equal(usage.windows[0].windowMinutes, 5 * 60);
  assert.equal(usage.windows[0].resetsAt, undefined);
  assert.equal(usage.windows[1].kind, 'weekly');
  assert.equal(usage.windows[1].label, 'Weekly');
  assert.equal(usage.windows[1].usedPercent, 25);
  assert.equal(usage.windows[1].windowMinutes, 7 * 24 * 60);
  assert.equal(usage.windows[2].kind, 'billing');
  assert.equal(usage.windows[2].label, 'Monthly');
  assert.equal(usage.windows[2].remaining, 9);
  assert.equal(usage.windows[2].usedPercent, 40);
  assert.equal(usage.windows[2].resetsAt, '2026-07-13T00:00:00.000Z');
});

test('parseZaiUsage treats a single 5-hour token limit as the old-plan session window', () => {
  const usage = parseZaiUsage({
    data: {
      limits: [
        { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 100, currentValue: 13, remaining: 87, percentage: 13 },
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12, nextResetTime: '2026-07-07T18:00:00Z' }
      ]
    }
  });

  assert.equal(usage.windows.length, 2);
  assert.equal(usage.windows[0].kind, 'session');
  assert.equal(usage.windows[0].label, '5-hour');
  assert.equal(usage.windows[0].usedPercent, 12);
  assert.equal(usage.windows[0].windowMinutes, 5 * 60);
  assert.equal(usage.windows[1].kind, 'billing');
  assert.equal(usage.windows[1].label, 'Monthly');
  // MCP is a monthly bucket; z.ai encodes it as a misleading unit=5/number=1
  // (1-minute) marker, so drop windowMinutes and label the cadence Monthly.
  assert.equal(usage.windows[1].windowMinutes, undefined);
  assert.equal(usage.windows[1].resetDescription, 'Monthly');
  assert.equal(usage.windows.find((window) => window.kind === 'weekly'), undefined);
});

test('parseZaiUsage keeps a live 5-hour nextResetTime and leaves unused 5-hour blank', () => {
  const inUse = parseZaiUsage({
    data: {
      limits: [
        {
          type: 'CREDIT_LIMIT',
          unit: 3,
          number: 5,
          usage: 2000,
          remaining: 1200,
          percentage: 40,
          nextResetTime: 1788616800000
        },
        {
          type: 'CREDIT_LIMIT',
          unit: 6,
          number: 1,
          usage: 2000,
          remaining: 0,
          percentage: 100,
          nextResetTime: 1788836659998
        }
      ]
    }
  });
  assert.equal(inUse.windows[0].kind, 'session');
  assert.equal(inUse.windows[0].resetsAt, new Date(1788616800000).toISOString());
  assert.equal(inUse.windows[1].kind, 'weekly');
  assert.equal(inUse.windows[1].resetsAt, new Date(1788836659998).toISOString());

  const unused = parseZaiUsage({
    data: {
      limits: [
        { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, remaining: 2000, percentage: 0 },
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 2000, remaining: 0, percentage: 100, nextResetTime: 1788836659998 }
      ]
    }
  });
  assert.equal(unused.windows[0].resetsAt, undefined);
  assert.equal(unused.windows[1].resetsAt, new Date(1788836659998).toISOString());
});

test('parseZaiUsage reads official plan labels from subscription or quota payloads', () => {
  assert.equal(
    parseZaiUsage({ data: { level: 'lite', limits: [] } }, { data: [{ planName: 'Lite' }] }).plan,
    'Lite'
  );
  assert.equal(
    parseZaiUsage({ data: { packageName: 'max', limits: [] } }, null).plan,
    'Max'
  );
  assert.equal(
    parseZaiUsage({ data: { plan_type: 'coding_pro', limits: [] } }, null).plan,
    'Coding Pro'
  );
  assert.equal(
    parseZaiUsage({ data: { planName: 'z.ai max', limits: [] } }, null).plan,
    'Z.ai Max'
  );
});

test('Z.ai subscription identity uses an explicit subscription id before account fallbacks', () => {
  assert.equal(
    zaiSubscriptionIdentity({ data: { userId: 'quota-user' } }, {
      data: [{ id: 'sub-123', user_id: 'subscription-user' }]
    }),
    'subscription:sub-123'
  );
  assert.equal(
    zaiSubscriptionIdentity({ data: { accountId: 'account-456' } }, null),
    'account:account-456'
  );
  assert.equal(zaiSubscriptionIdentity({ data: {} }, { data: [{}] }), '');
});

test('fetchZaiLimits returns notConfigured without an API key', async () => {
  const provider = await fetchZaiLimits({}, { env: {}, now: () => Date.parse('2026-07-06T00:00:00Z') });
  assert.equal(provider.provider, 'zai');
  assert.equal(provider.source, 'api');
  assert.equal(provider.status, 'notConfigured');
});

test('fetchZaiLimits requests quota and subscription with Coding Plan token auth', async () => {
  const urls = [];
  const auth = [];
  const provider = await fetchZaiLimits(
    { zaiApiKey: 'zai-token' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: async (url, init) => {
        urls.push(String(url));
        auth.push(init.headers.Authorization);
        if (String(url).includes('/quota/limit')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                limits: [
                  { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 10 }
                ]
              }
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ product_name: 'GLM Coding' }] })
        };
      }
    }
  );

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'GLM Coding');
  assert.equal(provider.windows.length, 1);
  assert.deepEqual(urls, [
    'https://api.z.ai/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/biz/subscription/list'
  ]);
  assert.deepEqual(auth, ['zai-token', 'zai-token']);
});

test('fetchZaiLimits requests the selected BigModel CN region with the raw Coding Plan token', async () => {
  const urls = [];
  const auth = [];
  const provider = await fetchZaiLimits(
    { zaiApiKey: 'zai-token', zaiApiRegion: 'bigmodel-cn' },
    {
      env: {},
      now: () => Date.parse('2026-07-06T00:00:00Z'),
      fetch: async (url, init) => {
        urls.push(String(url));
        auth.push(init.headers.Authorization);
        if (String(url).includes('/quota/limit')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                limits: [
                  { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 20 }
                ]
              }
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ product_name: 'GLM Coding CN' }] })
        };
      }
    }
  );

  assert.equal(provider.status, 'ok');
  assert.equal(provider.region, 'bigmodel-cn');
  assert.deepEqual(urls, [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://open.bigmodel.cn/api/biz/subscription/list'
  ]);
  assert.deepEqual(auth, ['zai-token', 'zai-token']);
});

test('fetchZaiLimits physically aborts a hung request within its configured bound', async () => {
  let signal;
  const provider = await fetchZaiLimits(
    { zaiApiKey: 'hung-key' },
    {
      env: {},
      zaiFetchTimeoutMs: 5,
      fetch: async (_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      }
    }
  );

  assert.equal(provider.status, 'unavailable');
  assert.equal(signal.aborted, true);
});

test('fetchZaiLimits returns an opaque fingerprint email matching the web GLM handler', async () => {
  const provider = await fetchZaiLimits({ zaiApiKey: 'fp-key' }, {
    env: {},
    fetch: async () => ({ ok: true, json: async () => ({ data: { limits: [
      { type: 'CREDIT_LIMIT', unit: 5, number: 5, usage: 100, remaining: 20, nextResetTime: 1766036400000 }
    ] } }) }),
    zaiFetchTimeoutMs: 1000
  });
  assert.match(provider.accountEmail, /^glm-[0-9a-f]{64}@glm-account\.local$/);
  // Same recipe the web handler uses (sha256 of "zai\0<key>\0"), so the same
  // API key yields the same fingerprint on both sides and the rows merge.
  const expected = require('node:crypto').createHash('sha256')
    .update('zai').update('\0').update('fp-key').update('\0').digest('hex');
  assert.equal(provider.accountEmail, `glm-${expected}@glm-account.local`);
});

test('different GLM keys merge only when the provider reports the same stable subscription', async () => {
  async function fetchFor(key, subscriptionId) {
    return fetchZaiLimits({ zaiApiKey: key }, {
      env: {},
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => String(url).includes('/subscription/list')
          ? { data: [{ id: subscriptionId, product_name: 'GLM Coding' }] }
          : { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 25 }] } }
      })
    });
  }

  const first = await fetchFor('key-a', 'subscription-shared');
  const second = await fetchFor('key-b', 'subscription-shared');
  const different = await fetchFor('key-c', 'subscription-other');

  assert.equal(first.accountKey, second.accountKey);
  assert.equal(first.quotaPoolKey, second.quotaPoolKey);
  assert.notEqual(first.connectionKey, second.connectionKey);
  assert.notEqual(first.accountKey, different.accountKey);
  assert.notEqual(first.quotaPoolKey, different.quotaPoolKey);
  assert.equal(first.identityKind, 'connection');
  assert.equal(first.authType, 'apikey');
});
