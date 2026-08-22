'use strict';

const { staleAfterMsForSyncUpload } = require('./syncUploadInterval');
const { resolveProviderIdentity, collapsesByAccount } = require('./limitProviderRegistry');

const DEFAULT_LIMITS_REFRESH_MS = 5 * 60 * 1000;
const VALID_STATUSES = new Set(['ok', 'disabled', 'notConfigured', 'unauthorized', 'rateLimited', 'sourceRateLimited', 'unavailable', 'error']);
const VALID_SOURCES = new Set(['oauth', 'cli', 'web', 'rpc', 'local', 'api']);
const VALID_SOURCE_DETAILS = new Set(['app', 'cli', 'ide', 'managed', 'unknown']);
const LIMITS_SCHEMA_VERSION = 2;
const VALID_CONNECTION_STATUSES = new Set([
  'ok', 'disabled', 'unauthorized', 'rateLimited', 'unavailable', 'error', 'notChecked', 'notConfigured'
]);
const VALID_QUOTA_STATUSES = new Set([
  'fresh', 'stale', 'unsupported', 'unavailable', 'unauthorized', 'rateLimited', 'error', 'notChecked'
]);
const VALID_IDENTITY_KINDS = new Set(['connection', 'legacy_account_key']);
const VALID_MANAGED_BY = new Set(['monitor', 'potluck', 'external']);
const VALID_AUTH_TYPES = new Set(['apikey', 'oauth', 'cookie', 'cli', 'rpc', 'unknown']);
const VALID_PRECISION = new Set(['exact', 'providerReported', 'derived', 'estimated', 'stale', 'unavailable']);
const VALID_RESET_POLICIES = new Set(['fixed', 'rolling', 'unknown']);
const VALID_ERROR_CATEGORIES = new Set([
  'rate_limit', 'auth', 'network', 'parse', 'unavailable', 'internal', 'unknown'
]);
const VALID_LIMITS_CAPABILITIES = new Set([
  'connection_status_v2',
  'quota_status_v2',
  'quota_pool_key',
  'forecast_read',
  'status_v2',
  'multi_connection',
  'quota_pool',
  'daily_archive'
]);
const MAX_OPAQUE_KEY_LENGTH = 256;
const MAX_ERROR_DETAIL_LENGTH = 96;
const MAX_SNAPSHOT_ID_LENGTH = 128;
const MAX_SOURCE_INSTANCE_ID_LENGTH = 128;
const MAX_WINDOW_KEY_LENGTH = 64;
const MAX_CAPABILITIES = 32;
const MAX_QUOTA_POOLS = 256;
const MAX_SCOPE_KEYS = 512;
const WINDOW_ORDER = ['session', 'weekly', 'billing'];
const CODEX_TRANSIENT_WINDOW_RETENTION_MS = 10 * 60 * 1000;
const CODEX_TRANSIENT_PROVIDER_STATUSES = new Set(['unavailable', 'error', 'rateLimited', 'sourceRateLimited']);
const MAX_ACCOUNT_LABEL_INPUT_LENGTH = 256;
const MAX_ACCOUNT_NAME_INPUT_LENGTH = 512;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[%,$]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeProviderId(value) {
  const identity = resolveProviderIdentity(value);
  return identity ? identity.id : null;
}

function normalizeStatus(value) {
  const raw = String(value || '').trim();
  return VALID_STATUSES.has(raw) ? raw : 'error';
}

function normalizeSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  return VALID_SOURCES.has(raw) ? raw : '';
}

function normalizeSourceDetail(value) {
  const raw = String(value || '').trim().toLowerCase();
  return VALID_SOURCE_DETAILS.has(raw) ? raw : '';
}

function containsSensitiveAccountText(value) {
  const normalized = value.normalize('NFKC');
  return normalized.includes('@') || /https?:\/\//i.test(normalized);
}

function normalizeAccountLabel(value) {
  const raw = String(value || '').trim();
  if (
    !raw
    || raw.length > MAX_ACCOUNT_LABEL_INPUT_LENGTH
    || containsSensitiveAccountText(raw)
  ) return '';
  const clean = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} +._-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return clean && [...clean].length <= 32 ? clean : '';
}

function normalizeAccountName(value) {
  const raw = String(value || '').trim();
  if (
    !raw
    || raw.length > MAX_ACCOUNT_NAME_INPUT_LENGTH
    || containsSensitiveAccountText(raw)
  ) return '';
  const clean = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return clean && [...clean].length <= 64 ? clean : '';
}

function normalizeAccountEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.length > 254 || !raw.includes('@')) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : '';
}

function normalizeWindowKind(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  if (raw === 'session') return 'session';
  if (raw === 'weekly') return 'weekly';
  if (raw === 'billing' || raw === 'billingcycle' || raw === 'monthly') return 'billing';
  return null;
}

function normalizeWindowLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 32) return '';
  const clean = raw.replace(/[^a-z0-9 +._/-]/gi, '').replace(/\s+/g, ' ').trim();
  return clean.length <= 32 ? clean : '';
}

function normalizeWindowDetail(value) {
  const raw = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return raw.slice(0, 96);
}

function normalizeWindowCurrency(value) {
  return String(value || '').trim().toUpperCase().slice(0, 8) || null;
}

function normalizeIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value < 20_000_000_000 ? value * 1000 : value);
  } else {
    date = new Date(String(value));
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDateText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const iso = normalizeIsoTimestamp(raw);
  if (iso) return iso.slice(0, 10);
  return raw.length <= 32 ? raw : '';
}

function numberOrNull(value) {
  const number = asNumber(value);
  return number === null ? null : number;
}

