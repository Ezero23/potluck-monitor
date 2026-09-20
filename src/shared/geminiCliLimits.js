'use strict';

// Gemini CLI limits, read from the CLI's own local login so no extra sign-in
// is needed. Flow mirrors what gemini-cli / 9router do: refresh the OAuth
// token if stale, resolve the Cloud Code companion project via loadCodeAssist,
// then retrieveUserQuota returns per-model daily buckets (remainingFraction
// 0..1 + resetTime).

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');
const { runWithProbeDeadline } = require('./probeDeadline');

const GEMINI_CLI_FETCH_TIMEOUT_MS = 12_000;
const CREDENTIALS_FILENAME = 'oauth_creds.json';
// gemini-cli's public OAuth client (embedded in the open-source CLI).
const GEMINI_CLI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GEMINI_CLI_CLIENT_SECRET = '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';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const RETRIEVE_USER_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
// Refresh a little early so a token that expires mid-probe still works.
const TOKEN_EXPIRY_SKEW_MS = 60_000;

function geminiCredentialsPath(env = process.env) {
  const home = env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
  return path.join(home, CREDENTIALS_FILENAME);
}

function parseCredentials(raw) {
  let doc;
  try {
    doc = JSON.parse(String(raw || ''));
  } catch (_) {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const accessToken = String(doc.access_token || '').trim();
  const refreshToken = String(doc.refresh_token || '').trim();
  if (!accessToken && !refreshToken) return null;
  const expiryMs = Number(doc.expiry_date);
  return {
    // Keep the original document so the write-back preserves gemini-cli's
    // own file shape (snake_case) instead of our internal field names.
    raw: doc,
    accessToken,
    refreshToken,
    expiryMs: Number.isFinite(expiryMs) && expiryMs > 0 ? expiryMs : null
  };
}

async function loadGeminiCredentials(deps = {}) {
  const env = deps.env || process.env;
  const credPath = deps.geminiCredentialsPath || geminiCredentialsPath(env);
  const readFile = deps.readFile || fsp.readFile;
  try {
    return { credPath, credentials: parseCredentials(await readFile(credPath, 'utf8')) };
  } catch (_) {
    return { credPath, credentials: null };
  }
}

async function postForm(url, form, deps = {}) {
  const deadlineMs = Number(deps.geminiCliFetchTimeoutMs || deps.fetchTimeoutMs || GEMINI_CLI_FETCH_TIMEOUT_MS);
  return runWithProbeDeadline(async ({ signal }) => {
    const response = await (deps.fetch || fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    return { response, body };
  }, { signal: deps.signal, deadlineMs });
}

async function postJson(url, accessToken, payload, deps = {}) {
  const deadlineMs = Number(deps.geminiCliFetchTimeoutMs || deps.fetchTimeoutMs || GEMINI_CLI_FETCH_TIMEOUT_MS);
  return runWithProbeDeadline(async ({ signal }) => {
    const response = await (deps.fetch || fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(payload || {}),
      signal
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    return { response, body };
  }, { signal: deps.signal, deadlineMs });
}

function statusFromHttpCode(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'sourceRateLimited';
  return 'unavailable';
}

// Refresh and write the refreshed document back so gemini-cli itself keeps
// working; the write is best-effort and never fails the probe.
async function refreshAccessToken(credPath, credentials, deps = {}) {
  const { response, body } = await postForm(OAUTH_TOKEN_URL, {
    client_id: GEMINI_CLI_CLIENT_ID,
    client_secret: GEMINI_CLI_CLIENT_SECRET,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token'
  }, deps);
  if (!response.ok || !body?.access_token) {
    const error = new Error(`Gemini CLI token refresh returned ${response.status}`);
    error.status = statusFromHttpCode(response.status);
    throw error;
  }
  const refreshed = {
    ...credentials,
    accessToken: String(body.access_token),
    ...(body.refresh_token ? { refreshToken: String(body.refresh_token) } : {}),
    ...(Number.isFinite(Number(body.expires_in))
      ? { expiryMs: Date.now() + Number(body.expires_in) * 1000 }
      : { expiryMs: null })
  };
  const writeFile = deps.writeFile || ((target, text) => fsp.writeFile(target, text, { mode: 0o600 }));
  const rename = deps.rename || ((from, to) => fsp.rename(from, to));
  try {
    // Overlay onto the original document: the file stays gemini-cli-shaped.
    const doc = {
      ...(credentials.raw || {}),
      access_token: refreshed.accessToken,
      ...(refreshed.refreshToken ? { refresh_token: refreshed.refreshToken } : {}),
      ...(refreshed.expiryMs === null ? {} : { expiry_date: refreshed.expiryMs })
    };
    const tmpPath = `${credPath}.tmp-${process.pid}`;
    await writeFile(tmpPath, JSON.stringify(doc, null, 2));
    await rename(tmpPath, credPath);
  } catch (_) {}
  return refreshed;
}

async function usableAccessToken(credPath, credentials, deps = {}) {
  const fresh = credentials.expiryMs === null
    || credentials.expiryMs - (deps.now || Date.now)() > TOKEN_EXPIRY_SKEW_MS;
  if (fresh && credentials.accessToken) return credentials.accessToken;
  if (!credentials.refreshToken) return credentials.accessToken || '';
  const refreshed = await refreshAccessToken(credPath, credentials, deps);
  return refreshed.accessToken;
}

function parseResetTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 20_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quotaWindowLabel(modelId) {
  const raw = String(modelId || '').trim();
  return raw.length > 32 ? raw.slice(0, 32) : raw;
}

function windowsFromQuota(quotaBody) {
  const buckets = Array.isArray(quotaBody?.buckets) ? quotaBody.buckets : [];
  const windows = [];
  for (const bucket of buckets) {
    const label = quotaWindowLabel(bucket?.modelId);
    // Number(null) is 0 — a finite number — so check presence explicitly
    // before coercing; a missing fraction must not read as "fully used".
    if (!label || bucket?.remainingFraction == null) continue;
    const fraction = Number(bucket.remainingFraction);
    if (!Number.isFinite(fraction)) continue;
    windows.push({
      kind: 'session',
      label,
      usedPercent: Math.max(0, Math.min(100, (1 - fraction) * 100)),
      resetsAt: parseResetTime(bucket.resetTime),
      showMeter: true
    });
  }
  windows.sort((a, b) => a.label.localeCompare(b.label));
  return windows;
}

function planLabelFromSubscription(subscription) {
  const tier = String(subscription?.currentTier?.name || '').trim();
  if (tier) return tier;
  const paid = String(subscription?.paidTier?.id || '').trim();
  return paid && paid !== 'free-tier' ? paid : '';
}

async function fetchGeminiCliLimits(_options = {}, deps = {}) {
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const { credPath, credentials } = await loadGeminiCredentials(deps);
  if (!credentials) {
    return normalizeLimitProvider({
      provider: 'gemini-cli',
      source: 'oauth',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  try {
    const accessToken = await usableAccessToken(credPath, credentials, deps);
    if (!accessToken) throw Object.assign(new Error('No Gemini CLI access token'), { status: 'unauthorized' });

    const load = await postJson(LOAD_CODE_ASSIST_URL, accessToken, {
      metadata: { ideName: 'CLI', platform: process.platform }
    }, deps);
    if (!load.response.ok) {
      const error = new Error(`loadCodeAssist returned ${load.response.status}`);
      error.status = statusFromHttpCode(load.response.status);
      throw error;
    }
    const project = String(load.body?.cloudaicompanionProject || '').trim() || null;

    const quota = await postJson(RETRIEVE_USER_QUOTA_URL, accessToken, {
      ...(project ? { project } : {})
    }, deps);
    if (!quota.response.ok) {
      const error = new Error(`retrieveUserQuota returned ${quota.response.status}`);
      error.status = statusFromHttpCode(quota.response.status);
      throw error;
    }

    return normalizeLimitProvider({
      provider: 'gemini-cli',
      accountKey: hashKey('gemini-cli', credentials.refreshToken || accessToken),
      accountLabel: planLabelFromSubscription(load.body),
      source: 'oauth',
      status: 'ok',
      updatedAt,
      windows: windowsFromQuota(quota.body)
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'gemini-cli',
      source: 'oauth',
      status: error?.status === 'timeout' ? 'unavailable' : error?.status || 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

module.exports = {
  GEMINI_CLI_FETCH_TIMEOUT_MS,
  geminiCredentialsPath,
  parseCredentials,
  windowsFromQuota,
  planLabelFromSubscription,
  parseResetTime,
  fetchGeminiCliLimits
};
