'use strict';

// Groq has no dedicated quota endpoint — rate-limit info rides on every API
// response as x-ratelimit-* headers (requests + tokens, always included).
// The models list is polled so reading usage never costs tokens.

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');
const { runWithProbeDeadline } = require('./probeDeadline');

const GROQ_FETCH_TIMEOUT_MS = 12_000;
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function groqApiKey(env = process.env, options = {}) {
  const explicit = cleanSecret(options.groqApiKey);
  if (explicit) return explicit;
  for (const name of ['TOKEN_MONITOR_GROQ_API_KEY', 'GROQ_API_KEY']) {
    const raw = cleanSecret(env[name]);
    if (raw) return raw;
  }
  return '';
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Groq reset headers are Go-style duration strings ("2m59.56s", "7.66s").
function parseGroqDurationMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let totalMs = 0;
  let matched = false;
  let match;
  while ((match = re.exec(value)) !== null) {
    matched = true;
    const unitMs = match[2] === 'h' ? 3_600_000 : match[2] === 'm' ? 60_000 : match[2] === 'ms' ? 1 : 1_000;
    totalMs += Number(match[1]) * unitMs;
  }
  return matched ? totalMs : null;
}

function resetsAtFromHeader(value, now) {
  const ms = parseGroqDurationMs(value);
  return ms === null ? null : new Date(now + ms).toISOString();
}

// headers.get() returns null when absent, and Number(null) is 0 (a finite
// number) — check presence explicitly so a missing header can't masquerade
// as a real "0 remaining" quota.
function rateWindow(headers, { label, limitKey, remainingKey, resetKey }, now) {
  const limitRaw = headers.get(limitKey);
  const remainingRaw = headers.get(remainingKey);
  if (limitRaw === null || remainingRaw === null) return null;
  const limit = numberOrNull(limitRaw);
  const remaining = numberOrNull(remainingRaw);
  if (limit === null || remaining === null || limit <= 0) return null;
  const used = Math.max(0, limit - remaining);
  return {
    kind: 'session',
    label,
    used,
    limit,
    remaining: Math.max(0, remaining),
    usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
    resetsAt: resetsAtFromHeader(headers.get(resetKey), now),
    showMeter: true
  };
}

function windowsFromHeaders(headers, now) {
  return [
    rateWindow(headers, {
      label: 'Requests',
      limitKey: 'x-ratelimit-limit-requests',
      remainingKey: 'x-ratelimit-remaining-requests',
      resetKey: 'x-ratelimit-reset-requests'
    }, now),
    rateWindow(headers, {
      label: 'Tokens',
      limitKey: 'x-ratelimit-limit-tokens',
      remainingKey: 'x-ratelimit-remaining-tokens',
      resetKey: 'x-ratelimit-reset-tokens'
    }, now)
  ].filter(Boolean);
}

function statusFromHttpCode(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'sourceRateLimited';
  return 'unavailable';
}

async function fetchGroqLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const apiKey = groqApiKey(env, options);
  if (!apiKey) {
    return normalizeLimitProvider({
      provider: 'groq',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  const deadlineMs = Number(deps.groqFetchTimeoutMs || deps.fetchTimeoutMs || GROQ_FETCH_TIMEOUT_MS);
  try {
    const response = await runWithProbeDeadline(async ({ signal }) => (
deps.fetch || fetch)(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal
    }), { signal: deps.signal, deadlineMs });
    if (!response.ok) {
      const error = new Error(`Groq models returned ${response.status}`);
      error.status = statusFromHttpCode(response.status);
      throw error;
    }
    // The quota data lives in headers, not the body — drain it so the
    // connection is released without parsing the model list.
    await response.text?.().catch(() => {});
    return normalizeLimitProvider({
      provider: 'groq',
      accountKey: hashKey('groq', apiKey),
      source: 'api',
      status: 'ok',
      updatedAt,
      windows: windowsFromHeaders(response.headers, now)
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'groq',
      source: 'api',
      status: error?.status === 'timeout' ? 'unavailable' : error?.status || 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

module.exports = {
  GROQ_FETCH_TIMEOUT_MS,
  GROQ_MODELS_URL,
  groqApiKey,
  parseGroqDurationMs,
  windowsFromHeaders,
  fetchGroqLimits
};