function normalizeOpaqueKey(value, maxLength = MAX_OPAQUE_KEY_LENGTH) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > maxLength) return '';
  if (/[\u0000-\u001f\u007f]/.test(raw) || /\s/.test(raw) || raw.includes('://')) return '';
  if (/^(sk-|rk-|Bearer)/i.test(raw)) return '';
  return raw;
}

function normalizeConnectionStatus(value) {
  const raw = String(value || '').trim();
  if (raw === 'checking') return 'notChecked';
  if (raw === 'connected') return 'ok';
  return VALID_CONNECTION_STATUSES.has(raw) ? raw : '';
}

function normalizeQuotaStatus(value) {
  const raw = String(value || '').trim();
  return VALID_QUOTA_STATUSES.has(raw) ? raw : '';
}

function normalizeIdentityKind(value) {
  const raw = String(value || '').trim();
  return VALID_IDENTITY_KINDS.has(raw) ? raw : '';
}

function normalizeManagedBy(value) {
  const raw = String(value || '').trim().toLowerCase();
  return VALID_MANAGED_BY.has(raw) ? raw : '';
}

function normalizeAuthType(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '');
  if (raw === 'apikey' || raw === 'api_key') return 'apikey';
  return VALID_AUTH_TYPES.has(raw) ? raw : '';
}

function normalizePrecision(value) {
  const raw = String(value || '').trim();
  return VALID_PRECISION.has(raw) ? raw : '';
}

function normalizeResetPolicy(value) {
  const raw = String(value || '').trim().toLowerCase();
  return VALID_RESET_POLICIES.has(raw) ? raw : '';
}

function normalizeResetConfidence(value) {
  const number = asNumber(value);
  return number === null ? null : clamp(number, 0, 1);
}

function normalizeOptionalBoolean(value) {
  if (value === true || value === false) return value;
  return null;
}

function looksLikeSecretText(value) {
  return /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|client[_-]?secret|secret[_-]?access/i.test(value);
}

function projectLegacyStatus(connectionStatus, quotaStatus) {
  if (connectionStatus === 'disabled') return 'disabled';
  if (connectionStatus === 'notConfigured') return 'notConfigured';
  if (connectionStatus === 'unauthorized' || quotaStatus === 'unauthorized') return 'unauthorized';
  if (quotaStatus === 'rateLimited' || connectionStatus === 'rateLimited') return 'rateLimited';
  if (
    connectionStatus === 'ok'
    && (quotaStatus === 'fresh' || quotaStatus === 'unsupported' || quotaStatus === 'stale' || quotaStatus === 'notChecked')
  ) {
    return 'ok';
  }
  if (connectionStatus === 'unavailable' || quotaStatus === 'unavailable') return 'unavailable';
  if (connectionStatus === 'error' || quotaStatus === 'error') return 'error';
  return 'error';
}

function deriveSplitStatuses(status, windows) {
  if (status === 'disabled') return { connectionStatus: 'disabled', quotaStatus: 'notChecked' };
  if (status === 'notConfigured') return { connectionStatus: 'notConfigured', quotaStatus: 'notChecked' };
  if (status === 'unauthorized') return { connectionStatus: 'unauthorized', quotaStatus: 'unauthorized' };
  if (status === 'rateLimited') return { connectionStatus: 'rateLimited', quotaStatus: 'rateLimited' };
  if (status === 'sourceRateLimited') return { connectionStatus: 'ok', quotaStatus: 'rateLimited' };
  if (status === 'unavailable') return { connectionStatus: 'unavailable', quotaStatus: 'unavailable' };
  if (status === 'ok') {
    return {
      connectionStatus: 'ok',
      quotaStatus: Array.isArray(windows) && windows.length > 0 ? 'fresh' : 'unsupported'
    };
  }
  return { connectionStatus: 'error', quotaStatus: 'error' };
}

function defaultQuotaStatusForConnection(connectionStatus, windows) {
  if (connectionStatus === 'ok') return Array.isArray(windows) && windows.length > 0 ? 'fresh' : 'unsupported';
  if (connectionStatus === 'unauthorized') return 'unauthorized';
  if (connectionStatus === 'rateLimited') return 'rateLimited';
  if (connectionStatus === 'unavailable') return 'unavailable';
  if (connectionStatus === 'notConfigured' || connectionStatus === 'disabled' || connectionStatus === 'notChecked') {
    return 'notChecked';
  }
  return 'error';
}

function defaultConnectionStatusForQuota(quotaStatus) {
  if (quotaStatus === 'unauthorized') return 'unauthorized';
  if (quotaStatus === 'rateLimited') return 'rateLimited';
  if (quotaStatus === 'error') return 'error';
  if (quotaStatus === 'unavailable') return 'unavailable';
  return 'ok';
}

function resolveProviderStatuses(input, windows) {
  const hasLegacyStatus = hasOwn(input, 'status');
  const legacyStatus = hasLegacyStatus ? normalizeStatus(input.status) : null;
  let connectionStatus = normalizeConnectionStatus(input.connectionStatus ?? input.connection_status);
  let quotaStatus = normalizeQuotaStatus(input.quotaStatus ?? input.quota_status);
  const hasSplit = Boolean(connectionStatus || quotaStatus);
  if (!hasSplit) {
    const status = legacyStatus || 'error';
    const split = deriveSplitStatuses(status, windows);
    return { status, connectionStatus: split.connectionStatus, quotaStatus: split.quotaStatus };
  }
  if (!connectionStatus) connectionStatus = defaultConnectionStatusForQuota(quotaStatus);
  if (!quotaStatus) quotaStatus = defaultQuotaStatusForConnection(connectionStatus, windows);
  const projected = projectLegacyStatus(connectionStatus, quotaStatus);
  if (!hasLegacyStatus) {
    return { status: projected, connectionStatus, quotaStatus };
  }
  // Runtime last-good overlays patch only `status` onto a previous split snapshot.
  // When that patch disagrees with the leftover split, status wins and split is rebuilt.
  if (legacyStatus === projected) {
    return { status: legacyStatus, connectionStatus, quotaStatus };
  }
  const split = deriveSplitStatuses(legacyStatus, windows);
  return {
    status: legacyStatus,
    connectionStatus: split.connectionStatus,
    quotaStatus: split.quotaStatus
  };
}

