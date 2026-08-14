'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  codexAccessTokenExpiryMs,
  codexTokenNeedsRefresh,
  requestCodexTokenRefresh,
  refreshCodexAuthFile
} = require('../../src/shared/codexTokenRefresh');

function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`;
}

function authFile({ expMs = Date.now() + 3600_000, refreshToken = 'rt-1' } = {}) {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: fakeJwt({ email: 'user@example.com' }),
      access_token: fakeJwt({ exp: Math.floor(expMs / 1000) }),
      refresh_token: refreshToken,
      account_id: 'acct-1'
    },
    last_refresh: '2026-08-01T00:00:00.000Z'
  };
}

function tempAuthPath(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-refresh-test-'));
  const authPath = path.join(dir, 'auth.json');
  if (contents !== null) fs.writeFileSync(authPath, JSON.stringify(contents));
  return authPath;
}

function okRefreshResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      access_token: fakeJwt({ exp: Math.floor((Date.now() + 3600_000) / 1000) }),
      id_token: fakeJwt({ email: 'user@example.com' }),
      refresh_token: 'rt-2',
      ...overrides
    })
  };
}

test('codexTokenNeedsRefresh only fires with a refresh token and a near/past expiry', () => {
  const now = Date.now();
  assert.equal(codexTokenNeedsRefresh(authFile({ expMs: now + 3600_000 }), now), false);
  assert.equal(codexTokenNeedsRefresh(authFile({ expMs: now + 5 * 60_000 }), now), true);
  assert.equal(codexTokenNeedsRefresh(authFile({ expMs: now - 1000 }), now), true);

  const noRefresh = authFile({ expMs: now - 1000 });
  delete noRefresh.tokens.refresh_token;
  assert.equal(codexTokenNeedsRefresh(noRefresh, now), false);

  const unparseable = authFile({ refreshToken: 'rt-1' });
  unparseable.tokens.access_token = 'not-a-jwt';
  assert.equal(codexTokenNeedsRefresh(unparseable, now), true);
});

test('codexAccessTokenExpiryMs reads exp from the access token JWT', () => {
  const expMs = 1780000000000;
  assert.equal(codexAccessTokenExpiryMs(authFile({ expMs })), Math.floor(expMs / 1000) * 1000);
  assert.equal(codexAccessTokenExpiryMs({ tokens: { access_token: 'junk' } }), 0);
});

test('requestCodexTokenRefresh posts JSON and keeps the old refresh token when none is returned', async () => {
  let seenBody = null;
  const result = await requestCodexTokenRefresh('rt-old', {
    fetch: async (_url, init) => {
      seenBody = JSON.parse(init.body);
      return okRefreshResponse({ refresh_token: undefined });
    }
  });
  assert.equal(seenBody.grant_type, 'refresh_token');
  assert.equal(seenBody.refresh_token, 'rt-old');
  assert.equal(seenBody.client_id.length > 0, true);
  assert.equal(result.refreshToken, 'rt-old');
  assert.equal(result.accessToken.length > 0, true);
});

test('requestCodexTokenRefresh maps endpoint failures to statuses', async () => {
  await assert.rejects(
    requestCodexTokenRefresh('rt', { fetch: async () => ({ ok: false, status: 400 }) }),
    (error) => error.status === 'unauthorized'
  );
  await assert.rejects(
    requestCodexTokenRefresh('rt', { fetch: async () => ({ ok: false, status: 429 }) }),
    (error) => error.status === 'sourceRateLimited'
  );
  await assert.rejects(
    requestCodexTokenRefresh('rt', { fetch: async () => ({ ok: false, status: 500 }) }),
    (error) => error.status === 'unavailable'
  );
});

test('refreshCodexAuthFile ignores missing files and fresh tokens without network', async () => {
  const missing = await refreshCodexAuthFile(tempAuthPath(null), {}, { fetch: async () => { throw new Error('network should not be hit'); } });
  assert.deepEqual(missing, { refreshed: false, reason: 'unreadable' });

  const fresh = await refreshCodexAuthFile(tempAuthPath(authFile()), {}, { fetch: async () => { throw new Error('network should not be hit'); } });
  assert.deepEqual(fresh, { refreshed: false, reason: 'fresh' });
});

test('refreshCodexAuthFile merges refreshed tokens into auth.json, preserving other fields', async () => {
  const authPath = tempAuthPath(authFile({ expMs: Date.now() - 60_000 }));
  const result = await refreshCodexAuthFile(authPath, {}, { fetch: async () => okRefreshResponse() });
  assert.equal(result.refreshed, true);

  const written = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  assert.equal(written.auth_mode, 'chatgpt');
  assert.equal(written.tokens.account_id, 'acct-1');
  assert.equal(written.tokens.refresh_token, 'rt-2');
  assert.notEqual(written.tokens.access_token, authFile({ expMs: 0 }).tokens.access_token);
  assert.equal(codexAccessTokenExpiryMs(written) > Date.now(), true);
  assert.notEqual(written.last_refresh, '2026-08-01T00:00:00.000Z');
  // Written atomically with restrictive permissions.
  assert.equal(fs.statSync(authPath).mode & 0o777, 0o600);
});

test('refreshCodexAuthFile discards its write when the CLI rotated the file mid-refresh', async () => {
  const authPath = tempAuthPath(authFile({ expMs: Date.now() - 60_000 }));
  const fetch = async () => {
    // Simulate the Codex CLI refreshing the same file while our request flies.
    fs.writeFileSync(authPath, JSON.stringify(authFile({ expMs: Date.now() + 3600_000, refreshToken: 'rt-cli' })));
    return okRefreshResponse();
  };
  const result = await refreshCodexAuthFile(authPath, {}, { fetch });
  assert.deepEqual(result, { refreshed: false, reason: 'changed-externally' });
  assert.equal(JSON.parse(fs.readFileSync(authPath, 'utf8')).tokens.refresh_token, 'rt-cli');
});

test('refreshCodexAuthFile backs off after a permanent rejection', async () => {
  const authPath = tempAuthPath(authFile({ expMs: Date.now() - 60_000 }));
  let calls = 0;
  const fetch = async () => { calls += 1; return { ok: false, status: 400 }; };
  await assert.rejects(refreshCodexAuthFile(authPath, {}, { fetch }), (error) => error.status === 'unauthorized');
  const second = await refreshCodexAuthFile(authPath, {}, { fetch });
  assert.deepEqual(second, { refreshed: false, reason: 'cooldown' });
  assert.equal(calls, 1);
});

test('refreshCodexAuthFile dedups concurrent refreshes for the same file', async () => {
  const authPath = tempAuthPath(authFile({ expMs: Date.now() - 60_000 }));
  let calls = 0;
  const fetch = async () => { calls += 1; return okRefreshResponse(); };
  const [first, second] = await Promise.all([
    refreshCodexAuthFile(authPath, {}, { fetch }),
    refreshCodexAuthFile(authPath, {}, { fetch })
  ]);
  assert.equal(first.refreshed, true);
  assert.equal(second.refreshed, true);
  assert.equal(calls, 1);
});
