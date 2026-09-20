'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  commandcodeApiKey,
  commandcodeBaseUrl,
  commandcodePlanLabel,
  commandcodeCreditsWindow,
  commandcodeRateWindow,
  commandcodeWindows,
  fetchCommandCodeLimits
} = require('../../src/shared/commandcodeLimits');

test('commandcodeApiKey reads settings before env and trims quoted keys', () => {
  assert.equal(commandcodeApiKey({ TOKEN_MONITOR_COMMANDCODE_API_KEY: 'env-key' }, { commandcodeApiKey: '  "settings-key"  ' }), 'settings-key');
  assert.equal(commandcodeApiKey({ TOKEN_MONITOR_COMMANDCODE_API_KEY: ' env-key ' }), 'env-key');
  assert.equal(commandcodeApiKey({ COMMANDCODE_API_KEY: 'short-name' }), 'short-name');
  assert.equal(commandcodeApiKey({ COMMAND_CODE_API_KEY: 'ninerouter-name' }), 'ninerouter-name');
  assert.equal(commandcodeApiKey({}), '');
});

test('commandcodeBaseUrl prefers options then env over the default', () => {
  assert.equal(commandcodeBaseUrl({}, { commandcodeBaseUrl: 'https://mirror.example.com/' }), 'https://mirror.example.com');
  assert.equal(commandcodeBaseUrl({ COMMAND_CODE_API_BASE_URL: 'https://env.example.com' }), 'https://env.example.com');
  assert.equal(commandcodeBaseUrl({}), 'https://api.commandcode.ai');
});

test('commandcodePlanLabel maps known plan ids and keeps unknown ids verbatim', () => {
  assert.equal(commandcodePlanLabel('individual-max'), 'Max');
  assert.equal(commandcodePlanLabel('teams-pro'), 'Teams Pro');
  assert.equal(commandcodePlanLabel('individual-something-new'), 'individual-something-new');
  assert.equal(commandcodePlanLabel(''), '');
});

test('commandcodeCreditsWindow sums credit sources and derives used from the plan cap', () => {
  const window = commandcodeCreditsWindow(
    { monthlyCredits: 22, purchasedCredits: 5, freeCredits: 3 },
    30,
    '2026-10-01T00:00:00Z'
  );
  assert.equal(window.kind, 'billing');
  assert.equal(window.metric, 'credits');
  assert.equal(window.remaining, 30);
  assert.equal(window.used, 0);
  assert.equal(window.limit, 30);
  assert.equal(window.usedPercent, 0);
  assert.equal(window.currency, 'USD');
  assert.equal(window.resetsAt, '2026-10-01T00:00:00.000Z');
});

test('commandcodeCreditsWindow keeps balance-only display for unknown plans', () => {
  const window = commandcodeCreditsWindow({ purchasedCredits: 12 }, 0, null);
  assert.equal(window.remaining, 12);
  assert.equal(window.limit, null);
  assert.equal(window.used, 0);
  assert.equal(window.usedPercent, null);
  assert.equal(window.showMeter, false);
  assert.equal(commandcodeCreditsWindow({}, 0, null), null);
});

test('commandcodeRateWindow maps 5h and weekly windows', () => {
  const session = commandcodeRateWindow({ used: 4, cap: 40, resetAt: '2026-09-21T10:00:00Z' }, 'session');
  assert.equal(session.kind, 'session');
  assert.equal(session.label, 'Session (5h)');
  assert.equal(session.usedPercent, 10);
  assert.equal(session.windowMinutes, 300);
  const weekly = commandcodeRateWindow({ used: 100, cap: 500 }, 'weekly');
  assert.equal(weekly.kind, 'weekly');
  assert.equal(weekly.label, 'Weekly');
  assert.equal(weekly.windowMinutes, 10_080);
  assert.equal(commandcodeRateWindow(null, 'session'), null);
  assert.equal(commandcodeRateWindow({ used: 0, cap: 0 }, 'weekly'), null);
});