function normalizeLimitError(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const categoryRaw = String(input.category || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const category = VALID_ERROR_CATEGORIES.has(categoryRaw) ? categoryRaw : 'unknown';
  const code = String(input.code || '').trim().slice(0, 64).replace(/[^a-zA-Z0-9._-]/g, '');
  const messageKey = String(input.messageKey || input.message_key || '').trim().slice(0, 96);
  const safeMessageKey = /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(messageKey) ? messageKey : '';
  let safeDetail = String(input.safeDetail || input.safe_detail || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_DETAIL_LENGTH);
  if (looksLikeSecretText(code) || looksLikeSecretText(safeDetail) || safeDetail.includes('://')) safeDetail = '';
  const retryAt = normalizeIsoTimestamp(input.retryAt ?? input.retry_at);
  if (!code && !safeMessageKey && !safeDetail && !retryAt) return null;
  return {
    code,
    category,
    retryAt,
    messageKey: safeMessageKey,
    safeDetail,
    recoverable: input.recoverable !== false
  };
}

function normalizeSchemaVersion(value) {
  const parsed = asNumber(value);
  return parsed === 1 || parsed === 2 ? parsed : null;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const capabilities = [];
  for (const item of value) {
    if (capabilities.length >= MAX_CAPABILITIES) break;
    const raw = String(item || '').trim();
    const token = VALID_LIMITS_CAPABILITIES.has(raw)
      ? raw
      : (/^[a-z][a-z0-9_]{0,63}$/.test(raw) ? raw : '');
    if (!token || seen.has(token)) continue;
    seen.add(token);
    capabilities.push(token);
  }
  return capabilities;
}

function normalizeOpaqueKeyList(value, maxItems = MAX_SCOPE_KEYS) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const keys = [];
  for (const item of value) {
    if (keys.length >= maxItems) break;
    const key = normalizeOpaqueKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function normalizeSnapshotScope(input) {
  if (!input || typeof input !== 'object') return null;
  const connectionKeys = normalizeOpaqueKeyList(input.connectionKeys ?? input.connection_keys);
  const providers = [];
  const seenProviders = new Set();
  for (const item of Array.isArray(input.providers) ? input.providers : []) {
    const id = normalizeProviderId(item);
    if (!id || seenProviders.has(id)) continue;
    seenProviders.add(id);
    providers.push(id);
  }
  if (connectionKeys.length === 0 && providers.length === 0) return null;
  return {
    ...(connectionKeys.length > 0 ? { connectionKeys } : {}),
    ...(providers.length > 0 ? { providers } : {})
  };
}

function normalizeQuotaPool(input) {
  if (!input || typeof input !== 'object') return null;
  const quotaPoolKey = normalizeOpaqueKey(
    input.quotaPoolKey ?? input.quota_pool_key ?? input.poolId ?? input.pool_id
  );
  if (!quotaPoolKey) return null;
  const provider = normalizeProviderId(input.provider) || '';
  const windows = Array.isArray(input.windows)
    ? input.windows.map(normalizeLimitWindow).filter(Boolean)
    : [];
  return {
    quotaPoolKey,
    ...(provider ? { provider } : {}),
    label: normalizeAccountLabel(input.label ?? input.displayLabel),
    connectionKeys: normalizeOpaqueKeyList(input.connectionKeys ?? input.connection_keys),
    windows
  };
}

function percentFromWindow(input, used, limit) {
  const explicit = numberOrNull(input.usedPercent ?? input.used_percent ?? input.utilization ?? input.percent);
  if (explicit !== null) return clamp(explicit, 0, 100);
  if (used !== null && limit !== null && limit > 0) return clamp((used / limit) * 100, 0, 100);
  return null;
}

function normalizeLimitWindow(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = normalizeWindowKind(input.kind || input.type || input.name || input.window || input.windowKind);
  if (!kind) return null;
  const metricValue = String(input.metric || '').trim().toLowerCase();
  const metric = metricValue === 'credits' ? metricValue : null;
  const used = numberOrNull(input.used);
  const limit = numberOrNull(input.limit);
  const remaining = numberOrNull(input.remaining);
  const usedPercent = percentFromWindow(input, used, limit);
  const windowDurationMsInput = numberOrNull(input.windowDurationMs ?? input.window_duration_ms);
  const windowMinutesInput = numberOrNull(
    input.windowMinutes ?? input.window_minutes ?? input.windowDurationMins
  );
  const windowMinutes = windowMinutesInput !== null
    ? windowMinutesInput
    : (windowDurationMsInput === null ? null : windowDurationMsInput / 60000);
  const windowDurationMs = windowDurationMsInput !== null
    ? Math.max(0, Math.round(windowDurationMsInput))
    : (windowMinutes === null ? null : Math.max(0, Math.round(windowMinutes * 60000)));
  const windowKey = normalizeOpaqueKey(input.windowKey ?? input.window_key, MAX_WINDOW_KEY_LENGTH);
  const windowStartedAt = normalizeIsoTimestamp(
    input.windowStartedAt ?? input.window_started_at ?? input.startedAt
  );
  const resetPolicy = normalizeResetPolicy(input.resetPolicy ?? input.reset_policy);
  const resetConfidence = normalizeResetConfidence(input.resetConfidence ?? input.reset_confidence);
  const precision = normalizePrecision(input.precision);
  return {
    kind,
    ...(metric ? { metric } : {}),
    ...(windowKey ? { windowKey } : {}),
    label: normalizeWindowLabel(input.label || input.displayLabel || input.title),
    used,
    limit,
    remaining,
    usedPercent,
    remainingPercent: usedPercent === null ? null : Number((100 - usedPercent).toFixed(3)),
    // Canonical writer field is resetsAt; readers also accept resetAt / resets_at.
    resetsAt: normalizeIsoTimestamp(input.resetsAt ?? input.resets_at ?? input.resetAt ?? input.reset_at),
    windowMinutes,
    ...(windowDurationMs !== null ? { windowDurationMs } : {}),
    ...(windowStartedAt ? { windowStartedAt } : {}),
    ...(resetPolicy ? { resetPolicy } : {}),
    ...(resetConfidence !== null ? { resetConfidence } : {}),
    ...(precision ? { precision } : {}),
    resetDescription: input.resetDescription ? String(input.resetDescription) : '',
    detail: normalizeWindowDetail(input.detail ?? input.detailText ?? input.detail_text),
    currency: normalizeWindowCurrency(input.currency),
    showMeter: input.showMeter !== false && input.meter !== false
  };
}

function normalizeProviderBalance(input) {
  if (!input || typeof input !== 'object') return null;
  const amount = numberOrNull(input.amount ?? input.balance ?? input.accountBalance ?? input.account_balance);
  const currency = String(
    input.currency
    || input.balanceCurrency
    || input.balance_currency
    || input.accountCurrency
    || input.account_currency
    || ''
  ).trim().toUpperCase().slice(0, 8) || null;
  const todaySpend = numberOrNull(input.todaySpend ?? input.today_spend);
  const weekSpend = numberOrNull(input.weekSpend ?? input.week_spend);
  const monthSpend = numberOrNull(input.monthSpend ?? input.month_spend);
  const allTimeSpend = numberOrNull(input.allTimeSpend ?? input.all_time_spend);
  const requestCountRaw = numberOrNull(input.requestCount ?? input.request_count);
  const requestCount = requestCountRaw === null ? null : Math.max(0, Math.trunc(requestCountRaw));
  const quotaGroup = String(input.quotaGroup ?? input.quota_group ?? '').trim().slice(0, 64);
  const expiresAt = normalizeIsoTimestamp(input.expiresAt ?? input.expires_at);
  const trackingSince = normalizeIsoTimestamp(input.trackingSince ?? input.tracking_since);
  const monthSinceTracking = input.monthSinceTracking ?? input.month_since_tracking;
  const giftBalance = numberOrNull(input.giftBalance ?? input.gift_balance);
  const cashBalance = numberOrNull(input.cashBalance ?? input.cash_balance);
  const planUsed = numberOrNull(input.planUsed ?? input.plan_used);
  const planLimit = numberOrNull(input.planLimit ?? input.plan_limit);
  const planPercent = numberOrNull(input.planPercent ?? input.plan_percent);
  const planStatus = ['active', 'expired'].includes(String(input.planStatus ?? input.plan_status ?? '').trim().toLowerCase())
    ? String(input.planStatus ?? input.plan_status).trim().toLowerCase()
    : null;
  const todayTokenTotal = numberOrNull(input.todayTokenTotal ?? input.today_token_total);
  const todayUsageDate = normalizeDateText(input.todayUsageDate ?? input.today_usage_date);
  const latestModelUsageDate = normalizeDateText(input.latestModelUsageDate ?? input.latest_model_usage_date);
  const todayUsageBasis = String(input.todayUsageBasis ?? input.today_usage_basis ?? '').trim().slice(0, 64);
  const snapshotDate = normalizeDateText(input.snapshotDate ?? input.snapshot_date ?? input.date);
  if (
    amount === null
    && !currency
    && todaySpend === null
    && weekSpend === null
    && monthSpend === null
    && allTimeSpend === null
    && requestCount === null
    && !quotaGroup
    && !expiresAt
    && !trackingSince
    && monthSinceTracking === undefined
    && giftBalance === null
    && cashBalance === null
    && planUsed === null
    && planLimit === null
    && planPercent === null
    && planStatus === null
    && todayTokenTotal === null
    && !todayUsageDate
    && !latestModelUsageDate
    && !todayUsageBasis
    && !snapshotDate
  ) return null;
  return {
    amount,
    currency,
    todaySpend,
    weekSpend,
    monthSpend,
    allTimeSpend,
    requestCount,
    quotaGroup,
    expiresAt,
    trackingSince,
    monthSinceTracking: Boolean(monthSinceTracking),
    giftBalance,
    cashBalance,
    planUsed,
    planLimit,
    planPercent,
    planStatus,
    todayTokenTotal,
    todayUsageDate,
    latestModelUsageDate,
    todayUsageBasis,
    snapshotDate
  };
}

function normalizeResetCreditExpirations(input) {
  const raw = input?.expirations ?? input?.expirationTimes ?? input?.expiresAtList ?? input?.expires_at_list ?? input?.credits;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const expirations = [];
  for (const value of raw) {
    if (value && typeof value === 'object') {
      const status = String(value.status || '').toLowerCase();
      if (status && status !== 'available') continue;
    }
    const sourceValue = value && typeof value === 'object'
      ? value.expiresAt ?? value.expires_at ?? value.nextExpiresAt ?? value.next_expires_at
      : value;
    const normalized = normalizeIsoTimestamp(sourceValue);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    expirations.push(normalized);
  }
  expirations.sort((a, b) => Date.parse(a) - Date.parse(b));
  return expirations;
}

function normalizeProviderResetCredits(input) {
  if (!input || typeof input !== 'object') return null;
  const available = numberOrNull(
    input.availableCount
    ?? input.available_count
    ?? input.available
    ?? input.remainingCount
    ?? input.remaining_count
  );
  const nextExpiresAt = normalizeIsoTimestamp(
    input.nextExpiresAt
    ?? input.next_expires_at
    ?? input.nextExpirationAt
    ?? input.next_expiration_at
    ?? input.expiresAt
    ?? input.expires_at
  );
  const expirations = normalizeResetCreditExpirations(input);
  const firstExpiration = expirations[0] || null;
  const effectiveNextExpiresAt = [nextExpiresAt, firstExpiration]
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
  if (available === null && !effectiveNextExpiresAt && expirations.length === 0) return null;
  return {
    availableCount: available === null ? null : Math.max(0, Math.floor(available)),
    nextExpiresAt: effectiveNextExpiresAt,
    ...(expirations.length > 0 ? { expirations } : {})
  };
}

function normalizeRegion(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'cn' || raw === 'en' || raw === 'global') return raw;
  return raw.length <= 16 ? raw : '';
}

function normalizeWorkspaceKind(value) {
  return String(value || '').trim().toLowerCase() === 'personal' ? 'personal' : '';
}

function normalizeLimitProvider(input) {
  if (!input || typeof input !== 'object') return null;
  const identity = resolveProviderIdentity(input.provider);
  if (!identity) return null;
  const provider = identity.id;
  const accountLabel = normalizeAccountLabel(input.accountLabel);
  const windows = Array.isArray(input.windows)
    ? input.windows.map(normalizeLimitWindow).filter(Boolean)
    : [];
  if (provider === 'antigravity') {
    const groupRank = (window) => {
      const label = String(window.label || '').toLowerCase();
      if (label.includes('gemini')) return 0;
      if (label.includes('claude') || label.includes('gpt')) return 1;
      return 2;
    };
    windows.sort((a, b) => groupRank(a) - groupRank(b)
      || WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind));
  } else {
    windows.sort((a, b) => WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind));
  }
  const balance = normalizeProviderBalance(input.balance);
  // Compatibility shim: devices older than the credits-window change post a
  // balance with no window at all, so every renderer would drop the row.
  // Synthesize the window here — the one funnel both the local collector and
  // hub ingest pass through — so no surface has to remember to do it. Only the
  // amount is restored; the meter percentage stays a display-layer derivation.
  // Removable once no supported device predates that change.
  if (balance && balance.amount !== null && !windows.some((window) => window.metric === 'credits')) {
    windows.push(normalizeLimitWindow({
      kind: 'billing',
      metric: 'credits',
      label: 'Balance',
      remaining: balance.amount,
      currency: balance.currency
    }));
  }
  const statuses = resolveProviderStatuses(input, windows);
  const connectionKey = normalizeOpaqueKey(input.connectionKey ?? input.connection_key);
  const accountKey = input.accountKey ? String(input.accountKey) : '';
  const identityKind = normalizeIdentityKind(input.identityKind ?? input.identity_kind)
    || (connectionKey ? 'connection' : (accountKey ? 'legacy_account_key' : ''));
  const managedBy = normalizeManagedBy(input.managedBy ?? input.managed_by);
  const authType = normalizeAuthType(input.authType ?? input.auth_type);
  const enabled = normalizeOptionalBoolean(input.enabled);
  const tracked = normalizeOptionalBoolean(input.tracked);
  const lastAttemptAt = normalizeIsoTimestamp(input.lastAttemptAt ?? input.last_attempt_at);
  const lastSuccessAt = normalizeIsoTimestamp(input.lastSuccessAt ?? input.last_success_at);
  const upstreamAccountKey = normalizeOpaqueKey(input.upstreamAccountKey ?? input.upstream_account_key);
  const quotaPoolKey = normalizeOpaqueKey(input.quotaPoolKey ?? input.quota_pool_key);
  const precision = normalizePrecision(input.precision);
  const error = normalizeLimitError(input.error);
  const record = {
    provider,
    accountKey,
    accountLabel,
    planLabel: normalizeAccountLabel(input.planLabel),
    accountName: normalizeAccountName(input.accountName ?? input.accountLogin ?? input.login),
    accountEmail: normalizeAccountEmail(input.accountEmail ?? input.email),
    workspaceKind: normalizeWorkspaceKind(input.workspaceKind),
    status: statuses.status,
    connectionStatus: statuses.connectionStatus,
    quotaStatus: statuses.quotaStatus,
    source: normalizeSource(input.source),
    sourceDetail: normalizeSourceDetail(input.sourceDetail ?? input.source_detail),
    updatedAt: normalizeIsoTimestamp(input.updatedAt) || normalizeIsoTimestamp(input.checkedAt),
    windows,
    balanceUsd: numberOrNull(input.balanceUsd),
    balance,
    resetCredits: normalizeProviderResetCredits(input.resetCredits ?? input.rateLimitResetCredits ?? input.rate_limit_reset_credits),
    region: normalizeRegion(input.region) || identity.region || ''
  };
  if (connectionKey) record.connectionKey = connectionKey;
  if (identityKind) record.identityKind = identityKind;
  if (managedBy) record.managedBy = managedBy;
  if (authType) record.authType = authType;
  if (enabled !== null) record.enabled = enabled;
  if (tracked !== null) record.tracked = tracked;
  if (lastAttemptAt) record.lastAttemptAt = lastAttemptAt;
  if (lastSuccessAt) record.lastSuccessAt = lastSuccessAt;
  if (upstreamAccountKey) record.upstreamAccountKey = upstreamAccountKey;
  if (quotaPoolKey) record.quotaPoolKey = quotaPoolKey;
  if (precision) record.precision = precision;
  if (error) record.error = error;
  return record;
}

