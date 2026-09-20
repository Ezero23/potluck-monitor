'use strict';

// CommandCode (api.commandcode.ai) limits: billing credits plus 5h/weekly
// rate windows. Mirrors the public surface 9router reads: whoami → org id,
// billing/credits → credits + windowLimits, billing/subscriptions → plan.

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');
const { runWithProbeDeadline } = require('./probeDeadline');

const COMMANDCODE_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_COMMANDCODE_BASE_URL = 'https://api.commandcode.ai';

const PLAN_LABELS = {
  'individual-go': 'Go',
  'individual-goat': 'GOAT',
  'individual-pro': 'Pro',
  'individual-pro-v1': 'Pro',
  'individual-provider': 'Provider',
  'individual-max': 'Max',
  'individual-ultra': 'Ultra',
  'teams-pro': 'Teams Pro'
};

// Monthly credit caps per plan, as published on the CommandCode pricing page.
// Used to derive `used` from the remaining balance; unknown plans keep the
// balance-only display (meter hidden) instead of guessing a denominator.
const PLAN_CREDIT_CAPS = {
  'individual-go': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
  'individual-max': 150,
  'individual-ultra': 300,
  'teams-pro': 40
};

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function commandcodeApiKey(env = process.env, options = {}) {
  const explicit = cleanSecret(options.commandcodeApiKey);
  if (explicit) return explicit;
  for (const name of ['TOKEN_MONITOR_COMMANDCODE_API_KEY', 'COMMANDCODE_API_KEY', 'COMMAND_CODE_API_KEY']) {
    const raw = cleanSecret(env[name]);
    if (raw) return raw;
  }
  return '';
}

function commandcodeBaseUrl(env = process.env, options = {}) {
  const explicit = String(options.commandcodeBaseUrl || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  for (const name of ['TOKEN_MONITOR_COMMANDCODE_BASE_URL', 'COMMANDCODE_BASE_URL', 'COMMAND_CODE_API_BASE_URL']) {
    const raw = String(env[name] || '').trim();
    if (raw) return raw.replace(/\/$/, '');
  }
  return DEFAULT_COMMANDCODE_BASE_URL;
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 20_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function statusFromHttpCode(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'sourceRateLimited';
  return 'unavailable';
}

function ensureOk(response, label) {
  if (response.ok) return;
  const error = new Error(`CommandCode ${label} returned ${response.status}`);
  error.status = statusFromHttpCode(response.status);
  throw error;
}

function commandcodeCreditsWindow(credits, planCap, currentPeriodEnd) {
  const remaining = ['monthlyCredits', 'purchasedCredits', 'freeCredits']
    .reduce((sum, key) => sum + Math.max(0, numberOrNull(credits?.[key]) ?? 0), 0);
  if (remaining <= 0 && planCap <= 0) return null;
  const used = planCap > 0 ? Math.max(0, planCap - remaining) : 0;
  return {
    kind: 'billing',
    metric: 'credits',
    label: 'Credits',
    used,
    limit: planCap > 0 ? planCap : null,
    remaining,
    usedPercent: planCap > 0
      ? Math.max(0, Math.min(100, (used / planCap) * 100))
      : null,
    resetsAt: toIso(currentPeriodEnd),
    currency: 'USD',
    showMeter: planCap > 0
  };
}

function commandcodeRateWindow(win, kind) {
  if (!win || typeof win !== 'object') return null;
  const used = Math.max(0, numberOrNull(win.used) ?? 0);
  const limit = Math.max(0, numberOrNull(win.cap) ?? 0);
  if (used <= 0 && limit <= 0) return null;
  return {
    kind,
    label: kind === 'session' ? 'Session (5h)' : 'Weekly',
    used,
    limit: limit > 0 ? limit : null,
    remaining: Math.max(0, limit - used),
    usedPercent: limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : null,
    resetsAt: toIso(win.resetAt),
    windowMinutes: kind === 'session' ? 300 : 10_080,
    showMeter: limit > 0
  };
}

function commandcodeWindows(creditsBody, planId, currentPeriodEnd) {
  const planCap = planId ? (PLAN_CREDIT_CAPS[planId] || 0) : 0;
  const windows = [];
  const credits = commandcodeCreditsWindow(creditsBody?.credits, planCap, currentPeriodEnd);
  if (credits) windows.push(credits);
  const session = commandcodeRateWindow(creditsBody?.windowLimits?.fiveHour, 'session');
  if (session) windows.push(session);
  const weekly = commandcodeRateWindow(creditsBody?.windowLimits?.weekly, 'weekly');
  if (weekly) windows.push(weekly);
  return windows;
}

function commandcodePlanLabel(planId) {
  const raw = String(planId || '').trim();
  if (!raw) return '';
  return PLAN_LABELS[raw] || raw;
}

function withOrgParam(route, orgId) {
  if (orgId === null || orgId === undefined || orgId === '') return route;
  return `${route}?orgId=${encodeURIComponent(String(orgId))}`;
}

function fetchJsonWithDeadline(url, apiKey, deps = {}) {
  const deadlineMs = Number(
    deps.commandcodeFetchTimeoutMs || deps.fetchTimeoutMs || COMMANDCODE_FETCH_TIMEOUT_MS
  );
  return runWithProbeDeadline(
    async ({ signal }) => {
      const response = await (deps.fetch || fetch)(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json'
        },
        signal
      });
      const body = response.ok ? await response.json().catch(() => null) : null;
      return { response, body };
    },
    { signal: deps.signal, deadlineMs }
  );
}

async function fetchCommandCodeLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const apiKey = commandcodeApiKey(env, options);
  if (!apiKey) {
    return normalizeLimitProvider({
      provider: 'commandcode',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  const base = commandcodeBaseUrl(env, options);
  try {
    const whoami = await fetchJsonWithDeadline(`${base}/alpha/whoami?limits=1`, apiKey, deps);
    ensureOk(whoami.response, 'whoami');
    const orgId = whoami.body?.org?.id ?? null;

    const [creditsResult, subsResult] = await Promise.allSettled([
      fetchJsonWithDeadline(`${base}${withOrgParam('/alpha/billing/credits', orgId)}`, apiKey, deps),
      fetchJsonWithDeadline(`${base}${withOrgParam('/alpha/billing/subscriptions', orgId)}`, apiKey, deps)
    ]);
    if (creditsResult.status === 'rejected') throw creditsResult.reason;
    ensureOk(creditsResult.value.response, 'credits');
    const creditsBody = creditsResult.value.body || {};
    // The plan is display metadata; a failed subscriptions call degrades to a
    // balance-only view instead of failing the whole provider.
    const subsBody = subsResult.status === 'fulfilled' ? subsResult.value.body : null;
    const planId = String(subsBody?.data?.planId || '').trim() || null;

    return normalizeLimitProvider({
      provider: 'commandcode',
      accountKey: hashKey('commandcode', apiKey),
      accountLabel: commandcodePlanLabel(planId),
      source: 'api',
      status: 'ok',
      updatedAt,
      windows: commandcodeWindows(creditsBody, planId, subsBody?.data?.currentPeriodEnd)
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'commandcode',
      source: 'api',
      status: error?.status === 'timeout' ? 'unavailable' : error?.status || 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

module.exports = {
  COMMANDCODE_FETCH_TIMEOUT_MS,
  DEFAULT_COMMANDCODE_BASE_URL,
  commandcodeApiKey,
  commandcodeBaseUrl,
  commandcodePlanLabel,
  commandcodeCreditsWindow,
  commandcodeRateWindow,
  commandcodeWindows,
  fetchCommandCodeLimits
};
