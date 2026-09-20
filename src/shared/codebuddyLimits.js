'use strict';

// CodeBuddy (Tencent) credit packs. One billing endpoint returns every credit
// package on the account, and the two package kinds must NOT be merged:
//   - Refill packs ("基础体验包"): recurring allowance whose cycle resets
//     monthly long before the resource expires (CycleEndTime well before
//     DeductionEndTime). Live numbers are the *Cycle* fields.
//   - Bonus packs ("活动赠送包"): one-shot credits that run a single cycle
//     and expire for good. Numbers are the plain Capacity fields.
// Refill packs become fixed-reset billing windows labelled by cadence; bonus
// packs become billing windows labelled "Bonus Pack N" with the expiry as the
// reset time (they do not replenish).

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');
const { runWithProbeDeadline } = require('./probeDeadline');

const CODEBUDDY_FETCH_TIMEOUT_MS = 12_000;
const CODEBUDDY_USAGE_URL = 'https://copilot.tencent.com/v2/billing/meter/get-user-resource';
const CODEBUDDY_HEADERS = {
  'User-Agent': 'CLI/2.108.1 CodeBuddy/2.108.1',
  'X-Product': 'SaaS',
  'X-IDE-Type': 'CLI',
  'X-IDE-Name': 'CLI',
  'x-requested-with': 'XMLHttpRequest',
  'x-codebuddy-request': '1'
};
// A refill pack's cycle ends more than this before the resource itself
// expires; bonus packs end exactly at expiry.
const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function codebuddyToken(env = process.env, options = {}) {
  const explicit = cleanSecret(options.codebuddyToken);
  if (explicit) return explicit;
  for (const name of ['TOKEN_MONITOR_CODEBUDDY_TOKEN', 'CODEBUDDY_TOKEN']) {
    const raw = cleanSecret(env[name]);
    if (raw) return raw;
  }
  return '';
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Prefer the *Precise string fields (exact), fall back to the numeric ones.
function packNumber(account, preciseKey, plainKey) {
  return numberOrNull(account?.[preciseKey]) ?? numberOrNull(account?.[plainKey]) ?? 0;
}

function toMs(value) {
  const n = numberOrNull(value);
  if (n === null) return null;
  return n < 20_000_000_000 ? n * 1000 : n;
}

function toIso(value) {
  const ms = toMs(value);
  if (ms === null) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRefillPack(account) {
  const cycleEnd = toMs(account?.CycleEndTime);
  const deductionEnd = toMs(account?.DeductionEndTime);
  if (cycleEnd === null || deductionEnd === null) return false;
  return deductionEnd - cycleEnd > REFILL_GAP_MS;
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(account) {
  const start = toMs(account?.CycleStartTime);
  const end = toMs(account?.CycleEndTime);
  if (start !== null && end !== null) {
    const days = (end - start) / 86_400_000;
    if (days <= 1.5) return 'Daily';
    if (days <= 10) return 'Weekly';
  }
  return 'Monthly';
}

function packWindow(account, label, { recurring }) {
  const used = packNumber(account, 'CycleCapacityUsedPrecise', 'CycleCapacityUsed');
  const total = packNumber(account, 'CycleCapacitySizePrecise', 'CycleCapacitySize');
  return {
    kind: 'billing',
    label,
    used,
    limit: total,
    remaining: Math.max(0, total - used),
    usedPercent: total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : null,
    resetsAt: toIso(account?.CycleEndTime),
    ...(recurring ? { resetPolicy: 'fixed' } : {}),
    showMeter: total > 0
  };
}

function bonusWindow(account, index) {
  const used = packNumber(account, 'CapacityUsedPrecise', 'CapacityUsed');
  const total = packNumber(account, 'CapacitySizePrecise', 'CapacitySize');
  return {
    kind: 'billing',
    label: `Bonus Pack ${index + 1}`,
    used,
    limit: total,
    remaining: Math.max(0, total - used),
    usedPercent: total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : null,
    resetsAt: toIso(account?.CycleEndTime),
    resetDescription: 'One-shot credits — expires without refilling.',
    showMeter: total > 0
  };
}

function windowsFromAccounts(accounts) {
  const byExpiry = (a, b) => (toMs(a?.CycleEndTime) ?? Infinity) - (toMs(b?.CycleEndTime) ?? Infinity);
  const refills = accounts.filter(isRefillPack).sort(byExpiry);
  const bonuses = accounts.filter((account) => !isRefillPack(account)).sort(byExpiry);
  const windows = [];
  const seenCadence = new Map();
  for (const account of refills) {
    const base = refillCadence(account);
    const count = (seenCadence.get(base) || 0) + 1;
    seenCadence.set(base, count);
    windows.push(packWindow(account, count > 1 ? `${base} ${count}` : base, { recurring: true }));
  }
  bonuses.forEach((account, index) => windows.push(bonusWindow(account, index)));
  const plan = refills[0] || accounts[0] || {};
  return {
    windows,
    planLabel: String(plan.PackageName || plan.SubProductName || '').trim()
  };
}

function statusFromHttpCode(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'sourceRateLimited';
  return 'unavailable';
}

function parseCodeBuddyBody(body) {
  if (!body || typeof body !== 'object' || body.code !== 0) {
    const error = new Error(`CodeBuddy quota error: ${body?.msg || 'unknown'}`);
    error.status = 'error';
    throw error;
  }
  const data = body?.data?.Response?.Data || {};
  return Array.isArray(data.Accounts) ? data.Accounts : [];
}

async function fetchCodeBuddyLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const token = codebuddyToken(env, options);
  if (!token) {
    return normalizeLimitProvider({
      provider: 'codebuddy',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  const deadlineMs = Number(deps.codebuddyFetchTimeoutMs || deps.fetchTimeoutMs || CODEBUDDY_FETCH_TIMEOUT_MS);
  try {
    const { response, body } = await runWithProbeDeadline(async ({ signal }) => {
      const res = await (deps.fetch || fetch)(CODEBUDDY_USAGE_URL, {
        method: 'POST',
        headers: {
          ...CODEBUDDY_HEADERS,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: '{}',
        signal
      });
      const parsed = res.ok ? await res.json().catch(() => null) : null;
      return { response: res, body: parsed };
    }, { signal: deps.signal, deadlineMs });

    if (!response.ok) {
      const error = new Error(`CodeBuddy quota returned ${response.status}`);
      error.status = statusFromHttpCode(response.status);
      throw error;
    }
    const accounts = parseCodeBuddyBody(body);
    const { windows, planLabel } = windowsFromAccounts(accounts);
    return normalizeLimitProvider({
      provider: 'codebuddy',
      accountKey: hashKey('codebuddy', token),
      accountLabel: planLabel,
      source: 'api',
      status: 'ok',
      updatedAt,
      windows
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'codebuddy',
      source: 'api',
      status: error?.status === 'timeout' ? 'unavailable' : error?.status || 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

module.exports = {
  CODEBUDDY_FETCH_TIMEOUT_MS,
  CODEBUDDY_USAGE_URL,
  codebuddyToken,
  isRefillPack,
  refillCadence,
  windowsFromAccounts,
  parseCodeBuddyBody,
  fetchCodeBuddyLimits
};