function normalizeRefreshMs(value) {
  const parsed = asNumber(value);
  return parsed && parsed > 0 ? Math.round(parsed) : DEFAULT_LIMITS_REFRESH_MS;
}

function normalizeLimitsSummary(input) {
  const source = input && typeof input === 'object' ? input : {};
  const providers = Array.isArray(source.providers)
    ? source.providers.map(normalizeLimitProvider).filter(Boolean)
    : [];
  const summary = {
    updatedAt: normalizeIsoTimestamp(source.updatedAt ?? source.generatedAt),
    refreshMs: normalizeRefreshMs(source.refreshMs),
    providers
  };
  const schemaVersion = normalizeSchemaVersion(source.schemaVersion ?? source.schema_version);
  if (schemaVersion) summary.schemaVersion = schemaVersion;
  const snapshotId = normalizeOpaqueKey(source.snapshotId ?? source.snapshot_id, MAX_SNAPSHOT_ID_LENGTH);
  if (snapshotId) summary.snapshotId = snapshotId;
  const sourceInstanceId = normalizeOpaqueKey(
    source.sourceInstanceId ?? source.source_instance_id,
    MAX_SOURCE_INSTANCE_ID_LENGTH
  );
  if (sourceInstanceId) summary.sourceInstanceId = sourceInstanceId;
  const generatedAt = normalizeIsoTimestamp(source.generatedAt ?? source.generated_at);
  if (generatedAt) summary.generatedAt = generatedAt;

  const requestedType = String(source.snapshotType ?? source.snapshot_type ?? '').trim().toLowerCase();
  const scope = normalizeSnapshotScope(source.scope);
  if (requestedType === 'full') {
    summary.snapshotType = 'full';
  } else if (requestedType === 'partial' && scope) {
    summary.snapshotType = 'partial';
    summary.scope = scope;
  }

  const capabilities = normalizeCapabilities(source.capabilities);
  if (capabilities.length > 0) summary.capabilities = capabilities;

  const quotaPoolSource = source.quotaPools ?? source.quota_pools;
  const quotaPools = Array.isArray(quotaPoolSource)
    ? quotaPoolSource.map(normalizeQuotaPool).filter(Boolean).slice(0, MAX_QUOTA_POOLS)
    : [];
  if (quotaPools.length > 0) summary.quotaPools = quotaPools;

  return summary;
}

