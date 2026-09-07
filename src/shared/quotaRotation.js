'use strict';

(function exposeQuotaRotation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorQuotaRotation = api;
})(typeof window !== 'undefined' ? window : globalThis, function createQuotaRotation() {
  const DEFAULT_LABELS = {
    zai: 'GLM',
    zaiteam: 'GLM Team',
    copilot: 'GitHub Copilot'
  };

  function numberOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function windowKind(window) {
    return String(window?.kind || '').trim().toLowerCase();
  }

  function windowRemaining(window) {
    if (!window || window.showMeter === false) return null;
    const remaining = numberOrNull(window.remainingPercent);
    if (remaining != null) return Math.max(0, Math.min(100, remaining));
    const used = numberOrNull(window.usedPercent);
    return used == null ? null : Math.max(0, Math.min(100, 100 - used));
  }

  function resetMs(window) {
    const parsed = Date.parse(window?.resetsAt || window?.resetAt || '');
    return Number.isFinite(parsed) ? parsed : null;
  }

  function providerId(provider) {
    return String(provider?.provider || '').trim().toLowerCase();
  }

  function defaultProviderName(provider) {
    const id = providerId(provider);
    if (!id) return '';
    if (DEFAULT_LABELS[id]) return DEFAULT_LABELS[id];
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function normalizeRotationPreferences(value = {}) {
    return {
      currentPoolKey: typeof value?.currentPoolKey === 'string' ? value.currentPoolKey.slice(0, 512) : '',
      notifications: value?.notifications === true,
      mutedUntil: Number.isFinite(value?.mutedUntil) ? Math.max(0, value.mutedUntil) : 0
    };
  }

  function rotationAccounts(providers) {
    const seen = new Set();
    return (Array.isArray(providers) ? providers : []).flatMap((provider, index) => {
      if (!provider?.accountKey && !provider?.quotaPoolKey) return [];
      const key = poolKey(provider, index);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, name: slotName(provider), providerId: providerId(provider) }];
    });
  }

  function createRotationObserver() {
    const previous = new Map();
    let lastNotificationAt = -Infinity;
    return {
      blockedPoolKeys() { return [...previous].filter(([, value]) => value.blockedKinds.length).map(([key]) => key); },
      observe(providers, preferences = {}, now = Date.now()) {
        const prefs = normalizeRotationPreferences(preferences);
        const events = [];
        const present = new Set();
        const hour = new Date(now).getHours();
        const quiet = hour >= 22 || hour < 8 || prefs.mutedUntil > now;
        for (const { provider, index } of latestPoolSamples(providers)) {
          if (!provider?.accountKey && !provider?.quotaPoolKey) continue;
          const key = poolKey(provider, index);
          present.add(key);
          const at = Date.parse(provider.updatedAt || '');
          if (provider.status !== 'ok' || provider.stale || provider.quotaStatus === 'stale'
            || !Number.isFinite(at) || now - at > 900000 || at > now + 60000) continue;
          const before = previous.get(key);
          if (before && at <= before.at) continue;
          const windows = rotationWindows(provider);
          const remaining = windows.map(windowRemaining).filter((value) => value != null);
          const blockedKinds = [...new Set([
            ...windows.filter((window) => hasExhaustedWindow({ windows: [window] })).map(windowKind),
            ...(before?.blockedKinds || []).filter((kind) => !windows.some((window) => windowKind(window) === kind && windowRemaining(window) > 0))
          ])];
          const snapshot = { at, blockedKinds, low: remaining.length > 0 && Math.min(...remaining) <= 10 };
          previous.set(key, snapshot);
          if (!before) continue;
          let type = null;
          if (before.blockedKinds.length > 0 && blockedKinds.length === 0
            && before.blockedKinds.every((kind) => windows.some((window) => windowKind(window) === kind && windowRemaining(window) > 0))) type = 'recovered';
          else if (key === prefs.currentPoolKey && ((!before.low && snapshot.low)
            || (!before.blockedKinds.length && blockedKinds.length))) type = 'low';
          if (!type || !prefs.notifications || quiet || now - lastNotificationAt < 600000) continue;
          lastNotificationAt = now;
          // Notifications use provider names, not account emails or keys.
          events.push({ type, provider: defaultProviderName(provider) });
        }
        for (const [key, snapshot] of previous) if (!present.has(key) && !snapshot.blockedKinds.length) previous.delete(key);
        return events;
      }
    };
  }

  function slotName(provider, labelFor) {
    const base = String((labelFor || defaultProviderName)(provider) || defaultProviderName(provider)).trim();
    const extra = String(provider?.accountLabel || provider?.accountName || '').trim();
    if (extra && base && !base.includes(extra)) return `${base} · ${extra}`;
    return extra || base;
  }

  function poolKey(provider, index) {
    const id = providerId(provider);
    const pool = String(provider?.quotaPoolKey || '').trim();
    if (pool) return `${id}:pool:${pool}`;
    const account = String(provider?.accountKey || '').trim();
    if (account) return `${id}:account:${account}`;
    return `${id}:row:${index}`;
  }

  function latestPoolSamples(providers) {
    const pools = new Map();
    (Array.isArray(providers) ? providers : []).forEach((provider, index) => {
      const key = poolKey(provider, index);
      const at = Date.parse(provider?.updatedAt || '');
      const previous = pools.get(key);
      const timestamp = Number.isFinite(at) ? at : -Infinity;
      if (!previous || timestamp > previous.timestamp) pools.set(key, { provider, index, timestamp });
      else if (timestamp === previous.timestamp && JSON.stringify(provider?.windows) !== JSON.stringify(previous.provider?.windows)) {
        pools.set(key, { provider: { ...provider, status: 'conflicting' }, index, timestamp });
      }
    });
    return [...pools.values()];
  }

  function hasExhaustedWindow(provider) {
    return rotationWindows(provider).some((window) => {
      // A hidden meter may still carry a real blocking limit.
      return numberOrNull(window.remainingPercent) === 0 || numberOrNull(window.remaining) === 0
        || numberOrNull(window.usedPercent) >= 100;
    });
  }

  function rotationWindows(provider) {
    return (Array.isArray(provider?.windows) ? provider.windows : []).filter((window) => {
      if (!['session', 'weekly', 'billing', 'monthly', 'rolling'].includes(windowKind(window))) return false;
      // zaiLimits maps TIME_LIMIT (MCP tools, not model calls) to billing.
      return !(providerId(provider) === 'zai' && windowKind(window) === 'billing');
    });
  }

  function gatingWindow(provider) {
    const windows = Array.isArray(provider?.windows) ? provider.windows : [];
    const session = windows.find((window) => windowKind(window) === 'session' && windowRemaining(window) != null);
    if (session) return session;
    return windows.find((window) => windowKind(window) === 'weekly' && windowRemaining(window) != null) || null;
  }

  function toSlot(provider, index, options) {
    if (!provider || provider.status !== 'ok' || provider.stale || provider.quotaStatus === 'stale') return null;
    const updatedAt = Date.parse(provider.updatedAt || '');
    if (!Number.isFinite(updatedAt) || options.now - updatedAt > options.maxAgeMs || updatedAt > options.now + 60000) return null;
    if (hasExhaustedWindow(provider)) return null;
    const window = gatingWindow(provider);
    if (!window) return null;
    const remaining = windowRemaining(window);
    if (remaining == null || remaining <= 0) return null;
    const at = resetMs(window);
    if (at == null || at <= options.now) return null;
    const confidence = numberOrNull(window.resetConfidence);
    const fixedReset = window.resetPolicy === 'fixed' && confidence != null && confidence >= 0.6;
    return {
      providerId: providerId(provider),
      refreshScope: { provider: providerId(provider), ...(provider.accountKey ? { accountKey: provider.accountKey } : {}) },
      name: slotName(provider, options.labelFor),
      remainingPercent: remaining,
      resetAt: at,
      windowKind: windowKind(window),
      fixedReset,
      reason: fixedReset ? 'expiring_window' : 'reset_unconfirmed',
      poolKey: poolKey(provider, index)
    };
  }

  function buildQuotaRotation(providers, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const slots = [];
    const blocked = new Set(options.blockedPoolKeys || []);
    latestPoolSamples(providers).forEach(({ provider, index }) => {
      if (blocked.has(poolKey(provider, index))) return;
      const slot = toSlot(provider, index, {
        now, labelFor: options.labelFor,
        maxAgeMs: Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0 ? options.maxAgeMs : 15 * 60000
      });
      if (!slot) return;
      slots.push(slot);
    });
    slots.sort((a, b) => Number(b.remainingPercent >= 10) - Number(a.remainingPercent >= 10)
      || Number(b.fixedReset) - Number(a.fixedReset)
      || (a.fixedReset && b.fixedReset ? a.resetAt - b.resetAt : b.remainingPercent - a.remainingPercent)
      || a.name.localeCompare(b.name));
    const activeIndex = slots.findIndex((slot) => slot.poolKey === options.currentPoolKey && slot.remainingPercent >= 10);
    if (activeIndex > 0 && !(slots[0].fixedReset && slots[0].resetAt - now <= 5 * 60000)) {
      const [active] = slots.splice(activeIndex, 1);
      slots.unshift({ ...active, reason: 'keep_current' });
    }
    const current = slots[0] || null;
    const beforeReset = current?.resetAt - 5 * 60000;
    const boundary = current?.fixedReset ? (beforeReset > now ? beforeReset : current.resetAt + 30000) : Infinity;
    return {
      current,
      next: slots[1] || null,
      nextCheckAt: current ? Math.max(now + 1000, Math.min((Math.floor(now / 900000) + 1) * 900000, boundary)) : null,
      action: 'reassess',
      steps: slots
    };
  }

  function formatRotationClock(ms) {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function fill(template, params) {
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => (
      params[name] == null ? '' : String(params[name])
    ));
  }

  function defaultTranslate(key, params) {
    const templates = {
      'home.rotation.switchAt': 'Suggested: {current} · backup: {next} · review at {time}',
      'home.rotation.resetAt': 'Suggested: {current} · review at {time}',
      'home.rotation.traySwitch': '{current} · backup {next} · review {time}',
      'home.rotation.trayReset': '{current} · review {time}',
      'home.rotation.reason.expiring_window': 'Confirmed fixed window resets sooner; recheck before switching.',
      'home.rotation.reason.reset_unconfirmed': 'Reset timing is unconfirmed or rolling; no exact switch is scheduled.',
      'home.rotation.reason.keep_current': 'Keep the current plan while it has sufficient quota.'
    };
    return fill(templates[key] || key, params);
  }

  function formatRotationLine(rotation, translate, style = 'home') {
    if (!rotation?.current) return '';
    const t = typeof translate === 'function' ? translate : defaultTranslate;
    const time = formatRotationClock(rotation.nextCheckAt);
    const suffix = style === 'home' ? ` · ${t(`home.rotation.reason.${rotation.current.reason}`, {})}` : '';
    if (rotation.next) {
      return t(style === 'tray' ? 'home.rotation.traySwitch' : 'home.rotation.switchAt', {
        current: rotation.current.name,
        next: rotation.next.name,
        time
      }) + suffix;
    }
    return t(style === 'tray' ? 'home.rotation.trayReset' : 'home.rotation.resetAt', {
      current: rotation.current.name,
      time
    }) + suffix;
  }

  return {
    buildQuotaRotation,
    normalizeRotationPreferences,
    rotationAccounts,
    createRotationObserver,
    defaultProviderName,
    formatRotationClock,
    formatRotationLine
  };
});
