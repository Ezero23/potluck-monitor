'use strict';

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');

const OLLAMA_SETTINGS_URL = 'https://ollama.com/settings';
const OLLAMA_USAGE_URL = 'https://ollama.com/api/usage';
const OLLAMA_ME_URL = 'https://ollama.com/api/me';
const OLLAMA_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const VALIDATION_CACHE_MS = 30 * 1000;
let validationCache = null;
const OLLAMA_SESSION_COOKIE_NAMES = new Set([
  'session',
  '__Secure-session',
  'ollama_session',
  '__Host-ollama_session',
  'wos-session',
  '__Secure-next-auth.session-token',
  'next-auth.session-token'
]);

function cleanSecret(value) {
  if (typeof value !== 'string') return '';
  let raw = value.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function cookiePairs(value) {
  let header = cleanSecret(value);
  if (/^cookie\s*:/i.test(header)) header = header.replace(/^cookie\s*:/i, '').trim();
  if (!header) return [];
  return header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    const validName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name);
    const validValue = cookieValue && !/[\u0000-\u001F\u007F]/.test(cookieValue);
    return validName && validValue ? { name, value: cookieValue } : null;
  }).filter(Boolean);
}

function isRecognizedSessionCookieName(name) {
  if (OLLAMA_SESSION_COOKIE_NAMES.has(name)) return true;
  return name.startsWith('__Secure-next-auth.session-token.')
    || name.startsWith('next-auth.session-token.');
}

function normalizeOllamaCookieHeader(rawCookie) {
  const cookie = cleanSecret(rawCookie);
  if (!cookie) return '';
  const pairs = cookiePairs(cookie);
  if (pairs.some((pair) => isRecognizedSessionCookieName(pair.name))) {
    return pairs.map((pair) => `${pair.name}=${pair.value}`).join('; ');
  }
  return '';
}

function ollamaSessionCookie(env = process.env, options = {}) {
  const explicit = normalizeOllamaCookieHeader(options.ollamaCookie);
  if (explicit) return explicit;
  for (const name of ['OLLAMA_COOKIE', 'TOKEN_MONITOR_OLLAMA_COOKIE']) {
    const header = normalizeOllamaCookieHeader(env[name]);
    if (header) return header;
  }
  return '';
}

function ollamaApiKey(env = process.env, options = {}) {
  const explicit = cleanSecret(options.ollamaApiKey);
  if (explicit) return explicit;
  for (const name of ['OLLAMA_API_KEY', 'TOKEN_MONITOR_OLLAMA_API_KEY']) {
    const key = cleanSecret(env[name]);
    if (key) return key;
  }
  return '';
}

