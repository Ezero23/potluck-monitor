'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createDeviceState } = require('../../src/shared/deviceState');
const {
  MAX_PAYLOAD_BYTES,
  adaptExternalLimitSnapshot,
  applyExternalLimitSnapshot
} = require('../../src/shared/externalLimitSnapshot');

function snapshot(extra = {}, providerExtra = {}) {
  return {
    schemaVersion: 2,
    snapshotId: 'snap-1',
    snapshotType: 'full',
    sourceInstanceId: 'potluck:mac-esther',
    generatedAt: '2026-08-19T10:30:00.000Z',
    updatedAt: '2026-08-19T10:30:00.000Z',
    refreshMs: 300000,
    providers: [{
      provider: 'zai',
      connectionKey: 'potluck:mac-esther:conn-a',
      accountKey: 'potluck:mac-esther:conn-a',
      status: 'ok',
      source: 'api',
      sourceDetail: 'managed',
      updatedAt: '2026-08-19T10:30:00.000Z',
      windows: [{ kind: 'session', usedPercent: 12, resetsAt: '2026-08-19T12:00:00.000Z' }],
      ...providerExtra
    }],
    ...extra
  };
}

function usage() {
  return {
    deviceId: 'producer-device',
    updatedAt: '2026-08-19T10:00:00.000Z',
    today: { totalTokens: 10 },
    month: { totalTokens: 20 },
    allTime: { totalTokens: 30 }
  };
}

