'use strict';

// Vercel AI Gateway credits: GET /v1/credits returns { balance, total_used }
// as USD decimal strings. Balance-style quota — money, no percentage.

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');
const { runWithProbeDeadline } = require('./probeDeadline');

const VERCEL_FETCH_TIMEOUT_MS = 12_000;
const VERCEL_CREDITS_URL = 'https://ai-gateway.vercel.sh/v1/credits';

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function vercelApiKey(env = process.env, options = {}) {
  const explicit = cleanSecret(options.vercelApiKey);
  if (explicit) return explicit;
  for (const name of ['TOKEN_MONITOR_VERCEL_AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY']) {
    const raw = cleanSecret(env[name]);
    if (raw) return raw;
  }
  return '';
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function creditsWindow(body) {
  const balance = numberOrNull(body?.balance);
  if (balance === null) return null;
  const used = numberOrNull(body?.total_used);
  return {
    kind: 'billing',
    metric: 'credits',
    label: 'Credits',
    used: used ?? 0,
    limit: null,
    remaining: balance,
    usedPercent: null,
    currency: 'USD',
    showMeter: false
  };
}

function statusFromHttpCode(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'sourceRateLimited';
  return 'unavailable';
}

async function fetchVercelLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const apiKey = vercelApiKey(env, options);
  if (!apiKey) {
    return normalizeLimitProvider({
      provider: 'vercel',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  const deadlineMs = Number(deps.vercelFetchTimeoutMs || deps.fetchTimeoutMs || VERCEL_FETCH_TIMEOUT_MS);
  try {
    const response = await runWithProbeDeadline(async ({ signal }) => (
deps.fetch || fetch)(VERCEL_CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal
    }), { signal: deps.signal, deadlineMs });
    const body = response.ok ? await response.json().catch(() => null) : null;
    if (!response.ok) {
      const error = new Error(`Vercel credits returned ${response.status}`);
      error.status = statusFromHttpCode(response.status);
      throw error;
    }
    return normalizeLimitProvider({
      provider: 'vercel',
      accountKey: hashKey('vercel', apiKey),
      source: 'api',
      status: 'ok',
      updatedAt,
      windows: creditsWindow(body) ? [creditsWindow(body)] : []
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'vercel',
      source: 'api',
      status: error?.status === 'timeout' ? 'unavailable' : error?.status || 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

module.exports = {
  VERCEL_FETCH_TIMEOUT_MS,
  VERCEL_CREDITS_URL,
  vercelApiKey,
  creditsWindow,
  fetchVercelLimits
};
