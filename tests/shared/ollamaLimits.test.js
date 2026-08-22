'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeOllamaCookieHeader,
  ollamaSessionCookie,
  ollamaApiKey,
  rememberOllamaValidation,
  parseOllamaUsageHtml,
  parseOllamaUsageJson,
  fetchOllamaLimits
} = require('../../src/shared/ollamaLimits');
const { hashKey } = require('../../src/shared/hashKey');

const SETTINGS_HTML = `
<span>Cloud Usage</span><span>Pro</span>
<span id="header-email">USER@example.com</span>
<section aria-label="Session usage 14.5% used">
  <div style="width: 14.5%"></div>
  <div data-time="2026-07-09T08:00:00Z">Resets soon</div>
</section>
<section><span>Weekly usage</span><span>10.3% used</span>
  <div data-time="2026-07-13T00:00:00Z"></div>
</section>`;

function response(status, { location, html = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'location' ? (location || null) : null },
    text: async () => html
  };
}

test('normalizes recognized named Ollama cookies and rejects bare values', () => {
  assert.equal(normalizeOllamaCookieHeader('wos-session=current'), 'wos-session=current');
  assert.equal(normalizeOllamaCookieHeader('Cookie: aid=1; wos-session=current; cf_clearance=ok'), 'aid=1; wos-session=current; cf_clearance=ok');
  assert.equal(normalizeOllamaCookieHeader('__Secure-session=legacy'), '__Secure-session=legacy');
  const rawToken = `${'a'.repeat(80)}==`;
  assert.equal(normalizeOllamaCookieHeader(rawToken), '');
  assert.equal(normalizeOllamaCookieHeader('raw-token-without-name'), '');
});

test('requires an exact recognized cookie-pair boundary', () => {
  assert.equal(normalizeOllamaCookieHeader('foo__Secure-session=wrong; aid=1'), '');
  assert.equal(
    normalizeOllamaCookieHeader('foo__Secure-session=wrong; __Secure-session=right'),
    'foo__Secure-session=wrong; __Secure-session=right'
  );
});

test('ollamaSessionCookie prefers settings and supports env aliases', () => {
  assert.equal(ollamaSessionCookie({ OLLAMA_COOKIE: 'wos-session=env' }, { ollamaCookie: 'wos-session=settings' }), 'wos-session=settings');
  assert.equal(ollamaSessionCookie({ TOKEN_MONITOR_OLLAMA_COOKIE: '__Secure-session=legacy' }), '__Secure-session=legacy');
  assert.equal(ollamaSessionCookie({}), '');
});

test('parses account identity, plan, reset timestamps, and window durations', () => {
  const parsed = parseOllamaUsageHtml(SETTINGS_HTML);
  assert.equal(parsed.planName, 'Pro');
  assert.equal(parsed.accountEmail, 'user@example.com');
  assert.equal(parsed.session.usedPercent, 14.5);
  assert.equal(parsed.session.resetsAt, '2026-07-09T08:00:00.000Z');
  assert.equal(parsed.session.windowMinutes, 300);
  assert.equal(parsed.weekly.usedPercent, 10.3);
  assert.equal(parsed.weekly.windowMinutes, 10080);
});

test('parses reversed blocks plus Hourly and CSS-width fallbacks', () => {
  const parsed = parseOllamaUsageHtml(`
    <section>Weekly usage<div style="width: 80%"></div></section>
    <section>Hourly usage<span>25% used</span></section>
  `);
  assert.deepEqual(parsed.windows.map((window) => [window.kind, window.usedPercent]), [
    ['session', 25],
    ['weekly', 80]
  ]);
  assert.equal(parsed.session.windowMinutes, 60);
});

test('reuses a successful validation once without polling settings again', async () => {
  const cookie = 'wos-session=one-shot-cache';
  const validated = await fetchOllamaLimits({ ollamaCookie: cookie }, {
    env: {},
    bypassValidationCache: true,
    fetch: async () => response(200, { html: SETTINGS_HTML })
  });
  rememberOllamaValidation(cookie, validated, 1_000);

  let requests = 0;
  const cached = await fetchOllamaLimits({ ollamaCookie: cookie }, {
    env: {},
    now: () => 1_001,
    fetch: async () => { requests += 1; return response(500); }
  });
  assert.equal(cached.status, 'ok');
  assert.equal(requests, 0);

  const consumed = await fetchOllamaLimits({ ollamaCookie: cookie }, {
    env: {},
    now: () => 1_002,
    fetch: async () => { requests += 1; return response(500); }
  });
  assert.equal(consumed.status, 'unavailable');
  assert.equal(requests, 1);
});

