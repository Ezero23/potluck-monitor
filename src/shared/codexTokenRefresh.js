'use strict';

const fs = require('node:fs');

const { decodeJwtPayload } = require('./codexAuth');
const { writeCodexAuthFile } = require('./codexSystemSwitch');

const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_REFRESH_LEAD_MS = 10 * 60 * 1000;
const CODEX_REFRESH_TIMEOUT_MS = 12000;
// After a permanent rejection (invalid_grant etc.) the same file is left alone
// for this long so a background loop cannot hammer the endpoint.
const CODEX_REFRESH_UNAUTHORIZED_COOLDOWN_MS = 60 * 60 * 1000;

const inflightRefreshes = new Map();
const unauthorizedCooldowns = new Map();

function codexRefreshError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function codexRefreshTokenFromAuth(auth) {
  return String(auth?.tokens?.refresh_token || auth?.refresh_token || '').trim();
}

function codexAccessTokenExpiryMs(auth) {
  const payload = decodeJwtPayload(auth?.tokens?.access_token || auth?.access_token || '');
  const exp = Number(payload.exp);
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

function codexTokenNeedsRefresh(auth, nowMs = Date.now(), leadMs = CODEX_REFRESH_LEAD_MS) {
  if (!codexRefreshTokenFromAuth(auth)) return false;
  const expiryMs = codexAccessTokenExpiryMs(auth);
  if (!expiryMs) return true;
  return expiryMs - nowMs <= leadMs;
}

async function requestCodexTokenRefresh(refreshToken, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const url = deps.codexTokenUrl || CODEX_OAUTH_TOKEN_URL;
  const timeoutMs = Number(deps.fetchTimeoutMs || CODEX_REFRESH_TIMEOUT_MS);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: deps.codexClientId || CODEX_OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) {
      const status = response.status === 400 || response.status === 401 || response.status === 403
        ? 'unauthorized'
        : response.status === 429 ? 'sourceRateLimited' : 'unavailable';
      throw codexRefreshError(status, `codex oauth/token returned ${response.status}`);
    }
    const json = await response.json();
    if (!json?.access_token) throw codexRefreshError('unavailable', 'codex oauth/token response missing access_token');
    return {
      accessToken: String(json.access_token),
      idToken: json.id_token ? String(json.id_token) : '',
      refreshToken: json.refresh_token ? String(json.refresh_token) : refreshToken
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw codexRefreshError('unavailable', 'codex oauth/token timed out');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mergeCodexAuthTokens(auth, refreshed, nowMs) {
  const tokens = auth?.tokens && typeof auth.tokens === 'object' ? 'tokens' : null;
  const next = { ...(auth || {}) };
  const target = tokens ? { ...(next.tokens || {}) } : next;
  target.access_token = refreshed.accessToken;
  if (refreshed.idToken) target.id_token = refreshed.idToken;
  if (refreshed.refreshToken) target.refresh_token = refreshed.refreshToken;
  if (tokens) next.tokens = target;
  next.last_refresh = new Date(nowMs).toISOString();
  return next;
}

async function readCodexAuthJson(authPath, deps = {}) {
  const readFile = deps.readFile || fs.promises.readFile;
  try {
    const parsed = JSON.parse(await readFile(authPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function performCodexAuthFileRefresh(authPath, options, deps) {
  const now = deps.now || Date.now;
  const leadMs = Number(options.leadMs || deps.leadMs || CODEX_REFRESH_LEAD_MS);
  const auth = await readCodexAuthJson(authPath, deps);
  if (!auth) return { refreshed: false, reason: 'unreadable' };
  const nowMs = now();
  if (!codexTokenNeedsRefresh(auth, nowMs, leadMs)) return { refreshed: false, reason: 'fresh' };

  const cooldownUntil = unauthorizedCooldowns.get(authPath) || 0;
  if (cooldownUntil > nowMs) return { refreshed: false, reason: 'cooldown' };

  const sentRefreshToken = codexRefreshTokenFromAuth(auth);
  let refreshed;
  try {
    refreshed = await requestCodexTokenRefresh(sentRefreshToken, deps);
  } catch (error) {
    if (error?.status === 'unauthorized') {
      unauthorizedCooldowns.set(authPath, now() + CODEX_REFRESH_UNAUTHORIZED_COOLDOWN_MS);
    }
    throw error;
  }

  // The Codex CLI refreshes and rewrites auth.json on its own. If the file's
  // refresh token changed while our request was in flight, the CLI already
  // handled it; writing our pair back would resurrect rotated-out tokens.
  const current = await readCodexAuthJson(authPath, deps);
  if (!current) return { refreshed: false, reason: 'unreadable' };
  if (codexRefreshTokenFromAuth(current) !== sentRefreshToken) {
    return { refreshed: false, reason: 'changed-externally' };
  }

  const merged = mergeCodexAuthTokens(current, refreshed, now());
  await writeCodexAuthFile(authPath, `${JSON.stringify(merged, null, 2)}\n`, deps);
  return {
    refreshed: true,
    expiresAt: codexAccessTokenExpiryMs(merged) || null
  };
}

// Refreshes the OAuth tokens in a Codex auth.json when the access token is
// expired or within `leadMs` of expiring. Never throws for a missing/corrupt
// file; network and endpoint errors do throw so reactive callers can map them,
// while background callers should allSettled/catch.
function refreshCodexAuthFile(authPath, options = {}, deps = {}) {
  const key = String(authPath || '').trim();
  if (!key) return Promise.resolve({ refreshed: false, reason: 'no-path' });
  const inflight = inflightRefreshes.get(key);
  if (inflight) return inflight;
  const task = performCodexAuthFileRefresh(key, options, deps)
    .finally(() => {
      if (inflightRefreshes.get(key) === task) inflightRefreshes.delete(key);
    });
  inflightRefreshes.set(key, task);
  return task;
}

module.exports = {
  CODEX_OAUTH_TOKEN_URL,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_REFRESH_LEAD_MS,
  codexAccessTokenExpiryMs,
  codexTokenNeedsRefresh,
  requestCodexTokenRefresh,
  refreshCodexAuthFile
};