test('commandcodeWindows builds credits, session, and weekly in order', () => {
  const windows = commandcodeWindows(
    {
      credits: { monthlyCredits: 10, purchasedCredits: 0, freeCredits: 0 },
      windowLimits: {
        fiveHour: { used: 2, cap: 10, resetAt: '2026-09-21T10:00:00Z' },
        weekly: { used: 20, cap: 100, resetAt: '2026-09-24T10:00:00Z' }
      }
    },
    'individual-pro',
    '2026-10-01T00:00:00Z'
  );
  assert.deepEqual(windows.map((window) => window.kind), ['billing', 'session', 'weekly']);
  assert.equal(windows[0].metric, 'credits');
  assert.equal(windows[0].used, 20);
  assert.equal(windows[0].remaining, 10);
});

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected url ${url}`);
    return {
      ok: route.ok !== false,
      status: route.status || 200,
      json: async () => route.body
    };
  };
  return { fetch, calls };
}

test('fetchCommandCodeLimits reports notConfigured without a key', async () => {
  const provider = await fetchCommandCodeLimits({}, { env: {} });
  assert.equal(provider.provider, 'commandcode');
  assert.equal(provider.status, 'notConfigured');
  assert.deepEqual(provider.windows, []);
});

test('fetchCommandCodeLimits maps whoami, credits, and subscriptions into windows', async () => {
  const base = 'https://api.commandcode.ai';
  const { fetch, calls } = fakeFetch({
    [`${base}/alpha/whoami?limits=1`]: { body: { org: { id: 'org-123' } } },
    [`${base}/alpha/billing/credits?orgId=org-123`]: {
      body: {
        credits: { monthlyCredits: 130, purchasedCredits: 0, freeCredits: 5 },
        windowLimits: {
          fiveHour: { used: 3, cap: 30, resetAt: '2026-09-21T10:00:00Z' },
          weekly: { used: 45, cap: 300, resetAt: '2026-09-24T10:00:00Z' }
        }
      }
    },
    [`${base}/alpha/billing/subscriptions?orgId=org-123`]: {
      body: { data: { planId: 'individual-max', currentPeriodEnd: '2026-10-01T00:00:00Z' } }
    }
  });

  const provider = await fetchCommandCodeLimits(
    {},
    { env: { TOKEN_MONITOR_COMMANDCODE_API_KEY: 'sk-test' }, fetch }
  );

  assert.equal(provider.status, 'ok');
  assert.equal(provider.source, 'api');
  assert.equal(provider.accountLabel, 'Max');
  assert.equal(provider.accountKey.startsWith('sha256:'), true);
  // normalizeLimitProvider re-sorts windows by kind: session, weekly, billing.
  assert.deepEqual(provider.windows.map((window) => window.kind), ['session', 'weekly', 'billing']);
  const credits = provider.windows.find((window) => window.metric === 'credits');
  assert.equal(credits.remaining, 135);
  assert.equal(credits.limit, 150);
  assert.equal(credits.resetsAt, '2026-10-01T00:00:00.000Z');
  assert.equal(calls.length, 3);
  assert.ok(calls[1].includes('orgId=org-123'));
});

test('fetchCommandCodeLimits degrades to balance-only when subscriptions fail', async () => {
  const base = 'https://api.commandcode.ai';
  const { fetch } = fakeFetch({
    [`${base}/alpha/whoami?limits=1`]: { body: {} },
    [`${base}/alpha/billing/credits`]: {
      body: { credits: { purchasedCredits: 12 } }
    },
    [`${base}/alpha/billing/subscriptions`]: { ok: false, status: 500, body: null }
  });

  const provider = await fetchCommandCodeLimits(
    {},
    { env: { COMMANDCODE_API_KEY: 'sk-test' }, fetch }
  );

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, '');
  assert.equal(provider.windows.length, 1);
  assert.equal(provider.windows[0].metric, 'credits');
  assert.equal(provider.windows[0].limit, null);
});

test('fetchCommandCodeLimits maps auth failures to unauthorized', async () => {
  const base = 'https://api.commandcode.ai';
  const { fetch } = fakeFetch({
    [`${base}/alpha/whoami?limits=1`]: { ok: false, status: 401, body: null }
  });

  const provider = await fetchCommandCodeLimits(
    {},
    { env: { TOKEN_MONITOR_COMMANDCODE_API_KEY: 'sk-bad' }, fetch }
  );

  assert.equal(provider.status, 'unauthorized');
  assert.deepEqual(provider.windows, []);
});