test('a failed validation invalidates only the matching cached cookie', async () => {
  const firstCookie = 'wos-session=first-cache';
  const secondCookie = 'wos-session=second-cache';
  const validated = await fetchOllamaLimits({ ollamaCookie: firstCookie }, {
    env: {},
    bypassValidationCache: true,
    fetch: async () => response(200, { html: SETTINGS_HTML })
  });
  rememberOllamaValidation(firstCookie, validated, 1_000);

  let requests = 0;
  const otherCookie = await fetchOllamaLimits({ ollamaCookie: secondCookie }, {
    env: {},
    now: () => 1_001,
    fetch: async () => { requests += 1; return response(401); }
  });
  assert.equal(otherCookie.status, 'unauthorized');
  assert.equal(requests, 1);

  const preserved = await fetchOllamaLimits({ ollamaCookie: firstCookie }, {
    env: {},
    now: () => 1_002,
    fetch: async () => { requests += 1; return response(500); }
  });
  assert.equal(preserved.status, 'ok');
  assert.equal(requests, 1);

  rememberOllamaValidation(firstCookie, validated, 2_000);
  rememberOllamaValidation(firstCookie, { status: 'unauthorized' }, 2_001);
  const invalidated = await fetchOllamaLimits({ ollamaCookie: firstCookie }, {
    env: {},
    now: () => 2_002,
    fetch: async () => { requests += 1; return response(401); }
  });
  assert.equal(invalidated.status, 'unauthorized');
  assert.equal(requests, 2);
});

test('parses formatted closing tags and ignores repeated aria usage labels', () => {
  const parsed = parseOllamaUsageHtml(`
    <h2><span>Cloud usage</span><span class="badge">free</span
    ></h2>
    <h2 id="header-email">user@example.com</h2>
    <div>
      <span>Session usage</span><span>0% used</span>
      <div aria-label="Session usage 0% used"></div>
      <div class="local-time" data-time="2026-07-12T06:00:00Z">Resets in 2 hours.</div>
    </div>
    <div>
      <span>Weekly usage</span><span>0% used</span>
      <div aria-label="Weekly usage 0% used"></div>
      <div class="local-time" data-time="2026-07-13T00:00:00Z">Resets in 20 hours.</div>
    </div>
  `);

  assert.equal(parsed.planName, 'free');
  assert.equal(parsed.session.resetsAt, '2026-07-12T06:00:00.000Z');
  assert.equal(parsed.weekly.resetsAt, '2026-07-13T00:00:00.000Z');
});

test('fetches with current WorkOS cookies and uses email for stable identity', async () => {
  const requests = [];
  const provider = await fetchOllamaLimits({ ollamaCookie: 'wos-session=current; aid=1' }, {
    env: {},
    now: () => Date.parse('2026-07-09T00:00:00Z'),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return response(200, { html: SETTINGS_HTML });
    }
  });
  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountEmail, 'user@example.com');
  assert.equal(provider.accountLabel, 'Pro');
  assert.equal(provider.accountKey, hashKey('ollama', 'user@example.com'));
  assert.equal(requests[0].init.headers.Cookie, 'wos-session=current; aid=1');
  assert.equal(requests[0].init.redirect, 'manual');
});

test('follows same-origin redirects while keeping cookies on HTTPS Ollama only', async () => {
  const requests = [];
  const provider = await fetchOllamaLimits({ ollamaCookie: 'wos-session=current' }, {
    env: {},
    fetch: async (url, init) => {
      requests.push({ url: String(url), cookie: init.headers.Cookie });
      return requests.length === 1
        ? response(307, { location: '/settings/' })
        : response(200, { html: SETTINGS_HTML });
    }
  });
  assert.equal(provider.status, 'ok');
  assert.deepEqual(requests.map((item) => item.cookie), ['wos-session=current', 'wos-session=current']);
});

test('classifies only real sign-in redirects as unauthorized', async () => {
  const signIn = await fetchOllamaLimits({ ollamaCookie: 'wos-session=expired' }, {
    env: {}, fetch: async () => response(302, { location: 'https://signin.ollama.com/start' })
  });
  const unrelated = await fetchOllamaLimits({ ollamaCookie: 'wos-session=current' }, {
    env: {}, fetch: async () => response(302, { location: 'https://example.com/' })
  });
  assert.equal(signIn.status, 'unauthorized');
  assert.equal(unrelated.status, 'unavailable');
});

