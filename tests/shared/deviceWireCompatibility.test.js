'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createDeviceState } = require('../../src/shared/deviceState');
const { LIMITS_SCHEMA_VERSION, normalizeLimitsSummary } = require('../../src/shared/limits');
const { syncPayload } = require('../../src/shared/syncPayload');
const { mergeDeviceRecord, normalizeDeviceRecord } = require('../../src/shared/usage');

function period(tokens) {
  return {
    totalTokens: tokens,
    costUsd: 0,
    clients: { codex: tokens },
    clientCosts: {},
    models: {},
    modelCosts: {}
  };
}

test('composed full records remain compatible with hub normalization and merging', () => {
  const records = [];
  const state = createDeviceState({
    envelope: {
      deviceId: 'device-1',
      hostname: 'host',
      platform: 'darwin-arm64',
      agentVersion: '1.2.3'
    },
    onRecord: (record, meta) => records.push({ record, meta })
  });
  state.updateUsage({
    updatedAt: '2026-07-21T01:00:00.000Z',
    today: period(10),
    month: period(20),
    allTime: period(30),
    history: { daily: [{ date: '2026-07-21', totalTokens: 10, costUsd: 0 }] }
  });
  state.updateLimits({
    updatedAt: '2026-07-21T01:01:00.000Z',
    refreshMs: 300000,
    providers: [{
      provider: 'codex',
      status: 'unavailable',
      accountKey: 'account-1',
      windows: [{ kind: 'session', usedPercent: 40 }]
    }]
  });

  assert.equal(records.length, 2);
  assert.equal(Object.hasOwn(records[1].record, 'revision'), false);
  assert.equal(records[1].record.updatedAt, '2026-07-21T01:00:00.000Z');

  const normalized = normalizeDeviceRecord(records[1].record);
  assert.equal(normalized.periods.today.totalTokens, 10);
  assert.equal(normalized.history.daily[0].totalTokens, 10);
  assert.equal(normalized.limits.providers[0].status, 'unavailable');
  assert.equal(normalized.limits.providers[0].windows[0].usedPercent, 40);

  const merged = mergeDeviceRecord(records[0].record, {
    ...records[1].record,
    receivedAt: '2026-07-21T01:01:01.000Z'
  });
  assert.equal(merged.periods.today.totalTokens, 10);
  assert.equal(merged.history.daily[0].totalTokens, 10);
  assert.equal(merged.updatedAt, '2026-07-21T01:00:00.000Z');
  assert.equal(merged.receivedAt, '2026-07-21T01:01:01.000Z');
});

test('sync payload keeps retained public status/windows and drops runtime-only provider state', () => {
  const payload = syncPayload({
    deviceId: 'device-1',
    updatedAt: '2026-07-21T01:00:00.000Z',
    today: period(10),
    month: period(20),
    allTime: period(30),
    limits: {
      updatedAt: '2026-07-21T01:01:00.000Z',
      refreshMs: 300000,
      providers: [{
        provider: 'codex',
        status: 'unavailable',
        accountKey: 'account-1',
        windows: [{ kind: 'session', usedPercent: 40 }],
        lastAttempt: { status: 'unavailable' },
        error: 'private diagnostic',
        credentialDigest: 'private digest',
        revision: 99
      }]
    }
  });
  const provider = payload.limits.providers[0];
  assert.equal(provider.status, 'unavailable');
  assert.equal(provider.windows[0].usedPercent, 40);
  assert.equal(Object.hasOwn(provider, 'lastAttempt'), false);
  assert.equal(Object.hasOwn(provider, 'error'), false);
  assert.equal(Object.hasOwn(provider, 'credentialDigest'), false);
  assert.equal(Object.hasOwn(provider, 'revision'), false);
});

