'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildQuotaRotation,
  formatRotationClock,
  formatRotationLine,
  createRotationObserver,
  normalizeRotationPreferences,
  rotationAccounts
} = require('../../src/shared/quotaRotation');

const now = Date.parse('2026-09-06T00:00:00.000Z');

test('rotation preferences default to silent and identities never depend on row order', () => {
  assert.deepEqual(normalizeRotationPreferences(null), { currentPoolKey: '', notifications: false, mutedUntil: 0 });
  assert.equal(normalizeRotationPreferences({ notifications: 'true' }).notifications, false);
  const rows = [provider('kimi', [], { accountKey: 'a' }), provider('kimi', [], { accountKey: 'b' })];
  assert.deepEqual(rotationAccounts(rows).map((a) => a.key), ['kimi:account:a', 'kimi:account:b']);
  assert.equal(rotationAccounts([provider('kimi', [])]).length, 0);
});

test('notifications require a fresh transition, not cached data or startup, and use a cooldown', () => {
  const observer = createRotationObserver();
  const midday = new Date(2026, 8, 7, 12).getTime();
  const prefs = { notifications: true, currentPoolKey: 'kimi:account:a' };
  const row = (percent, offset = 0) => provider('kimi', [{ kind: 'session', remainingPercent: percent }], {
    accountKey: 'a', updatedAt: new Date(midday + offset).toISOString()
  });
  assert.deepEqual(observer.observe([row(60)], prefs, midday), []);
  assert.deepEqual(observer.observe([row(5, 1000)], prefs, midday + 1000), [{ type: 'low', provider: 'Kimi' }]);
  assert.deepEqual(observer.observe([row(0, 2000)], prefs, midday + 2000), []);
  assert.deepEqual(observer.observe([row(80, 3000)], prefs, midday + 3000), []);
  assert.deepEqual(observer.observe([row(5, 601001)], prefs, midday + 601001), [{ type: 'low', provider: 'Kimi' }]);
  assert.deepEqual(observer.observe([row(80, 601001)], prefs, midday + 602000), []);
});

test('a missing exhausted monthly window is not a recovery; its later confirmed recovery is observed', () => {
  const observer = createRotationObserver();
  const midday = new Date(2026, 8, 7, 12).getTime();
  const row = (windows, offset) => provider('zai', windows, { accountKey: 'a', updatedAt: new Date(midday + offset).toISOString() });
  const prefs = { notifications: true };
  assert.deepEqual(observer.observe([row([{ kind: 'monthly', remainingPercent: 0 }], 0)], prefs, midday), []);
  assert.deepEqual(observer.observe([row([{ kind: 'session', remainingPercent: 90 }], 1000)], prefs, midday + 1000), []);
  assert.deepEqual(observer.blockedPoolKeys(), ['zai:account:a']);
  assert.equal(buildQuotaRotation([row([{ kind: 'session', remainingPercent: 90, resetsAt: new Date(midday + 3600000).toISOString() }], 1000)], { now: midday + 1000, blockedPoolKeys: observer.blockedPoolKeys() }).current, null);
  assert.deepEqual(observer.observe([row([{ kind: 'monthly', remainingPercent: 80 }], 2000)], prefs, midday + 2000), [{ type: 'recovered', provider: 'GLM' }]);
  assert.deepEqual(observer.blockedPoolKeys(), []);
});

test('GLM MCP billing is not the model-call monthly allowance', () => {
  const row = provider('zai', [{ kind: 'session', remainingPercent: 80, resetsAt: '2026-09-06T04:00:00Z' }, { kind: 'billing', remainingPercent: 0 }]);
  assert.equal(buildQuotaRotation([row], { now }).current.providerId, 'zai');
});