test('adapter stamps potluck identity and drops unknown providers', () => {
  const result = adaptExternalLimitSnapshot(snapshot({
    providers: [
      snapshot().providers[0],
      {
        provider: 'not-a-vendor',
        connectionKey: 'potluck:mac-esther:ghost',
        status: 'ok',
        updatedAt: '2026-08-19T10:30:00.000Z'
      },
      {
        provider: 'glm',
        connectionKey: 'potluck:mac-esther:conn-b',
        status: 'ok',
        updatedAt: '2026-08-19T10:30:00.000Z'
      }
    ]
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary.providers.map((row) => row.provider), ['zai', 'zai']);
  assert.equal(result.summary.providers[0].managedBy, 'potluck');
  assert.equal(result.summary.providers[0].sourceDetail, 'managed');
  assert.equal(result.summary.providers[1].provider, 'zai');
  assert.equal(result.summary.providers[1].region, 'global');
});

test('adapter rejects credentials, control fields, and prototype pollution', () => {
  assert.equal(adaptExternalLimitSnapshot(snapshot({}, { apiKey: 'sk-live' })).error.code, 'forbidden_field');
  assert.equal(adaptExternalLimitSnapshot(snapshot({}, {
    windows: [{ kind: 'session', usedPercent: 1, rawResponse: { remaining: 1 } }]
  })).error.code, 'forbidden_field');
  assert.equal(adaptExternalLimitSnapshot(snapshot({ route: { model: 'gpt' } })).error.code, 'control_field');
  assert.equal(adaptExternalLimitSnapshot(snapshot({}, { action: 'switch' })).error.code, 'control_field');

  const polluted = Object.assign(Object.create(null), snapshot(), { constructor: { polluted: true } });
  assert.equal(adaptExternalLimitSnapshot(polluted).error.code, 'prototype_pollution');
});

test('adapter rejects unknown versions, oversized payloads, and over-limit arrays', () => {
  assert.equal(adaptExternalLimitSnapshot(snapshot({ schemaVersion: 99 })).error.code, 'unknown_version');
  assert.equal(adaptExternalLimitSnapshot(snapshot({ schemaVersion: undefined, snapshot_id: 'snap-1' })).error.code, 'unknown_version');

  const huge = snapshot({}, { accountLabel: 'n'.repeat(MAX_PAYLOAD_BYTES) });
  assert.equal(adaptExternalLimitSnapshot(huge).error.code, 'payload_too_large');

  const many = snapshot({
    providers: Array.from({ length: 257 }, (_, index) => ({
      provider: 'zai',
      connectionKey: `potluck:mac-esther:${index}`,
      status: 'ok',
      updatedAt: '2026-08-19T10:30:00.000Z'
    }))
  });
  assert.equal(adaptExternalLimitSnapshot(many).error.code, 'too_many_providers');
});

test('adapter rejects deep trees, control characters, unsafe labels, and out-of-range timestamps', () => {
  let nested = 1;
  for (let i = 0; i < 14; i += 1) nested = { child: nested };
  assert.equal(adaptExternalLimitSnapshot(snapshot({ extra: nested })).error.code, 'too_deep');

  assert.equal(adaptExternalLimitSnapshot(snapshot({}, { accountLabel: 'ok\u0000secret' })).error.code, 'control_character');
  assert.equal(adaptExternalLimitSnapshot(snapshot({}, {
    planLabel: 'https://evil.example/steal'
  })).error.code, 'unsafe_label');
  assert.equal(adaptExternalLimitSnapshot(snapshot({ generatedAt: '1999-01-01T00:00:00.000Z' })).error.code, 'invalid_timestamp');
  assert.equal(adaptExternalLimitSnapshot({ providers: [] }).error.code, 'unknown_version');
});

test('partial snapshots without scope are rejected; unknown ids stay isolated', () => {
  assert.equal(adaptExternalLimitSnapshot(snapshot({ snapshotType: 'partial' })).error.code, 'invalid_partial');
  const missingIds = snapshot({ snapshotId: '', sourceInstanceId: '' });
  delete missingIds.snapshotId;
  delete missingIds.sourceInstanceId;
  missingIds.schemaVersion = 2;
  assert.equal(adaptExternalLimitSnapshot(missingIds).error.code, 'missing_identity');
});

test('duplicate snapshot ids are idempotent and older generatedAt is ignored', () => {
  const first = applyExternalLimitSnapshot(undefined, snapshot());
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  assert.equal(first.summary.providers.length, 1);

  const duplicate = applyExternalLimitSnapshot(first.summary, snapshot(), first.applied);
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(duplicate.summary.providers[0].windows[0].usedPercent, 12);

  const older = applyExternalLimitSnapshot(first.summary, snapshot({
    snapshotId: 'snap-0',
    generatedAt: '2026-08-19T10:00:00.000Z',
    providers: [{
      ...snapshot().providers[0],
      windows: [{ kind: 'session', usedPercent: 90 }]
    }]
  }), first.applied);
  assert.equal(older.skipped, true);
  assert.equal(older.reason, 'out_of_order');
  assert.equal(older.summary.providers[0].windows[0].usedPercent, 12);

  const newer = applyExternalLimitSnapshot(first.summary, snapshot({
    snapshotId: 'snap-2',
    generatedAt: '2026-08-19T10:45:00.000Z',
    providers: [{
      ...snapshot().providers[0],
      windows: [{ kind: 'session', usedPercent: 20 }]
    }]
  }), first.applied);
  assert.equal(newer.skipped, false);
  assert.equal(newer.summary.providers[0].windows[0].usedPercent, 20);
});

test('full snapshots drop live ghosts for that source; partial updates stay in scope', () => {
  const two = applyExternalLimitSnapshot(undefined, snapshot({
    providers: [
      snapshot().providers[0],
      {
        provider: 'zai',
        connectionKey: 'potluck:mac-esther:conn-b',
        accountKey: 'potluck:mac-esther:conn-b',
        status: 'ok',
        updatedAt: '2026-08-19T10:30:00.000Z',
        windows: [{ kind: 'session', usedPercent: 40 }]
      }
    ]
  }));
  assert.equal(two.summary.providers.length, 2);

  const fullOne = applyExternalLimitSnapshot(two.summary, snapshot({
    snapshotId: 'snap-full-2',
    generatedAt: '2026-08-19T10:40:00.000Z'
  }), two.applied);
  assert.deepEqual(
    fullOne.summary.providers.map((row) => row.connectionKey),
    ['potluck:mac-esther:conn-a']
  );

  const partial = applyExternalLimitSnapshot(fullOne.summary, snapshot({
    snapshotId: 'snap-partial',
    snapshotType: 'partial',
    generatedAt: '2026-08-19T10:50:00.000Z',
    scope: { connectionKeys: ['potluck:mac-esther:conn-a'] },
    providers: [{
      ...snapshot().providers[0],
      windows: [{ kind: 'session', usedPercent: 33 }]
    }, {
      provider: 'codex',
      connectionKey: 'potluck:mac-esther:out-of-scope',
      status: 'ok',
      updatedAt: '2026-08-19T10:50:00.000Z',
      windows: []
    }]
  }), fullOne.applied);
  assert.equal(partial.summary.providers.length, 1);
  assert.equal(partial.summary.providers[0].windows[0].usedPercent, 33);
  assert.equal(partial.summary.providers.some((row) => row.provider === 'codex'), false);
});

test('external failures do not replace a local healthy account with the same identity', () => {
  const local = {
    updatedAt: '2026-08-19T10:00:00.000Z',
    refreshMs: 300000,
    providers: [{
      provider: 'zai',
      accountKey: 'sha256:local-zai',
      status: 'ok',
      updatedAt: '2026-08-19T10:00:00.000Z',
      windows: [{ kind: 'session', usedPercent: 5 }]
    }]
  };
  const merged = applyExternalLimitSnapshot(local, snapshot({
    providers: [{
      provider: 'zai',
      connectionKey: 'sha256:local-zai',
      accountKey: 'sha256:local-zai',
      status: 'unavailable',
      updatedAt: '2026-08-19T10:30:00.000Z',
      windows: []
    }]
  }));
  assert.equal(merged.ok, true);
  assert.equal(merged.summary.providers.length, 1);
  assert.equal(merged.summary.providers[0].status, 'ok');
  assert.equal(Object.hasOwn(merged.summary.providers[0], 'managedBy'), false);

  const alongside = applyExternalLimitSnapshot(local, snapshot());
  assert.equal(alongside.summary.providers.length, 2);
  assert.equal(alongside.summary.providers.filter((row) => row.provider === 'zai').length, 2);
});

test('deviceState keeps potluck rows across local collector ticks', () => {
  const state = createDeviceState();
  state.updateUsage(usage());
  state.updateLimits({
    updatedAt: '2026-08-19T10:00:00.000Z',
    refreshMs: 300000,
    providers: [{
      provider: 'codex',
      accountKey: 'sha256:local-codex',
      status: 'ok',
      updatedAt: '2026-08-19T10:00:00.000Z',
      windows: []
    }]
  });
  state.applyExternalLimits(snapshot());
  const afterLocal = state.updateLimits({
    updatedAt: '2026-08-19T10:05:00.000Z',
    refreshMs: 300000,
    providers: [{
      provider: 'codex',
      accountKey: 'sha256:local-codex',
      status: 'ok',
      updatedAt: '2026-08-19T10:05:00.000Z',
      windows: []
    }]
  });
  const providers = afterLocal.limits.providers.map((row) => row.provider).sort();
  assert.deepEqual(providers, ['codex', 'zai']);
  assert.equal(afterLocal.limits.providers.find((row) => row.provider === 'zai').managedBy, 'potluck');
  assert.equal(afterLocal.updatedAt, '2026-08-19T10:00:00.000Z');

  assert.equal(state.applyExternalLimits(snapshot({ schemaVersion: 3 })), null);
  assert.equal(state.getSnapshot().limits.providers.length, 2);
});
