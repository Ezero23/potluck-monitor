'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  groqApiKey,
  parseGroqDurationMs,
  windowsFromHeaders,
  fetchGroqLimits
} = require('../../src/shared/groqLimits');

function fakeHeaders(map) {
  return { get: (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null) };
}

test('groqApiKey reads settings before env and trims quotes', () => {
  assert.equal(groqApiKey({ GROQ_API_KEY: 'env' }, { groqApiKey: ' "settings" ' }), 'settings');
  assert.equal(groqApiKey({ GROQ_API_KEY: ' env ' }), 'env');
  assert.equal(groqApiKey({ TOKEN_MONITOR_GROQ_API_KEY: 'tm' }), 'tm');
  assert.equal(groqApiKey({}), '');
});

test('parseGroqDurationMs parses Go-style duration strings', () => {
  assert.equal(parseGroqDurationMs('2m59.56s'), 2 * 60_000 + 59_560);
  assert.equal(parseGroqDurationMs('7.66s'), 7_660);
  assert.equal(parseGroqDurationMs('1h30m'), 5_400_000);
  assert.equal(parseGroqDurationMs('500ms'), 500);
  assert.equal(parseGroqDurationMs(''), null);
  assert.equal(parseGroqDurationMs('soon'), null);
});

test('windowsFromHeaders maps requests and tokens, skipping absent pairs', () => {
  const now = 1_789_948_800_000;
  const windows = windowsFromHeaders(fakeHeaders({
    'x-ratelimit-limit-requests': '14400',
    'x-ratelimit-remaining-requests': '14000',
    'x-ratelimit-reset-requests': '299.56s',
    'x-ratelimit-limit-tokens': '30000',
    'x-ratelimit-remaining-tokens': '0'
  }), now);

  assert.deepEqual(windows.map((window) => window.label), ['Requests', 'Tokens']);
  assert.equal(windows[0].kind, 'session');
  assert.equal(windows[0].used, 400);
  assert.equal(windows[0].usedPercent, 400 / 14400 * 100);
  assert.equal(windows[0].resetsAt, new Date(now + 299_560).toISOString());
  assert.equal(windows[1].usedPercent, 100);

  // A missing pair must not read as a real "0 remaining" quota.
  assert.deepEqual(windowsFromHeaders(fakeHeaders({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '90'
  }), now).map((window) => window.label), ['Requests']);
});

test('fetchGroqLimits reports notConfigured without a key', async () => {
  const provider = await fetchGroqLimits({}, { env: {} });
  assert.equal(provider.provider, 'groq');
  assert.equal(provider.status, 'notConfigured');
});

test('fetchGroqLimits reads quota from the models response headers', async () => {
  const provider = await fetchGroqLimits({}, {
    env: { GROQ_API_KEY: 'gsk_test' },
    now: () => 1_789_948_800_000,
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://api.groq.com/openai/v1/models');
      assert.equal(init.headers.Authorization, 'Bearer gsk_test');
      return {
        ok: true,
        status: 200,
        headers: fakeHeaders({
          'x-ratelimit-limit-requests': '14400',
          'x-ratelimit-remaining-requests': '14399'
        }),
        text: async () => '{"data":[]}'
      };
    }
  });

  assert.equal(provider.status, 'ok');
  assert.equal(provider.windows.length, 1);
  assert.equal(provider.windows[0].label, 'Requests');
});

test('fetchGroqLimits maps auth failures to unauthorized', async () => {
  const provider = await fetchGroqLimits({}, {
    env: { GROQ_API_KEY: 'bad' },
    fetch: async () => ({ ok: false, status: 401 })
  });
  assert.equal(provider.status, 'unauthorized');
});
