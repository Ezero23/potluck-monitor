'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  geminiCredentialsPath,
  parseCredentials,
  windowsFromQuota,
  planLabelFromSubscription,
  parseResetTime,
  fetchGeminiCliLimits
} = require('../../src/shared/geminiCliLimits');

test('geminiCredentialsPath honours GEMINI_CLI_HOME and defaults to ~/.gemini', () => {
  assert.equal(
    geminiCredentialsPath({ GEMINI_CLI_HOME: '/custom/gemini' }),
    '/custom/gemini/oauth_creds.json'
  );
  assert.equal(
    geminiCredentialsPath({}).replace(/\/oauth_creds\.json$/, '').endsWith('/.gemini'),
    true
  );
});

test('parseCredentials accepts token documents and rejects junk', () => {
  const creds = parseCredentials(JSON.stringify({
    access_token: 'ya29.a0',
    refresh_token: '1//rt',
    expiry_date: 1893456000000
  }));
  assert.equal(creds.accessToken, 'ya29.a0');
  assert.equal(creds.refreshToken, '1//rt');
  assert.equal(creds.expiryMs, 1893456000000);
  assert.equal(parseCredentials('not json'), null);
  assert.equal(parseCredentials('{}'), null);
});

test('windowsFromQuota maps per-model buckets to daily session windows', () => {
  const windows = windowsFromQuota({
    buckets: [
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.25, resetTime: '2026-09-21T00:00:00Z' },
      { modelId: 'gemini-2.5-flash', remainingFraction: 1, resetTime: 1789948800 },
      { modelId: null, remainingFraction: 0.5 },
      { modelId: 'broken', remainingFraction: null }
    ]
  });
  assert.deepEqual(windows.map((window) => window.label), ['gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.equal(windows[1].kind, 'session');
  assert.equal(windows[1].usedPercent, 75);
  assert.equal(windows[1].resetsAt, '2026-09-21T00:00:00.000Z');
  // Epoch seconds resolve to an ISO timestamp.
  assert.equal(windows[0].resetsAt, new Date(1789948800 * 1000).toISOString());
});

test('planLabelFromSubscription prefers currentTier and treats free-tier as blank', () => {
  assert.equal(planLabelFromSubscription({ currentTier: { name: 'Standard' } }), 'Standard');
  assert.equal(planLabelFromSubscription({ paidTier: { id: 'free-tier' } }), '');
  assert.equal(planLabelFromSubscription({}), '');
});

test('parseResetTime handles ISO strings, epoch seconds, and junk', () => {
  assert.equal(parseResetTime('2026-09-21T00:00:00Z'), '2026-09-21T00:00:00.000Z');
  assert.equal(parseResetTime(1789948800), new Date(1789948800 * 1000).toISOString());
  assert.equal(parseResetTime(1789948800000), new Date(1789948800000).toISOString());
  assert.equal(parseResetTime('junk'), null);
});

function fakeRouteFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected url ${url}`);
    const headers = new Map(Object.entries(route.headers || {}));
    return {
      ok: route.ok !== false,
      status: route.status || 200,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      json: async () => route.body
    };
  };
  return { fetch, calls };
}

test('fetchGeminiCliLimits reports notConfigured when the CLI never signed in', async () => {
  const provider = await fetchGeminiCliLimits({}, {
    readFile: async () => { throw new Error('ENOENT'); }
  });
  assert.equal(provider.provider, 'gemini-cli');
  assert.equal(provider.status, 'notConfigured');
});

test('fetchGeminiCliLimits refreshes stale tokens and maps the quota payload', async () => {
  const credPath = '/tmp/fake/oauth_creds.json';
  const { fetch, calls } = fakeRouteFetch({
    'https://oauth2.googleapis.com/token': {
      body: { access_token: 'ya29.fresh', expires_in: 3600 }
    },
    'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist': {
      body: { cloudaicompanionProject: 'proj-77', currentTier: { name: 'Standard' } }
    },
    'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota': {
      body: { buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.5, resetTime: '2026-09-21T00:00:00Z' }] }
    }
  });
  const writes = [];
  const provider = await fetchGeminiCliLimits({}, {
    fetch,
    geminiCredentialsPath: () => credPath,
    readFile: async () => JSON.stringify({
      access_token: 'ya29.stale',
      refresh_token: '1//rt',
      expiry_date: 1000
    }),
    writeFile: async (target, text) => { writes.push({ target, text }); },
    rename: async () => {}
  });

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Standard');
  assert.equal(provider.source, 'oauth');
  assert.equal(provider.windows.length, 1);
  assert.equal(provider.windows[0].label, 'gemini-2.5-pro');
  assert.equal(provider.windows[0].usedPercent, 50);
  // The refreshed token is written back best-effort so the CLI keeps working.
  assert.equal(writes.length, 1);
  assert.ok(JSON.parse(writes[0].text).access_token === 'ya29.fresh');
  const quotaCall = calls.find((call) => call.url.includes('retrieveUserQuota'));
  assert.equal(JSON.parse(quotaCall.init.body).project, 'proj-77');
});

test('fetchGeminiCliLimits maps quota endpoint failures to error statuses', async () => {
  const credPath = '/tmp/fake/oauth_creds.json';
  const { fetch } = fakeRouteFetch({
    'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist': {
      body: { cloudaicompanionProject: 'proj-77' }
    },
    'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota': {
      ok: false,
      status: 401,
      body: null
    }
  });
  const provider = await fetchGeminiCliLimits({}, {
    fetch,
    geminiCredentialsPath: () => credPath,
    readFile: async () => JSON.stringify({ access_token: 'ya29.valid' })
  });
  assert.equal(provider.status, 'unauthorized');
  assert.deepEqual(provider.windows, []);
});