function toIso(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function firstCapture(text, pattern) {
  return String(text || '').match(pattern)?.[1] || '';
}

function validationCacheKey(credential) {
  return hashKey('ollama-validation', credential);
}

function rememberOllamaValidation(credential, provider, nowMs = Date.now()) {
  if (!credential) return;
  const key = validationCacheKey(credential);
  if (validationCache?.key === key) validationCache = null;
  if (provider?.status !== 'ok') return;
  validationCache = {
    key,
    expiresAt: nowMs + VALIDATION_CACHE_MS,
    provider: normalizeLimitProvider(provider)
  };
}

function consumeOllamaValidation(credential, nowMs = Date.now()) {
  const key = validationCacheKey(credential);
  const cached = validationCache;
  if (!cached) return null;
  if (cached.expiresAt < nowMs) {
    validationCache = null;
    return null;
  }
  if (cached.key !== key) return null;
  validationCache = null;
  return cached.provider;
}

function parseOllamaUsageHtml(html) {
  const text = String(html || '');
  const labelPattern = /(Session usage|Hourly usage|Weekly usage)/gi;
  const labels = [];
  let match;
  while ((match = labelPattern.exec(text)) !== null) {
    labels.push({ index: match.index, label: match[1] });
  }

  const windows = [];
  const seenKinds = new Set();
  for (let index = 0; index < labels.length; index += 1) {
    const current = labels[index];
    const kind = /^weekly/i.test(current.label) ? 'weekly' : 'session';
    if (seenKinds.has(kind)) continue;
    const nextOtherKind = labels.slice(index + 1).find((candidate) => {
      const candidateKind = /^weekly/i.test(candidate.label) ? 'weekly' : 'session';
      return candidateKind !== kind;
    });
    const end = nextOtherKind?.index ?? Math.min(text.length, current.index + 4000);
    const block = text.slice(current.index, Math.min(end, current.index + 4000));
    const percentText = firstCapture(block, /([0-9]+(?:\.[0-9]+)?)\s*%\s*used/i)
      || firstCapture(block, /width\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
    const usedPercent = clampPercent(percentText);
    if (usedPercent === null) continue;
    windows.push({
      kind,
      usedPercent,
      resetsAt: toIso(firstCapture(block, /data-time=["']([^"']+)["']/i)),
      windowMinutes: kind === 'weekly' ? 7 * 24 * 60 : /^hourly/i.test(current.label) ? 60 : 5 * 60,
      showMeter: true
    });
    seenKinds.add(kind);
  }

  windows.sort((a, b) => ({ session: 0, weekly: 1 }[a.kind] ?? 2) - ({ session: 0, weekly: 1 }[b.kind] ?? 2));
  const planName = firstCapture(text, /Cloud Usage\s*<\/span\s*>\s*<span[^>]*>([^<]+)<\/span\s*>/i).trim();
  const accountEmail = firstCapture(text, /id=["']header-email["'][^>]*>([^<]+)</i).trim();
  return {
    windows,
    session: windows.find((window) => window.kind === 'session') || null,
    weekly: windows.find((window) => window.kind === 'weekly') || null,
    planName,
    accountEmail: accountEmail.includes('@') ? accountEmail.toLowerCase() : ''
  };
}

function looksSignedOut(html) {
  const lower = String(html || '').toLowerCase();
  const hasAuthRoute = lower.includes('/api/auth/signin') || lower.includes('/auth/signin')
    || lower.includes('href="/signin"') || lower.includes("href='/signin'")
    || lower.includes('action="/signin"') || lower.includes("action='/signin'")
    || lower.includes('href="/login"') || lower.includes("href='/login'")
    || lower.includes('action="/login"') || lower.includes("action='/login'");
  const hasEmail = lower.includes('type="email"') || lower.includes("type='email'")
    || lower.includes('name="email"') || lower.includes("name='email'");
  const hasPassword = lower.includes('type="password"') || lower.includes("type='password'")
    || lower.includes('name="password"') || lower.includes("name='password'");
  return lower.includes('<form') && (hasAuthRoute
    || lower.includes('sign in to ollama')
    || (hasEmail && hasPassword));
}

function redirectUrl(response, currentUrl) {
  const location = response?.headers?.get?.('location');
  if (!location) return null;
  try { return new URL(location, currentUrl); } catch (_) { return null; }
}

function isOllamaAuthUrl(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if ((host === 'ollama.com' || host === 'www.ollama.com') && path === '/signin') return true;
  if (host === 'signin.ollama.com') return true;
  return host.endsWith('.workos.com') && path.startsWith('/user_management/authorize');
}

function shouldAttachOllamaCookie(url) {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (host === 'ollama.com' || host === 'www.ollama.com');
}

async function requestSettings(fetchFn, cookieHeader, controller) {
  let url = new URL(OLLAMA_SETTINGS_URL);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetchFn(url, {
      headers: {
        ...(shouldAttachOllamaCookie(url) ? { Cookie: cookieHeader } : {}),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': OLLAMA_USER_AGENT
      },
      redirect: 'manual',
      ...(controller ? { signal: controller.signal } : {})
    });
    if (response.status < 300 || response.status >= 400) return response;
    const nextUrl = redirectUrl(response, url);
    if (!nextUrl) throw errorWithStatus('unavailable', 'Ollama redirect missing Location');
    if (isOllamaAuthUrl(nextUrl)) throw errorWithStatus('unauthorized', 'Ollama session expired');
    if (!shouldAttachOllamaCookie(nextUrl)) {
      throw errorWithStatus('unavailable', 'Ollama redirected outside its HTTPS origin');
    }
    url = nextUrl;
  }
  throw errorWithStatus('unavailable', 'Ollama returned too many redirects');
}

function ratioUsageWindow(kind, usage) {
  const ratio = Number(usage);
  if (!Number.isFinite(ratio)) return null;
  // One-decimal precision matches the HTML scraping path (e.g. 14.5% used).
  const usedPercent = clampPercent(Math.round(ratio * 1000) / 10);
  if (usedPercent === null) return null;
  return {
    kind,
    usedPercent,
    resetsAt: null,
    windowMinutes: kind === 'weekly' ? 7 * 24 * 60 : 5 * 60,
    showMeter: true
  };
}

// GET /api/usage reports each window's `usage` as a 0..1 ratio (1.0 = limit
// reached). No reset timestamps are exposed.
function parseOllamaUsageJson(data) {
  const limits = data && typeof data === 'object' && data.limits && typeof data.limits === 'object'
    ? data.limits
    : {};
  const session = ratioUsageWindow('session', limits.session?.usage);
  const weekly = ratioUsageWindow('weekly', limits.weekly?.usage);
  return {
    windows: [session, weekly].filter(Boolean),
    session,
    weekly
  };
}

function normalizePlanLabel(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// POST /api/me is best-effort: the plan label must never block quota data.
async function fetchOllamaPlanLabel(fetchFn, apiKey, controller) {
  try {
    const response = await fetchFn(OLLAMA_ME_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Length': '0'
      },
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) return '';
    return normalizePlanLabel((await response.json())?.Plan);
  } catch (_) {
    return '';
  }
}

async function fetchOllamaLimitsWithApiKey(apiKey, updatedAt, deps = {}, options = {}) {
  const fetchFn = deps.fetch || fetch;
  const timeoutMs = Number(deps.fetchTimeoutMs || 12000);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(OLLAMA_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      ...(controller ? { signal: controller.signal } : {})
    });
    if (response.status === 401 || response.status === 403) {
      throw errorWithStatus('unauthorized', `Ollama usage API returned ${response.status}`);
    }
    if (response.status === 429) throw errorWithStatus('sourceRateLimited', 'Ollama usage API returned 429');
    if (!response.ok) throw errorWithStatus('unavailable', `Ollama usage API returned ${response.status}`);
    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw errorWithStatus('unavailable', 'Ollama usage response was not JSON');
    }
    const parsed = parseOllamaUsageJson(data);
    const planLabel = await fetchOllamaPlanLabel(fetchFn, apiKey, controller);
    return normalizeLimitProvider({
      provider: 'ollama',
      accountKey: hashKey('ollama', apiKey),
      accountName: options.ollamaAccountLabel || '',
      accountLabel: planLabel,
      source: 'api',
      status: 'ok',
      updatedAt,
      windows: parsed.windows
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'ollama',
      source: 'api',
      status: error?.name === 'AbortError' ? 'unavailable' : (error?.status || 'unavailable'),
      updatedAt,
      windows: []
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchOllamaLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const apiKey = ollamaApiKey(env, options);
  const cookieHeader = apiKey ? '' : ollamaSessionCookie(env, options);
  const credential = apiKey || cookieHeader;
  if (!credential) {
    return normalizeLimitProvider({ provider: 'ollama', source: 'web', status: 'notConfigured', updatedAt, windows: [] });
  }

  if (!deps.bypassValidationCache) {
    const cached = consumeOllamaValidation(credential, now);
    if (cached) return cached;
  }

  if (apiKey) return fetchOllamaLimitsWithApiKey(apiKey, updatedAt, deps, options);

  const fetchFn = deps.fetch || fetch;
  const timeoutMs = Number(deps.fetchTimeoutMs || 12000);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await requestSettings(fetchFn, cookieHeader, controller);
    if (response.status === 401 || response.status === 403) {
      throw errorWithStatus('unauthorized', `Ollama settings returned ${response.status}`);
    }
    if (response.status === 429) throw errorWithStatus('sourceRateLimited', 'Ollama settings returned 429');
    if (!response.ok) throw errorWithStatus('unavailable', `Ollama settings returned ${response.status}`);
    const html = await response.text();
    const parsed = parseOllamaUsageHtml(html);
    if (parsed.windows.length === 0) {
      throw errorWithStatus(looksSignedOut(html) ? 'unauthorized' : 'unavailable', 'Ollama settings page had no usage meters');
    }
    const identity = parsed.accountEmail || cookiePairs(cookieHeader)
      .filter((pair) => isRecognizedSessionCookieName(pair.name))
      .map((pair) => `${pair.name}=${pair.value}`).join(';');
    return normalizeLimitProvider({
      provider: 'ollama',
      accountKey: hashKey('ollama', identity),
      accountName: options.ollamaAccountLabel || '',
      accountEmail: parsed.accountEmail,
      accountLabel: parsed.planName,
      source: 'web',
      status: 'ok',
      updatedAt,
      windows: parsed.windows
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'ollama',
      source: 'web',
      status: error?.name === 'AbortError' ? 'unavailable' : (error?.status || 'unavailable'),
      updatedAt,
      windows: []
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorWithStatus(status, message) {
  const error = new Error(message || status);
  error.status = status;
  return error;
}

module.exports = {
  OLLAMA_SETTINGS_URL,
  OLLAMA_USAGE_URL,
  OLLAMA_ME_URL,
  OLLAMA_SESSION_COOKIE_NAMES,
  normalizeOllamaCookieHeader,
  ollamaSessionCookie,
  ollamaApiKey,
  rememberOllamaValidation,
  parseOllamaUsageHtml,
  parseOllamaUsageJson,
  fetchOllamaLimits
};