test('classifies signed-out HTML, auth failures, throttling, and network errors', async () => {
  const cases = [
    [response(200, { html: '<form action="/signin"><input type="email"></form>' }), 'unauthorized'],
    [response(401), 'unauthorized'],
    [response(429), 'sourceRateLimited']
  ];
  for (const [result, expected] of cases) {
    const provider = await fetchOllamaLimits({ ollamaCookie: 'wos-session=value' }, { env: {}, fetch: async () => result });
    assert.equal(provider.status, expected);
  }
  const failed = await fetchOllamaLimits({ ollamaCookie: 'wos-session=value' }, {
    env: {}, fetch: async () => { throw new TypeError('network down'); }
  });
  assert.equal(failed.status, 'unavailable');
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const USAGE_JSON = { limits: { session: { usage: 0.145 }, weekly: { usage: 0.103 } } };

test('ollamaApiKey prefers settings and supports env aliases', () => {
  assert.equal(ollamaApiKey({ OLLAMA_API_KEY: 'env-key' }, { ollamaApiKey: 'settings-key' }), 'settings-key');
  assert.equal(ollamaApiKey({ TOKEN_MONITOR_OLLAMA_API_KEY: 'legacy-env' }), 'legacy-env');
  assert.equal(ollamaApiKey({}), '');
  assert.equal(ollamaApiKey({}, { ollamaApiKey: '  "quoted-key"  ' }), 'quoted-key');
});

test('parses usage ratios into session and weekly windows', () => {
  const parsed = parseOllamaUsageJson(USAGE_JSON);
  assert.equal(parsed.session.usedPercent, 14.5);
  assert.equal(parsed.session.windowMinutes, 300);
  assert.equal(parsed.session.resetsAt, null);
  assert.equal(parsed.weekly.usedPercent, 10.3);
  assert.equal(parsed.weekly.windowMinutes, 10080);
  assert.deepEqual(parseOllamaUsageJson({}).windows, []);
  assert.deepEqual(parseOllamaUsageJson({ limits: { session: { usage: 'x' } } }).windows, []);
});

test('fetches usage with an API key and labels the account from /api/me', async () => {
  const requests = [];
  const provider = await fetchOllamaLimits({ ollamaApiKey: 'api-key' }, {
    env: {},
    now: () => Date.parse('2026-08-05T00:00:00Z'),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return String(url).endsWith('/api/me')
        ? jsonResponse(200, { Plan: 'pro' })
        : jsonResponse(200, USAGE_JSON);
    }
  });
  assert.equal(provider.status, 'ok');
  assert.equal(provider.source, 'api');
  assert.equal(provider.accountLabel, 'Pro');
  assert.equal(provider.accountKey, hashKey('ollama', 'api-key'));
  assert.deepEqual(provider.windows.map((window) => [window.kind, window.usedPercent]), [
    ['session', 14.5],
    ['weekly', 10.3]
  ]);
  assert.equal(requests[0].url, 'https://ollama.com/api/usage');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer api-key');
  assert.equal(requests[1].url, 'https://ollama.com/api/me');
  assert.equal(requests[1].init.method, 'POST');
});

test('API key path prefers the key over a configured cookie', async () => {
  const seen = [];
  const provider = await fetchOllamaLimits({ ollamaApiKey: 'api-key', ollamaCookie: 'wos-session=current' }, {
    env: {},
    fetch: async (url, init) => {
      seen.push({ url: String(url), headers: init.headers });
      return jsonResponse(200, String(url).endsWith('/api/me') ? {} : USAGE_JSON);
    }
  });
  assert.equal(provider.status, 'ok');
  assert.equal(seen[0].url, 'https://ollama.com/api/usage');
  assert.equal(seen[0].headers.Cookie, undefined);
});

test('a failing /api/me still yields quota windows', async () => {
  const provider = await fetchOllamaLimits({ ollamaApiKey: 'api-key' }, {
    env: {},
    fetch: async (url) => String(url).endsWith('/api/me')
      ? jsonResponse(500, {})
      : jsonResponse(200, USAGE_JSON)
  });
  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, '');
  assert.equal(provider.windows.length, 2);
});

test('API key auth failures, throttling, and non-JSON bodies are classified', async () => {
  const cases = [
    [jsonResponse(401, {}), 'unauthorized'],
    [jsonResponse(403, {}), 'unauthorized'],
    [jsonResponse(429, {}), 'sourceRateLimited'],
    [jsonResponse(500, {}), 'unavailable'],
    [{ ok: true, status: 200, json: async () => { throw new SyntaxError('nope'); } }, 'unavailable']
  ];
  for (const [result, expected] of cases) {
    const provider = await fetchOllamaLimits({ ollamaApiKey: 'api-key' }, { env: {}, fetch: async () => result });
    assert.equal(provider.status, expected);
    assert.equal(provider.source, 'api');
  }
});

test('a usage response without limits still counts as connected', async () => {
  const provider = await fetchOllamaLimits({ ollamaApiKey: 'api-key' }, {
    env: {},
    fetch: async (url) => jsonResponse(200, String(url).endsWith('/api/me') ? { Plan: 'free' } : {})
  });
  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Free');
  assert.deepEqual(provider.windows, []);
});

test('fetchOllamaLimits attaches ollamaAccountLabel as accountName', async () => {
  const provider = await fetchOllamaLimits({ ollamaApiKey: 'api-key', ollamaAccountLabel: 'Work Pro' }, {
    env: {},
    fetch: async (url) => jsonResponse(200, String(url).endsWith('/api/me') ? { Plan: 'pro' } : USAGE_JSON)
  });
  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountName, 'Work Pro');
  assert.equal(provider.accountLabel, 'Pro');
});