function statusRank(status) {
  if (status === 'ok') return 3;
  if (status === 'rateLimited') return 2;
  if (status === 'sourceRateLimited' || status === 'unauthorized' || status === 'unavailable' || status === 'error') return 1;
  return 0;
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProviderStale(provider, summary, device, staleAfterMs, nowMs) {
  if (device?.stale) return true;
  const updatedAt = timestampMs(provider.updatedAt || summary.updatedAt);
  if (!updatedAt) return false;
  const threshold = Math.max(
    normalizeRefreshMs(summary.refreshMs) * 2,
    staleAfterMsForSyncUpload(device?.syncUploadIntervalMs, staleAfterMs)
  );
  return threshold > 0 ? nowMs - updatedAt > threshold : false;
}

function providerAggregateKey(provider) {
  return `${provider.provider}:${provider.accountKey || provider.status}`;
}

function isConfiguredProvider(provider) {
  return Boolean(provider.accountKey && provider.status !== 'notConfigured' && provider.status !== 'disabled');
}

function providerCollapseKey(provider) {
  const managedExternally = provider.managedBy === 'potluck' || provider.managedBy === 'external';
  if ((managedExternally || collapsesByAccount(provider.provider)) && provider.accountKey) {
    return providerAggregateKey(provider);
  }
  return provider.provider;
}

function providerWindowRank(provider) {
  if (provider?.provider !== 'codex') return 0;
  return Array.isArray(provider.windows) && provider.windows.length > 0 ? 1 : 0;
}

function codexProviderIdentityKeys(provider) {
  if (provider?.provider !== 'codex') return [];
  return [
    provider.accountKey ? `key:${provider.accountKey}` : '',
    provider.accountEmail ? `email:${provider.accountEmail}` : ''
  ].filter(Boolean);
}

function hasProviderWindows(provider) {
  return Array.isArray(provider?.windows) && provider.windows.length > 0;
}

function cloneLimitWindows(windows) {
  return (windows || []).map((window) => ({ ...window }));
}

function retainedCodexProvider(previousProvider, currentProvider, windows) {
  return {
    ...previousProvider,
    ...currentProvider,
    accountKey: currentProvider.accountKey || previousProvider.accountKey,
    accountLabel: currentProvider.accountLabel || previousProvider.accountLabel,
    planLabel: currentProvider.planLabel || previousProvider.planLabel,
    accountName: currentProvider.accountName || previousProvider.accountName,
    accountEmail: currentProvider.accountEmail || previousProvider.accountEmail,
    source: currentProvider.source || previousProvider.source,
    sourceDetail: currentProvider.sourceDetail || previousProvider.sourceDetail,
    status: 'ok',
    connectionStatus: 'ok',
    quotaStatus: 'stale',
    updatedAt: previousProvider.updatedAt || currentProvider.updatedAt,
    windows: cloneLimitWindows(windows),
    resetCredits: currentProvider.resetCredits || previousProvider.resetCredits
  };
}

function mergeCodexProviderSnapshot(previousProvider, currentProvider) {
  if (CODEX_TRANSIENT_PROVIDER_STATUSES.has(currentProvider.status)) {
    return retainedCodexProvider(previousProvider, currentProvider, previousProvider.windows);
  }
  if (currentProvider.status !== 'ok') return currentProvider;
  if (!hasProviderWindows(currentProvider)) {
    return retainedCodexProvider(previousProvider, currentProvider, previousProvider.windows);
  }
  // A successful non-empty snapshot is authoritative. Codex can legitimately
  // change percentages and reset targets after a global reset or reset-credit
  // action, so quota values are not monotonic client-side invariants.
  return currentProvider;
}

function mergeCodexTransientWindows(previousInput, currentInput, nowMs = Date.now(), retentionMs = CODEX_TRANSIENT_WINDOW_RETENTION_MS) {
  const current = normalizeLimitsSummary(currentInput);
  if (!previousInput || !Number.isFinite(Number(retentionMs)) || Number(retentionMs) <= 0) return current;
  const previous = normalizeLimitsSummary(previousInput);
  const currentMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const previousByIdentity = new Map();
  const eligiblePreviousCodexProviders = [];

  for (const provider of previous.providers) {
    if (provider.provider !== 'codex' || provider.status !== 'ok' || !hasProviderWindows(provider)) continue;
    const effectiveUpdatedAt = provider.updatedAt || previous.updatedAt;
    const providerUpdatedAt = timestampMs(effectiveUpdatedAt);
    if (!providerUpdatedAt || currentMs - providerUpdatedAt < 0 || currentMs - providerUpdatedAt > Number(retentionMs)) continue;
    const eligibleProvider = provider.updatedAt ? provider : { ...provider, updatedAt: effectiveUpdatedAt };
    eligiblePreviousCodexProviders.push(eligibleProvider);
    for (const key of codexProviderIdentityKeys(eligibleProvider)) {
      const existing = previousByIdentity.get(key);
      if (existing === undefined) {
        previousByIdentity.set(key, eligibleProvider);
      } else if (existing && existing !== eligibleProvider) {
        previousByIdentity.set(key, null);
      }
    }
  }

  const currentCodexProviders = current.providers.filter((provider) => provider.provider === 'codex');
  const singletonFallback = currentCodexProviders.length === 1 && eligiblePreviousCodexProviders.length === 1
    ? eligiblePreviousCodexProviders[0]
    : null;

  return {
    ...current,
    providers: current.providers.map((provider) => {
      if (provider.provider !== 'codex') return provider;
      const identityKeys = codexProviderIdentityKeys(provider);
      const identityMatches = new Set(identityKeys.map((key) => previousByIdentity.get(key)).filter(Boolean));
      const identityMatch = identityMatches.size === 1 ? identityMatches.values().next().value : null;
      const previousProvider = identityMatch || (
        CODEX_TRANSIENT_PROVIDER_STATUSES.has(provider.status) && identityKeys.length === 0
          ? singletonFallback
          : null
      );
      if (!previousProvider) return provider;
      return mergeCodexProviderSnapshot(previousProvider, provider);
    })
  };
}

function pickBetterProvider(current, candidate) {
  if (!current) return candidate;
  if (current.stale !== candidate.stale) return current.stale ? candidate : current;
  const rankDiff = statusRank(candidate.status) - statusRank(current.status);
  if (rankDiff !== 0) return rankDiff > 0 ? candidate : current;
  const windowRankDiff = providerWindowRank(candidate) - providerWindowRank(current);
  if (windowRankDiff !== 0) return windowRankDiff > 0 ? candidate : current;
  return timestampMs(candidate.updatedAt) >= timestampMs(current.updatedAt) ? candidate : current;
}

function isExternalManagedRow(row) {
  return row?.managedBy === 'potluck' || row?.managedBy === 'external';
}

function windowInfoRank(window) {
  return (window?.resetsAt ? 4 : 0)
    + (window?.usedPercent !== null && window?.usedPercent !== undefined ? 2 : 0)
    + (window?.remainingPercent !== null && window?.remainingPercent !== undefined ? 1 : 0);
}

function mergeWindowListsByKind(rows) {
  const byKind = new Map();
  for (const row of rows) {
    for (const window of row?.windows || []) {
      const kind = String(window?.kind || 'billing');
      const existing = byKind.get(kind);
      if (!existing || windowInfoRank(window) > windowInfoRank(existing)) byKind.set(kind, window);
    }
  }
  return Array.from(byKind.values());
}

// The same account can be reported by two sources — Potluck Web (api-key row)
// and a local probe (cookie row) — with different accountKeys but the same
// accountEmail. Merge exactly that cross-source case into one row so Home does
// not show the account twice. Same-email rows from a single source stay
// separate: Codex personal/team workspaces share an email legitimately.
function mergeCrossSourceAccountRows(providers) {
  const result = [];
  const groups = new Map();
  for (const row of providers || []) {
    const email = String(row?.accountEmail || '').trim().toLowerCase();
    if (!email) {
      result.push(row);
      continue;
    }
    const key = `${row.provider}:${email}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const hasExternal = group.some(isExternalManagedRow);
    const hasLocal = group.some((row) => !isExternalManagedRow(row));
    const workspaces = new Set(group.map((row) => String(row?.workspaceKind || '').trim()).filter(Boolean));
    if (group.length === 1 || !hasExternal || !hasLocal || workspaces.size > 1) {
      result.push(...group);
      continue;
    }
    // Display base: the row whose windows carry reset times (usually the local
    // probe); health fields come from whichever source is in better shape.
    const base = group.reduce((best, row) => {
      const scoreDiff = (row?.windows || []).filter((window) => window?.resetsAt).length
        - (best?.windows || []).filter((window) => window?.resetsAt).length;
      if (scoreDiff !== 0) return scoreDiff > 0 ? row : best;
      return pickBetterProvider(best, row);
    });
    const best = group.reduce((current, row) => pickBetterProvider(current, row));
    const merged = {
      ...base,
      accountKey: base.accountKey || best.accountKey,
      accountLabel: base.accountLabel || best.accountLabel,
      accountName: base.accountName || best.accountName,
      planLabel: base.planLabel || best.planLabel,
      status: best.status,
      connectionStatus: best.connectionStatus,
      quotaStatus: best.quotaStatus,
      updatedAt: group.reduce((latest, row) => (String(row?.updatedAt || '') > latest ? String(row.updatedAt) : latest), ''),
      stale: group.every((row) => row?.stale),
      windows: mergeWindowListsByKind(group)
    };
    if (best.error) merged.error = best.error;
    else delete merged.error;
    result.push(merged);
  }
  return result;
}

function aggregateLimits(devices, staleAfterMs = 0, nowMs = Date.now()) {
  const aggregate = { updatedAt: new Date(nowMs).toISOString(), providers: [] };
  const byKey = new Map();
  const providersWithConfiguredAccounts = new Set();
  const providersWithFreshConfiguredAccounts = new Set();
  const providersWithFreshObservations = new Set();

  for (const device of devices || []) {
    const summary = normalizeLimitsSummary(device?.limits);
    for (const provider of summary.providers) {
      const candidate = {
        ...provider,
        sourceDeviceId: String(device?.deviceId || ''),
        stale: isProviderStale(provider, summary, device, staleAfterMs, nowMs)
      };
      if (isConfiguredProvider(provider)) providersWithConfiguredAccounts.add(provider.provider);
      if (!candidate.stale) {
        providersWithFreshObservations.add(provider.provider);
        if (isConfiguredProvider(provider)) providersWithFreshConfiguredAccounts.add(provider.provider);
      }
      const key = providerAggregateKey(provider);
      byKey.set(key, pickBetterProvider(byKey.get(key), candidate));
    }
  }

  // Second pass: collapse by provider name. Same OAuth account on Mac vs Windows
  // hashes to different accountKeys (keychain identity vs file path), so byKey
  // keeps them as separate entries; without this pass the renderer's per-provider
  // Map.set() would arbitrarily overwrite the fresh one with the stale one.
  const byProvider = new Map();
  for (const candidate of byKey.values()) {
    const hasFreshObservation = providersWithFreshObservations.has(candidate.provider);
    if (candidate.stale && hasFreshObservation) continue;
    const configuredProviders = hasFreshObservation
      ? providersWithFreshConfiguredAccounts
      : providersWithConfiguredAccounts;
    if (!isConfiguredProvider(candidate) && configuredProviders.has(candidate.provider)) continue;
    const collapseKey = providerCollapseKey(candidate);
    byProvider.set(collapseKey, pickBetterProvider(byProvider.get(collapseKey), candidate));
  }
  aggregate.providers = mergeCrossSourceAccountRows(Array.from(byProvider.values()))
    .sort((a, b) => {
      const providerSort = a.provider.localeCompare(b.provider);
      if (providerSort !== 0) return providerSort;
      const aLabel = a.accountEmail || a.accountName || a.accountLabel || a.accountKey;
      const bLabel = b.accountEmail || b.accountName || b.accountLabel || b.accountKey;
      return aLabel.localeCompare(bLabel);
    });
  return aggregate;
}

function copyLimitsEnvelope(normalized, extra) {
  const payload = {
    updatedAt: normalized.updatedAt,
    refreshMs: normalized.refreshMs,
    providers: extra.providers
  };
  if (normalized.schemaVersion) payload.schemaVersion = normalized.schemaVersion;
  if (normalized.snapshotId) payload.snapshotId = normalized.snapshotId;
  if (normalized.snapshotType) payload.snapshotType = normalized.snapshotType;
  if (normalized.sourceInstanceId) payload.sourceInstanceId = normalized.sourceInstanceId;
  if (normalized.generatedAt) payload.generatedAt = normalized.generatedAt;
  if (normalized.capabilities) payload.capabilities = normalized.capabilities;
  if (normalized.scope) payload.scope = normalized.scope;
  if (extra.quotaPools) payload.quotaPools = extra.quotaPools;
  return payload;
}

function publicLimits(limits) {
  const normalized = normalizeLimitsSummary(limits);
  return copyLimitsEnvelope(normalized, {
    providers: normalized.providers.map(({
      accountKey,
      accountEmail,
      accountName,
      accountLabel,
      planLabel,
      workspaceKind,
      connectionKey,
      upstreamAccountKey,
      quotaPoolKey,
      ...provider
    }) => {
      if (!provider.balance) return provider;
      const { quotaGroup, ...publicBalance } = provider.balance;
      return { ...provider, balance: publicBalance };
    }),
    quotaPools: normalized.quotaPools
      ? normalized.quotaPools.map(({ connectionKeys, ...pool }) => pool)
      : undefined
  });
}

// Sync to the authenticated hub carries the full account identity (key, email,
// display name, legacy label, and explicit plan label) so other devices can show
// which managed account each limit belongs to. Hub ingest is Secret-protected;
// the PUBLIC surface is still scrubbed by publicLimits() above, which drops all
// account and plan labels together with the account identifiers.
function syncLimits(limits) {
  const normalized = normalizeLimitsSummary(limits);
  return copyLimitsEnvelope(normalized, {
    providers: normalized.providers,
    quotaPools: normalized.quotaPools
  });
}

module.exports = {
  DEFAULT_LIMITS_REFRESH_MS,
  LIMITS_SCHEMA_VERSION,
  aggregateLimits,
  mergeCodexTransientWindows,
  normalizeLimitProvider,
  normalizeLimitsSummary,
  normalizeLimitWindow,
  publicLimits,
  syncLimits
};