test('quiet hours suppress and do not replay transitions; stale or anonymous data cannot alert', () => {
  const observer = createRotationObserver();
  const night = new Date(2026, 8, 7, 23).getTime();
  const prefs = { notifications: true, currentPoolKey: 'kimi:account:a' };
  const row = (remainingPercent, at, extra = {}) => provider('kimi', [{ kind: 'session', remainingPercent }], { accountKey: 'a', updatedAt: new Date(at).toISOString(), ...extra });
  observer.observe([row(70, night)], prefs, night);
  assert.deepEqual(observer.observe([row(0, night + 1000)], prefs, night + 1000), []);
  const morning = new Date(2026, 8, 8, 9).getTime();
  assert.deepEqual(observer.observe([row(0, morning)], prefs, morning), []);
  assert.deepEqual(observer.observe([row(90, morning + 1000, { stale: true })], prefs, morning + 1000), []);
  assert.deepEqual(observer.observe([row(90, morning + 2000, { updatedAt: null })], prefs, morning + 2000), []);
  assert.deepEqual(observer.observe([row(90, morning + 3000)], { ...prefs, mutedUntil: morning + 3600000 }, morning + 3000), []);
});

function provider(id, windows, extra = {}) {
  return { provider: id, status: 'ok', updatedAt: new Date(now).toISOString(), windows: windows.map((window) => ({ resetPolicy: 'fixed', resetConfidence: 1, ...window })), ...extra };
}

test('newer exhausted or conflicting pool samples cannot fall back to old healthy quota', () => {
  const healthy = provider('kimi', [{ kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T04:00:00Z' }], { quotaPoolKey: 'shared' });
  const exhausted = { ...healthy, updatedAt: new Date(now + 1000).toISOString(), windows: [{ kind: 'monthly', remainingPercent: 0 }] };
  for (const rows of [[healthy, exhausted], [exhausted, healthy], [healthy, { ...exhausted, updatedAt: healthy.updatedAt }]]) {
    assert.equal(buildQuotaRotation(rows, { now: now + 1000 }).current, null);
  }
  assert.equal(buildQuotaRotation([{ ...healthy, updatedAt: null }], { now }).current, null);
});

test('uses the soonest confirmed fixed window and names a backup, not a scheduled switch', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [
      { kind: 'session', usedPercent: 40, remainingPercent: 60, resetsAt: '2026-09-06T04:00:00.000Z' },
      { kind: 'weekly', usedPercent: 10, remainingPercent: 90, resetsAt: '2026-09-12T00:00:00.000Z' }
    ]),
    provider('zai', [
      { kind: 'session', usedPercent: 10, remainingPercent: 90, resetsAt: '2026-09-06T09:00:00.000Z' }
    ])
  ], { now });
  assert.equal(rotation.current.providerId, 'kimi');
  assert.equal(rotation.next.providerId, 'zai');
  assert.match(formatRotationLine(rotation), /Kimi/);
  assert.match(formatRotationLine(rotation), /GLM/);
  assert.match(formatRotationLine(rotation), /backup/);
  assert.doesNotMatch(formatRotationLine(rotation), /switch to/);
  assert.equal(rotation.action, 'reassess');
  assert.equal(rotation.nextCheckAt, now + 15 * 60000);
});

test('weekly exhaustion blocks healthy hourly quota even when the weekly meter is hidden', () => {
  const rotation = buildQuotaRotation([provider('kimi', [
    { kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T04:00:00Z' },
    { kind: 'weekly', remainingPercent: 0, showMeter: false }
  ])], { now });
  assert.equal(rotation.current, null);
});

test('expired snapshots and future timestamps are not recommendations', () => {
  for (const updatedAt of ['2026-09-05T23:00:00Z', '2026-09-06T01:00:00Z']) {
    const rotation = buildQuotaRotation([provider('kimi', [
      { kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T04:00:00Z' }
    ], { updatedAt })], { now });
    assert.equal(rotation.current, null);
  }
});

test('rolling or low-confidence timestamps do not promise a reset or prioritize expiry', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [{ kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T00:01:00Z', resetPolicy: 'rolling' }]),
    provider('zai', [{ kind: 'session', remainingPercent: 80, resetsAt: '2026-09-06T04:00:00Z', resetConfidence: 0.2 }])
  ], { now });
  assert.equal(rotation.current.fixedReset, false);
  assert.equal(rotation.nextCheckAt, now + 15 * 60000);
  assert.match(formatRotationLine(rotation), /unconfirmed or rolling/);
});

test('keeps the current usable account unless another fixed window is about to expire', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [{ kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T04:00:00Z' }], { accountKey: 'one' }),
    provider('zai', [{ kind: 'session', remainingPercent: 80, resetsAt: '2026-09-06T09:00:00Z' }], { accountKey: 'two' })
  ], { now, currentPoolKey: 'zai:account:two' });
  assert.equal(rotation.current.providerId, 'zai');
  assert.equal(rotation.current.reason, 'keep_current');
});