test('v1 device limits remain readable after hub normalization', () => {
  const normalized = normalizeDeviceRecord({
    deviceId: 'macbook',
    hostname: 'macbook.local',
    platform: 'darwin-arm64',
    updatedAt: '2026-05-18T00:00:00.000Z',
    today: period(1234),
    month: period(4567),
    allTime: period(8901),
    limits: {
      updatedAt: '2026-05-18T00:00:00.000Z',
      refreshMs: 300000,
      providers: [{
        provider: 'claude',
        accountKey: 'sha256:v1',
        status: 'ok',
        updatedAt: '2026-05-18T00:00:00.000Z',
        windows: [{
          kind: 'session',
          usedPercent: 42,
          remainingPercent: 58,
          resetAt: '2026-05-18T05:00:00.000Z'
        }]
      }]
    }
  });
  const provider = normalized.limits.providers[0];
  assert.equal(provider.status, 'ok');
  assert.equal(provider.connectionStatus, 'ok');
  assert.equal(provider.quotaStatus, 'fresh');
  assert.equal(provider.windows[0].resetsAt, '2026-05-18T05:00:00.000Z');
  assert.equal(Object.hasOwn(normalized.limits, 'schemaVersion'), false);
});

test('v2 device limits survive hub normalization and sync projection', () => {
  const limits = {
    schemaVersion: LIMITS_SCHEMA_VERSION,
    snapshotType: 'full',
    sourceInstanceId: 'monitor:macbook',
    capabilities: ['connection_status_v2', 'quota_status_v2'],
    updatedAt: '2026-08-19T10:30:00.000Z',
    refreshMs: 300000,
    providers: [{
      provider: 'zai',
      connectionKey: 'monitor:macbook:conn-1',
      accountKey: 'monitor:macbook:conn-1',
      connectionStatus: 'ok',
      quotaStatus: 'stale',
      lastAttemptAt: '2026-08-19T10:30:00.000Z',
      lastSuccessAt: '2026-08-19T10:20:00.000Z',
      error: {
        code: 'provider_unavailable',
        category: 'unavailable',
        messageKey: 'limits.error.unavailable',
        safeDetail: 'HTTP 503',
        recoverable: true
      },
      windows: [{ kind: 'session', usedPercent: 40, resetAt: '2026-08-19T12:00:00.000Z' }],
      lastAttempt: { status: 'unavailable' },
      credentialDigest: 'private digest'
    }]
  };
  const record = {
    deviceId: 'device-1',
    updatedAt: '2026-08-19T10:00:00.000Z',
    today: period(10),
    month: period(20),
    allTime: period(30),
    limits
  };
  const normalized = normalizeDeviceRecord(record);
  assert.equal(normalized.limits.schemaVersion, 2);
  assert.equal(normalized.limits.snapshotType, 'full');
  assert.equal(normalized.limits.providers[0].status, 'ok');
  assert.equal(normalized.limits.providers[0].quotaStatus, 'stale');
  assert.equal(normalized.limits.providers[0].connectionKey, 'monitor:macbook:conn-1');
  assert.equal(normalized.limits.providers[0].error.code, 'provider_unavailable');
  assert.equal(normalized.limits.providers[0].windows[0].resetsAt, '2026-08-19T12:00:00.000Z');
  assert.equal(Object.hasOwn(normalized.limits.providers[0], 'lastAttempt'), false);
  assert.equal(Object.hasOwn(normalized.limits.providers[0], 'credentialDigest'), false);

  const payload = syncPayload(record);
  assert.equal(payload.limits.schemaVersion, 2);
  assert.equal(payload.limits.snapshotType, 'full');
  assert.equal(payload.limits.providers[0].lastAttemptAt, '2026-08-19T10:30:00.000Z');
  assert.equal(payload.limits.providers[0].error.safeDetail, 'HTTP 503');
  assert.equal(Object.hasOwn(payload.limits.providers[0], 'lastAttempt'), false);
  assert.equal(Object.hasOwn(payload.limits.providers[0], 'credentialDigest'), false);

  const roundTrip = normalizeLimitsSummary(payload.limits);
  assert.equal(roundTrip.providers[0].status, 'ok');
  assert.equal(roundTrip.providers[0].connectionStatus, 'ok');
  assert.equal(roundTrip.providers[0].quotaStatus, 'stale');
});