test('re-rendering does not continuously postpone the review time', () => {
  const rows = [provider('kimi', [{ kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T04:00:00Z' }])];
  assert.equal(buildQuotaRotation(rows, { now }).nextCheckAt, buildQuotaRotation(rows, { now: now + 10000 }).nextCheckAt);
});

test('monthly exhaustion vetoes a provider even when the 5-hour window looks healthy', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [
      { kind: 'session', remainingPercent: 80, resetsAt: '2026-09-06T04:00:00.000Z' },
      { kind: 'billing', remainingPercent: 0, resetsAt: '2026-10-01T00:00:00.000Z' }
    ]),
    provider('zai', [
      { kind: 'session', remainingPercent: 50, resetsAt: '2026-09-06T09:00:00.000Z' }
    ])
  ], { now });
  assert.equal(rotation.current.providerId, 'zai');
  assert.equal(rotation.next, null);
});

test('missing monthly is not treated as exhausted', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [
      { kind: 'session', remainingPercent: 20, resetsAt: '2026-09-06T04:00:00.000Z' }
    ])
  ], { now });
  assert.equal(rotation.current.providerId, 'kimi');
});

test('same quota pool only occupies one rotation slot', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [
      { kind: 'session', remainingPercent: 30, resetsAt: '2026-09-06T04:00:00.000Z' }
    ], { quotaPoolKey: 'kimi-pool-1' }),
    provider('kimi', [
      { kind: 'session', remainingPercent: 30, resetsAt: '2026-09-06T04:00:00.000Z' }
    ], { quotaPoolKey: 'kimi-pool-1', accountLabel: 'work' })
  ], { now });
  assert.equal(rotation.steps.length, 1);
  assert.equal(rotation.next, null);
});

test('unknown or past reset times are not scheduled', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [{ kind: 'session', remainingPercent: 40 }]),
    provider('zai', [{ kind: 'session', remainingPercent: 40, resetsAt: '2026-09-05T12:00:00.000Z' }]),
    provider('codex', [{ kind: 'session', remainingPercent: 40, resetsAt: '2026-09-06T06:00:00.000Z' }])
  ], { now });
  assert.equal(rotation.current.providerId, 'codex');
  assert.equal(rotation.steps.length, 1);
});

test('exhausted or failed providers do not enter the reminder', () => {
  const rotation = buildQuotaRotation([
    provider('kimi', [{ kind: 'session', remainingPercent: 0, resetsAt: '2026-09-06T04:00:00.000Z' }]),
    { provider: 'zai', status: 'unauthorized', windows: [{ kind: 'session', remainingPercent: 90, resetsAt: '2026-09-06T05:00:00.000Z' }] },
    provider('codex', [{ kind: 'weekly', remainingPercent: 70, resetsAt: '2026-09-07T00:00:00.000Z' }])
  ], { now });
  assert.equal(rotation.current.providerId, 'codex');
  assert.equal(rotation.current.windowKind, 'weekly');
});

test('clock formatting stays HH:MM in the local zone', () => {
  const ms = Date.parse('2026-09-06T15:07:00.000Z');
  const date = new Date(ms);
  assert.equal(
    formatRotationClock(ms),
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  );
});
